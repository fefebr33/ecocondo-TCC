import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { COOKIE_NAME, SESSAO_MS } from "@shared/const";
import { pessoas, usuarios } from "../../drizzle/schema";
import { getDb } from "../db";
import { getSessionCookieOptions } from "../_core/cookies";
import { sdk } from "../_core/sdk";
import { ENV } from "../_core/env";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { acessoDesativado, conferirSenha, criarTokenSenha, encerrarSessoes, definirSenhaPorToken, gerarHashSenha, lerTokenSenha, loginBloqueado, normalizarEmail, registrarTentativa, SenhaInvalidaError, validarForcaSenha } from "../senhas";
import { writeAuditLog } from "../audit";
import { administratorOnly } from "./nucleo";

function erroDeSenha(error: unknown): never {
  if (error instanceof SenhaInvalidaError) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  throw error;
}

async function abrirSessao(ctx: { req: any; res: any }, usuario: { idExterno: string; nome: string | null; versaoSessao: number }) {
  const sessionToken = await sdk.createSessionToken(usuario.idExterno, { name: usuario.nome ?? "", expiresInMs: SESSAO_MS, versao: usuario.versaoSessao });
  ctx.res.cookie(COOKIE_NAME, sessionToken, { ...getSessionCookieOptions(ctx.req), maxAge: SESSAO_MS });
}

const ACESSO_DESATIVADO = "Seu acesso ao EcoCondo foi desativado pela administração. Procure o síndico.";

/** Login com e-mail e senha, primeiro acesso, recuperação de senha e leitura obrigatória do manual. */
export const contaRouter = router({
  me: publicProcedure.query(({ ctx }) => {
    if (!ctx.user) return null;
    const { senhaHash, ...usuario } = ctx.user;
    return { ...usuario, temSenha: Boolean(senhaHash), manualLido: Boolean(usuario.manualLidoEm) };
  }),
  /** O que a tela de login mostra: os botões "Entrar como" só existem com o login de demonstração ligado. */
  configuracao: publicProcedure.query(() => ({ demonstracao: ENV.loginDemonstracaoAtivo })),
  entrarComSenha: publicProcedure.input(z.object({ email: z.string().trim().email().max(320), senha: z.string().min(1).max(128) })).mutation(async ({ ctx, input }) => {
    const email = normalizarEmail(input.email);
    if (loginBloqueado(email)) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Muitas tentativas erradas. Espere 15 minutos ou use \"Esqueci minha senha\"." });
    const db = await getDb();
    const [usuario] = await db.select().from(usuarios).where(eq(usuarios.email, email)).limit(1);
    const certa = await conferirSenha(input.senha, usuario?.senhaHash);
    registrarTentativa(email, certa);
    if (!usuario || !certa) throw new TRPCError({ code: "UNAUTHORIZED", message: "E-mail ou senha incorretos." });
    if (await acessoDesativado(usuario.id, usuario.email, db)) throw new TRPCError({ code: "FORBIDDEN", message: ACESSO_DESATIVADO });
    await db.update(usuarios).set({ ultimoAcesso: new Date() }).where(eq(usuarios.id, usuario.id));
    await abrirSessao(ctx, usuario);
    return { success: true, manualLido: Boolean(usuario.manualLidoEm) };
  }),
  /**
   * "Esqueci minha senha" e "primeiro acesso": gera o link de uso único. Sem servidor de e-mail no protótipo, o link vai só para o log
   * do servidor; quem entrega o link é o síndico, que o gera em Pessoas e acessos e manda pelo WhatsApp. O link nunca aparece nesta
   * tela (nem no modo demonstração): se aparecesse, qualquer visitante trocaria a senha de qualquer pessoa, inclusive do síndico.
   * A resposta é a mesma para e-mail cadastrado ou não, para ninguém descobrir quem mora no condomínio.
   */
  solicitarLink: publicProcedure.input(z.object({ email: z.string().trim().email().max(320) })).mutation(async ({ input }) => {
    const db = await getDb();
    const email = normalizarEmail(input.email);
    const [pessoa] = await db.select({ id: pessoas.id }).from(pessoas).where(eq(pessoas.email, email)).limit(1);
    const [usuario] = await db.select({ id: usuarios.id, senhaHash: usuarios.senhaHash }).from(usuarios).where(eq(usuarios.email, email)).limit(1);
    if ((!pessoa && !usuario) || (await acessoDesativado(usuario?.id ?? null, email, db))) return { enviado: true };
    const { caminho } = await criarTokenSenha(db, { email, tipo: usuario?.senhaHash ? "recuperacao" : "primeiro_acesso" });
    console.log(`[Senha] Link para ${email}: ${caminho}`);
    return { enviado: true };
  }),
  lerLink: publicProcedure.input(z.object({ token: z.string().min(20).max(100) })).query(async ({ input }) => {
    const db = await getDb();
    const registro = await lerTokenSenha(db, input.token);
    if (!registro) return { valido: false as const };
    return { valido: true as const, email: registro.email, tipo: registro.tipo, expiraEm: registro.expiraEm };
  }),
  definirSenha: publicProcedure.input(z.object({ token: z.string().min(20).max(100), senha: z.string().min(1).max(128) })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    const registro = await lerTokenSenha(db, input.token);
    if (registro && (await acessoDesativado(null, registro.email, db))) throw new TRPCError({ code: "FORBIDDEN", message: ACESSO_DESATIVADO });
    const usuario = await definirSenhaPorToken(db, input.token, input.senha).catch(erroDeSenha);
    registrarTentativa(usuario.email ?? "", true);
    await abrirSessao(ctx, usuario);
    return { success: true, manualLido: Boolean(usuario.manualLidoEm) };
  }),
  alterarSenha: protectedProcedure.input(z.object({ atual: z.string().max(128).optional(), nova: z.string().min(1).max(128) })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (ctx.user.senhaHash && !(await conferirSenha(input.atual ?? "", ctx.user.senhaHash))) throw new TRPCError({ code: "BAD_REQUEST", message: "A senha atual está incorreta." });
    try {
      validarForcaSenha(input.nova);
    } catch (error) {
      erroDeSenha(error);
    }
    await db.update(usuarios).set({ senhaHash: await gerarHashSenha(input.nova), atualizadoEm: new Date() }).where(eq(usuarios.id, ctx.user.id));
    // Senha nova encerra as outras sessões (outro celular, tablet emprestado); esta continua aberta com um token novo.
    const versaoSessao = await encerrarSessoes(db, ctx.user.id);
    await abrirSessao(ctx, { ...ctx.user, versaoSessao });
    return { success: true };
  }),
  marcarManualLido: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    const agora = new Date();
    await db.update(usuarios).set({ manualLidoEm: agora }).where(eq(usuarios.id, ctx.user.id));
    return { manualLidoEm: agora };
  }),
  /** O síndico gera o link de primeiro acesso (ou de nova senha) de alguém cadastrado em Pessoas e manda pelo canal que preferir. */
  gerarLinkAcesso: administratorOnly.input(z.object({ personId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    const [pessoa] = await db.select().from(pessoas).where(and(eq(pessoas.id, input.personId), eq(pessoas.condominioId, ctx.eco.condominio.id))).limit(1);
    if (!pessoa) throw new TRPCError({ code: "NOT_FOUND", message: "Pessoa não encontrada no condomínio." });
    if (pessoa.statusAcesso === "desativado") throw new TRPCError({ code: "BAD_REQUEST", message: "O acesso desta pessoa está desativado. Reative antes de gerar o link." });
    const [usuario] = await db.select({ senhaHash: usuarios.senhaHash }).from(usuarios).where(eq(usuarios.email, pessoa.email)).limit(1);
    const tipo = usuario?.senhaHash ? "recuperacao" : "primeiro_acesso";
    const link = await criarTokenSenha(db, { email: pessoa.email, tipo, criadoPorId: ctx.user.id });
    await writeAuditLog(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "usuario", entidadeId: pessoa.id, acao: "link_senha_gerado", resumo: `Link de ${tipo === "primeiro_acesso" ? "primeiro acesso" : "nova senha"} gerado para ${pessoa.nome}.` });
    return { caminho: link.caminho, expiraEm: link.expiraEm, tipo };
  }),
});

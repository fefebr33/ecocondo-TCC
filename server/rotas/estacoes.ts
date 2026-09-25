import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { and, asc, desc, eq, gt, gte, isNotNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { coletas, estacoesPesagem, moradores, notificacoes, perfisAcesso, tiposResiduo } from "../../drizzle/schema";
import type { EstacaoPesagem } from "../../drizzle/schema";
import { getDb } from "../db";
import { administratorOnly, withProfile } from "./nucleo";
import { publicProcedure, router } from "../_core/trpc";
import { writeAuditLog } from "../audit";
import { salvarImagemBase64 } from "../storage";
import { calculateCollectionPoints } from "../dominio/regrasColeta";
import { LimiteAntifraudeExcedidoError } from "../dominio/antifraude";
import {
  LIMITE_PESO_POR_REGISTRO_ESTACAO_GRAMAS,
  VALIDADE_CODIGO_ESTACAO_MINUTOS,
  avaliarRegistroEstacao,
  gerarCodigoEstacao,
  gerarTokenEstacao,
  hashTokenEstacao,
  limparTentativas,
  registrarTentativaErrada,
  verificarBloqueioTentativas,
} from "../dominio/estacaoPesagem";

/** Cabeçalho enviado pelo tablet pareado com o código de pareamento guardado nele. */
export const CABECALHO_TOKEN_ESTACAO = "x-estacao-token";

/** Procedimentos do tablet: não usam login de pessoa, e sim o código de pareamento de uma estação ativa. */
const estacaoPareada = publicProcedure.use(async ({ ctx, next }) => {
  const cabecalho = ctx.req.headers?.[CABECALHO_TOKEN_ESTACAO];
  const token = Array.isArray(cabecalho) ? cabecalho[0] : cabecalho;
  if (!token) throw new TRPCError({ code: "UNAUTHORIZED", message: "Este tablet ainda não foi pareado como estação de pesagem." });
  const db = await getDb();
  const encontrada = await db.select().from(estacoesPesagem).where(eq(estacoesPesagem.tokenHash, hashTokenEstacao(token))).limit(1);
  const estacao = encontrada[0];
  if (!estacao || !estacao.ativo) throw new TRPCError({ code: "UNAUTHORIZED", message: "Código de pareamento inválido ou estação desativada. Peça um novo código ao administrador." });
  return next({ ctx: { ...ctx, estacao } });
});

const codigoInput = z.string().trim().regex(/^\d{6}$/, "Digite os 6 números do código gerado no aplicativo.");

/** Encontra o morador dono de um código temporário válido; conta a tentativa errada para bloquear chutes no tablet. */
async function moradorPorCodigo(estacao: EstacaoPesagem, codigo: string) {
  try {
    verificarBloqueioTentativas(estacao.id);
  } catch (error) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: error instanceof Error ? error.message : "Tablet bloqueado temporariamente." });
  }
  const db = await getDb();
  const encontrado = await db.select().from(moradores).where(and(
    eq(moradores.condominioId, estacao.condominioId),
    eq(moradores.codigoEstacao, codigo),
    gt(moradores.codigoEstacaoExpiraEm, new Date()),
  )).limit(1);
  const morador = encontrado[0];
  if (!morador || morador.status !== "ativo" || !morador.usuarioId) {
    registrarTentativaErrada(estacao.id);
    throw new TRPCError({ code: "NOT_FOUND", message: "Código inválido ou vencido. Gere um novo código no aplicativo EcoCondo." });
  }
  limparTentativas(estacao.id);
  return { ...morador, usuarioId: morador.usuarioId };
}

function inicioDoDia(data: Date) {
  const inicio = new Date(data);
  inicio.setHours(0, 0, 0, 0);
  return inicio;
}

export const estacoesRouter = router({
  estacoes: router({
    listar: administratorOnly.query(async ({ ctx }) => {
      const db = await getDb();
      const linhas = await db.select().from(estacoesPesagem).where(eq(estacoesPesagem.condominioId, ctx.eco.condominio.id)).orderBy(asc(estacoesPesagem.nome));
      return linhas.map(({ tokenHash: _oculto, ...estacao }) => estacao);
    }),
    /** Cadastra um tablet; o código de pareamento volta só nesta resposta (no banco fica apenas o hash). */
    criar: administratorOnly.input(z.object({
      name: z.string().trim().min(3).max(120),
      location: z.string().trim().min(3).max(200),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const token = gerarTokenEstacao();
      const inserida = await db.insert(estacoesPesagem).values({
        condominioId: ctx.eco.condominio.id,
        nome: input.name,
        local: input.location,
        tokenHash: hashTokenEstacao(token),
        criadoPorId: ctx.user.id,
      }).$returningId();
      await writeAuditLog(db, {
        condominioId: ctx.eco.condominio.id,
        autorId: ctx.user.id,
        tipoEntidade: "estacao",
        entidadeId: inserida[0].id,
        acao: "estacao_cadastrada",
        resumo: `Estação de pesagem "${input.name}" cadastrada (${input.location}).`,
        estadoNovo: { nome: input.name, local: input.location },
      });
      return { id: inserida[0].id, token };
    }),
    /** Gera um novo código de pareamento; o antigo para de funcionar na hora (ex.: tablet perdido ou trocado). */
    novoCodigo: administratorOnly.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const token = gerarTokenEstacao();
      const [resultado] = await db.update(estacoesPesagem).set({ tokenHash: hashTokenEstacao(token), atualizadoEm: new Date() }).where(and(eq(estacoesPesagem.id, input.id), eq(estacoesPesagem.condominioId, ctx.eco.condominio.id)));
      if (!resultado.affectedRows) throw new TRPCError({ code: "NOT_FOUND", message: "Estação não encontrada." });
      await writeAuditLog(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "estacao", entidadeId: input.id, acao: "estacao_novo_codigo", resumo: "Novo código de pareamento gerado; o anterior deixou de valer." });
      return { token };
    }),
    alternar: administratorOnly.input(z.object({ id: z.number().int().positive(), active: z.boolean() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [resultado] = await db.update(estacoesPesagem).set({ ativo: input.active, atualizadoEm: new Date() }).where(and(eq(estacoesPesagem.id, input.id), eq(estacoesPesagem.condominioId, ctx.eco.condominio.id)));
      if (!resultado.affectedRows) throw new TRPCError({ code: "NOT_FOUND", message: "Estação não encontrada." });
      await writeAuditLog(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "estacao", entidadeId: input.id, acao: input.active ? "estacao_ativada" : "estacao_desativada", resumo: input.active ? "Estação de pesagem reativada." : "Estação de pesagem desativada." });
      return { success: true };
    }),
  }),
  estacao: router({
    /** No app do morador: gera o código de 6 dígitos (uso único, vale poucos minutos) para digitar no tablet. */
    gerarCodigo: withProfile.mutation(async ({ ctx }) => {
      if (ctx.eco.perfil.papel !== "morador" || !ctx.eco.morador || ctx.eco.morador.status !== "ativo") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Apenas moradores ativos registram reciclagem na estação." });
      }
      const db = await getDb();
      const expiraEm = new Date(Date.now() + VALIDADE_CODIGO_ESTACAO_MINUTOS * 60_000);
      // Repete em caso (raro) de colisão com o código ativo de outro morador do mesmo condomínio.
      for (let tentativa = 0; tentativa < 5; tentativa += 1) {
        const codigo = gerarCodigoEstacao();
        const emUso = await db.select({ id: moradores.id }).from(moradores).where(and(
          eq(moradores.condominioId, ctx.eco.condominio.id),
          eq(moradores.codigoEstacao, codigo),
          ne(moradores.id, ctx.eco.morador.id),
        )).limit(1);
        if (emUso[0]) continue;
        await db.update(moradores).set({ codigoEstacao: codigo, codigoEstacaoExpiraEm: expiraEm, atualizadoEm: new Date() }).where(eq(moradores.id, ctx.eco.morador.id));
        return { code: codigo, expiresAt: expiraEm };
      }
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível gerar o código agora. Tente de novo." });
    }),
    status: estacaoPareada.query(({ ctx }) => ({ id: ctx.estacao.id, nome: ctx.estacao.nome, local: ctx.estacao.local, limitePorRegistroKg: LIMITE_PESO_POR_REGISTRO_ESTACAO_GRAMAS / 1000 })),
    /** Mostra no tablet de quem é o código, para o morador confirmar antes de pesar (não consome o código). */
    identificar: estacaoPareada.input(z.object({ code: codigoInput })).mutation(async ({ ctx, input }) => {
      const morador = await moradorPorCodigo(ctx.estacao, input.code);
      return { firstName: morador.nome.split(" ")[0], block: morador.bloco, apartment: morador.apartamento };
    }),
    registrar: estacaoPareada.input(z.object({
      code: codigoInput,
      wasteType: z.enum(tiposResiduo),
      weightGrams: z.number().int().min(0).max(LIMITE_PESO_POR_REGISTRO_ESTACAO_GRAMAS * 2),
      imageDataUrl: z.string().min(30, "Tire a foto do visor da balança para registrar.").max(5_500_000),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const estacao = ctx.estacao;
      const morador = await moradorPorCodigo(estacao, input.code);
      const agora = new Date();

      const registrosHoje = await db.select({ pesoGramas: coletas.pesoGramas, concluidaEm: coletas.concluidaEm }).from(coletas).where(and(
        eq(coletas.moradorId, morador.id),
        isNotNull(coletas.estacaoId),
        eq(coletas.status, "concluida"),
        gte(coletas.concluidaEm, inicioDoDia(agora)),
      ));
      const historico = await db.select().from(coletas).where(and(
        eq(coletas.moradorId, morador.id),
        eq(coletas.status, "concluida"),
        eq(coletas.tipoResiduo, input.wasteType),
        or(sql`${coletas.aprovacaoPesoStatus} IS NULL`, ne(coletas.aprovacaoPesoStatus, "rejeitado")),
      )).orderBy(desc(coletas.concluidaEm)).limit(10);
      const pesos = historico.map((registro) => registro.pesoGramas ?? 0);
      const mediaHistoricaGramas = pesos.length ? pesos.reduce((soma, peso) => soma + peso, 0) / pesos.length : 0;

      let motivosRevisao: string[];
      try {
        ({ motivosRevisao } = avaliarRegistroEstacao({ pesoGramas: input.weightGrams, registrosHoje, mediaHistoricaGramas, agora }));
      } catch (error) {
        if (error instanceof LimiteAntifraudeExcedidoError) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        throw error;
      }

      let foto;
      try {
        foto = await salvarImagemBase64(input.imageDataUrl, `coletas/${estacao.condominioId}/estacao-${estacao.id}-${nanoid(8)}`);
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Não foi possível salvar a foto da balança." });
      }

      // Consome o código antes de gravar: dois envios simultâneos com o mesmo código geram um único registro.
      const [consumo] = await db.update(moradores).set({ codigoEstacao: null, codigoEstacaoExpiraEm: null }).where(and(eq(moradores.id, morador.id), eq(moradores.codigoEstacao, input.code)));
      if (!consumo.affectedRows) throw new TRPCError({ code: "CONFLICT", message: "Este código já foi usado. Gere um novo código no aplicativo." });

      const emRevisao = motivosRevisao.length > 0;
      const pontosCalculados = calculateCollectionPoints("concluida", input.wasteType, input.weightGrams);
      const pontos = emRevisao ? 0 : pontosCalculados;
      const inserida = await db.insert(coletas).values({
        condominioId: estacao.condominioId,
        moradorId: morador.id,
        criadoPorId: morador.usuarioId,
        concluidoPorId: morador.usuarioId,
        estacaoId: estacao.id,
        tipoResiduo: input.wasteType,
        bloco: morador.bloco,
        agendadaPara: agora,
        concluidaEm: agora,
        pesoGramas: input.weightGrams,
        pontosConcedidos: pontos,
        status: "concluida",
        observacoes: emRevisao ? `Em revisão: ${motivosRevisao.join("; ")}.` : null,
        chaveFoto: foto.key,
        urlFoto: foto.url,
        pendenteAprovacaoPeso: emRevisao,
        aprovacaoPesoStatus: emRevisao ? "pendente" : null,
      }).$returningId();
      const coletaId = inserida[0].id;
      if (pontos) await db.update(moradores).set({ pontos: sql`${moradores.pontos} + ${pontos}`, atualizadoEm: new Date() }).where(eq(moradores.id, morador.id));
      await db.update(estacoesPesagem).set({ ultimoUsoEm: agora }).where(eq(estacoesPesagem.id, estacao.id));

      const kg = (input.weightGrams / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
      await writeAuditLog(db, {
        condominioId: estacao.condominioId,
        autorId: morador.usuarioId,
        tipoEntidade: "coleta",
        entidadeId: coletaId,
        acao: emRevisao ? "coleta_sinalizada_suspeita" : "registro_estacao",
        resumo: emRevisao
          ? `Registro de ${kg} kg na estação "${estacao.nome}" enviado para revisão (${motivosRevisao.join("; ")}). Pontos retidos até a aprovação.`
          : `Registro de ${kg} kg na estação "${estacao.nome}".`,
        estadoNovo: { estacaoId: estacao.id, moradorId: morador.id, tipoResiduo: input.wasteType, pesoGramas: input.weightGrams, pontosConcedidos: pontos, pontosPendentes: emRevisao ? pontosCalculados : 0, motivosRevisao },
      });
      if (emRevisao) {
        const administradores = await db.select({ usuarioId: perfisAcesso.usuarioId }).from(perfisAcesso).where(and(eq(perfisAcesso.condominioId, estacao.condominioId), eq(perfisAcesso.papel, "administrador")));
        for (const administrador of administradores) {
          await db.insert(notificacoes).values({
            condominioId: estacao.condominioId,
            destinatarioId: administrador.usuarioId,
            coletaId,
            tipo: "sistema",
            titulo: "Registro da estação para conferir",
            mensagem: `Registro de ${kg} kg na estação "${estacao.nome}" (bloco ${morador.bloco}): ${motivosRevisao.join("; ")}. Confira a foto da balança em Coletas > Registros aguardando aprovação.`,
          });
        }
      }
      await db.insert(notificacoes).values({
        condominioId: estacao.condominioId,
        destinatarioId: morador.usuarioId,
        coletaId,
        tipo: "coleta_concluida",
        titulo: emRevisao ? "Registro em conferência" : "Reciclagem registrada",
        mensagem: emRevisao
          ? `Seu registro de ${kg} kg foi recebido e será conferido pela administração. Os pontos entram depois da aprovação.`
          : `Seu registro de ${kg} kg na estação "${estacao.nome}" gerou ${pontos} ponto(s).`,
      });
      return { id: coletaId, pointsAwarded: pontos, pendingApproval: emRevisao, pendingPoints: emRevisao ? pontosCalculados : 0 };
    }),
  }),
});

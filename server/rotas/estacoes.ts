import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import QRCode from "qrcode";
import { and, asc, desc, eq, gt, gte, isNotNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { coletas, estacoesPesagem, moradores, tiposResiduo } from "../../drizzle/schema";
import type { EstacaoPesagem, Morador } from "../../drizzle/schema";
import { rotuloResiduo, residuoNaFrase } from "@shared/rotulos";
import { getDb } from "../db";
import { administratorOnly, withProfile } from "./nucleo";
import { publicProcedure, router } from "../_core/trpc";
import { writeAuditLog } from "../audit";
import { salvarImagemBase64 } from "../storage";
import { calculateCollectionPoints } from "../dominio/regrasColeta";
import { MovimentacaoDuplicadaError, movimentarPontos } from "../pontos";
import { notificarAdministradores, notificarFalhaOperacional, notificarUsuario } from "../notificacoes";
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
    if (registrarTentativaErrada(estacao.id)) {
      await notificarFalhaOperacional("Estação de pesagem bloqueada", `O tablet "${estacao.nome}" (${estacao.local}) recebeu muitos códigos errados seguidos e ficou bloqueado por alguns minutos. Se não foi um morador confuso, confira quem está usando o tablet.`, estacao.condominioId);
    }
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

function formatarKg(pesoGramas: number) {
  return (pesoGramas / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Confere um registro antes de gravar: limites rígidos (bloqueiam) e motivos para a revisão do administrador.
 * No modo demonstração não há sorteio de conferência, para a apresentação ter resultado previsível.
 */
async function avaliarRegistro(estacao: EstacaoPesagem, morador: Morador, tipoResiduo: (typeof tiposResiduo)[number], pesoGramas: number, agora: Date) {
  const db = await getDb();
  const registrosHoje = await db.select({ pesoGramas: coletas.pesoGramas, concluidaEm: coletas.concluidaEm }).from(coletas).where(and(
    eq(coletas.moradorId, morador.id),
    isNotNull(coletas.estacaoId),
    eq(coletas.status, "concluida"),
    gte(coletas.concluidaEm, inicioDoDia(agora)),
  ));
  const historico = await db.select().from(coletas).where(and(
    eq(coletas.moradorId, morador.id),
    eq(coletas.status, "concluida"),
    eq(coletas.tipoResiduo, tipoResiduo),
    or(sql`${coletas.aprovacaoPesoStatus} IS NULL`, ne(coletas.aprovacaoPesoStatus, "rejeitado")),
  )).orderBy(desc(coletas.concluidaEm)).limit(10);
  const pesos = historico.map((registro) => registro.pesoGramas ?? 0);
  const mediaHistoricaGramas = pesos.length ? pesos.reduce((soma, peso) => soma + peso, 0) / pesos.length : 0;
  const { motivosRevisao } = avaliarRegistroEstacao({ pesoGramas, registrosHoje, mediaHistoricaGramas, agora, amostragem: !estacao.modoDemonstracao });
  return { motivosRevisao, pontosCalculados: calculateCollectionPoints("concluida", tipoResiduo, pesoGramas) };
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
    /** Liga o modo demonstração (sem balança real): o peso é digitado como se viesse da balança e a foto do visor fica opcional. */
    definirModoDemonstracao: administratorOnly.input(z.object({ id: z.number().int().positive(), enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [resultado] = await db.update(estacoesPesagem).set({ modoDemonstracao: input.enabled, atualizadoEm: new Date() }).where(and(eq(estacoesPesagem.id, input.id), eq(estacoesPesagem.condominioId, ctx.eco.condominio.id)));
      if (!resultado.affectedRows) throw new TRPCError({ code: "NOT_FOUND", message: "Estação não encontrada." });
      await writeAuditLog(db, {
        condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "estacao", entidadeId: input.id,
        acao: input.enabled ? "estacao_modo_demonstracao_ligado" : "estacao_modo_demonstracao_desligado",
        resumo: input.enabled ? "Modo demonstração ligado: balança simulada, foto opcional e sem sorteio de conferência." : "Modo demonstração desligado: a estação volta a exigir a foto do visor da balança.",
        estadoAnterior: { modoDemonstracao: !input.enabled }, estadoNovo: { modoDemonstracao: input.enabled },
      });
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
        // O código em si não vai para a notificação (ela fica guardada); só o aviso de que há um código válido.
        await notificarUsuario(db, ctx.user.id, { condominioId: ctx.eco.condominio.id, tipo: "codigo_estacao", titulo: "Código da estação disponível", mensagem: `Seu código (e o QR) para a estação de pesagem está na página Coletas e vale até ${expiraEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}. Ele só pode ser usado uma vez.` });
        const qrDataUrl = await QRCode.toDataURL(codigo, { margin: 1, width: 240 });
        return { code: codigo, expiresAt: expiraEm, qrDataUrl };
      }
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível gerar o código agora. Tente de novo." });
    }),
    status: estacaoPareada.query(({ ctx }) => ({ id: ctx.estacao.id, nome: ctx.estacao.nome, local: ctx.estacao.local, limitePorRegistroKg: LIMITE_PESO_POR_REGISTRO_ESTACAO_GRAMAS / 1000, modoDemonstracao: ctx.estacao.modoDemonstracao })),
    /** Mostra no tablet de quem é o código, para o morador confirmar antes de pesar (não consome o código). */
    identificar: estacaoPareada.input(z.object({ code: codigoInput })).mutation(async ({ ctx, input }) => {
      const morador = await moradorPorCodigo(ctx.estacao, input.code);
      return { firstName: morador.nome.split(" ")[0], block: morador.bloco, apartment: morador.apartamento };
    }),
    /**
     * Conferência antes de confirmar: mostra peso, unidade, material e o resultado previsto (pontos na hora, revisão ou bloqueio)
     * sem gravar nada e sem consumir o código. O sorteio de conferência só acontece na confirmação.
     */
    previa: estacaoPareada.input(z.object({
      code: codigoInput,
      wasteType: z.enum(tiposResiduo),
      weightGrams: z.number().int().max(LIMITE_PESO_POR_REGISTRO_ESTACAO_GRAMAS * 2),
    })).mutation(async ({ ctx, input }) => {
      const morador = await moradorPorCodigo(ctx.estacao, input.code);
      const resumo = { estacao: ctx.estacao.nome, morador: morador.nome.split(" ")[0], bloco: morador.bloco, material: rotuloResiduo[input.wasteType], pesoKg: formatarKg(Math.max(0, input.weightGrams)), unidade: "kg", pesagemSimulada: ctx.estacao.modoDemonstracao };
      try {
        const { motivosRevisao, pontosCalculados } = await avaliarRegistro(ctx.estacao, morador, input.wasteType, input.weightGrams, new Date());
        return { ...resumo, bloqueio: null as string | null, pontosPrevistos: pontosCalculados, motivosRevisao, sujeitoASorteio: !ctx.estacao.modoDemonstracao && motivosRevisao.length === 0 };
      } catch (error) {
        if (error instanceof LimiteAntifraudeExcedidoError) return { ...resumo, bloqueio: error.message, pontosPrevistos: 0, motivosRevisao: [] as string[], sujeitoASorteio: false };
        throw error;
      }
    }),
    registrar: estacaoPareada.input(z.object({
      code: codigoInput,
      wasteType: z.enum(tiposResiduo),
      weightGrams: z.number().int().max(LIMITE_PESO_POR_REGISTRO_ESTACAO_GRAMAS * 2),
      imageDataUrl: z.string().max(5_500_000).nullable().optional(),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const estacao = ctx.estacao;
      const simulada = estacao.modoDemonstracao;
      if (!simulada && (!input.imageDataUrl || input.imageDataUrl.length < 30)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Tire a foto do visor da balança para registrar." });
      }
      const morador = await moradorPorCodigo(estacao, input.code);
      const agora = new Date();

      let avaliacao;
      try {
        avaliacao = await avaliarRegistro(estacao, morador, input.wasteType, input.weightGrams, agora);
      } catch (error) {
        if (error instanceof LimiteAntifraudeExcedidoError) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        throw error;
      }
      const { motivosRevisao, pontosCalculados } = avaliacao;

      let foto: { key: string | null; url: string | null } = { key: null, url: null };
      if (input.imageDataUrl) {
        try {
          foto = await salvarImagemBase64(input.imageDataUrl, `coletas/${estacao.condominioId}/estacao-${estacao.id}-${nanoid(8)}`);
        } catch (error) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Não foi possível salvar a foto da balança." });
        }
      }

      const emRevisao = motivosRevisao.length > 0;
      const pontos = emRevisao ? 0 : pontosCalculados;
      const kg = formatarKg(input.weightGrams);
      const observacoes = [simulada ? "Pesagem simulada (modo demonstração)." : null, emRevisao ? `Em revisão: ${motivosRevisao.join("; ")}.` : null].filter(Boolean).join(" ") || null;
      let coletaId = 0;
      let saldo: number | null = null;
      await db.transaction(async (tx) => {
        // Consome o código na mesma transação do registro: dois envios simultâneos com o mesmo código geram um único registro.
        const [consumo] = await tx.update(moradores).set({ codigoEstacao: null, codigoEstacaoExpiraEm: null }).where(and(eq(moradores.id, morador.id), eq(moradores.codigoEstacao, input.code)));
        if (!consumo.affectedRows) throw new TRPCError({ code: "CONFLICT", message: "Este código já foi usado. Gere um novo código no aplicativo." });
        const inserida = await tx.insert(coletas).values({
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
          observacoes,
          chaveFoto: foto.key,
          urlFoto: foto.url,
          pendenteAprovacaoPeso: emRevisao,
          aprovacaoPesoStatus: emRevisao ? "pendente" : null,
          pesagemSimulada: simulada,
        }).$returningId();
        coletaId = inserida[0].id;
        if (pontos) saldo = await movimentarPontos(tx, { condominioId: estacao.condominioId, moradorId: morador.id, tipo: "credito_coleta", pontos, coletaId, autorId: morador.usuarioId, descricao: `Coleta nº ${coletaId} na estação "${estacao.nome}" (${kg} kg${simulada ? ", balança simulada" : ""})` });
        await tx.update(estacoesPesagem).set({ ultimoUsoEm: agora }).where(eq(estacoesPesagem.id, estacao.id));
      }).catch((error: unknown) => {
        if (error instanceof MovimentacaoDuplicadaError) throw new TRPCError({ code: "CONFLICT", message: "Os pontos deste registro já foram lançados." });
        throw error;
      });

      await writeAuditLog(db, {
        condominioId: estacao.condominioId,
        autorId: morador.usuarioId,
        tipoEntidade: "coleta",
        entidadeId: coletaId,
        acao: emRevisao ? "coleta_sinalizada_suspeita" : "registro_estacao",
        resumo: emRevisao
          ? `Registro de ${kg} kg na estação "${estacao.nome}" enviado para revisão (${motivosRevisao.join("; ")}). Pontos retidos até a aprovação.`
          : `Registro de ${kg} kg na estação "${estacao.nome}"${simulada ? " (balança simulada, modo demonstração)" : ""}; ${pontos} ponto(s).`,
        estadoNovo: { estacaoId: estacao.id, moradorId: morador.id, tipoResiduo: input.wasteType, pesoGramas: input.weightGrams, pontosConcedidos: pontos, pontosPendentes: emRevisao ? pontosCalculados : 0, motivosRevisao, pesagemSimulada: simulada },
      });

      const base = { condominioId: estacao.condominioId, coletaId };
      if (emRevisao) {
        const anomalo = motivosRevisao.some((motivo) => motivo.includes("histórico"));
        await notificarAdministradores(db, { ...base, tipo: anomalo ? "peso_suspeito" : "pontos_pendentes", titulo: anomalo ? "Peso suspeito na estação" : "Pontos pendentes de conferência", mensagem: `Registro nº ${coletaId}: ${kg} kg na estação "${estacao.nome}" (bloco ${morador.bloco}). Motivo: ${motivosRevisao.join("; ")}. Confira a foto da balança em Coletas > Registros aguardando aprovação.` });
      } else {
        await notificarAdministradores(db, { ...base, tipo: "coleta_concluida", titulo: "Reciclagem registrada na estação", mensagem: `Registro nº ${coletaId}: ${kg} kg de ${residuoNaFrase[input.wasteType]} na estação "${estacao.nome}" (bloco ${morador.bloco}); ${pontos} ponto(s).` });
      }
      await notificarUsuario(db, morador.usuarioId, { ...base, tipo: "pesagem_registrada", titulo: "Pesagem registrada", mensagem: `A estação "${estacao.nome}" registrou ${kg} kg de ${residuoNaFrase[input.wasteType]} (coleta nº ${coletaId})${simulada ? ", em modo demonstração" : ""}.` });
      if (emRevisao) {
        await notificarUsuario(db, morador.usuarioId, { ...base, tipo: "pontos_pendentes", titulo: "Registro em conferência", mensagem: `Seu registro de ${kg} kg será conferido pela administração. ${pontosCalculados ? `Os ${pontosCalculados} ponto(s) entram depois da aprovação.` : "Material sem pontuação, mas o peso conta nos indicadores depois da aprovação."}` });
      } else {
        await notificarUsuario(db, morador.usuarioId, { ...base, tipo: "coleta_concluida", titulo: "Coleta concluída", mensagem: `Sua coleta nº ${coletaId} foi concluída e já conta nos indicadores do condomínio.` });
        if (pontos) await notificarUsuario(db, morador.usuarioId, { ...base, tipo: "pontos_ganhos", titulo: `+${pontos} ponto(s)`, mensagem: `Você ganhou ${pontos} ponto(s) pela coleta nº ${coletaId}. Saldo atual: ${saldo} ponto(s).` });
      }
      return { id: coletaId, status: "concluida" as const, pointsAwarded: pontos, pendingApproval: emRevisao, pendingPoints: emRevisao ? pontosCalculados : 0, reviewReasons: motivosRevisao, simulated: simulada, weightKg: kg, notificationsSent: true };
    }),
  }),
});

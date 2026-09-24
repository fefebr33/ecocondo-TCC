import { and, asc, desc, eq, gte, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  metasBloco,
  participantesCampanha,
  statusCampanha,
  campanhas,
  avaliacoesColeta,
  statusColeta,
  coletas,
  statusAvaliacao,
  statusOcorrencia,
  ocorrencias,
  pessoas,
  moradores,
  tiposResiduo,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { salvarImagemBase64 } from "../storage";
import { administratorOnly, withProfile } from "./nucleo";
import { router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { calculateComplianceOverview, calculateGoalProgress, compareBlocks, compareBlocksOverTime } from "../dominio/regrasSustentabilidade";
import { pesoConfirmadoGramas } from "../dominio/antifraude";
import { incidentAuditState, writeAuditLog } from "../audit";

const periodInput = z.object({ startDate: z.date().optional(), endDate: z.date().optional() }).optional();
const incidentInput = z.object({
  block: z.string().trim().min(1).max(32),
  wasteType: z.enum(tiposResiduo),
  location: z.string().trim().min(3).max(180),
  description: z.string().trim().min(5).max(1600),
  imageDataUrl: z.string().max(5_500_000).nullable().optional(),
});

function condicoesPeriodo(condominioId: number, periodo?: { startDate?: Date; endDate?: Date }) {
  const condicoes = [eq(coletas.condominioId, condominioId)];
  if (periodo?.startDate) condicoes.push(gte(coletas.agendadaPara, periodo.startDate));
  if (periodo?.endDate) condicoes.push(lte(coletas.agendadaPara, periodo.endDate));
  return condicoes;
}

function paraRegroSustentabilidade(registro: typeof coletas.$inferSelect) {
  return { block: registro.bloco, status: registro.status, scheduledAt: registro.agendadaPara, weightGrams: pesoConfirmadoGramas(registro), wasteType: registro.tipoResiduo };
}

async function saveIncidentImage(imageDataUrl: string | null | undefined, condominioId: number, usuarioId: number) {
  try {
    return await salvarImagemBase64(imageDataUrl, `ocorrencias/${condominioId}/${usuarioId}`);
  } catch (error) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Não foi possível salvar a imagem." });
  }
}

export const sustainabilityRouter = router({
  metas: router({
    listar: withProfile.query(async ({ ctx }) => {
      const db = await getDb();
      const metas = await db.select().from(metasBloco).where(eq(metasBloco.condominioId, ctx.eco.condominio.id)).orderBy(desc(metasBloco.dataFim));
      const registros = await db.select().from(coletas).where(and(eq(coletas.condominioId, ctx.eco.condominio.id), eq(coletas.status, "concluida")));
      const registrosConvertidos = registros.map(paraRegroSustentabilidade);
      return metas.map((meta) => ({ ...meta, ...calculateGoalProgress({ block: meta.bloco, targetKg: meta.metaKg, startDate: meta.dataInicio, endDate: meta.dataFim }, registrosConvertidos) }));
    }),
    criar: administratorOnly.input(z.object({ block: z.string().trim().min(1).max(32), title: z.string().trim().min(3).max(140), targetKg: z.number().int().min(1).max(100000), startDate: z.date(), endDate: z.date() }).refine((input) => input.endDate >= input.startDate, { message: "A data final deve ser posterior à data inicial.", path: ["endDate"] })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const inserida = await db.insert(metasBloco).values({ condominioId: ctx.eco.condominio.id, criadoPorId: ctx.user.id, bloco: input.block, titulo: input.title, metaKg: input.targetKg, dataInicio: input.startDate, dataFim: input.endDate }).returning({ id: metasBloco.id });
      return { id: inserida[0].id };
    }),
    alternar: administratorOnly.input(z.object({ id: z.number().int().positive(), isActive: z.boolean() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      await db.update(metasBloco).set({ ativo: input.isActive, atualizadoEm: new Date() }).where(and(eq(metasBloco.id, input.id), eq(metasBloco.condominioId, ctx.eco.condominio.id)));
      return { success: true };
    }),
  }),
  ocorrencias: router({
    listar: withProfile.query(async ({ ctx }) => {
      const db = await getDb();
      const condicoes = [eq(ocorrencias.condominioId, ctx.eco.condominio.id)];
      if (ctx.eco.perfil.papel === "morador") condicoes.push(eq(ocorrencias.relatorId, ctx.user.id));
      return db.select().from(ocorrencias).where(and(...condicoes)).orderBy(desc(ocorrencias.criadoEm));
    }),
    criar: withProfile.input(incidentInput).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const imagem = await saveIncidentImage(input.imageDataUrl, ctx.eco.condominio.id, ctx.user.id);
      const bloco = ctx.eco.perfil.papel === "morador" && ctx.eco.morador ? ctx.eco.morador.bloco : input.block;
      const inserida = await db.insert(ocorrencias).values({ condominioId: ctx.eco.condominio.id, relatorId: ctx.user.id, bloco, tipoResiduo: input.wasteType, local: input.location, descricao: input.description, chaveImagem: imagem.key, urlImagem: imagem.url }).returning({ id: ocorrencias.id });
      const ocorrenciaId = inserida[0].id;
      await writeAuditLog(db, {
        condominioId: ctx.eco.condominio.id,
        autorId: ctx.user.id,
        tipoEntidade: "ocorrencia",
        entidadeId: ocorrenciaId,
        acao: "ocorrencia_criada",
        resumo: `Ocorrência de ${input.wasteType} registrada no bloco ${bloco}.`,
        estadoNovo: { status: "aberta", bloco, tipoResiduo: input.wasteType, local: input.location, descricao: input.description, hasImage: Boolean(imagem.key) },
      });
      return { id: ocorrenciaId };
    }),
    atualizarStatus: administratorOnly.input(z.object({ id: z.number().int().positive(), status: z.enum(statusOcorrencia), resolutionNote: z.string().trim().max(1600).nullable().optional() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const encontrada = await db.select().from(ocorrencias).where(and(eq(ocorrencias.id, input.id), eq(ocorrencias.condominioId, ctx.eco.condominio.id))).limit(1);
      const ocorrencia = encontrada[0];
      if (!ocorrencia) throw new TRPCError({ code: "NOT_FOUND", message: "Ocorrência não encontrada." });
      const resolvidaEm = input.status === "resolvida" ? new Date() : null;
      const resolvidoPorId = input.status === "resolvida" ? ctx.user.id : null;
      const notaResolucao = input.resolutionNote || null;
      await db.update(ocorrencias).set({ status: input.status, notaResolucao, resolvidoPorId, resolvidaEm, atualizadoEm: new Date() }).where(and(eq(ocorrencias.id, input.id), eq(ocorrencias.condominioId, ctx.eco.condominio.id)));
      const estadoAnterior = incidentAuditState({ status: ocorrencia.status, bloco: ocorrencia.bloco, tipoResiduo: ocorrencia.tipoResiduo, local: ocorrencia.local, descricao: ocorrencia.descricao, notaResolucao: ocorrencia.notaResolucao, resolvidoPorId: ocorrencia.resolvidoPorId, resolvidaEm: ocorrencia.resolvidaEm });
      await writeAuditLog(db, {
        condominioId: ctx.eco.condominio.id,
        autorId: ctx.user.id,
        tipoEntidade: "ocorrencia",
        entidadeId: ocorrencia.id,
        acao: "ocorrencia_atualizada",
        resumo: `Ocorrência atualizada para o status ${input.status}.`,
        estadoAnterior,
        estadoNovo: { ...estadoAnterior, status: input.status, notaResolucao, resolvidoPorId, resolvidaEm },
      });
      return { success: true };
    }),
  }),
  calendario: router({
    eventos: withProfile.input(periodInput).query(async ({ ctx, input }) => {
      const db = await getDb();
      const condicoes = condicoesPeriodo(ctx.eco.condominio.id, input);
      if (ctx.eco.perfil.papel === "morador") {
        if (!ctx.eco.morador) return [];
        condicoes.push(eq(coletas.moradorId, ctx.eco.morador.id));
      }
      const registros = await db.select().from(coletas).where(and(...condicoes)).orderBy(asc(coletas.agendadaPara));
      return registros.map((registro) => ({ id: registro.id, scheduledAt: registro.agendadaPara, wasteType: registro.tipoResiduo, block: registro.bloco, status: registro.status, isReminder: registro.status === "agendada" || registro.status === "em_andamento" }));
    }),
  }),
  campanhas: router({
    listar: withProfile.query(async ({ ctx }) => {
      const db = await getDb();
      const linhas = await db.select().from(campanhas).where(eq(campanhas.condominioId, ctx.eco.condominio.id)).orderBy(desc(campanhas.dataInicio));
      const participantes = await db.select().from(participantesCampanha);
      return linhas.map((campanha) => ({ ...campanha, participantCount: participantes.filter((item) => item.campanhaId === campanha.id).length, joined: ctx.eco.morador ? participantes.some((item) => item.campanhaId === campanha.id && item.moradorId === ctx.eco.morador?.id) : false }));
    }),
    criar: administratorOnly.input(z.object({ title: z.string().trim().min(3).max(140), description: z.string().trim().min(10).max(1600), targetDescription: z.string().trim().min(3).max(240), startDate: z.date(), endDate: z.date(), status: z.enum(statusCampanha).default("planejada") }).refine((input) => input.endDate >= input.startDate, { message: "A data final deve ser posterior à data inicial.", path: ["endDate"] })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const inserida = await db.insert(campanhas).values({ condominioId: ctx.eco.condominio.id, criadoPorId: ctx.user.id, titulo: input.title, descricao: input.description, descricaoMeta: input.targetDescription, dataInicio: input.startDate, dataFim: input.endDate, status: input.status }).returning({ id: campanhas.id });
      return { id: inserida[0].id };
    }),
    participar: withProfile.input(z.object({ campaignId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (ctx.eco.perfil.papel !== "morador" || !ctx.eco.morador || ctx.eco.morador.status !== "ativo") throw new TRPCError({ code: "FORBIDDEN", message: "Apenas moradores ativos podem participar de campanhas." });
      const campanha = await db.select().from(campanhas).where(and(eq(campanhas.id, input.campaignId), eq(campanhas.condominioId, ctx.eco.condominio.id), eq(campanhas.status, "ativa"))).limit(1);
      if (!campanha[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Campanha ativa não encontrada." });
      await db.insert(participantesCampanha).values({ campanhaId: input.campaignId, moradorId: ctx.eco.morador.id }).onConflictDoUpdate({ target: [participantesCampanha.campanhaId, participantesCampanha.moradorId], set: { entrouEm: new Date() } });
      return { success: true };
    }),
  }),
  avaliacoes: router({
    listar: withProfile.query(async ({ ctx }) => {
      const db = await getDb();
      const condicoes = [eq(avaliacoesColeta.condominioId, ctx.eco.condominio.id)];
      if (ctx.eco.perfil.papel === "morador") {
        if (!ctx.eco.morador) return [];
        condicoes.push(eq(avaliacoesColeta.moradorId, ctx.eco.morador.id));
      }
      return db.select().from(avaliacoesColeta).where(and(...condicoes)).orderBy(desc(avaliacoesColeta.criadoEm));
    }),
    criar: withProfile.input(z.object({ collectionId: z.number().int().positive().nullable().optional(), rating: z.number().int().min(1).max(5), message: z.string().trim().min(5).max(1500) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (ctx.eco.perfil.papel !== "morador" || !ctx.eco.morador) throw new TRPCError({ code: "FORBIDDEN", message: "Apenas moradores podem enviar feedback." });
      const inserida = await db.insert(avaliacoesColeta).values({ condominioId: ctx.eco.condominio.id, moradorId: ctx.eco.morador.id, coletaId: input.collectionId || null, nota: input.rating, mensagem: input.message }).returning({ id: avaliacoesColeta.id });
      return { id: inserida[0].id };
    }),
    responder: administratorOnly.input(z.object({ id: z.number().int().positive(), response: z.string().trim().min(3).max(1500), status: z.enum(statusAvaliacao).default("respondida") })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      await db.update(avaliacoesColeta).set({ resposta: input.response, status: input.status, respondidoPorId: ctx.user.id, respondidaEm: new Date(), atualizadoEm: new Date() }).where(and(eq(avaliacoesColeta.id, input.id), eq(avaliacoesColeta.condominioId, ctx.eco.condominio.id)));
      return { success: true };
    }),
  }),
  conformidade: router({
    visaoGeral: administratorOnly.query(async ({ ctx }) => {
      const db = await getDb();
      const [todosMoradores, todasPessoas, registros, ocorrenciasAbertas, todasAvaliacoes] = await Promise.all([
        db.select().from(moradores).where(eq(moradores.condominioId, ctx.eco.condominio.id)),
        db.select().from(pessoas).where(eq(pessoas.condominioId, ctx.eco.condominio.id)),
        db.select().from(coletas).where(eq(coletas.condominioId, ctx.eco.condominio.id)),
        db.select().from(ocorrencias).where(and(eq(ocorrencias.condominioId, ctx.eco.condominio.id), or(eq(ocorrencias.status, "aberta"), eq(ocorrencias.status, "em_analise")))),
        db.select().from(avaliacoesColeta).where(and(eq(avaliacoesColeta.condominioId, ctx.eco.condominio.id), eq(avaliacoesColeta.status, "nova"))),
      ]);
      return calculateComplianceOverview({
        residents: todosMoradores.map((morador) => ({ email: morador.email })),
        people: todasPessoas.map((pessoa) => ({ accessStatus: pessoa.statusAcesso })),
        collections: registros.map(paraRegroSustentabilidade),
        openIncidents: ocorrenciasAbertas.length,
        pendingFeedback: todasAvaliacoes.length,
        now: new Date(),
      });
    }),
  }),
  comparacao: router({
    porBloco: administratorOnly.input(periodInput).query(async ({ ctx, input }) => {
      const db = await getDb();
      const registros = await db.select().from(coletas).where(and(...condicoesPeriodo(ctx.eco.condominio.id, input)));
      return compareBlocks(registros.map(paraRegroSustentabilidade));
    }),
    linhaDoTempo: administratorOnly.input(periodInput).query(async ({ ctx, input }) => {
      const db = await getDb();
      const registros = await db.select().from(coletas).where(and(...condicoesPeriodo(ctx.eco.condominio.id, input)));
      return compareBlocksOverTime(registros.map(paraRegroSustentabilidade));
    }),
  }),
});

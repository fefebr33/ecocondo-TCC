import { and, asc, count, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
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
  adesivos,
  usuarios,
  categoriasOcorrencia,
  conclusoesOcorrencia,
} from "../../drizzle/schema";
import { normalizarCodigoAdesivo } from "@shared/adesivos";
import { rotuloCategoriaOcorrencia, rotuloConclusaoOcorrencia, rotuloStatusCampanha } from "@shared/rotulos";
import { notificarAdministradores, notificarUsuario } from "../notificacoes";
import { aplicarPenalidade, exigirSemSuspensao } from "../penalidades";
import { anunciarCampanha, indicadoresCampanhas, notificarParticipantes, processarCampanhas } from "../campanhas";
import { abrirAuditoriaColeta, coletaDoCondominio, reverterParaNovaAvaliacao } from "./operacoes";
import { getDb } from "../db";
import { residuoNaFrase, rotuloStatusOcorrencia } from "@shared/rotulos";
import { salvarImagemBase64 } from "../storage";
import { administratorOnly, withProfile } from "./nucleo";
import { router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { calculateComplianceOverview, calculateGoalProgress, compareBlocks, compareBlocksOverTime } from "../dominio/regrasSustentabilidade";
import { pesoConfirmadoGramas } from "../dominio/antifraude";
import { situacaoDescarte } from "@shared/descarte";
import { incidentAuditState, writeAuditLog } from "../audit";

const periodInput = z.object({ startDate: z.date().optional(), endDate: z.date().optional() }).optional();
/** Denúncias falsas do mesmo autor a partir das quais a administração recebe um alerta para avaliar medidas. */
export const LIMITE_DENUNCIAS_FALSAS = 2;

const campanhaInput = z.object({ title: z.string().trim().min(3).max(140), description: z.string().trim().min(10).max(1600), targetDescription: z.string().trim().min(3).max(240), startDate: z.date(), endDate: z.date(), status: z.enum(statusCampanha).default("planejada") });

const incidentInput = z.object({
  category: z.enum(categoriasOcorrencia).default("ambiental"),
  /** Número do descarte ou código do adesivo (EC-XXXX-XXXX) do saco denunciado. */
  reference: z.string().trim().max(40).nullable().optional(),
  block: z.string().trim().min(1).max(32),
  wasteType: z.enum(tiposResiduo),
  location: z.string().trim().min(3).max(180),
  description: z.string().trim().min(5).max(1600),
  imageDataUrl: z.string().max(5_500_000).nullable().optional(),
});

async function ocorrenciaDoCondominio(condominioId: number, id: number) {
  const db = await getDb();
  const [ocorrencia] = await db.select().from(ocorrencias).where(and(eq(ocorrencias.id, id), eq(ocorrencias.condominioId, condominioId))).limit(1);
  if (!ocorrencia) throw new TRPCError({ code: "NOT_FOUND", message: "Ocorrência não encontrada." });
  return ocorrencia;
}

async function campanhaDoCondominio(condominioId: number, id: number) {
  const db = await getDb();
  const [campanha] = await db.select().from(campanhas).where(and(eq(campanhas.id, id), eq(campanhas.condominioId, condominioId), isNull(campanhas.excluidaEm))).limit(1);
  if (!campanha) throw new TRPCError({ code: "NOT_FOUND", message: "Campanha não encontrada." });
  return campanha;
}

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
      const inserida = await db.insert(metasBloco).values({ condominioId: ctx.eco.condominio.id, criadoPorId: ctx.user.id, bloco: input.block, titulo: input.title, metaKg: input.targetKg, dataInicio: input.startDate, dataFim: input.endDate }).$returningId();
      return { id: inserida[0].id };
    }),
    alternar: administratorOnly.input(z.object({ id: z.number().int().positive(), isActive: z.boolean() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      await db.update(metasBloco).set({ ativo: input.isActive, atualizadoEm: new Date() }).where(and(eq(metasBloco.id, input.id), eq(metasBloco.condominioId, ctx.eco.condominio.id)));
      return { success: true };
    }),
  }),
  ocorrencias: router({
    /**
     * Ocorrências e denúncias. O morador vê só as que registrou, sem saber quem é o morador denunciado (LGPD);
     * o administrador vê todas, com o morador envolvido e quantas denúncias falsas o autor já teve.
     */
    listar: withProfile.query(async ({ ctx }) => {
      const db = await getDb();
      const condicoes = [eq(ocorrencias.condominioId, ctx.eco.condominio.id)];
      if (ctx.eco.perfil.papel === "morador") {
        condicoes.push(eq(ocorrencias.relatorId, ctx.user.id));
        const proprias = await db.select().from(ocorrencias).where(and(...condicoes)).orderBy(desc(ocorrencias.criadoEm));
        return proprias.map(({ moradorEnvolvidoId: _oculto, ...ocorrencia }) => ({ ...ocorrencia, moradorEnvolvidoId: null, relator: null, envolvido: null, denunciasFalsasRelator: 0 }));
      }
      const linhas = await db.select().from(ocorrencias).where(and(...condicoes)).orderBy(desc(ocorrencias.criadoEm));
      const pessoasIds = Array.from(new Set(linhas.map((linha) => linha.relatorId)));
      const relatores = pessoasIds.length ? await db.select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios).where(inArray(usuarios.id, pessoasIds)) : [];
      const envolvidosIds = Array.from(new Set(linhas.map((linha) => linha.moradorEnvolvidoId).filter((id): id is number => Boolean(id))));
      const envolvidos = envolvidosIds.length ? await db.select({ id: moradores.id, nome: moradores.nome, bloco: moradores.bloco, apartamento: moradores.apartamento }).from(moradores).where(inArray(moradores.id, envolvidosIds)) : [];
      return linhas.map((linha) => ({
        ...linha,
        relator: relatores.find((item) => item.id === linha.relatorId)?.nome ?? null,
        envolvido: envolvidos.find((item) => item.id === linha.moradorEnvolvidoId) ?? null,
        denunciasFalsasRelator: linhas.filter((outra) => outra.relatorId === linha.relatorId && outra.conclusao === "denuncia_falsa").length,
      }));
    }),
    criar: withProfile.input(incidentInput).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const imagem = await saveIncidentImage(input.imageDataUrl, ctx.eco.condominio.id, ctx.user.id);
      const bloco = ctx.eco.perfil.papel === "morador" && ctx.eco.morador ? ctx.eco.morador.bloco : input.block;
      // Descarte denunciado, pelo número ou pelo código do adesivo visto no saco.
      let coletaId: number | null = null;
      let moradorEnvolvidoId: number | null = null;
      if (input.reference) {
        const codigo = normalizarCodigoAdesivo(input.reference);
        if (codigo) {
          const [adesivo] = await db.select().from(adesivos).where(and(eq(adesivos.codigo, codigo), eq(adesivos.condominioId, ctx.eco.condominio.id))).limit(1);
          if (!adesivo) throw new TRPCError({ code: "BAD_REQUEST", message: `Não existe adesivo ${codigo} neste condomínio. Confira o código.` });
          coletaId = adesivo.coletaId;
          moradorEnvolvidoId = adesivo.moradorId;
        } else {
          const numero = Number(input.reference.replace(/\D/g, ""));
          const [coleta] = numero ? await db.select({ id: coletas.id, moradorId: coletas.moradorId }).from(coletas).where(and(eq(coletas.id, numero), eq(coletas.condominioId, ctx.eco.condominio.id))).limit(1) : [];
          if (!coleta) throw new TRPCError({ code: "BAD_REQUEST", message: "Descarte não encontrado. Informe o número do descarte ou o código do adesivo (EC-XXXX-XXXX)." });
          coletaId = coleta.id;
          moradorEnvolvidoId = coleta.moradorId;
        }
      }
      const inserida = await db.insert(ocorrencias).values({ condominioId: ctx.eco.condominio.id, relatorId: ctx.user.id, bloco, tipoResiduo: input.wasteType, local: input.location, descricao: input.description, chaveImagem: imagem.key, urlImagem: imagem.url, categoria: input.category, coletaId, moradorEnvolvidoId }).$returningId();
      const ocorrenciaId = inserida[0].id;
      await writeAuditLog(db, {
        condominioId: ctx.eco.condominio.id,
        autorId: ctx.user.id,
        tipoEntidade: "ocorrencia",
        entidadeId: ocorrenciaId,
        acao: "ocorrencia_criada",
        resumo: `${rotuloCategoriaOcorrencia[input.category]} registrada (${residuoNaFrase[input.wasteType]}, bloco ${bloco})${coletaId ? ` sobre o descarte nº ${coletaId}` : ""}.`,
        estadoNovo: { status: "aberta", categoria: input.category, bloco, tipoResiduo: input.wasteType, local: input.location, descricao: input.description, hasImage: Boolean(imagem.key), coletaId, moradorEnvolvidoId },
      });
      await notificarAdministradores(db, { condominioId: ctx.eco.condominio.id, coletaId, tipo: "nova_ocorrencia", titulo: `Nova ocorrência: ${rotuloCategoriaOcorrencia[input.category].toLowerCase()}`, mensagem: `Registrada no bloco ${bloco} (${input.location})${coletaId ? `, sobre o descarte nº ${coletaId}` : ""}: ${input.description.slice(0, 240)}` }, ctx.user.id);
      return { id: ocorrenciaId };
    }),
    atualizarStatus: administratorOnly.input(z.object({ id: z.number().int().positive(), status: z.enum(statusOcorrencia), resolutionNote: z.string().trim().max(1600).nullable().optional() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const ocorrencia = await ocorrenciaDoCondominio(ctx.eco.condominio.id, input.id);
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
        resumo: `Ocorrência atualizada para o status "${rotuloStatusOcorrencia[input.status]}".`,
        estadoAnterior,
        estadoNovo: { ...estadoAnterior, status: input.status, notaResolucao, resolvidoPorId, resolvidaEm },
      });
      if (ocorrencia.status !== input.status) await notificarUsuario(db, ocorrencia.relatorId, { condominioId: ctx.eco.condominio.id, tipo: "ocorrencia_atualizada", titulo: `Sua ocorrência nº ${ocorrencia.id}: ${rotuloStatusOcorrencia[input.status].toLowerCase()}`, mensagem: `A administração atualizou a ocorrência que você registrou para "${rotuloStatusOcorrencia[input.status]}".${notaResolucao ? ` ${notaResolucao}` : ""}` });
      return { success: true };
    }),
    /**
     * A partir de uma denúncia, manda o descarte denunciado para nova avaliação (desfaz a aprovação, inclusive a da IA)
     * ou para auditoria. A ocorrência passa a "em análise" ou "em auditoria".
     */
    encaminharDescarte: administratorOnly.input(z.object({
      id: z.number().int().positive(),
      destino: z.enum(["nova_avaliacao", "auditoria"]),
      motivo: z.string().trim().min(10, "Explique o motivo (pelo menos 10 letras).").max(800),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const ocorrencia = await ocorrenciaDoCondominio(ctx.eco.condominio.id, input.id);
      if (!ocorrencia.coletaId) throw new TRPCError({ code: "BAD_REQUEST", message: "Esta ocorrência não está ligada a um descarte." });
      const coleta = await coletaDoCondominio(ctx.eco.condominio.id, ocorrencia.coletaId);
      const situacao = situacaoDescarte(coleta);
      const motivo = `${input.motivo} (ocorrência nº ${ocorrencia.id})`;
      if (input.destino === "auditoria") {
        if (situacao !== "auditoria") await abrirAuditoriaColeta(ctx, coleta, motivo);
      } else if (situacao === "aprovado") {
        await reverterParaNovaAvaliacao(ctx, coleta, motivo);
      } else if (situacao !== "pendente") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Só descartes aprovados voltam para nova avaliação (este já está pendente, reprovado ou em auditoria)." });
      }
      const status = input.destino === "auditoria" ? "em_auditoria" : "em_analise";
      await db.update(ocorrencias).set({ status, atualizadoEm: new Date() }).where(eq(ocorrencias.id, ocorrencia.id));
      await writeAuditLog(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "ocorrencia", entidadeId: ocorrencia.id, acao: "ocorrencia_encaminhada", resumo: `Ocorrência nº ${ocorrencia.id}: descarte nº ${coleta.id} encaminhado para ${input.destino === "auditoria" ? "auditoria" : "nova avaliação"}.`, estadoAnterior: { status: ocorrencia.status, situacaoDescarte: situacao }, estadoNovo: { status }, motivo: input.motivo });
      await notificarUsuario(db, ocorrencia.relatorId, { condominioId: ctx.eco.condominio.id, tipo: "ocorrencia_atualizada", titulo: `Sua ocorrência nº ${ocorrencia.id} está sendo apurada`, mensagem: "A administração está apurando o descarte que você informou. Você será avisado quando houver uma conclusão." });
      return { success: true, status };
    }),
    /**
     * Conclui a ocorrência: procedente, improcedente ou denúncia falsa, com as medidas escolhidas para o morador envolvido
     * (irregularidade confirmada) ou para quem denunciou (denúncia falsa). Denúncias falsas repetidas abrem um alerta de auditoria.
     */
    concluir: administratorOnly.input(z.object({
      id: z.number().int().positive(),
      conclusao: z.enum(conclusoesOcorrencia),
      nota: z.string().trim().min(10, "Escreva a conclusão (pelo menos 10 letras).").max(1600),
      medidasEnvolvido: z.array(z.number().int().positive()).max(5).default([]),
      medidasRelator: z.array(z.number().int().positive()).max(5).default([]),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const ocorrencia = await ocorrenciaDoCondominio(ctx.eco.condominio.id, input.id);
      if (ocorrencia.status === "resolvida") throw new TRPCError({ code: "BAD_REQUEST", message: "Esta ocorrência já foi concluída." });
      if (input.medidasEnvolvido.length && (input.conclusao !== "procedente" || !ocorrencia.moradorEnvolvidoId)) throw new TRPCError({ code: "BAD_REQUEST", message: "Medidas para o morador envolvido só quando a ocorrência é procedente e ligada a um descarte." });
      if (input.medidasRelator.length && input.conclusao !== "denuncia_falsa") throw new TRPCError({ code: "BAD_REQUEST", message: "Medidas para quem denunciou só quando a denúncia é falsa." });
      const agora = new Date();
      const [alteracao] = await db.update(ocorrencias).set({ status: "resolvida", conclusao: input.conclusao, notaResolucao: input.nota, resolvidoPorId: ctx.user.id, resolvidaEm: agora, atualizadoEm: agora }).where(and(eq(ocorrencias.id, ocorrencia.id), ne(ocorrencias.status, "resolvida")));
      if (!alteracao.affectedRows) throw new TRPCError({ code: "CONFLICT", message: "Outro administrador acabou de concluir esta ocorrência." });
      const aplicadas: string[] = [];
      const motivoBase = `Ocorrência nº ${ocorrencia.id} (${rotuloConclusaoOcorrencia[input.conclusao].toLowerCase()}): ${input.nota}`;
      for (const modeloId of Array.from(new Set(input.medidasEnvolvido))) {
        const medida = await aplicarPenalidade(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, moradorId: ocorrencia.moradorEnvolvidoId!, motivo: motivoBase, coletaId: ocorrencia.coletaId, ocorrenciaId: ocorrencia.id, modeloId });
        aplicadas.push(`morador envolvido: ${medida.nome}`);
      }
      const [relatorMorador] = await db.select({ id: moradores.id, nome: moradores.nome, bloco: moradores.bloco }).from(moradores).where(and(eq(moradores.usuarioId, ocorrencia.relatorId), eq(moradores.condominioId, ctx.eco.condominio.id))).limit(1);
      if (input.medidasRelator.length && !relatorMorador) throw new TRPCError({ code: "BAD_REQUEST", message: "Quem registrou a denúncia não é morador; não há medida a aplicar." });
      for (const modeloId of Array.from(new Set(input.medidasRelator))) {
        const medida = await aplicarPenalidade(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, moradorId: relatorMorador!.id, motivo: `Denúncia falsa. ${motivoBase}`, ocorrenciaId: ocorrencia.id, modeloId });
        aplicadas.push(`autor da denúncia: ${medida.nome}`);
      }
      await writeAuditLog(db, {
        condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "ocorrencia", entidadeId: ocorrencia.id,
        acao: input.conclusao === "denuncia_falsa" ? "denuncia_falsa" : "ocorrencia_concluida",
        resumo: `Ocorrência nº ${ocorrencia.id} concluída como ${rotuloConclusaoOcorrencia[input.conclusao].toLowerCase()}${aplicadas.length ? `; medidas: ${aplicadas.join("; ")}` : ""}.`,
        estadoAnterior: { status: ocorrencia.status, conclusao: ocorrencia.conclusao }, estadoNovo: { status: "resolvida", conclusao: input.conclusao, medidas: aplicadas }, motivo: input.nota,
      });
      let denunciasFalsas = 0;
      if (input.conclusao === "denuncia_falsa") {
        const [contagem] = await db.select({ total: count() }).from(ocorrencias).where(and(eq(ocorrencias.condominioId, ctx.eco.condominio.id), eq(ocorrencias.relatorId, ocorrencia.relatorId), eq(ocorrencias.conclusao, "denuncia_falsa")));
        denunciasFalsas = Number(contagem?.total ?? 0);
        if (denunciasFalsas >= LIMITE_DENUNCIAS_FALSAS) {
          const quem = relatorMorador ? `${relatorMorador.nome} (bloco ${relatorMorador.bloco})` : "O mesmo autor";
          await writeAuditLog(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "ocorrencia", entidadeId: ocorrencia.id, acao: "denuncia_falsa_reincidente", resumo: `${quem} já tem ${denunciasFalsas} denúncias falsas; avalie aplicar medidas administrativas.`, estadoNovo: { relatorId: ocorrencia.relatorId, denunciasFalsas } });
          await notificarAdministradores(db, { condominioId: ctx.eco.condominio.id, tipo: "irregularidade_detectada", titulo: "Denúncias falsas repetidas", mensagem: `${quem} já tem ${denunciasFalsas} denúncias consideradas falsas. Avalie aplicar medidas (advertência ou suspensão) pela tela da ocorrência.` });
        }
      }
      // Quem denunciou recebe só a conclusão; as medidas aplicadas a outro morador não são reveladas (LGPD).
      await notificarUsuario(db, ocorrencia.relatorId, { condominioId: ctx.eco.condominio.id, tipo: "ocorrencia_atualizada", titulo: `Ocorrência nº ${ocorrencia.id} concluída`, mensagem: `Conclusão da administração: ${rotuloConclusaoOcorrencia[input.conclusao].toLowerCase()}. ${input.nota}` });
      return { success: true, medidasAplicadas: aplicadas, denunciasFalsasDoAutor: denunciasFalsas };
    }),
  }),
  campanhas: router({
    /** Campanhas (sem as excluídas) com indicadores: participantes, adesão, andamento, dias restantes e resultados. */
    listar: withProfile.query(async ({ ctx }) => {
      const db = await getDb();
      const linhas = await db.select().from(campanhas).where(and(eq(campanhas.condominioId, ctx.eco.condominio.id), isNull(campanhas.excluidaEm))).orderBy(desc(campanhas.dataInicio));
      const indicadores = await indicadoresCampanhas(db, ctx.eco.condominio.id, linhas);
      const minhas = ctx.eco.morador ? await db.select({ campanhaId: participantesCampanha.campanhaId }).from(participantesCampanha).where(eq(participantesCampanha.moradorId, ctx.eco.morador.id)) : [];
      return linhas.map((campanha) => {
        const dados = indicadores.get(campanha.id)!;
        return { ...campanha, participantCount: dados.participantes, joined: minhas.some((item) => item.campanhaId === campanha.id), indicadores: dados };
      });
    }),
    criar: administratorOnly.input(campanhaInput.refine((input) => input.endDate >= input.startDate, { message: "A data final deve ser posterior à data inicial.", path: ["endDate"] })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const inserida = await db.insert(campanhas).values({ condominioId: ctx.eco.condominio.id, criadoPorId: ctx.user.id, titulo: input.title, descricao: input.description, descricaoMeta: input.targetDescription, dataInicio: input.startDate, dataFim: input.endDate, status: input.status }).$returningId();
      const campanha = await campanhaDoCondominio(ctx.eco.condominio.id, inserida[0].id);
      await writeAuditLog(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "campanha", entidadeId: campanha.id, acao: "campanha_criada", resumo: `Campanha "${input.title}" criada (${rotuloStatusCampanha[input.status].toLowerCase()}).`, estadoNovo: { titulo: input.title, status: input.status, dataInicio: input.startDate, dataFim: input.endDate } });
      if (campanha.status === "ativa") await anunciarCampanha(db, campanha, ctx.user.id);
      return { id: campanha.id };
    }),
    atualizar: administratorOnly.input(campanhaInput.omit({ status: true }).extend({ id: z.number().int().positive() }).refine((input) => input.endDate >= input.startDate, { message: "A data final deve ser posterior à data inicial.", path: ["endDate"] })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const campanha = await campanhaDoCondominio(ctx.eco.condominio.id, input.id);
      if (campanha.status === "encerrada") throw new TRPCError({ code: "BAD_REQUEST", message: "Campanhas encerradas não podem ser editadas." });
      const novo = { titulo: input.title, descricao: input.description, descricaoMeta: input.targetDescription, dataInicio: input.startDate, dataFim: input.endDate };
      // Mudou o prazo: o aviso "faltam poucos dias" pode ser enviado de novo.
      await db.update(campanhas).set({ ...novo, avisoEncerrandoEm: campanha.dataFim.getTime() === input.endDate.getTime() ? campanha.avisoEncerrandoEm : null, atualizadoEm: new Date() }).where(eq(campanhas.id, campanha.id));
      const anterior = { titulo: campanha.titulo, descricao: campanha.descricao, descricaoMeta: campanha.descricaoMeta, dataInicio: campanha.dataInicio, dataFim: campanha.dataFim };
      const alterados = (Object.keys(novo) as Array<keyof typeof novo>).filter((campo) => String(novo[campo]) !== String(anterior[campo]));
      await writeAuditLog(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "campanha", entidadeId: campanha.id, acao: "campanha_alterada", resumo: `Campanha "${input.title}" alterada (${alterados.join(", ") || "sem mudanças"}).`, estadoAnterior: anterior, estadoNovo: novo });
      if (alterados.length) await notificarParticipantes(db, campanha, "campanha_atualizada", `Campanha alterada: ${input.title}`, `A administração alterou a campanha "${input.title}". Agora ela vai de ${input.startDate.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} a ${input.endDate.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}. Meta: ${input.targetDescription}.`);
      return { success: true };
    }),
    /** Pausa a campanha (com data para voltar, ou até retomar à mão); os participantes são avisados. */
    pausar: administratorOnly.input(z.object({ id: z.number().int().positive(), ate: z.date().nullable().optional(), motivo: z.string().trim().min(5).max(300) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const campanha = await campanhaDoCondominio(ctx.eco.condominio.id, input.id);
      if (campanha.status !== "ativa") throw new TRPCError({ code: "BAD_REQUEST", message: "Só campanhas ativas podem ser pausadas." });
      if (input.ate && input.ate.getTime() <= Date.now()) throw new TRPCError({ code: "BAD_REQUEST", message: "A data de retorno precisa ser no futuro." });
      const agora = new Date();
      await db.update(campanhas).set({ status: "pausada", pausadaEm: agora, pausadaAte: input.ate ?? null, motivoPausa: input.motivo, atualizadoEm: agora }).where(eq(campanhas.id, campanha.id));
      const ate = input.ate ? ` até ${input.ate.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : "";
      await writeAuditLog(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "campanha", entidadeId: campanha.id, acao: "campanha_pausada", resumo: `Campanha "${campanha.titulo}" pausada${ate}.`, estadoAnterior: { status: campanha.status }, estadoNovo: { status: "pausada", pausadaAte: input.ate ?? null }, motivo: input.motivo });
      await notificarParticipantes(db, campanha, "campanha_pausada", `Campanha pausada: ${campanha.titulo}`, `A campanha "${campanha.titulo}" está pausada${ate || " por enquanto"}. Motivo: ${input.motivo}`);
      return { success: true };
    }),
    retomar: administratorOnly.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const campanha = await campanhaDoCondominio(ctx.eco.condominio.id, input.id);
      if (campanha.status !== "pausada") throw new TRPCError({ code: "BAD_REQUEST", message: "Esta campanha não está pausada." });
      await db.update(campanhas).set({ status: "ativa", pausadaEm: null, pausadaAte: null, motivoPausa: null, atualizadoEm: new Date() }).where(eq(campanhas.id, campanha.id));
      await writeAuditLog(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "campanha", entidadeId: campanha.id, acao: "campanha_retomada", resumo: `Campanha "${campanha.titulo}" retomada.`, estadoAnterior: { status: "pausada" }, estadoNovo: { status: "ativa" } });
      await notificarParticipantes(db, campanha, "campanha_pausada", `Campanha retomada: ${campanha.titulo}`, `A campanha "${campanha.titulo}" voltou a valer.`);
      return { success: true };
    }),
    /** Encerra agora (antes do prazo): resultados vão para os participantes e administradores. */
    encerrar: administratorOnly.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const campanha = await campanhaDoCondominio(ctx.eco.condominio.id, input.id);
      if (campanha.status === "encerrada") throw new TRPCError({ code: "BAD_REQUEST", message: "Esta campanha já foi encerrada." });
      const agora = new Date();
      await db.update(campanhas).set({ dataFim: agora }).where(eq(campanhas.id, campanha.id));
      await writeAuditLog(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "campanha", entidadeId: campanha.id, acao: "campanha_encerrada_manual", resumo: `Campanha "${campanha.titulo}" encerrada antes do prazo pela administração.`, estadoAnterior: { status: campanha.status, dataFim: campanha.dataFim }, estadoNovo: { status: "encerrada", dataFim: agora } });
      await processarCampanhas(db, new Date(agora.getTime() + 1));
      return { success: true };
    }),
    /** Exclui da lista (exclusão lógica: participantes e auditoria ficam guardados); os participantes são avisados. */
    excluir: administratorOnly.input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(5).max(300) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const campanha = await campanhaDoCondominio(ctx.eco.condominio.id, input.id);
      await db.update(campanhas).set({ excluidaEm: new Date(), atualizadoEm: new Date() }).where(eq(campanhas.id, campanha.id));
      await writeAuditLog(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "campanha", entidadeId: campanha.id, acao: "campanha_excluida", resumo: `Campanha "${campanha.titulo}" excluída.`, estadoAnterior: { status: campanha.status, titulo: campanha.titulo }, estadoNovo: { excluida: true }, motivo: input.motivo });
      if (campanha.status !== "encerrada") await notificarParticipantes(db, campanha, "campanha_encerrada", `Campanha cancelada: ${campanha.titulo}`, `A administração cancelou a campanha "${campanha.titulo}". Motivo: ${input.motivo}`);
      return { success: true };
    }),
    participar: withProfile.input(z.object({ campaignId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (ctx.eco.perfil.papel !== "morador" || !ctx.eco.morador || ctx.eco.morador.status !== "ativo") throw new TRPCError({ code: "FORBIDDEN", message: "Apenas moradores ativos podem participar de campanhas." });
      const [campanha] = await db.select().from(campanhas).where(and(eq(campanhas.id, input.campaignId), eq(campanhas.condominioId, ctx.eco.condominio.id), eq(campanhas.status, "ativa"), isNull(campanhas.excluidaEm))).limit(1);
      if (!campanha) throw new TRPCError({ code: "NOT_FOUND", message: "Campanha ativa não encontrada (ela pode estar pausada ou encerrada)." });
      await exigirSemSuspensao(db, ctx.eco.morador.id, "suspensao_campanhas", "participar de campanhas");
      const [jaParticipa] = await db.select({ id: participantesCampanha.id }).from(participantesCampanha).where(and(eq(participantesCampanha.campanhaId, campanha.id), eq(participantesCampanha.moradorId, ctx.eco.morador.id))).limit(1);
      if (jaParticipa) return { success: true };
      await db.insert(participantesCampanha).values({ campanhaId: input.campaignId, moradorId: ctx.eco.morador.id }).onDuplicateKeyUpdate({ set: { entrouEm: new Date() } });
      await notificarUsuario(db, ctx.user.id, { condominioId: ctx.eco.condominio.id, tipo: "campanha_participacao", titulo: `Você entrou na campanha "${campanha.titulo}"`, mensagem: `Sua participação foi registrada. Meta: ${campanha.descricaoMeta}. Vai até ${campanha.dataFim.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}.` });
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
      const inserida = await db.insert(avaliacoesColeta).values({ condominioId: ctx.eco.condominio.id, moradorId: ctx.eco.morador.id, coletaId: input.collectionId || null, nota: input.rating, mensagem: input.message }).$returningId();
      await writeAuditLog(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "avaliacao", entidadeId: inserida[0].id, acao: "feedback_enviado", resumo: `Feedback enviado (nota ${input.rating}).`, estadoNovo: { nota: input.rating, coletaId: input.collectionId ?? null } });
      await notificarAdministradores(db, { condominioId: ctx.eco.condominio.id, coletaId: input.collectionId ?? null, tipo: "novo_feedback", titulo: `Novo feedback (nota ${input.rating})`, mensagem: `${ctx.eco.morador.nome} (bloco ${ctx.eco.morador.bloco}): ${input.message.slice(0, 240)}` });
      return { id: inserida[0].id };
    }),
    responder: administratorOnly.input(z.object({ id: z.number().int().positive(), response: z.string().trim().min(3).max(1500), status: z.enum(statusAvaliacao).default("respondida") })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [avaliacao] = await db.select({ avaliacao: avaliacoesColeta, usuarioId: moradores.usuarioId }).from(avaliacoesColeta).leftJoin(moradores, eq(moradores.id, avaliacoesColeta.moradorId)).where(and(eq(avaliacoesColeta.id, input.id), eq(avaliacoesColeta.condominioId, ctx.eco.condominio.id))).limit(1);
      if (!avaliacao) throw new TRPCError({ code: "NOT_FOUND", message: "Feedback não encontrado." });
      await db.update(avaliacoesColeta).set({ resposta: input.response, status: input.status, respondidoPorId: ctx.user.id, respondidaEm: new Date(), atualizadoEm: new Date() }).where(eq(avaliacoesColeta.id, input.id));
      await writeAuditLog(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "avaliacao", entidadeId: input.id, acao: "feedback_respondido", resumo: "Feedback respondido pela administração.", estadoAnterior: { status: avaliacao.avaliacao.status }, estadoNovo: { status: input.status } });
      await notificarUsuario(db, avaliacao.usuarioId, { condominioId: ctx.eco.condominio.id, tipo: "feedback_respondido", titulo: "A administração respondeu o seu feedback", mensagem: input.response.slice(0, 600) });
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
      return {
        ...calculateComplianceOverview({
          residents: todosMoradores.map((morador) => ({ email: morador.email })),
          people: todasPessoas.map((pessoa) => ({ accessStatus: pessoa.statusAcesso })),
          collections: registros.map(paraRegroSustentabilidade),
          openIncidents: ocorrenciasAbertas.length,
          pendingFeedback: todasAvaliacoes.length,
          now: new Date(),
        }),
        awaitingApproval: registros.filter((registro) => situacaoDescarte(registro) === "pendente").length,
        inAudit: registros.filter((registro) => situacaoDescarte(registro) === "auditoria").length,
      };
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

import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { aplicacoesDescontoPodio, coletas, condominios, moradores, periodosPodio } from "../../drizzle/schema";
import { getDb } from "../db";
import { administratorOnly, withProfile } from "./nucleo";
import { router } from "../_core/trpc";
import { writeAuditLog } from "../audit";
import { pesoConfirmadoGramas } from "../dominio/antifraude";
import { classificarPodio } from "../dominio/regrasPodio";

const periodos = periodosPodio;
type Periodo = (typeof periodos)[number];

/** Soma pontos e peso confirmado de cada morador nas coletas concluídas do período. */
function somarPorMorador(registros: Array<typeof coletas.$inferSelect>) {
  const totais = new Map<number, { moradorId: number; pontos: number; pesoGramas: number }>();
  for (const registro of registros) {
    if (!registro.moradorId) continue;
    const atual = totais.get(registro.moradorId) ?? { moradorId: registro.moradorId, pontos: 0, pesoGramas: 0 };
    atual.pontos += registro.pontosConcedidos;
    atual.pesoGramas += pesoConfirmadoGramas(registro) ?? 0;
    totais.set(registro.moradorId, atual);
  }
  return Array.from(totais.values());
}

/** Calcula o intervalo [inicio, fim] do período de apuração do pódio, a partir de uma data de referência (padrão: hoje). */
function calcularIntervalo(periodo: Periodo, dataReferencia: Date) {
  const ano = dataReferencia.getFullYear();
  if (periodo === "mensal") {
    const mes = dataReferencia.getMonth();
    return { inicio: new Date(ano, mes, 1, 0, 0, 0), fim: new Date(ano, mes + 1, 0, 23, 59, 59) };
  }
  if (periodo === "semestral") {
    const primeiroSemestre = dataReferencia.getMonth() < 6;
    return primeiroSemestre
      ? { inicio: new Date(ano, 0, 1, 0, 0, 0), fim: new Date(ano, 5, 30, 23, 59, 59) }
      : { inicio: new Date(ano, 6, 1, 0, 0, 0), fim: new Date(ano, 11, 31, 23, 59, 59) };
  }
  return { inicio: new Date(ano, 0, 1, 0, 0, 0), fim: new Date(ano, 11, 31, 23, 59, 59) };
}

function campoDescontoPara(periodo: Periodo) {
  if (periodo === "mensal") return "descontoPodioMensalPercentual" as const;
  if (periodo === "semestral") return "descontoPodioSemestralPercentual" as const;
  return "descontoPodioAnualPercentual" as const;
}

export const podioRouter = router({
  podio: router({
    ranking: withProfile.input(z.object({ periodo: z.enum(periodos), dataReferencia: z.date().optional() })).query(async ({ ctx, input }) => {
      const db = await getDb();
      const dataReferencia = input.dataReferencia ?? new Date();
      const { inicio, fim } = calcularIntervalo(input.periodo, dataReferencia);

      const registros = await db.select().from(coletas).where(and(
        eq(coletas.condominioId, ctx.eco.condominio.id),
        eq(coletas.status, "concluida"),
        gte(coletas.concluidaEm, inicio),
        lte(coletas.concluidaEm, fim),
      ));

      const comunidade = await db.select().from(moradores).where(eq(moradores.condominioId, ctx.eco.condominio.id));


      const aplicacoes = await db.select().from(aplicacoesDescontoPodio).where(and(
        eq(aplicacoesDescontoPodio.condominioId, ctx.eco.condominio.id),
        eq(aplicacoesDescontoPodio.periodo, input.periodo),
        eq(aplicacoesDescontoPodio.intervaloInicio, inicio),
      ));

      const moradoresPorId = new Map(comunidade.map((morador) => [morador.id, morador]));
      const ranking = classificarPodio(somarPorMorador(registros).filter((linha) => moradoresPorId.has(linha.moradorId)))
        .map((linha) => {
          const morador = moradoresPorId.get(linha.moradorId)!;
          const aplicacao = aplicacoes.find((item) => item.moradorId === linha.moradorId);
          return {
            position: linha.posicao,
            empatado: linha.empatado,
            moradorId: linha.moradorId,
            nome: morador.nome,
            bloco: morador.bloco,
            apartamento: morador.apartamento,
            pontos: linha.pontos,
            pesoKg: Number((linha.pesoGramas / 1000).toFixed(2)),
            elegivelDesconto: linha.elegivelDesconto,
            descontoAplicado: aplicacao
              ? { percentual: aplicacao.percentualAplicado, aplicadoEm: aplicacao.aplicadoEm, observacao: aplicacao.observacao }
              : null,
          };
        });

      const campoDesconto = campoDescontoPara(input.periodo);
      return {
        periodo: input.periodo,
        intervalo: { inicio, fim },
        ranking,
        descontoSugeridoPercentual: ctx.eco.condominio[campoDesconto] ?? null,
        aplicacaoDoDescontoEManual: true as const,
      };
    }),
    historicoDescontos: withProfile.query(async ({ ctx }) => {
      const db = await getDb();
      const linhas = await db.select({ aplicacao: aplicacoesDescontoPodio, morador: moradores }).from(aplicacoesDescontoPodio)
        .leftJoin(moradores, eq(moradores.id, aplicacoesDescontoPodio.moradorId))
        .where(eq(aplicacoesDescontoPodio.condominioId, ctx.eco.condominio.id))
        .orderBy(desc(aplicacoesDescontoPodio.aplicadoEm));
      return linhas.map(({ aplicacao, morador }) => ({ ...aplicacao, moradorNome: morador?.nome ?? "Morador removido" }));
    }),
    marcarDescontoAplicado: administratorOnly.input(z.object({
      moradorId: z.number().int().positive(),
      periodo: z.enum(periodos),
      dataReferencia: z.date().optional(),
      percentual: z.number().min(0).max(100),
      observacao: z.string().trim().max(500).nullable().optional(),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const dataReferencia = input.dataReferencia ?? new Date();
      const { inicio, fim } = calcularIntervalo(input.periodo, dataReferencia);

      const registros = await db.select().from(coletas).where(and(
        eq(coletas.condominioId, ctx.eco.condominio.id),
        eq(coletas.status, "concluida"),
        gte(coletas.concluidaEm, inicio),
        lte(coletas.concluidaEm, fim),
      ));
      const classificado = classificarPodio(somarPorMorador(registros)).find((linha) => linha.moradorId === input.moradorId);
      const posicao = classificado?.posicao ?? 0;
      if (!classificado?.elegivelDesconto) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Este morador não está entre os três primeiros colocados do período informado." });
      }

      const morador = await db.select().from(moradores).where(and(eq(moradores.id, input.moradorId), eq(moradores.condominioId, ctx.eco.condominio.id))).limit(1);
      if (!morador[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Morador não encontrado." });

      const existente = await db.select().from(aplicacoesDescontoPodio).where(and(
        eq(aplicacoesDescontoPodio.moradorId, input.moradorId),
        eq(aplicacoesDescontoPodio.periodo, input.periodo),
        eq(aplicacoesDescontoPodio.intervaloInicio, inicio),
      )).limit(1);
      if (existente[0]) throw new TRPCError({ code: "CONFLICT", message: "O desconto deste morador já foi registrado como aplicado neste período." });

      const inserido = await db.insert(aplicacoesDescontoPodio).values({
        condominioId: ctx.eco.condominio.id,
        moradorId: input.moradorId,
        periodo: input.periodo,
        intervaloInicio: inicio,
        intervaloFim: fim,
        posicao,
        percentualAplicado: input.percentual,
        observacao: input.observacao || null,
        aplicadoPorId: ctx.user.id,
      }).$returningId();

      await writeAuditLog(db, {
        condominioId: ctx.eco.condominio.id,
        autorId: ctx.user.id,
        tipoEntidade: "desconto_podio",
        entidadeId: inserido[0].id,
        acao: "desconto_podio_aplicado",
        resumo: `Desconto de ${input.percentual}% registrado como aplicado para ${morador[0].nome} (${posicao}º lugar, período ${input.periodo}).`,
        estadoNovo: { moradorId: input.moradorId, periodo: input.periodo, posicao, percentual: input.percentual, observacao: input.observacao || null },
      });

      return { id: inserido[0].id };
    }),
    configurarDescontos: administratorOnly.input(z.object({
      mensal: z.number().min(0).max(100).nullable().optional(),
      semestral: z.number().min(0).max(100).nullable().optional(),
      anual: z.number().min(0).max(100).nullable().optional(),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const atualizacao: Partial<typeof condominios.$inferInsert> = { atualizadoEm: new Date() };
      if (input.mensal !== undefined) atualizacao.descontoPodioMensalPercentual = input.mensal;
      if (input.semestral !== undefined) atualizacao.descontoPodioSemestralPercentual = input.semestral;
      if (input.anual !== undefined) atualizacao.descontoPodioAnualPercentual = input.anual;
      await db.update(condominios).set(atualizacao).where(eq(condominios.id, ctx.eco.condominio.id));
      return { success: true };
    }),
  }),
});

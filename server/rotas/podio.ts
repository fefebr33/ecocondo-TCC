import { and, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { coletas, condominios, moradores } from "../../drizzle/schema";
import { getDb } from "../db";
import { administratorOnly, withProfile } from "./nucleo";
import { router } from "../_core/trpc";

const periodos = ["mensal", "semestral", "anual"] as const;
type Periodo = (typeof periodos)[number];

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

      const totalPorMorador = new Map<number, { pontos: number; pesoGramas: number }>();
      for (const registro of registros) {
        if (!registro.moradorId) continue;
        const atual = totalPorMorador.get(registro.moradorId) ?? { pontos: 0, pesoGramas: 0 };
        atual.pontos += registro.pontosConcedidos;
        atual.pesoGramas += registro.pesoGramas ?? 0;
        totalPorMorador.set(registro.moradorId, atual);
      }

      const ranking = comunidade
        .map((morador) => ({ morador, totais: totalPorMorador.get(morador.id) ?? { pontos: 0, pesoGramas: 0 } }))
        .filter((linha) => linha.totais.pontos > 0)
        .sort((a, b) => b.totais.pontos - a.totais.pontos)
        .map((linha, indice) => ({
          position: indice + 1,
          moradorId: linha.morador.id,
          nome: linha.morador.nome,
          bloco: linha.morador.bloco,
          apartamento: linha.morador.apartamento,
          pontos: linha.totais.pontos,
          pesoKg: Number((linha.totais.pesoGramas / 1000).toFixed(2)),
          elegivelDesconto: indice < 3,
        }));

      const campoDesconto = campoDescontoPara(input.periodo);
      return {
        periodo: input.periodo,
        intervalo: { inicio, fim },
        ranking,
        descontoSugeridoPercentual: ctx.eco.condominio[campoDesconto] ?? null,
        aplicacaoDoDescontoEManual: true as const,
      };
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

import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { coletas, metasPessoais } from "../../drizzle/schema";
import { getDb } from "../db";
import { withProfile } from "./nucleo";
import { router } from "../_core/trpc";
import { calculatePersonalGoalProgress } from "../dominio/metaPessoal";
import { calcularEquivalenciasAmbientais } from "../dominio/impactoAmbiental";

export const personalGoalsRouter = router({
  metaPessoal: router({
    minhas: withProfile.query(async ({ ctx }) => {
      if (!ctx.eco.morador) return [];
      const db = await getDb();
      const metas = await db.select().from(metasPessoais).where(eq(metasPessoais.moradorId, ctx.eco.morador.id)).orderBy(desc(metasPessoais.dataFim));
      const registros = await db.select().from(coletas).where(and(eq(coletas.condominioId, ctx.eco.condominio.id), eq(coletas.moradorId, ctx.eco.morador.id), eq(coletas.status, "concluida")));
      return metas.map((meta) => {
        const progresso = calculatePersonalGoalProgress({ moradorId: meta.moradorId, metaKg: meta.metaKg, dataInicio: meta.dataInicio, dataFim: meta.dataFim }, registros);
        return { ...meta, ...progresso, equivalencias: calcularEquivalenciasAmbientais(progresso.coletadoKg) };
      });
    }),
    definir: withProfile.input(z.object({
      targetKg: z.number().min(0.5).max(2000),
      startDate: z.date(),
      endDate: z.date(),
    }).refine((input) => input.endDate >= input.startDate, { message: "A data final deve ser posterior à data inicial.", path: ["endDate"] })).mutation(async ({ ctx, input }) => {
      if (!ctx.eco.morador) throw new TRPCError({ code: "FORBIDDEN", message: "Apenas moradores podem definir uma meta pessoal." });
      const db = await getDb();
      await db.update(metasPessoais).set({ ativo: false, atualizadoEm: new Date() }).where(and(eq(metasPessoais.moradorId, ctx.eco.morador.id), eq(metasPessoais.ativo, true)));
      const inserida = await db.insert(metasPessoais).values({
        condominioId: ctx.eco.condominio.id,
        moradorId: ctx.eco.morador.id,
        metaKg: input.targetKg,
        dataInicio: input.startDate,
        dataFim: input.endDate,
      }).returning({ id: metasPessoais.id });
      return { id: inserida[0].id };
    }),
    cancelar: withProfile.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      if (!ctx.eco.morador) throw new TRPCError({ code: "FORBIDDEN", message: "Apenas moradores podem cancelar a própria meta." });
      const db = await getDb();
      await db.update(metasPessoais).set({ ativo: false, atualizadoEm: new Date() }).where(and(eq(metasPessoais.id, input.id), eq(metasPessoais.moradorId, ctx.eco.morador.id)));
      return { success: true };
    }),
  }),
});

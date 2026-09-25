import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { regrasRecorrenciaColeta, tiposResiduo } from "../../drizzle/schema";
import { getDb } from "../db";
import { administratorOnly } from "./nucleo";
import { router } from "../_core/trpc";

const horarioRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const recurrenceRouter = router({
  recorrencias: router({
    listar: administratorOnly.query(async ({ ctx }) => {
      const db = await getDb();
      return db.select().from(regrasRecorrenciaColeta).where(eq(regrasRecorrenciaColeta.condominioId, ctx.eco.condominio.id)).orderBy(asc(regrasRecorrenciaColeta.diaSemana));
    }),
    criar: administratorOnly.input(z.object({
      block: z.string().trim().min(1).max(32),
      wasteType: z.enum(tiposResiduo),
      weekday: z.number().int().min(0).max(6),
      time: z.string().regex(horarioRegex, "Informe o horário no formato HH:MM."),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const inserida = await db.insert(regrasRecorrenciaColeta).values({
        condominioId: ctx.eco.condominio.id,
        bloco: input.block,
        tipoResiduo: input.wasteType,
        diaSemana: input.weekday,
        horario: input.time,
        criadoPorId: ctx.user.id,
      }).$returningId();
      return { id: inserida[0].id };
    }),
    alternar: administratorOnly.input(z.object({ id: z.number().int().positive(), isActive: z.boolean() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      await db.update(regrasRecorrenciaColeta).set({ ativo: input.isActive, atualizadoEm: new Date() }).where(and(eq(regrasRecorrenciaColeta.id, input.id), eq(regrasRecorrenciaColeta.condominioId, ctx.eco.condominio.id)));
      return { success: true };
    }),
    remover: administratorOnly.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      await db.delete(regrasRecorrenciaColeta).where(and(eq(regrasRecorrenciaColeta.id, input.id), eq(regrasRecorrenciaColeta.condominioId, ctx.eco.condominio.id)));
      return { success: true };
    }),
  }),
});

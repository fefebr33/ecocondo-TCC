import { and, desc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { tiposEntidadeAuditoria, logsAuditoria, usuarios } from "../../drizzle/schema";
import { getDb } from "../db";
import { administratorOnly } from "./nucleo";
import { router } from "../_core/trpc";

const entradaListagemAuditoria = z.object({
  entityType: z.enum(tiposEntidadeAuditoria).optional(),
  entityId: z.number().int().positive().optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  limit: z.number().int().min(1).max(100).default(50),
}).optional();

function interpretarEstado(valor: string | null) {
  if (!valor) return null;
  try {
    return JSON.parse(valor) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const auditRouter = router({
  auditoria: router({
    listar: administratorOnly.input(entradaListagemAuditoria).query(async ({ ctx, input }) => {
      const db = await getDb();
      const condicoes = [eq(logsAuditoria.condominioId, ctx.eco.condominio.id)];
      if (input?.entityType) condicoes.push(eq(logsAuditoria.tipoEntidade, input.entityType));
      if (input?.entityId) condicoes.push(eq(logsAuditoria.entidadeId, input.entityId));
      if (input?.startDate) condicoes.push(gte(logsAuditoria.criadoEm, input.startDate));
      if (input?.endDate) condicoes.push(lte(logsAuditoria.criadoEm, input.endDate));
      const linhas = await db.select({ registro: logsAuditoria, nomeAutor: usuarios.nome }).from(logsAuditoria).leftJoin(usuarios, eq(usuarios.id, logsAuditoria.autorId)).where(and(...condicoes)).orderBy(desc(logsAuditoria.criadoEm)).limit(input?.limit ?? 50);
      return linhas.map(({ registro, nomeAutor }) => ({ ...registro, actorName: nomeAutor ?? `Usuário #${registro.autorId}`, beforeState: interpretarEstado(registro.estadoAnterior), afterState: interpretarEstado(registro.estadoNovo) }));
    }),
  }),
});

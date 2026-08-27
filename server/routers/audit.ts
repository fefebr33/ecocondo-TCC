import { and, desc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { auditEntityTypes, auditLogs, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { administratorOnly } from "./ecocondo";
import { router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

const auditListInput = z.object({
  entityType: z.enum(auditEntityTypes).optional(),
  entityId: z.number().int().positive().optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  limit: z.number().int().min(1).max(100).default(50),
}).optional();

function parseState(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const auditRouter = router({
  audit: router({
    list: administratorOnly.input(auditListInput).query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      const conditions = [eq(auditLogs.condominiumId, ctx.eco.condominium.id)];
      if (input?.entityType) conditions.push(eq(auditLogs.entityType, input.entityType));
      if (input?.entityId) conditions.push(eq(auditLogs.entityId, input.entityId));
      if (input?.startDate) conditions.push(gte(auditLogs.createdAt, input.startDate));
      if (input?.endDate) conditions.push(lte(auditLogs.createdAt, input.endDate));
      const rows = await db.select({ entry: auditLogs, actorName: users.name }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorUserId)).where(and(...conditions)).orderBy(desc(auditLogs.createdAt)).limit(input?.limit ?? 50);
      return rows.map(({ entry, actorName }) => ({ ...entry, actorName: actorName ?? `Usuário #${entry.actorUserId}`, beforeState: parseState(entry.beforeState), afterState: parseState(entry.afterState) }));
    }),
  }),
});

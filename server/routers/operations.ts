import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { collections, collectionStatuses, notifications, people, residents, residentStatuses, userProfiles, users, wasteTypes } from "../../drizzle/schema";
import { getDb } from "../db";
import { administratorOnly, staffOnly, withProfile } from "./ecocondo";
import { router } from "../_core/trpc";
import { prepareCollectionCompletion, resolveCollectorAssignment } from "../domain/collectionRules";
import { buildPendingResidentPerson } from "../domain/peopleRules";
import { collectionAuditState, writeAuditLog } from "../audit";

const residentInput = z.object({
  name: z.string().trim().min(3).max(180),
  email: z.string().trim().email().max(320).nullable().optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  block: z.string().trim().min(1).max(32),
  apartment: z.string().trim().min(1).max(32),
  status: z.enum(residentStatuses).default("ativo"),
});

const collectionFilters = z.object({
  wasteType: z.enum(wasteTypes).optional(),
  block: z.string().trim().max(32).optional(),
  status: z.enum(collectionStatuses).optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
});

export const operationsRouter = router({
  residents: router({
    list: administratorOnly.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      return db.select().from(residents).where(eq(residents.condominiumId, ctx.eco.condominium.id)).orderBy(asc(residents.name));
    }),
    create: administratorOnly.input(residentInput).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      const inserted = await db.insert(residents).values({
        condominiumId: ctx.eco.condominium.id,
        ...input,
        email: input.email || null,
        phone: input.phone || null,
      });
      return { id: Number(inserted[0].insertId) };
    }),
    update: administratorOnly.input(residentInput.partial().extend({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      const { id, ...update } = input;
      const existing = await db.select().from(residents).where(and(eq(residents.id, id), eq(residents.condominiumId, ctx.eco.condominium.id))).limit(1);
      if (!existing[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Morador não encontrado." });
      const nextEmail = update.email === undefined ? existing[0].email : update.email || null;
      const nextPhone = update.phone === undefined ? existing[0].phone : update.phone || null;
      await db.update(residents).set({ ...update, email: nextEmail, phone: nextPhone }).where(eq(residents.id, id));
      const person = await db.select().from(people).where(eq(people.residentId, id)).limit(1);
      if (person[0]) {
        await db.update(people).set({ name: update.name ?? existing[0].name, email: nextEmail || person[0].email, phone: nextPhone, block: update.block ?? existing[0].block, apartment: update.apartment ?? existing[0].apartment }).where(eq(people.id, person[0].id));
      } else if (nextEmail) {
        await db.insert(people).values({ condominiumId: ctx.eco.condominium.id, ...buildPendingResidentPerson({ id, userId: existing[0].userId, name: update.name ?? existing[0].name, email: nextEmail, phone: nextPhone, block: update.block ?? existing[0].block, apartment: update.apartment ?? existing[0].apartment }) });
      }
      return { success: true };
    }),
  }),
  collections: router({
    list: withProfile.input(collectionFilters.optional()).query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      const conditions = [eq(collections.condominiumId, ctx.eco.condominium.id)];
      if (ctx.eco.profile.role === "morador") {
        if (!ctx.eco.resident) return [];
        conditions.push(eq(collections.residentId, ctx.eco.resident.id));
      }
      if (input?.wasteType) conditions.push(eq(collections.wasteType, input.wasteType));
      if (input?.block) conditions.push(eq(collections.block, input.block));
      if (input?.status) conditions.push(eq(collections.status, input.status));
      if (input?.startDate) conditions.push(gte(collections.scheduledAt, input.startDate));
      if (input?.endDate) conditions.push(lte(collections.scheduledAt, input.endDate));

      const records = await db.select().from(collections).where(and(...conditions)).orderBy(desc(collections.scheduledAt));
      const residentIds = Array.from(new Set(records.map((record) => record.residentId).filter((id): id is number => id !== null)));
      const relatedResidents = residentIds.length
        ? await db.select().from(residents).where(and(eq(residents.condominiumId, ctx.eco.condominium.id)))
        : [];
      const collectorProfiles = await db.select({ userId: userProfiles.userId, role: userProfiles.role, name: users.name }).from(userProfiles).leftJoin(users, eq(users.id, userProfiles.userId)).where(eq(userProfiles.condominiumId, ctx.eco.condominium.id));
      return records.map((record) => ({
        ...record,
        residentName: relatedResidents.find((resident) => resident.id === record.residentId)?.name ?? null,
        collectorName: collectorProfiles.find((profile) => profile.userId === record.collectorUserId)?.name ?? null,
      }));
    }),
    create: withProfile.input(z.object({
      residentId: z.number().int().positive().nullable().optional(),
      wasteType: z.enum(wasteTypes),
      block: z.string().trim().min(1).max(32),
      scheduledAt: z.date(),
      collectorUserId: z.number().int().positive().nullable().optional(),
      notes: z.string().trim().max(1200).nullable().optional(),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      let residentId = input.residentId ?? null;
      let block = input.block;
      let collectorUserId = resolveCollectorAssignment(ctx.eco.profile.role, ctx.user.id, input.collectorUserId);

      if (ctx.eco.profile.role === "morador") {
        if (!ctx.eco.resident || ctx.eco.resident.status !== "ativo") throw new TRPCError({ code: "FORBIDDEN", message: "O perfil do morador não está habilitado para solicitar coletas." });
        residentId = ctx.eco.resident.id;
        block = ctx.eco.resident.block;
      }
      if (ctx.eco.profile.role === "administrador" && collectorUserId) {
        const collectorProfile = await db.select().from(userProfiles).where(and(eq(userProfiles.userId, collectorUserId), eq(userProfiles.condominiumId, ctx.eco.condominium.id))).limit(1);
        if (!collectorProfile[0] || collectorProfile[0].role !== "coletor") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Selecione um usuário com perfil de coletor para assumir a coleta." });
        }
      }

      let resident = null;
      if (residentId) {
        const found = await db.select().from(residents).where(and(eq(residents.id, residentId), eq(residents.condominiumId, ctx.eco.condominium.id))).limit(1);
        resident = found[0] ?? null;
        if (!resident) throw new TRPCError({ code: "NOT_FOUND", message: "Morador não encontrado neste condomínio." });
      }

      const inserted = await db.insert(collections).values({
        condominiumId: ctx.eco.condominium.id,
        residentId,
        createdByUserId: ctx.user.id,
        collectorUserId,
        wasteType: input.wasteType,
        block,
        scheduledAt: input.scheduledAt,
        notes: input.notes || null,
      });
      const collectionId = Number(inserted[0].insertId);
      await writeAuditLog(db, {
        condominiumId: ctx.eco.condominium.id,
        actorUserId: ctx.user.id,
        entityType: "coleta",
        entityId: collectionId,
        action: "coleta_criada",
        summary: `Coleta de ${input.wasteType} criada para o bloco ${block}.`,
        afterState: { status: "agendada", wasteType: input.wasteType, block, scheduledAt: input.scheduledAt, residentId, collectorUserId, notes: input.notes || null },
      });
      if (resident?.userId) {
        await db.insert(notifications).values({
          condominiumId: ctx.eco.condominium.id,
          recipientUserId: resident.userId,
          collectionId,
          kind: "coleta_agendada",
          title: "Coleta agendada",
          message: `Uma coleta de ${input.wasteType} foi agendada para o bloco ${block}.`,
        });
      }
      if (collectorUserId && collectorUserId !== ctx.user.id) {
        await db.insert(notifications).values({
          condominiumId: ctx.eco.condominium.id,
          recipientUserId: collectorUserId,
          collectionId,
          kind: "coleta_agendada",
          title: "Coleta atribuída",
          message: `Você foi designado para uma coleta de ${input.wasteType} no bloco ${block}.`,
        });
      }
      return { id: collectionId };
    }),
    updateStatus: staffOnly.input(z.object({
      id: z.number().int().positive(),
      status: z.enum(collectionStatuses),
      weightGrams: z.number().int().min(0).max(500000).nullable().optional(),
      notes: z.string().trim().max(1200).nullable().optional(),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      const found = await db.select().from(collections).where(and(eq(collections.id, input.id), eq(collections.condominiumId, ctx.eco.condominium.id))).limit(1);
      const collection = found[0];
      if (!collection) throw new TRPCError({ code: "NOT_FOUND", message: "Coleta não encontrada." });
      let completion;
      try {
        completion = prepareCollectionCompletion(input, collection);
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Não foi possível concluir a coleta." });
      }
      const nextWeight = completion.weightGrams;
      const nextAward = completion.pointsAwarded;
      const pointDelta = nextAward - collection.pointsAwarded;
      const completedAt = completion.completedAt ? new Date() : null;
      await db.update(collections).set({
        status: input.status,
        weightGrams: nextWeight,
        pointsAwarded: nextAward,
        completedAt,
        collectorUserId: collection.collectorUserId ?? ctx.user.id,
        notes: completion.notes,
      }).where(eq(collections.id, collection.id));
      await writeAuditLog(db, {
        condominiumId: ctx.eco.condominium.id,
        actorUserId: ctx.user.id,
        entityType: "coleta",
        entityId: collection.id,
        action: "coleta_atualizada",
        summary: `Coleta atualizada para o status ${input.status}.`,
        beforeState: collectionAuditState(collection),
        afterState: {
          status: input.status,
          weightGrams: nextWeight,
          pointsAwarded: nextAward,
          collectorUserId: collection.collectorUserId ?? ctx.user.id,
          completedAt,
          notes: completion.notes,
        },
      });

      if (collection.residentId && pointDelta !== 0) {
        await db.update(residents).set({ points: sql`${residents.points} + ${pointDelta}` }).where(eq(residents.id, collection.residentId));
      }
      if (collection.residentId) {
        const resident = await db.select().from(residents).where(eq(residents.id, collection.residentId)).limit(1);
        if (resident[0]?.userId) {
          await db.insert(notifications).values({
            condominiumId: ctx.eco.condominium.id,
            recipientUserId: resident[0].userId,
            collectionId: collection.id,
            kind: input.status === "concluida" ? "coleta_concluida" : "sistema",
            title: input.status === "concluida" ? "Coleta concluída" : "Atualização de coleta",
            message: input.status === "concluida" ? `Sua coleta foi concluída${nextAward ? ` e gerou ${nextAward} ponto(s).` : "."}` : `O status da sua coleta foi atualizado para ${input.status}.`,
          });
        }
      }
      return { success: true, pointsAwarded: nextAward };
    }),
  }),
});

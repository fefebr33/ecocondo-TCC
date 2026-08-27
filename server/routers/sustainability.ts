import { and, asc, desc, eq, gte, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  blockGoals,
  campaignParticipants,
  campaignStatuses,
  campaigns,
  collectionFeedback,
  collectionStatuses,
  collections,
  feedbackStatuses,
  incidentStatuses,
  incidents,
  people,
  residents,
  wasteTypes,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { storagePut } from "../storage";
import { administratorOnly, withProfile } from "./ecocondo";
import { router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { calculateComplianceOverview, calculateGoalProgress, compareBlocks, compareBlocksOverTime } from "../domain/sustainabilityRules";

const periodInput = z.object({ startDate: z.date().optional(), endDate: z.date().optional() }).optional();
const incidentInput = z.object({
  block: z.string().trim().min(1).max(32),
  wasteType: z.enum(wasteTypes),
  location: z.string().trim().min(3).max(180),
  description: z.string().trim().min(5).max(1600),
  imageDataUrl: z.string().max(5_500_000).nullable().optional(),
});

function getPeriodConditions(condominiumId: number, period?: { startDate?: Date; endDate?: Date }) {
  const conditions = [eq(collections.condominiumId, condominiumId)];
  if (period?.startDate) conditions.push(gte(collections.scheduledAt, period.startDate));
  if (period?.endDate) conditions.push(lte(collections.scheduledAt, period.endDate));
  return conditions;
}

async function saveIncidentImage(imageDataUrl: string | null | undefined, condominiumId: number, userId: number) {
  if (!imageDataUrl) return { key: null, url: null };
  const match = imageDataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new TRPCError({ code: "BAD_REQUEST", message: "Envie uma imagem PNG, JPEG ou WebP válida." });
  const subtype = match[1] === "jpg" ? "jpeg" : match[1];
  const extension = subtype === "jpeg" ? "jpg" : subtype;
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > 4 * 1024 * 1024) throw new TRPCError({ code: "BAD_REQUEST", message: "A imagem deve ter no máximo 4 MB." });
  const key = `incidents/${condominiumId}/${userId}/${Date.now()}.${extension}`;
  return storagePut(key, bytes, `image/${subtype}`);
}

export const sustainabilityRouter = router({
  goals: router({
    list: withProfile.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      const goals = await db.select().from(blockGoals).where(eq(blockGoals.condominiumId, ctx.eco.condominium.id)).orderBy(desc(blockGoals.endDate));
      const records = await db.select().from(collections).where(and(eq(collections.condominiumId, ctx.eco.condominium.id), eq(collections.status, "concluida")));
      return goals.map((goal) => ({ ...goal, ...calculateGoalProgress(goal, records) }));
    }),
    create: administratorOnly.input(z.object({ block: z.string().trim().min(1).max(32), title: z.string().trim().min(3).max(140), targetKg: z.number().int().min(1).max(100000), startDate: z.date(), endDate: z.date() }).refine((input) => input.endDate >= input.startDate, { message: "A data final deve ser posterior à data inicial.", path: ["endDate"] })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      const inserted = await db.insert(blockGoals).values({ condominiumId: ctx.eco.condominium.id, createdByUserId: ctx.user.id, ...input });
      return { id: Number(inserted[0].insertId) };
    }),
    toggle: administratorOnly.input(z.object({ id: z.number().int().positive(), isActive: z.boolean() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      await db.update(blockGoals).set({ isActive: input.isActive }).where(and(eq(blockGoals.id, input.id), eq(blockGoals.condominiumId, ctx.eco.condominium.id)));
      return { success: true };
    }),
  }),
  incidents: router({
    list: withProfile.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      const conditions = [eq(incidents.condominiumId, ctx.eco.condominium.id)];
      if (ctx.eco.profile.role === "morador") conditions.push(eq(incidents.reporterUserId, ctx.user.id));
      return db.select().from(incidents).where(and(...conditions)).orderBy(desc(incidents.createdAt));
    }),
    create: withProfile.input(incidentInput).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      const image = await saveIncidentImage(input.imageDataUrl, ctx.eco.condominium.id, ctx.user.id);
      const inserted = await db.insert(incidents).values({ condominiumId: ctx.eco.condominium.id, reporterUserId: ctx.user.id, block: ctx.eco.profile.role === "morador" && ctx.eco.resident ? ctx.eco.resident.block : input.block, wasteType: input.wasteType, location: input.location, description: input.description, imageKey: image.key, imageUrl: image.url });
      return { id: Number(inserted[0].insertId) };
    }),
    updateStatus: administratorOnly.input(z.object({ id: z.number().int().positive(), status: z.enum(incidentStatuses), resolutionNote: z.string().trim().max(1600).nullable().optional() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      await db.update(incidents).set({ status: input.status, resolutionNote: input.resolutionNote || null, resolvedByUserId: input.status === "resolvida" ? ctx.user.id : null, resolvedAt: input.status === "resolvida" ? new Date() : null }).where(and(eq(incidents.id, input.id), eq(incidents.condominiumId, ctx.eco.condominium.id)));
      return { success: true };
    }),
  }),
  calendar: router({
    events: withProfile.input(periodInput).query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      const conditions = getPeriodConditions(ctx.eco.condominium.id, input);
      if (ctx.eco.profile.role === "morador") {
        if (!ctx.eco.resident) return [];
        conditions.push(eq(collections.residentId, ctx.eco.resident.id));
      }
      const records = await db.select().from(collections).where(and(...conditions)).orderBy(asc(collections.scheduledAt));
      return records.map((record) => ({ id: record.id, scheduledAt: record.scheduledAt, wasteType: record.wasteType, block: record.block, status: record.status, isReminder: record.status === "agendada" || record.status === "em_andamento" }));
    }),
  }),
  campaigns: router({
    list: withProfile.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      const rows = await db.select().from(campaigns).where(eq(campaigns.condominiumId, ctx.eco.condominium.id)).orderBy(desc(campaigns.startDate));
      const participants = await db.select().from(campaignParticipants);
      return rows.map((campaign) => ({ ...campaign, participantCount: participants.filter((item) => item.campaignId === campaign.id).length, joined: ctx.eco.resident ? participants.some((item) => item.campaignId === campaign.id && item.residentId === ctx.eco.resident?.id) : false }));
    }),
    create: administratorOnly.input(z.object({ title: z.string().trim().min(3).max(140), description: z.string().trim().min(10).max(1600), targetDescription: z.string().trim().min(3).max(240), startDate: z.date(), endDate: z.date(), status: z.enum(campaignStatuses).default("planejada") }).refine((input) => input.endDate >= input.startDate, { message: "A data final deve ser posterior à data inicial.", path: ["endDate"] })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      const inserted = await db.insert(campaigns).values({ condominiumId: ctx.eco.condominium.id, createdByUserId: ctx.user.id, ...input });
      return { id: Number(inserted[0].insertId) };
    }),
    join: withProfile.input(z.object({ campaignId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      if (ctx.eco.profile.role !== "morador" || !ctx.eco.resident || ctx.eco.resident.status !== "ativo") throw new TRPCError({ code: "FORBIDDEN", message: "Apenas moradores ativos podem participar de campanhas." });
      const campaign = await db.select().from(campaigns).where(and(eq(campaigns.id, input.campaignId), eq(campaigns.condominiumId, ctx.eco.condominium.id), eq(campaigns.status, "ativa"))).limit(1);
      if (!campaign[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Campanha ativa não encontrada." });
      await db.insert(campaignParticipants).values({ campaignId: input.campaignId, residentId: ctx.eco.resident.id }).onDuplicateKeyUpdate({ set: { joinedAt: new Date() } });
      return { success: true };
    }),
  }),
  feedback: router({
    list: withProfile.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      const conditions = [eq(collectionFeedback.condominiumId, ctx.eco.condominium.id)];
      if (ctx.eco.profile.role === "morador") {
        if (!ctx.eco.resident) return [];
        conditions.push(eq(collectionFeedback.residentId, ctx.eco.resident.id));
      }
      return db.select().from(collectionFeedback).where(and(...conditions)).orderBy(desc(collectionFeedback.createdAt));
    }),
    create: withProfile.input(z.object({ collectionId: z.number().int().positive().nullable().optional(), rating: z.number().int().min(1).max(5), message: z.string().trim().min(5).max(1500) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      if (ctx.eco.profile.role !== "morador" || !ctx.eco.resident) throw new TRPCError({ code: "FORBIDDEN", message: "Apenas moradores podem enviar feedback." });
      const inserted = await db.insert(collectionFeedback).values({ condominiumId: ctx.eco.condominium.id, residentId: ctx.eco.resident.id, collectionId: input.collectionId || null, rating: input.rating, message: input.message });
      return { id: Number(inserted[0].insertId) };
    }),
    respond: administratorOnly.input(z.object({ id: z.number().int().positive(), response: z.string().trim().min(3).max(1500), status: z.enum(feedbackStatuses).default("respondido") })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      await db.update(collectionFeedback).set({ response: input.response, status: input.status, respondedByUserId: ctx.user.id, respondedAt: new Date() }).where(and(eq(collectionFeedback.id, input.id), eq(collectionFeedback.condominiumId, ctx.eco.condominium.id)));
      return { success: true };
    }),
  }),
  compliance: router({
    overview: administratorOnly.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      const [allResidents, allPeople, records, openIncidents, allFeedback] = await Promise.all([
        db.select().from(residents).where(eq(residents.condominiumId, ctx.eco.condominium.id)),
        db.select().from(people).where(eq(people.condominiumId, ctx.eco.condominium.id)),
        db.select().from(collections).where(eq(collections.condominiumId, ctx.eco.condominium.id)),
        db.select().from(incidents).where(and(eq(incidents.condominiumId, ctx.eco.condominium.id), or(eq(incidents.status, "aberta"), eq(incidents.status, "em_analise")))),
        db.select().from(collectionFeedback).where(and(eq(collectionFeedback.condominiumId, ctx.eco.condominium.id), eq(collectionFeedback.status, "novo"))),
      ]);
      return calculateComplianceOverview({ residents: allResidents, people: allPeople, collections: records, openIncidents: openIncidents.length, pendingFeedback: allFeedback.length, now: new Date() });
    }),
  }),
  comparison: router({
    byBlock: administratorOnly.input(periodInput).query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      const records = await db.select().from(collections).where(and(...getPeriodConditions(ctx.eco.condominium.id, input)));
      return compareBlocks(records);
    }),
    timeline: administratorOnly.input(periodInput).query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      const records = await db.select().from(collections).where(and(...getPeriodConditions(ctx.eco.condominium.id, input)));
      return compareBlocksOverTime(records);
    }),
  }),
});

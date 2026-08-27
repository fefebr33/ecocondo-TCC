import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { and, asc, desc, eq, gte, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { collections, disposalGuides, notificationReads, notifications, residents, rewards, redemptions, userProfiles, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { administratorOnly, withProfile } from "./ecocondo";
import { router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { countUnreadNotifications } from "../domain/notificationRules";
import { buildCollectionsCsv } from "../domain/csvExport";

const periodInput = z.object({ startDate: z.date().optional(), endDate: z.date().optional() }).optional();

function periodConditions(condominiumId: number, period?: { startDate?: Date; endDate?: Date }) {
  const conditions = [eq(collections.condominiumId, condominiumId)];
  if (period?.startDate) conditions.push(gte(collections.scheduledAt, period.startDate));
  if (period?.endDate) conditions.push(lte(collections.scheduledAt, period.endDate));
  return conditions;
}

function summarize(records: Array<typeof collections.$inferSelect>) {
  const completed = records.filter((record) => record.status === "concluida");
  const totalGrams = completed.reduce((sum, record) => sum + (record.weightGrams ?? 0), 0);
  const recyclableGrams = completed.filter((record) => record.wasteType === "reciclavel").reduce((sum, record) => sum + (record.weightGrams ?? 0), 0);
  const totalKg = totalGrams / 1000;
  const recyclableKg = recyclableGrams / 1000;
  const recyclingRate = totalGrams > 0 ? Number(((recyclableGrams / totalGrams) * 100).toFixed(1)) : null;
  const co2EstimateKg = Number((recyclableKg * 0.75).toFixed(1));
  const byWasteType = ["reciclavel", "organico", "rejeito", "eletronico", "perigoso"].map((wasteType) => ({
    wasteType,
    kilograms: Number((completed.filter((record) => record.wasteType === wasteType).reduce((sum, record) => sum + (record.weightGrams ?? 0), 0) / 1000).toFixed(2)),
  }));
  return { totalKg: Number(totalKg.toFixed(2)), recyclableKg: Number(recyclableKg.toFixed(2)), recyclingRate, co2EstimateKg, completedCount: completed.length, occurrenceCount: records.filter((record) => record.status === "ocorrencia").length, byWasteType };
}

const defaultGuides = [
  { wasteType: "reciclavel", title: "Recicláveis", acceptedItems: "Papel, plástico, metal e vidro limpos e secos.", rejectedItems: "Embalagens com resíduos de alimento, papel higiênico e espelhos.", instructions: "Esvazie, limpe quando necessário e mantenha os materiais secos antes do descarte." },
  { wasteType: "organico", title: "Orgânicos", acceptedItems: "Restos de frutas, legumes, folhas e borra de café.", rejectedItems: "Pilhas, plásticos, metais e produtos químicos.", instructions: "Acondicione em recipiente fechado; quando houver compostagem, encaminhe os materiais adequados." },
  { wasteType: "rejeito", title: "Rejeitos", acceptedItems: "Materiais sem possibilidade de reciclagem ou reaproveitamento no fluxo local.", rejectedItems: "Eletrônicos, pilhas, baterias e lâmpadas.", instructions: "Descarte apenas materiais que não possam ser direcionados às demais categorias." },
  { wasteType: "eletronico", title: "Eletrônicos", acceptedItems: "Cabos, carregadores, celulares, periféricos e pequenos eletroeletrônicos.", rejectedItems: "Resíduos orgânicos e materiais comuns.", instructions: "Não descarte com recicláveis convencionais. Use ponto de recebimento ou coleta especializada." },
  { wasteType: "perigoso", title: "Resíduos perigosos", acceptedItems: "Pilhas, baterias, lâmpadas, tintas e produtos químicos domésticos.", rejectedItems: "Materiais recicláveis ou orgânicos.", instructions: "Mantenha a embalagem identificada e procure os canais de logística reversa adequados." },
] as const;

export const analyticsRouter = router({
  dashboard: router({
    summary: withProfile.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      const records = await db.select().from(collections).where(and(...periodConditions(ctx.eco.condominium.id))).orderBy(desc(collections.scheduledAt));
      const allowedRecords = ctx.eco.profile.role === "morador" && ctx.eco.resident ? records.filter((record) => record.residentId === ctx.eco.resident?.id) : records;
      return { ...summarize(allowedRecords), recent: allowedRecords.slice(0, 5) };
    }),
  }),
  reports: router({
    overview: administratorOnly.input(periodInput).query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      const records = await db.select().from(collections).where(and(...periodConditions(ctx.eco.condominium.id, input))).orderBy(desc(collections.scheduledAt));
      const community = await db.select().from(residents).where(eq(residents.condominiumId, ctx.eco.condominium.id));
      const ranking = [...community].sort((a, b) => b.points - a.points).slice(0, 10).map((resident, index) => ({ position: index + 1, id: resident.id, name: resident.name, block: resident.block, points: resident.points }));
      const participants = new Set(records.filter((record) => record.status === "concluida" && record.residentId !== null).map((record) => record.residentId));
      return { ...summarize(records), ranking, participationRate: community.length ? Number(((participants.size / community.length) * 100).toFixed(1)) : null, residentsCount: community.length, period: input ?? {} };
    }),
    exportPdf: administratorOnly.input(periodInput).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      const records = await db.select().from(collections).where(and(...periodConditions(ctx.eco.condominium.id, input))).orderBy(desc(collections.scheduledAt));
      const report = summarize(records);
      const pdf = await PDFDocument.create();
      const page = pdf.addPage([595, 842]);
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
      const draw = (text: string, x: number, y: number, size = 11, isBold = false, color = rgb(0.12, 0.18, 0.15)) => page.drawText(text, { x, y, size, font: isBold ? bold : font, color });
      draw("EcoCondo", 48, 790, 23, true, rgb(0.04, 0.39, 0.25));
      draw("Relatório de gestão de coleta seletiva", 48, 765, 14, true);
      draw(`Condomínio: ${ctx.eco.condominium.name}`, 48, 735);
      draw(`Período: ${input?.startDate ? input.startDate.toLocaleDateString("pt-BR") : "início"} a ${input?.endDate ? input.endDate.toLocaleDateString("pt-BR") : "atual"}`, 48, 715);
      const rows = [
        ["Total coletado", `${report.totalKg.toLocaleString("pt-BR")} kg`],
        ["Recicláveis", `${report.recyclableKg.toLocaleString("pt-BR")} kg`],
        ["Taxa de reciclagem", report.recyclingRate === null ? "Sem dados" : `${report.recyclingRate}%`],
        ["Coletas concluídas", `${report.completedCount}`],
        ["Ocorrências", `${report.occurrenceCount}`],
        ["CO₂ evitado (estimativa)", `${report.co2EstimateKg.toLocaleString("pt-BR")} kg CO₂e`],
      ];
      let y = 665;
      rows.forEach(([label, value]) => { draw(label, 54, y, 11); draw(value, 350, y, 11, true, rgb(0.04, 0.39, 0.25)); y -= 31; });
      draw("Composição por categoria", 48, y - 15, 13, true); y -= 48;
      report.byWasteType.forEach((item) => { draw(`${item.wasteType}: ${item.kilograms.toLocaleString("pt-BR")} kg`, 54, y); y -= 23; });
      draw("Nota metodológica", 48, 180, 11, true);
      draw("A estimativa de CO₂ utiliza o fator configurável de 0,75 kg CO₂e por kg de reciclável.", 48, 162, 9);
      draw("Os dados devem ser interpretados como estimativas de apoio à gestão e à prestação de contas.", 48, 148, 9);
      draw(`Gerado em ${new Date().toLocaleString("pt-BR")}`, 48, 72, 9);
      const bytes = await pdf.save();
      return { filename: `relatorio-ecocondo-${new Date().toISOString().slice(0, 10)}.pdf`, contentBase64: Buffer.from(bytes).toString("base64") };
    }),
    exportCsv: administratorOnly.input(periodInput).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      const records = await db.select().from(collections).where(and(...periodConditions(ctx.eco.condominium.id, input))).orderBy(desc(collections.scheduledAt));
      const community = await db.select().from(residents).where(eq(residents.condominiumId, ctx.eco.condominium.id));
      const collectorProfiles = await db.select({ userId: userProfiles.userId, name: users.name }).from(userProfiles).leftJoin(users, eq(users.id, userProfiles.userId)).where(eq(userProfiles.condominiumId, ctx.eco.condominium.id));
      const content = buildCollectionsCsv(records.map((record) => ({
        ...record,
        residentName: community.find((resident) => resident.id === record.residentId)?.name ?? null,
        collectorName: collectorProfiles.find((profile) => profile.userId === record.collectorUserId)?.name ?? null,
      })));
      return { filename: `coletas-ecocondo-${new Date().toISOString().slice(0, 10)}.csv`, content };
    }),
  }),
  engagement: router({
    ranking: withProfile.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      const community = await db.select().from(residents).where(eq(residents.condominiumId, ctx.eco.condominium.id));
      return [...community].sort((a, b) => b.points - a.points).map((resident, index) => ({ position: index + 1, ...resident }));
    }),
    rewards: withProfile.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      return db.select().from(rewards).where(and(eq(rewards.condominiumId, ctx.eco.condominium.id), eq(rewards.isActive, true))).orderBy(asc(rewards.pointsCost));
    }),
    createReward: administratorOnly.input(z.object({ title: z.string().trim().min(3).max(140), description: z.string().trim().min(4).max(1000), pointsCost: z.number().int().min(1), stock: z.number().int().min(0).nullable() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      const inserted = await db.insert(rewards).values({ condominiumId: ctx.eco.condominium.id, ...input });
      return { id: Number(inserted[0].insertId) };
    }),
    redeem: withProfile.input(z.object({ rewardId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      if (ctx.eco.profile.role !== "morador" || !ctx.eco.resident || ctx.eco.resident.status !== "ativo") throw new TRPCError({ code: "FORBIDDEN", message: "Apenas moradores ativos podem solicitar recompensas." });
      const found = await db.select().from(rewards).where(and(eq(rewards.id, input.rewardId), eq(rewards.condominiumId, ctx.eco.condominium.id), eq(rewards.isActive, true))).limit(1);
      const reward = found[0];
      if (!reward) throw new TRPCError({ code: "NOT_FOUND", message: "Recompensa não encontrada." });
      if (reward.stock !== null && reward.stock <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Esta recompensa está sem estoque." });
      if (ctx.eco.resident.points < reward.pointsCost) throw new TRPCError({ code: "BAD_REQUEST", message: "Pontuação insuficiente para esta recompensa." });
      await db.insert(redemptions).values({ condominiumId: ctx.eco.condominium.id, residentId: ctx.eco.resident.id, rewardId: reward.id, pointsSpent: reward.pointsCost });
      await db.update(residents).set({ points: ctx.eco.resident.points - reward.pointsCost }).where(eq(residents.id, ctx.eco.resident.id));
      if (reward.stock !== null) await db.update(rewards).set({ stock: reward.stock - 1 }).where(eq(rewards.id, reward.id));
      return { success: true };
    }),
  }),
  notifications: router({
    list: withProfile.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      const rows = await db.select({ notification: notifications, read: notificationReads }).from(notifications).leftJoin(notificationReads, and(eq(notificationReads.notificationId, notifications.id), eq(notificationReads.userId, ctx.user.id))).where(and(eq(notifications.condominiumId, ctx.eco.condominium.id), or(eq(notifications.recipientUserId, ctx.user.id), sql`${notifications.recipientUserId} IS NULL`))).orderBy(desc(notifications.createdAt));
      return rows.map(({ notification, read }) => ({ ...notification, readAt: read?.readAt ?? notification.readAt ?? null }));
    }),
    unreadCount: withProfile.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      const rows = await db.select({ notification: notifications, read: notificationReads }).from(notifications).leftJoin(notificationReads, and(eq(notificationReads.notificationId, notifications.id), eq(notificationReads.userId, ctx.user.id))).where(and(eq(notifications.condominiumId, ctx.eco.condominium.id), or(eq(notifications.recipientUserId, ctx.user.id), sql`${notifications.recipientUserId} IS NULL`)));
      return { count: countUnreadNotifications(rows.map((row) => row.notification.id), ctx.user.id, rows.flatMap((row) => row.read || row.notification.readAt ? [{ notificationId: row.notification.id, userId: ctx.user.id }] : [])) };
    }),
    markRead: withProfile.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      const visible = await db.select().from(notifications).where(and(eq(notifications.id, input.id), eq(notifications.condominiumId, ctx.eco.condominium.id), or(eq(notifications.recipientUserId, ctx.user.id), sql`${notifications.recipientUserId} IS NULL`))).limit(1);
      if (!visible[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Notificação não encontrada." });
      await db.insert(notificationReads).values({ notificationId: input.id, userId: ctx.user.id }).onDuplicateKeyUpdate({ set: { readAt: new Date() } });
      return { success: true };
    }),
    markAllRead: withProfile.mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      const visible = await db.select().from(notifications).where(and(eq(notifications.condominiumId, ctx.eco.condominium.id), or(eq(notifications.recipientUserId, ctx.user.id), sql`${notifications.recipientUserId} IS NULL`)));
      for (const item of visible) await db.insert(notificationReads).values({ notificationId: item.id, userId: ctx.user.id }).onDuplicateKeyUpdate({ set: { readAt: new Date() } });
      return { success: true };
    }),
    createCommunication: administratorOnly.input(z.object({ title: z.string().trim().min(3).max(180), message: z.string().trim().min(3).max(2000) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      const inserted = await db.insert(notifications).values({ condominiumId: ctx.eco.condominium.id, recipientUserId: null, kind: "comunicado", ...input });
      return { id: Number(inserted[0].insertId) };
    }),
  }),
  guides: router({
    list: withProfile.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      const stored = await db.select().from(disposalGuides).where(and(eq(disposalGuides.condominiumId, ctx.eco.condominium.id), eq(disposalGuides.isPublished, true))).orderBy(asc(disposalGuides.wasteType));
      return stored.length ? stored : defaultGuides.map((guide, index) => ({ id: -(index + 1), condominiumId: ctx.eco.condominium.id, isPublished: true, updatedAt: new Date(), ...guide }));
    }),
  }),
});

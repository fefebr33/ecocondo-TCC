import type { Request, Response } from "express";
import { and, eq, gte, lte } from "drizzle-orm";
import { collections, notifications, residents } from "../../drizzle/schema";
import { getDb } from "../db";
import { reminderRecipients } from "../domain/reminderRules";
import { sdk } from "../_core/sdk";

/** Cria uma única notificação de lembrete para cada destinatário nas 24h anteriores à coleta. */
export async function sendCollectionReminders(req: Request, res: Response) {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
    const db = await getDb();
    if (!db) return res.status(503).json({ error: "database-unavailable" });
    const now = new Date();
    const nextDay = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const upcoming = await db.select().from(collections).where(and(eq(collections.status, "agendada"), gte(collections.scheduledAt, now), lte(collections.scheduledAt, nextDay)));
    let remindersCreated = 0;

    for (const collection of upcoming) {
      const linkedResident = collection.residentId ? await db.select({ userId: residents.userId }).from(residents).where(eq(residents.id, collection.residentId)).limit(1) : [];
      const existing = await db.select({ recipientUserId: notifications.recipientUserId }).from(notifications).where(and(eq(notifications.collectionId, collection.id), eq(notifications.kind, "lembrete_coleta")));
      const recipients = reminderRecipients({ residentUserId: linkedResident[0]?.userId ?? null, collectorUserId: collection.collectorUserId, alreadyNotifiedUserIds: existing.map((item) => item.recipientUserId).filter((id): id is number => id !== null) });
      for (const recipientUserId of recipients) {
        await db.insert(notifications).values({ condominiumId: collection.condominiumId, recipientUserId, collectionId: collection.id, kind: "lembrete_coleta", title: "Lembrete de coleta", message: `A coleta de ${collection.wasteType} do bloco ${collection.block} está programada para as próximas 24 horas.` });
        remindersCreated += 1;
      }
    }
    return res.json({ ok: true, evaluatedCollections: upcoming.length, remindersCreated });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "collection-reminder-failed", timestamp: new Date().toISOString() });
  }
}

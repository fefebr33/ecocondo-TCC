import { auditLogs, auditEntityTypes } from "../drizzle/schema";

type AuditEntityType = (typeof auditEntityTypes)[number];

export type AuditLogEntry = {
  condominiumId: number;
  actorUserId: number;
  entityType: AuditEntityType;
  entityId: number;
  action: string;
  summary: string;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
};

function serializeState(value: Record<string, unknown> | null | undefined) {
  if (!value) return null;
  return JSON.stringify(value, (_key, item) => item instanceof Date ? item.toISOString() : item);
}

export async function writeAuditLog(db: any, entry: AuditLogEntry) {
  await db.insert(auditLogs).values({
    condominiumId: entry.condominiumId,
    actorUserId: entry.actorUserId,
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    summary: entry.summary,
    beforeState: serializeState(entry.beforeState),
    afterState: serializeState(entry.afterState),
  });
}

export function collectionAuditState(record: { status: string; weightGrams: number | null; pointsAwarded: number; collectorUserId: number | null; scheduledAt: Date; completedAt: Date | null; notes: string | null }) {
  return {
    status: record.status,
    weightGrams: record.weightGrams,
    pointsAwarded: record.pointsAwarded,
    collectorUserId: record.collectorUserId,
    scheduledAt: record.scheduledAt,
    completedAt: record.completedAt,
    notes: record.notes,
  };
}

export function incidentAuditState(record: { status: string; block: string; wasteType: string; location: string; description: string; resolutionNote: string | null; resolvedByUserId: number | null; resolvedAt: Date | null }) {
  return {
    status: record.status,
    block: record.block,
    wasteType: record.wasteType,
    location: record.location,
    description: record.description,
    resolutionNote: record.resolutionNote,
    resolvedByUserId: record.resolvedByUserId,
    resolvedAt: record.resolvedAt,
  };
}

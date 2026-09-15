import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch())`;

/** Tabela central de identidade dos usuários autenticados. */
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  openId: text("openId").notNull().unique(),
  name: text("name"),
  email: text("email"),
  loginMethod: text("loginMethod"),
  role: text("role", { enum: ["user", "admin"] }).default("user").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).default(now).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).default(now).notNull(),
  lastSignedIn: integer("lastSignedIn", { mode: "timestamp" }).default(now).notNull(),
});

export const condominiums = sqliteTable("condominiums", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  blockCount: integer("blockCount").default(1).notNull(),
  isActive: integer("isActive", { mode: "boolean" }).default(true).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).default(now).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).default(now).notNull(),
});

export const ecoRoles = ["administrador", "coletor", "morador"] as const;
export const accessStatuses = ["pendente", "ativo"] as const;
export const residentStatuses = ["ativo", "inativo"] as const;
export const wasteTypes = ["reciclavel", "organico", "rejeito", "eletronico", "perigoso"] as const;
export const collectionStatuses = ["agendada", "em_andamento", "concluida", "cancelada", "ocorrencia"] as const;
export const notificationKinds = ["coleta_agendada", "coleta_concluida", "lembrete_coleta", "comunicado", "sistema"] as const;
export const auditEntityTypes = ["coleta", "ocorrencia"] as const;
export const redemptionStatuses = ["solicitado", "aprovado", "entregue", "cancelado"] as const;
export const incidentStatuses = ["aberta", "em_analise", "resolvida"] as const;
export const campaignStatuses = ["planejada", "ativa", "encerrada"] as const;
export const feedbackStatuses = ["novo", "respondido", "arquivado"] as const;

export const residents = sqliteTable("residents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  condominiumId: integer("condominiumId").notNull(),
  userId: integer("userId"),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  block: text("block").notNull(),
  apartment: text("apartment").notNull(),
  status: text("status", { enum: residentStatuses }).default("ativo").notNull(),
  points: integer("points").default(0).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).default(now).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).default(now).notNull(),
}, (table) => [
  index("residents_condominium_idx").on(table.condominiumId),
  uniqueIndex("residents_user_unique").on(table.userId),
]);

export const userProfiles = sqliteTable("user_profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("userId").notNull(),
  condominiumId: integer("condominiumId").notNull(),
  residentId: integer("residentId"),
  role: text("role", { enum: ecoRoles }).default("morador").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).default(now).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).default(now).notNull(),
}, (table) => [
  uniqueIndex("user_profiles_user_unique").on(table.userId),
  index("user_profiles_condominium_idx").on(table.condominiumId),
]);

export const people = sqliteTable("people", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  condominiumId: integer("condominiumId").notNull(),
  userId: integer("userId"),
  residentId: integer("residentId"),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  block: text("block"),
  apartment: text("apartment"),
  role: text("role", { enum: ecoRoles }).default("morador").notNull(),
  accessStatus: text("accessStatus", { enum: accessStatuses }).default("pendente").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).default(now).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).default(now).notNull(),
}, (table) => [
  uniqueIndex("people_condominium_email_unique").on(table.condominiumId, table.email),
  uniqueIndex("people_user_unique").on(table.userId),
  index("people_condominium_idx").on(table.condominiumId),
]);

export const collections = sqliteTable("collections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  condominiumId: integer("condominiumId").notNull(),
  residentId: integer("residentId"),
  createdByUserId: integer("createdByUserId").notNull(),
  collectorUserId: integer("collectorUserId"),
  wasteType: text("wasteType", { enum: wasteTypes }).notNull(),
  block: text("block").notNull(),
  scheduledAt: integer("scheduledAt", { mode: "timestamp" }).notNull(),
  completedAt: integer("completedAt", { mode: "timestamp" }),
  weightGrams: integer("weightGrams"),
  pointsAwarded: integer("pointsAwarded").default(0).notNull(),
  status: text("status", { enum: collectionStatuses }).default("agendada").notNull(),
  notes: text("notes"),
  createdAt: integer("createdAt", { mode: "timestamp" }).default(now).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).default(now).notNull(),
}, (table) => [
  index("collections_condominium_idx").on(table.condominiumId),
  index("collections_status_idx").on(table.status),
  index("collections_scheduled_idx").on(table.scheduledAt),
  index("collections_condominium_scheduled_idx").on(table.condominiumId, table.scheduledAt),
  index("collections_condominium_status_scheduled_idx").on(table.condominiumId, table.status, table.scheduledAt),
  index("collections_condominium_block_scheduled_idx").on(table.condominiumId, table.block, table.scheduledAt),
]);

export const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  condominiumId: integer("condominiumId").notNull(),
  actorUserId: integer("actorUserId").notNull(),
  entityType: text("entityType", { enum: auditEntityTypes }).notNull(),
  entityId: integer("entityId").notNull(),
  action: text("action").notNull(),
  summary: text("summary").notNull(),
  beforeState: text("beforeState"),
  afterState: text("afterState"),
  createdAt: integer("createdAt", { mode: "timestamp" }).default(now).notNull(),
}, (table) => [
  index("audit_logs_condominium_created_idx").on(table.condominiumId, table.createdAt),
  index("audit_logs_entity_idx").on(table.entityType, table.entityId),
  index("audit_logs_actor_created_idx").on(table.actorUserId, table.createdAt),
]);

export const notifications = sqliteTable("notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  condominiumId: integer("condominiumId").notNull(),
  recipientUserId: integer("recipientUserId"),
  collectionId: integer("collectionId"),
  kind: text("kind", { enum: notificationKinds }).notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  readAt: integer("readAt", { mode: "timestamp" }),
  createdAt: integer("createdAt", { mode: "timestamp" }).default(now).notNull(),
}, (table) => [
  index("notifications_recipient_idx").on(table.recipientUserId),
  index("notifications_condominium_idx").on(table.condominiumId),
]);

export const notificationReads = sqliteTable("notification_reads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  notificationId: integer("notificationId").notNull(),
  userId: integer("userId").notNull(),
  readAt: integer("readAt", { mode: "timestamp" }).default(now).notNull(),
}, (table) => [
  uniqueIndex("notification_reads_notification_user_unique").on(table.notificationId, table.userId),
  index("notification_reads_user_idx").on(table.userId),
]);

export const rewards = sqliteTable("rewards", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  condominiumId: integer("condominiumId").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  pointsCost: integer("pointsCost").notNull(),
  stock: integer("stock"),
  isActive: integer("isActive", { mode: "boolean" }).default(true).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).default(now).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).default(now).notNull(),
}, (table) => [index("rewards_condominium_idx").on(table.condominiumId)]);

export const redemptions = sqliteTable("redemptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  condominiumId: integer("condominiumId").notNull(),
  residentId: integer("residentId").notNull(),
  rewardId: integer("rewardId").notNull(),
  pointsSpent: integer("pointsSpent").notNull(),
  status: text("status", { enum: redemptionStatuses }).default("solicitado").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).default(now).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).default(now).notNull(),
}, (table) => [
  index("redemptions_resident_idx").on(table.residentId),
  index("redemptions_condominium_idx").on(table.condominiumId),
]);

export const disposalGuides = sqliteTable("disposal_guides", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  condominiumId: integer("condominiumId").notNull(),
  wasteType: text("wasteType", { enum: wasteTypes }).notNull(),
  title: text("title").notNull(),
  acceptedItems: text("acceptedItems").notNull(),
  rejectedItems: text("rejectedItems").notNull(),
  instructions: text("instructions").notNull(),
  isPublished: integer("isPublished", { mode: "boolean" }).default(true).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).default(now).notNull(),
}, (table) => [
  uniqueIndex("guides_condominium_waste_unique").on(table.condominiumId, table.wasteType),
]);

export const blockGoals = sqliteTable("block_goals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  condominiumId: integer("condominiumId").notNull(),
  block: text("block").notNull(),
  title: text("title").notNull(),
  targetKg: integer("targetKg").notNull(),
  startDate: integer("startDate", { mode: "timestamp" }).notNull(),
  endDate: integer("endDate", { mode: "timestamp" }).notNull(),
  createdByUserId: integer("createdByUserId").notNull(),
  isActive: integer("isActive", { mode: "boolean" }).default(true).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).default(now).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).default(now).notNull(),
}, (table) => [
  index("block_goals_condominium_idx").on(table.condominiumId),
  index("block_goals_period_idx").on(table.startDate, table.endDate),
]);

export const incidents = sqliteTable("incidents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  condominiumId: integer("condominiumId").notNull(),
  reporterUserId: integer("reporterUserId").notNull(),
  block: text("block").notNull(),
  wasteType: text("wasteType", { enum: wasteTypes }).notNull(),
  location: text("location").notNull(),
  description: text("description").notNull(),
  imageKey: text("imageKey"),
  imageUrl: text("imageUrl"),
  status: text("status", { enum: incidentStatuses }).default("aberta").notNull(),
  resolutionNote: text("resolutionNote"),
  resolvedByUserId: integer("resolvedByUserId"),
  resolvedAt: integer("resolvedAt", { mode: "timestamp" }),
  createdAt: integer("createdAt", { mode: "timestamp" }).default(now).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).default(now).notNull(),
}, (table) => [
  index("incidents_condominium_idx").on(table.condominiumId),
  index("incidents_status_idx").on(table.status),
  index("incidents_condominium_status_created_idx").on(table.condominiumId, table.status, table.createdAt),
]);

export const campaigns = sqliteTable("campaigns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  condominiumId: integer("condominiumId").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  targetDescription: text("targetDescription").notNull(),
  startDate: integer("startDate", { mode: "timestamp" }).notNull(),
  endDate: integer("endDate", { mode: "timestamp" }).notNull(),
  status: text("status", { enum: campaignStatuses }).default("planejada").notNull(),
  createdByUserId: integer("createdByUserId").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).default(now).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).default(now).notNull(),
}, (table) => [
  index("campaigns_condominium_idx").on(table.condominiumId),
  index("campaigns_period_idx").on(table.startDate, table.endDate),
]);

export const campaignParticipants = sqliteTable("campaign_participants", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  campaignId: integer("campaignId").notNull(),
  residentId: integer("residentId").notNull(),
  joinedAt: integer("joinedAt", { mode: "timestamp" }).default(now).notNull(),
}, (table) => [
  uniqueIndex("campaign_participant_unique").on(table.campaignId, table.residentId),
  index("campaign_participants_resident_idx").on(table.residentId),
]);

export const collectionFeedback = sqliteTable("collection_feedback", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  condominiumId: integer("condominiumId").notNull(),
  residentId: integer("residentId").notNull(),
  collectionId: integer("collectionId"),
  rating: integer("rating").notNull(),
  message: text("message").notNull(),
  status: text("status", { enum: feedbackStatuses }).default("novo").notNull(),
  response: text("response"),
  respondedByUserId: integer("respondedByUserId"),
  respondedAt: integer("respondedAt", { mode: "timestamp" }),
  createdAt: integer("createdAt", { mode: "timestamp" }).default(now).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).default(now).notNull(),
}, (table) => [
  index("feedback_condominium_idx").on(table.condominiumId),
  index("feedback_resident_idx").on(table.residentId),
  index("feedback_status_idx").on(table.status),
]);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type EcoProfile = typeof userProfiles.$inferSelect;
export type Resident = typeof residents.$inferSelect;
export type Condominium = typeof condominiums.$inferSelect;
export type Collection = typeof collections.$inferSelect;
export type Person = typeof people.$inferSelect;

import {
  boolean,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/** Core identity table populated by Manus OAuth. */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const condominiums = mysqlTable("condominiums", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  address: text("address"),
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 2 }),
  blockCount: int("blockCount").default(1).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const ecoRoles = ["administrador", "coletor", "morador"] as const;
export const residentStatuses = ["ativo", "inativo"] as const;
export const wasteTypes = ["reciclavel", "organico", "rejeito", "eletronico", "perigoso"] as const;
export const collectionStatuses = ["agendada", "em_andamento", "concluida", "cancelada", "ocorrencia"] as const;
export const notificationKinds = ["coleta_agendada", "coleta_concluida", "comunicado", "sistema"] as const;
export const redemptionStatuses = ["solicitado", "aprovado", "entregue", "cancelado"] as const;

export const residents = mysqlTable("residents", {
  id: int("id").autoincrement().primaryKey(),
  condominiumId: int("condominiumId").notNull(),
  userId: int("userId"),
  name: varchar("name", { length: 180 }).notNull(),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 32 }),
  block: varchar("block", { length: 32 }).notNull(),
  apartment: varchar("apartment", { length: 32 }).notNull(),
  status: mysqlEnum("status", residentStatuses).default("ativo").notNull(),
  points: int("points").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("residents_condominium_idx").on(table.condominiumId),
  uniqueIndex("residents_user_unique").on(table.userId),
]);

export const userProfiles = mysqlTable("user_profiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  condominiumId: int("condominiumId").notNull(),
  residentId: int("residentId"),
  role: mysqlEnum("role", ecoRoles).default("morador").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("user_profiles_user_unique").on(table.userId),
  index("user_profiles_condominium_idx").on(table.condominiumId),
]);

export const collections = mysqlTable("collections", {
  id: int("id").autoincrement().primaryKey(),
  condominiumId: int("condominiumId").notNull(),
  residentId: int("residentId"),
  createdByUserId: int("createdByUserId").notNull(),
  collectorUserId: int("collectorUserId"),
  wasteType: mysqlEnum("wasteType", wasteTypes).notNull(),
  block: varchar("block", { length: 32 }).notNull(),
  scheduledAt: timestamp("scheduledAt").notNull(),
  completedAt: timestamp("completedAt"),
  weightGrams: int("weightGrams"),
  pointsAwarded: int("pointsAwarded").default(0).notNull(),
  status: mysqlEnum("status", collectionStatuses).default("agendada").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("collections_condominium_idx").on(table.condominiumId),
  index("collections_status_idx").on(table.status),
  index("collections_scheduled_idx").on(table.scheduledAt),
]);

export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  condominiumId: int("condominiumId").notNull(),
  recipientUserId: int("recipientUserId"),
  collectionId: int("collectionId"),
  kind: mysqlEnum("kind", notificationKinds).notNull(),
  title: varchar("title", { length: 180 }).notNull(),
  message: text("message").notNull(),
  readAt: timestamp("readAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("notifications_recipient_idx").on(table.recipientUserId),
  index("notifications_condominium_idx").on(table.condominiumId),
]);

export const rewards = mysqlTable("rewards", {
  id: int("id").autoincrement().primaryKey(),
  condominiumId: int("condominiumId").notNull(),
  title: varchar("title", { length: 140 }).notNull(),
  description: text("description").notNull(),
  pointsCost: int("pointsCost").notNull(),
  stock: int("stock"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [index("rewards_condominium_idx").on(table.condominiumId)]);

export const redemptions = mysqlTable("redemptions", {
  id: int("id").autoincrement().primaryKey(),
  condominiumId: int("condominiumId").notNull(),
  residentId: int("residentId").notNull(),
  rewardId: int("rewardId").notNull(),
  pointsSpent: int("pointsSpent").notNull(),
  status: mysqlEnum("status", redemptionStatuses).default("solicitado").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("redemptions_resident_idx").on(table.residentId),
  index("redemptions_condominium_idx").on(table.condominiumId),
]);

export const disposalGuides = mysqlTable("disposal_guides", {
  id: int("id").autoincrement().primaryKey(),
  condominiumId: int("condominiumId").notNull(),
  wasteType: mysqlEnum("wasteType", wasteTypes).notNull(),
  title: varchar("title", { length: 140 }).notNull(),
  acceptedItems: text("acceptedItems").notNull(),
  rejectedItems: text("rejectedItems").notNull(),
  instructions: text("instructions").notNull(),
  isPublished: boolean("isPublished").default(true).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("guides_condominium_waste_unique").on(table.condominiumId, table.wasteType),
]);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type EcoProfile = typeof userProfiles.$inferSelect;
export type Resident = typeof residents.$inferSelect;
export type Condominium = typeof condominiums.$inferSelect;
export type Collection = typeof collections.$inferSelect;

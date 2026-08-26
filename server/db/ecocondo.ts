import { and, eq } from "drizzle-orm";
import {
  condominiums,
  EcoProfile,
  residents,
  userProfiles,
  User,
} from "../../drizzle/schema";
import { ENV } from "../_core/env";
import { getDb } from "../db";

export type ProfileContext = {
  profile: EcoProfile;
  condominium: typeof condominiums.$inferSelect;
  resident: typeof residents.$inferSelect | null;
};

async function getDefaultCondominium() {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível.");
  const existing = await db.select().from(condominiums).limit(1);
  if (existing[0]) return existing[0];

  const result = await db.insert(condominiums).values({
    name: "Condomínio Parque das Flores",
    city: "São Paulo",
    state: "SP",
    blockCount: 4,
  });
  const created = await db.select().from(condominiums).where(eq(condominiums.id, Number(result[0].insertId))).limit(1);
  if (!created[0]) throw new Error("Não foi possível inicializar o condomínio.");
  return created[0];
}

export async function getOrCreateProfile(user: User): Promise<ProfileContext> {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível.");

  const existing = await db.select().from(userProfiles).where(eq(userProfiles.userId, user.id)).limit(1);
  if (existing[0]) {
    const condominium = await db.select().from(condominiums).where(eq(condominiums.id, existing[0].condominiumId)).limit(1);
    const resident = existing[0].residentId
      ? await db.select().from(residents).where(eq(residents.id, existing[0].residentId)).limit(1)
      : [];
    if (!condominium[0]) throw new Error("Condomínio do perfil não encontrado.");
    return { profile: existing[0], condominium: condominium[0], resident: resident[0] ?? null };
  }

  const condominium = await getDefaultCondominium();
  const isAdministrator = user.openId === ENV.ownerOpenId || user.role === "admin";
  const role = isAdministrator ? "administrador" : "morador";
  let residentId: number | null = null;

  if (role === "morador") {
    const foundResident = user.email
      ? await db.select().from(residents).where(and(eq(residents.condominiumId, condominium.id), eq(residents.email, user.email))).limit(1)
      : [];
    if (foundResident[0]) {
      residentId = foundResident[0].id;
      await db.update(residents).set({ userId: user.id }).where(eq(residents.id, foundResident[0].id));
    } else {
      const created = await db.insert(residents).values({
        condominiumId: condominium.id,
        userId: user.id,
        name: user.name || "Morador",
        email: user.email || null,
        block: "A",
        apartment: "A definir",
      });
      residentId = Number(created[0].insertId);
    }
  }

  const inserted = await db.insert(userProfiles).values({
    userId: user.id,
    condominiumId: condominium.id,
    residentId,
    role,
  });
  const profile = await db.select().from(userProfiles).where(eq(userProfiles.id, Number(inserted[0].insertId))).limit(1);
  const resident = residentId ? await db.select().from(residents).where(eq(residents.id, residentId)).limit(1) : [];
  if (!profile[0]) throw new Error("Não foi possível criar o perfil de acesso.");
  return { profile: profile[0], condominium, resident: resident[0] ?? null };
}

export async function getProfileContextByUserId(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível.");
  const profile = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
  if (!profile[0]) return null;
  const condominium = await db.select().from(condominiums).where(eq(condominiums.id, profile[0].condominiumId)).limit(1);
  const resident = profile[0].residentId ? await db.select().from(residents).where(eq(residents.id, profile[0].residentId)).limit(1) : [];
  if (!condominium[0]) return null;
  return { profile: profile[0], condominium: condominium[0], resident: resident[0] ?? null } satisfies ProfileContext;
}

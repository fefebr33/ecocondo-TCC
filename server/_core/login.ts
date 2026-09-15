import { COOKIE_NAME, ONE_YEAR_MS } from "../../shared/const";
import { eq } from "drizzle-orm";
import type { Express, Request, Response } from "express";
import * as userDb from "../db";
import { getDb } from "../db";
import { condominiums, ecoRoles, people, residents, userProfiles } from "../../drizzle/schema";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

type EcoRole = (typeof ecoRoles)[number];

const DEMO_ACCOUNTS: Record<EcoRole, { openId: string; name: string; email: string }> = {
  administrador: { openId: "demo-administrador", name: "Ana Administradora", email: "admin@ecocondo.local" },
  coletor: { openId: "demo-coletor", name: "Carlos Coletor", email: "coletor@ecocondo.local" },
  morador: { openId: "demo-morador", name: "Marina Moradora", email: "morador@ecocondo.local" },
};

async function ensureCondominium() {
  const db = await getDb();
  const existing = await db.select().from(condominiums).limit(1);
  if (existing[0]) return existing[0];
  const inserted = await db.insert(condominiums).values({
    name: "Condomínio Parque das Flores",
    city: "São Paulo",
    state: "SP",
    blockCount: 4,
  }).returning({ id: condominiums.id });
  return { id: inserted[0].id };
}

/** Login local de demonstração — cria/reaproveita uma conta fixa por perfil, sem depender de nenhum serviço externo. */
export function registerLoginRoute(app: Express) {
  app.get("/api/auth/entrar", async (req: Request, res: Response) => {
    const roleParam = req.query.role;
    const role: EcoRole = ecoRoles.includes(roleParam as EcoRole) ? (roleParam as EcoRole) : "morador";
    const account = DEMO_ACCOUNTS[role];
    const db = await getDb();

    await userDb.upsertUser({
      openId: account.openId,
      name: account.name,
      email: account.email,
      loginMethod: "demo",
      role: role === "administrador" ? "admin" : "user",
      lastSignedIn: new Date(),
    });
    const user = await userDb.getUserByOpenId(account.openId);
    if (!user) {
      res.status(500).json({ error: "Não foi possível criar o usuário de demonstração." });
      return;
    }

    const condominium = await ensureCondominium();

    let residentId: number | null = null;
    if (role === "morador") {
      const existingResident = await db.select().from(residents).where(eq(residents.userId, user.id)).limit(1);
      if (existingResident[0]) {
        residentId = existingResident[0].id;
      } else {
        const insertedResident = await db.insert(residents).values({
          condominiumId: condominium.id,
          userId: user.id,
          name: account.name,
          email: account.email,
          block: "A",
          apartment: "101",
        }).returning({ id: residents.id });
        residentId = insertedResident[0].id;
      }
    }

    const existingProfile = await db.select().from(userProfiles).where(eq(userProfiles.userId, user.id)).limit(1);
    if (existingProfile[0]) {
      await db.update(userProfiles).set({ role, residentId, updatedAt: new Date() }).where(eq(userProfiles.userId, user.id));
    } else {
      await db.insert(userProfiles).values({ userId: user.id, condominiumId: condominium.id, residentId, role });
    }

    const existingPerson = await db.select().from(people).where(eq(people.userId, user.id)).limit(1);
    if (existingPerson[0]) {
      await db.update(people).set({ role, residentId, accessStatus: "ativo", updatedAt: new Date() }).where(eq(people.userId, user.id));
    } else {
      await db.insert(people).values({
        condominiumId: condominium.id,
        userId: user.id,
        residentId,
        name: account.name,
        email: account.email,
        role,
        accessStatus: "ativo",
      });
    }

    const sessionToken = await sdk.createSessionToken(account.openId, { name: account.name, expiresInMs: ONE_YEAR_MS });
    res.cookie(COOKIE_NAME, sessionToken, { ...getSessionCookieOptions(req), maxAge: ONE_YEAR_MS });
    res.redirect(302, "/dashboard");
  });
}

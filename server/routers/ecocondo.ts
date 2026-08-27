import { TRPCError } from "@trpc/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { condominiums, ecoRoles, people, residents, userProfiles, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { getOrCreateProfile } from "../db/ecocondo";
import { buildPendingResidentPerson } from "../domain/peopleRules";
import { protectedProcedure, router } from "../_core/trpc";

export const withProfile = protectedProcedure.use(async ({ ctx, next }) => {
  const profileContext = await getOrCreateProfile(ctx.user);
  return next({ ctx: { ...ctx, eco: profileContext } });
});

export const administratorOnly = withProfile.use(async ({ ctx, next }) => {
  if (ctx.eco.profile.role !== "administrador") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Esta operação requer perfil de administrador." });
  }
  return next();
});

export const staffOnly = withProfile.use(async ({ ctx, next }) => {
  if (ctx.eco.profile.role !== "administrador" && ctx.eco.profile.role !== "coletor") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Esta operação requer perfil de administrador ou coletor." });
  }
  return next();
});

export const ecoRouter = router({
  people: router({
    directory: administratorOnly.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      const existingResidents = await db.select().from(residents).where(eq(residents.condominiumId, ctx.eco.condominium.id));
      const existingPeople = await db.select().from(people).where(eq(people.condominiumId, ctx.eco.condominium.id));
      for (const resident of existingResidents) {
        const residentEmail = resident.email?.toLowerCase();
        if (!residentEmail || existingPeople.some((person) => person.residentId === resident.id || person.email === residentEmail)) continue;
        await db.insert(people).values({ condominiumId: ctx.eco.condominium.id, ...buildPendingResidentPerson({ id: resident.id, userId: resident.userId, name: resident.name, email: residentEmail, phone: resident.phone, block: resident.block, apartment: resident.apartment }) });
      }
      return db.select({ person: people, user: users, resident: residents }).from(people).leftJoin(users, eq(users.id, people.userId)).leftJoin(residents, eq(residents.id, people.residentId)).where(eq(people.condominiumId, ctx.eco.condominium.id)).orderBy(asc(people.name));
    }),
    create: administratorOnly.input(z.object({
      name: z.string().trim().min(3).max(180),
      email: z.string().trim().email().max(320),
      phone: z.string().trim().max(32).nullable().optional(),
      role: z.enum(ecoRoles),
      block: z.string().trim().max(32).nullable().optional(),
      apartment: z.string().trim().max(32).nullable().optional(),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      const email = input.email.toLowerCase();
      const existing = await db.select().from(people).where(and(eq(people.condominiumId, ctx.eco.condominium.id), eq(people.email, email))).limit(1);
      if (existing[0]) throw new TRPCError({ code: "CONFLICT", message: "Já existe uma pessoa cadastrada com este e-mail." });
      if (input.role === "morador" && (!input.block || !input.apartment)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Informe bloco e apartamento para cadastrar um morador." });
      }
      let residentId: number | null = null;
      if (input.role === "morador") {
        const resident = await db.insert(residents).values({
          condominiumId: ctx.eco.condominium.id,
          name: input.name,
          email,
          phone: input.phone || null,
          block: input.block!,
          apartment: input.apartment!,
        });
        residentId = Number(resident[0].insertId);
      }
      const inserted = await db.insert(people).values({
        condominiumId: ctx.eco.condominium.id,
        residentId,
        name: input.name,
        email,
        phone: input.phone || null,
        block: input.block || null,
        apartment: input.apartment || null,
        role: input.role,
        accessStatus: "pendente",
      });
      return { id: Number(inserted[0].insertId), residentId };
    }),
    setRole: administratorOnly.input(z.object({ id: z.number().int().positive(), role: z.enum(ecoRoles) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      const target = await db.select().from(people).where(and(eq(people.id, input.id), eq(people.condominiumId, ctx.eco.condominium.id))).limit(1);
      if (!target[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Pessoa não encontrada no condomínio." });
      if (input.role === "morador" && !target[0].residentId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cadastre bloco e apartamento antes de atribuir o perfil de morador." });
      }
      await db.update(people).set({ role: input.role }).where(eq(people.id, input.id));
      if (target[0].userId) await db.update(userProfiles).set({ role: input.role, residentId: input.role === "morador" ? target[0].residentId : null }).where(eq(userProfiles.userId, target[0].userId));
      return { success: true };
    }),
  }),
  profile: router({
    me: withProfile.query(({ ctx }) => ({
      role: ctx.eco.profile.role,
      condominium: ctx.eco.condominium,
      resident: ctx.eco.resident,
    })),
    members: administratorOnly.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      return db.select({ profile: userProfiles, user: users, resident: residents }).from(userProfiles).leftJoin(users, eq(users.id, userProfiles.userId)).leftJoin(residents, eq(residents.id, userProfiles.residentId)).where(eq(userProfiles.condominiumId, ctx.eco.condominium.id));
    }),
    setRole: administratorOnly.input(z.object({ userId: z.number().int().positive(), role: z.enum(ecoRoles) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      const target = await db.select().from(userProfiles).where(eq(userProfiles.userId, input.userId)).limit(1);
      if (!target[0] || target[0].condominiumId !== ctx.eco.condominium.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Perfil não encontrado no condomínio." });
      }
      await db.update(userProfiles).set({ role: input.role }).where(eq(userProfiles.userId, input.userId));
      return { success: true };
    }),
  }),
  condominium: router({
    current: withProfile.query(({ ctx }) => ctx.eco.condominium),
    update: administratorOnly.input(z.object({
      name: z.string().trim().min(3).max(160),
      address: z.string().trim().max(500).nullable(),
      city: z.string().trim().max(100).nullable(),
      state: z.string().trim().length(2).nullable(),
      blockCount: z.number().int().min(1).max(99),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
      await db.update(condominiums).set(input).where(eq(condominiums.id, ctx.eco.condominium.id));
      return { success: true };
    }),
  }),
});

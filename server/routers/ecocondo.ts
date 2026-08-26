import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { condominiums, ecoRoles, residents, userProfiles, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { getOrCreateProfile } from "../db/ecocondo";
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

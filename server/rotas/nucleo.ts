import { TRPCError } from "@trpc/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { condominios, papeisEco, pessoas, moradores, perfisAcesso, usuarios } from "../../drizzle/schema";
import { getDb } from "../db";
import { obterOuCriarPerfil } from "../db/ecocondo";
import { buildPendingResidentPerson } from "../dominio/regrasPessoas";
import { protectedProcedure, router } from "../_core/trpc";

export const withProfile = protectedProcedure.use(async ({ ctx, next }) => {
  const contextoPerfil = await obterOuCriarPerfil(ctx.user);
  return next({ ctx: { ...ctx, eco: contextoPerfil } });
});

export const administratorOnly = withProfile.use(async ({ ctx, next }) => {
  if (ctx.eco.perfil.papel !== "administrador") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Esta operação requer perfil de administrador." });
  }
  return next();
});

export const staffOnly = withProfile.use(async ({ ctx, next }) => {
  if (ctx.eco.perfil.papel !== "administrador" && ctx.eco.perfil.papel !== "coletor") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Esta operação requer perfil de administrador ou coletor." });
  }
  return next();
});

export const ecoRouter = router({
  pessoas: router({
    diretorio: administratorOnly.query(async ({ ctx }) => {
      const db = await getDb();
      const moradoresExistentes = await db.select().from(moradores).where(eq(moradores.condominioId, ctx.eco.condominio.id));
      const pessoasExistentes = await db.select().from(pessoas).where(eq(pessoas.condominioId, ctx.eco.condominio.id));
      for (const morador of moradoresExistentes) {
        const emailMorador = morador.email?.toLowerCase();
        if (!emailMorador || pessoasExistentes.some((pessoa) => pessoa.moradorId === morador.id || pessoa.email === emailMorador)) continue;
        await db.insert(pessoas).values({ condominioId: ctx.eco.condominio.id, ...buildPendingResidentPerson({ id: morador.id, usuarioId: morador.usuarioId, nome: morador.nome, email: emailMorador, telefone: morador.telefone, bloco: morador.bloco, apartamento: morador.apartamento }) });
      }
      return db.select({ pessoa: pessoas, usuario: usuarios, morador: moradores }).from(pessoas).leftJoin(usuarios, eq(usuarios.id, pessoas.usuarioId)).leftJoin(moradores, eq(moradores.id, pessoas.moradorId)).where(eq(pessoas.condominioId, ctx.eco.condominio.id)).orderBy(asc(pessoas.nome));
    }),
    criar: administratorOnly.input(z.object({
      name: z.string().trim().min(3).max(180),
      email: z.string().trim().email().max(320),
      phone: z.string().trim().max(32).nullable().optional(),
      role: z.enum(papeisEco),
      block: z.string().trim().max(32).nullable().optional(),
      apartment: z.string().trim().max(32).nullable().optional(),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const email = input.email.toLowerCase();
      const existente = await db.select().from(pessoas).where(and(eq(pessoas.condominioId, ctx.eco.condominio.id), eq(pessoas.email, email))).limit(1);
      if (existente[0]) throw new TRPCError({ code: "CONFLICT", message: "Já existe uma pessoa cadastrada com este e-mail." });
      if (input.role === "morador" && (!input.block || !input.apartment)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Informe bloco e apartamento para cadastrar um morador." });
      }
      let moradorId: number | null = null;
      if (input.role === "morador") {
        const morador = await db.insert(moradores).values({
          condominioId: ctx.eco.condominio.id,
          nome: input.name,
          email,
          telefone: input.phone || null,
          bloco: input.block!,
          apartamento: input.apartment!,
        }).returning({ id: moradores.id });
        moradorId = morador[0].id;
      }
      const inserido = await db.insert(pessoas).values({
        condominioId: ctx.eco.condominio.id,
        moradorId,
        nome: input.name,
        email,
        telefone: input.phone || null,
        bloco: input.block || null,
        apartamento: input.apartment || null,
        papel: input.role,
        statusAcesso: "pendente",
      }).returning({ id: pessoas.id });
      return { id: inserido[0].id, residentId: moradorId };
    }),
    definirPapel: administratorOnly.input(z.object({ id: z.number().int().positive(), role: z.enum(papeisEco) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const alvo = await db.select().from(pessoas).where(and(eq(pessoas.id, input.id), eq(pessoas.condominioId, ctx.eco.condominio.id))).limit(1);
      if (!alvo[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Pessoa não encontrada no condomínio." });
      if (input.role === "morador" && !alvo[0].moradorId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cadastre bloco e apartamento antes de atribuir o perfil de morador." });
      }
      await db.update(pessoas).set({ papel: input.role, atualizadoEm: new Date() }).where(eq(pessoas.id, input.id));
      if (alvo[0].usuarioId) await db.update(perfisAcesso).set({ papel: input.role, moradorId: input.role === "morador" ? alvo[0].moradorId : null, atualizadoEm: new Date() }).where(eq(perfisAcesso.usuarioId, alvo[0].usuarioId));
      return { success: true };
    }),
  }),
  perfil: router({
    meuPerfil: withProfile.query(({ ctx }) => ({
      role: ctx.eco.perfil.papel,
      condominium: ctx.eco.condominio,
      resident: ctx.eco.morador,
    })),
    membros: administratorOnly.query(async ({ ctx }) => {
      const db = await getDb();
      return db.select({ profile: perfisAcesso, user: usuarios, resident: moradores }).from(perfisAcesso).leftJoin(usuarios, eq(usuarios.id, perfisAcesso.usuarioId)).leftJoin(moradores, eq(moradores.id, perfisAcesso.moradorId)).where(eq(perfisAcesso.condominioId, ctx.eco.condominio.id));
    }),
    definirPapel: administratorOnly.input(z.object({ userId: z.number().int().positive(), role: z.enum(papeisEco) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const alvo = await db.select().from(perfisAcesso).where(eq(perfisAcesso.usuarioId, input.userId)).limit(1);
      if (!alvo[0] || alvo[0].condominioId !== ctx.eco.condominio.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Perfil não encontrado no condomínio." });
      }
      await db.update(perfisAcesso).set({ papel: input.role, atualizadoEm: new Date() }).where(eq(perfisAcesso.usuarioId, input.userId));
      return { success: true };
    }),
  }),
  condominio: router({
    atual: withProfile.query(({ ctx }) => ctx.eco.condominio),
    atualizar: administratorOnly.input(z.object({
      name: z.string().trim().min(3).max(160),
      address: z.string().trim().max(500).nullable(),
      city: z.string().trim().max(100).nullable(),
      state: z.string().trim().length(2).nullable(),
      blockCount: z.number().int().min(1).max(99),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      await db.update(condominios).set({
        nome: input.name,
        endereco: input.address,
        cidade: input.city,
        estado: input.state,
        quantidadeBlocos: input.blockCount,
        atualizadoEm: new Date(),
      }).where(eq(condominios.id, ctx.eco.condominio.id));
      return { success: true };
    }),
  }),
});

import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { coletas, statusColeta, notificacoes, pessoas, moradores, statusMorador, perfisAcesso, usuarios, tiposResiduo } from "../../drizzle/schema";
import { getDb } from "../db";
import { administratorOnly, staffOnly, withProfile } from "./ecocondo";
import { router } from "../_core/trpc";
import { prepareCollectionCompletion, resolveCollectorAssignment } from "../domain/collectionRules";
import { buildPendingResidentPerson } from "../domain/peopleRules";
import { collectionAuditState, writeAuditLog } from "../audit";

const moradorInput = z.object({
  name: z.string().trim().min(3).max(180),
  email: z.string().trim().email().max(320).nullable().optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  block: z.string().trim().min(1).max(32),
  apartment: z.string().trim().min(1).max(32),
  status: z.enum(statusMorador).default("ativo"),
});

const filtrosColeta = z.object({
  wasteType: z.enum(tiposResiduo).optional(),
  block: z.string().trim().max(32).optional(),
  status: z.enum(statusColeta).optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
});

export const operationsRouter = router({
  moradores: router({
    listar: administratorOnly.query(async ({ ctx }) => {
      const db = await getDb();
      return db.select().from(moradores).where(eq(moradores.condominioId, ctx.eco.condominio.id)).orderBy(asc(moradores.nome));
    }),
    criar: administratorOnly.input(moradorInput).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const inserido = await db.insert(moradores).values({
        condominioId: ctx.eco.condominio.id,
        nome: input.name,
        email: input.email || null,
        telefone: input.phone || null,
        bloco: input.block,
        apartamento: input.apartment,
        status: input.status,
      }).returning({ id: moradores.id });
      return { id: inserido[0].id };
    }),
    atualizar: administratorOnly.input(moradorInput.partial().extend({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const { id, ...atualizacao } = input;
      const existente = await db.select().from(moradores).where(and(eq(moradores.id, id), eq(moradores.condominioId, ctx.eco.condominio.id))).limit(1);
      if (!existente[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Morador não encontrado." });
      const proximoEmail = atualizacao.email === undefined ? existente[0].email : atualizacao.email || null;
      const proximoTelefone = atualizacao.phone === undefined ? existente[0].telefone : atualizacao.phone || null;
      await db.update(moradores).set({
        nome: atualizacao.name ?? existente[0].nome,
        bloco: atualizacao.block ?? existente[0].bloco,
        apartamento: atualizacao.apartment ?? existente[0].apartamento,
        status: atualizacao.status ?? existente[0].status,
        email: proximoEmail,
        telefone: proximoTelefone,
        atualizadoEm: new Date(),
      }).where(eq(moradores.id, id));
      const pessoa = await db.select().from(pessoas).where(eq(pessoas.moradorId, id)).limit(1);
      if (pessoa[0]) {
        await db.update(pessoas).set({ nome: atualizacao.name ?? existente[0].nome, email: proximoEmail || pessoa[0].email, telefone: proximoTelefone, bloco: atualizacao.block ?? existente[0].bloco, apartamento: atualizacao.apartment ?? existente[0].apartamento, atualizadoEm: new Date() }).where(eq(pessoas.id, pessoa[0].id));
      } else if (proximoEmail) {
        await db.insert(pessoas).values({ condominioId: ctx.eco.condominio.id, ...buildPendingResidentPerson({ id, usuarioId: existente[0].usuarioId, nome: atualizacao.name ?? existente[0].nome, email: proximoEmail, telefone: proximoTelefone, bloco: atualizacao.block ?? existente[0].bloco, apartamento: atualizacao.apartment ?? existente[0].apartamento }) });
      }
      return { success: true };
    }),
  }),
  coletas: router({
    listar: withProfile.input(filtrosColeta.optional()).query(async ({ ctx, input }) => {
      const db = await getDb();
      const condicoes = [eq(coletas.condominioId, ctx.eco.condominio.id)];
      if (ctx.eco.perfil.papel === "morador") {
        if (!ctx.eco.morador) return [];
        condicoes.push(eq(coletas.moradorId, ctx.eco.morador.id));
      }
      if (input?.wasteType) condicoes.push(eq(coletas.tipoResiduo, input.wasteType));
      if (input?.block) condicoes.push(eq(coletas.bloco, input.block));
      if (input?.status) condicoes.push(eq(coletas.status, input.status));
      if (input?.startDate) condicoes.push(gte(coletas.agendadaPara, input.startDate));
      if (input?.endDate) condicoes.push(lte(coletas.agendadaPara, input.endDate));

      const registros = await db.select().from(coletas).where(and(...condicoes)).orderBy(desc(coletas.agendadaPara));
      const moradorIds = Array.from(new Set(registros.map((registro) => registro.moradorId).filter((id): id is number => id !== null)));
      const moradoresRelacionados = moradorIds.length
        ? await db.select().from(moradores).where(and(eq(moradores.condominioId, ctx.eco.condominio.id)))
        : [];
      const perfisColetor = await db.select({ usuarioId: perfisAcesso.usuarioId, papel: perfisAcesso.papel, nome: usuarios.nome }).from(perfisAcesso).leftJoin(usuarios, eq(usuarios.id, perfisAcesso.usuarioId)).where(eq(perfisAcesso.condominioId, ctx.eco.condominio.id));
      return registros.map((registro) => ({
        ...registro,
        residentName: moradoresRelacionados.find((morador) => morador.id === registro.moradorId)?.nome ?? null,
        collectorName: perfisColetor.find((perfil) => perfil.usuarioId === registro.coletorId)?.nome ?? null,
      }));
    }),
    criar: withProfile.input(z.object({
      residentId: z.number().int().positive().nullable().optional(),
      wasteType: z.enum(tiposResiduo),
      block: z.string().trim().min(1).max(32),
      scheduledAt: z.date(),
      collectorUserId: z.number().int().positive().nullable().optional(),
      notes: z.string().trim().max(1200).nullable().optional(),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      let moradorId = input.residentId ?? null;
      let bloco = input.block;
      let coletorId = resolveCollectorAssignment(ctx.eco.perfil.papel, ctx.user.id, input.collectorUserId);

      if (ctx.eco.perfil.papel === "morador") {
        if (!ctx.eco.morador || ctx.eco.morador.status !== "ativo") throw new TRPCError({ code: "FORBIDDEN", message: "O perfil do morador não está habilitado para solicitar coletas." });
        moradorId = ctx.eco.morador.id;
        bloco = ctx.eco.morador.bloco;
      }
      if (ctx.eco.perfil.papel === "administrador" && coletorId) {
        const perfilColetor = await db.select().from(perfisAcesso).where(and(eq(perfisAcesso.usuarioId, coletorId), eq(perfisAcesso.condominioId, ctx.eco.condominio.id))).limit(1);
        if (!perfilColetor[0] || perfilColetor[0].papel !== "coletor") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Selecione um usuário com perfil de coletor para assumir a coleta." });
        }
      }

      let morador = null;
      if (moradorId) {
        const encontrado = await db.select().from(moradores).where(and(eq(moradores.id, moradorId), eq(moradores.condominioId, ctx.eco.condominio.id))).limit(1);
        morador = encontrado[0] ?? null;
        if (!morador) throw new TRPCError({ code: "NOT_FOUND", message: "Morador não encontrado neste condomínio." });
      }

      const inserido = await db.insert(coletas).values({
        condominioId: ctx.eco.condominio.id,
        moradorId,
        criadoPorId: ctx.user.id,
        coletorId,
        tipoResiduo: input.wasteType,
        bloco,
        agendadaPara: input.scheduledAt,
        observacoes: input.notes || null,
      }).returning({ id: coletas.id });
      const coletaId = inserido[0].id;
      await writeAuditLog(db, {
        condominioId: ctx.eco.condominio.id,
        autorId: ctx.user.id,
        tipoEntidade: "coleta",
        entidadeId: coletaId,
        acao: "coleta_criada",
        resumo: `Coleta de ${input.wasteType} criada para o bloco ${bloco}.`,
        estadoNovo: { status: "agendada", tipoResiduo: input.wasteType, bloco, agendadaPara: input.scheduledAt, moradorId, coletorId, observacoes: input.notes || null },
      });
      if (morador?.usuarioId) {
        await db.insert(notificacoes).values({
          condominioId: ctx.eco.condominio.id,
          destinatarioId: morador.usuarioId,
          coletaId,
          tipo: "coleta_agendada",
          titulo: "Coleta agendada",
          mensagem: `Uma coleta de ${input.wasteType} foi agendada para o bloco ${bloco}.`,
        });
      }
      if (coletorId && coletorId !== ctx.user.id) {
        await db.insert(notificacoes).values({
          condominioId: ctx.eco.condominio.id,
          destinatarioId: coletorId,
          coletaId,
          tipo: "coleta_agendada",
          titulo: "Coleta atribuída",
          mensagem: `Você foi designado para uma coleta de ${input.wasteType} no bloco ${bloco}.`,
        });
      }
      return { id: coletaId };
    }),
    atualizarStatus: staffOnly.input(z.object({
      id: z.number().int().positive(),
      status: z.enum(statusColeta),
      weightGrams: z.number().int().min(0).max(500000).nullable().optional(),
      notes: z.string().trim().max(1200).nullable().optional(),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const encontrada = await db.select().from(coletas).where(and(eq(coletas.id, input.id), eq(coletas.condominioId, ctx.eco.condominio.id))).limit(1);
      const coleta = encontrada[0];
      if (!coleta) throw new TRPCError({ code: "NOT_FOUND", message: "Coleta não encontrada." });
      let conclusao;
      try {
        conclusao = prepareCollectionCompletion(
          { status: input.status, weightGrams: input.weightGrams, notes: input.notes },
          { weightGrams: coleta.pesoGramas, notes: coleta.observacoes, wasteType: coleta.tipoResiduo },
        );
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Não foi possível concluir a coleta." });
      }
      const novoPeso = conclusao.weightGrams;
      const novosPontos = conclusao.pointsAwarded;
      const deltaPontos = novosPontos - coleta.pontosConcedidos;
      const concluidaEm = conclusao.completedAt ? new Date() : null;
      await db.update(coletas).set({
        status: input.status,
        pesoGramas: novoPeso,
        pontosConcedidos: novosPontos,
        concluidaEm,
        coletorId: coleta.coletorId ?? ctx.user.id,
        observacoes: conclusao.notes,
        atualizadoEm: new Date(),
      }).where(eq(coletas.id, coleta.id));
      await writeAuditLog(db, {
        condominioId: ctx.eco.condominio.id,
        autorId: ctx.user.id,
        tipoEntidade: "coleta",
        entidadeId: coleta.id,
        acao: "coleta_atualizada",
        resumo: `Coleta atualizada para o status ${input.status}.`,
        estadoAnterior: collectionAuditState({ status: coleta.status, pesoGramas: coleta.pesoGramas, pontosConcedidos: coleta.pontosConcedidos, coletorId: coleta.coletorId, agendadaPara: coleta.agendadaPara, concluidaEm: coleta.concluidaEm, observacoes: coleta.observacoes }),
        estadoNovo: {
          status: input.status,
          pesoGramas: novoPeso,
          pontosConcedidos: novosPontos,
          coletorId: coleta.coletorId ?? ctx.user.id,
          concluidaEm,
          observacoes: conclusao.notes,
        },
      });

      if (coleta.moradorId && deltaPontos !== 0) {
        await db.update(moradores).set({ pontos: sql`${moradores.pontos} + ${deltaPontos}`, atualizadoEm: new Date() }).where(eq(moradores.id, coleta.moradorId));
      }
      if (coleta.moradorId) {
        const morador = await db.select().from(moradores).where(eq(moradores.id, coleta.moradorId)).limit(1);
        if (morador[0]?.usuarioId) {
          await db.insert(notificacoes).values({
            condominioId: ctx.eco.condominio.id,
            destinatarioId: morador[0].usuarioId,
            coletaId: coleta.id,
            tipo: input.status === "concluida" ? "coleta_concluida" : "sistema",
            titulo: input.status === "concluida" ? "Coleta concluída" : "Atualização de coleta",
            mensagem: input.status === "concluida" ? `Sua coleta foi concluída${novosPontos ? ` e gerou ${novosPontos} ponto(s).` : "."}` : `O status da sua coleta foi atualizado para ${input.status}.`,
          });
        }
      }
      return { success: true, pointsAwarded: novosPontos };
    }),
  }),
});

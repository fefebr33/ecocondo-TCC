import { TRPCError } from "@trpc/server";
import QRCode from "qrcode";
import { customAlphabet } from "nanoid";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { coletas, statusColeta, notificacoes, pessoas, moradores, statusMorador, perfisAcesso, usuarios, tiposResiduo } from "../../drizzle/schema";
import { getDb } from "../db";

const gerarCodigoMorador = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 8);
import { administratorOnly, staffOnly, withProfile } from "./nucleo";
import { router } from "../_core/trpc";
import { calculateCollectionPoints, prepareCollectionCompletion, resolveCollectorAssignment } from "../dominio/regrasColeta";
import { buildPendingResidentPerson } from "../dominio/regrasPessoas";
import { collectionAuditState, writeAuditLog } from "../audit";
import { salvarImagemBase64 } from "../storage";
import {
  LIMITE_PESO_POR_COLETA_GRAMAS,
  LimiteAntifraudeExcedidoError,
  ehPesoAnomalo,
  verificarLimiteDiarioMorador,
  verificarLimitePorColeta,
  verificarSegregacaoDeFuncao,
} from "../dominio/antifraude";

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
    /** Gera (na primeira vez) e devolve o código + QR code do apartamento, para o coletor escanear em vez de escolher o morador numa lista. */
    codigoQr: staffOnly.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const db = await getDb();
      const encontrado = await db.select().from(moradores).where(and(eq(moradores.id, input.id), eq(moradores.condominioId, ctx.eco.condominio.id))).limit(1);
      const morador = encontrado[0];
      if (!morador) throw new TRPCError({ code: "NOT_FOUND", message: "Morador não encontrado." });
      let codigo = morador.codigoAcesso;
      if (!codigo) {
        codigo = gerarCodigoMorador();
        await db.update(moradores).set({ codigoAcesso: codigo, atualizadoEm: new Date() }).where(eq(moradores.id, morador.id));
      }
      const qrDataUrl = await QRCode.toDataURL(codigo, { margin: 1, width: 220 });
      return { code: codigo, qrDataUrl };
    }),
    porCodigo: staffOnly.input(z.object({ code: z.string().trim().min(1).max(32) })).query(async ({ ctx, input }) => {
      const db = await getDb();
      const encontrado = await db.select().from(moradores).where(and(eq(moradores.codigoAcesso, input.code.toUpperCase()), eq(moradores.condominioId, ctx.eco.condominio.id))).limit(1);
      if (!encontrado[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Nenhum morador encontrado para este código." });
      return encontrado[0];
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
      const inicioDeHoje = new Date();
      inicioDeHoje.setHours(0, 0, 0, 0);
      if (input.scheduledAt < inicioDeHoje) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A data da coleta não pode ser anterior a hoje." });
      }
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
      weightGrams: z.number().int().min(0).max(LIMITE_PESO_POR_COLETA_GRAMAS).nullable().optional(),
      notes: z.string().trim().max(1200).nullable().optional(),
      imageDataUrl: z.string().max(5_500_000).nullable().optional(),
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

      if (input.status === "concluida" && !coleta.chaveFoto && !input.imageDataUrl) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Anexe uma foto da coleta para concluir." });
      }
      let foto: { key: string | null; url: string | null } = { key: coleta.chaveFoto, url: coleta.urlFoto };
      if (input.imageDataUrl) {
        try {
          foto = await salvarImagemBase64(input.imageDataUrl, `coletas/${ctx.eco.condominio.id}/${coleta.id}`);
        } catch (error) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Não foi possível salvar a foto da coleta." });
        }
      }

      let moradorBeneficiado = null;
      if (coleta.moradorId) {
        const encontrado = await db.select().from(moradores).where(eq(moradores.id, coleta.moradorId)).limit(1);
        moradorBeneficiado = encontrado[0] ?? null;
      }
      let pesoAnomalo = false;
      if (input.status === "concluida" && conclusao.weightGrams) {
        try {
          verificarSegregacaoDeFuncao(ctx.user.id, moradorBeneficiado?.usuarioId);
          verificarLimitePorColeta(conclusao.weightGrams);
          if (coleta.moradorId) {
            const inicioDoDia = new Date();
            inicioDoDia.setHours(0, 0, 0, 0);
            const concluidasHoje = await db.select().from(coletas).where(and(eq(coletas.moradorId, coleta.moradorId), eq(coletas.status, "concluida"), gte(coletas.concluidaEm, inicioDoDia)));
            const pesoJaConcluidoHoje = concluidasHoje.filter((registro) => registro.id !== coleta.id).reduce((soma, registro) => soma + (registro.pesoGramas ?? 0), 0);
            verificarLimiteDiarioMorador(pesoJaConcluidoHoje, conclusao.weightGrams);
            const historico = await db.select().from(coletas).where(and(eq(coletas.moradorId, coleta.moradorId), eq(coletas.status, "concluida"))).orderBy(desc(coletas.concluidaEm)).limit(10);
            const pesosHistoricos = historico.filter((registro) => registro.id !== coleta.id).map((registro) => registro.pesoGramas ?? 0);
            const mediaHistorica = pesosHistoricos.length ? pesosHistoricos.reduce((soma, peso) => soma + peso, 0) / pesosHistoricos.length : 0;
            pesoAnomalo = ehPesoAnomalo(conclusao.weightGrams, mediaHistorica);
          }
        } catch (error) {
          if (error instanceof LimiteAntifraudeExcedidoError) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
          throw error;
        }
      }

      const novoPeso = conclusao.weightGrams;
      // Peso anômalo em uma coleta concluída: os pontos ficam retidos até a aprovação de um segundo administrador (dupla aprovação).
      const pontosCalculados = conclusao.pointsAwarded;
      const novosPontos = pesoAnomalo ? 0 : pontosCalculados;
      const deltaPontos = novosPontos - coleta.pontosConcedidos;
      const concluidaEm = conclusao.completedAt ? new Date() : null;
      await db.update(coletas).set({
        status: input.status,
        pesoGramas: novoPeso,
        pontosConcedidos: novosPontos,
        concluidaEm,
        coletorId: coleta.coletorId ?? ctx.user.id,
        concluidoPorId: input.status === "concluida" ? ctx.user.id : null,
        observacoes: conclusao.notes,
        chaveFoto: foto.key,
        urlFoto: foto.url,
        pendenteAprovacaoPeso: pesoAnomalo,
        aprovacaoPesoStatus: pesoAnomalo ? "pendente" : coleta.aprovacaoPesoStatus === "pendente" ? null : coleta.aprovacaoPesoStatus,
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
      if (pesoAnomalo) {
        await writeAuditLog(db, {
          condominioId: ctx.eco.condominio.id,
          autorId: ctx.user.id,
          tipoEntidade: "coleta",
          entidadeId: coleta.id,
          acao: "coleta_sinalizada_suspeita",
          resumo: `Peso informado (${((novoPeso ?? 0) / 1000).toFixed(1)} kg) muito acima do histórico do morador. Pontos retidos até aprovação de um segundo administrador.`,
          estadoNovo: { pesoGramas: novoPeso, moradorId: coleta.moradorId, pontosPendentes: pontosCalculados },
        });
        // Avisa os demais administradores: quem concluiu a coleta não pode aprovar o próprio lançamento.
        const administradores = await db.select({ usuarioId: perfisAcesso.usuarioId }).from(perfisAcesso).where(and(eq(perfisAcesso.condominioId, ctx.eco.condominio.id), eq(perfisAcesso.papel, "administrador")));
        for (const administrador of administradores) {
          if (administrador.usuarioId === ctx.user.id) continue;
          await db.insert(notificacoes).values({
            condominioId: ctx.eco.condominio.id,
            destinatarioId: administrador.usuarioId,
            coletaId: coleta.id,
            tipo: "sistema",
            titulo: "Peso aguardando aprovação",
            mensagem: `Uma coleta de ${coleta.tipoResiduo} do bloco ${coleta.bloco} foi concluída com ${((novoPeso ?? 0) / 1000).toFixed(1)} kg, bem acima do histórico do morador. Revise em Coletas > Pesos pendentes de aprovação.`,
          });
        }
      }

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
            mensagem: pesoAnomalo
              ? "Sua coleta foi concluída. O peso está acima do padrão histórico e os pontos ficarão pendentes até a revisão de um administrador."
              : input.status === "concluida" ? `Sua coleta foi concluída${novosPontos ? ` e gerou ${novosPontos} ponto(s).` : "."}` : `O status da sua coleta foi atualizado para ${input.status}.`,
          });
        }
      }
      return { success: true, pointsAwarded: novosPontos, pendingApproval: pesoAnomalo };
    }),
    listarPendentesAprovacao: administratorOnly.query(async ({ ctx }) => {
      const db = await getDb();
      const registros = await db.select().from(coletas).where(and(eq(coletas.condominioId, ctx.eco.condominio.id), eq(coletas.pendenteAprovacaoPeso, true))).orderBy(desc(coletas.concluidaEm));
      const moradorIds = Array.from(new Set(registros.map((registro) => registro.moradorId).filter((id): id is number => id !== null)));
      const moradoresRelacionados = moradorIds.length ? await db.select().from(moradores).where(eq(moradores.condominioId, ctx.eco.condominio.id)) : [];
      return registros.map((registro) => ({
        ...registro,
        pontosCalculados: calculateCollectionPoints(registro.status, registro.tipoResiduo, registro.pesoGramas),
        residentName: moradoresRelacionados.find((morador) => morador.id === registro.moradorId)?.nome ?? null,
      }));
    }),
    decidirAprovacaoPeso: administratorOnly.input(z.object({
      id: z.number().int().positive(),
      aprovar: z.boolean(),
      observacao: z.string().trim().max(500).nullable().optional(),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const encontrada = await db.select().from(coletas).where(and(eq(coletas.id, input.id), eq(coletas.condominioId, ctx.eco.condominio.id))).limit(1);
      const coleta = encontrada[0];
      if (!coleta) throw new TRPCError({ code: "NOT_FOUND", message: "Coleta não encontrada." });
      if (!coleta.pendenteAprovacaoPeso) throw new TRPCError({ code: "BAD_REQUEST", message: "Esta coleta não está pendente de aprovação." });
      if ((coleta.concluidoPorId ?? coleta.coletorId) === ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Quem concluiu a coleta não pode ser quem aprova o peso suspeito. Peça para outro administrador revisar." });
      }

      const pontosCalculados = calculateCollectionPoints(coleta.status, coleta.tipoResiduo, coleta.pesoGramas);
      const novosPontos = input.aprovar ? pontosCalculados : 0;
      const deltaPontos = novosPontos - coleta.pontosConcedidos;

      await db.update(coletas).set({
        pendenteAprovacaoPeso: false,
        aprovacaoPesoStatus: input.aprovar ? "aprovado" : "rejeitado",
        aprovacaoPesoPorId: ctx.user.id,
        aprovacaoPesoEm: new Date(),
        pontosConcedidos: novosPontos,
        atualizadoEm: new Date(),
      }).where(eq(coletas.id, coleta.id));

      if (coleta.moradorId && deltaPontos !== 0) {
        await db.update(moradores).set({ pontos: sql`${moradores.pontos} + ${deltaPontos}`, atualizadoEm: new Date() }).where(eq(moradores.id, coleta.moradorId));
      }

      await writeAuditLog(db, {
        condominioId: ctx.eco.condominio.id,
        autorId: ctx.user.id,
        tipoEntidade: "coleta",
        entidadeId: coleta.id,
        acao: input.aprovar ? "peso_suspeito_aprovado" : "peso_suspeito_rejeitado",
        resumo: input.aprovar
          ? `Peso suspeito aprovado por segundo administrador; ${novosPontos} ponto(s) liberado(s).`
          : "Peso suspeito rejeitado por segundo administrador; nenhum ponto concedido.",
        estadoNovo: { aprovacaoPesoStatus: input.aprovar ? "aprovado" : "rejeitado", pontosConcedidos: novosPontos, observacao: input.observacao || null },
      });

      if (coleta.moradorId) {
        const morador = await db.select().from(moradores).where(eq(moradores.id, coleta.moradorId)).limit(1);
        if (morador[0]?.usuarioId) {
          await db.insert(notificacoes).values({
            condominioId: ctx.eco.condominio.id,
            destinatarioId: morador[0].usuarioId,
            coletaId: coleta.id,
            tipo: "sistema",
            titulo: input.aprovar ? "Pontos liberados" : "Coleta revisada",
            mensagem: input.aprovar
              ? `O peso da sua coleta foi revisado e aprovado. ${novosPontos} ponto(s) foram creditados.`
              : "O peso da sua coleta foi revisado e não pôde ser confirmado. Nenhum ponto foi concedido para este lançamento.",
          });
        }
      }
      return { success: true, pointsAwarded: novosPontos };
    }),
  }),
});

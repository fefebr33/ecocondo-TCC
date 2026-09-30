import { TRPCError } from "@trpc/server";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { condominios, moradores, notificacoes, papeisEco, preferenciasNotificacao, regrasResiduo, tiposNotificacao, tiposResiduo } from "../../drizzle/schema";
import { PESO_MAXIMO_CONFIGURAVEL_GRAMAS, PONTOS_POR_KG_MAXIMO } from "@shared/descarte";
import { rotuloResiduo } from "@shared/rotulos";
import { tiposPorPerfil } from "@shared/notificacoes";
import { getDb } from "../db";
import { router } from "../_core/trpc";
import { writeAuditLog } from "../audit";
import { movimentarPontos } from "../pontos";
import { NOTIFICACOES_OBRIGATORIAS, notificarUsuario } from "../notificacoes";
import { regrasDoCondominio } from "../regrasResiduo";
import { administratorOnly, withProfile } from "./nucleo";

const confirmacaoZerar = "ZERAR";

/** Regras de cada tipo de descarte, controle de pontos (zerar o ciclo, ajustar um morador) e quem recebe cada notificação. */
export const configuracoesDescarteRouter = router({
  regrasDescarte: router({
    listar: withProfile.query(async ({ ctx }) => Object.values(await regrasDoCondominio(ctx.eco.condominio.id))),
    salvar: administratorOnly.input(z.object({
      wasteType: z.enum(tiposResiduo),
      minGrams: z.number().int().min(1).max(PESO_MAXIMO_CONFIGURAVEL_GRAMAS),
      maxGrams: z.number().int().min(1).max(PESO_MAXIMO_CONFIGURAVEL_GRAMAS),
      pointsPerKg: z.number().min(0).max(PONTOS_POR_KG_MAXIMO),
    }).refine((input) => input.maxGrams > input.minGrams, { message: "O peso máximo precisa ser maior que o mínimo.", path: ["maxGrams"] })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const anterior = (await regrasDoCondominio(ctx.eco.condominio.id))[input.wasteType];
      const pontosPorKg = Math.round(input.pointsPerKg * 100) / 100;
      await db.insert(regrasResiduo).values({ condominioId: ctx.eco.condominio.id, tipoResiduo: input.wasteType, pesoMinimoGramas: input.minGrams, pesoMaximoGramas: input.maxGrams, pontosPorKg })
        .onDuplicateKeyUpdate({ set: { pesoMinimoGramas: input.minGrams, pesoMaximoGramas: input.maxGrams, pontosPorKg, atualizadoEm: new Date() } });
      await writeAuditLog(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "configuracao", entidadeId: ctx.eco.condominio.id, acao: "regra_descarte_alterada", resumo: `Regra de ${rotuloResiduo[input.wasteType]} alterada: ${input.minGrams / 1000} a ${input.maxGrams / 1000} kg, ${pontosPorKg} ponto(s) por kg.`, estadoAnterior: { pesoMinimoGramas: anterior.pesoMinimoGramas, pesoMaximoGramas: anterior.pesoMaximoGramas, pontosPorKg: anterior.pontosPorKg }, estadoNovo: { pesoMinimoGramas: input.minGrams, pesoMaximoGramas: input.maxGrams, pontosPorKg } });
      return { success: true };
    }),
    restaurarPadrao: administratorOnly.input(z.object({ wasteType: z.enum(tiposResiduo) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      await db.delete(regrasResiduo).where(and(eq(regrasResiduo.condominioId, ctx.eco.condominio.id), eq(regrasResiduo.tipoResiduo, input.wasteType)));
      await writeAuditLog(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "configuracao", entidadeId: ctx.eco.condominio.id, acao: "regra_descarte_padrao", resumo: `Regra de ${rotuloResiduo[input.wasteType]} voltou ao padrão.` });
      return { success: true };
    }),
  }),
  pontos: router({
    ciclo: withProfile.query(async ({ ctx }) => {
      const db = await getDb();
      const [condominio] = await db.select({ zeradoEm: condominios.pontosZeradosEm }).from(condominios).where(eq(condominios.id, ctx.eco.condominio.id)).limit(1);
      return { zeradoEm: condominio?.zeradoEm ?? null };
    }),
    /**
     * Zera o saldo de todos os moradores para começar um novo ciclo (ex.: depois da entrega das cestas de fim de ano).
     * Cada saldo zerado vira uma linha "zeragem" no extrato, e o ranking geral passa a contar só a partir de agora.
     */
    zerarTodos: administratorOnly.input(z.object({ confirmation: z.string(), reason: z.string().trim().min(10, "Explique o motivo (ex.: novo ciclo depois da entrega dos prêmios).").max(500) })).mutation(async ({ ctx, input }) => {
      if (input.confirmation.trim().toUpperCase() !== confirmacaoZerar) throw new TRPCError({ code: "BAD_REQUEST", message: `Digite ${confirmacaoZerar} para confirmar.` });
      const db = await getDb();
      const agora = new Date();
      const comSaldo = await db.select({ id: moradores.id, nome: moradores.nome, usuarioId: moradores.usuarioId, pontos: moradores.pontos }).from(moradores).where(and(eq(moradores.condominioId, ctx.eco.condominio.id), gt(moradores.pontos, 0)));
      let totalZerado = 0;
      await db.transaction(async (tx) => {
        for (const morador of comSaldo) {
          await movimentarPontos(tx, { condominioId: ctx.eco.condominio.id, moradorId: morador.id, tipo: "zeragem", pontos: -morador.pontos, autorId: ctx.user.id, descricao: `Pontos zerados: novo ciclo. ${input.reason}` });
          totalZerado += morador.pontos;
        }
        await tx.update(condominios).set({ pontosZeradosEm: agora, atualizadoEm: agora }).where(eq(condominios.id, ctx.eco.condominio.id));
        // As frações guardadas também recomeçam do zero no novo ciclo.
        await tx.update(moradores).set({ restoPontosMilesimos: 0 }).where(eq(moradores.condominioId, ctx.eco.condominio.id));
      });
      await writeAuditLog(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "pontos", entidadeId: ctx.eco.condominio.id, acao: "pontos_zerados", resumo: `Pontos de ${comSaldo.length} morador(es) zerados (${totalZerado} ponto(s) no total). Novo ciclo começou.`, motivo: input.reason, estadoAnterior: { saldos: comSaldo.map((morador) => ({ moradorId: morador.id, pontos: morador.pontos })) }, estadoNovo: { cicloIniciadoEm: agora } });
      await db.insert(notificacoes).values({ condominioId: ctx.eco.condominio.id, destinatarioId: null, tipo: "pontos_zerados", titulo: "Novo ciclo de pontos", mensagem: `A administração zerou os pontos de todos para começar um novo ciclo. Motivo: ${input.reason}` });
      return { moradores: comSaldo.length, pontos: totalZerado, zeradoEm: agora };
    }),
    /** Crédito ou débito manual no saldo de um morador (correção de erro, bonificação de campanha), sempre com motivo e no extrato. */
    ajustar: administratorOnly.input(z.object({ residentId: z.number().int().positive(), points: z.number().int().min(-10000).max(10000).refine((valor) => valor !== 0, "Informe um valor diferente de zero."), reason: z.string().trim().min(10, "Explique o motivo do ajuste.").max(500) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [morador] = await db.select().from(moradores).where(and(eq(moradores.id, input.residentId), eq(moradores.condominioId, ctx.eco.condominio.id))).limit(1);
      if (!morador) throw new TRPCError({ code: "NOT_FOUND", message: "Morador não encontrado." });
      if (morador.pontos + input.points < 0) throw new TRPCError({ code: "BAD_REQUEST", message: `O saldo de ${morador.nome} é ${morador.pontos}; o débito não pode deixar o saldo negativo.` });
      const saldo = await db.transaction((tx) => movimentarPontos(tx, { condominioId: ctx.eco.condominio.id, moradorId: morador.id, tipo: "ajuste", pontos: input.points, autorId: ctx.user.id, descricao: `Ajuste da administração: ${input.reason}`, exigirSaldo: true }));
      if (saldo === null) throw new TRPCError({ code: "CONFLICT", message: "O saldo mudou enquanto você ajustava. Tente de novo." });
      await writeAuditLog(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "pontos", entidadeId: morador.id, acao: "pontos_ajustados", resumo: `${input.points > 0 ? "+" : ""}${input.points} ponto(s) para ${morador.nome}.`, motivo: input.reason, estadoAnterior: { saldo: morador.pontos }, estadoNovo: { saldo } });
      await notificarUsuario(db, morador.usuarioId, { condominioId: ctx.eco.condominio.id, tipo: "pontos_ajustados", titulo: "Ajuste nos seus pontos", mensagem: `A administração ${input.points > 0 ? "creditou" : "debitou"} ${Math.abs(input.points)} ponto(s). Motivo: ${input.reason}. Saldo atual: ${saldo}.` });
      return { saldo };
    }),
  }),
  preferenciasNotificacao: router({
    listar: administratorOnly.query(async ({ ctx }) => {
      const db = await getDb();
      const salvas = await db.select().from(preferenciasNotificacao).where(eq(preferenciasNotificacao.condominioId, ctx.eco.condominio.id));
      return papeisEco.flatMap((papel) => tiposPorPerfil[papel].map((tipo) => ({
        papel,
        tipo,
        obrigatoria: NOTIFICACOES_OBRIGATORIAS.includes(tipo),
        ativo: NOTIFICACOES_OBRIGATORIAS.includes(tipo) || (salvas.find((linha) => linha.papel === papel && linha.tipo === tipo)?.ativo ?? true),
      })));
    }),
    salvar: administratorOnly.input(z.object({ role: z.enum(papeisEco), type: z.enum(tiposNotificacao), active: z.boolean() })).mutation(async ({ ctx, input }) => {
      if (NOTIFICACOES_OBRIGATORIAS.includes(input.type) && !input.active) throw new TRPCError({ code: "BAD_REQUEST", message: "Este aviso é obrigatório: afeta os pontos ou é um caso grave." });
      if (!tiposPorPerfil[input.role].includes(input.type)) throw new TRPCError({ code: "BAD_REQUEST", message: "Este perfil não recebe este tipo de aviso." });
      const db = await getDb();
      await db.insert(preferenciasNotificacao).values({ condominioId: ctx.eco.condominio.id, papel: input.role, tipo: input.type, ativo: input.active }).onDuplicateKeyUpdate({ set: { ativo: input.active, atualizadoEm: new Date() } });
      await writeAuditLog(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "configuracao", entidadeId: ctx.eco.condominio.id, acao: "preferencia_notificacao", resumo: `Aviso "${input.type}" ${input.active ? "ligado" : "desligado"} para ${input.role === "administrador" ? "administradores" : "moradores"}.` });
      return { success: true };
    }),
  }),
});

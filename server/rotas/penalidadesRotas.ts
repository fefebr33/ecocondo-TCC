import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { modelosPenalidade, moradores, penalidades, tiposPenalidade, unidadesDuracao } from "../../drizzle/schema";
import { rotuloTipoPenalidade } from "@shared/rotulos";
import { getDb } from "../db";
import { router } from "../_core/trpc";
import { writeAuditLog } from "../audit";
import { movimentarPontos } from "../pontos";
import { notificarAdministradores, notificarUsuario } from "../notificacoes";
import { aplicarPenalidade, historicoPenalidades, modelosDoCondominio } from "../penalidades";
import { administratorOnly, withProfile } from "./nucleo";

const modeloInput = z.object({
  id: z.number().int().positive().optional(),
  nome: z.string().trim().min(3).max(120),
  tipo: z.enum(tiposPenalidade),
  pontos: z.number().int().min(1).max(100_000).nullable().optional(),
  duracaoValor: z.number().int().min(1).max(365).nullable().optional(),
  duracaoUnidade: z.enum(unidadesDuracao).nullable().optional(),
  descricao: z.string().trim().max(500).nullable().optional(),
  ativo: z.boolean().default(true),
}).refine((modelo) => modelo.tipo !== "perda_pontos" || Boolean(modelo.pontos), { message: "Informe quantos pontos a medida retira.", path: ["pontos"] })
  .refine((modelo) => !["suspensao_campanhas", "suspensao_participacao"].includes(modelo.tipo) || Boolean(modelo.duracaoValor && modelo.duracaoUnidade), { message: "Informe por quanto tempo vale a suspensão.", path: ["duracaoValor"] });

/** Medidas administrativas: catálogo de medidas pré-definidas (configurável) e aplicação/revogação com histórico. */
export const penalidadesRouter = router({
  penalidades: router({
    modelos: administratorOnly.input(z.object({ somenteAtivos: z.boolean().optional() }).optional()).query(async ({ ctx, input }) => {
      return modelosDoCondominio(await getDb(), ctx.eco.condominio.id, input?.somenteAtivos ?? false);
    }),
    salvarModelo: administratorOnly.input(modeloInput).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const valores = { nome: input.nome, tipo: input.tipo, pontos: input.tipo === "perda_pontos" ? input.pontos ?? null : null, duracaoValor: input.tipo === "perda_pontos" || input.tipo === "advertencia" ? null : input.duracaoValor ?? null, duracaoUnidade: input.tipo === "perda_pontos" || input.tipo === "advertencia" ? null : input.duracaoUnidade ?? null, descricao: input.descricao || null, ativo: input.ativo };
      let id = input.id ?? 0;
      let anterior = null;
      if (input.id) {
        [anterior] = await db.select().from(modelosPenalidade).where(and(eq(modelosPenalidade.id, input.id), eq(modelosPenalidade.condominioId, ctx.eco.condominio.id))).limit(1);
        if (!anterior) throw new TRPCError({ code: "NOT_FOUND", message: "Medida não encontrada." });
        await db.update(modelosPenalidade).set({ ...valores, atualizadoEm: new Date() }).where(eq(modelosPenalidade.id, input.id));
      } else {
        await modelosDoCondominio(db, ctx.eco.condominio.id);
        const [inserido] = await db.insert(modelosPenalidade).values({ ...valores, condominioId: ctx.eco.condominio.id }).$returningId();
        id = inserido.id;
      }
      await writeAuditLog(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "penalidade", entidadeId: id, acao: input.id ? "modelo_penalidade_alterado" : "modelo_penalidade_criado", resumo: `Medida pré-definida "${input.nome}" (${rotuloTipoPenalidade[input.tipo]}) ${input.id ? "alterada" : "criada"}${input.ativo ? "" : " e desativada"}.`, estadoAnterior: anterior, estadoNovo: valores });
      return { id };
    }),
    /** Histórico de medidas: o administrador vê todas (ou as de um morador); o morador vê só as próprias. */
    listar: withProfile.input(z.object({ moradorId: z.number().int().positive().optional() }).optional()).query(async ({ ctx, input }) => {
      const db = await getDb();
      if (ctx.eco.perfil.papel === "administrador") return historicoPenalidades(db, ctx.eco.condominio.id, input?.moradorId);
      if (!ctx.eco.morador) return [];
      return historicoPenalidades(db, ctx.eco.condominio.id, ctx.eco.morador.id);
    }),
    aplicar: administratorOnly.input(z.object({
      moradorId: z.number().int().positive(),
      modeloId: z.number().int().positive().optional(),
      personalizada: z.object({ tipo: z.enum(tiposPenalidade), nome: z.string().trim().min(3).max(120), pontos: z.number().int().min(1).max(100_000).nullable().optional(), duracaoValor: z.number().int().min(1).max(365).nullable().optional(), duracaoUnidade: z.enum(unidadesDuracao).nullable().optional() }).optional(),
      motivo: z.string().trim().min(10, "Descreva o motivo com pelo menos 10 caracteres.").max(1000),
      coletaId: z.number().int().positive().optional(),
      ocorrenciaId: z.number().int().positive().optional(),
    })).mutation(async ({ ctx, input }) => {
      return aplicarPenalidade(await getDb(), { ...input, condominioId: ctx.eco.condominio.id, autorId: ctx.user.id });
    }),
    /** Revoga uma medida aplicada por engano: suspensões param na hora e os pontos retirados voltam ao saldo. */
    revogar: administratorOnly.input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(10).max(1000) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [penalidade] = await db.select().from(penalidades).where(and(eq(penalidades.id, input.id), eq(penalidades.condominioId, ctx.eco.condominio.id))).limit(1);
      if (!penalidade) throw new TRPCError({ code: "NOT_FOUND", message: "Medida não encontrada." });
      if (penalidade.status === "revogada") throw new TRPCError({ code: "BAD_REQUEST", message: "Esta medida já foi revogada." });
      const agora = new Date();
      await db.transaction(async (tx) => {
        const [alteracao] = await tx.update(penalidades).set({ status: "revogada", revogadaPorId: ctx.user.id, revogadaEm: agora, motivoRevogacao: input.motivo }).where(and(eq(penalidades.id, penalidade.id), eq(penalidades.status, penalidade.status)));
        if (!alteracao.affectedRows) throw new TRPCError({ code: "CONFLICT", message: "A medida acabou de ser alterada. Atualize a página." });
        if (penalidade.tipo === "perda_pontos" && penalidade.pontos) {
          await movimentarPontos(tx, { condominioId: penalidade.condominioId, moradorId: penalidade.moradorId, tipo: "ajuste", pontos: penalidade.pontos, penalidadeId: penalidade.id, autorId: ctx.user.id, descricao: `Devolução: medida "${penalidade.nome}" revogada` });
        }
      });
      await writeAuditLog(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "penalidade", entidadeId: penalidade.id, acao: "penalidade_revogada", resumo: `Medida "${penalidade.nome}" revogada${penalidade.tipo === "perda_pontos" && penalidade.pontos ? `; ${penalidade.pontos} ponto(s) devolvido(s)` : ""}.`, estadoAnterior: { status: penalidade.status }, estadoNovo: { status: "revogada" }, motivo: input.motivo });
      const [morador] = await db.select({ usuarioId: moradores.usuarioId, nome: moradores.nome, bloco: moradores.bloco }).from(moradores).where(eq(moradores.id, penalidade.moradorId)).limit(1);
      const devolvidos = penalidade.tipo === "perda_pontos" && penalidade.pontos ? ` Os ${penalidade.pontos} ponto(s) voltaram ao seu saldo e à sua pontuação do pódio.` : "";
      const voltaAoNormal = penalidade.tipo === "suspensao_participacao" ? " Sua participação voltou ao normal: campanhas, resgates e pontos dos descartes, e o seu nome volta a aparecer no pódio conforme a sua escolha." : "";
      await notificarUsuario(db, morador?.usuarioId ?? null, { condominioId: ctx.eco.condominio.id, tipo: "penalidade_encerrada", titulo: "Medida revogada", mensagem: `A administração revogou a medida "${penalidade.nome}".${devolvidos}${voltaAoNormal} Motivo: ${input.motivo}` });
      await notificarAdministradores(db, { condominioId: ctx.eco.condominio.id, tipo: "penalidade_encerrada", titulo: "Medida revogada", mensagem: `A medida "${penalidade.nome}" de ${morador?.nome ?? "um morador"}${morador?.bloco ? ` (bloco ${morador.bloco})` : ""} foi revogada. Motivo: ${input.motivo}` }, ctx.user.id);
      return { success: true };
    }),
  }),
});

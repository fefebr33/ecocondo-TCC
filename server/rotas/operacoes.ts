import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or } from "drizzle-orm";
import { z } from "zod";
import { coletas, estacoesPesagem, statusColeta, pessoas, moradores, statusMorador, usuarios, tiposResiduo } from "../../drizzle/schema";
import type { Coleta } from "../../drizzle/schema";
import { getDb } from "../db";
import { residuoNaFrase } from "@shared/rotulos";

import { administratorOnly, withProfile } from "./nucleo";
import { router } from "../_core/trpc";
import { buildPendingResidentPerson } from "../dominio/regrasPessoas";
import { writeAuditLog } from "../audit";
import { MovimentacaoDuplicadaError, movimentarPontos } from "../pontos";
import { notificarAdministradores, notificarUsuario } from "../notificacoes";
import { regrasDoCondominio } from "../regrasResiduo";
import { pontosDoDescarte, situacaoDescarte } from "@shared/descarte";

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
  situacao: z.enum(["pendente", "aprovado", "reprovado", "auditoria", "cancelado"]).optional(),
  /** Nome, apartamento, bloco ou número do descarte. */
  search: z.string().trim().max(120).optional(),
  residentId: z.number().int().positive().optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
});

/** Busca sem diferenciar maiúsculas nem acentos ("luisa" encontra "Luísa"). */
function normalizar(texto: string) {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/**
 * Descreve de onde veio cada registro: estação de pesagem (o próprio morador), coletor (só coletas antigas,
 * de antes da retirada do perfil) ou administração.
 */
export async function origensDosRegistros(condominioId: number, registros: Array<typeof coletas.$inferSelect>) {
  const db = await getDb();
  const estacoes = registros.some((registro) => registro.estacaoId !== null)
    ? await db.select({ id: estacoesPesagem.id, nome: estacoesPesagem.nome }).from(estacoesPesagem).where(eq(estacoesPesagem.condominioId, condominioId))
    : [];
  const idsColetores = Array.from(new Set(registros.map((registro) => registro.coletorId).filter((id): id is number => id !== null)));
  const coletores = idsColetores.length ? await db.select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios).where(inArray(usuarios.id, idsColetores)) : [];
  return (registro: typeof coletas.$inferSelect) => {
    if (registro.estacaoId !== null) return `Estação: ${estacoes.find((estacao) => estacao.id === registro.estacaoId)?.nome ?? "removida"}`;
    if (registro.coletorId !== null) return `Coletor: ${coletores.find((coletor) => coletor.id === registro.coletorId)?.nome ?? "sem nome"} (histórico)`;
    return "Administração";
  };
}

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
      }).$returningId();
      await writeAuditLog(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "morador", entidadeId: inserido[0].id, acao: "morador_cadastrado", resumo: `Morador ${input.name} cadastrado (bloco ${input.block}, apto. ${input.apartment}).`, estadoNovo: { nome: input.name, bloco: input.block, apartamento: input.apartment, status: input.status } });
      await notificarAdministradores(db, { condominioId: ctx.eco.condominio.id, tipo: "novo_cadastro", titulo: "Novo morador cadastrado", mensagem: `${input.name} (bloco ${input.block}, apto. ${input.apartment}) foi cadastrado.` }, ctx.user.id);
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
      const antes = { nome: existente[0].nome, bloco: existente[0].bloco, apartamento: existente[0].apartamento, status: existente[0].status, email: existente[0].email, telefone: existente[0].telefone };
      const depois = { nome: atualizacao.name ?? existente[0].nome, bloco: atualizacao.block ?? existente[0].bloco, apartamento: atualizacao.apartment ?? existente[0].apartamento, status: atualizacao.status ?? existente[0].status, email: proximoEmail, telefone: proximoTelefone };
      const alterados = (Object.keys(antes) as Array<keyof typeof antes>).filter((campo) => antes[campo] !== depois[campo]);
      if (alterados.length) {
        await writeAuditLog(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "morador", entidadeId: id, acao: "morador_atualizado", resumo: `Cadastro de ${depois.nome} alterado (${alterados.join(", ")}).`, estadoAnterior: antes, estadoNovo: depois });
        const rotulos: Record<string, string> = { nome: "nome", bloco: "bloco", apartamento: "apartamento", status: "situação", email: "e-mail", telefone: "telefone" };
        await notificarUsuario(db, existente[0].usuarioId, { condominioId: ctx.eco.condominio.id, tipo: "cadastro_alterado", titulo: "Seu cadastro foi alterado", mensagem: `A administração alterou ${alterados.map((campo) => rotulos[campo]).join(", ")} do seu cadastro. Se algo estiver errado, fale com o síndico.` });
      }
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
    /**
     * Descartes com filtros (tipo, bloco, situação, período, nome ou apartamento do morador). O morador só vê os dele;
     * o administrador vê todos e pode filtrar por um morador.
     */
    listar: withProfile.input(filtrosColeta.optional()).query(async ({ ctx, input }) => {
      const db = await getDb();
      const condicoes = [eq(coletas.condominioId, ctx.eco.condominio.id)];
      if (ctx.eco.perfil.papel === "morador") {
        if (!ctx.eco.morador) return [];
        condicoes.push(eq(coletas.moradorId, ctx.eco.morador.id));
      } else if (input?.residentId) {
        condicoes.push(eq(coletas.moradorId, input.residentId));
      }
      if (input?.wasteType) condicoes.push(eq(coletas.tipoResiduo, input.wasteType));
      if (input?.block) condicoes.push(eq(coletas.bloco, input.block));
      if (input?.status) condicoes.push(eq(coletas.status, input.status));
      if (input?.startDate) condicoes.push(gte(coletas.agendadaPara, input.startDate));
      if (input?.endDate) condicoes.push(lte(coletas.agendadaPara, input.endDate));

      const registros = await db.select().from(coletas).where(and(...condicoes)).orderBy(desc(coletas.agendadaPara), desc(coletas.id));
      const comunidade = await db.select({ id: moradores.id, nome: moradores.nome, apartamento: moradores.apartamento }).from(moradores).where(eq(moradores.condominioId, ctx.eco.condominio.id));
      const porId = new Map(comunidade.map((morador) => [morador.id, morador]));
      const origens = await origensDosRegistros(ctx.eco.condominio.id, registros);
      const regras = await regrasDoCondominio(ctx.eco.condominio.id);
      const busca = input?.search ? normalizar(input.search) : "";
      return registros.map((registro) => {
        const morador = registro.moradorId ? porId.get(registro.moradorId) : undefined;
        const situacao = situacaoDescarte(registro);
        return {
          ...registro,
          residentName: morador?.nome ?? null,
          apartment: morador?.apartamento ?? null,
          origin: origens(registro),
          situacao,
          pontosPrevistos: situacao === "pendente" || situacao === "auditoria" ? pontosDoDescarte(registro.pesoGramas, regras[registro.tipoResiduo].pontosPorKg) : registro.pontosConcedidos,
        };
      }).filter((registro) => (!input?.situacao || registro.situacao === input.situacao)
        && (!busca || normalizar(`${registro.residentName ?? ""} ${registro.apartment ?? ""} ${registro.bloco} ${registro.id}`).includes(busca)));
    }),
    /** Um descarte e os outros tipos registrados com ele (mesmo lote); o morador só abre os dele. Usado ao tocar numa notificação. */
    detalhe: withProfile.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const db = await getDb();
      const coleta = await coletaDoCondominio(ctx.eco.condominio.id, input.id);
      if (ctx.eco.perfil.papel === "morador" && coleta.moradorId !== ctx.eco.morador?.id) throw new TRPCError({ code: "NOT_FOUND", message: "Descarte não encontrado." });
      const mesmoLote = coleta.lote ? await db.select().from(coletas).where(and(eq(coletas.condominioId, ctx.eco.condominio.id), eq(coletas.lote, coleta.lote))).orderBy(asc(coletas.id)) : [coleta];
      const [morador] = coleta.moradorId ? await db.select({ nome: moradores.nome, bloco: moradores.bloco, apartamento: moradores.apartamento }).from(moradores).where(eq(moradores.id, coleta.moradorId)).limit(1) : [];
      const origens = await origensDosRegistros(ctx.eco.condominio.id, mesmoLote);
      const regras = await regrasDoCondominio(ctx.eco.condominio.id);
      return {
        id: coleta.id,
        lote: coleta.lote,
        morador: morador ?? null,
        itens: mesmoLote.map((registro) => {
          const situacao = situacaoDescarte(registro);
          return { ...registro, situacao, origin: origens(registro), pontosPrevistos: situacao === "pendente" || situacao === "auditoria" ? pontosDoDescarte(registro.pesoGramas, regras[registro.tipoResiduo].pontosPorKg) : registro.pontosConcedidos };
        }),
      };
    }),
    /** Descartes aguardando a aprovação do administrador e os que estão em auditoria. */
    listarPendentesAprovacao: administratorOnly.query(async ({ ctx }) => {
      const db = await getDb();
      const registros = await db.select().from(coletas).where(and(eq(coletas.condominioId, ctx.eco.condominio.id), eq(coletas.pendenteAprovacaoPeso, true))).orderBy(desc(coletas.concluidaEm), asc(coletas.id));
      const regras = await regrasDoCondominio(ctx.eco.condominio.id);
      const moradorIds = Array.from(new Set(registros.map((registro) => registro.moradorId).filter((id): id is number => id !== null)));
      const moradoresRelacionados = moradorIds.length ? await db.select().from(moradores).where(eq(moradores.condominioId, ctx.eco.condominio.id)) : [];
      const origens = await origensDosRegistros(ctx.eco.condominio.id, registros);
      return registros.map((registro) => ({
        ...registro,
        pontosCalculados: pontosDoDescarte(registro.pesoGramas, regras[registro.tipoResiduo].pontosPorKg),
        situacao: situacaoDescarte(registro),
        residentName: moradoresRelacionados.find((morador) => morador.id === registro.moradorId)?.nome ?? null,
        apartment: moradoresRelacionados.find((morador) => morador.id === registro.moradorId)?.apartamento ?? null,
        origin: origens(registro),
      }));
    }),
    /** Decide um descarte pendente: aprovar libera os pontos; reprovar exige motivo (vai para o morador) e cancela os pontos previstos. */
    decidirAprovacaoPeso: administratorOnly.input(z.object({
      id: z.number().int().positive(),
      aprovar: z.boolean(),
      observacao: z.string().trim().max(500).nullable().optional(),
    })).mutation(async ({ ctx, input }) => {
      const coleta = await coletaDoCondominio(ctx.eco.condominio.id, input.id);
      if (!coleta.pendenteAprovacaoPeso || coleta.aprovacaoPesoStatus === "auditoria") throw new TRPCError({ code: "BAD_REQUEST", message: coleta.aprovacaoPesoStatus === "auditoria" ? "Este descarte está em auditoria. Conclua a auditoria para decidir." : "Este descarte não está pendente de aprovação." });
      if ((coleta.concluidoPorId ?? coleta.coletorId) === ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Quem registrou o descarte não pode aprovar o próprio lançamento. Peça para outro administrador revisar." });
      }
      if (!input.aprovar) {
        if (!input.observacao || input.observacao.length < 5) throw new TRPCError({ code: "BAD_REQUEST", message: "Informe o motivo da reprovação (pelo menos 5 letras); ele é enviado ao morador." });
        return reprovarColeta(ctx, coleta, input.observacao);
      }
      return aprovarColeta(ctx, coleta, input.observacao || null);
    }),
    /** Aprova de uma vez vários descartes pendentes (ex.: os tipos de um mesmo lote, depois de conferir as fotos). */
    aprovarVarios: administratorOnly.input(z.object({ ids: z.array(z.number().int().positive()).min(1).max(100) })).mutation(async ({ ctx, input }) => {
      let aprovados = 0;
      let pontos = 0;
      const recusados: Array<{ id: number; motivo: string }> = [];
      for (const id of Array.from(new Set(input.ids))) {
        try {
          const coleta = await coletaDoCondominio(ctx.eco.condominio.id, id);
          if (!coleta.pendenteAprovacaoPeso || coleta.aprovacaoPesoStatus === "auditoria") throw new TRPCError({ code: "BAD_REQUEST", message: "não está pendente" });
          if ((coleta.concluidoPorId ?? coleta.coletorId) === ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "registrado por você" });
          const resultado = await aprovarColeta(ctx, coleta, null);
          aprovados += 1;
          pontos += resultado.pointsAwarded;
        } catch (error) {
          recusados.push({ id, motivo: error instanceof Error ? error.message : "erro" });
        }
      }
      return { aprovados, pontos, recusados };
    }),
    /**
     * Abre uma auditoria num descarte (caso grave: suspeita de furto, peso forjado, tentativa de burlar a estação).
     * O peso sai dos indicadores enquanto durar, e o morador é avisado de que o descarte está sob auditoria.
     */
    abrirAuditoria: administratorOnly.input(z.object({
      id: z.number().int().positive(),
      motivo: z.string().trim().min(10, "Descreva o motivo da auditoria (pelo menos 10 letras).").max(800),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const coleta = await coletaDoCondominio(ctx.eco.condominio.id, input.id);
      if (coleta.status !== "concluida") throw new TRPCError({ code: "BAD_REQUEST", message: "Só descartes concluídos podem ir para auditoria." });
      if (coleta.aprovacaoPesoStatus === "auditoria") throw new TRPCError({ code: "BAD_REQUEST", message: "Este descarte já está em auditoria." });
      if (coleta.aprovacaoPesoStatus === "rejeitado") throw new TRPCError({ code: "BAD_REQUEST", message: "Este descarte já foi reprovado." });
      const agora = new Date();
      const [alteracao] = await db.update(coletas).set({ pendenteAprovacaoPeso: true, aprovacaoPesoStatus: "auditoria", motivoAuditoria: input.motivo, auditoriaAbertaEm: agora, atualizadoEm: agora })
        .where(and(eq(coletas.id, coleta.id), eq(coletas.status, "concluida"), or(isNull(coletas.aprovacaoPesoStatus), inArray(coletas.aprovacaoPesoStatus, ["pendente", "aprovado"]))));
      if (!alteracao.affectedRows) throw new TRPCError({ code: "CONFLICT", message: "O descarte acabou de ser alterado por outro administrador. Atualize a página." });
      await writeAuditLog(db, {
        condominioId: coleta.condominioId, autorId: ctx.user.id, tipoEntidade: "coleta", entidadeId: coleta.id, acao: "auditoria_aberta",
        resumo: `Auditoria aberta no descarte nº ${coleta.id} (${formatarKg(coleta.pesoGramas)} kg de ${residuoNaFrase[coleta.tipoResiduo]}).`,
        estadoAnterior: { situacao: situacaoDescarte(coleta), pontosConcedidos: coleta.pontosConcedidos },
        estadoNovo: { situacao: "auditoria", pontosConcedidos: coleta.pontosConcedidos },
        motivo: input.motivo,
      });
      const base = { condominioId: coleta.condominioId, coletaId: coleta.id };
      await notificarUsuario(db, await usuarioDoMorador(coleta.moradorId), { ...base, tipo: "auditoria_aberta", titulo: "Seu descarte está em auditoria", mensagem: `A administração abriu uma auditoria no descarte nº ${coleta.id} por algo que pareceu suspeito: ${input.motivo} Pode ser só um mal-entendido; se quiser, procure a administração para explicar. Se a irregularidade for confirmada, o descarte é reprovado e pode haver punição (perda de pontos).` });
      await notificarAdministradores(db, { ...base, tipo: "auditoria_aberta", titulo: "Auditoria aberta", mensagem: `O descarte nº ${coleta.id} (bloco ${coleta.bloco}) foi para auditoria: ${input.motivo}` }, ctx.user.id);
      return { success: true };
    }),
    /**
     * Conclui a auditoria. "regular": foi um mal-entendido, o descarte é aprovado e os pontos entram (se ainda não entraram).
     * "irregular": o descarte é reprovado (pontos estornados) e pode haver punição com perda de pontos.
     */
    concluirAuditoria: administratorOnly.input(z.object({
      id: z.number().int().positive(),
      resultado: z.enum(["regular", "irregular"]),
      parecer: z.string().trim().min(10, "Escreva o parecer da auditoria (pelo menos 10 letras).").max(800),
      penalidadePontos: z.number().int().min(0).max(1000).default(0),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const coleta = await coletaDoCondominio(ctx.eco.condominio.id, input.id);
      if (coleta.aprovacaoPesoStatus !== "auditoria") throw new TRPCError({ code: "BAD_REQUEST", message: "Este descarte não está em auditoria." });
      if (input.resultado === "regular" && input.penalidadePontos > 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Punição só vale quando a irregularidade é confirmada." });
      const base = { condominioId: coleta.condominioId, coletaId: coleta.id };
      const usuarioMorador = await usuarioDoMorador(coleta.moradorId);
      if (input.resultado === "regular") {
        const resultado = await aprovarColeta(ctx, coleta, `Auditoria concluída sem irregularidade: ${input.parecer}`, true);
        await notificarUsuario(db, usuarioMorador, { ...base, tipo: "auditoria_concluida", titulo: "Auditoria concluída: tudo certo", mensagem: `A auditoria do descarte nº ${coleta.id} terminou sem irregularidade. ${input.parecer}` });
        return { ...resultado, penalty: 0 };
      }
      const resultado = await reprovarColeta(ctx, coleta, `Irregularidade confirmada na auditoria: ${input.parecer}`);
      let penalidade = 0;
      if (input.penalidadePontos > 0 && coleta.moradorId) {
        await db.transaction(async (tx) => {
          await movimentarPontos(tx, { condominioId: coleta.condominioId, moradorId: coleta.moradorId!, tipo: "penalidade", pontos: -input.penalidadePontos, coletaId: coleta.id, autorId: ctx.user.id, descricao: `Punição: irregularidade no descarte nº ${coleta.id}` });
        }).catch(converterDuplicidade);
        penalidade = input.penalidadePontos;
        await writeAuditLog(db, { condominioId: coleta.condominioId, autorId: ctx.user.id, tipoEntidade: "pontos", entidadeId: coleta.moradorId, acao: "punicao_aplicada", resumo: `Punição de ${penalidade} ponto(s) pela irregularidade no descarte nº ${coleta.id}.`, estadoNovo: { penalidadePontos: penalidade, coletaId: coleta.id }, motivo: input.parecer });
      }
      await notificarUsuario(db, usuarioMorador, { ...base, tipo: "auditoria_concluida", titulo: "Auditoria concluída: irregularidade confirmada", mensagem: `A auditoria do descarte nº ${coleta.id} confirmou a irregularidade e o descarte foi reprovado. ${input.parecer}${penalidade ? ` Punição: -${penalidade} ponto(s).` : ""}` });
      return { ...resultado, penalty: penalidade };
    }),
    /**
     * Reprova um descarte concluído (pendente, aprovado ou em auditoria), com motivo obrigatório. Pontos previstos são cancelados;
     * pontos já lançados são estornados do saldo (que pode ficar negativo se o morador já os gastou).
     */
    reprovar: administratorOnly.input(z.object({
      id: z.number().int().positive(),
      motivo: z.string().trim().min(5, "Informe o motivo da reprovação (pelo menos 5 letras).").max(500),
    })).mutation(async ({ ctx, input }) => {
      const coleta = await coletaDoCondominio(ctx.eco.condominio.id, input.id);
      if (coleta.pendenteAprovacaoPeso && (coleta.concluidoPorId ?? coleta.coletorId) === ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Quem registrou o descarte não pode decidir a revisão dele. Peça para outro administrador revisar." });
      }
      return reprovarColeta(ctx, coleta, input.motivo);
    }),
  }),
});

type ContextoAdministrador = { user: { id: number }; eco: { condominio: { id: number } } };

async function coletaDoCondominio(condominioId: number, id: number) {
  const db = await getDb();
  const encontrada = await db.select().from(coletas).where(and(eq(coletas.id, id), eq(coletas.condominioId, condominioId))).limit(1);
  if (!encontrada[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Descarte não encontrado." });
  return encontrada[0];
}

async function usuarioDoMorador(moradorId: number | null) {
  if (!moradorId) return null;
  const db = await getDb();
  const encontrado = await db.select({ usuarioId: moradores.usuarioId }).from(moradores).where(eq(moradores.id, moradorId)).limit(1);
  return encontrado[0]?.usuarioId ?? null;
}

function formatarKg(pesoGramas: number | null) {
  return ((pesoGramas ?? 0) / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

/** O índice único do extrato recusou pontuar a mesma coleta duas vezes: vira um erro legível na tela. */
function converterDuplicidade(error: unknown): never {
  if (error instanceof MovimentacaoDuplicadaError) throw new TRPCError({ code: "CONFLICT", message: "Os pontos deste descarte já foram lançados." });
  throw error;
}

/** Aprova um descarte pendente (ou em auditoria, ao concluí-la sem irregularidade) e credita os pontos pela regra do tipo. */
async function aprovarColeta(ctx: ContextoAdministrador, coleta: Coleta, observacao: string | null, daAuditoria = false) {
  const db = await getDb();
  const regras = await regrasDoCondominio(coleta.condominioId);
  // Numa auditoria sobre um descarte já aprovado, os pontos já estavam no saldo: não credita de novo.
  const jaCreditados = coleta.pontosConcedidos > 0;
  const pontos = jaCreditados ? coleta.pontosConcedidos : pontosDoDescarte(coleta.pesoGramas, regras[coleta.tipoResiduo].pontosPorKg);
  const agora = new Date();
  await db.transaction(async (tx) => {
    const [alteracao] = await tx.update(coletas).set({
      pendenteAprovacaoPeso: false,
      aprovacaoPesoStatus: "aprovado",
      aprovacaoPesoPorId: ctx.user.id,
      aprovacaoPesoEm: agora,
      motivoDecisao: observacao,
      pontosConcedidos: pontos,
      atualizadoEm: agora,
    }).where(and(eq(coletas.id, coleta.id), eq(coletas.pendenteAprovacaoPeso, true), eq(coletas.aprovacaoPesoStatus, daAuditoria ? "auditoria" : "pendente")));
    if (!alteracao.affectedRows) throw new TRPCError({ code: "CONFLICT", message: "Outro administrador já decidiu este descarte." });
    if (coleta.moradorId && pontos > 0 && !jaCreditados) {
      await movimentarPontos(tx, { condominioId: coleta.condominioId, moradorId: coleta.moradorId, tipo: "credito_coleta", pontos, coletaId: coleta.id, autorId: ctx.user.id, descricao: `Descarte nº ${coleta.id} aprovado (${formatarKg(coleta.pesoGramas)} kg de ${residuoNaFrase[coleta.tipoResiduo]})` });
    }
  }).catch(converterDuplicidade);

  await writeAuditLog(db, {
    condominioId: coleta.condominioId,
    autorId: ctx.user.id,
    tipoEntidade: "coleta",
    entidadeId: coleta.id,
    acao: daAuditoria ? "auditoria_concluida_regular" : "descarte_aprovado",
    resumo: daAuditoria
      ? `Auditoria do descarte nº ${coleta.id} concluída sem irregularidade; descarte aprovado${jaCreditados ? " (pontos mantidos)" : `; ${pontos} ponto(s) creditado(s)`}.`
      : `Descarte nº ${coleta.id} conferido (foto e peso) e aprovado; ${pontos} ponto(s) creditado(s).`,
    estadoAnterior: { situacao: daAuditoria ? "auditoria" : "pendente", pontosConcedidos: coleta.pontosConcedidos },
    estadoNovo: { situacao: "aprovado", pontosConcedidos: pontos, efeitoPontos: jaCreditados ? "pontos já creditados antes" : pontos ? `${pontos} ponto(s) creditado(s)` : "sem pontos (regra do tipo ou peso abaixo de 1 ponto)" },
    motivo: observacao,
  });

  const usuarioMorador = await usuarioDoMorador(coleta.moradorId);
  const base = { condominioId: coleta.condominioId, coletaId: coleta.id };
  if (!daAuditoria) await notificarUsuario(db, usuarioMorador, { ...base, tipo: "revisao_administrativa", titulo: "Descarte aprovado", mensagem: `A administração conferiu a foto e o peso e aprovou o descarte nº ${coleta.id} (${formatarKg(coleta.pesoGramas)} kg de ${residuoNaFrase[coleta.tipoResiduo]}).${observacao ? ` Observação: ${observacao}` : ""}` });
  if (pontos > 0 && !jaCreditados) await notificarUsuario(db, usuarioMorador, { ...base, tipo: "pontos_ganhos", titulo: `+${pontos} ponto(s)`, mensagem: `${pontos} ponto(s) do descarte nº ${coleta.id} foram creditados. Veja o extrato em Engajamento.` });
  return { success: true, pointsAwarded: jaCreditados ? 0 : pontos };
}

async function reprovarColeta(ctx: ContextoAdministrador, coleta: Coleta, motivo: string) {
  if (coleta.status !== "concluida") throw new TRPCError({ code: "BAD_REQUEST", message: "Só descartes concluídos podem ser reprovados." });
  if (coleta.aprovacaoPesoStatus === "rejeitado") throw new TRPCError({ code: "BAD_REQUEST", message: "Este descarte já foi reprovado." });
  const db = await getDb();
  const agora = new Date();
  const eraPendente = coleta.pendenteAprovacaoPeso && coleta.pontosConcedidos === 0;
  const regras = await regrasDoCondominio(coleta.condominioId);
  const pontosPendentes = eraPendente ? pontosDoDescarte(coleta.pesoGramas, regras[coleta.tipoResiduo].pontosPorKg) : 0;
  const pontosEstornados = coleta.pontosConcedidos;
  await db.transaction(async (tx) => {
    const [alteracao] = await tx.update(coletas).set({
      pendenteAprovacaoPeso: false,
      aprovacaoPesoStatus: "rejeitado",
      aprovacaoPesoPorId: ctx.user.id,
      aprovacaoPesoEm: agora,
      motivoDecisao: motivo,
      pontosConcedidos: 0,
      atualizadoEm: agora,
    }).where(and(eq(coletas.id, coleta.id), eq(coletas.status, "concluida"), or(isNull(coletas.aprovacaoPesoStatus), ne(coletas.aprovacaoPesoStatus, "rejeitado"))));
    if (!alteracao.affectedRows) throw new TRPCError({ code: "CONFLICT", message: "Este descarte já foi reprovado por outro administrador." });
    if (coleta.moradorId && pontosEstornados > 0) {
      await movimentarPontos(tx, { condominioId: coleta.condominioId, moradorId: coleta.moradorId, tipo: "estorno_coleta", pontos: -pontosEstornados, coletaId: coleta.id, autorId: ctx.user.id, descricao: `Estorno: descarte nº ${coleta.id} reprovado (${motivo})` });
    }
  }).catch((error: unknown) => {
    if (error instanceof MovimentacaoDuplicadaError) throw new TRPCError({ code: "CONFLICT", message: "Os pontos deste descarte já foram estornados." });
    throw error;
  });

  const efeito = pontosEstornados > 0 ? `${pontosEstornados} ponto(s) estornado(s)` : pontosPendentes > 0 ? `${pontosPendentes} ponto(s) pendente(s) cancelado(s)` : "nenhum ponto envolvido";
  await writeAuditLog(db, {
    condominioId: coleta.condominioId,
    autorId: ctx.user.id,
    tipoEntidade: "coleta",
    entidadeId: coleta.id,
    acao: "coleta_reprovada",
    resumo: `Descarte nº ${coleta.id} reprovado pela administração; ${efeito}.`,
    estadoAnterior: { status: coleta.status, pesoGramas: coleta.pesoGramas, aprovacaoPesoStatus: coleta.aprovacaoPesoStatus, pendenteAprovacaoPeso: eraPendente, pontosConcedidos: coleta.pontosConcedidos },
    estadoNovo: { status: coleta.status, aprovacaoPesoStatus: "rejeitado", pontosConcedidos: 0, pontosEstornados, pontosPendentesCancelados: pontosPendentes, efeitoPontos: efeito, reprovadaEm: agora },
    motivo,
  });

  const usuarioMorador = await usuarioDoMorador(coleta.moradorId);
  const base = { condominioId: coleta.condominioId, coletaId: coleta.id };
  await notificarUsuario(db, usuarioMorador, { ...base, tipo: "coleta_reprovada", titulo: "Descarte reprovado", mensagem: `A administração reprovou o descarte nº ${coleta.id} (${formatarKg(coleta.pesoGramas)} kg de ${residuoNaFrase[coleta.tipoResiduo]}). Motivo: ${motivo}` });
  if (pontosEstornados > 0 || pontosPendentes > 0) {
    await notificarUsuario(db, usuarioMorador, { ...base, tipo: "pontos_estornados", titulo: pontosEstornados > 0 ? `-${pontosEstornados} ponto(s) estornado(s)` : "Pontos pendentes cancelados", mensagem: pontosEstornados > 0 ? `Os ${pontosEstornados} ponto(s) do descarte nº ${coleta.id} foram retirados do seu saldo porque ele foi reprovado.` : `Os ${pontosPendentes} ponto(s) previsto(s) do descarte nº ${coleta.id} não serão creditados porque ele foi reprovado.` });
  }
  await notificarAdministradores(db, { ...base, tipo: "coleta_reprovada", titulo: "Descarte reprovado", mensagem: `O descarte nº ${coleta.id} (bloco ${coleta.bloco}) foi reprovado: ${motivo}. Efeito: ${efeito}.` }, ctx.user.id);
  return { success: true, pointsAwarded: 0, pointsReversed: pontosEstornados, pendingPointsCancelled: pontosPendentes };
}

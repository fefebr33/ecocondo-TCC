import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import { modelosPenalidade, moradores, penalidades, tiposPenalidade, unidadesDuracao, usuarios } from "../drizzle/schema";
import { rotuloTipoPenalidade } from "@shared/rotulos";
import { writeAuditLog } from "./audit";
import { movimentarPontos } from "./pontos";
import { notificarAdministradores, notificarUsuario } from "./notificacoes";

export type TipoPenalidade = (typeof tiposPenalidade)[number];
export type UnidadeDuracao = (typeof unidadesDuracao)[number];

/** Medidas pré-definidas criadas na primeira vez que o administrador abre a lista (ele pode editar, desativar ou criar outras). */
export const MODELOS_PADRAO: Array<{ nome: string; tipo: TipoPenalidade; pontos?: number; duracaoValor?: number; duracaoUnidade?: UnidadeDuracao; descricao: string }> = [
  { nome: "Advertência por escrito", tipo: "advertencia", descricao: "Registro formal no histórico do morador, sem perda de pontos." },
  { nome: "Retirada de 10 pontos", tipo: "perda_pontos", pontos: 10, descricao: "Para irregularidades leves (saco trocado, foto ruim de propósito)." },
  { nome: "Retirada de 30 pontos", tipo: "perda_pontos", pontos: 30, descricao: "Para tentativa de fraude confirmada (peso forjado, saco pesado duas vezes)." },
  { nome: "Suspensão das campanhas por 30 dias", tipo: "suspensao_campanhas", duracaoValor: 30, duracaoUnidade: "dias", descricao: "Não pode entrar nem pontuar em campanhas durante o período." },
  { nome: "Suspensão da participação por 15 dias", tipo: "suspensao_participacao", duracaoValor: 15, duracaoUnidade: "dias", descricao: "Não registra descartes na estação nem resgata prêmios durante o período." },
  { nome: "Suspensão da participação por 3 meses", tipo: "suspensao_participacao", duracaoValor: 3, duracaoUnidade: "meses", descricao: "Para reincidência ou denúncias falsas repetidas." },
];

/** Tipos que valem por um período (os outros acontecem uma vez só: perda de pontos e advertência). */
export const TIPOS_COM_PERIODO: TipoPenalidade[] = ["suspensao_campanhas", "suspensao_participacao", "outra"];

/** Fim da medida a partir do início e da duração (meses de calendário: 31/01 + 1 mês = 28 ou 29/02). */
export function calcularFimPenalidade(inicio: Date, valor: number | null | undefined, unidade: UnidadeDuracao | null | undefined) {
  if (!valor || valor <= 0 || !unidade) return null;
  const fim = new Date(inicio);
  if (unidade === "dias") {
    fim.setTime(fim.getTime() + valor * 24 * 60 * 60 * 1000);
    return fim;
  }
  const dia = fim.getDate();
  fim.setDate(1);
  fim.setMonth(fim.getMonth() + valor);
  const ultimoDia = new Date(fim.getFullYear(), fim.getMonth() + 1, 0).getDate();
  fim.setDate(Math.min(dia, ultimoDia));
  return fim;
}

/** A medida está valendo agora? (ativa e dentro do prazo, ou sem prazo). */
export function penalidadeVigente(penalidade: { status: string; fimEm: Date | null }, agora = new Date()) {
  return penalidade.status === "ativa" && (penalidade.fimEm === null || penalidade.fimEm > agora);
}

/** Período legível ("de 01/10/2026 a 31/10/2026" ou "a partir de 01/10/2026"). */
export function descreverPeriodo(inicio: Date, fim: Date | null) {
  const data = (valor: Date) => valor.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  return fim ? `de ${data(inicio)} a ${data(fim)}` : `a partir de ${data(inicio)}`;
}

/** Medidas pré-definidas do condomínio; cria as padrão na primeira consulta. */
export async function modelosDoCondominio(db: any, condominioId: number, somenteAtivos = false): Promise<Array<typeof modelosPenalidade.$inferSelect>> {
  const existentes = await db.select().from(modelosPenalidade).where(eq(modelosPenalidade.condominioId, condominioId)).orderBy(asc(modelosPenalidade.id));
  if (!existentes.length) {
    for (const modelo of MODELOS_PADRAO) {
      await db.insert(modelosPenalidade).values({ condominioId, nome: modelo.nome, tipo: modelo.tipo, pontos: modelo.pontos ?? null, duracaoValor: modelo.duracaoValor ?? null, duracaoUnidade: modelo.duracaoUnidade ?? null, descricao: modelo.descricao });
    }
    return modelosDoCondominio(db, condominioId, somenteAtivos);
  }
  return somenteAtivos ? existentes.filter((modelo: typeof modelosPenalidade.$inferSelect) => modelo.ativo) : existentes;
}

export type MedidaInformada = {
  modeloId?: number | null;
  /** Medida avulsa, quando nenhuma pré-definida serve. */
  personalizada?: { tipo: TipoPenalidade; nome: string; pontos?: number | null; duracaoValor?: number | null; duracaoUnidade?: UnidadeDuracao | null } | null;
};

/**
 * Aplica uma medida administrativa a um morador: grava no histórico (motivo, período, responsável), tira os pontos quando for
 * o caso (extrato), registra na auditoria e avisa o morador e os outros administradores.
 */
export async function aplicarPenalidade(db: any, dados: MedidaInformada & {
  condominioId: number;
  autorId: number;
  moradorId: number;
  motivo: string;
  coletaId?: number | null;
  ocorrenciaId?: number | null;
}) {
  const [morador] = await db.select().from(moradores).where(and(eq(moradores.id, dados.moradorId), eq(moradores.condominioId, dados.condominioId))).limit(1);
  if (!morador) throw new TRPCError({ code: "NOT_FOUND", message: "Morador não encontrado." });
  let medida: { tipo: TipoPenalidade; nome: string; pontos: number | null; duracaoValor: number | null; duracaoUnidade: UnidadeDuracao | null; modeloId: number | null };
  if (dados.modeloId) {
    const [modelo] = await db.select().from(modelosPenalidade).where(and(eq(modelosPenalidade.id, dados.modeloId), eq(modelosPenalidade.condominioId, dados.condominioId))).limit(1);
    if (!modelo || !modelo.ativo) throw new TRPCError({ code: "NOT_FOUND", message: "Medida pré-definida não encontrada ou desativada." });
    medida = { tipo: modelo.tipo, nome: modelo.nome, pontos: modelo.pontos, duracaoValor: modelo.duracaoValor, duracaoUnidade: modelo.duracaoUnidade, modeloId: modelo.id };
  } else if (dados.personalizada) {
    medida = { tipo: dados.personalizada.tipo, nome: dados.personalizada.nome, pontos: dados.personalizada.pontos ?? null, duracaoValor: dados.personalizada.duracaoValor ?? null, duracaoUnidade: dados.personalizada.duracaoUnidade ?? null, modeloId: null };
  } else {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Escolha a medida a aplicar." });
  }
  if (medida.tipo === "perda_pontos" && (!medida.pontos || medida.pontos <= 0)) throw new TRPCError({ code: "BAD_REQUEST", message: "Informe quantos pontos retirar." });
  if ((medida.tipo === "suspensao_campanhas" || medida.tipo === "suspensao_participacao") && !medida.duracaoValor) throw new TRPCError({ code: "BAD_REQUEST", message: "Informe por quanto tempo vale a suspensão." });

  const inicio = new Date();
  const fim = TIPOS_COM_PERIODO.includes(medida.tipo) ? calcularFimPenalidade(inicio, medida.duracaoValor, medida.duracaoUnidade) : null;
  // Retirada de pontos e advertência acontecem uma vez só: ficam no histórico já encerradas.
  const status = TIPOS_COM_PERIODO.includes(medida.tipo) ? "ativa" : "encerrada";
  let penalidadeId = 0;
  await db.transaction(async (tx: any) => {
    const [inserida] = await tx.insert(penalidades).values({
      condominioId: dados.condominioId, moradorId: morador.id, modeloId: medida.modeloId, tipo: medida.tipo, nome: medida.nome.slice(0, 120),
      pontos: medida.tipo === "perda_pontos" ? medida.pontos : null, inicioEm: inicio, fimEm: fim, motivo: dados.motivo,
      coletaId: dados.coletaId ?? null, ocorrenciaId: dados.ocorrenciaId ?? null, aplicadaPorId: dados.autorId, status,
    }).$returningId();
    penalidadeId = inserida.id;
    if (medida.tipo === "perda_pontos" && medida.pontos) {
      await movimentarPontos(tx, { condominioId: dados.condominioId, moradorId: morador.id, tipo: "penalidade", pontos: -medida.pontos, penalidadeId, autorId: dados.autorId, descricao: `Penalidade: ${medida.nome}` });
    }
  });

  const periodo = fim ? descreverPeriodo(inicio, fim) : null;
  const efeito = medida.tipo === "perda_pontos" ? `-${medida.pontos} ponto(s)`
    : medida.tipo === "suspensao_campanhas" ? `sem campanhas ${periodo}`
    : medida.tipo === "suspensao_participacao" ? `sem registrar descartes nem resgatar prêmios ${periodo}`
    : periodo ? `vale ${periodo}` : "registrada no histórico";
  await writeAuditLog(db, {
    condominioId: dados.condominioId, autorId: dados.autorId, tipoEntidade: "penalidade", entidadeId: penalidadeId, acao: "penalidade_aplicada",
    resumo: `${rotuloTipoPenalidade[medida.tipo]} aplicada a ${morador.nome} (${medida.nome}; ${efeito})${dados.coletaId ? ` pelo descarte nº ${dados.coletaId}` : ""}${dados.ocorrenciaId ? ` pela ocorrência nº ${dados.ocorrenciaId}` : ""}.`,
    estadoNovo: { moradorId: morador.id, tipo: medida.tipo, nome: medida.nome, pontos: medida.pontos, inicioEm: inicio, fimEm: fim, coletaId: dados.coletaId ?? null, ocorrenciaId: dados.ocorrenciaId ?? null },
    motivo: dados.motivo,
  });
  const base = { condominioId: dados.condominioId, coletaId: dados.coletaId ?? null };
  await notificarUsuario(db, morador.usuarioId, { ...base, tipo: "penalidade_aplicada", titulo: `Medida administrativa: ${medida.nome}`, mensagem: `A administração aplicou uma medida na sua conta: ${medida.nome} (${efeito}). Motivo: ${dados.motivo.replace(/[.!\s]+$/, "")}. Se discordar, procure a administração.` });
  await notificarAdministradores(db, { ...base, tipo: "penalidade_aplicada", titulo: "Penalidade aplicada", mensagem: `${morador.nome} (bloco ${morador.bloco}) recebeu: ${medida.nome} (${efeito}).` }, dados.autorId);
  return { id: penalidadeId, tipo: medida.tipo, nome: medida.nome, fimEm: fim };
}

/** Medidas que estão valendo agora para o morador (opcionalmente só de um tipo). */
export async function penalidadesVigentes(db: any, moradorId: number, tipos?: TipoPenalidade[]) {
  const agora = new Date();
  const condicoes = [eq(penalidades.moradorId, moradorId), eq(penalidades.status, "ativa"), or(isNull(penalidades.fimEm), gt(penalidades.fimEm, agora))];
  if (tipos?.length) condicoes.push(inArray(penalidades.tipo, tipos));
  return db.select().from(penalidades).where(and(...condicoes)).orderBy(desc(penalidades.fimEm));
}

/** Bloqueia a ação quando o morador está suspenso (estação, resgates, campanhas), com a data em que volta a poder. */
export async function exigirSemSuspensao(db: any, moradorId: number, tipo: "suspensao_campanhas" | "suspensao_participacao", acao: string) {
  const tipos: TipoPenalidade[] = tipo === "suspensao_campanhas" ? ["suspensao_campanhas", "suspensao_participacao"] : ["suspensao_participacao"];
  const [vigente] = await penalidadesVigentes(db, moradorId, tipos);
  if (!vigente) return;
  const ate = vigente.fimEm ? ` até ${vigente.fimEm.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : "";
  throw new TRPCError({ code: "FORBIDDEN", message: `Sua participação está suspensa${ate} (${vigente.nome}), por isso não é possível ${acao}. Procure a administração se tiver dúvidas.` });
}

/** Histórico de medidas (do condomínio ou de um morador), com o nome de quem aplicou. */
export type MedidaDoHistorico = typeof penalidades.$inferSelect & { aplicadaPor: string; morador: string | null; bloco: string | null; apartamento: string | null; vigente: boolean; periodo: string | null };

export async function historicoPenalidades(db: any, condominioId: number, moradorId?: number): Promise<MedidaDoHistorico[]> {
  const condicoes = [eq(penalidades.condominioId, condominioId)];
  if (moradorId) condicoes.push(eq(penalidades.moradorId, moradorId));
  const linhas = await db.select({ penalidade: penalidades, aplicadaPor: usuarios.nome, morador: moradores.nome, bloco: moradores.bloco, apartamento: moradores.apartamento }).from(penalidades).leftJoin(usuarios, eq(usuarios.id, penalidades.aplicadaPorId)).leftJoin(moradores, eq(moradores.id, penalidades.moradorId)).where(and(...condicoes)).orderBy(desc(penalidades.criadoEm), desc(penalidades.id));
  const agora = new Date();
  return linhas.map((linha: any) => ({ ...linha.penalidade, aplicadaPor: linha.aplicadaPor ?? "Administração", morador: linha.morador, bloco: linha.bloco, apartamento: linha.apartamento, vigente: penalidadeVigente(linha.penalidade, agora), periodo: linha.penalidade.fimEm ? descreverPeriodo(linha.penalidade.inicioEm, linha.penalidade.fimEm) : null }));
}

/** Rotina: encerra as suspensões vencidas e avisa o morador de que pode voltar a participar. */
export async function encerrarPenalidadesVencidas(db: any, agora = new Date()) {
  const vencidas = await db.select({ penalidade: penalidades, usuarioId: moradores.usuarioId }).from(penalidades).leftJoin(moradores, eq(moradores.id, penalidades.moradorId)).where(and(eq(penalidades.status, "ativa"), lte(penalidades.fimEm, agora)));
  for (const { penalidade, usuarioId } of vencidas as Array<{ penalidade: typeof penalidades.$inferSelect; usuarioId: number | null }>) {
    const [alteracao] = await db.update(penalidades).set({ status: "encerrada", avisoEncerramentoEm: agora }).where(and(eq(penalidades.id, penalidade.id), eq(penalidades.status, "ativa")));
    if (!alteracao.affectedRows) continue;
    await notificarUsuario(db, usuarioId, { condominioId: penalidade.condominioId, tipo: "penalidade_encerrada", titulo: "Medida encerrada", mensagem: `Terminou o prazo da medida "${penalidade.nome}". Você já pode voltar a participar normalmente.` });
  }
  return vencidas.length;
}

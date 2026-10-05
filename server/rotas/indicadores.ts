import { exigirSemSuspensao, historicoPenalidades, suspensoesVigentesDoCondominio } from "../penalidades";
import { gerarRelatorioPdf, type DadosRelatorioPdf } from "../relatorios/relatorioPdf";
import { gerarRelatorioPlanilha } from "../relatorios/relatorioPlanilha";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { coletas, estacoesPesagem, guiasDescarte, logsAuditoria, movimentacoesPontos, notificacoesLidas, notificacoes, moradores, perfisAcesso, preferenciasNotificacao, ocorrencias, recompensas, resgates, relatoriosAnuais, tiposResiduo, usuarios } from "../../drizzle/schema";
import { getDb } from "../db";
import { rotuloResiduo, rotuloTipoPenalidade } from "@shared/rotulos";
import { administratorOnly, withProfile } from "./nucleo";
import { router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { countUnreadNotifications } from "../dominio/regrasNotificacao";
import { buildCollectionsCsv, construirCsv, dataHoraCsv } from "../dominio/exportacaoCsv";
import { calcularEquivalenciasAmbientais } from "../dominio/impactoAmbiental";
import { pesoConfirmadoGramas } from "../dominio/antifraude";
import { nomePublico, recortarRankingPublico } from "../dominio/privacidadeRanking";
import { classificarPodio } from "../dominio/regrasPodio";
import { origensDosRegistros } from "./operacoes";
import { ajustesDePenalidade, calcularIntervalo, classificacaoDoPeriodo, descontarPenalidades, inicioDoCiclo, somarPorMorador } from "./podio";
import { rotuloSituacao, situacaoDescarte, TIPOS_RESIDUO, type SituacaoDescarte } from "@shared/descarte";
import { guiasDoCondominio } from "../guias";
import { writeAuditLog } from "../audit";
import { extratoDoMorador, movimentarPontos, saldosInconsistentes } from "../pontos";
import { NOTIFICACOES_OBRIGATORIAS, notificarAdministradores, notificarTodos, notificarUsuario } from "../notificacoes";
import { categoriasAviso, rotuloPublicoAviso } from "@shared/notificacoes";
import { gestaoDoMorador, indicadoresGerais } from "../indicadoresGestao";
import { pedidosAdesivos } from "../../drizzle/schema";
import { tiposPorPerfil } from "@shared/notificacoes";
import type { EcoRole } from "@shared/permissions";
import { estacoesBloqueadas } from "../dominio/estacaoPesagem";
import { compararPeriodos, evolucaoMensal, resumirPontos, taxaDeConclusao } from "../dominio/indicadoresPainel";

/** Com este estoque (ou menos) a administração recebe o aviso de estoque baixo. */
export const LIMITE_ESTOQUE_BAIXO = 2;

const periodInput = z.object({ startDate: z.date().optional(), endDate: z.date().optional(), block: z.string().trim().min(1).max(32).optional() }).optional();
const csvFiltersInput = z.object({
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  block: z.string().trim().min(1).max(32).optional(),
  wasteType: z.enum(tiposResiduo).optional(),
  /** Qual planilha: descartes (padrão), extrato de pontos, resgates ou auditoria. */
  kind: z.enum(["coletas", "pontos", "resgates", "auditoria"]).default("coletas"),
}).optional();

function condicoesDataEm(coluna: any, periodo?: { startDate?: Date; endDate?: Date }) {
  const condicoes = [];
  if (periodo?.startDate) condicoes.push(gte(coluna, periodo.startDate));
  if (periodo?.endDate) condicoes.push(lte(coluna, periodo.endDate));
  return condicoes;
}

const rotuloMovimentacao: Record<string, string> = { credito_coleta: "Crédito de descarte", estorno_coleta: "Estorno de descarte reprovado", resgate: "Resgate de recompensa", devolucao_resgate: "Devolução de resgate cancelado", ajuste: "Ajuste da administração", zeragem: "Pontos zerados (novo ciclo)", penalidade: "Medida administrativa (retirada de pontos)" };
const rotuloStatusResgate: Record<string, string> = { solicitado: "Solicitado", aprovado: "Aprovado", entregue: "Entregue", cancelado: "Cancelado" };

/** Pontos ganhos (créditos menos estornos) e peso confirmado de cada morador, a partir das coletas concluídas. */
async function pontosAcumulados(condominioId: number, periodo?: { startDate?: Date; endDate?: Date }) {
  const db = await getDb();
  // Depois que o administrador zera os pontos, o ranking geral conta só o ciclo novo.
  const inicio = await inicioDoCiclo(condominioId, periodo?.startDate);
  const registros = await db.select().from(coletas).where(and(eq(coletas.condominioId, condominioId), eq(coletas.status, "concluida"), ...condicoesDataEm(coletas.concluidaEm, { startDate: inicio, endDate: periodo?.endDate })));
  // Pontos retirados por medidas administrativas também saem do ranking (não só do saldo).
  return descontarPenalidades(somarPorMorador(registros), await ajustesDePenalidade(condominioId, inicio, periodo?.endDate));
}

/** Movimentações do extrato no período (entradas, estornos e resgates), do condomínio todo ou de um morador. */
async function movimentacoesDoPeriodo(condominioId: number, periodo?: { startDate?: Date; endDate?: Date }, moradorId?: number) {
  const db = await getDb();
  const condicoes = [eq(movimentacoesPontos.condominioId, condominioId), ...condicoesDataEm(movimentacoesPontos.criadoEm, periodo)];
  if (moradorId) condicoes.push(eq(movimentacoesPontos.moradorId, moradorId));
  return db.select({ tipo: movimentacoesPontos.tipo, pontos: movimentacoesPontos.pontos }).from(movimentacoesPontos).where(and(...condicoes));
}

function condicoesPeriodo(condominioId: number, periodo?: { startDate?: Date; endDate?: Date }) {
  const condicoes = [eq(coletas.condominioId, condominioId)];
  if (periodo?.startDate) condicoes.push(gte(coletas.agendadaPara, periodo.startDate));
  if (periodo?.endDate) condicoes.push(lte(coletas.agendadaPara, periodo.endDate));
  return condicoes;
}

function condicoesCsv(condominioId: number, filtros?: { startDate?: Date; endDate?: Date; block?: string; wasteType?: (typeof tiposResiduo)[number] }) {
  const condicoes = condicoesPeriodo(condominioId, filtros);
  if (filtros?.block) condicoes.push(eq(coletas.bloco, filtros.block));
  if (filtros?.wasteType) condicoes.push(eq(coletas.tipoResiduo, filtros.wasteType));
  return condicoes;
}

function resumir(registros: Array<typeof coletas.$inferSelect>) {
  const concluidas = registros.filter((registro) => registro.status === "concluida");
  const totalGramas = concluidas.reduce((soma, registro) => soma + (pesoConfirmadoGramas(registro) ?? 0), 0);
  const gramasReciclaveis = concluidas.filter((registro) => registro.tipoResiduo === "reciclavel").reduce((soma, registro) => soma + (pesoConfirmadoGramas(registro) ?? 0), 0);
  const totalKg = totalGramas / 1000;
  const reciclavelKg = gramasReciclaveis / 1000;
  const taxaReciclagem = totalGramas > 0 ? Number(((gramasReciclaveis / totalGramas) * 100).toFixed(1)) : null;
  const co2EstimadoKg = calcularEquivalenciasAmbientais(reciclavelKg).co2EvitadoKg;
  const porTipoResiduo = tiposResiduo.map((tipoResiduo) => ({
    wasteType: tipoResiduo,
    kilograms: Number((concluidas.filter((registro) => registro.tipoResiduo === tipoResiduo).reduce((soma, registro) => soma + (pesoConfirmadoGramas(registro) ?? 0), 0) / 1000).toFixed(2)),
  }));
  return {
    totalKg: Number(totalKg.toFixed(2)),
    recyclableKg: Number(reciclavelKg.toFixed(2)),
    recyclingRate: taxaReciclagem,
    co2EstimateKg: co2EstimadoKg,
    completedCount: concluidas.length,
    occurrenceCount: registros.filter((registro) => registro.status === "ocorrencia").length,
    cancelledCount: registros.filter((registro) => registro.status === "cancelada").length,
    rejectedCount: concluidas.filter((registro) => registro.aprovacaoPesoStatus === "rejeitado").length,
    pendingReviewCount: concluidas.filter((registro) => situacaoDescarte(registro) === "pendente").length,
    auditCount: registros.filter((registro) => situacaoDescarte(registro) === "auditoria").length,
    porSituacao: contarSituacoes(registros),
    byWasteType: porTipoResiduo,
  };
}

function contarSituacoes(registros: Array<typeof coletas.$inferSelect>) {
  const contagem: Record<SituacaoDescarte, number> = { pendente: 0, aprovado: 0, reprovado: 0, auditoria: 0, cancelado: 0 };
  for (const registro of registros) contagem[situacaoDescarte(registro)] += 1;
  return contagem;
}

/** Blocos conhecidos (cadastro de moradores e descartes), em ordem. */
async function blocosDoCondominio(condominioId: number) {
  const db = await getDb();
  const doCadastro = await db.select({ bloco: moradores.bloco }).from(moradores).where(eq(moradores.condominioId, condominioId));
  const dosDescartes = await db.selectDistinct({ bloco: coletas.bloco }).from(coletas).where(eq(coletas.condominioId, condominioId));
  return Array.from(new Set([...doCadastro, ...dosDescartes].map((linha) => linha.bloco).filter((bloco): bloco is string => Boolean(bloco)))).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
}

/** Um bloco contra o outro: quilos aprovados, descartes, moradores, participação e pontos. */
function compararBlocos(registros: Array<typeof coletas.$inferSelect>, comunidade: Array<typeof moradores.$inferSelect>, somenteBloco?: string) {
  const blocos = Array.from(new Set([...comunidade.map((morador) => morador.bloco), ...registros.map((registro) => registro.bloco)].filter(Boolean))).filter((bloco) => !somenteBloco || bloco === somenteBloco).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
  return blocos.map((bloco) => {
    const doBloco = registros.filter((registro) => registro.bloco === bloco && situacaoDescarte(registro) === "aprovado");
    const moradoresDoBloco = comunidade.filter((morador) => morador.bloco === bloco).length;
    const participantes = new Set(doBloco.map((registro) => registro.moradorId).filter(Boolean)).size;
    const gramas = doBloco.reduce((soma, registro) => soma + (pesoConfirmadoGramas(registro) ?? 0), 0);
    const reciclavel = doBloco.filter((registro) => registro.tipoResiduo === "reciclavel").reduce((soma, registro) => soma + (pesoConfirmadoGramas(registro) ?? 0), 0);
    return {
      block: bloco,
      kilograms: Number((gramas / 1000).toFixed(2)),
      recyclableKg: Number((reciclavel / 1000).toFixed(2)),
      descartes: doBloco.length,
      moradores: moradoresDoBloco,
      participantes,
      participationRate: moradoresDoBloco ? Number(((participantes / moradoresDoBloco) * 100).toFixed(1)) : null,
      kgPorMorador: moradoresDoBloco ? Number((gramas / 1000 / moradoresDoBloco).toFixed(2)) : null,
      pontos: doBloco.reduce((soma, registro) => soma + registro.pontosConcedidos, 0),
    };
  });
}

const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Quilos aprovados por mês (últimos `meses` meses), separados por tipo de resíduo, para os gráficos empilhados. */
function kgPorMesETipo(registros: Array<typeof coletas.$inferSelect>, agora: Date, meses = 6) {
  return Array.from({ length: meses }, (_, indice) => {
    const inicio = new Date(agora.getFullYear(), agora.getMonth() - (meses - 1 - indice), 1);
    const fim = new Date(inicio.getFullYear(), inicio.getMonth() + 1, 1);
    const doMes = registros.filter((registro) => registro.status === "concluida" && registro.concluidaEm && registro.concluidaEm >= inicio && registro.concluidaEm < fim);
    const linha: Record<string, number | string> = { mes: `${MESES_CURTOS[inicio.getMonth()]}/${String(inicio.getFullYear()).slice(2)}`, descartes: doMes.length };
    for (const tipo of TIPOS_RESIDUO) linha[tipo] = Number((doMes.filter((registro) => registro.tipoResiduo === tipo).reduce((soma, registro) => soma + (pesoConfirmadoGramas(registro) ?? 0), 0) / 1000).toFixed(2));
    return linha;
  });
}

/** Painel pessoal de um morador: quanto descartou, de que tipos, quando, e a situação de cada descarte. */
async function painelDoMorador(condominioId: number, moradorId: number, paraAdministrador = false) {
  const db = await getDb();
  const [morador] = await db.select().from(moradores).where(and(eq(moradores.id, moradorId), eq(moradores.condominioId, condominioId))).limit(1);
  if (!morador) throw new TRPCError({ code: "NOT_FOUND", message: "Morador não encontrado." });
  const registros = await db.select().from(coletas).where(and(eq(coletas.condominioId, condominioId), eq(coletas.moradorId, moradorId))).orderBy(desc(coletas.agendadaPara), desc(coletas.id));
  const agora = new Date();
  const resumo = resumir(registros);
  const aprovados = registros.filter((registro) => situacaoDescarte(registro) === "aprovado");
  const porTipo = TIPOS_RESIDUO.map((tipo) => {
    const doTipo = aprovados.filter((registro) => registro.tipoResiduo === tipo);
    return { wasteType: tipo, descartes: doTipo.length, kilograms: Number((doTipo.reduce((soma, registro) => soma + (pesoConfirmadoGramas(registro) ?? 0), 0) / 1000).toFixed(2)), pontos: doTipo.reduce((soma, registro) => soma + registro.pontosConcedidos, 0) };
  });
  // Dias da semana e horários em que a pessoa mais descarta (ajuda a ver o hábito).
  const porDiaSemana = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"].map((dia, indice) => ({ dia, descartes: aprovados.filter((registro) => (registro.concluidaEm ?? registro.agendadaPara).getDay() === indice).length }));
  const datas = registros.filter((registro) => registro.status === "concluida").map((registro) => registro.concluidaEm ?? registro.agendadaPara);
  const extrato = await extratoDoMorador(db, moradorId, 10);
  return {
    morador: { id: morador.id, nome: morador.nome, bloco: morador.bloco, apartamento: morador.apartamento, saldo: morador.pontos, fracaoGuardada: morador.restoPontosMilesimos / 1000, status: morador.status },
    totalKg: resumo.totalKg,
    recyclableKg: resumo.recyclableKg,
    descartesAprovados: aprovados.length,
    porSituacao: resumo.porSituacao,
    porTipo,
    porMes: kgPorMesETipo(registros, agora),
    porDiaSemana,
    primeiroDescarte: datas.length ? new Date(Math.min(...datas.map((data) => data.getTime()))) : null,
    ultimoDescarte: datas.length ? new Date(Math.max(...datas.map((data) => data.getTime()))) : null,
    pontosGanhos: aprovados.reduce((soma, registro) => soma + registro.pontosConcedidos, 0),
    equivalencias: calcularEquivalenciasAmbientais(resumo.recyclableKg),
    recentes: registros.slice(0, 12).map((registro) => ({ id: registro.id, lote: registro.lote, data: registro.concluidaEm ?? registro.agendadaPara, wasteType: registro.tipoResiduo, pesoKg: registro.pesoGramas === null ? null : Number((registro.pesoGramas / 1000).toFixed(2)), pontos: registro.pontosConcedidos, situacao: situacaoDescarte(registro) })),
    extrato: extrato.map((linha) => ({ ...linha, rotulo: rotuloMovimentacao[linha.tipo] })),
    gestao: await gestaoDoMorador(db, condominioId, moradorId, morador.usuarioId, paraAdministrador),
  };
}


/**
 * Notificações que a pessoa vê: as dirigidas a ela e os avisos gerais (comunicados, novo prêmio no catálogo) dos tipos que o
 * perfil dela recebe, conforme Configurações > Quem recebe cada aviso.
 */
async function notificacoesVisiveis(ctx: { user: { id: number }; eco: { condominio: { id: number }; perfil: { papel: string } } }) {
  const db = await getDb();
  const papel = ctx.eco.perfil.papel as EcoRole;
  const desligados = await db.select({ tipo: preferenciasNotificacao.tipo }).from(preferenciasNotificacao).where(and(eq(preferenciasNotificacao.condominioId, ctx.eco.condominio.id), eq(preferenciasNotificacao.papel, papel), eq(preferenciasNotificacao.ativo, false)));
  const tipos = (tiposPorPerfil[papel] ?? []).filter((tipo) => NOTIFICACOES_OBRIGATORIAS.includes(tipo) || !desligados.some((linha) => linha.tipo === tipo));
  // Avisos gerais podem ir só para moradores ou só para administradores (campo "publico").
  const publico = or(sql`${notificacoes.publico} IS NULL`, eq(notificacoes.publico, "todos"), eq(notificacoes.publico, papel === "morador" ? "moradores" : "administradores"));
  return or(eq(notificacoes.destinatarioId, ctx.user.id), and(sql`${notificacoes.destinatarioId} IS NULL`, tipos.length ? inArray(notificacoes.tipo, tipos) : sql`false`, publico));
}

/** Visão geral dos relatórios do administrador (tela, PDF e planilha usam os mesmos números). */
export async function visaoGeralDoCondominio(condominioId: number, input?: { startDate?: Date; endDate?: Date; block?: string }) {
  const db = await getDb();
  const registros = await db.select().from(coletas).where(and(...condicoesCsv(condominioId, input))).orderBy(desc(coletas.agendadaPara));
  const todosMoradores = await db.select().from(moradores).where(eq(moradores.condominioId, condominioId));
  const comunidade = input?.block ? todosMoradores.filter((morador) => morador.bloco === input.block) : todosMoradores;
  // Ranking pelos pontos ganhos no período (não pelo saldo, que cai quando o morador resgata uma recompensa).
  const classificados = classificarPodio(descontarPenalidades(somarPorMorador(registros.filter((registro) => registro.status === "concluida")), await ajustesDePenalidade(condominioId, input?.startDate, input?.endDate)));
  const ranking = classificados.slice(0, 10).map((linha) => {
    const morador = todosMoradores.find((item) => item.id === linha.moradorId);
    return { position: linha.posicao, id: linha.moradorId, name: morador?.nome ?? "Morador removido", block: morador?.bloco ?? "—", points: linha.pontos, weightKg: Number((linha.pesoGramas / 1000).toFixed(2)) };
  });
  const participantes = new Set(registros.filter((registro) => situacaoDescarte(registro) === "aprovado" && registro.moradorId !== null).map((registro) => registro.moradorId));
  const resumo = resumir(registros);
  const idsDoFiltro = input?.block ? new Set(comunidade.map((morador) => morador.id)) : null;
  const movimentacoes = (await db.select({ tipo: movimentacoesPontos.tipo, pontos: movimentacoesPontos.pontos, moradorId: movimentacoesPontos.moradorId }).from(movimentacoesPontos).where(and(eq(movimentacoesPontos.condominioId, condominioId), ...condicoesDataEm(movimentacoesPontos.criadoEm, input)))).filter((linha) => !idsDoFiltro || idsDoFiltro.has(linha.moradorId));
  const pontos = resumirPontos(movimentacoes);
  const resgatesPeriodo = (await db.select({ status: resgates.status, pontosGastos: resgates.pontosGastos, recompensa: recompensas.titulo, moradorId: resgates.moradorId }).from(resgates).leftJoin(recompensas, eq(recompensas.id, resgates.recompensaId)).where(and(eq(resgates.condominioId, condominioId), ...condicoesDataEm(resgates.criadoEm, input)))).filter((linha) => !idsDoFiltro || idsDoFiltro.has(linha.moradorId));
  const validos = resgatesPeriodo.filter((item) => item.status !== "cancelado");
  const porRecompensa = Array.from(validos.reduce((mapa, item) => {
    const chave = item.recompensa ?? "Recompensa removida";
    const atual = mapa.get(chave) ?? { titulo: chave, quantidade: 0, pontos: 0 };
    atual.quantidade += 1;
    atual.pontos += item.pontosGastos;
    return mapa.set(chave, atual);
  }, new Map<string, { titulo: string; quantidade: number; pontos: number }>()).values()).sort((a, b) => b.quantidade - a.quantidade);
  const incidentes = await db.select({ id: ocorrencias.id }).from(ocorrencias).where(and(eq(ocorrencias.condominioId, condominioId), ...condicoesDataEm(ocorrencias.criadoEm, input)));
  const [auditoria] = await db.select({ total: sql<number>`count(*)` }).from(logsAuditoria).where(and(eq(logsAuditoria.condominioId, condominioId), ...condicoesDataEm(logsAuditoria.criadoEm, input)));
  return {
    ...resumo,
    ranking,
    participationRate: comunidade.length ? Number(((participantes.size / comunidade.length) * 100).toFixed(1)) : null,
    residentsCount: comunidade.length,
    participantsCount: participantes.size,
    period: input ?? {},
    equivalencias: calcularEquivalenciasAmbientais(resumo.recyclableKg),
    pontos,
    resgates: { total: validos.length, entregues: validos.filter((item) => item.status === "entregue").length, pendentes: validos.filter((item) => item.status === "solicitado" || item.status === "aprovado").length, cancelados: resgatesPeriodo.length - validos.length, porRecompensa },
    environmentalIncidents: incidentes.length,
    auditEvents: Number(auditoria?.total ?? 0),
    // A comparação entre blocos mostra sempre todos os blocos do período; o bloco escolhido aparece destacado na tela.
    porBloco: input?.block ? compararBlocos(await db.select().from(coletas).where(and(...condicoesPeriodo(condominioId, input))), todosMoradores) : compararBlocos(registros, todosMoradores),
    porMes: kgPorMesETipo(registros, input?.endDate ?? new Date(), 6),
    blocos: await blocosDoCondominio(condominioId),
    gestao: await indicadoresGerais(db, condominioId, input),
  };
}

/** Dados do PDF e da planilha: a visão geral do período e o top 3 com a mesma privacidade do pódio (o PDF pode circular). */
export async function dadosDoRelatorio(condominioId: number, nomeCondominio: string, input?: { startDate?: Date; endDate?: Date; block?: string }): Promise<DadosRelatorioPdf> {
  const db = await getDb();
  const visao = await visaoGeralDoCondominio(condominioId, input);
  const comunidade = await db.select().from(moradores).where(eq(moradores.condominioId, condominioId));
  const suspensoes = await suspensoesVigentesDoCondominio(db, condominioId);
  const registros = await db.select().from(coletas).where(and(...condicoesCsv(condominioId, input), eq(coletas.status, "concluida")));
  const top3 = classificarPodio(descontarPenalidades(somarPorMorador(registros), await ajustesDePenalidade(condominioId, input?.startDate, input?.endDate))).filter((linha) => linha.noPodio).map((linha) => {
    const morador = comunidade.find((item) => item.id === linha.moradorId);
    return { posicao: linha.posicao, nome: morador ? nomePublico(morador, suspensoes.has(morador.id)) : "Morador removido", bloco: morador?.bloco ?? "-", pontos: linha.pontos, pesoKg: Number((linha.pesoGramas / 1000).toFixed(2)) };
  });
  return {
    condominio: nomeCondominio,
    bloco: input?.block,
    inicio: input?.startDate,
    fim: input?.endDate,
    geradoEm: new Date(),
    totalKg: visao.totalKg,
    recyclableKg: visao.recyclableKg,
    recyclingRate: visao.recyclingRate,
    co2EstimateKg: visao.co2EstimateKg,
    completedCount: visao.completedCount,
    porSituacao: visao.porSituacao,
    byWasteType: visao.byWasteType,
    participationRate: visao.participationRate,
    residentsCount: visao.residentsCount,
    participantsCount: visao.participantsCount,
    equivalencias: visao.equivalencias,
    pontos: visao.pontos,
    resgates: visao.resgates,
    environmentalIncidents: visao.environmentalIncidents,
    auditEvents: visao.auditEvents,
    porBloco: visao.porBloco,
    porMes: visao.porMes,
    top3,
    gestao: visao.gestao,
  };
}

export const analyticsRouter = router({
  dashboard: router({
    resumo: withProfile.query(async ({ ctx }) => {
      const db = await getDb();
      const ehMorador = ctx.eco.perfil.papel === "morador";
      const registros = await db.select().from(coletas).where(and(...condicoesPeriodo(ctx.eco.condominio.id))).orderBy(desc(coletas.agendadaPara));
      const registrosPermitidos = ehMorador ? registros.filter((registro) => registro.moradorId === ctx.eco.morador?.id) : registros;
      const resumo = resumir(registrosPermitidos);
      // Ocorrências ambientais ainda sem solução (o morador vê só as que ele mesmo registrou).
      const condicoesOcorrencias = [eq(ocorrencias.condominioId, ctx.eco.condominio.id), or(eq(ocorrencias.status, "aberta"), eq(ocorrencias.status, "em_analise"))];
      if (ehMorador) condicoesOcorrencias.push(eq(ocorrencias.relatorId, ctx.user.id));
      const ocorrenciasAbertas = await db.select({ id: ocorrencias.id }).from(ocorrencias).where(and(...condicoesOcorrencias));

      const agora = new Date();
      const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
      const movimentacoes = ehMorador && !ctx.eco.morador ? [] : await movimentacoesDoPeriodo(ctx.eco.condominio.id, { startDate: inicioMes }, ehMorador ? ctx.eco.morador!.id : undefined);

      // Resumo do top 3 do mês, com a mesma privacidade do pódio (o morador vê o nome só de quem aceitou aparecer).
      const { inicio, fim } = calcularIntervalo("mensal", agora);
      const comunidade = await db.select({ id: moradores.id, nome: moradores.nome, bloco: moradores.bloco, ocultarNomeNoPodio: moradores.ocultarNomeNoPodio }).from(moradores).where(eq(moradores.condominioId, ctx.eco.condominio.id));
      const porId = new Map(comunidade.map((morador) => [morador.id, morador]));
      const classificados = (await classificacaoDoPeriodo(ctx.eco.condominio.id, inicio, fim)).filter((linha) => porId.has(linha.moradorId));
      const suspensoes = await suspensoesVigentesDoCondominio(db, ctx.eco.condominio.id);
      const top3 = classificados.filter((linha) => linha.noPodio).map((linha) => {
        const morador = porId.get(linha.moradorId)!;
        const suspensao = suspensoes.get(linha.moradorId);
        return { position: linha.posicao, suspenso: Boolean(suspensao), suspensaoPeriodo: suspensao?.periodo ?? null, nome: ehMorador && linha.moradorId !== ctx.eco.morador?.id ? nomePublico(morador, Boolean(suspensao)) : morador.nome, bloco: morador.bloco, pontos: linha.pontos, pesoKg: Number((linha.pesoGramas / 1000).toFixed(2)), voce: linha.moradorId === ctx.eco.morador?.id };
      });
      const minhaPosicao = ehMorador ? classificados.find((linha) => linha.moradorId === ctx.eco.morador?.id)?.posicao ?? null : null;

      return {
        ...resumo,
        openIncidentCount: ocorrenciasAbertas.length,
        recent: registrosPermitidos.slice(0, 5),
        equivalencias: calcularEquivalenciasAmbientais(resumo.recyclableKg),
        comparacao: compararPeriodos(registrosPermitidos, agora),
        evolucao: evolucaoMensal(registrosPermitidos, agora),
        taxaConclusao: taxaDeConclusao(registrosPermitidos, agora),
        pontosMes: resumirPontos(movimentacoes),
        saldo: ehMorador ? ctx.eco.morador?.pontos ?? 0 : null,
        top3,
        minhaPosicao,
        totalNoRanking: classificados.length,
        alertas: ehMorador ? [] : await alertasAdministrativos(ctx.eco.condominio.id, registros, agora),
        gestao: ehMorador ? null : await indicadoresGerais(db, ctx.eco.condominio.id),
        pessoal: ehMorador && ctx.eco.morador ? await gestaoDoMorador(db, ctx.eco.condominio.id, ctx.eco.morador.id, ctx.user.id, false) : null,
      };
    }),
    /** Painel pessoal: o morador vê o dele; o administrador abre o de qualquer morador (Moradores > Ver painel). */
    morador: withProfile.input(z.object({ residentId: z.number().int().positive().optional() }).optional()).query(async ({ ctx, input }) => {
      if (ctx.eco.perfil.papel === "morador") {
        if (input?.residentId && input.residentId !== ctx.eco.morador?.id) throw new TRPCError({ code: "FORBIDDEN", message: "Você só pode ver o seu próprio painel." });
        if (!ctx.eco.morador) throw new TRPCError({ code: "NOT_FOUND", message: "Seu cadastro de morador não foi encontrado." });
        return painelDoMorador(ctx.eco.condominio.id, ctx.eco.morador.id);
      }
      if (!input?.residentId) throw new TRPCError({ code: "BAD_REQUEST", message: "Escolha um morador." });
      return painelDoMorador(ctx.eco.condominio.id, input.residentId, true);
    }),
  }),
  relatorios: router({
    /** Blocos que aparecem nos cadastros e nos descartes, para o filtro dos relatórios. */
    blocos: administratorOnly.query(async ({ ctx }) => blocosDoCondominio(ctx.eco.condominio.id)),
    visaoGeral: administratorOnly.input(periodInput).query(async ({ ctx, input }) => visaoGeralDoCondominio(ctx.eco.condominio.id, input)),
    exportarPdf: administratorOnly.input(periodInput).mutation(async ({ ctx, input }) => {
      const dados = await dadosDoRelatorio(ctx.eco.condominio.id, ctx.eco.condominio.nome, input);
      const bytes = await gerarRelatorioPdf(dados);
      return { filename: `relatorio-ecocondo${input?.block ? `-bloco-${input.block}` : ""}-${new Date().toISOString().slice(0, 10)}.pdf`, contentBase64: Buffer.from(bytes).toString("base64") };
    }),
    /** Planilha completa em Excel (.xlsx), com uma aba por assunto e as mesmas contas do PDF e da tela. */
    exportarPlanilha: administratorOnly.input(periodInput).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const condominioId = ctx.eco.condominio.id;
      const base = await dadosDoRelatorio(condominioId, ctx.eco.condominio.nome, input);
      const comunidade = await db.select().from(moradores).where(eq(moradores.condominioId, condominioId));
      const nomeDoMorador = (id: number | null) => comunidade.find((morador) => morador.id === id)?.nome ?? "";
      const idsDoFiltro = input?.block ? new Set(comunidade.filter((morador) => morador.bloco === input.block).map((morador) => morador.id)) : null;
      const registros = await db.select().from(coletas).where(and(...condicoesCsv(condominioId, input))).orderBy(desc(coletas.agendadaPara));
      const origens = await origensDosRegistros(condominioId, registros);
      const extrato = (await db.select().from(movimentacoesPontos).where(and(eq(movimentacoesPontos.condominioId, condominioId), ...condicoesDataEm(movimentacoesPontos.criadoEm, input))).orderBy(desc(movimentacoesPontos.criadoEm))).filter((linha) => !idsDoFiltro || idsDoFiltro.has(linha.moradorId));
      const listaResgates = (await db.select({ resgate: resgates, recompensa: recompensas.titulo }).from(resgates).leftJoin(recompensas, eq(recompensas.id, resgates.recompensaId)).where(and(eq(resgates.condominioId, condominioId), ...condicoesDataEm(resgates.criadoEm, input))).orderBy(desc(resgates.criadoEm))).filter(({ resgate }) => !idsDoFiltro || idsDoFiltro.has(resgate.moradorId));
      const medidas = (await historicoPenalidades(db, condominioId)).filter((medida) => (!input?.startDate || medida.criadoEm >= input.startDate) && (!input?.endDate || medida.criadoEm <= input.endDate) && (!idsDoFiltro || idsDoFiltro.has(medida.moradorId)));
      const conteudo = await gerarRelatorioPlanilha({
        ...base,
        ranking: (await visaoGeralDoCondominio(condominioId, input)).ranking,
        descartes: registros.map((registro) => ({ id: registro.id, data: registro.concluidaEm ?? registro.agendadaPara, morador: nomeDoMorador(registro.moradorId), bloco: registro.bloco, tipo: rotuloResiduo[registro.tipoResiduo], pesoKg: registro.pesoGramas === null ? null : registro.pesoGramas / 1000, situacao: rotuloSituacao[situacaoDescarte(registro)], pontos: registro.pontosConcedidos, origem: origens(registro), observacoes: [registro.observacoes, registro.motivoDecisao ? `Decisão: ${registro.motivoDecisao}` : null].filter(Boolean).join(" ") })),
        extrato: extrato.map((linha) => ({ data: linha.criadoEm, morador: nomeDoMorador(linha.moradorId), movimentacao: rotuloMovimentacao[linha.tipo], pontos: linha.pontos, saldo: linha.saldoApos, descricao: linha.descricao })),
        resgates: { ...base.resgates, lista: listaResgates.map(({ resgate, recompensa }) => ({ data: resgate.criadoEm, morador: nomeDoMorador(resgate.moradorId), recompensa: recompensa ?? "Recompensa removida", pontos: resgate.pontosGastos, status: rotuloStatusResgate[resgate.status] })) },
        medidas: medidas.map((medida) => ({ data: medida.criadoEm, morador: medida.morador ?? "", bloco: medida.bloco ?? "", tipo: rotuloTipoPenalidade[medida.tipo], nome: medida.nome, periodo: medida.periodo ?? "", situacao: medida.vigente ? "Valendo" : medida.status === "revogada" ? "Revogada" : "Encerrada", motivo: medida.motivo, aplicadaPor: medida.aplicadaPor })),
      });
      return { filename: `relatorio-ecocondo${input?.block ? `-bloco-${input.block}` : ""}-${new Date().toISOString().slice(0, 10)}.xlsx`, contentBase64: conteudo.toString("base64") };
    }),
    exportarCsv: administratorOnly.input(csvFiltersInput).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const hoje = new Date().toISOString().slice(0, 10);
      const comunidade = await db.select().from(moradores).where(eq(moradores.condominioId, ctx.eco.condominio.id));
      const nomeDoMorador = (id: number | null) => comunidade.find((morador) => morador.id === id)?.nome ?? "";
      const tipo = input?.kind ?? "coletas";
      if (tipo === "pontos") {
        const linhas = await db.select().from(movimentacoesPontos).where(and(eq(movimentacoesPontos.condominioId, ctx.eco.condominio.id), ...condicoesDataEm(movimentacoesPontos.criadoEm, input))).orderBy(desc(movimentacoesPontos.criadoEm));
        return { filename: `extrato-pontos-ecocondo-${hoje}.csv`, content: construirCsv(["Data", "Morador", "Movimentação", "Pontos", "Saldo depois", "Coleta", "Resgate", "Descrição"], linhas.map((linha) => [dataHoraCsv(linha.criadoEm), nomeDoMorador(linha.moradorId), rotuloMovimentacao[linha.tipo], linha.pontos, linha.saldoApos, linha.coletaId, linha.resgateId, linha.descricao])) };
      }
      if (tipo === "resgates") {
        const linhas = await db.select({ resgate: resgates, recompensa: recompensas.titulo }).from(resgates).leftJoin(recompensas, eq(recompensas.id, resgates.recompensaId)).where(and(eq(resgates.condominioId, ctx.eco.condominio.id), ...condicoesDataEm(resgates.criadoEm, input))).orderBy(desc(resgates.criadoEm));
        return { filename: `resgates-ecocondo-${hoje}.csv`, content: construirCsv(["ID", "Solicitado em", "Morador", "Recompensa", "Pontos", "Status", "Atualizado em"], linhas.map(({ resgate, recompensa }) => [resgate.id, dataHoraCsv(resgate.criadoEm), nomeDoMorador(resgate.moradorId), recompensa ?? "Recompensa removida", resgate.pontosGastos, rotuloStatusResgate[resgate.status], dataHoraCsv(resgate.atualizadoEm)])) };
      }
      if (tipo === "auditoria") {
        const linhas = await db.select({ registro: logsAuditoria, autor: usuarios.nome }).from(logsAuditoria).leftJoin(usuarios, eq(usuarios.id, logsAuditoria.autorId)).where(and(eq(logsAuditoria.condominioId, ctx.eco.condominio.id), ...condicoesDataEm(logsAuditoria.criadoEm, input))).orderBy(desc(logsAuditoria.criadoEm));
        return { filename: `auditoria-ecocondo-${hoje}.csv`, content: construirCsv(["Data e hora", "Usuário", "Operação", "Registro afetado", "Resumo", "Motivo / observação", "Valor anterior", "Valor novo"], linhas.map(({ registro, autor }) => [dataHoraCsv(registro.criadoEm), autor ?? `Usuário #${registro.autorId}`, registro.acao, `${registro.tipoEntidade} #${registro.entidadeId}`, registro.resumo, registro.motivo, registro.estadoAnterior, registro.estadoNovo])) };
      }
      const registros = await db.select().from(coletas).where(and(...condicoesCsv(ctx.eco.condominio.id, input))).orderBy(desc(coletas.agendadaPara));
      const origens = await origensDosRegistros(ctx.eco.condominio.id, registros);
      const conteudo = buildCollectionsCsv(registros.map((registro) => ({
        id: registro.id,
        status: rotuloSituacao[situacaoDescarte(registro)],
        wasteType: registro.tipoResiduo,
        block: registro.bloco,
        scheduledAt: registro.agendadaPara,
        completedAt: registro.concluidaEm,
        weightGrams: registro.pesoGramas,
        pointsAwarded: registro.pontosConcedidos,
        notes: [registro.observacoes, registro.motivoDecisao ? `Decisão: ${registro.motivoDecisao}` : null].filter(Boolean).join(" ") || null,
        residentName: nomeDoMorador(registro.moradorId) || null,
        origin: origens(registro),
      })));
      return { filename: `descartes-ecocondo${input?.block ? `-bloco-${input.block}` : ""}-${hoje}.csv`, content: conteudo };
    }),
    anuais: administratorOnly.query(async ({ ctx }) => {
      const db = await getDb();
      return db.select().from(relatoriosAnuais).where(eq(relatoriosAnuais.condominioId, ctx.eco.condominio.id)).orderBy(desc(relatoriosAnuais.ano));
    }),
  }),
  engajamento: router({
    /** Ranking de engajamento pelos pontos ganhos (créditos menos estornos); resgatar uma recompensa não derruba ninguém no ranking. */
    ranking: withProfile.query(async ({ ctx }) => {
      const db = await getDb();
      // Só os campos exibidos no ranking: e-mail, telefone e códigos dos vizinhos não saem do servidor.
      const comunidade = await db.select({ moradorId: moradores.id, nome: moradores.nome, bloco: moradores.bloco, apartamento: moradores.apartamento, saldo: moradores.pontos, ocultarNomeNoPodio: moradores.ocultarNomeNoPodio }).from(moradores).where(eq(moradores.condominioId, ctx.eco.condominio.id));
      const porId = new Map(comunidade.map((morador) => [morador.moradorId, morador]));
      const classificados = classificarPodio((await pontosAcumulados(ctx.eco.condominio.id)).filter((linha) => porId.has(linha.moradorId)));
      const suspensoes = await suspensoesVigentesDoCondominio(db, ctx.eco.condominio.id);
      const saldo = ctx.eco.morador ? (await db.select({ pontos: moradores.pontos }).from(moradores).where(eq(moradores.id, ctx.eco.morador.id)).limit(1))[0]?.pontos ?? 0 : null;
      if (ctx.eco.perfil.papel === "administrador") {
        return {
          linhas: classificados.map((linha) => {
            const morador = porId.get(linha.moradorId)!;
            return { position: linha.posicao, id: linha.moradorId, nome: morador.nome, bloco: morador.bloco, apartamento: morador.apartamento as string | null, pontos: linha.pontos, saldo: morador.saldo as number | null, pesoKg: Number((linha.pesoGramas / 1000).toFixed(2)), voce: false, suspensaoPeriodo: suspensoes.get(linha.moradorId)?.periodo ?? null };
          }),
          minhaPosicao: null,
          totalParticipantes: classificados.length,
          saldo,
        };
      }
      // Morador: só o top 3 (nome e bloco) e a própria posição; ninguém abaixo do 3º lugar é exposto.
      const { publicas, minha, total } = recortarRankingPublico(classificados, ctx.eco.morador?.id ?? null);
      return {
        linhas: publicas.map((linha) => {
          const morador = porId.get(linha.moradorId)!;
          const voce = linha.moradorId === ctx.eco.morador?.id;
          const suspensao = suspensoes.get(linha.moradorId);
          return { position: linha.posicao, id: null as number | null, nome: voce ? morador.nome : nomePublico(morador, Boolean(suspensao)), bloco: morador.bloco, apartamento: null as string | null, pontos: linha.pontos, saldo: null as number | null, pesoKg: Number((linha.pesoGramas / 1000).toFixed(2)), voce, suspensaoPeriodo: suspensao?.periodo ?? null };
        }),
        minhaPosicao: minha ? { position: minha.posicao, pontos: minha.pontos } : null,
        totalParticipantes: total,
        saldo,
      };
    }),
    /** Extrato de pontos: o morador vê o dele; o administrador pode ver o de qualquer morador do condomínio. */
    extrato: withProfile.input(z.object({ residentId: z.number().int().positive().optional() }).optional()).query(async ({ ctx, input }) => {
      const db = await getDb();
      let moradorId = ctx.eco.morador?.id ?? null;
      if (input?.residentId && input.residentId !== moradorId) {
        if (ctx.eco.perfil.papel !== "administrador") throw new TRPCError({ code: "FORBIDDEN", message: "Você só pode ver o seu próprio extrato." });
        const alvo = await db.select({ id: moradores.id }).from(moradores).where(and(eq(moradores.id, input.residentId), eq(moradores.condominioId, ctx.eco.condominio.id))).limit(1);
        if (!alvo[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Morador não encontrado." });
        moradorId = alvo[0].id;
      }
      if (!moradorId) return { saldo: 0, ganhos: 0, gastos: 0, movimentacoes: [] };
      const [morador] = await db.select({ pontos: moradores.pontos }).from(moradores).where(eq(moradores.id, moradorId)).limit(1);
      const linhas = await extratoDoMorador(db, moradorId);
      const todas = await db.select({ tipo: movimentacoesPontos.tipo, pontos: movimentacoesPontos.pontos }).from(movimentacoesPontos).where(eq(movimentacoesPontos.moradorId, moradorId));
      return {
        saldo: morador?.pontos ?? 0,
        ganhos: todas.filter((item) => item.pontos > 0).reduce((soma, item) => soma + item.pontos, 0),
        gastos: todas.filter((item) => item.pontos < 0).reduce((soma, item) => soma - item.pontos, 0),
        movimentacoes: linhas.map((linha) => ({ ...linha, rotulo: rotuloMovimentacao[linha.tipo] })),
      };
    }),
    recompensas: withProfile.query(async ({ ctx }) => {
      const db = await getDb();
      const condicoes = [eq(recompensas.condominioId, ctx.eco.condominio.id)];
      // O administrador vê também as recompensas desativadas, para poder reativá-las.
      if (ctx.eco.perfil.papel !== "administrador") condicoes.push(eq(recompensas.ativo, true));
      const linhas = await db.select().from(recompensas).where(and(...condicoes)).orderBy(asc(recompensas.custoPontos));
      return linhas.map((recompensa) => ({ ...recompensa, disponivel: recompensa.ativo && (recompensa.estoque === null || recompensa.estoque > 0), estoqueBaixo: recompensa.estoque !== null && recompensa.estoque > 0 && recompensa.estoque <= LIMITE_ESTOQUE_BAIXO }));
    }),
    criarRecompensa: administratorOnly.input(z.object({ title: z.string().trim().min(3).max(140), description: z.string().trim().min(4).max(1000), pointsCost: z.number().int().min(1).max(100000), stock: z.number().int().min(0).max(100000).nullable() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const inserida = await db.insert(recompensas).values({ condominioId: ctx.eco.condominio.id, titulo: input.title, descricao: input.description, custoPontos: input.pointsCost, estoque: input.stock }).$returningId();
      await writeAuditLog(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "recompensa", entidadeId: inserida[0].id, acao: "recompensa_criada", resumo: `Recompensa "${input.title}" adicionada ao catálogo (${input.pointsCost} pontos).`, estadoNovo: { titulo: input.title, custoPontos: input.pointsCost, estoque: input.stock } });
      // Comunicado para todos (destinatário nulo): novo prêmio disponível no catálogo.
      await db.insert(notificacoes).values({ condominioId: ctx.eco.condominio.id, destinatarioId: null, tipo: "novo_premio", titulo: "Novo prêmio no catálogo", mensagem: `"${input.title}" já pode ser resgatado por ${input.pointsCost} ponto(s)${input.stock !== null ? ` (${input.stock} disponível(is))` : ""}. Veja em Engajamento.` });
      return { id: inserida[0].id };
    }),
    /** Muda custo, estoque ou disponibilidade de uma recompensa do catálogo (com auditoria do valor anterior e do novo). */
    atualizarRecompensa: administratorOnly.input(z.object({ id: z.number().int().positive(), pointsCost: z.number().int().min(1).max(100000).optional(), stock: z.number().int().min(0).max(100000).nullable().optional(), active: z.boolean().optional() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const encontrada = await db.select().from(recompensas).where(and(eq(recompensas.id, input.id), eq(recompensas.condominioId, ctx.eco.condominio.id))).limit(1);
      const recompensa = encontrada[0];
      if (!recompensa) throw new TRPCError({ code: "NOT_FOUND", message: "Recompensa não encontrada." });
      const novo = { custoPontos: input.pointsCost ?? recompensa.custoPontos, estoque: input.stock === undefined ? recompensa.estoque : input.stock, ativo: input.active ?? recompensa.ativo };
      await db.update(recompensas).set({ ...novo, atualizadoEm: new Date() }).where(eq(recompensas.id, recompensa.id));
      await writeAuditLog(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "recompensa", entidadeId: recompensa.id, acao: "recompensa_atualizada", resumo: `Recompensa "${recompensa.titulo}" atualizada.`, estadoAnterior: { custoPontos: recompensa.custoPontos, estoque: recompensa.estoque, ativo: recompensa.ativo }, estadoNovo: novo });
      return { success: true };
    }),
    resgatar: withProfile.input(z.object({ rewardId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (ctx.eco.perfil.papel !== "morador" || !ctx.eco.morador || ctx.eco.morador.status !== "ativo") throw new TRPCError({ code: "FORBIDDEN", message: "Apenas moradores ativos podem solicitar recompensas." });
      const encontrada = await db.select().from(recompensas).where(and(eq(recompensas.id, input.rewardId), eq(recompensas.condominioId, ctx.eco.condominio.id), eq(recompensas.ativo, true))).limit(1);
      const recompensa = encontrada[0];
      if (!recompensa) throw new TRPCError({ code: "NOT_FOUND", message: "Recompensa não encontrada." });
      await exigirSemSuspensao(db, ctx.eco.morador.id, "suspensao_participacao", "resgatar prêmios");
      const morador = ctx.eco.morador;
      const recusar = async (motivo: "sem_pontos" | "sem_estoque") => {
        const mensagem = motivo === "sem_pontos" ? "Pontuação insuficiente para esta recompensa." : "Esta recompensa está sem estoque.";
        await notificarUsuario(db, ctx.user.id, { condominioId: ctx.eco.condominio.id, tipo: "resgate_recusado", titulo: "Resgate não realizado", mensagem: motivo === "sem_pontos" ? `Você não tem pontos suficientes para "${recompensa.titulo}" (custa ${recompensa.custoPontos}). Nenhum ponto foi descontado.` : `"${recompensa.titulo}" está sem estoque no momento. Nenhum ponto foi descontado.` });
        throw new TRPCError({ code: "BAD_REQUEST", message: mensagem });
      };
      if (recompensa.estoque !== null && recompensa.estoque <= 0) await recusar("sem_estoque");
      // Débito de pontos, baixa de estoque e extrato na mesma transação, com atualização condicional: dois cliques simultâneos não geram resgate a mais.
      let saldoDepois: number | null = null;
      let estoqueDepois: number | null = recompensa.estoque;
      const resultado = await db.transaction(async (tx) => {
        if (recompensa.estoque !== null) {
          const [baixa] = await tx.update(recompensas).set({ estoque: sql`${recompensas.estoque} - 1`, atualizadoEm: new Date() }).where(and(eq(recompensas.id, recompensa.id), gt(recompensas.estoque, 0)));
          if (!baixa.affectedRows) return "sem_estoque" as const;
          estoqueDepois = (await tx.select({ estoque: recompensas.estoque }).from(recompensas).where(eq(recompensas.id, recompensa.id)).limit(1))[0]?.estoque ?? null;
        }
        const inserido = await tx.insert(resgates).values({ condominioId: ctx.eco.condominio.id, moradorId: morador.id, recompensaId: recompensa.id, pontosGastos: recompensa.custoPontos }).$returningId();
        saldoDepois = await movimentarPontos(tx, { condominioId: ctx.eco.condominio.id, moradorId: morador.id, tipo: "resgate", pontos: -recompensa.custoPontos, resgateId: inserido[0].id, autorId: ctx.user.id, descricao: `Resgate: ${recompensa.titulo}`, exigirSaldo: true });
        // Sem saldo: lançar dentro da transação desfaz a baixa de estoque e o pedido.
        if (saldoDepois === null) throw new SemSaldoError();
        return inserido[0].id;
      }).catch((error: unknown) => {
        if (error instanceof SemSaldoError) return "sem_pontos" as const;
        throw error;
      });
      if (resultado === "sem_pontos" || resultado === "sem_estoque") await recusar(resultado);
      const resgateId = resultado as number;
      await writeAuditLog(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "resgate", entidadeId: resgateId, acao: "resgate_solicitado", resumo: `${morador.nome} resgatou "${recompensa.titulo}" por ${recompensa.custoPontos} ponto(s).`, estadoAnterior: { saldo: (saldoDepois ?? 0) + recompensa.custoPontos, estoque: recompensa.estoque }, estadoNovo: { saldo: saldoDepois, estoque: estoqueDepois, status: "solicitado" } });
      await notificarUsuario(db, ctx.user.id, { condominioId: ctx.eco.condominio.id, tipo: "premio_resgatado", titulo: "Prêmio resgatado", mensagem: `Você resgatou "${recompensa.titulo}" por ${recompensa.custoPontos} ponto(s). Saldo atual: ${saldoDepois} ponto(s). A administração avisa quando estiver pronto para retirar.` });
      await notificarAdministradores(db, { condominioId: ctx.eco.condominio.id, tipo: "novo_resgate", titulo: "Novo resgate de prêmio", mensagem: `${morador.nome} (bloco ${morador.bloco}) resgatou "${recompensa.titulo}". Aprove ou registre a entrega em Engajamento > Pedidos de resgate.` });
      if (estoqueDepois === 0) await notificarAdministradores(db, { condominioId: ctx.eco.condominio.id, tipo: "sem_estoque", titulo: "Prêmio sem estoque", mensagem: `"${recompensa.titulo}" acabou. Reponha o estoque ou desative a recompensa em Engajamento.` });
      else if (estoqueDepois !== null && estoqueDepois <= LIMITE_ESTOQUE_BAIXO) await notificarAdministradores(db, { condominioId: ctx.eco.condominio.id, tipo: "estoque_baixo", titulo: "Estoque baixo", mensagem: `Restam ${estoqueDepois} unidade(s) de "${recompensa.titulo}".` });
      return { success: true, id: resgateId, balance: saldoDepois };
    }),
    meusResgates: withProfile.query(async ({ ctx }) => {
      if (!ctx.eco.morador) return [];
      const db = await getDb();
      return db.select({ id: resgates.id, status: resgates.status, pontosGastos: resgates.pontosGastos, criadoEm: resgates.criadoEm, atualizadoEm: resgates.atualizadoEm, recompensa: recompensas.titulo }).from(resgates).leftJoin(recompensas, eq(recompensas.id, resgates.recompensaId)).where(and(eq(resgates.condominioId, ctx.eco.condominio.id), eq(resgates.moradorId, ctx.eco.morador.id))).orderBy(desc(resgates.criadoEm));
    }),
    listarResgates: administratorOnly.query(async ({ ctx }) => {
      const db = await getDb();
      return db.select({ id: resgates.id, status: resgates.status, pontosGastos: resgates.pontosGastos, criadoEm: resgates.criadoEm, atualizadoEm: resgates.atualizadoEm, recompensa: recompensas.titulo, morador: moradores.nome, bloco: moradores.bloco, apartamento: moradores.apartamento }).from(resgates).leftJoin(recompensas, eq(recompensas.id, resgates.recompensaId)).leftJoin(moradores, eq(moradores.id, resgates.moradorId)).where(eq(resgates.condominioId, ctx.eco.condominio.id)).orderBy(desc(resgates.criadoEm));
    }),
    atualizarResgate: administratorOnly.input(z.object({ id: z.number().int().positive(), status: z.enum(["aprovado", "entregue", "cancelado"]), reason: z.string().trim().max(500).nullable().optional() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const encontrado = await db.select().from(resgates).where(and(eq(resgates.id, input.id), eq(resgates.condominioId, ctx.eco.condominio.id))).limit(1);
      const resgate = encontrado[0];
      if (!resgate) throw new TRPCError({ code: "NOT_FOUND", message: "Resgate não encontrado." });
      if (resgate.status === "entregue" || resgate.status === "cancelado") throw new TRPCError({ code: "BAD_REQUEST", message: "Este resgate já foi finalizado." });
      const recompensa = (await db.select({ titulo: recompensas.titulo }).from(recompensas).where(eq(recompensas.id, resgate.recompensaId)).limit(1))[0]?.titulo ?? "recompensa";
      await db.transaction(async (tx) => {
        // Só muda se ninguém finalizou o resgate no meio do caminho (evita devolver os pontos duas vezes).
        const [alteracao] = await tx.update(resgates).set({ status: input.status, atualizadoEm: new Date() }).where(and(eq(resgates.id, resgate.id), inArray(resgates.status, ["solicitado", "aprovado"])));
        if (!alteracao.affectedRows) throw new TRPCError({ code: "CONFLICT", message: "Este resgate acabou de ser finalizado por outra pessoa." });
        if (input.status === "cancelado") {
          // Cancelar devolve os pontos ao morador e a unidade ao estoque.
          await movimentarPontos(tx, { condominioId: resgate.condominioId, moradorId: resgate.moradorId, tipo: "devolucao_resgate", pontos: resgate.pontosGastos, resgateId: resgate.id, autorId: ctx.user.id, descricao: `Devolução: resgate de ${recompensa} cancelado` });
          await tx.update(recompensas).set({ estoque: sql`${recompensas.estoque} + 1`, atualizadoEm: new Date() }).where(and(eq(recompensas.id, resgate.recompensaId), sql`${recompensas.estoque} IS NOT NULL`));
        }
      });
      await writeAuditLog(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "resgate", entidadeId: resgate.id, acao: `resgate_${input.status}`, resumo: `Resgate de "${recompensa}" marcado como ${rotuloStatusResgate[input.status].toLowerCase()}${input.status === "cancelado" ? `; ${resgate.pontosGastos} ponto(s) devolvido(s)` : ""}.`, estadoAnterior: { status: resgate.status }, estadoNovo: { status: input.status }, motivo: input.reason || null });
      const morador = await db.select({ usuarioId: moradores.usuarioId }).from(moradores).where(eq(moradores.id, resgate.moradorId)).limit(1);
      const textos = { aprovado: `Seu resgate de "${recompensa}" foi aprovado e será entregue em breve.`, entregue: `Seu resgate de "${recompensa}" foi marcado como entregue.`, cancelado: `Seu resgate de "${recompensa}" foi cancelado e ${resgate.pontosGastos} ponto(s) foram devolvidos.${input.reason ? ` Motivo: ${input.reason}` : ""}` } as const;
      await notificarUsuario(db, morador[0]?.usuarioId, { condominioId: ctx.eco.condominio.id, tipo: "resgate_atualizado", titulo: "Atualização de resgate", mensagem: textos[input.status] });
      return { success: true };
    }),
  }),
  notificacoes: router({
    listar: withProfile.query(async ({ ctx }) => {
      const db = await getDb();
      const linhas = await db.select({ notificacao: notificacoes, leitura: notificacoesLidas }).from(notificacoes).leftJoin(notificacoesLidas, and(eq(notificacoesLidas.notificacaoId, notificacoes.id), eq(notificacoesLidas.usuarioId, ctx.user.id))).where(and(eq(notificacoes.condominioId, ctx.eco.condominio.id), await notificacoesVisiveis(ctx), isNull(notificacoesLidas.excluidaEm))).orderBy(desc(notificacoes.criadoEm), desc(notificacoes.id));
      return linhas.map(({ notificacao, leitura }) => ({ ...notificacao, lidaEm: leitura?.lidaEm ?? notificacao.lidaEm ?? null }));
    }),
    /** Abre uma notificação (só se for do usuário ou um comunicado geral) e a marca como lida. */
    abrir: withProfile.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const visivel = await db.select().from(notificacoes).where(and(eq(notificacoes.id, input.id), eq(notificacoes.condominioId, ctx.eco.condominio.id), await notificacoesVisiveis(ctx))).limit(1);
      if (!visivel[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Notificação não encontrada." });
      await db.insert(notificacoesLidas).values({ notificacaoId: input.id, usuarioId: ctx.user.id }).onDuplicateKeyUpdate({ set: { lidaEm: new Date() } });
      return { ...visivel[0], lidaEm: new Date() };
    }),
    /** Não lidas mais novas que `afterId`, para o aviso que aparece na tela (pop-up) assim que uma notificação chega. */
    novas: withProfile.input(z.object({ afterId: z.number().int().min(0) })).query(async ({ ctx, input }) => {
      const db = await getDb();
      const linhas = await db.select({ notificacao: notificacoes, leitura: notificacoesLidas }).from(notificacoes).leftJoin(notificacoesLidas, and(eq(notificacoesLidas.notificacaoId, notificacoes.id), eq(notificacoesLidas.usuarioId, ctx.user.id))).where(and(eq(notificacoes.condominioId, ctx.eco.condominio.id), gt(notificacoes.id, input.afterId), await notificacoesVisiveis(ctx), isNull(notificacoesLidas.excluidaEm))).orderBy(desc(notificacoes.id)).limit(20);
      const [ultima] = await db.select({ id: sql<number>`max(${notificacoes.id})` }).from(notificacoes).where(and(eq(notificacoes.condominioId, ctx.eco.condominio.id), await notificacoesVisiveis(ctx)));
      return { ultimaId: Number(ultima?.id ?? 0), itens: linhas.filter(({ notificacao, leitura }) => !leitura && !notificacao.lidaEm).slice(0, 5).map(({ notificacao }) => notificacao) };
    }),
    contagemNaoLidas: withProfile.query(async ({ ctx }) => {
      const db = await getDb();
      const linhas = await db.select({ notificacao: notificacoes, leitura: notificacoesLidas }).from(notificacoes).leftJoin(notificacoesLidas, and(eq(notificacoesLidas.notificacaoId, notificacoes.id), eq(notificacoesLidas.usuarioId, ctx.user.id))).where(and(eq(notificacoes.condominioId, ctx.eco.condominio.id), await notificacoesVisiveis(ctx), isNull(notificacoesLidas.excluidaEm)));
      return { count: countUnreadNotifications(linhas.map((linha) => linha.notificacao.id), ctx.user.id, linhas.flatMap((linha) => (linha.leitura || linha.notificacao.lidaEm ? [{ notificationId: linha.notificacao.id, userId: ctx.user.id }] : []))) };
    }),
    marcarLida: withProfile.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const visivel = await db.select().from(notificacoes).where(and(eq(notificacoes.id, input.id), eq(notificacoes.condominioId, ctx.eco.condominio.id), await notificacoesVisiveis(ctx))).limit(1);
      if (!visivel[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Notificação não encontrada." });
      await db.insert(notificacoesLidas).values({ notificacaoId: input.id, usuarioId: ctx.user.id }).onDuplicateKeyUpdate({ set: { lidaEm: new Date() } });
      return { success: true };
    }),
    /**
     * Exclui notificações da lista de quem pediu (uma, várias ou todas as já lidas). Some só para essa pessoa: avisos gerais
     * continuam para os outros, e a administração continua vendo quem visualizou.
     */
    excluir: withProfile.input(z.object({ ids: z.array(z.number().int().positive()).min(1).max(500).optional(), somenteLidas: z.boolean().optional() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!input.ids?.length && !input.somenteLidas) throw new TRPCError({ code: "BAD_REQUEST", message: "Escolha quais notificações excluir." });
      const condicoes = [eq(notificacoes.condominioId, ctx.eco.condominio.id), await notificacoesVisiveis(ctx), isNull(notificacoesLidas.excluidaEm)];
      if (input.ids?.length) condicoes.push(inArray(notificacoes.id, input.ids));
      const linhas = await db.select({ notificacao: notificacoes, leitura: notificacoesLidas }).from(notificacoes).leftJoin(notificacoesLidas, and(eq(notificacoesLidas.notificacaoId, notificacoes.id), eq(notificacoesLidas.usuarioId, ctx.user.id))).where(and(...condicoes));
      const alvo = input.somenteLidas ? linhas.filter(({ notificacao, leitura }) => leitura || notificacao.lidaEm) : linhas;
      const agora = new Date();
      for (const { notificacao } of alvo) {
        await db.insert(notificacoesLidas).values({ notificacaoId: notificacao.id, usuarioId: ctx.user.id, lidaEm: agora, excluidaEm: agora }).onDuplicateKeyUpdate({ set: { excluidaEm: agora } });
      }
      return { excluidas: alvo.length };
    }),
    marcarTodasLidas: withProfile.mutation(async ({ ctx }) => {
      const db = await getDb();
      const visiveis = await db.select().from(notificacoes).where(and(eq(notificacoes.condominioId, ctx.eco.condominio.id), await notificacoesVisiveis(ctx)));
      for (const item of visiveis) await db.insert(notificacoesLidas).values({ notificacaoId: item.id, usuarioId: ctx.user.id }).onDuplicateKeyUpdate({ set: { lidaEm: new Date() } });
      return { success: true };
    }),
    /**
     * Aviso geral da administração (regras, manutenção, eventos...): vai para todos, só moradores ou só administradores,
     * pode ficar fixado no painel ("importante") e registra quem enviou e quem já visualizou.
     */
    criarComunicado: administratorOnly.input(z.object({
      title: z.string().trim().min(3).max(180),
      message: z.string().trim().min(3).max(2000),
      publico: z.enum(["todos", "moradores", "administradores"]).default("todos"),
      categoria: z.enum(categoriasAviso).default("geral"),
      importante: z.boolean().default(false),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const id = await notificarTodos(db, { condominioId: ctx.eco.condominio.id, tipo: "aviso_geral", titulo: input.title, mensagem: input.message, publico: input.publico, categoria: input.categoria, importante: input.importante, autorId: ctx.user.id });
      // Quem enviou já "leu" o próprio aviso.
      await db.insert(notificacoesLidas).values({ notificacaoId: id, usuarioId: ctx.user.id }).onDuplicateKeyUpdate({ set: { lidaEm: new Date() } });
      await writeAuditLog(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "comunicado", entidadeId: id, acao: "comunicado_publicado", resumo: `Aviso geral "${input.title}" enviado para ${rotuloPublicoAviso[input.publico].toLowerCase()}${input.importante ? " (fixado no painel)" : ""}.`, estadoNovo: { titulo: input.title, publico: input.publico, categoria: input.categoria, importante: input.importante } });
      return { id };
    }),
    /** Avisos gerais enviados, com quantas pessoas do público já visualizaram. */
    enviados: administratorOnly.query(async ({ ctx }) => {
      const db = await getDb();
      const avisos = await db.select({ aviso: notificacoes, autor: usuarios.nome }).from(notificacoes).leftJoin(usuarios, eq(usuarios.id, notificacoes.autorId)).where(and(eq(notificacoes.condominioId, ctx.eco.condominio.id), sql`${notificacoes.destinatarioId} IS NULL`, inArray(notificacoes.tipo, ["aviso_geral", "comunicado"]))).orderBy(desc(notificacoes.criadoEm), desc(notificacoes.id)).limit(100);
      const perfis = await db.select({ usuarioId: perfisAcesso.usuarioId, papel: perfisAcesso.papel }).from(perfisAcesso).where(eq(perfisAcesso.condominioId, ctx.eco.condominio.id));
      const ids = avisos.map((linha) => linha.aviso.id);
      const leituras = ids.length ? await db.select({ notificacaoId: notificacoesLidas.notificacaoId, usuarioId: notificacoesLidas.usuarioId }).from(notificacoesLidas).where(inArray(notificacoesLidas.notificacaoId, ids)) : [];
      return avisos.map(({ aviso, autor }) => {
        const publico = aviso.publico ?? "todos";
        const alvo = perfis.filter((perfil) => publico === "todos" || (publico === "moradores" ? perfil.papel === "morador" : perfil.papel === "administrador"));
        const viram = new Set(leituras.filter((leitura) => leitura.notificacaoId === aviso.id).map((leitura) => leitura.usuarioId));
        return { ...aviso, publico, autor: autor ?? "Administração", destinatarios: alvo.length, visualizacoes: alvo.filter((perfil) => viram.has(perfil.usuarioId)).length };
      });
    }),
    /** Quem já visualizou um aviso geral (nome e quando); só para administradores. */
    visualizacoes: administratorOnly.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const db = await getDb();
      const [aviso] = await db.select().from(notificacoes).where(and(eq(notificacoes.id, input.id), eq(notificacoes.condominioId, ctx.eco.condominio.id), sql`${notificacoes.destinatarioId} IS NULL`)).limit(1);
      if (!aviso) throw new TRPCError({ code: "NOT_FOUND", message: "Aviso não encontrado." });
      const publico = aviso.publico ?? "todos";
      const perfis = await db.select({ usuarioId: perfisAcesso.usuarioId, papel: perfisAcesso.papel, nome: usuarios.nome, bloco: moradores.bloco, apartamento: moradores.apartamento }).from(perfisAcesso).leftJoin(usuarios, eq(usuarios.id, perfisAcesso.usuarioId)).leftJoin(moradores, eq(moradores.id, perfisAcesso.moradorId)).where(eq(perfisAcesso.condominioId, ctx.eco.condominio.id));
      const leituras = await db.select().from(notificacoesLidas).where(eq(notificacoesLidas.notificacaoId, aviso.id));
      return perfis.filter((perfil) => publico === "todos" || (publico === "moradores" ? perfil.papel === "morador" : perfil.papel === "administrador"))
        .map((perfil) => ({ nome: perfil.nome ?? "Sem nome", papel: perfil.papel, bloco: perfil.bloco, apartamento: perfil.apartamento, lidaEm: leituras.find((leitura) => leitura.usuarioId === perfil.usuarioId)?.lidaEm ?? null }))
        .sort((a, b) => Number(Boolean(b.lidaEm)) - Number(Boolean(a.lidaEm)) || a.nome.localeCompare(b.nome));
    }),
    /** Avisos importantes ainda não lidos, para o destaque no painel. */
    importantes: withProfile.query(async ({ ctx }) => {
      const db = await getDb();
      const linhas = await db.select({ notificacao: notificacoes, leitura: notificacoesLidas }).from(notificacoes).leftJoin(notificacoesLidas, and(eq(notificacoesLidas.notificacaoId, notificacoes.id), eq(notificacoesLidas.usuarioId, ctx.user.id))).where(and(eq(notificacoes.condominioId, ctx.eco.condominio.id), eq(notificacoes.importante, true), await notificacoesVisiveis(ctx), isNull(notificacoesLidas.excluidaEm))).orderBy(desc(notificacoes.criadoEm)).limit(5);
      return linhas.filter((linha) => !linha.leitura).map((linha) => linha.notificacao);
    }),
  }),
  guias: router({
    listar: withProfile.query(async ({ ctx }) => guiasDoCondominio(ctx.eco.condominio.id)),
    /** O administrador ajusta o texto e a cor do saco de cada tipo (o condomínio fornece sacos coloridos). */
    salvar: administratorOnly.input(z.object({
      wasteType: z.enum(tiposResiduo),
      title: z.string().trim().min(3).max(120),
      accepted: z.string().trim().min(3).max(1000),
      rejected: z.string().trim().min(3).max(1000),
      instructions: z.string().trim().min(3).max(1000),
      bagColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Escolha uma cor válida."),
      bagColorName: z.string().trim().min(2).max(40),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const valores = { titulo: input.title, itensAceitos: input.accepted, itensRejeitados: input.rejected, instrucoes: input.instructions, corSaco: input.bagColor.toLowerCase(), nomeCorSaco: input.bagColorName, publicado: true, atualizadoEm: new Date() };
      await db.insert(guiasDescarte).values({ condominioId: ctx.eco.condominio.id, tipoResiduo: input.wasteType, ...valores }).onDuplicateKeyUpdate({ set: valores });
      await writeAuditLog(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "configuracao", entidadeId: ctx.eco.condominio.id, acao: "guia_descarte_alterado", resumo: `Guia de ${rotuloResiduo[input.wasteType]} atualizado (saco ${input.bagColorName.toLowerCase()}).`, estadoNovo: { corSaco: valores.corSaco, nomeCorSaco: input.bagColorName } });
      return { success: true };
    }),
  }),
});

class SemSaldoError extends Error {}

/** Alertas do painel do administrador: o que precisa de uma decisão ou ação agora. */
async function alertasAdministrativos(condominioId: number, registros: Array<typeof coletas.$inferSelect>, agora: Date) {
  const db = await getDb();
  const pendentes = registros.filter((registro) => situacaoDescarte(registro) === "pendente").length;
  const emAuditoria = registros.filter((registro) => situacaoDescarte(registro) === "auditoria").length;
  const resgatesAbertos = await db.select({ id: resgates.id }).from(resgates).where(and(eq(resgates.condominioId, condominioId), inArray(resgates.status, ["solicitado", "aprovado"])));
  const catalogo = await db.select({ titulo: recompensas.titulo, estoque: recompensas.estoque }).from(recompensas).where(and(eq(recompensas.condominioId, condominioId), eq(recompensas.ativo, true)));
  const semEstoque = catalogo.filter((item) => item.estoque === 0);
  const estoqueBaixo = catalogo.filter((item) => item.estoque !== null && item.estoque > 0 && item.estoque <= LIMITE_ESTOQUE_BAIXO);
  const ocorrenciasAbertas = await db.select({ id: ocorrencias.id }).from(ocorrencias).where(and(eq(ocorrencias.condominioId, condominioId), or(eq(ocorrencias.status, "aberta"), eq(ocorrencias.status, "em_analise"), eq(ocorrencias.status, "em_auditoria"))));
  const estacoes = await db.select({ id: estacoesPesagem.id, nome: estacoesPesagem.nome }).from(estacoesPesagem).where(eq(estacoesPesagem.condominioId, condominioId));
  const bloqueadas = estacoes.filter((estacao) => estacoesBloqueadas().includes(estacao.id));
  const inconsistentes = await saldosInconsistentes(db, condominioId);
  const falhas = await db.select({ id: notificacoes.id }).from(notificacoes).where(and(eq(notificacoes.condominioId, condominioId), eq(notificacoes.tipo, "falha_operacional"), gte(notificacoes.criadoEm, new Date(agora.getTime() - 24 * 60 * 60 * 1000))));
  const alertas: Array<{ id: string; titulo: string; detalhe: string; quantidade: number; link: string; nivel: "atencao" | "critico" }> = [];
  if (pendentes) alertas.push({ id: "revisao", titulo: "Descartes aguardando aprovação", detalhe: "Confira a foto e o peso e aprove, reprove com motivo ou abra auditoria.", quantidade: pendentes, link: "/descartes?situacao=pendente", nivel: "atencao" });
  if (emAuditoria) alertas.push({ id: "auditoria", titulo: "Descartes em auditoria", detalhe: "Casos suspeitos esperando o parecer da administração.", quantidade: emAuditoria, link: "/descartes?situacao=auditoria", nivel: "critico" });
  if (resgatesAbertos.length) alertas.push({ id: "resgates", titulo: "Resgates para aprovar ou entregar", detalhe: "Pedidos de moradores no catálogo de recompensas.", quantidade: resgatesAbertos.length, link: "/engajamento#pedidos", nivel: "atencao" });
  if (semEstoque.length) alertas.push({ id: "sem-estoque", titulo: "Prêmios sem estoque", detalhe: semEstoque.map((item) => item.titulo).join(", "), quantidade: semEstoque.length, link: "/engajamento", nivel: "critico" });
  if (estoqueBaixo.length) alertas.push({ id: "estoque-baixo", titulo: "Estoque baixo", detalhe: estoqueBaixo.map((item) => `${item.titulo} (${item.estoque})`).join(", "), quantidade: estoqueBaixo.length, link: "/engajamento", nivel: "atencao" });
  if (ocorrenciasAbertas.length) alertas.push({ id: "ocorrencias", titulo: "Ocorrências e denúncias em aberto", detalhe: "Registradas por moradores ou pela administração.", quantidade: ocorrenciasAbertas.length, link: "/ambiental#ocorrencias", nivel: "atencao" });
  const pedidosAbertos = await db.select({ id: pedidosAdesivos.id }).from(pedidosAdesivos).where(and(eq(pedidosAdesivos.condominioId, condominioId), eq(pedidosAdesivos.status, "solicitado")));
  if (pedidosAbertos.length) alertas.push({ id: "adesivos", titulo: "Pedidos de adesivos QR", detalhe: "Moradores pedindo mais adesivos para os sacos.", quantidade: pedidosAbertos.length, link: "/adesivos", nivel: "atencao" });
  if (bloqueadas.length) alertas.push({ id: "estacao-bloqueada", titulo: "Estação bloqueada por códigos errados", detalhe: bloqueadas.map((estacao) => estacao.nome).join(", "), quantidade: bloqueadas.length, link: "/configuracoes#estacoes", nivel: "critico" });
  if (falhas.length) alertas.push({ id: "falhas", titulo: "Falhas operacionais nas últimas 24 h", detalhe: "Veja os detalhes em Notificações.", quantidade: falhas.length, link: "/notificacoes", nivel: "critico" });
  if (inconsistentes.length) alertas.push({ id: "saldos", titulo: "Saldo diferente do extrato", detalhe: inconsistentes.map((item) => item.nome).join(", "), quantidade: inconsistentes.length, link: "/engajamento", nivel: "critico" });
  return alertas;
}

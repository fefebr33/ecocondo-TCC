import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { and, asc, desc, eq, gt, gte, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { coletas, estacoesPesagem, guiasDescarte, logsAuditoria, movimentacoesPontos, notificacoesLidas, notificacoes, moradores, ocorrencias, recompensas, resgates, relatoriosAnuais, tiposResiduo, usuarios } from "../../drizzle/schema";
import { getDb } from "../db";
import { rotuloResiduo } from "@shared/rotulos";
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
import { calcularIntervalo, classificacaoDoPeriodo, somarPorMorador } from "./podio";
import { writeAuditLog } from "../audit";
import { extratoDoMorador, movimentarPontos, saldosInconsistentes } from "../pontos";
import { notificarAdministradores, notificarUsuario } from "../notificacoes";
import { estacoesBloqueadas } from "../dominio/estacaoPesagem";
import { compararPeriodos, evolucaoMensal, resumirPontos, taxaDeConclusao } from "../dominio/indicadoresPainel";

/** Com este estoque (ou menos) a administração recebe o aviso de estoque baixo. */
export const LIMITE_ESTOQUE_BAIXO = 2;

const periodInput = z.object({ startDate: z.date().optional(), endDate: z.date().optional() }).optional();
const csvFiltersInput = z.object({
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  block: z.string().trim().min(1).max(32).optional(),
  wasteType: z.enum(tiposResiduo).optional(),
  /** Qual planilha: coletas (padrão), extrato de pontos, resgates ou auditoria. */
  kind: z.enum(["coletas", "pontos", "resgates", "auditoria"]).default("coletas"),
}).optional();

function condicoesDataEm(coluna: any, periodo?: { startDate?: Date; endDate?: Date }) {
  const condicoes = [];
  if (periodo?.startDate) condicoes.push(gte(coluna, periodo.startDate));
  if (periodo?.endDate) condicoes.push(lte(coluna, periodo.endDate));
  return condicoes;
}

const rotuloMovimentacao: Record<string, string> = { credito_coleta: "Crédito de coleta", estorno_coleta: "Estorno de coleta reprovada", resgate: "Resgate de recompensa", devolucao_resgate: "Devolução de resgate cancelado", ajuste: "Ajuste" };
const rotuloStatusResgate: Record<string, string> = { solicitado: "Solicitado", aprovado: "Aprovado", entregue: "Entregue", cancelado: "Cancelado" };

/** Pontos ganhos (créditos menos estornos) e peso confirmado de cada morador, a partir das coletas concluídas. */
async function pontosAcumulados(condominioId: number, periodo?: { startDate?: Date; endDate?: Date }) {
  const db = await getDb();
  const registros = await db.select().from(coletas).where(and(eq(coletas.condominioId, condominioId), eq(coletas.status, "concluida"), ...condicoesDataEm(coletas.concluidaEm, periodo)));
  return somarPorMorador(registros);
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
    pendingReviewCount: concluidas.filter((registro) => registro.pendenteAprovacaoPeso).length,
    byWasteType: porTipoResiduo,
  };
}

const guiasPadrao = [
  { tipoResiduo: "reciclavel", titulo: "Recicláveis", itensAceitos: "Papel, plástico, metal e vidro limpos e secos.", itensRejeitados: "Embalagens com resíduos de alimento, papel higiênico e espelhos.", instrucoes: "Esvazie, limpe quando necessário e mantenha os materiais secos antes do descarte." },
  { tipoResiduo: "organico", titulo: "Orgânicos", itensAceitos: "Restos de frutas, legumes, folhas e borra de café.", itensRejeitados: "Pilhas, plásticos, metais e produtos químicos.", instrucoes: "Acondicione em recipiente fechado; quando houver compostagem, encaminhe os materiais adequados." },
  { tipoResiduo: "rejeito", titulo: "Rejeitos", itensAceitos: "Materiais sem possibilidade de reciclagem ou reaproveitamento no fluxo local.", itensRejeitados: "Eletrônicos, pilhas, baterias e lâmpadas.", instrucoes: "Descarte apenas materiais que não possam ser direcionados às demais categorias." },
  { tipoResiduo: "eletronico", titulo: "Eletrônicos", itensAceitos: "Cabos, carregadores, celulares, periféricos e pequenos eletroeletrônicos.", itensRejeitados: "Resíduos orgânicos e materiais comuns.", instrucoes: "Não descarte com recicláveis convencionais. Use ponto de recebimento ou coleta especializada." },
  { tipoResiduo: "perigoso", titulo: "Resíduos perigosos", itensAceitos: "Pilhas, baterias, lâmpadas, tintas e produtos químicos domésticos.", itensRejeitados: "Materiais recicláveis ou orgânicos.", instrucoes: "Mantenha a embalagem identificada e procure os canais de logística reversa adequados." },
] as const;

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
      const top3 = classificados.filter((linha) => linha.noPodio).map((linha) => {
        const morador = porId.get(linha.moradorId)!;
        return { position: linha.posicao, nome: ehMorador ? nomePublico(morador) : morador.nome, bloco: morador.bloco, pontos: linha.pontos, pesoKg: Number((linha.pesoGramas / 1000).toFixed(2)), voce: linha.moradorId === ctx.eco.morador?.id };
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
      };
    }),
  }),
  relatorios: router({
    visaoGeral: administratorOnly.input(periodInput).query(async ({ ctx, input }) => {
      const db = await getDb();
      const registros = await db.select().from(coletas).where(and(...condicoesPeriodo(ctx.eco.condominio.id, input))).orderBy(desc(coletas.agendadaPara));
      const comunidade = await db.select().from(moradores).where(eq(moradores.condominioId, ctx.eco.condominio.id));
      // Ranking pelos pontos ganhos no período (não pelo saldo, que cai quando o morador resgata uma recompensa).
      const classificados = classificarPodio(somarPorMorador(registros.filter((registro) => registro.status === "concluida")));
      const ranking = classificados.slice(0, 10).map((linha) => {
        const morador = comunidade.find((item) => item.id === linha.moradorId);
        return { position: linha.posicao, id: linha.moradorId, name: morador?.nome ?? "Morador removido", block: morador?.bloco ?? "—", points: linha.pontos, weightKg: Number((linha.pesoGramas / 1000).toFixed(2)) };
      });
      const participantes = new Set(registros.filter((registro) => registro.status === "concluida" && registro.moradorId !== null).map((registro) => registro.moradorId));
      const resumo = resumir(registros);
      const pontos = resumirPontos(await movimentacoesDoPeriodo(ctx.eco.condominio.id, input));
      const resgatesPeriodo = await db.select({ status: resgates.status, pontosGastos: resgates.pontosGastos, recompensa: recompensas.titulo }).from(resgates).leftJoin(recompensas, eq(recompensas.id, resgates.recompensaId)).where(and(eq(resgates.condominioId, ctx.eco.condominio.id), ...condicoesDataEm(resgates.criadoEm, input)));
      const validos = resgatesPeriodo.filter((item) => item.status !== "cancelado");
      const porRecompensa = Array.from(validos.reduce((mapa, item) => {
        const chave = item.recompensa ?? "Recompensa removida";
        const atual = mapa.get(chave) ?? { titulo: chave, quantidade: 0, pontos: 0 };
        atual.quantidade += 1;
        atual.pontos += item.pontosGastos;
        return mapa.set(chave, atual);
      }, new Map<string, { titulo: string; quantidade: number; pontos: number }>()).values()).sort((a, b) => b.quantidade - a.quantidade);
      const incidentes = await db.select({ id: ocorrencias.id }).from(ocorrencias).where(and(eq(ocorrencias.condominioId, ctx.eco.condominio.id), ...condicoesDataEm(ocorrencias.criadoEm, input)));
      const [auditoria] = await db.select({ total: sql<number>`count(*)` }).from(logsAuditoria).where(and(eq(logsAuditoria.condominioId, ctx.eco.condominio.id), ...condicoesDataEm(logsAuditoria.criadoEm, input)));
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
      };
    }),
    exportarPdf: administratorOnly.input(periodInput).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const registros = await db.select().from(coletas).where(and(...condicoesPeriodo(ctx.eco.condominio.id, input))).orderBy(desc(coletas.agendadaPara));
      const relatorio = resumir(registros);
      const comunidade = await db.select().from(moradores).where(eq(moradores.condominioId, ctx.eco.condominio.id));
      const participantes = new Set(registros.filter((registro) => registro.status === "concluida" && registro.moradorId !== null).map((registro) => registro.moradorId));
      const pontos = resumirPontos(await movimentacoesDoPeriodo(ctx.eco.condominio.id, input));
      const resgatesPeriodo = await db.select({ status: resgates.status }).from(resgates).where(and(eq(resgates.condominioId, ctx.eco.condominio.id), ...condicoesDataEm(resgates.criadoEm, input)));
      const [auditoria] = await db.select({ total: sql<number>`count(*)` }).from(logsAuditoria).where(and(eq(logsAuditoria.condominioId, ctx.eco.condominio.id), ...condicoesDataEm(logsAuditoria.criadoEm, input)));
      // No PDF (que pode circular fora da administração) o ranking mostra só o top 3, com a mesma privacidade do pódio.
      const top3 = classificarPodio(somarPorMorador(registros.filter((registro) => registro.status === "concluida"))).filter((linha) => linha.noPodio).map((linha) => {
        const morador = comunidade.find((item) => item.id === linha.moradorId);
        return `${linha.posicao}º ${morador ? nomePublico(morador) : "Morador removido"}: ${linha.pontos} pts, ${(linha.pesoGramas / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} kg`;
      });
      const pdf = await PDFDocument.create();
      const pagina = pdf.addPage([595, 842]);
      const fonte = await pdf.embedFont(StandardFonts.Helvetica);
      const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
      const desenhar = (texto: string, x: number, y: number, tamanho = 11, ehNegrito = false, cor = rgb(0.12, 0.18, 0.15)) => pagina.drawText(texto, { x, y, size: tamanho, font: ehNegrito ? negrito : fonte, color: cor });
      desenhar("EcoCondo", 48, 790, 23, true, rgb(0.04, 0.39, 0.25));
      desenhar("Relatório de gestão de coleta seletiva", 48, 765, 14, true);
      desenhar(`Condomínio: ${ctx.eco.condominio.nome}`, 48, 740);
      desenhar(`Período: ${input?.startDate ? input.startDate.toLocaleDateString("pt-BR") : "início"} a ${input?.endDate ? input.endDate.toLocaleDateString("pt-BR") : "atual"}`, 48, 722);
      const linhas = [
        ["Peso total confirmado", `${relatorio.totalKg.toLocaleString("pt-BR")} kg`],
        ["Recicláveis", `${relatorio.recyclableKg.toLocaleString("pt-BR")} kg`],
        ["Taxa de reciclagem", relatorio.recyclingRate === null ? "Sem dados" : `${relatorio.recyclingRate.toLocaleString("pt-BR")}%`],
        ["Coletas concluídas", `${relatorio.completedCount}`],
        ["Participação dos moradores", comunidade.length ? `${participantes.size} de ${comunidade.length} (${((participantes.size / comunidade.length) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)` : "Sem moradores"],
        ["Pontos distribuídos / estornados", `${pontos.distribuidos} / ${pontos.estornados}`],
        ["Pontos gastos em resgates", `${pontos.resgatados} (${resgatesPeriodo.filter((item) => item.status !== "cancelado").length} resgate(s))`],
        ["Ocorrências / reprovações / cancelamentos", `${relatorio.occurrenceCount} / ${relatorio.rejectedCount} / ${relatorio.cancelledCount}`],
        ["Eventos de auditoria", `${Number(auditoria?.total ?? 0)}`],
        ["CO2 evitado (estimativa)", `${relatorio.co2EstimateKg.toLocaleString("pt-BR")} kg CO2e`],
      ];
      let y = 690;
      linhas.forEach(([rotulo, valor]) => { desenhar(rotulo, 54, y, 10.5); desenhar(valor, 330, y, 10.5, true, rgb(0.04, 0.39, 0.25)); y -= 24; });
      desenhar("Resíduos por categoria", 48, y - 10, 13, true); y -= 36;
      relatorio.byWasteType.forEach((item) => { desenhar(`${rotuloResiduo[item.wasteType]}: ${item.kilograms.toLocaleString("pt-BR")} kg`, 54, y, 10.5); y -= 19; });
      desenhar("Top 3 do período", 48, y - 10, 13, true); y -= 36;
      (top3.length ? top3 : ["Ninguém pontuou no período."]).forEach((texto) => { desenhar(texto, 54, y, 10.5); y -= 19; });
      desenhar("Nota metodológica", 48, 150, 11, true);
      desenhar("Pesos pendentes de revisão ou reprovados não entram no total. CO2: 0,75 kg CO2e por kg de reciclável.", 48, 132, 9);
      desenhar("Os dados devem ser interpretados como estimativas de apoio à gestão e à prestação de contas.", 48, 118, 9);
      desenhar(`Gerado em ${new Date().toLocaleString("pt-BR")}`, 48, 72, 9);
      const bytes = await pdf.save();
      return { filename: `relatorio-ecocondo-${new Date().toISOString().slice(0, 10)}.pdf`, contentBase64: Buffer.from(bytes).toString("base64") };
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
        status: registro.aprovacaoPesoStatus === "rejeitado" ? "reprovada" : registro.pendenteAprovacaoPeso ? "em revisão" : registro.status,
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
      return { filename: `coletas-ecocondo-${hoje}.csv`, content: conteudo };
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
      const saldo = ctx.eco.morador ? (await db.select({ pontos: moradores.pontos }).from(moradores).where(eq(moradores.id, ctx.eco.morador.id)).limit(1))[0]?.pontos ?? 0 : null;
      if (ctx.eco.perfil.papel === "administrador") {
        return {
          linhas: classificados.map((linha) => {
            const morador = porId.get(linha.moradorId)!;
            return { position: linha.posicao, id: linha.moradorId, nome: morador.nome, bloco: morador.bloco, apartamento: morador.apartamento as string | null, pontos: linha.pontos, saldo: morador.saldo as number | null, pesoKg: Number((linha.pesoGramas / 1000).toFixed(2)), voce: false };
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
          return { position: linha.posicao, id: null as number | null, nome: nomePublico(morador), bloco: morador.bloco, apartamento: null as string | null, pontos: linha.pontos, saldo: null as number | null, pesoKg: Number((linha.pesoGramas / 1000).toFixed(2)), voce: linha.moradorId === ctx.eco.morador?.id };
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
      const linhas = await db.select({ notificacao: notificacoes, leitura: notificacoesLidas }).from(notificacoes).leftJoin(notificacoesLidas, and(eq(notificacoesLidas.notificacaoId, notificacoes.id), eq(notificacoesLidas.usuarioId, ctx.user.id))).where(and(eq(notificacoes.condominioId, ctx.eco.condominio.id), or(eq(notificacoes.destinatarioId, ctx.user.id), sql`${notificacoes.destinatarioId} IS NULL`))).orderBy(desc(notificacoes.criadoEm), desc(notificacoes.id));
      return linhas.map(({ notificacao, leitura }) => ({ ...notificacao, lidaEm: leitura?.lidaEm ?? notificacao.lidaEm ?? null }));
    }),
    /** Abre uma notificação (só se for do usuário ou um comunicado geral) e a marca como lida. */
    abrir: withProfile.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const visivel = await db.select().from(notificacoes).where(and(eq(notificacoes.id, input.id), eq(notificacoes.condominioId, ctx.eco.condominio.id), or(eq(notificacoes.destinatarioId, ctx.user.id), sql`${notificacoes.destinatarioId} IS NULL`))).limit(1);
      if (!visivel[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Notificação não encontrada." });
      await db.insert(notificacoesLidas).values({ notificacaoId: input.id, usuarioId: ctx.user.id }).onDuplicateKeyUpdate({ set: { lidaEm: new Date() } });
      return { ...visivel[0], lidaEm: new Date() };
    }),
    contagemNaoLidas: withProfile.query(async ({ ctx }) => {
      const db = await getDb();
      const linhas = await db.select({ notificacao: notificacoes, leitura: notificacoesLidas }).from(notificacoes).leftJoin(notificacoesLidas, and(eq(notificacoesLidas.notificacaoId, notificacoes.id), eq(notificacoesLidas.usuarioId, ctx.user.id))).where(and(eq(notificacoes.condominioId, ctx.eco.condominio.id), or(eq(notificacoes.destinatarioId, ctx.user.id), sql`${notificacoes.destinatarioId} IS NULL`)));
      return { count: countUnreadNotifications(linhas.map((linha) => linha.notificacao.id), ctx.user.id, linhas.flatMap((linha) => (linha.leitura || linha.notificacao.lidaEm ? [{ notificationId: linha.notificacao.id, userId: ctx.user.id }] : []))) };
    }),
    marcarLida: withProfile.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const visivel = await db.select().from(notificacoes).where(and(eq(notificacoes.id, input.id), eq(notificacoes.condominioId, ctx.eco.condominio.id), or(eq(notificacoes.destinatarioId, ctx.user.id), sql`${notificacoes.destinatarioId} IS NULL`))).limit(1);
      if (!visivel[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Notificação não encontrada." });
      await db.insert(notificacoesLidas).values({ notificacaoId: input.id, usuarioId: ctx.user.id }).onDuplicateKeyUpdate({ set: { lidaEm: new Date() } });
      return { success: true };
    }),
    marcarTodasLidas: withProfile.mutation(async ({ ctx }) => {
      const db = await getDb();
      const visiveis = await db.select().from(notificacoes).where(and(eq(notificacoes.condominioId, ctx.eco.condominio.id), or(eq(notificacoes.destinatarioId, ctx.user.id), sql`${notificacoes.destinatarioId} IS NULL`)));
      for (const item of visiveis) await db.insert(notificacoesLidas).values({ notificacaoId: item.id, usuarioId: ctx.user.id }).onDuplicateKeyUpdate({ set: { lidaEm: new Date() } });
      return { success: true };
    }),
    criarComunicado: administratorOnly.input(z.object({ title: z.string().trim().min(3).max(180), message: z.string().trim().min(3).max(2000) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const inserida = await db.insert(notificacoes).values({ condominioId: ctx.eco.condominio.id, destinatarioId: null, tipo: "comunicado", titulo: input.title, mensagem: input.message }).$returningId();
      await writeAuditLog(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "comunicado", entidadeId: inserida[0].id, acao: "comunicado_publicado", resumo: `Comunicado "${input.title}" publicado para todos.`, estadoNovo: { titulo: input.title } });
      return { id: inserida[0].id };
    }),
  }),
  guias: router({
    listar: withProfile.query(async ({ ctx }) => {
      const db = await getDb();
      const armazenadas = await db.select().from(guiasDescarte).where(and(eq(guiasDescarte.condominioId, ctx.eco.condominio.id), eq(guiasDescarte.publicado, true))).orderBy(asc(guiasDescarte.tipoResiduo));
      return armazenadas.length ? armazenadas : guiasPadrao.map((guia, indice) => ({ id: -(indice + 1), condominioId: ctx.eco.condominio.id, publicado: true, atualizadoEm: new Date(), ...guia }));
    }),
  }),
});

class SemSaldoError extends Error {}

/** Alertas do painel do administrador: o que precisa de uma decisão ou ação agora. */
async function alertasAdministrativos(condominioId: number, registros: Array<typeof coletas.$inferSelect>, agora: Date) {
  const db = await getDb();
  const pendentes = registros.filter((registro) => registro.pendenteAprovacaoPeso).length;
  const atrasadas = registros.filter((registro) => (registro.status === "agendada" || registro.status === "em_andamento") && registro.agendadaPara < agora).length;
  const resgatesAbertos = await db.select({ id: resgates.id }).from(resgates).where(and(eq(resgates.condominioId, condominioId), inArray(resgates.status, ["solicitado", "aprovado"])));
  const catalogo = await db.select({ titulo: recompensas.titulo, estoque: recompensas.estoque }).from(recompensas).where(and(eq(recompensas.condominioId, condominioId), eq(recompensas.ativo, true)));
  const semEstoque = catalogo.filter((item) => item.estoque === 0);
  const estoqueBaixo = catalogo.filter((item) => item.estoque !== null && item.estoque > 0 && item.estoque <= LIMITE_ESTOQUE_BAIXO);
  const ocorrenciasAbertas = await db.select({ id: ocorrencias.id }).from(ocorrencias).where(and(eq(ocorrencias.condominioId, condominioId), or(eq(ocorrencias.status, "aberta"), eq(ocorrencias.status, "em_analise"))));
  const estacoes = await db.select({ id: estacoesPesagem.id, nome: estacoesPesagem.nome }).from(estacoesPesagem).where(eq(estacoesPesagem.condominioId, condominioId));
  const bloqueadas = estacoes.filter((estacao) => estacoesBloqueadas().includes(estacao.id));
  const inconsistentes = await saldosInconsistentes(db, condominioId);
  const falhas = await db.select({ id: notificacoes.id }).from(notificacoes).where(and(eq(notificacoes.condominioId, condominioId), eq(notificacoes.tipo, "falha_operacional"), gte(notificacoes.criadoEm, new Date(agora.getTime() - 24 * 60 * 60 * 1000))));
  const alertas: Array<{ id: string; titulo: string; detalhe: string; quantidade: number; link: string; nivel: "atencao" | "critico" }> = [];
  if (pendentes) alertas.push({ id: "revisao", titulo: "Registros aguardando aprovação", detalhe: "Confira a foto da balança e aprove ou reprove com motivo.", quantidade: pendentes, link: "/coletas", nivel: "atencao" });
  if (atrasadas) alertas.push({ id: "atrasadas", titulo: "Coletas aguardando pesagem", detalhe: "A data já passou e a coleta ainda não foi concluída.", quantidade: atrasadas, link: "/coletas", nivel: "atencao" });
  if (resgatesAbertos.length) alertas.push({ id: "resgates", titulo: "Resgates para aprovar ou entregar", detalhe: "Pedidos de moradores no catálogo de recompensas.", quantidade: resgatesAbertos.length, link: "/engajamento", nivel: "atencao" });
  if (semEstoque.length) alertas.push({ id: "sem-estoque", titulo: "Prêmios sem estoque", detalhe: semEstoque.map((item) => item.titulo).join(", "), quantidade: semEstoque.length, link: "/engajamento", nivel: "critico" });
  if (estoqueBaixo.length) alertas.push({ id: "estoque-baixo", titulo: "Estoque baixo", detalhe: estoqueBaixo.map((item) => `${item.titulo} (${item.estoque})`).join(", "), quantidade: estoqueBaixo.length, link: "/engajamento", nivel: "atencao" });
  if (ocorrenciasAbertas.length) alertas.push({ id: "ocorrencias", titulo: "Ocorrências ambientais em aberto", detalhe: "Registradas por moradores ou pela administração.", quantidade: ocorrenciasAbertas.length, link: "/ambiental", nivel: "atencao" });
  if (bloqueadas.length) alertas.push({ id: "estacao-bloqueada", titulo: "Estação bloqueada por códigos errados", detalhe: bloqueadas.map((estacao) => estacao.nome).join(", "), quantidade: bloqueadas.length, link: "/configuracoes", nivel: "critico" });
  if (falhas.length) alertas.push({ id: "falhas", titulo: "Falhas operacionais nas últimas 24 h", detalhe: "Veja os detalhes em Notificações.", quantidade: falhas.length, link: "/notificacoes", nivel: "critico" });
  if (inconsistentes.length) alertas.push({ id: "saldos", titulo: "Saldo diferente do extrato", detalhe: inconsistentes.map((item) => item.nome).join(", "), quantidade: inconsistentes.length, link: "/engajamento", nivel: "critico" });
  return alertas;
}

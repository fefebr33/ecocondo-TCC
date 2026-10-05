import ExcelJS from "exceljs";
import { rotuloResiduo } from "@shared/rotulos";
import { TIPOS_RESIDUO } from "@shared/descarte";
import type { DadosRelatorioPdf } from "./relatorioPdf";

/**
 * Planilha completa do relatório (Excel .xlsx), uma aba por assunto: resumo, por tipo, por mês, por bloco, ranking,
 * descartes, extrato de pontos, resgates, medidas administrativas e indicadores de gestão. Cabeçalhos fixos, filtros,
 * números com vírgula e barras de dados nas colunas de quilos e pontos (o "gráfico" dentro da própria célula).
 */

export type DadosPlanilha = DadosRelatorioPdf & {
  ranking: Array<{ position: number; name: string; block: string; points: number; weightKg: number }>;
  descartes: Array<{ id: number; data: Date | null; morador: string; bloco: string; tipo: string; pesoKg: number | null; situacao: string; pontos: number; origem: string; observacoes: string }>;
  extrato: Array<{ data: Date; morador: string; movimentacao: string; pontos: number; saldo: number | null; descricao: string }>;
  resgates: DadosRelatorioPdf["resgates"] & { lista: Array<{ data: Date; morador: string; recompensa: string; pontos: number; status: string }> };
  medidas: Array<{ data: Date; morador: string; bloco: string; tipo: string; nome: string; periodo: string; situacao: string; motivo: string; aplicadaPor: string }>;
};

const VERDE = "FF0F7350";
const VERDE_CLARO = "FFEDF7F1";

function cabecalho(aba: ExcelJS.Worksheet, colunas: Array<{ header: string; key: string; width: number; formato?: string }>) {
  aba.columns = colunas.map((coluna) => ({ header: coluna.header, key: coluna.key, width: coluna.width, style: coluna.formato ? { numFmt: coluna.formato } : {} }));
  const linha = aba.getRow(1);
  linha.font = { bold: true, color: { argb: "FFFFFFFF" } };
  linha.fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE } };
  linha.alignment = { vertical: "middle", wrapText: true };
  linha.height = 22;
  aba.views = [{ state: "frozen", ySplit: 1 }];
}

function filtros(aba: ExcelJS.Worksheet) {
  if (aba.rowCount > 1) aba.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: aba.columnCount } };
}

function barras(aba: ExcelJS.Worksheet, coluna: string, cor = "FF0F7350") {
  if (aba.rowCount < 2) return;
  aba.addConditionalFormatting({
    ref: `${coluna}2:${coluna}${aba.rowCount}`,
    rules: [{ type: "dataBar", priority: 1, cfvo: [{ type: "min" }, { type: "max" }], color: { argb: cor } } as any],
  });
}

const KG = "#,##0.00";
const INTEIRO = "#,##0";
const DATA = "dd/mm/yyyy hh:mm";

export async function gerarRelatorioPlanilha(dados: DadosPlanilha) {
  const livro = new ExcelJS.Workbook();
  livro.creator = "EcoCondo";
  livro.created = dados.geradoEm;
  const periodo = `${dados.inicio ? dados.inicio.toLocaleDateString("pt-BR") : "início"} a ${dados.fim ? dados.fim.toLocaleDateString("pt-BR") : dados.geradoEm.toLocaleDateString("pt-BR")}`;

  // Resumo
  const resumo = livro.addWorksheet("Resumo", { properties: { tabColor: { argb: VERDE } } });
  resumo.columns = [{ width: 36 }, { width: 18 }, { width: 52 }];
  resumo.mergeCells("A1:C1");
  resumo.getCell("A1").value = `EcoCondo - Relatório de gestão`;
  resumo.getCell("A1").font = { bold: true, size: 16, color: { argb: VERDE } };
  resumo.getCell("A2").value = `${dados.condominio} · ${dados.bloco ? `Bloco ${dados.bloco}` : "Todos os blocos"} · Período: ${periodo}`;
  resumo.getCell("A3").value = `Gerado em ${dados.geradoEm.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`;
  resumo.getCell("A3").font = { italic: true, color: { argb: "FF6B7570" } };
  const indicadores: Array<[string, number | string, string, string?]> = [
    ["Peso confirmado (kg)", dados.totalKg, "Só descartes aprovados", KG],
    ["Recicláveis (kg)", dados.recyclableKg, dados.recyclingRate === null ? "" : `${dados.recyclingRate.toLocaleString("pt-BR")}% do total`, KG],
    ["CO2 evitado (kg)", dados.co2EstimateKg, "Estimativa: 0,75 kg CO2e por kg reciclável", KG],
    ["Descartes aprovados", dados.porSituacao.aprovado, "", INTEIRO],
    ["Descartes pendentes", dados.porSituacao.pendente, "Aguardando a administração", INTEIRO],
    ["Descartes em auditoria", dados.porSituacao.auditoria, "", INTEIRO],
    ["Descartes reprovados", dados.porSituacao.reprovado, "", INTEIRO],
    ["Moradores que participaram", dados.participantsCount, `de ${dados.residentsCount} (${dados.participationRate === null ? "-" : `${dados.participationRate.toLocaleString("pt-BR")}%`})`, INTEIRO],
    ["Pontos distribuídos", dados.pontos.distribuidos, "", INTEIRO],
    ["Pontos estornados", dados.pontos.estornados, "Descartes reprovados ou revertidos", INTEIRO],
    ["Pontos gastos em resgates", dados.pontos.resgatados, `${dados.resgates.total} resgate(s), ${dados.resgates.entregues} entregue(s)`, INTEIRO],
    ["Ocorrências registradas", dados.environmentalIncidents, "", INTEIRO],
    ["Eventos na auditoria", dados.auditEvents, "", INTEIRO],
    ["Árvores poupadas", dados.equivalencias.arvoresPoupadas, "17 kg de papel = 1 árvore", KG],
    ["Água poupada (litros)", dados.equivalencias.litrosAguaPoupados, "20 L por kg reciclado", INTEIRO],
  ];
  const inicioTabela = 5;
  const titulo = resumo.getRow(inicioTabela);
  titulo.values = ["Indicador", "Valor", "Observação"];
  titulo.font = { bold: true, color: { argb: "FFFFFFFF" } };
  titulo.fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE } };
  indicadores.forEach(([rotulo, valor, observacao, formato], indice) => {
    const linha = resumo.getRow(inicioTabela + 1 + indice);
    linha.values = [rotulo, valor, observacao];
    if (formato) linha.getCell(2).numFmt = formato;
    linha.getCell(2).font = { bold: true, color: { argb: VERDE } };
    if (indice % 2) linha.fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE_CLARO } };
  });

  // Por tipo
  const porTipo = livro.addWorksheet("Por tipo");
  cabecalho(porTipo, [{ header: "Tipo de resíduo", key: "tipo", width: 22 }, { header: "Kg aprovados", key: "kg", width: 16, formato: KG }, { header: "% do total", key: "porcentagem", width: 12, formato: "0.0%" }]);
  for (const item of dados.byWasteType) porTipo.addRow({ tipo: rotuloResiduo[item.wasteType], kg: item.kilograms, porcentagem: dados.totalKg ? item.kilograms / dados.totalKg : 0 });
  barras(porTipo, "B");

  // Por mês
  const porMes = livro.addWorksheet("Por mês");
  cabecalho(porMes, [{ header: "Mês", key: "mes", width: 10 }, ...TIPOS_RESIDUO.map((tipo) => ({ header: `${rotuloResiduo[tipo]} (kg)`, key: tipo, width: 16, formato: KG })), { header: "Total (kg)", key: "total", width: 14, formato: KG }, { header: "Descartes", key: "descartes", width: 12, formato: INTEIRO }]);
  for (const mes of dados.porMes) porMes.addRow({ ...mes, total: TIPOS_RESIDUO.reduce((soma, tipo) => soma + Number(mes[tipo] ?? 0), 0) });
  barras(porMes, String.fromCharCode(66 + TIPOS_RESIDUO.length));

  // Por bloco
  const porBloco = livro.addWorksheet("Por bloco");
  cabecalho(porBloco, [{ header: "Bloco", key: "bloco", width: 10 }, { header: "Kg aprovados", key: "kg", width: 14, formato: KG }, { header: "Recicláveis (kg)", key: "reciclavel", width: 16, formato: KG }, { header: "Descartes", key: "descartes", width: 12, formato: INTEIRO }, { header: "Moradores", key: "moradores", width: 12, formato: INTEIRO }, { header: "Participantes", key: "participantes", width: 13, formato: INTEIRO }, { header: "Participação", key: "participacao", width: 13, formato: "0.0%" }, { header: "Kg por morador", key: "kgMorador", width: 15, formato: KG }, { header: "Pontos", key: "pontos", width: 10, formato: INTEIRO }]);
  for (const bloco of dados.porBloco) porBloco.addRow({ bloco: bloco.block, kg: bloco.kilograms, reciclavel: bloco.recyclableKg, descartes: bloco.descartes, moradores: bloco.moradores, participantes: bloco.participantes, participacao: bloco.participationRate === null ? null : bloco.participationRate / 100, kgMorador: bloco.kgPorMorador, pontos: bloco.pontos });
  barras(porBloco, "B");
  barras(porBloco, "G", "FF2863A5");

  // Ranking
  const ranking = livro.addWorksheet("Ranking");
  cabecalho(ranking, [{ header: "Posição", key: "posicao", width: 10 }, { header: "Morador(a)", key: "nome", width: 30 }, { header: "Bloco", key: "bloco", width: 10 }, { header: "Pontos", key: "pontos", width: 12, formato: INTEIRO }, { header: "Peso (kg)", key: "peso", width: 12, formato: KG }]);
  for (const linha of dados.ranking) ranking.addRow({ posicao: linha.position, nome: linha.name, bloco: linha.block, pontos: linha.points, peso: linha.weightKg });
  barras(ranking, "D");

  // Descartes
  const descartes = livro.addWorksheet("Descartes");
  cabecalho(descartes, [{ header: "Nº", key: "id", width: 8 }, { header: "Data", key: "data", width: 17, formato: DATA }, { header: "Morador(a)", key: "morador", width: 26 }, { header: "Bloco", key: "bloco", width: 8 }, { header: "Tipo", key: "tipo", width: 14 }, { header: "Peso (kg)", key: "peso", width: 11, formato: KG }, { header: "Situação", key: "situacao", width: 14 }, { header: "Pontos", key: "pontos", width: 9, formato: INTEIRO }, { header: "Origem", key: "origem", width: 20 }, { header: "Observações", key: "observacoes", width: 50 }]);
  for (const linha of dados.descartes) descartes.addRow({ ...linha, peso: linha.pesoKg });
  filtros(descartes);
  barras(descartes, "F");

  // Extrato de pontos
  const extrato = livro.addWorksheet("Extrato de pontos");
  cabecalho(extrato, [{ header: "Data", key: "data", width: 17, formato: DATA }, { header: "Morador(a)", key: "morador", width: 26 }, { header: "Movimentação", key: "movimentacao", width: 30 }, { header: "Pontos", key: "pontos", width: 10, formato: "+#,##0;-#,##0;0" }, { header: "Saldo depois", key: "saldo", width: 13, formato: INTEIRO }, { header: "Descrição", key: "descricao", width: 60 }]);
  for (const linha of dados.extrato) extrato.addRow(linha);
  filtros(extrato);

  // Resgates
  const resgates = livro.addWorksheet("Resgates");
  cabecalho(resgates, [{ header: "Data", key: "data", width: 17, formato: DATA }, { header: "Morador(a)", key: "morador", width: 26 }, { header: "Recompensa", key: "recompensa", width: 30 }, { header: "Pontos", key: "pontos", width: 10, formato: INTEIRO }, { header: "Status", key: "status", width: 14 }]);
  for (const linha of dados.resgates.lista) resgates.addRow(linha);
  filtros(resgates);

  // Medidas administrativas
  const medidas = livro.addWorksheet("Medidas");
  cabecalho(medidas, [{ header: "Aplicada em", key: "data", width: 17, formato: DATA }, { header: "Morador(a)", key: "morador", width: 26 }, { header: "Bloco", key: "bloco", width: 8 }, { header: "Tipo", key: "tipo", width: 28 }, { header: "Medida", key: "nome", width: 32 }, { header: "Período", key: "periodo", width: 28 }, { header: "Situação", key: "situacao", width: 12 }, { header: "Motivo", key: "motivo", width: 50 }, { header: "Aplicada por", key: "aplicadaPor", width: 22 }]);
  for (const linha of dados.medidas) medidas.addRow(linha);
  filtros(medidas);

  // Gestão
  const gestao = livro.addWorksheet("Gestão");
  cabecalho(gestao, [{ header: "Área", key: "area", width: 26 }, { header: "Indicador", key: "indicador", width: 36 }, { header: "Valor", key: "valor", width: 14 }]);
  const g = dados.gestao;
  const linhasGestao: Array<[string, string, number | string]> = [
    ["Análise automática (IA)", "Fotos analisadas", g.ia.analises],
    ["Análise automática (IA)", "Aprovadas na hora", g.ia.aprovadasAutomaticamente],
    ["Análise automática (IA)", "Enviadas para a administração", g.ia.pendentes],
    ["Análise automática (IA)", "Confiança média (%)", g.ia.confiancaMedia ?? "-"],
    ["Auditoria", "Auditorias abertas", g.auditoria.abertas],
    ["Auditoria", "Em andamento agora", g.auditoria.emAndamento],
    ["Auditoria", "Concluídas como regulares", g.auditoria.concluidasRegulares],
    ["Auditoria", "Descartes reprovados", g.auditoria.reprovacoes],
    ["Auditoria", "Aprovações revertidas", g.auditoria.aprovacoesRevertidas],
    ["Auditoria", "Consultas de QR", g.auditoria.consultasQr],
    ["Medidas administrativas", "Aplicadas no período", g.penalidades.aplicadas],
    ["Medidas administrativas", "Valendo agora", g.penalidades.vigentes],
    ["Medidas administrativas", "Revogadas", g.penalidades.revogadas],
    ["Campanhas", "Ativas", g.campanhas.ativas],
    ["Campanhas", "Encerradas", g.campanhas.encerradas],
    ["Campanhas", "Participações", g.campanhas.participacoes],
    ["Adesivos QR", "Entregues", g.adesivos.entregues],
    ["Adesivos QR", "Usados", g.adesivos.utilizados],
    ["Adesivos QR", "Cancelados", g.adesivos.cancelados],
    ["Ocorrências", "Registradas", g.ocorrencias.total],
    ["Ocorrências", "Em aberto", g.ocorrencias.abertas],
    ["Ocorrências", "Denúncias falsas", g.ocorrencias.denunciasFalsas],
    ["Avisos gerais", "Enviados", g.avisos.enviados],
    ["Avisos gerais", "Visualização (%)", g.avisos.taxaVisualizacao ?? "-"],
  ];
  for (const [area, indicador, valor] of linhasGestao) gestao.addRow({ area, indicador, valor });

  const buffer = await livro.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

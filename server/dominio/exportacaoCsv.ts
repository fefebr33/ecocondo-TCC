export type CollectionCsvRow = {
  id: number;
  status: string;
  wasteType: string;
  block: string;
  scheduledAt: Date;
  completedAt: Date | null;
  weightGrams: number | null;
  pointsAwarded: number;
  residentName: string | null;
  /** Estação de pesagem, administração ou coletor (este só nas coletas antigas). */
  origin: string | null;
  notes: string | null;
};

/**
 * Texto que o Excel leria como fórmula (começa com =, +, -, @ ou tabulação) ganha um apóstrofo na frente, para nenhum
 * nome ou observação virar fórmula ao abrir o arquivo. Números (inclusive negativos, como "-3" no extrato) ficam como estão.
 */
function protegerFormula(conteudo: string) {
  if (/^-?\d+([.,]\d+)?$/.test(conteudo)) return conteudo;
  return /^[=+\-@\t\r]/.test(conteudo) ? `'${conteudo}` : conteudo;
}

function escapeCsv(value: string | number | null | undefined) {
  const content = value === null || value === undefined ? "" : typeof value === "number" ? String(value) : protegerFormula(value);
  return `"${content.replaceAll('"', '""')}"`;
}

function formatDate(value: Date | null) {
  return value ? value.toLocaleString("pt-BR") : "";
}

export function buildCollectionsCsv(rows: CollectionCsvRow[]) {
  const header = ["ID", "Situação", "Categoria", "Bloco", "Registrado em", "Pesado em", "Peso (kg)", "Pontos", "Morador", "Origem do registro", "Observações"];
  const records = rows.map((row) => [
    row.id,
    row.status,
    row.wasteType,
    row.block,
    formatDate(row.scheduledAt),
    formatDate(row.completedAt),
    row.weightGrams === null ? "" : (row.weightGrams / 1000).toFixed(2).replace(".", ","),
    row.pointsAwarded,
    row.residentName,
    row.origin,
    row.notes,
  ].map(escapeCsv).join(";"));
  return `\ufeff${header.map(escapeCsv).join(";")}\r\n${records.join("\r\n")}\r\n`;
}

/** CSV genérico no mesmo formato (separador ";", BOM e CRLF), que o Excel abre direto com acentos e vírgula decimal. */
export function construirCsv(cabecalho: string[], linhas: Array<Array<string | number | null | undefined>>) {
  return `\ufeff${cabecalho.map(escapeCsv).join(";")}\r\n${linhas.map((linha) => linha.map(escapeCsv).join(";")).join("\r\n")}\r\n`;
}

export function dataHoraCsv(valor: Date | null) {
  return formatDate(valor);
}

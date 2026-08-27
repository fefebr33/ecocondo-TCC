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
  collectorName: string | null;
  notes: string | null;
};

function escapeCsv(value: string | number | null | undefined) {
  const content = value === null || value === undefined ? "" : String(value);
  return `"${content.replaceAll('"', '""')}"`;
}

function formatDate(value: Date | null) {
  return value ? value.toLocaleString("pt-BR") : "";
}

export function buildCollectionsCsv(rows: CollectionCsvRow[]) {
  const header = ["ID", "Status", "Categoria", "Bloco", "Agendada para", "Concluída em", "Peso (kg)", "Pontos", "Morador", "Coletor", "Observações"];
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
    row.collectorName,
    row.notes,
  ].map(escapeCsv).join(";"));
  return `\ufeff${header.map(escapeCsv).join(";")}\r\n${records.join("\r\n")}\r\n`;
}

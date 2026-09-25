import { describe, expect, it } from "vitest";
import { buildCollectionsCsv } from "./exportacaoCsv";

describe("exportação CSV de coletas", () => {
  it("gera cabeçalho compatível com Excel, formata quilogramas e protege texto delimitado", () => {
    const csv = buildCollectionsCsv([{
      id: 3,
      status: "concluida",
      wasteType: "reciclavel",
      block: "A",
      scheduledAt: new Date("2026-08-22T10:00:00Z"),
      completedAt: new Date("2026-08-22T11:00:00Z"),
      weightGrams: 1250,
      pointsAwarded: 1,
      residentName: "Ana; Silva",
      origin: "Estação \"Térreo\"",
      notes: "Material separado",
    }]);
    expect(csv.startsWith("\ufeff\"ID\";\"Status\"" )).toBe(true);
    expect(csv).toContain('"1,25"');
    expect(csv).toContain('"Ana; Silva"');
    expect(csv).toContain('"Estação ""Térreo"""');
  });

  it("mantém campos nulos vazios sem remover a linha", () => {
    const csv = buildCollectionsCsv([{ id: 4, status: "agendada", wasteType: "organico", block: "C", scheduledAt: new Date("2026-08-23T10:00:00Z"), completedAt: null, weightGrams: null, pointsAwarded: 0, residentName: null, origin: null, notes: null }]);
    expect(csv.split("\r\n")).toHaveLength(3);
    expect(csv).toContain('"4";"agendada"');
  });
});

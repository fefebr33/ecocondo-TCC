import { describe, expect, it } from "vitest";
import { calculateComplianceOverview, calculateGoalProgress, compareBlocks, compareBlocksOverTime } from "./sustainabilityRules";

const records = [
  { block: "A", status: "concluida", scheduledAt: new Date("2026-08-10T12:00:00Z"), weightGrams: 2400, wasteType: "reciclavel" },
  { block: "A", status: "concluida", scheduledAt: new Date("2026-08-12T12:00:00Z"), weightGrams: 600, wasteType: "organico" },
  { block: "B", status: "agendada", scheduledAt: new Date("2026-08-01T12:00:00Z"), weightGrams: null, wasteType: "reciclavel" },
] as const;

describe("regras de sustentabilidade", () => {
  it("calcula a evolução de meta apenas com coletas concluídas no período e no bloco", () => {
    expect(calculateGoalProgress({ block: "A", targetKg: 2, startDate: new Date("2026-08-01T00:00:00Z"), endDate: new Date("2026-08-31T23:59:59Z") }, records)).toEqual({ collectedKg: 3, progress: 100 });
  });

  it("compara blocos sem incluir coleta ainda agendada na massa total", () => {
    expect(compareBlocks(records)).toEqual([{ block: "A", totalKg: 3, recyclableKg: 2.4, collectionCount: 2, recyclingRate: 80 }, { block: "B", totalKg: 0, recyclableKg: 0, collectionCount: 0, recyclingRate: null }]);
  });

  it("organiza a evolução mensal por bloco usando apenas registros concluídos", () => {
    expect(compareBlocksOverTime(records)).toEqual([{ period: "2026-08", A: 3 }]);
  });

  it("sinaliza pendências de cadastro, acesso, coleta, ocorrência e feedback", () => {
    expect(calculateComplianceOverview({ residents: [{ email: null }, { email: "morador@exemplo.com" }], people: [{ accessStatus: "pendente" }, { accessStatus: "ativo" }], collections: records, openIncidents: 2, pendingFeedback: 1, now: new Date("2026-08-20T12:00:00Z") })).toEqual({ residentsWithoutEmail: 1, pendingAccess: 1, overdueCollections: 1, completedWithoutWeight: 0, openIncidents: 2, pendingFeedback: 1 });
  });
});

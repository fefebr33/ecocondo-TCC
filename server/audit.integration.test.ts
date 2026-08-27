import { describe, expect, it } from "vitest";
import { collectionAuditState, incidentAuditState, writeAuditLog } from "./audit";

describe("persistência isolada da auditoria", () => {
  it("grava um evento de coleta com estado serializado no adaptador isolado", async () => {
    const stored: Record<string, unknown>[] = [];
    const isolatedDb = {
      insert: () => ({ values: async (value: Record<string, unknown>) => { stored.push(value); return [{ insertId: 1 }]; } }),
    };
    await writeAuditLog(isolatedDb, {
      condominiumId: 7,
      actorUserId: 12,
      entityType: "coleta",
      entityId: 25,
      action: "coleta_atualizada",
      summary: "Coleta atualizada para o status concluida.",
      beforeState: collectionAuditState({ status: "agendada", weightGrams: null, pointsAwarded: 0, collectorUserId: null, scheduledAt: new Date("2026-08-20T10:00:00Z"), completedAt: null, notes: null }),
      afterState: { status: "concluida", weightGrams: 1200, pointsAwarded: 1 },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ condominiumId: 7, actorUserId: 12, entityType: "coleta", entityId: 25, action: "coleta_atualizada" });
    expect(String(stored[0].beforeState)).toContain("agendada");
    expect(String(stored[0].afterState)).toContain("1200");
  });

  it("preserva os dados relevantes da ocorrência antes da resolução", () => {
    expect(incidentAuditState({ status: "aberta", block: "B", wasteType: "perigoso", location: "Sala de descarte", description: "Pilha descartada incorretamente", resolutionNote: null, resolvedByUserId: null, resolvedAt: null })).toEqual({
      status: "aberta",
      block: "B",
      wasteType: "perigoso",
      location: "Sala de descarte",
      description: "Pilha descartada incorretamente",
      resolutionNote: null,
      resolvedByUserId: null,
      resolvedAt: null,
    });
  });
});

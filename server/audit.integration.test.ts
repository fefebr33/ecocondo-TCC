import { describe, expect, it } from "vitest";
import { collectionAuditState, incidentAuditState, writeAuditLog } from "./audit";

describe("persistência isolada da auditoria", () => {
  it("grava um evento de coleta com estado serializado no adaptador isolado", async () => {
    const stored: Record<string, unknown>[] = [];
    const isolatedDb = {
      insert: () => ({ values: async (value: Record<string, unknown>) => { stored.push(value); return [{ insertId: 1 }]; } }),
    };
    await writeAuditLog(isolatedDb, {
      condominioId: 7,
      autorId: 12,
      tipoEntidade: "coleta",
      entidadeId: 25,
      acao: "coleta_atualizada",
      resumo: "Coleta atualizada para o status concluida.",
      estadoAnterior: collectionAuditState({ status: "agendada", pesoGramas: null, pontosConcedidos: 0, coletorId: null, agendadaPara: new Date("2026-08-20T10:00:00Z"), concluidaEm: null, observacoes: null }),
      estadoNovo: { status: "concluida", pesoGramas: 1200, pontosConcedidos: 1 },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ condominioId: 7, autorId: 12, tipoEntidade: "coleta", entidadeId: 25, acao: "coleta_atualizada" });
    expect(String(stored[0].estadoAnterior)).toContain("agendada");
    expect(String(stored[0].estadoNovo)).toContain("1200");
  });

  it("preserva os dados relevantes da ocorrência antes da resolução", () => {
    expect(incidentAuditState({ status: "aberta", bloco: "B", tipoResiduo: "perigoso", local: "Sala de descarte", descricao: "Pilha descartada incorretamente", notaResolucao: null, resolvidoPorId: null, resolvidaEm: null })).toEqual({
      status: "aberta",
      bloco: "B",
      tipoResiduo: "perigoso",
      local: "Sala de descarte",
      descricao: "Pilha descartada incorretamente",
      notaResolucao: null,
      resolvidoPorId: null,
      resolvidaEm: null,
    });
  });
});

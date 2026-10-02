import { describe, expect, it } from "vitest";
import { calculateCollectionPoints } from "./regrasColeta";
import { REGRAS_PADRAO, situacaoDescarte } from "@shared/descarte";

describe("pontos por tipo de descarte", () => {
  it("recicláveis valem 1 ponto por kg completo", () => {
    expect(calculateCollectionPoints("concluida", "reciclavel", 3750)).toBe(3);
  });

  it("cada tipo tem a sua regra: eletrônico e perigoso valem mais, orgânico menos e rejeito não pontua", () => {
    expect(calculateCollectionPoints("concluida", "eletronico", 2500)).toBe(5);
    expect(calculateCollectionPoints("concluida", "perigoso", 1000)).toBe(2);
    expect(calculateCollectionPoints("concluida", "organico", 3000)).toBe(1);
    expect(calculateCollectionPoints("concluida", "rejeito", 9000)).toBe(0);
    expect(REGRAS_PADRAO.rejeito.pontosPorKg).toBe(0);
  });

  it("usa a regra configurada pelo administrador quando informada", () => {
    expect(calculateCollectionPoints("concluida", "organico", 3000, 2)).toBe(6);
    expect(calculateCollectionPoints("concluida", "reciclavel", 3000, 0)).toBe(0);
  });

  it("não atribui pontos a descarte não concluído, fração de ponto ou peso inválido", () => {
    expect(calculateCollectionPoints("cancelada", "reciclavel", 2000)).toBe(0);
    expect(calculateCollectionPoints("concluida", "reciclavel", 999)).toBe(0);
    expect(calculateCollectionPoints("concluida", "reciclavel", null)).toBe(0);
    expect(calculateCollectionPoints("concluida", "reciclavel", -500)).toBe(0);
  });
});

describe("situação do descarte", () => {
  it("segue concluído → pendente → aprovado/reprovado, com auditoria para casos graves", () => {
    expect(situacaoDescarte({ status: "concluida", pendenteAprovacaoPeso: true, aprovacaoPesoStatus: "pendente" })).toBe("pendente");
    expect(situacaoDescarte({ status: "concluida", pendenteAprovacaoPeso: false, aprovacaoPesoStatus: "aprovado" })).toBe("aprovado");
    expect(situacaoDescarte({ status: "concluida", pendenteAprovacaoPeso: false, aprovacaoPesoStatus: "rejeitado" })).toBe("reprovado");
    expect(situacaoDescarte({ status: "concluida", pendenteAprovacaoPeso: true, aprovacaoPesoStatus: "auditoria" })).toBe("auditoria");
    // Registro antigo, de antes da aprovação obrigatória.
    expect(situacaoDescarte({ status: "concluida", pendenteAprovacaoPeso: false, aprovacaoPesoStatus: null })).toBe("aprovado");
    expect(situacaoDescarte({ status: "cancelada", pendenteAprovacaoPeso: false, aprovacaoPesoStatus: null })).toBe("cancelado");
  });
});

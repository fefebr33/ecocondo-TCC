import { describe, expect, it } from "vitest";
import { calculateCollectionPoints, prepareCollectionCompletion, verificarTransicaoColeta } from "./regrasColeta";

describe("calculateCollectionPoints", () => {
  it("concede um ponto por quilograma completo em coleta reciclável concluída", () => {
    expect(calculateCollectionPoints("concluida", "reciclavel", 3750)).toBe(3);
  });

  it("não atribui pontos antes da conclusão ou para categorias não recicláveis", () => {
    expect(calculateCollectionPoints("agendada", "reciclavel", 2000)).toBe(0);
    expect(calculateCollectionPoints("concluida", "organico", 2000)).toBe(0);
  });

  it("não atribui fração de ponto ou valor inválido", () => {
    expect(calculateCollectionPoints("concluida", "reciclavel", 999)).toBe(0);
    expect(calculateCollectionPoints("concluida", "reciclavel", null)).toBe(0);
  });

  it("exige peso e preserva observações ao concluir a coleta", () => {
    const current = { weightGrams: null, notes: "Aguardar portaria", wasteType: "reciclavel" as const };
    expect(() => prepareCollectionCompletion({ status: "concluida" }, current)).toThrow("Informe o peso");
    expect(prepareCollectionCompletion({ status: "concluida", weightGrams: 2800 }, current)).toMatchObject({
      weightGrams: 2800,
      pointsAwarded: 2,
      completedAt: "completed",
      notes: "Aguardar portaria",
    });
  });
});

describe("regras de peso e de status", () => {
  const current = { weightGrams: null, notes: null, wasteType: "reciclavel" as const };

  it("bloqueia peso zero ou negativo na conclusão", () => {
    expect(() => prepareCollectionCompletion({ status: "concluida", weightGrams: 0 }, current)).toThrow("maior que zero");
    expect(() => prepareCollectionCompletion({ status: "concluida", weightGrams: -500 }, current)).toThrow("maior que zero");
  });

  it("não deixa pesar de novo uma coleta concluída nem reabrir uma cancelada", () => {
    expect(() => verificarTransicaoColeta("concluida", "concluida")).toThrow("já foi concluída");
    expect(() => verificarTransicaoColeta("concluida", "cancelada")).toThrow("já foi concluída");
    expect(() => verificarTransicaoColeta("cancelada", "agendada")).toThrow("cancelada");
    expect(() => verificarTransicaoColeta("agendada", "concluida")).not.toThrow();
    expect(() => verificarTransicaoColeta("ocorrencia", "agendada")).not.toThrow();
  });
});

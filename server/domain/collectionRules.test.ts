import { describe, expect, it } from "vitest";
import { calculateCollectionPoints, prepareCollectionCompletion, resolveCollectorAssignment } from "./collectionRules";

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

  it("atribui o responsável de acordo com o perfil que agenda", () => {
    expect(resolveCollectorAssignment("administrador", 1, 9)).toBe(9);
    expect(resolveCollectorAssignment("coletor", 2, 9)).toBe(2);
    expect(resolveCollectorAssignment("morador", 3, 9)).toBeNull();
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

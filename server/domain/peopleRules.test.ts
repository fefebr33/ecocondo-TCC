import { describe, expect, it } from "vitest";
import { buildPendingResidentPerson, normalizeAccessEmail } from "./peopleRules";

describe("regras de cadastro unificado", () => {
  it("normaliza o e-mail usado para reconhecer o primeiro acesso", () => {
    expect(normalizeAccessEmail("  MORADOR@EXEMPLO.COM ")).toBe("morador@exemplo.com");
  });

  it("prepara um cadastro de morador pendente ou ativo conforme o vínculo existente", () => {
    expect(buildPendingResidentPerson({ id: 9, userId: null, name: "Ana", email: "ANA@EXEMPLO.COM", phone: null, block: "B", apartment: "22" })).toMatchObject({ residentId: 9, email: "ana@exemplo.com", role: "morador", accessStatus: "pendente" });
    expect(buildPendingResidentPerson({ id: 10, userId: 4, name: "Bruno", email: "bruno@exemplo.com", phone: "11999999999", block: "A", apartment: "10" })).toMatchObject({ userId: 4, accessStatus: "ativo" });
  });
});

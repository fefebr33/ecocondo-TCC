import { describe, expect, it } from "vitest";
import { buildPendingResidentPerson, normalizeAccessEmail } from "./regrasPessoas";

describe("regras de cadastro unificado", () => {
  it("normaliza o e-mail usado para reconhecer o primeiro acesso", () => {
    expect(normalizeAccessEmail("  MORADOR@EXEMPLO.COM ")).toBe("morador@exemplo.com");
  });

  it("prepara um cadastro de morador pendente ou ativo conforme o vínculo existente", () => {
    expect(buildPendingResidentPerson({ id: 9, usuarioId: null, nome: "Ana", email: "ANA@EXEMPLO.COM", telefone: null, bloco: "B", apartamento: "22" })).toMatchObject({ moradorId: 9, email: "ana@exemplo.com", papel: "morador", statusAcesso: "pendente" });
    expect(buildPendingResidentPerson({ id: 10, usuarioId: 4, nome: "Bruno", email: "bruno@exemplo.com", telefone: "11999999999", bloco: "A", apartamento: "10" })).toMatchObject({ usuarioId: 4, statusAcesso: "ativo" });
  });
});

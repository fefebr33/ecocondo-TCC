import { describe, expect, it } from "vitest";
import { z } from "zod";
import { mensagensDeValidacao } from "./errosValidacao";

function erroDe(schema: z.ZodType, valor: unknown) {
  const resultado = schema.safeParse(valor);
  if (resultado.success) throw new Error("esperava erro de validação");
  return resultado.error;
}

describe("mensagens de validação em português", () => {
  it("mostra o limite de peso em quilos", () => {
    const erro = erroDe(z.object({ weightGrams: z.number().max(120_000) }), { weightGrams: 150_000 });
    expect(mensagensDeValidacao(erro)).toBe("Peso: o valor máximo é 120 kg.");
  });

  it("explica textos curtos e e-mails inválidos pelo nome do campo", () => {
    const erro = erroDe(z.object({ name: z.string().min(3), email: z.string().email() }), { name: "AB", email: "x" });
    expect(mensagensDeValidacao(erro)).toBe("Nome: use pelo menos 3 caracteres. E-mail: informe um e-mail válido.");
  });

  it("preserva mensagens personalizadas das regras", () => {
    const erro = erroDe(z.object({ a: z.number() }).refine(() => false, { message: "A data final deve ser posterior à data inicial." }), { a: 1 });
    expect(mensagensDeValidacao(erro)).toBe("A data final deve ser posterior à data inicial.");
  });
});

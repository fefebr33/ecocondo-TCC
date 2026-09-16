import { describe, expect, it } from "vitest";
import {
  ehPesoAnomalo,
  verificarLimiteDiarioMorador,
  verificarLimitePorColeta,
  verificarSegregacaoDeFuncao,
} from "./antifraude";

describe("verificarSegregacaoDeFuncao", () => {
  it("bloqueia quando o responsável pela confirmação é o próprio morador beneficiado", () => {
    expect(() => verificarSegregacaoDeFuncao(5, 5)).toThrow("morador beneficiado");
  });

  it("permite quando são pessoas diferentes ou não há morador vinculado", () => {
    expect(() => verificarSegregacaoDeFuncao(5, 9)).not.toThrow();
    expect(() => verificarSegregacaoDeFuncao(5, null)).not.toThrow();
  });
});

describe("verificarLimitePorColeta", () => {
  it("bloqueia peso acima do limite plausível por lançamento", () => {
    expect(() => verificarLimitePorColeta(200_000, 120_000)).toThrow("excede o limite plausível");
  });

  it("permite peso dentro do limite", () => {
    expect(() => verificarLimitePorColeta(50_000, 120_000)).not.toThrow();
  });
});

describe("verificarLimiteDiarioMorador", () => {
  it("bloqueia quando a soma do dia ultrapassaria o limite", () => {
    expect(() => verificarLimiteDiarioMorador(140_000, 20_000, 150_000)).toThrow("limite diário");
  });

  it("permite quando a soma do dia permanece dentro do limite", () => {
    expect(() => verificarLimiteDiarioMorador(50_000, 20_000, 150_000)).not.toThrow();
  });
});

describe("ehPesoAnomalo", () => {
  it("sinaliza lançamento muito acima da média histórica do morador", () => {
    expect(ehPesoAnomalo(15_000, 4_000, 3)).toBe(true);
  });

  it("não sinaliza lançamento dentro do padrão ou sem histórico", () => {
    expect(ehPesoAnomalo(10_000, 4_000, 3)).toBe(false);
    expect(ehPesoAnomalo(10_000, 0, 3)).toBe(false);
  });
});

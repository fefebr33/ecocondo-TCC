import { describe, expect, it } from "vitest";
import { calcularTrimestre, trimestreAnterior } from "./trimestre";

describe("calcularTrimestre", () => {
  it("identifica corretamente o primeiro trimestre", () => {
    const { rotulo, inicio, fim } = calcularTrimestre(new Date("2026-02-15"));
    expect(rotulo).toBe("2026-T1");
    expect(inicio.getMonth()).toBe(0);
    expect(fim.getMonth()).toBe(2);
  });

  it("identifica corretamente o último trimestre", () => {
    const { rotulo, inicio, fim } = calcularTrimestre(new Date("2026-11-01"));
    expect(rotulo).toBe("2026-T4");
    expect(inicio.getMonth()).toBe(9);
    expect(fim.getMonth()).toBe(11);
  });
});

describe("trimestreAnterior", () => {
  it("volta para o trimestre anterior dentro do mesmo ano", () => {
    expect(trimestreAnterior(new Date("2026-05-01")).rotulo).toBe("2026-T1");
  });

  it("volta para o último trimestre do ano anterior quando estamos no T1", () => {
    expect(trimestreAnterior(new Date("2026-02-01")).rotulo).toBe("2025-T4");
  });
});

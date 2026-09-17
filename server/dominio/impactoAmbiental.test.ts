import { describe, expect, it } from "vitest";
import { calcularEquivalenciasAmbientais } from "./impactoAmbiental";

describe("calcularEquivalenciasAmbientais", () => {
  it("converte quilos reciclados em árvores, água e CO2 poupados", () => {
    const resultado = calcularEquivalenciasAmbientais(34);
    expect(resultado.arvoresPoupadas).toBe(2);
    expect(resultado.litrosAguaPoupados).toBe(680);
    expect(resultado.co2EvitadoKg).toBe(25.5);
  });

  it("nunca retorna valores negativos, mesmo com peso negativo", () => {
    const resultado = calcularEquivalenciasAmbientais(-10);
    expect(resultado.arvoresPoupadas).toBe(0);
    expect(resultado.litrosAguaPoupados).toBe(0);
    expect(resultado.co2EvitadoKg).toBe(0);
  });

  it("retorna zero para zero quilos", () => {
    expect(calcularEquivalenciasAmbientais(0)).toEqual({ arvoresPoupadas: 0, litrosAguaPoupados: 0, co2EvitadoKg: 0 });
  });
});

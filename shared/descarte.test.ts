import { describe, expect, it } from "vitest";
import {
  creditarComResto,
  estornarComResto,
  formatarPontos,
  milesimosDoDescarte,
} from "./descarte";

describe("pontos com fração", () => {
  it("o descarte vale a fração exata do peso", () => {
    expect(milesimosDoDescarte(990, 1)).toBe(990);
    expect(milesimosDoDescarte(1900, 0.5)).toBe(950);
    expect(milesimosDoDescarte(0, 2)).toBe(0);
    expect(milesimosDoDescarte(3000, 0)).toBe(0);
    expect(formatarPontos(0.95)).toBe("0,95");
    expect(formatarPontos(4)).toBe("4");
  });

  it("as frações se somam e viram ponto inteiro", () => {
    expect(creditarComResto(0, 990)).toEqual({ pontos: 0, resto: 990 });
    expect(creditarComResto(990, 950)).toEqual({ pontos: 1, resto: 940 });
    expect(creditarComResto(500, 2500)).toEqual({ pontos: 3, resto: 0 });
  });

  it("o estorno tira exatamente o valor do descarte, somando saldo e fração", () => {
    // Crédito de 0,95 com 0,99 guardado: +1 ponto, sobram 0,94. Estornar volta a 0 ponto e 0,99 guardado.
    expect(estornarComResto(940, 950, 1)).toEqual({ pontos: 1, resto: 990 });
    // Descarte que só foi para a fração (0 ponto inteiro), mas a fração já foi usada por outro: tira 1 ponto e devolve o troco.
    expect(estornarComResto(100, 800, 0)).toEqual({ pontos: 1, resto: 300 });
    for (const [resto, exato, creditados] of [
      [0, 2500, 2],
      [999, 1, 0],
      [0, 1, 1],
      [300, 4700, 5],
    ] as const) {
      const { pontos, resto: novo } = estornarComResto(
        resto,
        exato,
        creditados
      );
      expect(novo).toBeGreaterThanOrEqual(0);
      expect(novo).toBeLessThan(1000);
      expect(-pontos * 1000 + (novo - resto)).toBe(-exato);
    }
  });
});

describe("resíduo perigoso", () => {
  it("vale por entrega, não por kg", () => {
    expect(milesimosDoDescarte(10, 1, "perigoso")).toBe(1000);
    expect(milesimosDoDescarte(4000, 1, "perigoso")).toBe(1000);
    expect(milesimosDoDescarte(4000, 1, "reciclavel")).toBe(4000);
    expect(milesimosDoDescarte(0, 1, "perigoso")).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { classificarPodio } from "./regrasPodio";

const linha = (moradorId: number, pontos: number, pesoGramas: number) => ({ moradorId, pontos, pesoGramas });

describe("classificarPodio", () => {
  it("ordena por pontos e ignora quem não pontuou", () => {
    const resultado = classificarPodio([linha(1, 5, 1000), linha(2, 9, 1000), linha(3, 0, 0)]);
    expect(resultado.map((item) => [item.moradorId, item.posicao])).toEqual([[2, 1], [1, 2]]);
  });

  it("desempata pelo peso quando os pontos são iguais", () => {
    const resultado = classificarPodio([linha(1, 8, 3000), linha(2, 8, 5000)]);
    expect(resultado.map((item) => [item.moradorId, item.posicao, item.empatado])).toEqual([[2, 1, false], [1, 2, false]]);
  });

  it("divide a posição e mantém os dois empatados no 3º lugar no pódio", () => {
    const resultado = classificarPodio([linha(1, 10, 1), linha(2, 8, 1), linha(3, 5, 2000), linha(4, 5, 2000), linha(5, 4, 9000)]);
    expect(resultado.map((item) => [item.moradorId, item.posicao, item.noPodio])).toEqual([
      [1, 1, true], [2, 2, true], [3, 3, true], [4, 3, true], [5, 5, false],
    ]);
    expect(resultado.filter((item) => item.empatado).map((item) => item.moradorId)).toEqual([3, 4]);
  });
});

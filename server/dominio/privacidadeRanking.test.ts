import { describe, expect, it } from "vitest";
import { classificarPorPontos, nomePublico, recortarRankingPublico } from "./privacidadeRanking";

describe("privacidade dos rankings", () => {
  const linhas = classificarPorPontos([
    { moradorId: 1, pontos: 30 },
    { moradorId: 2, pontos: 20 },
    { moradorId: 3, pontos: 10 },
    { moradorId: 4, pontos: 10 },
    { moradorId: 5, pontos: 5 },
    { moradorId: 6, pontos: 0 },
  ]);

  it("mostra só até o 3º lugar (empates no 3º incluídos) e ignora quem não tem pontos", () => {
    const { publicas, total } = recortarRankingPublico(linhas, null);
    expect(publicas.map((linha) => [linha.moradorId, linha.posicao])).toEqual([[1, 1], [2, 2], [3, 3], [4, 3]]);
    expect(total).toBe(5);
  });

  it("devolve a posição do próprio morador mesmo abaixo do 3º lugar", () => {
    const { publicas, minha } = recortarRankingPublico(linhas, 5);
    expect(minha).toMatchObject({ moradorId: 5, posicao: 5 });
    expect(publicas.some((linha) => linha.moradorId === 5)).toBe(false);
  });

  it("troca o nome pelo bloco quando o morador pede para não aparecer", () => {
    expect(nomePublico({ nome: "Ana Souza", bloco: "B", ocultarNomeNoPodio: true })).toBe("Morador(a) do bloco B");
    expect(nomePublico({ nome: "Ana Souza", bloco: "B", ocultarNomeNoPodio: false })).toBe("Ana Souza");
  });
});

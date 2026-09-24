export type TotalDoMorador = { moradorId: number; pontos: number; pesoGramas: number };

/**
 * Classifica o pódio por pontos e desempata pelo peso confirmado. Quem continuar empatado divide a posição (1º, 2º, 2º, 4º),
 * e todos com posição até a 3ª são elegíveis ao desconto, inclusive quem empata no 3º lugar.
 */
export function classificarPodio<T extends TotalDoMorador>(totais: T[]) {
  const ordenados = totais.filter((linha) => linha.pontos > 0).sort((a, b) => b.pontos - a.pontos || b.pesoGramas - a.pesoGramas);
  return ordenados.map((linha) => {
    const posicao = ordenados.findIndex((outro) => outro.pontos === linha.pontos && outro.pesoGramas === linha.pesoGramas) + 1;
    const empatado = ordenados.some((outro) => outro !== linha && outro.pontos === linha.pontos && outro.pesoGramas === linha.pesoGramas);
    return { ...linha, posicao, empatado, elegivelDesconto: posicao <= 3 };
  });
}

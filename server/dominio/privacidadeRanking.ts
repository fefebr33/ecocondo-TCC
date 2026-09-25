/**
 * Privacidade dos rankings: para os moradores, só os três primeiros colocados aparecem (com nome e bloco).
 * Ninguém abaixo do 3º lugar é exposto; cada morador vê apenas a própria posição. O administrador continua vendo tudo.
 * Objetivo: não expor moradores com baixa participação, evitando constrangimento e risco jurídico para o condomínio.
 */
export const POSICOES_PUBLICAS = 3;

/** Nome mostrado no pódio: o morador pode pedir para aparecer só como "Morador(a) do bloco X". */
export function nomePublico(morador: { nome: string; bloco: string; ocultarNomeNoPodio: boolean }) {
  return morador.ocultarNomeNoPodio ? `Morador(a) do bloco ${morador.bloco}` : morador.nome;
}

/** Posição com empate: quem tem a mesma pontuação divide a posição (1º, 2º, 2º, 4º). Só entra quem tem pontos. */
export function classificarPorPontos<T extends { pontos: number }>(linhas: T[]) {
  const ordenadas = linhas.filter((linha) => linha.pontos > 0).sort((a, b) => b.pontos - a.pontos);
  return ordenadas.map((linha) => ({ ...linha, posicao: ordenadas.findIndex((outra) => outra.pontos === linha.pontos) + 1 }));
}

/** Separa o que pode ser mostrado a um morador: as linhas até o 3º lugar (empates incluídos) e a posição dele. */
export function recortarRankingPublico<T extends { moradorId: number; posicao: number }>(linhas: T[], moradorIdVisitante: number | null) {
  return {
    publicas: linhas.filter((linha) => linha.posicao <= POSICOES_PUBLICAS),
    minha: moradorIdVisitante === null ? null : linhas.find((linha) => linha.moradorId === moradorIdVisitante) ?? null,
    total: linhas.length,
  };
}

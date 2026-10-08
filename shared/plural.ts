/**
 * Plural em português para as mensagens do sistema, no lugar de "ponto(s)", "adesivo(s) disponível(is)".
 * Singular quando o número está entre 1 e 2 (1 ponto, 1,5 ponto); plural nos demais (0 pontos, 0,5 pontos, 3 pontos).
 */
export function ehSingular(quantidade: number) {
  const valor = Math.abs(quantidade);
  return valor >= 1 && valor < 2;
}

/** Só a palavra: palavra(1, "ponto", "pontos") → "ponto". */
export function palavra(quantidade: number, singular: string, plural: string) {
  return ehSingular(quantidade) ? singular : plural;
}

/** Número (no formato brasileiro, até 2 casas) com a palavra concordando: plural(3, "ponto", "pontos") → "3 pontos". */
export function plural(
  quantidade: number,
  singular: string,
  pluralForma: string
) {
  return `${quantidade.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ${palavra(quantidade, singular, pluralForma)}`;
}

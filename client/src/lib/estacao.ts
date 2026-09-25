/** Código de pareamento do tablet (estação de pesagem), guardado só neste aparelho. */
const CHAVE = "ecocondo-estacao-token";

export function lerTokenEstacao() {
  try {
    return window.localStorage.getItem(CHAVE);
  } catch {
    return null;
  }
}

export function guardarTokenEstacao(token: string) {
  try {
    window.localStorage.setItem(CHAVE, token.trim());
  } catch {
    // Sem armazenamento local (ex.: janela anônima): o pareamento dura só até recarregar a página.
  }
}

export function esquecerTokenEstacao() {
  try {
    window.localStorage.removeItem(CHAVE);
  } catch {
    // nada a fazer
  }
}

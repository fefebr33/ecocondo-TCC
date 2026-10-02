/**
 * Adesivos com QR Code: um por saco, uso único, ligados ao perfil do morador. O QR e o número impresso trazem só o código
 * (ex.: EC-7K3F-9Q2M), nunca nome, bloco ou apartamento; quem tem permissão consulta o dono pelo sistema.
 */

/** Sem 0/O, 1/I/L: fácil de ler e de digitar quando o QR estiver amassado. */
export const ALFABETO_ADESIVO = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Formato do código: EC- + 4 + - + 4 caracteres. */
export const PADRAO_CODIGO_ADESIVO = /EC-?([2-9A-HJKMNP-Z]{4})-?([2-9A-HJKMNP-Z]{4})/i;

/** Quantos adesivos disponíveis o morador pode ter antes de receber o aviso de que estão acabando. */
export const LIMITE_ADESIVOS_ACABANDO = 3;
/** Quantos adesivos o morador pode pedir de uma vez. */
export const MAXIMO_ADESIVOS_POR_PEDIDO = 60;

/**
 * Lê o código de um adesivo a partir do que foi digitado ou do conteúdo do QR (que pode ser o link /leitura?adesivo=...).
 * Devolve o código no formato padrão (EC-XXXX-XXXX) ou null.
 */
export function normalizarCodigoAdesivo(texto: string | null | undefined) {
  if (!texto) return null;
  const encontrado = texto.toUpperCase().replace(/\s+/g, "").match(PADRAO_CODIGO_ADESIVO);
  return encontrado ? `EC-${encontrado[1]}-${encontrado[2]}` : null;
}

/** Endereço gravado no QR: abre a leitura no sistema (exige login de administrador); sem dados pessoais. */
export function linkDoAdesivo(origem: string, codigo: string) {
  return `${origem.replace(/\/+$/, "")}/leitura?adesivo=${encodeURIComponent(codigo)}`;
}

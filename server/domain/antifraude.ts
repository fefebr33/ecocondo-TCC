/**
 * Regras de proteção contra fraude no sistema de pontos de reciclagem.
 * Objetivo: impedir que um lançamento isolado ou uma conluio simples entre
 * quem lança e quem se beneficia distorça o ranking/pódio de forma artificial.
 */

/** Nenhum lançamento residencial isolado deveria superar isso; acima disso, provavelmente é erro de digitação ou tentativa de burla. */
export const LIMITE_PESO_POR_COLETA_GRAMAS = 120_000;

/** Soma máxima de peso concluído por morador em um mesmo dia corrido. */
export const LIMITE_PESO_DIARIO_MORADOR_GRAMAS = 150_000;

/** Quantas vezes acima da média histórica do morador um novo lançamento precisa estar para ser sinalizado (não bloqueado) como suspeito. */
export const FATOR_ANOMALIA_PESO = 3;

export class LimiteAntifraudeExcedidoError extends Error {}

/** Impede que quem confirma a coleta seja a mesma pessoa que o morador beneficiado pelos pontos. */
export function verificarSegregacaoDeFuncao(usuarioResponsavelId: number, usuarioMoradorBeneficiadoId: number | null | undefined) {
  if (usuarioMoradorBeneficiadoId !== null && usuarioMoradorBeneficiadoId !== undefined && usuarioResponsavelId === usuarioMoradorBeneficiadoId) {
    throw new LimiteAntifraudeExcedidoError("Quem confirma a coleta não pode ser o próprio morador beneficiado pelos pontos.");
  }
}

/** Impede um único lançamento de peso irrealista para uma coleta residencial. */
export function verificarLimitePorColeta(pesoGramas: number, limite = LIMITE_PESO_POR_COLETA_GRAMAS) {
  if (pesoGramas > limite) {
    throw new LimiteAntifraudeExcedidoError(`O peso informado (${(pesoGramas / 1000).toFixed(1)} kg) excede o limite plausível por coleta (${(limite / 1000).toFixed(0)} kg). Revise o lançamento ou divida em coletas separadas.`);
  }
}

/** Impede que um morador acumule peso concluído acima do limite diário, somando lançamentos do mesmo dia. */
export function verificarLimiteDiarioMorador(pesoJaConcluidoHojeGramas: number, novoPesoGramas: number, limite = LIMITE_PESO_DIARIO_MORADOR_GRAMAS) {
  if (pesoJaConcluidoHojeGramas + novoPesoGramas > limite) {
    throw new LimiteAntifraudeExcedidoError(`Este lançamento ultrapassaria o limite diário de ${(limite / 1000).toFixed(0)} kg por morador. Ajuste o peso ou aguarde o próximo dia.`);
  }
}

/** Sinalização suave (não bloqueia): aponta lançamentos muito acima do padrão histórico do morador para revisão administrativa. */
export function ehPesoAnomalo(novoPesoGramas: number, mediaHistoricaGramas: number, fator = FATOR_ANOMALIA_PESO) {
  if (mediaHistoricaGramas <= 0) return false;
  return novoPesoGramas > mediaHistoricaGramas * fator;
}

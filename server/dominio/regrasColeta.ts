import { REGRAS_PADRAO, pontosDoDescarte } from "@shared/descarte";

export type CompletionStatus = "agendada" | "em_andamento" | "concluida" | "cancelada" | "ocorrencia";
export type WasteCategory = "reciclavel" | "organico" | "rejeito" | "eletronico" | "perigoso";

/**
 * Pontos de um descarte concluído: kg × pontos por kg do tipo (regra do condomínio ou a padrão), sem fração de ponto.
 * Cada tipo tem a sua regra; rejeito não pontua por padrão, para não premiar quem gera mais lixo sem destino.
 */
export function calculateCollectionPoints(status: CompletionStatus, wasteType: WasteCategory, weightGrams: number | null | undefined, pontosPorKg = REGRAS_PADRAO[wasteType].pontosPorKg) {
  if (status !== "concluida") return 0;
  return pontosDoDescarte(weightGrams, pontosPorKg, wasteType);
}

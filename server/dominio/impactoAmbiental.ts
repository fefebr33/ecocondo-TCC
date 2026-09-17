/**
 * Conversão de quilogramas reciclados em equivalências de fácil compreensão para o morador.
 * Fatores aproximados amplamente usados em campanhas de educação ambiental (EPA WARM / Cempre):
 * ~17 kg de papel/papelão reciclado poupam 1 árvore; ~1 kg de material reciclável poupa
 * cerca de 20 litros de água no processo produtivo evitado; e o fator de CO2e já usado
 * no relatório geral do EcoCondo (0,75 kg CO2e por kg de reciclável) é reaproveitado aqui.
 */

const KG_POR_ARVORE_POUPADA = 17;
const LITROS_AGUA_POR_KG = 20;
const CO2_KG_POR_KG_RECICLAVEL = 0.75;

export function calcularEquivalenciasAmbientais(kgReciclado: number) {
  const kg = Math.max(0, kgReciclado);
  return {
    arvoresPoupadas: Number((kg / KG_POR_ARVORE_POUPADA).toFixed(1)),
    litrosAguaPoupados: Math.round(kg * LITROS_AGUA_POR_KG),
    co2EvitadoKg: Number((kg * CO2_KG_POR_KG_RECICLAVEL).toFixed(1)),
  };
}

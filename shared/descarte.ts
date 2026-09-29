import type { tiposResiduo } from "../drizzle/schema";

/**
 * Regras e rótulos do descarte (o EcoCondo registra descartes feitos pelo próprio morador na estação de pesagem;
 * não há mais agendamento de coleta). Usado no servidor e nas telas.
 */
export type TipoResiduo = (typeof tiposResiduo)[number];

export const TIPOS_RESIDUO: TipoResiduo[] = ["reciclavel", "organico", "rejeito", "eletronico", "perigoso"];

/** Regra padrão de cada tipo (o administrador pode mudar em Configurações > Regras de descarte). */
export const REGRAS_PADRAO: Record<TipoResiduo, { pesoMinimoGramas: number; pesoMaximoGramas: number; pontosPorKg: number }> = {
  reciclavel: { pesoMinimoGramas: 100, pesoMaximoGramas: 30_000, pontosPorKg: 1 },
  organico: { pesoMinimoGramas: 100, pesoMaximoGramas: 15_000, pontosPorKg: 0.5 },
  rejeito: { pesoMinimoGramas: 100, pesoMaximoGramas: 15_000, pontosPorKg: 0 },
  eletronico: { pesoMinimoGramas: 50, pesoMaximoGramas: 20_000, pontosPorKg: 2 },
  perigoso: { pesoMinimoGramas: 10, pesoMaximoGramas: 5_000, pontosPorKg: 2 },
};

/** Limites que o administrador não pode ultrapassar ao configurar as regras (um saco de apartamento, não um caminhão). */
export const PESO_MAXIMO_CONFIGURAVEL_GRAMAS = 50_000;
export const PONTOS_POR_KG_MAXIMO = 20;

/** Cor padrão do saco de lixo de cada tipo (baseada na Resolução CONAMA 275/2001), fornecido pelo condomínio. */
export const CORES_PADRAO: Record<TipoResiduo, { cor: string; nome: string }> = {
  reciclavel: { cor: "#1f6fd1", nome: "Azul" },
  organico: { cor: "#7a4a26", nome: "Marrom" },
  rejeito: { cor: "#7d8580", nome: "Cinza" },
  eletronico: { cor: "#2b2b2b", nome: "Preto" },
  perigoso: { cor: "#e8761f", nome: "Laranja" },
};

/** Pontos de um descarte: kg × pontos por kg do tipo, arredondado para baixo (sem fração de ponto). */
export function pontosDoDescarte(pesoGramas: number | null | undefined, pontosPorKg: number) {
  if (!pesoGramas || pesoGramas <= 0 || pontosPorKg <= 0) return 0;
  return Math.floor((pesoGramas / 1000) * pontosPorKg + 1e-9);
}

/** Situação que as telas mostram para um descarte. */
export type SituacaoDescarte = "pendente" | "aprovado" | "reprovado" | "auditoria" | "cancelado";

export const rotuloSituacao: Record<SituacaoDescarte, string> = {
  pendente: "Pendente de aprovação",
  aprovado: "Aprovado",
  reprovado: "Reprovado",
  auditoria: "Em auditoria",
  cancelado: "Cancelado",
};

/**
 * Concluído na estação → pendente de aprovação → aprovado ou reprovado pelo administrador; casos graves vão para auditoria.
 * Registros antigos concluídos sem decisão registrada (antes da aprovação obrigatória) contam como aprovados.
 */
export function situacaoDescarte(registro: { status: string; pendenteAprovacaoPeso: boolean; aprovacaoPesoStatus: string | null }): SituacaoDescarte {
  if (registro.aprovacaoPesoStatus === "auditoria") return "auditoria";
  if (registro.aprovacaoPesoStatus === "rejeitado") return "reprovado";
  if (registro.status !== "concluida") return "cancelado";
  if (registro.pendenteAprovacaoPeso || registro.aprovacaoPesoStatus === "pendente") return "pendente";
  return "aprovado";
}

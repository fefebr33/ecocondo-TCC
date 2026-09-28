export type CompletionStatus = "agendada" | "em_andamento" | "concluida" | "cancelada" | "ocorrencia";
export type WasteCategory = "reciclavel" | "organico" | "rejeito" | "eletronico" | "perigoso";

/** A pontuação é concedida apenas por coleta reciclável concluída, na proporção de 1 ponto por quilograma completo. */
export function calculateCollectionPoints(status: CompletionStatus, wasteType: WasteCategory, weightGrams: number | null | undefined) {
  if (status !== "concluida" || wasteType !== "reciclavel" || !weightGrams || weightGrams < 0) return 0;
  return Math.floor(weightGrams / 1000);
}

export function prepareCollectionCompletion(input: { status: CompletionStatus; weightGrams?: number | null; notes?: string | null }, current: { weightGrams: number | null; notes: string | null; wasteType: WasteCategory }) {
  if (input.status === "concluida" && (input.weightGrams === undefined || input.weightGrams === null)) {
    throw new Error("Informe o peso para concluir uma coleta.");
  }
  if (input.status === "concluida" && (input.weightGrams as number) <= 0) {
    throw new Error("O peso precisa ser maior que zero para concluir uma coleta.");
  }
  const weightGrams = input.weightGrams === undefined ? current.weightGrams : input.weightGrams;
  return {
    weightGrams,
    pointsAwarded: calculateCollectionPoints(input.status, current.wasteType, weightGrams),
    completedAt: input.status === "concluida" ? "completed" : null,
    notes: input.notes === undefined ? current.notes : input.notes || null,
  };
}

/**
 * Coleta concluída ou cancelada é definitiva: não pode ser pesada de novo, reaberta ou pontuar outra vez.
 * Uma coleta concluída só muda por reprovação do administrador (com motivo e estorno dos pontos), fora deste fluxo.
 */
export const STATUS_FINAIS_COLETA: CompletionStatus[] = ["concluida", "cancelada"];

export function verificarTransicaoColeta(atual: CompletionStatus, proximo: CompletionStatus) {
  if (atual === "concluida") throw new Error("Esta coleta já foi concluída e pesada. Para corrigir, reprove o registro informando o motivo.");
  if (atual === "cancelada") throw new Error("Esta coleta foi cancelada e não pode mais ser alterada.");
  if (atual === proximo) throw new Error("A coleta já está com este status.");
}

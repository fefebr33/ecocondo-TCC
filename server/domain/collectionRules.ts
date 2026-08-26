export type CompletionStatus = "agendada" | "em_andamento" | "concluida" | "cancelada" | "ocorrencia";
export type WasteCategory = "reciclavel" | "organico" | "rejeito" | "eletronico" | "perigoso";

/** A pontuação é concedida apenas por coleta reciclável concluída, na proporção de 1 ponto por quilograma completo. */
export function calculateCollectionPoints(status: CompletionStatus, wasteType: WasteCategory, weightGrams: number | null | undefined) {
  if (status !== "concluida" || wasteType !== "reciclavel" || !weightGrams || weightGrams < 0) return 0;
  return Math.floor(weightGrams / 1000);
}

export function resolveCollectorAssignment(role: "administrador" | "coletor" | "morador", requestorUserId: number, requestedCollectorUserId: number | null | undefined) {
  if (role === "morador") return null;
  if (role === "coletor") return requestorUserId;
  return requestedCollectorUserId ?? null;
}

export function prepareCollectionCompletion(input: { status: CompletionStatus; weightGrams?: number | null; notes?: string | null }, current: { weightGrams: number | null; notes: string | null; wasteType: WasteCategory }) {
  if (input.status === "concluida" && (input.weightGrams === undefined || input.weightGrams === null)) {
    throw new Error("Informe o peso para concluir uma coleta.");
  }
  const weightGrams = input.weightGrams === undefined ? current.weightGrams : input.weightGrams;
  return {
    weightGrams,
    pointsAwarded: calculateCollectionPoints(input.status, current.wasteType, weightGrams),
    completedAt: input.status === "concluida" ? "completed" : null,
    notes: input.notes === undefined ? current.notes : input.notes || null,
  };
}

export type CollectionForSustainability = {
  block: string;
  status: string;
  scheduledAt: Date;
  weightGrams: number | null;
  wasteType: string;
};

export function toKilograms(grams: number) {
  return Number((grams / 1000).toFixed(2));
}

export function calculateGoalProgress(goal: { block: string; targetKg: number; startDate: Date; endDate: Date }, records: CollectionForSustainability[]) {
  const collectedGrams = records
    .filter((record) => record.status === "concluida" && record.block === goal.block && record.scheduledAt >= goal.startDate && record.scheduledAt <= goal.endDate)
    .reduce((sum, record) => sum + (record.weightGrams ?? 0), 0);
  const collectedKg = toKilograms(collectedGrams);
  return { collectedKg, progress: goal.targetKg > 0 ? Math.min(100, Math.round((collectedKg / goal.targetKg) * 100)) : 0 };
}

export function compareBlocks(records: CollectionForSustainability[]) {
  return Array.from(new Set(records.map((record) => record.block))).sort((a, b) => a.localeCompare(b, "pt-BR")).map((block) => {
    const completed = records.filter((record) => record.block === block && record.status === "concluida");
    const totalGrams = completed.reduce((sum, record) => sum + (record.weightGrams ?? 0), 0);
    const recyclableGrams = completed.filter((record) => record.wasteType === "reciclavel").reduce((sum, record) => sum + (record.weightGrams ?? 0), 0);
    return { block, totalKg: toKilograms(totalGrams), recyclableKg: toKilograms(recyclableGrams), collectionCount: completed.length, recyclingRate: totalGrams ? Number(((recyclableGrams / totalGrams) * 100).toFixed(1)) : null };
  });
}

export function compareBlocksOverTime(records: CollectionForSustainability[]) {
  const completed = records.filter((record) => record.status === "concluida");
  const blocks = Array.from(new Set(completed.map((record) => record.block))).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const values = new Map<string, Record<string, number>>();
  for (const record of completed) {
    const period = `${record.scheduledAt.getUTCFullYear()}-${String(record.scheduledAt.getUTCMonth() + 1).padStart(2, "0")}`;
    const item = values.get(period) ?? {};
    item[record.block] = Number(((item[record.block] ?? 0) + toKilograms(record.weightGrams ?? 0)).toFixed(2));
    values.set(period, item);
  }
  return Array.from(values.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([period, amounts]) => ({ period, ...Object.fromEntries(blocks.map((block) => [block, amounts[block] ?? 0])) }));
}

export function calculateComplianceOverview(input: {
  residents: Array<{ email: string | null }>;
  people: Array<{ accessStatus: string }>;
  collections: CollectionForSustainability[];
  openIncidents: number;
  pendingFeedback: number;
  now: Date;
}) {
  return {
    residentsWithoutEmail: input.residents.filter((resident) => !resident.email).length,
    pendingAccess: input.people.filter((person) => person.accessStatus === "pendente").length,
    overdueCollections: input.collections.filter((record) => (record.status === "agendada" || record.status === "em_andamento") && record.scheduledAt < input.now).length,
    completedWithoutWeight: input.collections.filter((record) => record.status === "concluida" && record.weightGrams === null).length,
    openIncidents: input.openIncidents,
    pendingFeedback: input.pendingFeedback,
  };
}

/** Só o morador vinculado recebe o lembrete; o coletor_id de coletas antigas fica apenas no histórico. */
export function reminderRecipients(input: { residentUserId: number | null; alreadyNotifiedUserIds: number[] }) {
  const alreadyNotified = new Set(input.alreadyNotifiedUserIds);
  return [input.residentUserId].filter((id): id is number => typeof id === "number" && !alreadyNotified.has(id));
}

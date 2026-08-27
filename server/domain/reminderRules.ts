export function reminderRecipients(input: { residentUserId: number | null; collectorUserId: number | null; alreadyNotifiedUserIds: number[] }) {
  const alreadyNotified = new Set(input.alreadyNotifiedUserIds);
  return Array.from(new Set([input.residentUserId, input.collectorUserId].filter((id): id is number => typeof id === "number"))).filter((id) => !alreadyNotified.has(id));
}

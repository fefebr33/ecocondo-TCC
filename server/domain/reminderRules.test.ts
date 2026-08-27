import { describe, expect, it } from "vitest";
import { reminderRecipients } from "./reminderRules";

describe("destinatários de lembrete de coleta", () => {
  it("deduplica morador e coletor e não recria notificações já entregues", () => {
    expect(reminderRecipients({ residentUserId: 11, collectorUserId: 11, alreadyNotifiedUserIds: [] })).toEqual([11]);
    expect(reminderRecipients({ residentUserId: 11, collectorUserId: 23, alreadyNotifiedUserIds: [11] })).toEqual([23]);
  });
});

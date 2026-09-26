import { describe, expect, it } from "vitest";
import { reminderRecipients } from "./regrasLembrete";

describe("destinatários de lembrete de coleta", () => {
  it("avisa só o morador vinculado e não recria notificações já entregues", () => {
    expect(reminderRecipients({ residentUserId: 11, alreadyNotifiedUserIds: [] })).toEqual([11]);
    expect(reminderRecipients({ residentUserId: 11, alreadyNotifiedUserIds: [11] })).toEqual([]);
    expect(reminderRecipients({ residentUserId: null, alreadyNotifiedUserIds: [] })).toEqual([]);
  });
});

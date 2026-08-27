import { describe, expect, it } from "vitest";
import { countUnreadNotifications, isNotificationReadByUser } from "./notificationRules";

describe("leituras pessoais de notificações", () => {
  const reads = [{ notificationId: 10, userId: 1 }];

  it("marca a leitura apenas para o usuário que visualizou", () => {
    expect(isNotificationReadByUser(10, 1, reads)).toBe(true);
    expect(isNotificationReadByUser(10, 2, reads)).toBe(false);
  });

  it("mantém a contagem de outro usuário mesmo quando a primeira pessoa leu", () => {
    expect(countUnreadNotifications([10, 11], 1, reads)).toBe(1);
    expect(countUnreadNotifications([10, 11], 2, reads)).toBe(2);
  });
});

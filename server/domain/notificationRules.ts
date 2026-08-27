export type PersonalRead = { notificationId: number; userId: number };

export function isNotificationReadByUser(notificationId: number, userId: number, reads: PersonalRead[]) {
  return reads.some((read) => read.notificationId === notificationId && read.userId === userId);
}

export function countUnreadNotifications(notificationIds: number[], userId: number, reads: PersonalRead[]) {
  return notificationIds.filter((notificationId) => !isNotificationReadByUser(notificationId, userId, reads)).length;
}

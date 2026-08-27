CREATE TABLE `notification_reads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`notificationId` int NOT NULL,
	`userId` int NOT NULL,
	`readAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notification_reads_id` PRIMARY KEY(`id`),
	CONSTRAINT `notification_reads_notification_user_unique` UNIQUE(`notificationId`,`userId`)
);
--> statement-breakpoint
CREATE INDEX `notification_reads_user_idx` ON `notification_reads` (`userId`);
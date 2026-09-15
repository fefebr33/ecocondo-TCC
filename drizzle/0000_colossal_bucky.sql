CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`condominiumId` integer NOT NULL,
	`actorUserId` integer NOT NULL,
	`entityType` text NOT NULL,
	`entityId` integer NOT NULL,
	`action` text NOT NULL,
	`summary` text NOT NULL,
	`beforeState` text,
	`afterState` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_logs_condominium_created_idx` ON `audit_logs` (`condominiumId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `audit_logs_entity_idx` ON `audit_logs` (`entityType`,`entityId`);--> statement-breakpoint
CREATE INDEX `audit_logs_actor_created_idx` ON `audit_logs` (`actorUserId`,`createdAt`);--> statement-breakpoint
CREATE TABLE `block_goals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`condominiumId` integer NOT NULL,
	`block` text NOT NULL,
	`title` text NOT NULL,
	`targetKg` integer NOT NULL,
	`startDate` integer NOT NULL,
	`endDate` integer NOT NULL,
	`createdByUserId` integer NOT NULL,
	`isActive` integer DEFAULT true NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `block_goals_condominium_idx` ON `block_goals` (`condominiumId`);--> statement-breakpoint
CREATE INDEX `block_goals_period_idx` ON `block_goals` (`startDate`,`endDate`);--> statement-breakpoint
CREATE TABLE `campaign_participants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`campaignId` integer NOT NULL,
	`residentId` integer NOT NULL,
	`joinedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_participant_unique` ON `campaign_participants` (`campaignId`,`residentId`);--> statement-breakpoint
CREATE INDEX `campaign_participants_resident_idx` ON `campaign_participants` (`residentId`);--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`condominiumId` integer NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`targetDescription` text NOT NULL,
	`startDate` integer NOT NULL,
	`endDate` integer NOT NULL,
	`status` text DEFAULT 'planejada' NOT NULL,
	`createdByUserId` integer NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `campaigns_condominium_idx` ON `campaigns` (`condominiumId`);--> statement-breakpoint
CREATE INDEX `campaigns_period_idx` ON `campaigns` (`startDate`,`endDate`);--> statement-breakpoint
CREATE TABLE `collection_feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`condominiumId` integer NOT NULL,
	`residentId` integer NOT NULL,
	`collectionId` integer,
	`rating` integer NOT NULL,
	`message` text NOT NULL,
	`status` text DEFAULT 'novo' NOT NULL,
	`response` text,
	`respondedByUserId` integer,
	`respondedAt` integer,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `feedback_condominium_idx` ON `collection_feedback` (`condominiumId`);--> statement-breakpoint
CREATE INDEX `feedback_resident_idx` ON `collection_feedback` (`residentId`);--> statement-breakpoint
CREATE INDEX `feedback_status_idx` ON `collection_feedback` (`status`);--> statement-breakpoint
CREATE TABLE `collections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`condominiumId` integer NOT NULL,
	`residentId` integer,
	`createdByUserId` integer NOT NULL,
	`collectorUserId` integer,
	`wasteType` text NOT NULL,
	`block` text NOT NULL,
	`scheduledAt` integer NOT NULL,
	`completedAt` integer,
	`weightGrams` integer,
	`pointsAwarded` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'agendada' NOT NULL,
	`notes` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `collections_condominium_idx` ON `collections` (`condominiumId`);--> statement-breakpoint
CREATE INDEX `collections_status_idx` ON `collections` (`status`);--> statement-breakpoint
CREATE INDEX `collections_scheduled_idx` ON `collections` (`scheduledAt`);--> statement-breakpoint
CREATE INDEX `collections_condominium_scheduled_idx` ON `collections` (`condominiumId`,`scheduledAt`);--> statement-breakpoint
CREATE INDEX `collections_condominium_status_scheduled_idx` ON `collections` (`condominiumId`,`status`,`scheduledAt`);--> statement-breakpoint
CREATE INDEX `collections_condominium_block_scheduled_idx` ON `collections` (`condominiumId`,`block`,`scheduledAt`);--> statement-breakpoint
CREATE TABLE `condominiums` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`address` text,
	`city` text,
	`state` text,
	`blockCount` integer DEFAULT 1 NOT NULL,
	`isActive` integer DEFAULT true NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `disposal_guides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`condominiumId` integer NOT NULL,
	`wasteType` text NOT NULL,
	`title` text NOT NULL,
	`acceptedItems` text NOT NULL,
	`rejectedItems` text NOT NULL,
	`instructions` text NOT NULL,
	`isPublished` integer DEFAULT true NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `guides_condominium_waste_unique` ON `disposal_guides` (`condominiumId`,`wasteType`);--> statement-breakpoint
CREATE TABLE `incidents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`condominiumId` integer NOT NULL,
	`reporterUserId` integer NOT NULL,
	`block` text NOT NULL,
	`wasteType` text NOT NULL,
	`location` text NOT NULL,
	`description` text NOT NULL,
	`imageKey` text,
	`imageUrl` text,
	`status` text DEFAULT 'aberta' NOT NULL,
	`resolutionNote` text,
	`resolvedByUserId` integer,
	`resolvedAt` integer,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `incidents_condominium_idx` ON `incidents` (`condominiumId`);--> statement-breakpoint
CREATE INDEX `incidents_status_idx` ON `incidents` (`status`);--> statement-breakpoint
CREATE INDEX `incidents_condominium_status_created_idx` ON `incidents` (`condominiumId`,`status`,`createdAt`);--> statement-breakpoint
CREATE TABLE `notification_reads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`notificationId` integer NOT NULL,
	`userId` integer NOT NULL,
	`readAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_reads_notification_user_unique` ON `notification_reads` (`notificationId`,`userId`);--> statement-breakpoint
CREATE INDEX `notification_reads_user_idx` ON `notification_reads` (`userId`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`condominiumId` integer NOT NULL,
	`recipientUserId` integer,
	`collectionId` integer,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`readAt` integer,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notifications_recipient_idx` ON `notifications` (`recipientUserId`);--> statement-breakpoint
CREATE INDEX `notifications_condominium_idx` ON `notifications` (`condominiumId`);--> statement-breakpoint
CREATE TABLE `people` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`condominiumId` integer NOT NULL,
	`userId` integer,
	`residentId` integer,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text,
	`block` text,
	`apartment` text,
	`role` text DEFAULT 'morador' NOT NULL,
	`accessStatus` text DEFAULT 'pendente' NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `people_condominium_email_unique` ON `people` (`condominiumId`,`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `people_user_unique` ON `people` (`userId`);--> statement-breakpoint
CREATE INDEX `people_condominium_idx` ON `people` (`condominiumId`);--> statement-breakpoint
CREATE TABLE `redemptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`condominiumId` integer NOT NULL,
	`residentId` integer NOT NULL,
	`rewardId` integer NOT NULL,
	`pointsSpent` integer NOT NULL,
	`status` text DEFAULT 'solicitado' NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `redemptions_resident_idx` ON `redemptions` (`residentId`);--> statement-breakpoint
CREATE INDEX `redemptions_condominium_idx` ON `redemptions` (`condominiumId`);--> statement-breakpoint
CREATE TABLE `residents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`condominiumId` integer NOT NULL,
	`userId` integer,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	`block` text NOT NULL,
	`apartment` text NOT NULL,
	`status` text DEFAULT 'ativo' NOT NULL,
	`points` integer DEFAULT 0 NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `residents_condominium_idx` ON `residents` (`condominiumId`);--> statement-breakpoint
CREATE UNIQUE INDEX `residents_user_unique` ON `residents` (`userId`);--> statement-breakpoint
CREATE TABLE `rewards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`condominiumId` integer NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`pointsCost` integer NOT NULL,
	`stock` integer,
	`isActive` integer DEFAULT true NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rewards_condominium_idx` ON `rewards` (`condominiumId`);--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` integer NOT NULL,
	`condominiumId` integer NOT NULL,
	`residentId` integer,
	`role` text DEFAULT 'morador' NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_profiles_user_unique` ON `user_profiles` (`userId`);--> statement-breakpoint
CREATE INDEX `user_profiles_condominium_idx` ON `user_profiles` (`condominiumId`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`openId` text NOT NULL,
	`name` text,
	`email` text,
	`loginMethod` text,
	`role` text DEFAULT 'user' NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	`lastSignedIn` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_openId_unique` ON `users` (`openId`);
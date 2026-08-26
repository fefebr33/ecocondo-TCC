CREATE TABLE `collections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominiumId` int NOT NULL,
	`residentId` int,
	`createdByUserId` int NOT NULL,
	`collectorUserId` int,
	`wasteType` enum('reciclavel','organico','rejeito','eletronico','perigoso') NOT NULL,
	`block` varchar(32) NOT NULL,
	`scheduledAt` timestamp NOT NULL,
	`completedAt` timestamp,
	`weightGrams` int,
	`pointsAwarded` int NOT NULL DEFAULT 0,
	`status` enum('agendada','em_andamento','concluida','cancelada','ocorrencia') NOT NULL DEFAULT 'agendada',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `collections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `condominiums` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(160) NOT NULL,
	`address` text,
	`city` varchar(100),
	`state` varchar(2),
	`blockCount` int NOT NULL DEFAULT 1,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `condominiums_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `disposal_guides` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominiumId` int NOT NULL,
	`wasteType` enum('reciclavel','organico','rejeito','eletronico','perigoso') NOT NULL,
	`title` varchar(140) NOT NULL,
	`acceptedItems` text NOT NULL,
	`rejectedItems` text NOT NULL,
	`instructions` text NOT NULL,
	`isPublished` boolean NOT NULL DEFAULT true,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `disposal_guides_id` PRIMARY KEY(`id`),
	CONSTRAINT `guides_condominium_waste_unique` UNIQUE(`condominiumId`,`wasteType`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominiumId` int NOT NULL,
	`recipientUserId` int,
	`collectionId` int,
	`kind` enum('coleta_agendada','coleta_concluida','comunicado','sistema') NOT NULL,
	`title` varchar(180) NOT NULL,
	`message` text NOT NULL,
	`readAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `redemptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominiumId` int NOT NULL,
	`residentId` int NOT NULL,
	`rewardId` int NOT NULL,
	`pointsSpent` int NOT NULL,
	`status` enum('solicitado','aprovado','entregue','cancelado') NOT NULL DEFAULT 'solicitado',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `redemptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `residents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominiumId` int NOT NULL,
	`userId` int,
	`name` varchar(180) NOT NULL,
	`email` varchar(320),
	`phone` varchar(32),
	`block` varchar(32) NOT NULL,
	`apartment` varchar(32) NOT NULL,
	`status` enum('ativo','inativo') NOT NULL DEFAULT 'ativo',
	`points` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `residents_id` PRIMARY KEY(`id`),
	CONSTRAINT `residents_user_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `rewards` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominiumId` int NOT NULL,
	`title` varchar(140) NOT NULL,
	`description` text NOT NULL,
	`pointsCost` int NOT NULL,
	`stock` int,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `rewards_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`condominiumId` int NOT NULL,
	`residentId` int,
	`role` enum('administrador','coletor','morador') NOT NULL DEFAULT 'morador',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_profiles_user_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE INDEX `collections_condominium_idx` ON `collections` (`condominiumId`);--> statement-breakpoint
CREATE INDEX `collections_status_idx` ON `collections` (`status`);--> statement-breakpoint
CREATE INDEX `collections_scheduled_idx` ON `collections` (`scheduledAt`);--> statement-breakpoint
CREATE INDEX `notifications_recipient_idx` ON `notifications` (`recipientUserId`);--> statement-breakpoint
CREATE INDEX `notifications_condominium_idx` ON `notifications` (`condominiumId`);--> statement-breakpoint
CREATE INDEX `redemptions_resident_idx` ON `redemptions` (`residentId`);--> statement-breakpoint
CREATE INDEX `redemptions_condominium_idx` ON `redemptions` (`condominiumId`);--> statement-breakpoint
CREATE INDEX `residents_condominium_idx` ON `residents` (`condominiumId`);--> statement-breakpoint
CREATE INDEX `rewards_condominium_idx` ON `rewards` (`condominiumId`);--> statement-breakpoint
CREATE INDEX `user_profiles_condominium_idx` ON `user_profiles` (`condominiumId`);
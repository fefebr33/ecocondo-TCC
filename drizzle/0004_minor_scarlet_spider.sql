CREATE TABLE `block_goals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominiumId` int NOT NULL,
	`block` varchar(32) NOT NULL,
	`title` varchar(140) NOT NULL,
	`targetKg` int NOT NULL,
	`startDate` timestamp NOT NULL,
	`endDate` timestamp NOT NULL,
	`createdByUserId` int NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `block_goals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `campaign_participants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`campaignId` int NOT NULL,
	`residentId` int NOT NULL,
	`joinedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `campaign_participants_id` PRIMARY KEY(`id`),
	CONSTRAINT `campaign_participant_unique` UNIQUE(`campaignId`,`residentId`)
);
--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominiumId` int NOT NULL,
	`title` varchar(140) NOT NULL,
	`description` text NOT NULL,
	`targetDescription` varchar(240) NOT NULL,
	`startDate` timestamp NOT NULL,
	`endDate` timestamp NOT NULL,
	`status` enum('planejada','ativa','encerrada') NOT NULL DEFAULT 'planejada',
	`createdByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `campaigns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `collection_feedback` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominiumId` int NOT NULL,
	`residentId` int NOT NULL,
	`collectionId` int,
	`rating` int NOT NULL,
	`message` text NOT NULL,
	`status` enum('novo','respondido','arquivado') NOT NULL DEFAULT 'novo',
	`response` text,
	`respondedByUserId` int,
	`respondedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `collection_feedback_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `incidents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominiumId` int NOT NULL,
	`reporterUserId` int NOT NULL,
	`block` varchar(32) NOT NULL,
	`wasteType` enum('reciclavel','organico','rejeito','eletronico','perigoso') NOT NULL,
	`location` varchar(180) NOT NULL,
	`description` text NOT NULL,
	`imageKey` varchar(512),
	`imageUrl` varchar(1024),
	`status` enum('aberta','em_analise','resolvida') NOT NULL DEFAULT 'aberta',
	`resolutionNote` text,
	`resolvedByUserId` int,
	`resolvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `incidents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `block_goals_condominium_idx` ON `block_goals` (`condominiumId`);--> statement-breakpoint
CREATE INDEX `block_goals_period_idx` ON `block_goals` (`startDate`,`endDate`);--> statement-breakpoint
CREATE INDEX `campaign_participants_resident_idx` ON `campaign_participants` (`residentId`);--> statement-breakpoint
CREATE INDEX `campaigns_condominium_idx` ON `campaigns` (`condominiumId`);--> statement-breakpoint
CREATE INDEX `campaigns_period_idx` ON `campaigns` (`startDate`,`endDate`);--> statement-breakpoint
CREATE INDEX `feedback_condominium_idx` ON `collection_feedback` (`condominiumId`);--> statement-breakpoint
CREATE INDEX `feedback_resident_idx` ON `collection_feedback` (`residentId`);--> statement-breakpoint
CREATE INDEX `feedback_status_idx` ON `collection_feedback` (`status`);--> statement-breakpoint
CREATE INDEX `incidents_condominium_idx` ON `incidents` (`condominiumId`);--> statement-breakpoint
CREATE INDEX `incidents_status_idx` ON `incidents` (`status`);
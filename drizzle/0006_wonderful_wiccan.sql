CREATE TABLE `audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominiumId` int NOT NULL,
	`actorUserId` int NOT NULL,
	`entityType` enum('coleta','ocorrencia') NOT NULL,
	`entityId` int NOT NULL,
	`action` varchar(80) NOT NULL,
	`summary` varchar(300) NOT NULL,
	`beforeState` text,
	`afterState` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `audit_logs_condominium_created_idx` ON `audit_logs` (`condominiumId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `audit_logs_entity_idx` ON `audit_logs` (`entityType`,`entityId`);--> statement-breakpoint
CREATE INDEX `audit_logs_actor_created_idx` ON `audit_logs` (`actorUserId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `collections_condominium_scheduled_idx` ON `collections` (`condominiumId`,`scheduledAt`);--> statement-breakpoint
CREATE INDEX `collections_condominium_status_scheduled_idx` ON `collections` (`condominiumId`,`status`,`scheduledAt`);--> statement-breakpoint
CREATE INDEX `collections_condominium_block_scheduled_idx` ON `collections` (`condominiumId`,`block`,`scheduledAt`);--> statement-breakpoint
CREATE INDEX `incidents_condominium_status_created_idx` ON `incidents` (`condominiumId`,`status`,`createdAt`);
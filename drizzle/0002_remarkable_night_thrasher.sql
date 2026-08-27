CREATE TABLE `people` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominiumId` int NOT NULL,
	`userId` int,
	`residentId` int,
	`name` varchar(180) NOT NULL,
	`email` varchar(320) NOT NULL,
	`phone` varchar(32),
	`block` varchar(32),
	`apartment` varchar(32),
	`role` enum('administrador','coletor','morador') NOT NULL DEFAULT 'morador',
	`accessStatus` enum('pendente','ativo') NOT NULL DEFAULT 'pendente',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `people_id` PRIMARY KEY(`id`),
	CONSTRAINT `people_condominium_email_unique` UNIQUE(`condominiumId`,`email`),
	CONSTRAINT `people_user_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE INDEX `people_condominium_idx` ON `people` (`condominiumId`);
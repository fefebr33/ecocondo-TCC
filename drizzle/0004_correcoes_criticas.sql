CREATE TABLE `arquivos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`chave` varchar(255) NOT NULL,
	`tipo_conteudo` varchar(100) NOT NULL,
	`tamanho` int NOT NULL,
	`dados` mediumblob NOT NULL,
	`criado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `arquivos_id` PRIMARY KEY(`id`),
	CONSTRAINT `arquivos_chave_unique` UNIQUE(`chave`)
);
--> statement-breakpoint
CREATE TABLE `sessoes_encerradas` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessao_id` varchar(64) NOT NULL,
	`usuario_id` int NOT NULL,
	`expira_em` datetime(3) NOT NULL,
	`criado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `sessoes_encerradas_id` PRIMARY KEY(`id`),
	CONSTRAINT `sessoes_encerradas_sessao_unique` UNIQUE(`sessao_id`)
);
--> statement-breakpoint
ALTER TABLE `pessoas` MODIFY COLUMN `status_acesso` enum('pendente','ativo','desativado') NOT NULL DEFAULT 'pendente';--> statement-breakpoint
ALTER TABLE `coletas` ADD `pontos_previstos_milesimos` int;--> statement-breakpoint
ALTER TABLE `moradores` ADD `resto_pontos_milesimos` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `usuarios` ADD `versao_sessao` int DEFAULT 0 NOT NULL;
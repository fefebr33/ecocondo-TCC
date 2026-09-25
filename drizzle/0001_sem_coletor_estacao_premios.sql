CREATE TABLE `entregas_premio_podio` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominio_id` int NOT NULL,
	`morador_id` int NOT NULL,
	`periodo` enum('mensal','semestral','anual') NOT NULL,
	`intervalo_inicio` datetime(3) NOT NULL,
	`intervalo_fim` datetime(3) NOT NULL,
	`posicao` int NOT NULL,
	`premio` varchar(255) NOT NULL,
	`observacao` text,
	`entregue_por_id` int NOT NULL,
	`entregue_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `entregas_premio_podio_id` PRIMARY KEY(`id`),
	CONSTRAINT `entregas_premio_unique` UNIQUE(`morador_id`,`periodo`,`intervalo_inicio`)
);--> statement-breakpoint
CREATE TABLE `estacoes_pesagem` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominio_id` int NOT NULL,
	`nome` varchar(255) NOT NULL,
	`local` varchar(255) NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`ativo` boolean NOT NULL DEFAULT true,
	`criado_por_id` int NOT NULL,
	`ultimo_uso_em` datetime(3),
	`criado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`atualizado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `estacoes_pesagem_id` PRIMARY KEY(`id`),
	CONSTRAINT `estacoes_token_unique` UNIQUE(`token_hash`)
);--> statement-breakpoint
CREATE TABLE `premios_podio` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominio_id` int NOT NULL,
	`periodo` enum('mensal','semestral','anual') NOT NULL,
	`posicao` int NOT NULL,
	`titulo` varchar(255) NOT NULL,
	`descricao` text,
	`atualizado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `premios_podio_id` PRIMARY KEY(`id`),
	CONSTRAINT `premios_podio_unique` UNIQUE(`condominio_id`,`periodo`,`posicao`)
);--> statement-breakpoint
-- Perfil coletor retirado: quem também tinha apartamento vira morador; os demais perdem o acesso. As coletas antigas continuam no histórico com o coletor_id original.
UPDATE `perfis_acesso` SET `papel` = 'morador' WHERE `papel` = 'coletor' AND `morador_id` IS NOT NULL;--> statement-breakpoint
DELETE FROM `perfis_acesso` WHERE `papel` = 'coletor';--> statement-breakpoint
UPDATE `pessoas` SET `papel` = 'morador' WHERE `papel` = 'coletor' AND `morador_id` IS NOT NULL;--> statement-breakpoint
DELETE FROM `pessoas` WHERE `papel` = 'coletor';--> statement-breakpoint
ALTER TABLE `perfis_acesso` MODIFY COLUMN `papel` enum('administrador','morador') NOT NULL DEFAULT 'morador';--> statement-breakpoint
ALTER TABLE `pessoas` MODIFY COLUMN `papel` enum('administrador','morador') NOT NULL DEFAULT 'morador';--> statement-breakpoint
ALTER TABLE `logs_auditoria` MODIFY COLUMN `tipo_entidade` enum('coleta','ocorrencia','desconto_podio','premio_podio','estacao') NOT NULL;--> statement-breakpoint
ALTER TABLE `coletas` ADD `estacao_id` int;--> statement-breakpoint
ALTER TABLE `moradores` ADD `codigo_estacao` varchar(8);--> statement-breakpoint
ALTER TABLE `moradores` ADD `codigo_estacao_expira_em` datetime(3);--> statement-breakpoint
ALTER TABLE `moradores` ADD `ocultar_nome_no_podio` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `moradores` ADD CONSTRAINT `moradores_codigo_estacao_unique` UNIQUE(`condominio_id`,`codigo_estacao`);--> statement-breakpoint
CREATE INDEX `entregas_premio_condominio_idx` ON `entregas_premio_podio` (`condominio_id`);--> statement-breakpoint
CREATE INDEX `estacoes_condominio_idx` ON `estacoes_pesagem` (`condominio_id`);--> statement-breakpoint
CREATE INDEX `coletas_morador_concluida_idx` ON `coletas` (`morador_id`,`concluida_em`);--> statement-breakpoint
-- Descontos já registrados viram entregas de prêmio, com o percentual guardado no nome do prêmio.
INSERT INTO `entregas_premio_podio` (`condominio_id`, `morador_id`, `periodo`, `intervalo_inicio`, `intervalo_fim`, `posicao`, `premio`, `observacao`, `entregue_por_id`, `entregue_em`)
SELECT `condominio_id`, `morador_id`, `periodo`, `intervalo_inicio`, `intervalo_fim`, `posicao`, CONCAT('Desconto de ', `percentual_aplicado`, '% na taxa condominial (regra antiga)'), `observacao`, `aplicado_por_id`, `aplicado_em` FROM `aplicacoes_desconto_podio`;--> statement-breakpoint
DROP TABLE `aplicacoes_desconto_podio`;--> statement-breakpoint
ALTER TABLE `condominios` DROP COLUMN `desconto_podio_mensal_percentual`;--> statement-breakpoint
ALTER TABLE `condominios` DROP COLUMN `desconto_podio_semestral_percentual`;--> statement-breakpoint
ALTER TABLE `condominios` DROP COLUMN `desconto_podio_anual_percentual`;
CREATE TABLE `preferencias_notificacao` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominio_id` int NOT NULL,
	`papel` enum('administrador','morador') NOT NULL,
	`tipo` enum('coleta_agendada','coleta_concluida','lembrete_coleta','comunicado','sistema','certificado_disponivel','relatorio_anual','solicitacao_criada','codigo_estacao','pesagem_registrada','pontos_ganhos','coleta_reprovada','pontos_estornados','revisao_administrativa','premio_resgatado','resgate_atualizado','resgate_recusado','novo_premio','cadastro_alterado','premio_podio','nova_coleta','aguardando_pesagem','peso_suspeito','pontos_pendentes','novo_resgate','estoque_baixo','sem_estoque','novo_cadastro','falha_operacional','auditoria_aberta','auditoria_concluida','pontos_zerados','pontos_ajustados','descarte_aguardando_aprovacao') NOT NULL,
	`ativo` boolean NOT NULL DEFAULT true,
	`atualizado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `preferencias_notificacao_id` PRIMARY KEY(`id`),
	CONSTRAINT `preferencias_notificacao_unique` UNIQUE(`condominio_id`,`papel`,`tipo`)
);
--> statement-breakpoint
CREATE TABLE `regras_residuo` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominio_id` int NOT NULL,
	`tipo_residuo` enum('reciclavel','organico','rejeito','eletronico','perigoso') NOT NULL,
	`peso_minimo_gramas` int NOT NULL,
	`peso_maximo_gramas` int NOT NULL,
	`pontos_por_kg` double NOT NULL,
	`atualizado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `regras_residuo_id` PRIMARY KEY(`id`),
	CONSTRAINT `regras_residuo_unique` UNIQUE(`condominio_id`,`tipo_residuo`)
);
--> statement-breakpoint
CREATE TABLE `tokens_senha` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(320) NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`tipo` enum('primeiro_acesso','recuperacao') NOT NULL,
	`expira_em` datetime(3) NOT NULL,
	`usado_em` datetime(3),
	`criado_por_id` int,
	`criado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `tokens_senha_id` PRIMARY KEY(`id`),
	CONSTRAINT `tokens_senha_hash_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
ALTER TABLE `coletas` MODIFY COLUMN `aprovacao_peso_status` enum('pendente','aprovado','rejeitado','auditoria');--> statement-breakpoint
ALTER TABLE `logs_auditoria` MODIFY COLUMN `tipo_entidade` enum('coleta','ocorrencia','desconto_podio','premio_podio','estacao','resgate','recompensa','pessoa','morador','comunicado','pontos','configuracao','usuario') NOT NULL;--> statement-breakpoint
ALTER TABLE `movimentacoes_pontos` MODIFY COLUMN `tipo` enum('credito_coleta','estorno_coleta','resgate','devolucao_resgate','ajuste','zeragem','penalidade') NOT NULL;--> statement-breakpoint
ALTER TABLE `notificacoes` MODIFY COLUMN `tipo` enum('coleta_agendada','coleta_concluida','lembrete_coleta','comunicado','sistema','certificado_disponivel','relatorio_anual','solicitacao_criada','codigo_estacao','pesagem_registrada','pontos_ganhos','coleta_reprovada','pontos_estornados','revisao_administrativa','premio_resgatado','resgate_atualizado','resgate_recusado','novo_premio','cadastro_alterado','premio_podio','nova_coleta','aguardando_pesagem','peso_suspeito','pontos_pendentes','novo_resgate','estoque_baixo','sem_estoque','novo_cadastro','falha_operacional','auditoria_aberta','auditoria_concluida','pontos_zerados','pontos_ajustados','descarte_aguardando_aprovacao') NOT NULL;--> statement-breakpoint
ALTER TABLE `coletas` ADD `lote` varchar(24);--> statement-breakpoint
ALTER TABLE `coletas` ADD `motivo_auditoria` text;--> statement-breakpoint
ALTER TABLE `coletas` ADD `auditoria_aberta_em` datetime(3);--> statement-breakpoint
ALTER TABLE `condominios` ADD `pontos_zerados_em` datetime(3);--> statement-breakpoint
ALTER TABLE `guias_descarte` ADD `cor_saco` varchar(7);--> statement-breakpoint
ALTER TABLE `guias_descarte` ADD `nome_cor_saco` varchar(40);--> statement-breakpoint
ALTER TABLE `usuarios` ADD `senha_hash` varchar(255);--> statement-breakpoint
ALTER TABLE `usuarios` ADD `manual_lido_em` datetime(3);--> statement-breakpoint
CREATE INDEX `tokens_senha_email_idx` ON `tokens_senha` (`email`);--> statement-breakpoint
CREATE INDEX `coletas_lote_idx` ON `coletas` (`lote`);--> statement-breakpoint
-- O sistema passa a ser só de descarte na estação: agendamentos que ficaram em aberto são cancelados, e as regras de recorrência, pausadas.
UPDATE `coletas` SET `status` = 'cancelada', `observacoes` = TRIM(CONCAT(COALESCE(`observacoes`, ''), ' Agendamento encerrado: o EcoCondo agora registra só descartes feitos na estação.')), `atualizado_em` = CURRENT_TIMESTAMP(3) WHERE `status` IN ('agendada', 'em_andamento');--> statement-breakpoint
UPDATE `regras_recorrencia_coleta` SET `ativo` = false;

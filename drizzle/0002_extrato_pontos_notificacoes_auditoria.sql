CREATE TABLE `movimentacoes_pontos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominio_id` int NOT NULL,
	`morador_id` int NOT NULL,
	`tipo` enum('credito_coleta','estorno_coleta','resgate','devolucao_resgate','ajuste') NOT NULL,
	`pontos` int NOT NULL,
	`saldo_apos` int,
	`coleta_id` int,
	`resgate_id` int,
	`descricao` varchar(255) NOT NULL,
	`autor_id` int,
	`criado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `movimentacoes_pontos_id` PRIMARY KEY(`id`),
	CONSTRAINT `movimentacoes_pontos_coleta_unique` UNIQUE(`tipo`,`coleta_id`),
	CONSTRAINT `movimentacoes_pontos_resgate_unique` UNIQUE(`tipo`,`resgate_id`)
);
--> statement-breakpoint
ALTER TABLE `logs_auditoria` MODIFY COLUMN `tipo_entidade` enum('coleta','ocorrencia','desconto_podio','premio_podio','estacao','resgate','recompensa','pessoa','morador','comunicado') NOT NULL;--> statement-breakpoint
ALTER TABLE `notificacoes` MODIFY COLUMN `tipo` enum('coleta_agendada','coleta_concluida','lembrete_coleta','comunicado','sistema','certificado_disponivel','relatorio_anual','solicitacao_criada','codigo_estacao','pesagem_registrada','pontos_ganhos','coleta_reprovada','pontos_estornados','revisao_administrativa','premio_resgatado','resgate_atualizado','resgate_recusado','novo_premio','cadastro_alterado','premio_podio','nova_coleta','aguardando_pesagem','peso_suspeito','pontos_pendentes','novo_resgate','estoque_baixo','sem_estoque','novo_cadastro','falha_operacional') NOT NULL;--> statement-breakpoint
ALTER TABLE `coletas` ADD `motivo_decisao` text;--> statement-breakpoint
ALTER TABLE `coletas` ADD `pesagem_simulada` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `estacoes_pesagem` ADD `modo_demonstracao` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `logs_auditoria` ADD `motivo` text;--> statement-breakpoint
CREATE INDEX `movimentacoes_pontos_morador_idx` ON `movimentacoes_pontos` (`morador_id`,`criado_em`);--> statement-breakpoint
CREATE INDEX `movimentacoes_pontos_condominio_idx` ON `movimentacoes_pontos` (`condominio_id`,`criado_em`);--> statement-breakpoint
-- Extrato inicial a partir do histórico: créditos das coletas que pontuaram, débitos dos resgates e devoluções dos resgates cancelados.
INSERT INTO `movimentacoes_pontos` (`condominio_id`, `morador_id`, `tipo`, `pontos`, `coleta_id`, `descricao`, `criado_em`)
SELECT `condominio_id`, `morador_id`, 'credito_coleta', `pontos_concedidos`, `id`, 'Coleta concluída (histórico anterior ao extrato)', COALESCE(`concluida_em`, `criado_em`)
FROM `coletas` WHERE `morador_id` IS NOT NULL AND `pontos_concedidos` > 0;--> statement-breakpoint
INSERT INTO `movimentacoes_pontos` (`condominio_id`, `morador_id`, `tipo`, `pontos`, `resgate_id`, `descricao`, `criado_em`)
SELECT `condominio_id`, `morador_id`, 'resgate', -`pontos_gastos`, `id`, 'Resgate de recompensa (histórico anterior ao extrato)', `criado_em`
FROM `resgates`;--> statement-breakpoint
INSERT INTO `movimentacoes_pontos` (`condominio_id`, `morador_id`, `tipo`, `pontos`, `resgate_id`, `descricao`, `criado_em`)
SELECT `condominio_id`, `morador_id`, 'devolucao_resgate', `pontos_gastos`, `id`, 'Resgate cancelado (histórico anterior ao extrato)', `atualizado_em`
FROM `resgates` WHERE `status` = 'cancelado';--> statement-breakpoint
-- Qualquer diferença restante entre o saldo gravado e a soma do extrato vira um ajuste, para o extrato sempre fechar com o saldo.
INSERT INTO `movimentacoes_pontos` (`condominio_id`, `morador_id`, `tipo`, `pontos`, `saldo_apos`, `descricao`)
SELECT m.`condominio_id`, m.`id`, 'ajuste', m.`pontos` - COALESCE(s.`total`, 0), m.`pontos`, 'Ajuste de saldo na criação do extrato'
FROM `moradores` m LEFT JOIN (SELECT `morador_id`, SUM(`pontos`) AS `total` FROM `movimentacoes_pontos` GROUP BY `morador_id`) s ON s.`morador_id` = m.`id`
WHERE m.`pontos` <> COALESCE(s.`total`, 0);

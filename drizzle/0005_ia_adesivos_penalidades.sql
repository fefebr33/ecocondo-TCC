CREATE TABLE `adesivos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominio_id` int NOT NULL,
	`morador_id` int NOT NULL,
	`codigo` varchar(20) NOT NULL,
	`status` enum('disponivel','utilizado','cancelado') NOT NULL DEFAULT 'disponivel',
	`pedido_id` int,
	`coleta_id` int,
	`utilizado_em` datetime(3),
	`criado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `adesivos_id` PRIMARY KEY(`id`),
	CONSTRAINT `adesivos_codigo_unique` UNIQUE(`codigo`)
);
--> statement-breakpoint
CREATE TABLE `analises_ia` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominio_id` int NOT NULL,
	`coleta_id` int NOT NULL,
	`modo` enum('claude','simulacao') NOT NULL,
	`modelo` varchar(80),
	`tipo_identificado` enum('reciclavel','organico','rejeito','eletronico','perigoso'),
	`peso_lido_gramas` int,
	`cor_saco_identificada` varchar(40),
	`cor_saco_esperada` varchar(40),
	`confianca` int,
	`resultado` enum('aprovado_automatico','pendente','erro') NOT NULL,
	`motivos` text NOT NULL,
	`descricao` text,
	`duracao_ms` int,
	`criado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `analises_ia_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `modelos_penalidade` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominio_id` int NOT NULL,
	`nome` varchar(120) NOT NULL,
	`tipo` enum('perda_pontos','suspensao_campanhas','suspensao_participacao','advertencia','outra') NOT NULL,
	`pontos` int,
	`duracao_valor` int,
	`duracao_unidade` enum('dias','meses'),
	`descricao` varchar(500),
	`ativo` boolean NOT NULL DEFAULT true,
	`criado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`atualizado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `modelos_penalidade_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pedidos_adesivos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominio_id` int NOT NULL,
	`morador_id` int NOT NULL,
	`quantidade_solicitada` int NOT NULL,
	`quantidade_entregue` int,
	`status` enum('solicitado','entregue','recusado') NOT NULL DEFAULT 'solicitado',
	`observacao` varchar(300),
	`solicitado_por_id` int NOT NULL,
	`entregue_por_id` int,
	`entregue_em` datetime(3),
	`criado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `pedidos_adesivos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `penalidades` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominio_id` int NOT NULL,
	`morador_id` int NOT NULL,
	`modelo_id` int,
	`tipo` enum('perda_pontos','suspensao_campanhas','suspensao_participacao','advertencia','outra') NOT NULL,
	`nome` varchar(120) NOT NULL,
	`pontos` int,
	`inicio_em` datetime(3) NOT NULL,
	`fim_em` datetime(3),
	`motivo` text NOT NULL,
	`coleta_id` int,
	`ocorrencia_id` int,
	`aplicada_por_id` int NOT NULL,
	`status` enum('ativa','encerrada','revogada') NOT NULL DEFAULT 'ativa',
	`revogada_por_id` int,
	`revogada_em` datetime(3),
	`motivo_revogacao` varchar(300),
	`aviso_encerramento_em` datetime(3),
	`criado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `penalidades_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `movimentacoes_pontos` DROP INDEX `movimentacoes_pontos_coleta_unique`;--> statement-breakpoint
ALTER TABLE `campanhas` MODIFY COLUMN `status` enum('planejada','ativa','pausada','encerrada') NOT NULL DEFAULT 'planejada';--> statement-breakpoint
ALTER TABLE `logs_auditoria` MODIFY COLUMN `tipo_entidade` enum('coleta','ocorrencia','desconto_podio','premio_podio','estacao','resgate','recompensa','pessoa','morador','comunicado','pontos','configuracao','usuario','adesivo','penalidade','campanha','avaliacao') NOT NULL;--> statement-breakpoint
ALTER TABLE `notificacoes` MODIFY COLUMN `tipo` enum('coleta_agendada','coleta_concluida','lembrete_coleta','comunicado','sistema','certificado_disponivel','relatorio_anual','solicitacao_criada','codigo_estacao','pesagem_registrada','pontos_ganhos','coleta_reprovada','pontos_estornados','revisao_administrativa','premio_resgatado','resgate_atualizado','resgate_recusado','novo_premio','cadastro_alterado','premio_podio','nova_coleta','aguardando_pesagem','peso_suspeito','pontos_pendentes','novo_resgate','estoque_baixo','sem_estoque','novo_cadastro','falha_operacional','auditoria_aberta','auditoria_concluida','pontos_zerados','pontos_ajustados','descarte_aguardando_aprovacao','descarte_aprovado_ia','descarte_revertido','penalidade_aplicada','penalidade_encerrada','irregularidade_detectada','nova_campanha','campanha_participacao','campanha_atualizada','campanha_pausada','campanha_encerrando','campanha_encerrada','nova_ocorrencia','ocorrencia_atualizada','novo_feedback','feedback_respondido','adesivos_solicitados','adesivos_entregues','adesivos_acabando','aviso_geral') NOT NULL;--> statement-breakpoint
ALTER TABLE `ocorrencias` MODIFY COLUMN `status` enum('aberta','em_analise','em_auditoria','resolvida') NOT NULL DEFAULT 'aberta';--> statement-breakpoint
ALTER TABLE `preferencias_notificacao` MODIFY COLUMN `tipo` enum('coleta_agendada','coleta_concluida','lembrete_coleta','comunicado','sistema','certificado_disponivel','relatorio_anual','solicitacao_criada','codigo_estacao','pesagem_registrada','pontos_ganhos','coleta_reprovada','pontos_estornados','revisao_administrativa','premio_resgatado','resgate_atualizado','resgate_recusado','novo_premio','cadastro_alterado','premio_podio','nova_coleta','aguardando_pesagem','peso_suspeito','pontos_pendentes','novo_resgate','estoque_baixo','sem_estoque','novo_cadastro','falha_operacional','auditoria_aberta','auditoria_concluida','pontos_zerados','pontos_ajustados','descarte_aguardando_aprovacao','descarte_aprovado_ia','descarte_revertido','penalidade_aplicada','penalidade_encerrada','irregularidade_detectada','nova_campanha','campanha_participacao','campanha_atualizada','campanha_pausada','campanha_encerrando','campanha_encerrada','nova_ocorrencia','ocorrencia_atualizada','novo_feedback','feedback_respondido','adesivos_solicitados','adesivos_entregues','adesivos_acabando','aviso_geral') NOT NULL;--> statement-breakpoint
ALTER TABLE `campanhas` ADD `pausada_em` datetime(3);--> statement-breakpoint
ALTER TABLE `campanhas` ADD `pausada_ate` datetime(3);--> statement-breakpoint
ALTER TABLE `campanhas` ADD `motivo_pausa` varchar(300);--> statement-breakpoint
ALTER TABLE `campanhas` ADD `excluida_em` datetime(3);--> statement-breakpoint
ALTER TABLE `campanhas` ADD `aviso_encerrando_em` datetime(3);--> statement-breakpoint
ALTER TABLE `campanhas` ADD `aviso_encerrada_em` datetime(3);--> statement-breakpoint
ALTER TABLE `coletas` ADD `adesivo_id` int;--> statement-breakpoint
ALTER TABLE `coletas` ADD `revisao` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `condominios` ADD `ia_aprovacao_automatica` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `condominios` ADD `ia_confianca_minima` int DEFAULT 80 NOT NULL;--> statement-breakpoint
ALTER TABLE `condominios` ADD `adesivo_obrigatorio` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `movimentacoes_pontos` ADD `revisao_coleta` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `movimentacoes_pontos` ADD `penalidade_id` int;--> statement-breakpoint
ALTER TABLE `notificacoes` ADD `publico` enum('todos','moradores','administradores');--> statement-breakpoint
ALTER TABLE `notificacoes` ADD `categoria` varchar(40);--> statement-breakpoint
ALTER TABLE `notificacoes` ADD `importante` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `notificacoes` ADD `autor_id` int;--> statement-breakpoint
ALTER TABLE `ocorrencias` ADD `categoria` enum('ambiental','descarte_irregular','suspeita_fraude','problema_sistema','outro') DEFAULT 'ambiental' NOT NULL;--> statement-breakpoint
ALTER TABLE `ocorrencias` ADD `coleta_id` int;--> statement-breakpoint
ALTER TABLE `ocorrencias` ADD `morador_envolvido_id` int;--> statement-breakpoint
ALTER TABLE `ocorrencias` ADD `conclusao` enum('procedente','improcedente','denuncia_falsa');--> statement-breakpoint
ALTER TABLE `coletas` ADD CONSTRAINT `coletas_adesivo_unique` UNIQUE(`adesivo_id`);--> statement-breakpoint
ALTER TABLE `movimentacoes_pontos` ADD CONSTRAINT `movimentacoes_pontos_coleta_unique` UNIQUE(`tipo`,`coleta_id`,`revisao_coleta`);--> statement-breakpoint
CREATE INDEX `adesivos_morador_idx` ON `adesivos` (`morador_id`,`status`);--> statement-breakpoint
CREATE INDEX `analises_ia_coleta_idx` ON `analises_ia` (`coleta_id`);--> statement-breakpoint
CREATE INDEX `analises_ia_condominio_idx` ON `analises_ia` (`condominio_id`,`criado_em`);--> statement-breakpoint
CREATE INDEX `modelos_penalidade_condominio_idx` ON `modelos_penalidade` (`condominio_id`);--> statement-breakpoint
CREATE INDEX `pedidos_adesivos_condominio_idx` ON `pedidos_adesivos` (`condominio_id`,`status`);--> statement-breakpoint
CREATE INDEX `pedidos_adesivos_morador_idx` ON `pedidos_adesivos` (`morador_id`);--> statement-breakpoint
CREATE INDEX `penalidades_morador_idx` ON `penalidades` (`morador_id`,`status`);--> statement-breakpoint
CREATE INDEX `penalidades_condominio_idx` ON `penalidades` (`condominio_id`,`criado_em`);--> statement-breakpoint
CREATE INDEX `ocorrencias_coleta_idx` ON `ocorrencias` (`coleta_id`);--> statement-breakpoint
CREATE INDEX `ocorrencias_relator_idx` ON `ocorrencias` (`relator_id`);
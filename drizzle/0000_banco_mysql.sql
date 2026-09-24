CREATE TABLE `aplicacoes_desconto_podio` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominio_id` int NOT NULL,
	`morador_id` int NOT NULL,
	`periodo` enum('mensal','semestral','anual') NOT NULL,
	`intervalo_inicio` datetime(3) NOT NULL,
	`intervalo_fim` datetime(3) NOT NULL,
	`posicao` int NOT NULL,
	`percentual_aplicado` double NOT NULL,
	`observacao` text,
	`aplicado_por_id` int NOT NULL,
	`aplicado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `aplicacoes_desconto_podio_id` PRIMARY KEY(`id`),
	CONSTRAINT `aplicacoes_desconto_unique` UNIQUE(`morador_id`,`periodo`,`intervalo_inicio`)
);
--> statement-breakpoint
CREATE TABLE `avaliacoes_coleta` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominio_id` int NOT NULL,
	`morador_id` int NOT NULL,
	`coleta_id` int,
	`nota` int NOT NULL,
	`mensagem` text NOT NULL,
	`status` enum('nova','respondida','arquivada') NOT NULL DEFAULT 'nova',
	`resposta` text,
	`respondido_por_id` int,
	`respondida_em` datetime(3),
	`criado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`atualizado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `avaliacoes_coleta_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `campanhas` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominio_id` int NOT NULL,
	`titulo` varchar(255) NOT NULL,
	`descricao` text NOT NULL,
	`descricao_meta` text NOT NULL,
	`data_inicio` datetime(3) NOT NULL,
	`data_fim` datetime(3) NOT NULL,
	`status` enum('planejada','ativa','encerrada') NOT NULL DEFAULT 'planejada',
	`criado_por_id` int NOT NULL,
	`criado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`atualizado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `campanhas_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `certificados_sustentabilidade` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominio_id` int NOT NULL,
	`bloco` varchar(255) NOT NULL,
	`trimestre` varchar(7) NOT NULL,
	`peso_kg` double NOT NULL,
	`chave_arquivo` varchar(255) NOT NULL,
	`url_arquivo` varchar(512) NOT NULL,
	`gerado_por_id` int,
	`gerado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `certificados_sustentabilidade_id` PRIMARY KEY(`id`),
	CONSTRAINT `certificados_unique` UNIQUE(`condominio_id`,`bloco`,`trimestre`)
);
--> statement-breakpoint
CREATE TABLE `coletas` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominio_id` int NOT NULL,
	`morador_id` int,
	`criado_por_id` int NOT NULL,
	`coletor_id` int,
	`concluido_por_id` int,
	`tipo_residuo` enum('reciclavel','organico','rejeito','eletronico','perigoso') NOT NULL,
	`bloco` varchar(255) NOT NULL,
	`agendada_para` datetime(3) NOT NULL,
	`concluida_em` datetime(3),
	`peso_gramas` int,
	`pontos_concedidos` int NOT NULL DEFAULT 0,
	`status` enum('agendada','em_andamento','concluida','cancelada','ocorrencia') NOT NULL DEFAULT 'agendada',
	`observacoes` text,
	`chave_foto` varchar(255),
	`url_foto` varchar(512),
	`regra_recorrencia_id` int,
	`pendente_aprovacao_peso` boolean NOT NULL DEFAULT false,
	`aprovacao_peso_status` enum('pendente','aprovado','rejeitado'),
	`aprovacao_peso_por_id` int,
	`aprovacao_peso_em` datetime(3),
	`criado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`atualizado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `coletas_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `condominios` (
	`id` int AUTO_INCREMENT NOT NULL,
	`nome` varchar(255) NOT NULL,
	`endereco` varchar(500),
	`cidade` varchar(255),
	`estado` varchar(2),
	`quantidade_blocos` int NOT NULL DEFAULT 1,
	`ativo` boolean NOT NULL DEFAULT true,
	`desconto_podio_mensal_percentual` double,
	`desconto_podio_semestral_percentual` double,
	`desconto_podio_anual_percentual` double,
	`criado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`atualizado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `condominios_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `guias_descarte` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominio_id` int NOT NULL,
	`tipo_residuo` enum('reciclavel','organico','rejeito','eletronico','perigoso') NOT NULL,
	`titulo` varchar(255) NOT NULL,
	`itens_aceitos` text NOT NULL,
	`itens_rejeitados` text NOT NULL,
	`instrucoes` text NOT NULL,
	`publicado` boolean NOT NULL DEFAULT true,
	`atualizado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `guias_descarte_id` PRIMARY KEY(`id`),
	CONSTRAINT `guias_condominio_residuo_unique` UNIQUE(`condominio_id`,`tipo_residuo`)
);
--> statement-breakpoint
CREATE TABLE `logs_auditoria` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominio_id` int NOT NULL,
	`autor_id` int NOT NULL,
	`tipo_entidade` enum('coleta','ocorrencia','desconto_podio') NOT NULL,
	`entidade_id` int NOT NULL,
	`acao` varchar(255) NOT NULL,
	`resumo` text NOT NULL,
	`estado_anterior` text,
	`estado_novo` text,
	`criado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `logs_auditoria_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `metas_bloco` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominio_id` int NOT NULL,
	`bloco` varchar(255) NOT NULL,
	`titulo` varchar(255) NOT NULL,
	`meta_kg` int NOT NULL,
	`data_inicio` datetime(3) NOT NULL,
	`data_fim` datetime(3) NOT NULL,
	`criado_por_id` int NOT NULL,
	`ativo` boolean NOT NULL DEFAULT true,
	`criado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`atualizado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `metas_bloco_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `metas_pessoais` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominio_id` int NOT NULL,
	`morador_id` int NOT NULL,
	`meta_kg` double NOT NULL,
	`data_inicio` datetime(3) NOT NULL,
	`data_fim` datetime(3) NOT NULL,
	`ativo` boolean NOT NULL DEFAULT true,
	`criado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`atualizado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `metas_pessoais_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `moradores` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominio_id` int NOT NULL,
	`usuario_id` int,
	`nome` varchar(255) NOT NULL,
	`email` varchar(320),
	`telefone` varchar(255),
	`bloco` varchar(255) NOT NULL,
	`apartamento` varchar(255) NOT NULL,
	`status` enum('ativo','inativo') NOT NULL DEFAULT 'ativo',
	`pontos` int NOT NULL DEFAULT 0,
	`codigo_acesso` varchar(32),
	`criado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`atualizado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `moradores_id` PRIMARY KEY(`id`),
	CONSTRAINT `moradores_usuario_unique` UNIQUE(`usuario_id`),
	CONSTRAINT `moradores_codigo_acesso_unique` UNIQUE(`codigo_acesso`)
);
--> statement-breakpoint
CREATE TABLE `notificacoes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominio_id` int NOT NULL,
	`destinatario_id` int,
	`coleta_id` int,
	`tipo` enum('coleta_agendada','coleta_concluida','lembrete_coleta','comunicado','sistema','certificado_disponivel','relatorio_anual') NOT NULL,
	`titulo` varchar(255) NOT NULL,
	`mensagem` text NOT NULL,
	`lida_em` datetime(3),
	`criado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `notificacoes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notificacoes_lidas` (
	`id` int AUTO_INCREMENT NOT NULL,
	`notificacao_id` int NOT NULL,
	`usuario_id` int NOT NULL,
	`lida_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `notificacoes_lidas_id` PRIMARY KEY(`id`),
	CONSTRAINT `notificacoes_lidas_notificacao_usuario_unique` UNIQUE(`notificacao_id`,`usuario_id`)
);
--> statement-breakpoint
CREATE TABLE `ocorrencias` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominio_id` int NOT NULL,
	`relator_id` int NOT NULL,
	`bloco` varchar(255) NOT NULL,
	`tipo_residuo` enum('reciclavel','organico','rejeito','eletronico','perigoso') NOT NULL,
	`local` varchar(255) NOT NULL,
	`descricao` text NOT NULL,
	`chave_imagem` varchar(255),
	`url_imagem` varchar(512),
	`status` enum('aberta','em_analise','resolvida') NOT NULL DEFAULT 'aberta',
	`nota_resolucao` text,
	`resolvido_por_id` int,
	`resolvida_em` datetime(3),
	`criado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`atualizado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `ocorrencias_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `participantes_campanha` (
	`id` int AUTO_INCREMENT NOT NULL,
	`campanha_id` int NOT NULL,
	`morador_id` int NOT NULL,
	`entrou_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `participantes_campanha_id` PRIMARY KEY(`id`),
	CONSTRAINT `participante_campanha_unique` UNIQUE(`campanha_id`,`morador_id`)
);
--> statement-breakpoint
CREATE TABLE `perfis_acesso` (
	`id` int AUTO_INCREMENT NOT NULL,
	`usuario_id` int NOT NULL,
	`condominio_id` int NOT NULL,
	`morador_id` int,
	`papel` enum('administrador','coletor','morador') NOT NULL DEFAULT 'morador',
	`criado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`atualizado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `perfis_acesso_id` PRIMARY KEY(`id`),
	CONSTRAINT `perfis_acesso_usuario_unique` UNIQUE(`usuario_id`)
);
--> statement-breakpoint
CREATE TABLE `pessoas` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominio_id` int NOT NULL,
	`usuario_id` int,
	`morador_id` int,
	`nome` varchar(255) NOT NULL,
	`email` varchar(320) NOT NULL,
	`telefone` varchar(255),
	`bloco` varchar(255),
	`apartamento` varchar(255),
	`papel` enum('administrador','coletor','morador') NOT NULL DEFAULT 'morador',
	`status_acesso` enum('pendente','ativo') NOT NULL DEFAULT 'pendente',
	`criado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`atualizado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `pessoas_id` PRIMARY KEY(`id`),
	CONSTRAINT `pessoas_condominio_email_unique` UNIQUE(`condominio_id`,`email`),
	CONSTRAINT `pessoas_usuario_unique` UNIQUE(`usuario_id`)
);
--> statement-breakpoint
CREATE TABLE `recompensas` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominio_id` int NOT NULL,
	`titulo` varchar(255) NOT NULL,
	`descricao` text NOT NULL,
	`custo_pontos` int NOT NULL,
	`estoque` int,
	`ativo` boolean NOT NULL DEFAULT true,
	`criado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`atualizado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `recompensas_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `regras_recorrencia_coleta` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominio_id` int NOT NULL,
	`bloco` varchar(255) NOT NULL,
	`tipo_residuo` enum('reciclavel','organico','rejeito','eletronico','perigoso') NOT NULL,
	`dia_semana` int NOT NULL,
	`horario` varchar(5) NOT NULL,
	`ativo` boolean NOT NULL DEFAULT true,
	`criado_por_id` int NOT NULL,
	`ultima_geracao_data` varchar(10),
	`criado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`atualizado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `regras_recorrencia_coleta_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `relatorios_anuais` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominio_id` int NOT NULL,
	`ano` int NOT NULL,
	`chave_arquivo` varchar(255) NOT NULL,
	`url_arquivo` varchar(512) NOT NULL,
	`gerado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `relatorios_anuais_id` PRIMARY KEY(`id`),
	CONSTRAINT `relatorios_anuais_unique` UNIQUE(`condominio_id`,`ano`)
);
--> statement-breakpoint
CREATE TABLE `resgates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominio_id` int NOT NULL,
	`morador_id` int NOT NULL,
	`recompensa_id` int NOT NULL,
	`pontos_gastos` int NOT NULL,
	`status` enum('solicitado','aprovado','entregue','cancelado') NOT NULL DEFAULT 'solicitado',
	`criado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`atualizado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `resgates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `usuarios` (
	`id` int AUTO_INCREMENT NOT NULL,
	`id_externo` varchar(255) NOT NULL,
	`nome` varchar(255),
	`email` varchar(320),
	`metodo_login` varchar(255),
	`papel` enum('usuario','administrador') NOT NULL DEFAULT 'usuario',
	`criado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`atualizado_em` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`ultimo_acesso` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `usuarios_id` PRIMARY KEY(`id`),
	CONSTRAINT `usuarios_id_externo_unique` UNIQUE(`id_externo`)
);
--> statement-breakpoint
CREATE INDEX `aplicacoes_desconto_condominio_idx` ON `aplicacoes_desconto_podio` (`condominio_id`);--> statement-breakpoint
CREATE INDEX `avaliacoes_condominio_idx` ON `avaliacoes_coleta` (`condominio_id`);--> statement-breakpoint
CREATE INDEX `avaliacoes_morador_idx` ON `avaliacoes_coleta` (`morador_id`);--> statement-breakpoint
CREATE INDEX `avaliacoes_status_idx` ON `avaliacoes_coleta` (`status`);--> statement-breakpoint
CREATE INDEX `campanhas_condominio_idx` ON `campanhas` (`condominio_id`);--> statement-breakpoint
CREATE INDEX `campanhas_periodo_idx` ON `campanhas` (`data_inicio`,`data_fim`);--> statement-breakpoint
CREATE INDEX `certificados_condominio_idx` ON `certificados_sustentabilidade` (`condominio_id`);--> statement-breakpoint
CREATE INDEX `coletas_condominio_idx` ON `coletas` (`condominio_id`);--> statement-breakpoint
CREATE INDEX `coletas_status_idx` ON `coletas` (`status`);--> statement-breakpoint
CREATE INDEX `coletas_agendada_idx` ON `coletas` (`agendada_para`);--> statement-breakpoint
CREATE INDEX `coletas_condominio_agendada_idx` ON `coletas` (`condominio_id`,`agendada_para`);--> statement-breakpoint
CREATE INDEX `coletas_condominio_status_agendada_idx` ON `coletas` (`condominio_id`,`status`,`agendada_para`);--> statement-breakpoint
CREATE INDEX `coletas_condominio_bloco_agendada_idx` ON `coletas` (`condominio_id`,`bloco`,`agendada_para`);--> statement-breakpoint
CREATE INDEX `coletas_pendente_aprovacao_idx` ON `coletas` (`condominio_id`,`pendente_aprovacao_peso`);--> statement-breakpoint
CREATE INDEX `logs_auditoria_condominio_criado_idx` ON `logs_auditoria` (`condominio_id`,`criado_em`);--> statement-breakpoint
CREATE INDEX `logs_auditoria_entidade_idx` ON `logs_auditoria` (`tipo_entidade`,`entidade_id`);--> statement-breakpoint
CREATE INDEX `logs_auditoria_autor_criado_idx` ON `logs_auditoria` (`autor_id`,`criado_em`);--> statement-breakpoint
CREATE INDEX `metas_bloco_condominio_idx` ON `metas_bloco` (`condominio_id`);--> statement-breakpoint
CREATE INDEX `metas_bloco_periodo_idx` ON `metas_bloco` (`data_inicio`,`data_fim`);--> statement-breakpoint
CREATE INDEX `metas_pessoais_condominio_idx` ON `metas_pessoais` (`condominio_id`);--> statement-breakpoint
CREATE INDEX `metas_pessoais_morador_idx` ON `metas_pessoais` (`morador_id`);--> statement-breakpoint
CREATE INDEX `moradores_condominio_idx` ON `moradores` (`condominio_id`);--> statement-breakpoint
CREATE INDEX `notificacoes_destinatario_idx` ON `notificacoes` (`destinatario_id`);--> statement-breakpoint
CREATE INDEX `notificacoes_condominio_idx` ON `notificacoes` (`condominio_id`);--> statement-breakpoint
CREATE INDEX `notificacoes_lidas_usuario_idx` ON `notificacoes_lidas` (`usuario_id`);--> statement-breakpoint
CREATE INDEX `ocorrencias_condominio_idx` ON `ocorrencias` (`condominio_id`);--> statement-breakpoint
CREATE INDEX `ocorrencias_status_idx` ON `ocorrencias` (`status`);--> statement-breakpoint
CREATE INDEX `ocorrencias_condominio_status_criado_idx` ON `ocorrencias` (`condominio_id`,`status`,`criado_em`);--> statement-breakpoint
CREATE INDEX `participantes_campanha_morador_idx` ON `participantes_campanha` (`morador_id`);--> statement-breakpoint
CREATE INDEX `perfis_acesso_condominio_idx` ON `perfis_acesso` (`condominio_id`);--> statement-breakpoint
CREATE INDEX `pessoas_condominio_idx` ON `pessoas` (`condominio_id`);--> statement-breakpoint
CREATE INDEX `recompensas_condominio_idx` ON `recompensas` (`condominio_id`);--> statement-breakpoint
CREATE INDEX `regras_recorrencia_condominio_idx` ON `regras_recorrencia_coleta` (`condominio_id`);--> statement-breakpoint
CREATE INDEX `resgates_morador_idx` ON `resgates` (`morador_id`);--> statement-breakpoint
CREATE INDEX `resgates_condominio_idx` ON `resgates` (`condominio_id`);
CREATE TABLE `avaliacoes_coleta` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`condominio_id` integer NOT NULL,
	`morador_id` integer NOT NULL,
	`coleta_id` integer,
	`nota` integer NOT NULL,
	`mensagem` text NOT NULL,
	`status` text DEFAULT 'nova' NOT NULL,
	`resposta` text,
	`respondido_por_id` integer,
	`respondida_em` integer,
	`criado_em` integer DEFAULT (unixepoch()) NOT NULL,
	`atualizado_em` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `avaliacoes_condominio_idx` ON `avaliacoes_coleta` (`condominio_id`);--> statement-breakpoint
CREATE INDEX `avaliacoes_morador_idx` ON `avaliacoes_coleta` (`morador_id`);--> statement-breakpoint
CREATE INDEX `avaliacoes_status_idx` ON `avaliacoes_coleta` (`status`);--> statement-breakpoint
CREATE TABLE `campanhas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`condominio_id` integer NOT NULL,
	`titulo` text NOT NULL,
	`descricao` text NOT NULL,
	`descricao_meta` text NOT NULL,
	`data_inicio` integer NOT NULL,
	`data_fim` integer NOT NULL,
	`status` text DEFAULT 'planejada' NOT NULL,
	`criado_por_id` integer NOT NULL,
	`criado_em` integer DEFAULT (unixepoch()) NOT NULL,
	`atualizado_em` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `campanhas_condominio_idx` ON `campanhas` (`condominio_id`);--> statement-breakpoint
CREATE INDEX `campanhas_periodo_idx` ON `campanhas` (`data_inicio`,`data_fim`);--> statement-breakpoint
CREATE TABLE `coletas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`condominio_id` integer NOT NULL,
	`morador_id` integer,
	`criado_por_id` integer NOT NULL,
	`coletor_id` integer,
	`tipo_residuo` text NOT NULL,
	`bloco` text NOT NULL,
	`agendada_para` integer NOT NULL,
	`concluida_em` integer,
	`peso_gramas` integer,
	`pontos_concedidos` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'agendada' NOT NULL,
	`observacoes` text,
	`criado_em` integer DEFAULT (unixepoch()) NOT NULL,
	`atualizado_em` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `coletas_condominio_idx` ON `coletas` (`condominio_id`);--> statement-breakpoint
CREATE INDEX `coletas_status_idx` ON `coletas` (`status`);--> statement-breakpoint
CREATE INDEX `coletas_agendada_idx` ON `coletas` (`agendada_para`);--> statement-breakpoint
CREATE INDEX `coletas_condominio_agendada_idx` ON `coletas` (`condominio_id`,`agendada_para`);--> statement-breakpoint
CREATE INDEX `coletas_condominio_status_agendada_idx` ON `coletas` (`condominio_id`,`status`,`agendada_para`);--> statement-breakpoint
CREATE INDEX `coletas_condominio_bloco_agendada_idx` ON `coletas` (`condominio_id`,`bloco`,`agendada_para`);--> statement-breakpoint
CREATE TABLE `condominios` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nome` text NOT NULL,
	`endereco` text,
	`cidade` text,
	`estado` text,
	`quantidade_blocos` integer DEFAULT 1 NOT NULL,
	`ativo` integer DEFAULT true NOT NULL,
	`criado_em` integer DEFAULT (unixepoch()) NOT NULL,
	`atualizado_em` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `guias_descarte` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`condominio_id` integer NOT NULL,
	`tipo_residuo` text NOT NULL,
	`titulo` text NOT NULL,
	`itens_aceitos` text NOT NULL,
	`itens_rejeitados` text NOT NULL,
	`instrucoes` text NOT NULL,
	`publicado` integer DEFAULT true NOT NULL,
	`atualizado_em` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `guias_condominio_residuo_unique` ON `guias_descarte` (`condominio_id`,`tipo_residuo`);--> statement-breakpoint
CREATE TABLE `logs_auditoria` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`condominio_id` integer NOT NULL,
	`autor_id` integer NOT NULL,
	`tipo_entidade` text NOT NULL,
	`entidade_id` integer NOT NULL,
	`acao` text NOT NULL,
	`resumo` text NOT NULL,
	`estado_anterior` text,
	`estado_novo` text,
	`criado_em` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `logs_auditoria_condominio_criado_idx` ON `logs_auditoria` (`condominio_id`,`criado_em`);--> statement-breakpoint
CREATE INDEX `logs_auditoria_entidade_idx` ON `logs_auditoria` (`tipo_entidade`,`entidade_id`);--> statement-breakpoint
CREATE INDEX `logs_auditoria_autor_criado_idx` ON `logs_auditoria` (`autor_id`,`criado_em`);--> statement-breakpoint
CREATE TABLE `metas_bloco` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`condominio_id` integer NOT NULL,
	`bloco` text NOT NULL,
	`titulo` text NOT NULL,
	`meta_kg` integer NOT NULL,
	`data_inicio` integer NOT NULL,
	`data_fim` integer NOT NULL,
	`criado_por_id` integer NOT NULL,
	`ativo` integer DEFAULT true NOT NULL,
	`criado_em` integer DEFAULT (unixepoch()) NOT NULL,
	`atualizado_em` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `metas_bloco_condominio_idx` ON `metas_bloco` (`condominio_id`);--> statement-breakpoint
CREATE INDEX `metas_bloco_periodo_idx` ON `metas_bloco` (`data_inicio`,`data_fim`);--> statement-breakpoint
CREATE TABLE `moradores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`condominio_id` integer NOT NULL,
	`usuario_id` integer,
	`nome` text NOT NULL,
	`email` text,
	`telefone` text,
	`bloco` text NOT NULL,
	`apartamento` text NOT NULL,
	`status` text DEFAULT 'ativo' NOT NULL,
	`pontos` integer DEFAULT 0 NOT NULL,
	`criado_em` integer DEFAULT (unixepoch()) NOT NULL,
	`atualizado_em` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `moradores_condominio_idx` ON `moradores` (`condominio_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `moradores_usuario_unique` ON `moradores` (`usuario_id`);--> statement-breakpoint
CREATE TABLE `notificacoes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`condominio_id` integer NOT NULL,
	`destinatario_id` integer,
	`coleta_id` integer,
	`tipo` text NOT NULL,
	`titulo` text NOT NULL,
	`mensagem` text NOT NULL,
	`lida_em` integer,
	`criado_em` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notificacoes_destinatario_idx` ON `notificacoes` (`destinatario_id`);--> statement-breakpoint
CREATE INDEX `notificacoes_condominio_idx` ON `notificacoes` (`condominio_id`);--> statement-breakpoint
CREATE TABLE `notificacoes_lidas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`notificacao_id` integer NOT NULL,
	`usuario_id` integer NOT NULL,
	`lida_em` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notificacoes_lidas_notificacao_usuario_unique` ON `notificacoes_lidas` (`notificacao_id`,`usuario_id`);--> statement-breakpoint
CREATE INDEX `notificacoes_lidas_usuario_idx` ON `notificacoes_lidas` (`usuario_id`);--> statement-breakpoint
CREATE TABLE `ocorrencias` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`condominio_id` integer NOT NULL,
	`relator_id` integer NOT NULL,
	`bloco` text NOT NULL,
	`tipo_residuo` text NOT NULL,
	`local` text NOT NULL,
	`descricao` text NOT NULL,
	`chave_imagem` text,
	`url_imagem` text,
	`status` text DEFAULT 'aberta' NOT NULL,
	`nota_resolucao` text,
	`resolvido_por_id` integer,
	`resolvida_em` integer,
	`criado_em` integer DEFAULT (unixepoch()) NOT NULL,
	`atualizado_em` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ocorrencias_condominio_idx` ON `ocorrencias` (`condominio_id`);--> statement-breakpoint
CREATE INDEX `ocorrencias_status_idx` ON `ocorrencias` (`status`);--> statement-breakpoint
CREATE INDEX `ocorrencias_condominio_status_criado_idx` ON `ocorrencias` (`condominio_id`,`status`,`criado_em`);--> statement-breakpoint
CREATE TABLE `participantes_campanha` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`campanha_id` integer NOT NULL,
	`morador_id` integer NOT NULL,
	`entrou_em` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `participante_campanha_unique` ON `participantes_campanha` (`campanha_id`,`morador_id`);--> statement-breakpoint
CREATE INDEX `participantes_campanha_morador_idx` ON `participantes_campanha` (`morador_id`);--> statement-breakpoint
CREATE TABLE `perfis_acesso` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`usuario_id` integer NOT NULL,
	`condominio_id` integer NOT NULL,
	`morador_id` integer,
	`papel` text DEFAULT 'morador' NOT NULL,
	`criado_em` integer DEFAULT (unixepoch()) NOT NULL,
	`atualizado_em` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `perfis_acesso_usuario_unique` ON `perfis_acesso` (`usuario_id`);--> statement-breakpoint
CREATE INDEX `perfis_acesso_condominio_idx` ON `perfis_acesso` (`condominio_id`);--> statement-breakpoint
CREATE TABLE `pessoas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`condominio_id` integer NOT NULL,
	`usuario_id` integer,
	`morador_id` integer,
	`nome` text NOT NULL,
	`email` text NOT NULL,
	`telefone` text,
	`bloco` text,
	`apartamento` text,
	`papel` text DEFAULT 'morador' NOT NULL,
	`status_acesso` text DEFAULT 'pendente' NOT NULL,
	`criado_em` integer DEFAULT (unixepoch()) NOT NULL,
	`atualizado_em` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pessoas_condominio_email_unique` ON `pessoas` (`condominio_id`,`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `pessoas_usuario_unique` ON `pessoas` (`usuario_id`);--> statement-breakpoint
CREATE INDEX `pessoas_condominio_idx` ON `pessoas` (`condominio_id`);--> statement-breakpoint
CREATE TABLE `recompensas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`condominio_id` integer NOT NULL,
	`titulo` text NOT NULL,
	`descricao` text NOT NULL,
	`custo_pontos` integer NOT NULL,
	`estoque` integer,
	`ativo` integer DEFAULT true NOT NULL,
	`criado_em` integer DEFAULT (unixepoch()) NOT NULL,
	`atualizado_em` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `recompensas_condominio_idx` ON `recompensas` (`condominio_id`);--> statement-breakpoint
CREATE TABLE `resgates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`condominio_id` integer NOT NULL,
	`morador_id` integer NOT NULL,
	`recompensa_id` integer NOT NULL,
	`pontos_gastos` integer NOT NULL,
	`status` text DEFAULT 'solicitado' NOT NULL,
	`criado_em` integer DEFAULT (unixepoch()) NOT NULL,
	`atualizado_em` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `resgates_morador_idx` ON `resgates` (`morador_id`);--> statement-breakpoint
CREATE INDEX `resgates_condominio_idx` ON `resgates` (`condominio_id`);--> statement-breakpoint
CREATE TABLE `usuarios` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id_externo` text NOT NULL,
	`nome` text,
	`email` text,
	`metodo_login` text,
	`papel` text DEFAULT 'usuario' NOT NULL,
	`criado_em` integer DEFAULT (unixepoch()) NOT NULL,
	`atualizado_em` integer DEFAULT (unixepoch()) NOT NULL,
	`ultimo_acesso` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usuarios_id_externo_unique` ON `usuarios` (`id_externo`);
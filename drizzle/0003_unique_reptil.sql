CREATE TABLE `aplicacoes_desconto_podio` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`condominio_id` integer NOT NULL,
	`morador_id` integer NOT NULL,
	`periodo` text NOT NULL,
	`intervalo_inicio` integer NOT NULL,
	`intervalo_fim` integer NOT NULL,
	`posicao` integer NOT NULL,
	`percentual_aplicado` real NOT NULL,
	`observacao` text,
	`aplicado_por_id` integer NOT NULL,
	`aplicado_em` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `aplicacoes_desconto_condominio_idx` ON `aplicacoes_desconto_podio` (`condominio_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `aplicacoes_desconto_unique` ON `aplicacoes_desconto_podio` (`morador_id`,`periodo`,`intervalo_inicio`);--> statement-breakpoint
CREATE TABLE `certificados_sustentabilidade` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`condominio_id` integer NOT NULL,
	`bloco` text NOT NULL,
	`trimestre` text NOT NULL,
	`peso_kg` real NOT NULL,
	`chave_arquivo` text NOT NULL,
	`url_arquivo` text NOT NULL,
	`gerado_por_id` integer,
	`gerado_em` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `certificados_condominio_idx` ON `certificados_sustentabilidade` (`condominio_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `certificados_unique` ON `certificados_sustentabilidade` (`condominio_id`,`bloco`,`trimestre`);--> statement-breakpoint
CREATE TABLE `metas_pessoais` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`condominio_id` integer NOT NULL,
	`morador_id` integer NOT NULL,
	`meta_kg` real NOT NULL,
	`data_inicio` integer NOT NULL,
	`data_fim` integer NOT NULL,
	`ativo` integer DEFAULT true NOT NULL,
	`criado_em` integer DEFAULT (unixepoch()) NOT NULL,
	`atualizado_em` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `metas_pessoais_condominio_idx` ON `metas_pessoais` (`condominio_id`);--> statement-breakpoint
CREATE INDEX `metas_pessoais_morador_idx` ON `metas_pessoais` (`morador_id`);--> statement-breakpoint
CREATE TABLE `regras_recorrencia_coleta` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`condominio_id` integer NOT NULL,
	`bloco` text NOT NULL,
	`tipo_residuo` text NOT NULL,
	`dia_semana` integer NOT NULL,
	`horario` text NOT NULL,
	`ativo` integer DEFAULT true NOT NULL,
	`criado_por_id` integer NOT NULL,
	`ultima_geracao_data` text,
	`criado_em` integer DEFAULT (unixepoch()) NOT NULL,
	`atualizado_em` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `regras_recorrencia_condominio_idx` ON `regras_recorrencia_coleta` (`condominio_id`);--> statement-breakpoint
CREATE TABLE `relatorios_anuais` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`condominio_id` integer NOT NULL,
	`ano` integer NOT NULL,
	`chave_arquivo` text NOT NULL,
	`url_arquivo` text NOT NULL,
	`gerado_em` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `relatorios_anuais_unique` ON `relatorios_anuais` (`condominio_id`,`ano`);--> statement-breakpoint
ALTER TABLE `coletas` ADD `regra_recorrencia_id` integer;--> statement-breakpoint
ALTER TABLE `coletas` ADD `pendente_aprovacao_peso` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `coletas` ADD `aprovacao_peso_status` text;--> statement-breakpoint
ALTER TABLE `coletas` ADD `aprovacao_peso_por_id` integer;--> statement-breakpoint
ALTER TABLE `coletas` ADD `aprovacao_peso_em` integer;--> statement-breakpoint
CREATE INDEX `coletas_pendente_aprovacao_idx` ON `coletas` (`condominio_id`,`pendente_aprovacao_peso`);--> statement-breakpoint
ALTER TABLE `moradores` ADD `codigo_acesso` text;--> statement-breakpoint
CREATE UNIQUE INDEX `moradores_codigo_acesso_unique` ON `moradores` (`codigo_acesso`);
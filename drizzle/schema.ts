import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const agora = sql`(unixepoch())`;

/** Tabela central de identidade dos usuários autenticados. */
export const usuarios = sqliteTable("usuarios", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  idExterno: text("id_externo").notNull().unique(),
  nome: text("nome"),
  email: text("email"),
  metodoLogin: text("metodo_login"),
  papel: text("papel", { enum: ["usuario", "administrador"] }).default("usuario").notNull(),
  criadoEm: integer("criado_em", { mode: "timestamp" }).default(agora).notNull(),
  atualizadoEm: integer("atualizado_em", { mode: "timestamp" }).default(agora).notNull(),
  ultimoAcesso: integer("ultimo_acesso", { mode: "timestamp" }).default(agora).notNull(),
});

export const condominios = sqliteTable("condominios", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  nome: text("nome").notNull(),
  endereco: text("endereco"),
  cidade: text("cidade"),
  estado: text("estado"),
  quantidadeBlocos: integer("quantidade_blocos").default(1).notNull(),
  ativo: integer("ativo", { mode: "boolean" }).default(true).notNull(),
  /** Percentual de desconto sugerido para o pódio de reciclagem (aplicação manual pelo síndico). */
  descontoPodioMensalPercentual: real("desconto_podio_mensal_percentual"),
  descontoPodioSemestralPercentual: real("desconto_podio_semestral_percentual"),
  descontoPodioAnualPercentual: real("desconto_podio_anual_percentual"),
  criadoEm: integer("criado_em", { mode: "timestamp" }).default(agora).notNull(),
  atualizadoEm: integer("atualizado_em", { mode: "timestamp" }).default(agora).notNull(),
});

export const papeisEco = ["administrador", "coletor", "morador"] as const;
export const statusAcesso = ["pendente", "ativo"] as const;
export const statusMorador = ["ativo", "inativo"] as const;
export const tiposResiduo = ["reciclavel", "organico", "rejeito", "eletronico", "perigoso"] as const;
export const statusColeta = ["agendada", "em_andamento", "concluida", "cancelada", "ocorrencia"] as const;
export const tiposNotificacao = ["coleta_agendada", "coleta_concluida", "lembrete_coleta", "comunicado", "sistema", "certificado_disponivel", "relatorio_anual"] as const;
export const tiposEntidadeAuditoria = ["coleta", "ocorrencia", "desconto_podio"] as const;
export const statusResgate = ["solicitado", "aprovado", "entregue", "cancelado"] as const;
export const statusOcorrencia = ["aberta", "em_analise", "resolvida"] as const;
export const statusCampanha = ["planejada", "ativa", "encerrada"] as const;
export const statusAvaliacao = ["nova", "respondida", "arquivada"] as const;
export const periodosPodio = ["mensal", "semestral", "anual"] as const;
export const statusAprovacaoPeso = ["pendente", "aprovado", "rejeitado"] as const;

export const moradores = sqliteTable("moradores", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  condominioId: integer("condominio_id").notNull(),
  usuarioId: integer("usuario_id"),
  nome: text("nome").notNull(),
  email: text("email"),
  telefone: text("telefone"),
  bloco: text("bloco").notNull(),
  apartamento: text("apartamento").notNull(),
  status: text("status", { enum: statusMorador }).default("ativo").notNull(),
  pontos: integer("pontos").default(0).notNull(),
  /** Código curto único usado para gerar o QR code do apartamento (identificação rápida pelo coletor). */
  codigoAcesso: text("codigo_acesso"),
  criadoEm: integer("criado_em", { mode: "timestamp" }).default(agora).notNull(),
  atualizadoEm: integer("atualizado_em", { mode: "timestamp" }).default(agora).notNull(),
}, (table) => [
  index("moradores_condominio_idx").on(table.condominioId),
  uniqueIndex("moradores_usuario_unique").on(table.usuarioId),
  uniqueIndex("moradores_codigo_acesso_unique").on(table.codigoAcesso),
]);

export const perfisAcesso = sqliteTable("perfis_acesso", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  usuarioId: integer("usuario_id").notNull(),
  condominioId: integer("condominio_id").notNull(),
  moradorId: integer("morador_id"),
  papel: text("papel", { enum: papeisEco }).default("morador").notNull(),
  criadoEm: integer("criado_em", { mode: "timestamp" }).default(agora).notNull(),
  atualizadoEm: integer("atualizado_em", { mode: "timestamp" }).default(agora).notNull(),
}, (table) => [
  uniqueIndex("perfis_acesso_usuario_unique").on(table.usuarioId),
  index("perfis_acesso_condominio_idx").on(table.condominioId),
]);

export const pessoas = sqliteTable("pessoas", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  condominioId: integer("condominio_id").notNull(),
  usuarioId: integer("usuario_id"),
  moradorId: integer("morador_id"),
  nome: text("nome").notNull(),
  email: text("email").notNull(),
  telefone: text("telefone"),
  bloco: text("bloco"),
  apartamento: text("apartamento"),
  papel: text("papel", { enum: papeisEco }).default("morador").notNull(),
  statusAcesso: text("status_acesso", { enum: statusAcesso }).default("pendente").notNull(),
  criadoEm: integer("criado_em", { mode: "timestamp" }).default(agora).notNull(),
  atualizadoEm: integer("atualizado_em", { mode: "timestamp" }).default(agora).notNull(),
}, (table) => [
  uniqueIndex("pessoas_condominio_email_unique").on(table.condominioId, table.email),
  uniqueIndex("pessoas_usuario_unique").on(table.usuarioId),
  index("pessoas_condominio_idx").on(table.condominioId),
]);

export const coletas = sqliteTable("coletas", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  condominioId: integer("condominio_id").notNull(),
  moradorId: integer("morador_id"),
  criadoPorId: integer("criado_por_id").notNull(),
  coletorId: integer("coletor_id"),
  tipoResiduo: text("tipo_residuo", { enum: tiposResiduo }).notNull(),
  bloco: text("bloco").notNull(),
  agendadaPara: integer("agendada_para", { mode: "timestamp" }).notNull(),
  concluidaEm: integer("concluida_em", { mode: "timestamp" }),
  pesoGramas: integer("peso_gramas"),
  pontosConcedidos: integer("pontos_concedidos").default(0).notNull(),
  status: text("status", { enum: statusColeta }).default("agendada").notNull(),
  observacoes: text("observacoes"),
  /** Comprovação fotográfica anexada ao concluir a coleta (proteção antifraude). */
  chaveFoto: text("chave_foto"),
  urlFoto: text("url_foto"),
  /** Regra de recorrência que originou esta coleta automaticamente, quando aplicável. */
  regraRecorrenciaId: integer("regra_recorrencia_id"),
  /** Aprovação dupla: pesos sinalizados como muito acima da média ficam pendentes até um segundo administrador decidir. */
  pendenteAprovacaoPeso: integer("pendente_aprovacao_peso", { mode: "boolean" }).default(false).notNull(),
  aprovacaoPesoStatus: text("aprovacao_peso_status", { enum: statusAprovacaoPeso }),
  aprovacaoPesoPorId: integer("aprovacao_peso_por_id"),
  aprovacaoPesoEm: integer("aprovacao_peso_em", { mode: "timestamp" }),
  criadoEm: integer("criado_em", { mode: "timestamp" }).default(agora).notNull(),
  atualizadoEm: integer("atualizado_em", { mode: "timestamp" }).default(agora).notNull(),
}, (table) => [
  index("coletas_condominio_idx").on(table.condominioId),
  index("coletas_status_idx").on(table.status),
  index("coletas_agendada_idx").on(table.agendadaPara),
  index("coletas_condominio_agendada_idx").on(table.condominioId, table.agendadaPara),
  index("coletas_condominio_status_agendada_idx").on(table.condominioId, table.status, table.agendadaPara),
  index("coletas_condominio_bloco_agendada_idx").on(table.condominioId, table.bloco, table.agendadaPara),
  index("coletas_pendente_aprovacao_idx").on(table.condominioId, table.pendenteAprovacaoPeso),
]);

export const logsAuditoria = sqliteTable("logs_auditoria", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  condominioId: integer("condominio_id").notNull(),
  autorId: integer("autor_id").notNull(),
  tipoEntidade: text("tipo_entidade", { enum: tiposEntidadeAuditoria }).notNull(),
  entidadeId: integer("entidade_id").notNull(),
  acao: text("acao").notNull(),
  resumo: text("resumo").notNull(),
  estadoAnterior: text("estado_anterior"),
  estadoNovo: text("estado_novo"),
  criadoEm: integer("criado_em", { mode: "timestamp" }).default(agora).notNull(),
}, (table) => [
  index("logs_auditoria_condominio_criado_idx").on(table.condominioId, table.criadoEm),
  index("logs_auditoria_entidade_idx").on(table.tipoEntidade, table.entidadeId),
  index("logs_auditoria_autor_criado_idx").on(table.autorId, table.criadoEm),
]);

export const notificacoes = sqliteTable("notificacoes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  condominioId: integer("condominio_id").notNull(),
  destinatarioId: integer("destinatario_id"),
  coletaId: integer("coleta_id"),
  tipo: text("tipo", { enum: tiposNotificacao }).notNull(),
  titulo: text("titulo").notNull(),
  mensagem: text("mensagem").notNull(),
  lidaEm: integer("lida_em", { mode: "timestamp" }),
  criadoEm: integer("criado_em", { mode: "timestamp" }).default(agora).notNull(),
}, (table) => [
  index("notificacoes_destinatario_idx").on(table.destinatarioId),
  index("notificacoes_condominio_idx").on(table.condominioId),
]);

export const notificacoesLidas = sqliteTable("notificacoes_lidas", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  notificacaoId: integer("notificacao_id").notNull(),
  usuarioId: integer("usuario_id").notNull(),
  lidaEm: integer("lida_em", { mode: "timestamp" }).default(agora).notNull(),
}, (table) => [
  uniqueIndex("notificacoes_lidas_notificacao_usuario_unique").on(table.notificacaoId, table.usuarioId),
  index("notificacoes_lidas_usuario_idx").on(table.usuarioId),
]);

export const recompensas = sqliteTable("recompensas", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  condominioId: integer("condominio_id").notNull(),
  titulo: text("titulo").notNull(),
  descricao: text("descricao").notNull(),
  custoPontos: integer("custo_pontos").notNull(),
  estoque: integer("estoque"),
  ativo: integer("ativo", { mode: "boolean" }).default(true).notNull(),
  criadoEm: integer("criado_em", { mode: "timestamp" }).default(agora).notNull(),
  atualizadoEm: integer("atualizado_em", { mode: "timestamp" }).default(agora).notNull(),
}, (table) => [index("recompensas_condominio_idx").on(table.condominioId)]);

export const resgates = sqliteTable("resgates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  condominioId: integer("condominio_id").notNull(),
  moradorId: integer("morador_id").notNull(),
  recompensaId: integer("recompensa_id").notNull(),
  pontosGastos: integer("pontos_gastos").notNull(),
  status: text("status", { enum: statusResgate }).default("solicitado").notNull(),
  criadoEm: integer("criado_em", { mode: "timestamp" }).default(agora).notNull(),
  atualizadoEm: integer("atualizado_em", { mode: "timestamp" }).default(agora).notNull(),
}, (table) => [
  index("resgates_morador_idx").on(table.moradorId),
  index("resgates_condominio_idx").on(table.condominioId),
]);

export const guiasDescarte = sqliteTable("guias_descarte", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  condominioId: integer("condominio_id").notNull(),
  tipoResiduo: text("tipo_residuo", { enum: tiposResiduo }).notNull(),
  titulo: text("titulo").notNull(),
  itensAceitos: text("itens_aceitos").notNull(),
  itensRejeitados: text("itens_rejeitados").notNull(),
  instrucoes: text("instrucoes").notNull(),
  publicado: integer("publicado", { mode: "boolean" }).default(true).notNull(),
  atualizadoEm: integer("atualizado_em", { mode: "timestamp" }).default(agora).notNull(),
}, (table) => [
  uniqueIndex("guias_condominio_residuo_unique").on(table.condominioId, table.tipoResiduo),
]);

export const metasBloco = sqliteTable("metas_bloco", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  condominioId: integer("condominio_id").notNull(),
  bloco: text("bloco").notNull(),
  titulo: text("titulo").notNull(),
  metaKg: integer("meta_kg").notNull(),
  dataInicio: integer("data_inicio", { mode: "timestamp" }).notNull(),
  dataFim: integer("data_fim", { mode: "timestamp" }).notNull(),
  criadoPorId: integer("criado_por_id").notNull(),
  ativo: integer("ativo", { mode: "boolean" }).default(true).notNull(),
  criadoEm: integer("criado_em", { mode: "timestamp" }).default(agora).notNull(),
  atualizadoEm: integer("atualizado_em", { mode: "timestamp" }).default(agora).notNull(),
}, (table) => [
  index("metas_bloco_condominio_idx").on(table.condominioId),
  index("metas_bloco_periodo_idx").on(table.dataInicio, table.dataFim),
]);

export const ocorrencias = sqliteTable("ocorrencias", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  condominioId: integer("condominio_id").notNull(),
  relatorId: integer("relator_id").notNull(),
  bloco: text("bloco").notNull(),
  tipoResiduo: text("tipo_residuo", { enum: tiposResiduo }).notNull(),
  local: text("local").notNull(),
  descricao: text("descricao").notNull(),
  chaveImagem: text("chave_imagem"),
  urlImagem: text("url_imagem"),
  status: text("status", { enum: statusOcorrencia }).default("aberta").notNull(),
  notaResolucao: text("nota_resolucao"),
  resolvidoPorId: integer("resolvido_por_id"),
  resolvidaEm: integer("resolvida_em", { mode: "timestamp" }),
  criadoEm: integer("criado_em", { mode: "timestamp" }).default(agora).notNull(),
  atualizadoEm: integer("atualizado_em", { mode: "timestamp" }).default(agora).notNull(),
}, (table) => [
  index("ocorrencias_condominio_idx").on(table.condominioId),
  index("ocorrencias_status_idx").on(table.status),
  index("ocorrencias_condominio_status_criado_idx").on(table.condominioId, table.status, table.criadoEm),
]);

export const campanhas = sqliteTable("campanhas", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  condominioId: integer("condominio_id").notNull(),
  titulo: text("titulo").notNull(),
  descricao: text("descricao").notNull(),
  descricaoMeta: text("descricao_meta").notNull(),
  dataInicio: integer("data_inicio", { mode: "timestamp" }).notNull(),
  dataFim: integer("data_fim", { mode: "timestamp" }).notNull(),
  status: text("status", { enum: statusCampanha }).default("planejada").notNull(),
  criadoPorId: integer("criado_por_id").notNull(),
  criadoEm: integer("criado_em", { mode: "timestamp" }).default(agora).notNull(),
  atualizadoEm: integer("atualizado_em", { mode: "timestamp" }).default(agora).notNull(),
}, (table) => [
  index("campanhas_condominio_idx").on(table.condominioId),
  index("campanhas_periodo_idx").on(table.dataInicio, table.dataFim),
]);

export const participantesCampanha = sqliteTable("participantes_campanha", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  campanhaId: integer("campanha_id").notNull(),
  moradorId: integer("morador_id").notNull(),
  entrouEm: integer("entrou_em", { mode: "timestamp" }).default(agora).notNull(),
}, (table) => [
  uniqueIndex("participante_campanha_unique").on(table.campanhaId, table.moradorId),
  index("participantes_campanha_morador_idx").on(table.moradorId),
]);

export const avaliacoesColeta = sqliteTable("avaliacoes_coleta", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  condominioId: integer("condominio_id").notNull(),
  moradorId: integer("morador_id").notNull(),
  coletaId: integer("coleta_id"),
  nota: integer("nota").notNull(),
  mensagem: text("mensagem").notNull(),
  status: text("status", { enum: statusAvaliacao }).default("nova").notNull(),
  resposta: text("resposta"),
  respondidoPorId: integer("respondido_por_id"),
  respondidaEm: integer("respondida_em", { mode: "timestamp" }),
  criadoEm: integer("criado_em", { mode: "timestamp" }).default(agora).notNull(),
  atualizadoEm: integer("atualizado_em", { mode: "timestamp" }).default(agora).notNull(),
}, (table) => [
  index("avaliacoes_condominio_idx").on(table.condominioId),
  index("avaliacoes_morador_idx").on(table.moradorId),
  index("avaliacoes_status_idx").on(table.status),
]);

/** Registro definitivo de que o desconto sugerido do pódio foi de fato aplicado pelo síndico (fecha o ciclo do pódio). */
export const aplicacoesDescontoPodio = sqliteTable("aplicacoes_desconto_podio", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  condominioId: integer("condominio_id").notNull(),
  moradorId: integer("morador_id").notNull(),
  periodo: text("periodo", { enum: periodosPodio }).notNull(),
  intervaloInicio: integer("intervalo_inicio", { mode: "timestamp" }).notNull(),
  intervaloFim: integer("intervalo_fim", { mode: "timestamp" }).notNull(),
  posicao: integer("posicao").notNull(),
  percentualAplicado: real("percentual_aplicado").notNull(),
  observacao: text("observacao"),
  aplicadoPorId: integer("aplicado_por_id").notNull(),
  aplicadoEm: integer("aplicado_em", { mode: "timestamp" }).default(agora).notNull(),
}, (table) => [
  index("aplicacoes_desconto_condominio_idx").on(table.condominioId),
  uniqueIndex("aplicacoes_desconto_unique").on(table.moradorId, table.periodo, table.intervaloInicio),
]);

/** Meta pessoal de reciclagem definida pelo próprio morador (mesma lógica de acompanhamento das metas por bloco). */
export const metasPessoais = sqliteTable("metas_pessoais", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  condominioId: integer("condominio_id").notNull(),
  moradorId: integer("morador_id").notNull(),
  metaKg: real("meta_kg").notNull(),
  dataInicio: integer("data_inicio", { mode: "timestamp" }).notNull(),
  dataFim: integer("data_fim", { mode: "timestamp" }).notNull(),
  ativo: integer("ativo", { mode: "boolean" }).default(true).notNull(),
  criadoEm: integer("criado_em", { mode: "timestamp" }).default(agora).notNull(),
  atualizadoEm: integer("atualizado_em", { mode: "timestamp" }).default(agora).notNull(),
}, (table) => [
  index("metas_pessoais_condominio_idx").on(table.condominioId),
  index("metas_pessoais_morador_idx").on(table.moradorId),
]);

/** Regra de coleta recorrente por bloco (ex.: "toda terça, bloco B"), gerando coletas automaticamente. */
export const regrasRecorrenciaColeta = sqliteTable("regras_recorrencia_coleta", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  condominioId: integer("condominio_id").notNull(),
  bloco: text("bloco").notNull(),
  tipoResiduo: text("tipo_residuo", { enum: tiposResiduo }).notNull(),
  /** 0 = domingo ... 6 = sábado. */
  diaSemana: integer("dia_semana").notNull(),
  horario: text("horario").notNull(),
  ativo: integer("ativo", { mode: "boolean" }).default(true).notNull(),
  criadoPorId: integer("criado_por_id").notNull(),
  /** Data (AAAA-MM-DD) da última coleta gerada automaticamente por esta regra, para evitar duplicidade. */
  ultimaGeracaoData: text("ultima_geracao_data"),
  criadoEm: integer("criado_em", { mode: "timestamp" }).default(agora).notNull(),
  atualizadoEm: integer("atualizado_em", { mode: "timestamp" }).default(agora).notNull(),
}, (table) => [
  index("regras_recorrencia_condominio_idx").on(table.condominioId),
]);

/** Certificado trimestral de sustentabilidade gerado em PDF por bloco. */
export const certificadosSustentabilidade = sqliteTable("certificados_sustentabilidade", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  condominioId: integer("condominio_id").notNull(),
  bloco: text("bloco").notNull(),
  trimestre: text("trimestre").notNull(),
  pesoKg: real("peso_kg").notNull(),
  chaveArquivo: text("chave_arquivo").notNull(),
  urlArquivo: text("url_arquivo").notNull(),
  geradoPorId: integer("gerado_por_id"),
  geradoEm: integer("gerado_em", { mode: "timestamp" }).default(agora).notNull(),
}, (table) => [
  index("certificados_condominio_idx").on(table.condominioId),
  uniqueIndex("certificados_unique").on(table.condominioId, table.bloco, table.trimestre),
]);

/** Relatório anual consolidado, gerado e notificado automaticamente ao síndico em janeiro. */
export const relatoriosAnuais = sqliteTable("relatorios_anuais", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  condominioId: integer("condominio_id").notNull(),
  ano: integer("ano").notNull(),
  chaveArquivo: text("chave_arquivo").notNull(),
  urlArquivo: text("url_arquivo").notNull(),
  geradoEm: integer("gerado_em", { mode: "timestamp" }).default(agora).notNull(),
}, (table) => [
  uniqueIndex("relatorios_anuais_unique").on(table.condominioId, table.ano),
]);

export type Usuario = typeof usuarios.$inferSelect;
export type NovoUsuario = typeof usuarios.$inferInsert;
export type PerfilAcesso = typeof perfisAcesso.$inferSelect;
export type Morador = typeof moradores.$inferSelect;
export type Condominio = typeof condominios.$inferSelect;
export type Coleta = typeof coletas.$inferSelect;
export type Pessoa = typeof pessoas.$inferSelect;

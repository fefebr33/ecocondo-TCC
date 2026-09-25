import { sql } from "drizzle-orm";
import {
  boolean,
  datetime,
  double,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/** Data e hora com milissegundos, sempre gravada em UTC (a conexão usa time_zone = '+00:00'). */
const dataHora = (nome: string) => datetime(nome, { mode: "date", fsp: 3 });
const agora = sql`(CURRENT_TIMESTAMP(3))`;

/** Tabela central de identidade dos usuários autenticados. */
export const usuarios = mysqlTable("usuarios", {
  id: int("id").autoincrement().primaryKey(),
  idExterno: varchar("id_externo", { length: 255 }).notNull().unique(),
  nome: varchar("nome", { length: 255 }),
  email: varchar("email", { length: 320 }),
  metodoLogin: varchar("metodo_login", { length: 255 }),
  papel: mysqlEnum("papel", ["usuario", "administrador"]).default("usuario").notNull(),
  criadoEm: dataHora("criado_em").default(agora).notNull(),
  atualizadoEm: dataHora("atualizado_em").default(agora).notNull(),
  ultimoAcesso: dataHora("ultimo_acesso").default(agora).notNull(),
});

export const condominios = mysqlTable("condominios", {
  id: int("id").autoincrement().primaryKey(),
  nome: varchar("nome", { length: 255 }).notNull(),
  endereco: varchar("endereco", { length: 500 }),
  cidade: varchar("cidade", { length: 255 }),
  estado: varchar("estado", { length: 2 }),
  quantidadeBlocos: int("quantidade_blocos").default(1).notNull(),
  ativo: boolean("ativo").default(true).notNull(),
  criadoEm: dataHora("criado_em").default(agora).notNull(),
  atualizadoEm: dataHora("atualizado_em").default(agora).notNull(),
});

/** Só dois perfis: o próprio morador registra a reciclagem na estação de pesagem (tablet + balança), sem coletor. */
export const papeisEco = ["administrador", "morador"] as const;
export const statusAcesso = ["pendente", "ativo"] as const;
export const statusMorador = ["ativo", "inativo"] as const;
export const tiposResiduo = ["reciclavel", "organico", "rejeito", "eletronico", "perigoso"] as const;
export const statusColeta = ["agendada", "em_andamento", "concluida", "cancelada", "ocorrencia"] as const;
export const tiposNotificacao = ["coleta_agendada", "coleta_concluida", "lembrete_coleta", "comunicado", "sistema", "certificado_disponivel", "relatorio_anual"] as const;
/** "desconto_podio" fica só para os registros antigos, de quando o pódio dava desconto na taxa condominial. */
export const tiposEntidadeAuditoria = ["coleta", "ocorrencia", "desconto_podio", "premio_podio", "estacao"] as const;
export const statusResgate = ["solicitado", "aprovado", "entregue", "cancelado"] as const;
export const statusOcorrencia = ["aberta", "em_analise", "resolvida"] as const;
export const statusCampanha = ["planejada", "ativa", "encerrada"] as const;
export const statusAvaliacao = ["nova", "respondida", "arquivada"] as const;
export const periodosPodio = ["mensal", "semestral", "anual"] as const;
export const statusAprovacaoPeso = ["pendente", "aprovado", "rejeitado"] as const;

export const moradores = mysqlTable("moradores", {
  id: int("id").autoincrement().primaryKey(),
  condominioId: int("condominio_id").notNull(),
  usuarioId: int("usuario_id"),
  nome: varchar("nome", { length: 255 }).notNull(),
  email: varchar("email", { length: 320 }),
  telefone: varchar("telefone", { length: 255 }),
  bloco: varchar("bloco", { length: 255 }).notNull(),
  apartamento: varchar("apartamento", { length: 255 }).notNull(),
  status: mysqlEnum("status", statusMorador).default("ativo").notNull(),
  pontos: int("pontos").default(0).notNull(),
  /** Código curto único usado para gerar o QR code do apartamento (identificação rápida pelo administrador). */
  codigoAcesso: varchar("codigo_acesso", { length: 32 }),
  /** Código temporário (6 dígitos, uso único) gerado no app do morador para se identificar na estação de pesagem. */
  codigoEstacao: varchar("codigo_estacao", { length: 8 }),
  codigoEstacaoExpiraEm: dataHora("codigo_estacao_expira_em"),
  /** No pódio, mostra "Morador do bloco X" em vez do nome, mesmo se ficar entre os três primeiros. */
  ocultarNomeNoPodio: boolean("ocultar_nome_no_podio").default(false).notNull(),
  criadoEm: dataHora("criado_em").default(agora).notNull(),
  atualizadoEm: dataHora("atualizado_em").default(agora).notNull(),
}, (table) => [
  index("moradores_condominio_idx").on(table.condominioId),
  uniqueIndex("moradores_usuario_unique").on(table.usuarioId),
  uniqueIndex("moradores_codigo_acesso_unique").on(table.codigoAcesso),
  uniqueIndex("moradores_codigo_estacao_unique").on(table.condominioId, table.codigoEstacao),
]);

export const perfisAcesso = mysqlTable("perfis_acesso", {
  id: int("id").autoincrement().primaryKey(),
  usuarioId: int("usuario_id").notNull(),
  condominioId: int("condominio_id").notNull(),
  moradorId: int("morador_id"),
  papel: mysqlEnum("papel", papeisEco).default("morador").notNull(),
  criadoEm: dataHora("criado_em").default(agora).notNull(),
  atualizadoEm: dataHora("atualizado_em").default(agora).notNull(),
}, (table) => [
  uniqueIndex("perfis_acesso_usuario_unique").on(table.usuarioId),
  index("perfis_acesso_condominio_idx").on(table.condominioId),
]);

export const pessoas = mysqlTable("pessoas", {
  id: int("id").autoincrement().primaryKey(),
  condominioId: int("condominio_id").notNull(),
  usuarioId: int("usuario_id"),
  moradorId: int("morador_id"),
  nome: varchar("nome", { length: 255 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  telefone: varchar("telefone", { length: 255 }),
  bloco: varchar("bloco", { length: 255 }),
  apartamento: varchar("apartamento", { length: 255 }),
  papel: mysqlEnum("papel", papeisEco).default("morador").notNull(),
  statusAcesso: mysqlEnum("status_acesso", statusAcesso).default("pendente").notNull(),
  criadoEm: dataHora("criado_em").default(agora).notNull(),
  atualizadoEm: dataHora("atualizado_em").default(agora).notNull(),
}, (table) => [
  uniqueIndex("pessoas_condominio_email_unique").on(table.condominioId, table.email),
  uniqueIndex("pessoas_usuario_unique").on(table.usuarioId),
  index("pessoas_condominio_idx").on(table.condominioId),
]);

export const coletas = mysqlTable("coletas", {
  id: int("id").autoincrement().primaryKey(),
  condominioId: int("condominio_id").notNull(),
  moradorId: int("morador_id"),
  criadoPorId: int("criado_por_id").notNull(),
  /** Coletor atribuído: só existe em coletas antigas, de antes da retirada do perfil coletor (mantido para o histórico). */
  coletorId: int("coletor_id"),
  /** Estação de pesagem (tablet) onde o próprio morador registrou a reciclagem; nulo nas coletas agendadas pela administração. */
  estacaoId: int("estacao_id"),
  /** Quem de fato confirmou a conclusão (pode ser diferente do coletor atribuído); usado na aprovação dupla de peso. */
  concluidoPorId: int("concluido_por_id"),
  tipoResiduo: mysqlEnum("tipo_residuo", tiposResiduo).notNull(),
  bloco: varchar("bloco", { length: 255 }).notNull(),
  agendadaPara: dataHora("agendada_para").notNull(),
  concluidaEm: dataHora("concluida_em"),
  pesoGramas: int("peso_gramas"),
  pontosConcedidos: int("pontos_concedidos").default(0).notNull(),
  status: mysqlEnum("status", statusColeta).default("agendada").notNull(),
  observacoes: text("observacoes"),
  /** Comprovação fotográfica anexada ao concluir a coleta (proteção antifraude). */
  chaveFoto: varchar("chave_foto", { length: 255 }),
  urlFoto: varchar("url_foto", { length: 512 }),
  /** Regra de recorrência que originou esta coleta automaticamente, quando aplicável. */
  regraRecorrenciaId: int("regra_recorrencia_id"),
  /** Aprovação dupla: pesos sinalizados como muito acima da média ficam pendentes até um segundo administrador decidir. */
  pendenteAprovacaoPeso: boolean("pendente_aprovacao_peso").default(false).notNull(),
  aprovacaoPesoStatus: mysqlEnum("aprovacao_peso_status", statusAprovacaoPeso),
  aprovacaoPesoPorId: int("aprovacao_peso_por_id"),
  aprovacaoPesoEm: dataHora("aprovacao_peso_em"),
  criadoEm: dataHora("criado_em").default(agora).notNull(),
  atualizadoEm: dataHora("atualizado_em").default(agora).notNull(),
}, (table) => [
  index("coletas_condominio_idx").on(table.condominioId),
  index("coletas_status_idx").on(table.status),
  index("coletas_agendada_idx").on(table.agendadaPara),
  index("coletas_condominio_agendada_idx").on(table.condominioId, table.agendadaPara),
  index("coletas_condominio_status_agendada_idx").on(table.condominioId, table.status, table.agendadaPara),
  index("coletas_condominio_bloco_agendada_idx").on(table.condominioId, table.bloco, table.agendadaPara),
  index("coletas_pendente_aprovacao_idx").on(table.condominioId, table.pendenteAprovacaoPeso),
  index("coletas_morador_concluida_idx").on(table.moradorId, table.concluidaEm),
]);

export const logsAuditoria = mysqlTable("logs_auditoria", {
  id: int("id").autoincrement().primaryKey(),
  condominioId: int("condominio_id").notNull(),
  autorId: int("autor_id").notNull(),
  tipoEntidade: mysqlEnum("tipo_entidade", tiposEntidadeAuditoria).notNull(),
  entidadeId: int("entidade_id").notNull(),
  acao: varchar("acao", { length: 255 }).notNull(),
  resumo: text("resumo").notNull(),
  estadoAnterior: text("estado_anterior"),
  estadoNovo: text("estado_novo"),
  criadoEm: dataHora("criado_em").default(agora).notNull(),
}, (table) => [
  index("logs_auditoria_condominio_criado_idx").on(table.condominioId, table.criadoEm),
  index("logs_auditoria_entidade_idx").on(table.tipoEntidade, table.entidadeId),
  index("logs_auditoria_autor_criado_idx").on(table.autorId, table.criadoEm),
]);

export const notificacoes = mysqlTable("notificacoes", {
  id: int("id").autoincrement().primaryKey(),
  condominioId: int("condominio_id").notNull(),
  destinatarioId: int("destinatario_id"),
  coletaId: int("coleta_id"),
  tipo: mysqlEnum("tipo", tiposNotificacao).notNull(),
  titulo: varchar("titulo", { length: 255 }).notNull(),
  mensagem: text("mensagem").notNull(),
  lidaEm: dataHora("lida_em"),
  criadoEm: dataHora("criado_em").default(agora).notNull(),
}, (table) => [
  index("notificacoes_destinatario_idx").on(table.destinatarioId),
  index("notificacoes_condominio_idx").on(table.condominioId),
]);

export const notificacoesLidas = mysqlTable("notificacoes_lidas", {
  id: int("id").autoincrement().primaryKey(),
  notificacaoId: int("notificacao_id").notNull(),
  usuarioId: int("usuario_id").notNull(),
  lidaEm: dataHora("lida_em").default(agora).notNull(),
}, (table) => [
  uniqueIndex("notificacoes_lidas_notificacao_usuario_unique").on(table.notificacaoId, table.usuarioId),
  index("notificacoes_lidas_usuario_idx").on(table.usuarioId),
]);

export const recompensas = mysqlTable("recompensas", {
  id: int("id").autoincrement().primaryKey(),
  condominioId: int("condominio_id").notNull(),
  titulo: varchar("titulo", { length: 255 }).notNull(),
  descricao: text("descricao").notNull(),
  custoPontos: int("custo_pontos").notNull(),
  estoque: int("estoque"),
  ativo: boolean("ativo").default(true).notNull(),
  criadoEm: dataHora("criado_em").default(agora).notNull(),
  atualizadoEm: dataHora("atualizado_em").default(agora).notNull(),
}, (table) => [index("recompensas_condominio_idx").on(table.condominioId)]);

export const resgates = mysqlTable("resgates", {
  id: int("id").autoincrement().primaryKey(),
  condominioId: int("condominio_id").notNull(),
  moradorId: int("morador_id").notNull(),
  recompensaId: int("recompensa_id").notNull(),
  pontosGastos: int("pontos_gastos").notNull(),
  status: mysqlEnum("status", statusResgate).default("solicitado").notNull(),
  criadoEm: dataHora("criado_em").default(agora).notNull(),
  atualizadoEm: dataHora("atualizado_em").default(agora).notNull(),
}, (table) => [
  index("resgates_morador_idx").on(table.moradorId),
  index("resgates_condominio_idx").on(table.condominioId),
]);

export const guiasDescarte = mysqlTable("guias_descarte", {
  id: int("id").autoincrement().primaryKey(),
  condominioId: int("condominio_id").notNull(),
  tipoResiduo: mysqlEnum("tipo_residuo", tiposResiduo).notNull(),
  titulo: varchar("titulo", { length: 255 }).notNull(),
  itensAceitos: text("itens_aceitos").notNull(),
  itensRejeitados: text("itens_rejeitados").notNull(),
  instrucoes: text("instrucoes").notNull(),
  publicado: boolean("publicado").default(true).notNull(),
  atualizadoEm: dataHora("atualizado_em").default(agora).notNull(),
}, (table) => [
  uniqueIndex("guias_condominio_residuo_unique").on(table.condominioId, table.tipoResiduo),
]);

export const metasBloco = mysqlTable("metas_bloco", {
  id: int("id").autoincrement().primaryKey(),
  condominioId: int("condominio_id").notNull(),
  bloco: varchar("bloco", { length: 255 }).notNull(),
  titulo: varchar("titulo", { length: 255 }).notNull(),
  metaKg: int("meta_kg").notNull(),
  dataInicio: dataHora("data_inicio").notNull(),
  dataFim: dataHora("data_fim").notNull(),
  criadoPorId: int("criado_por_id").notNull(),
  ativo: boolean("ativo").default(true).notNull(),
  criadoEm: dataHora("criado_em").default(agora).notNull(),
  atualizadoEm: dataHora("atualizado_em").default(agora).notNull(),
}, (table) => [
  index("metas_bloco_condominio_idx").on(table.condominioId),
  index("metas_bloco_periodo_idx").on(table.dataInicio, table.dataFim),
]);

export const ocorrencias = mysqlTable("ocorrencias", {
  id: int("id").autoincrement().primaryKey(),
  condominioId: int("condominio_id").notNull(),
  relatorId: int("relator_id").notNull(),
  bloco: varchar("bloco", { length: 255 }).notNull(),
  tipoResiduo: mysqlEnum("tipo_residuo", tiposResiduo).notNull(),
  local: varchar("local", { length: 255 }).notNull(),
  descricao: text("descricao").notNull(),
  chaveImagem: varchar("chave_imagem", { length: 255 }),
  urlImagem: varchar("url_imagem", { length: 512 }),
  status: mysqlEnum("status", statusOcorrencia).default("aberta").notNull(),
  notaResolucao: text("nota_resolucao"),
  resolvidoPorId: int("resolvido_por_id"),
  resolvidaEm: dataHora("resolvida_em"),
  criadoEm: dataHora("criado_em").default(agora).notNull(),
  atualizadoEm: dataHora("atualizado_em").default(agora).notNull(),
}, (table) => [
  index("ocorrencias_condominio_idx").on(table.condominioId),
  index("ocorrencias_status_idx").on(table.status),
  index("ocorrencias_condominio_status_criado_idx").on(table.condominioId, table.status, table.criadoEm),
]);

export const campanhas = mysqlTable("campanhas", {
  id: int("id").autoincrement().primaryKey(),
  condominioId: int("condominio_id").notNull(),
  titulo: varchar("titulo", { length: 255 }).notNull(),
  descricao: text("descricao").notNull(),
  descricaoMeta: text("descricao_meta").notNull(),
  dataInicio: dataHora("data_inicio").notNull(),
  dataFim: dataHora("data_fim").notNull(),
  status: mysqlEnum("status", statusCampanha).default("planejada").notNull(),
  criadoPorId: int("criado_por_id").notNull(),
  criadoEm: dataHora("criado_em").default(agora).notNull(),
  atualizadoEm: dataHora("atualizado_em").default(agora).notNull(),
}, (table) => [
  index("campanhas_condominio_idx").on(table.condominioId),
  index("campanhas_periodo_idx").on(table.dataInicio, table.dataFim),
]);

export const participantesCampanha = mysqlTable("participantes_campanha", {
  id: int("id").autoincrement().primaryKey(),
  campanhaId: int("campanha_id").notNull(),
  moradorId: int("morador_id").notNull(),
  entrouEm: dataHora("entrou_em").default(agora).notNull(),
}, (table) => [
  uniqueIndex("participante_campanha_unique").on(table.campanhaId, table.moradorId),
  index("participantes_campanha_morador_idx").on(table.moradorId),
]);

export const avaliacoesColeta = mysqlTable("avaliacoes_coleta", {
  id: int("id").autoincrement().primaryKey(),
  condominioId: int("condominio_id").notNull(),
  moradorId: int("morador_id").notNull(),
  coletaId: int("coleta_id"),
  nota: int("nota").notNull(),
  mensagem: text("mensagem").notNull(),
  status: mysqlEnum("status", statusAvaliacao).default("nova").notNull(),
  resposta: text("resposta"),
  respondidoPorId: int("respondido_por_id"),
  respondidaEm: dataHora("respondida_em"),
  criadoEm: dataHora("criado_em").default(agora).notNull(),
  atualizadoEm: dataHora("atualizado_em").default(agora).notNull(),
}, (table) => [
  index("avaliacoes_condominio_idx").on(table.condominioId),
  index("avaliacoes_morador_idx").on(table.moradorId),
  index("avaliacoes_status_idx").on(table.status),
]);

/** Tablet com balança instalado ao lado das lixeiras, cadastrado pelo administrador. Só um tablet pareado (token válido) registra reciclagem. */
export const estacoesPesagem = mysqlTable("estacoes_pesagem", {
  id: int("id").autoincrement().primaryKey(),
  condominioId: int("condominio_id").notNull(),
  nome: varchar("nome", { length: 255 }).notNull(),
  local: varchar("local", { length: 255 }).notNull(),
  /** SHA-256 do código de pareamento; o código em si só aparece uma vez, para o administrador. */
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  ativo: boolean("ativo").default(true).notNull(),
  criadoPorId: int("criado_por_id").notNull(),
  ultimoUsoEm: dataHora("ultimo_uso_em"),
  criadoEm: dataHora("criado_em").default(agora).notNull(),
  atualizadoEm: dataHora("atualizado_em").default(agora).notNull(),
}, (table) => [
  index("estacoes_condominio_idx").on(table.condominioId),
  uniqueIndex("estacoes_token_unique").on(table.tokenHash),
]);

/** Prêmio que o administrador define para cada posição (1º a 3º) de cada período do pódio. */
export const premiosPodio = mysqlTable("premios_podio", {
  id: int("id").autoincrement().primaryKey(),
  condominioId: int("condominio_id").notNull(),
  periodo: mysqlEnum("periodo", periodosPodio).notNull(),
  posicao: int("posicao").notNull(),
  titulo: varchar("titulo", { length: 255 }).notNull(),
  descricao: text("descricao"),
  atualizadoEm: dataHora("atualizado_em").default(agora).notNull(),
}, (table) => [
  uniqueIndex("premios_podio_unique").on(table.condominioId, table.periodo, table.posicao),
]);

/** Registro de que o prêmio do pódio foi entregue ao morador (fecha o ciclo do pódio). Os descontos antigos foram migrados para cá. */
export const entregasPremioPodio = mysqlTable("entregas_premio_podio", {
  id: int("id").autoincrement().primaryKey(),
  condominioId: int("condominio_id").notNull(),
  moradorId: int("morador_id").notNull(),
  periodo: mysqlEnum("periodo", periodosPodio).notNull(),
  intervaloInicio: dataHora("intervalo_inicio").notNull(),
  intervaloFim: dataHora("intervalo_fim").notNull(),
  posicao: int("posicao").notNull(),
  premio: varchar("premio", { length: 255 }).notNull(),
  observacao: text("observacao"),
  entreguePorId: int("entregue_por_id").notNull(),
  entregueEm: dataHora("entregue_em").default(agora).notNull(),
}, (table) => [
  index("entregas_premio_condominio_idx").on(table.condominioId),
  uniqueIndex("entregas_premio_unique").on(table.moradorId, table.periodo, table.intervaloInicio),
]);

/** Meta pessoal de reciclagem definida pelo próprio morador (mesma lógica de acompanhamento das metas por bloco). */
export const metasPessoais = mysqlTable("metas_pessoais", {
  id: int("id").autoincrement().primaryKey(),
  condominioId: int("condominio_id").notNull(),
  moradorId: int("morador_id").notNull(),
  metaKg: double("meta_kg").notNull(),
  dataInicio: dataHora("data_inicio").notNull(),
  dataFim: dataHora("data_fim").notNull(),
  ativo: boolean("ativo").default(true).notNull(),
  criadoEm: dataHora("criado_em").default(agora).notNull(),
  atualizadoEm: dataHora("atualizado_em").default(agora).notNull(),
}, (table) => [
  index("metas_pessoais_condominio_idx").on(table.condominioId),
  index("metas_pessoais_morador_idx").on(table.moradorId),
]);

/** Regra de coleta recorrente por bloco (ex.: "toda terça, bloco B"), gerando coletas automaticamente. */
export const regrasRecorrenciaColeta = mysqlTable("regras_recorrencia_coleta", {
  id: int("id").autoincrement().primaryKey(),
  condominioId: int("condominio_id").notNull(),
  bloco: varchar("bloco", { length: 255 }).notNull(),
  tipoResiduo: mysqlEnum("tipo_residuo", tiposResiduo).notNull(),
  /** 0 = domingo ... 6 = sábado. */
  diaSemana: int("dia_semana").notNull(),
  horario: varchar("horario", { length: 5 }).notNull(),
  ativo: boolean("ativo").default(true).notNull(),
  criadoPorId: int("criado_por_id").notNull(),
  /** Data (AAAA-MM-DD) da última coleta gerada automaticamente por esta regra, para evitar duplicidade. */
  ultimaGeracaoData: varchar("ultima_geracao_data", { length: 10 }),
  criadoEm: dataHora("criado_em").default(agora).notNull(),
  atualizadoEm: dataHora("atualizado_em").default(agora).notNull(),
}, (table) => [
  index("regras_recorrencia_condominio_idx").on(table.condominioId),
]);

/** Certificado trimestral de sustentabilidade gerado em PDF por bloco. */
export const certificadosSustentabilidade = mysqlTable("certificados_sustentabilidade", {
  id: int("id").autoincrement().primaryKey(),
  condominioId: int("condominio_id").notNull(),
  bloco: varchar("bloco", { length: 255 }).notNull(),
  trimestre: varchar("trimestre", { length: 7 }).notNull(),
  pesoKg: double("peso_kg").notNull(),
  chaveArquivo: varchar("chave_arquivo", { length: 255 }).notNull(),
  urlArquivo: varchar("url_arquivo", { length: 512 }).notNull(),
  geradoPorId: int("gerado_por_id"),
  geradoEm: dataHora("gerado_em").default(agora).notNull(),
}, (table) => [
  index("certificados_condominio_idx").on(table.condominioId),
  uniqueIndex("certificados_unique").on(table.condominioId, table.bloco, table.trimestre),
]);

/** Relatório anual consolidado, gerado e notificado automaticamente ao síndico em janeiro. */
export const relatoriosAnuais = mysqlTable("relatorios_anuais", {
  id: int("id").autoincrement().primaryKey(),
  condominioId: int("condominio_id").notNull(),
  ano: int("ano").notNull(),
  chaveArquivo: varchar("chave_arquivo", { length: 255 }).notNull(),
  urlArquivo: varchar("url_arquivo", { length: 512 }).notNull(),
  geradoEm: dataHora("gerado_em").default(agora).notNull(),
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
export type EstacaoPesagem = typeof estacoesPesagem.$inferSelect;

import type { tiposNotificacao } from "../drizzle/schema";
import { canAccessRoute, type EcoRole } from "./permissions";

export type TipoNotificacao = (typeof tiposNotificacao)[number];

/** Nome de cada tipo de notificação, como aparece em Configurações > Notificações. */
export const rotuloTipoNotificacao: Record<TipoNotificacao, string> = {
  coleta_agendada: "Agendamento (registros antigos)",
  coleta_concluida: "Descarte registrado",
  lembrete_coleta: "Lembrete (registros antigos)",
  comunicado: "Comunicados da administração",
  sistema: "Avisos do sistema",
  certificado_disponivel: "Certificado disponível",
  relatorio_anual: "Relatório anual",
  solicitacao_criada: "Solicitação (registros antigos)",
  codigo_estacao: "Código da estação gerado",
  pesagem_registrada: "Pesagem registrada",
  pontos_ganhos: "Pontos creditados",
  coleta_reprovada: "Descarte reprovado",
  pontos_estornados: "Pontos estornados",
  revisao_administrativa: "Descarte aprovado",
  premio_resgatado: "Prêmio resgatado",
  resgate_atualizado: "Andamento do resgate",
  resgate_recusado: "Resgate recusado",
  novo_premio: "Novo prêmio no catálogo",
  cadastro_alterado: "Cadastro alterado",
  premio_podio: "Prêmio do pódio",
  nova_coleta: "Novo descarte (registros antigos)",
  aguardando_pesagem: "Aguardando pesagem (registros antigos)",
  peso_suspeito: "Peso fora do padrão",
  pontos_pendentes: "Descarte aguardando aprovação",
  novo_resgate: "Novo pedido de resgate",
  estoque_baixo: "Estoque baixo",
  sem_estoque: "Prêmio sem estoque",
  novo_cadastro: "Novo cadastro",
  falha_operacional: "Falha operacional",
  auditoria_aberta: "Auditoria aberta",
  auditoria_concluida: "Auditoria concluída",
  pontos_zerados: "Pontos zerados",
  pontos_ajustados: "Ajuste de pontos",
  descarte_aguardando_aprovacao: "Descarte aguardando aprovação",
  descarte_aprovado_ia: "Descarte aprovado pela IA",
  descarte_revertido: "Aprovação revertida",
  penalidade_aplicada: "Medida administrativa aplicada",
  penalidade_encerrada: "Fim de suspensão",
  irregularidade_detectada: "Irregularidade apontada pela IA",
  nova_campanha: "Nova campanha",
  campanha_participacao: "Participação em campanha",
  campanha_atualizada: "Campanha alterada",
  campanha_pausada: "Campanha pausada ou retomada",
  campanha_encerrando: "Campanha perto do fim",
  campanha_encerrada: "Campanha encerrada",
  nova_ocorrencia: "Nova ocorrência ou denúncia",
  ocorrencia_atualizada: "Andamento da ocorrência",
  novo_feedback: "Novo feedback",
  feedback_respondido: "Feedback respondido",
  adesivos_solicitados: "Pedido de adesivos",
  adesivos_entregues: "Adesivos entregues",
  adesivos_acabando: "Adesivos acabando",
  aviso_geral: "Aviso geral da administração",
  adesivo_cancelado: "Adesivo cancelado",
  auditoria_pendente: "Auditoria esperando parecer",
};

/** Grupos da tela "Quem recebe cada aviso" (Configurações), para a lista não ficar uma coluna só de interruptores. */
export const gruposNotificacao = [
  {
    id: "descartes",
    titulo: "Descartes e pontos",
    tipos: [
      "pesagem_registrada",
      "descarte_aprovado_ia",
      "revisao_administrativa",
      "pontos_ganhos",
      "coleta_reprovada",
      "descarte_revertido",
      "descarte_aguardando_aprovacao",
      "irregularidade_detectada",
      "peso_suspeito",
      "coleta_concluida",
      "pontos_zerados",
      "pontos_ajustados",
    ],
  },
  {
    id: "auditoria",
    titulo: "Auditoria e medidas",
    tipos: [
      "auditoria_aberta",
      "auditoria_pendente",
      "auditoria_concluida",
      "penalidade_aplicada",
      "penalidade_encerrada",
    ],
  },
  {
    id: "premios",
    titulo: "Prêmios, resgates e pódio",
    tipos: [
      "premio_resgatado",
      "resgate_atualizado",
      "resgate_recusado",
      "novo_premio",
      "premio_podio",
      "novo_resgate",
      "estoque_baixo",
      "sem_estoque",
    ],
  },
  {
    id: "comunidade",
    titulo: "Campanhas, ocorrências e feedback",
    tipos: [
      "nova_campanha",
      "campanha_participacao",
      "campanha_atualizada",
      "campanha_pausada",
      "campanha_encerrando",
      "campanha_encerrada",
      "nova_ocorrencia",
      "ocorrencia_atualizada",
      "novo_feedback",
      "feedback_respondido",
    ],
  },
  {
    id: "adesivos",
    titulo: "Adesivos QR",
    tipos: [
      "adesivos_solicitados",
      "adesivos_entregues",
      "adesivos_acabando",
      "adesivo_cancelado",
    ],
  },
  {
    id: "sistema",
    titulo: "Avisos gerais, cadastro e sistema",
    tipos: [
      "aviso_geral",
      "comunicado",
      "cadastro_alterado",
      "novo_cadastro",
      "certificado_disponivel",
      "relatorio_anual",
      "falha_operacional",
    ],
  },
] as const satisfies ReadonlyArray<{
  id: string;
  titulo: string;
  tipos: readonly TipoNotificacao[];
}>;

/** Tipos que cada perfil pode receber hoje (os de registros antigos, do tempo do agendamento, ficam de fora da configuração). */
export const tiposPorPerfil: Record<EcoRole, TipoNotificacao[]> = {
  // "codigo_estacao", "pontos_pendentes" e "pontos_estornados" não são mais enviados: cada descarte gera um aviso ao registrar e um na decisão.
  morador: [
    "pesagem_registrada",
    "descarte_aprovado_ia",
    "revisao_administrativa",
    "pontos_ganhos",
    "coleta_reprovada",
    "descarte_revertido",
    "auditoria_aberta",
    "auditoria_concluida",
    "penalidade_aplicada",
    "penalidade_encerrada",
    "premio_resgatado",
    "resgate_atualizado",
    "resgate_recusado",
    "novo_premio",
    "premio_podio",
    "pontos_zerados",
    "pontos_ajustados",
    "cadastro_alterado",
    "nova_campanha",
    "campanha_participacao",
    "campanha_atualizada",
    "campanha_pausada",
    "campanha_encerrando",
    "campanha_encerrada",
    "ocorrencia_atualizada",
    "feedback_respondido",
    "adesivos_entregues",
    "adesivos_acabando",
    "adesivo_cancelado",
    "aviso_geral",
    "comunicado",
    "certificado_disponivel",
  ],
  administrador: [
    "descarte_aguardando_aprovacao",
    "irregularidade_detectada",
    "peso_suspeito",
    "coleta_concluida",
    "coleta_reprovada",
    "descarte_revertido",
    "auditoria_aberta",
    "auditoria_pendente",
    "auditoria_concluida",
    "penalidade_aplicada",
    "penalidade_encerrada",
    "pontos_ajustados",
    "nova_ocorrencia",
    "novo_feedback",
    "adesivos_solicitados",
    "campanha_participacao",
    "campanha_encerrando",
    "campanha_encerrada",
    "novo_resgate",
    "estoque_baixo",
    "sem_estoque",
    "novo_cadastro",
    "pontos_zerados",
    "falha_operacional",
    "relatorio_anual",
    "aviso_geral",
    "comunicado",
  ],
};

/**
 * Para onde a notificação leva ao ser tocada: direto no descarte, no extrato, nos resgates etc.
 * Só devolve páginas que o perfil de quem recebeu pode abrir.
 */
export function destinoDaNotificacao(
  notificacao: { tipo: string; coletaId: number | null },
  papel: EcoRole
): { href: string; rotulo: string } | null {
  const doDescarte = notificacao.coletaId
    ? {
        href: `/descartes?id=${notificacao.coletaId}`,
        rotulo: `Abrir o descarte nº ${notificacao.coletaId}`,
      }
    : { href: "/descartes", rotulo: "Ir para Descartes" };
  const porTipo: Record<string, { href: string; rotulo: string } | null> = {
    coleta_concluida: doDescarte,
    pesagem_registrada: doDescarte,
    coleta_reprovada: doDescarte,
    revisao_administrativa: doDescarte,
    auditoria_aberta: doDescarte,
    auditoria_concluida: doDescarte,
    auditoria_pendente: doDescarte,
    peso_suspeito: doDescarte,
    pontos_pendentes: doDescarte,
    descarte_aguardando_aprovacao: doDescarte,
    coleta_agendada: doDescarte,
    lembrete_coleta: doDescarte,
    solicitacao_criada: doDescarte,
    nova_coleta: doDescarte,
    aguardando_pesagem: doDescarte,
    codigo_estacao: { href: "/descartes", rotulo: "Ver o código da estação" },
    pontos_ganhos:
      papel === "morador"
        ? { href: "/engajamento#extrato", rotulo: "Ver o extrato de pontos" }
        : doDescarte,
    pontos_estornados:
      papel === "morador"
        ? { href: "/engajamento#extrato", rotulo: "Ver o extrato de pontos" }
        : doDescarte,
    pontos_zerados:
      papel === "morador"
        ? { href: "/engajamento#extrato", rotulo: "Ver o extrato de pontos" }
        : { href: "/engajamento", rotulo: "Ir para Engajamento" },
    pontos_ajustados:
      papel === "morador"
        ? { href: "/engajamento#extrato", rotulo: "Ver o extrato de pontos" }
        : { href: "/moradores", rotulo: "Ver moradores" },
    premio_resgatado: {
      href: "/engajamento#resgates",
      rotulo: "Ver meus resgates",
    },
    resgate_atualizado: {
      href: "/engajamento#resgates",
      rotulo: "Ver meus resgates",
    },
    resgate_recusado: { href: "/engajamento", rotulo: "Ver o catálogo" },
    novo_premio: { href: "/engajamento", rotulo: "Ver o catálogo" },
    novo_resgate: {
      href: "/engajamento#pedidos",
      rotulo: "Ver os pedidos de resgate",
    },
    estoque_baixo: { href: "/engajamento", rotulo: "Ver o catálogo" },
    sem_estoque: { href: "/engajamento", rotulo: "Ver o catálogo" },
    premio_podio: { href: "/podio", rotulo: "Ver o pódio" },
    novo_cadastro: { href: "/pessoas", rotulo: "Ver pessoas e acessos" },
    cadastro_alterado: { href: "/dashboard", rotulo: "Ir para o meu painel" },
    falha_operacional: {
      href: "/configuracoes#estacoes",
      rotulo: "Ver as estações",
    },
    certificado_disponivel: { href: "/ambiental", rotulo: "Ver certificados" },
    descarte_aprovado_ia: doDescarte,
    descarte_revertido: doDescarte,
    irregularidade_detectada: doDescarte,
    penalidade_aplicada:
      papel === "morador"
        ? { href: "/dashboard#medidas", rotulo: "Ver no meu relatório" }
        : notificacao.coletaId
          ? doDescarte
          : { href: "/moradores", rotulo: "Ver moradores" },
    penalidade_encerrada:
      papel === "morador"
        ? { href: "/dashboard#medidas", rotulo: "Ver no meu relatório" }
        : { href: "/moradores", rotulo: "Ver moradores" },
    nova_campanha: { href: "/comunidade", rotulo: "Ver as campanhas" },
    campanha_participacao: { href: "/comunidade", rotulo: "Ver as campanhas" },
    campanha_atualizada: { href: "/comunidade", rotulo: "Ver as campanhas" },
    campanha_pausada: { href: "/comunidade", rotulo: "Ver as campanhas" },
    campanha_encerrando: { href: "/comunidade", rotulo: "Ver as campanhas" },
    campanha_encerrada: { href: "/comunidade", rotulo: "Ver as campanhas" },
    nova_ocorrencia: {
      href: "/ambiental#ocorrencias",
      rotulo: "Analisar a ocorrência",
    },
    ocorrencia_atualizada: {
      href: "/ambiental#ocorrencias",
      rotulo: "Ver a ocorrência",
    },
    novo_feedback: { href: "/comunidade#feedback", rotulo: "Ver o feedback" },
    feedback_respondido: {
      href: "/comunidade#feedback",
      rotulo: "Ver a resposta",
    },
    adesivos_solicitados: {
      href: "/adesivos",
      rotulo: "Ver os pedidos de adesivos",
    },
    adesivos_entregues: { href: "/adesivos", rotulo: "Ver meus adesivos" },
    adesivos_acabando: { href: "/adesivos", rotulo: "Pedir mais adesivos" },
    adesivo_cancelado: { href: "/adesivos", rotulo: "Ver meus adesivos" },
    relatorio_anual: { href: "/relatorios", rotulo: "Ver relatórios" },
  };
  const destino = porTipo[notificacao.tipo] ?? null;
  if (!destino) return null;
  const rota = destino.href.split(/[?#]/)[0];
  return canAccessRoute(papel, rota) ? destino : null;
}

/** Assuntos dos avisos gerais enviados pela administração. */
export const categoriasAviso = [
  "geral",
  "regras",
  "manutencao",
  "coleta",
  "evento",
  "seguranca",
] as const;
export const rotuloCategoriaAviso: Record<
  (typeof categoriasAviso)[number],
  string
> = {
  geral: "Aviso geral",
  regras: "Regras do programa",
  manutencao: "Manutenção",
  coleta: "Coleta e descarte",
  evento: "Evento",
  seguranca: "Segurança",
};
export const rotuloPublicoAviso: Record<
  "todos" | "moradores" | "administradores",
  string
> = {
  todos: "Todos",
  moradores: "Só moradores",
  administradores: "Só administradores",
};

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
};

/** Tipos que cada perfil pode receber hoje (os de registros antigos, do tempo do agendamento, ficam de fora da configuração). */
export const tiposPorPerfil: Record<EcoRole, TipoNotificacao[]> = {
  // "codigo_estacao", "pontos_pendentes" e "pontos_estornados" não são mais enviados: cada descarte gera um aviso ao registrar e um na decisão.
  morador: ["pesagem_registrada", "revisao_administrativa", "pontos_ganhos", "coleta_reprovada", "auditoria_aberta", "auditoria_concluida", "premio_resgatado", "resgate_atualizado", "resgate_recusado", "novo_premio", "premio_podio", "pontos_zerados", "pontos_ajustados", "cadastro_alterado", "comunicado", "certificado_disponivel"],
  administrador: ["descarte_aguardando_aprovacao", "peso_suspeito", "coleta_concluida", "coleta_reprovada", "auditoria_aberta", "auditoria_concluida", "novo_resgate", "estoque_baixo", "sem_estoque", "novo_cadastro", "pontos_zerados", "falha_operacional", "relatorio_anual", "comunicado"],
};

/**
 * Para onde a notificação leva ao ser tocada: direto no descarte, no extrato, nos resgates etc.
 * Só devolve páginas que o perfil de quem recebeu pode abrir.
 */
export function destinoDaNotificacao(notificacao: { tipo: string; coletaId: number | null }, papel: EcoRole): { href: string; rotulo: string } | null {
  const doDescarte = notificacao.coletaId ? { href: `/descartes?id=${notificacao.coletaId}`, rotulo: `Abrir o descarte nº ${notificacao.coletaId}` } : { href: "/descartes", rotulo: "Ir para Descartes" };
  const porTipo: Record<string, { href: string; rotulo: string } | null> = {
    coleta_concluida: doDescarte, pesagem_registrada: doDescarte, coleta_reprovada: doDescarte, revisao_administrativa: doDescarte,
    auditoria_aberta: doDescarte, auditoria_concluida: doDescarte, peso_suspeito: doDescarte, pontos_pendentes: doDescarte, descarte_aguardando_aprovacao: doDescarte,
    coleta_agendada: doDescarte, lembrete_coleta: doDescarte, solicitacao_criada: doDescarte, nova_coleta: doDescarte, aguardando_pesagem: doDescarte,
    codigo_estacao: { href: "/descartes", rotulo: "Ver o código da estação" },
    pontos_ganhos: papel === "morador" ? { href: "/engajamento#extrato", rotulo: "Ver o extrato de pontos" } : doDescarte,
    pontos_estornados: papel === "morador" ? { href: "/engajamento#extrato", rotulo: "Ver o extrato de pontos" } : doDescarte,
    pontos_zerados: papel === "morador" ? { href: "/engajamento#extrato", rotulo: "Ver o extrato de pontos" } : { href: "/engajamento", rotulo: "Ir para Engajamento" },
    pontos_ajustados: { href: "/engajamento#extrato", rotulo: "Ver o extrato de pontos" },
    premio_resgatado: { href: "/engajamento#resgates", rotulo: "Ver meus resgates" },
    resgate_atualizado: { href: "/engajamento#resgates", rotulo: "Ver meus resgates" },
    resgate_recusado: { href: "/engajamento", rotulo: "Ver o catálogo" },
    novo_premio: { href: "/engajamento", rotulo: "Ver o catálogo" },
    novo_resgate: { href: "/engajamento#pedidos", rotulo: "Ver os pedidos de resgate" },
    estoque_baixo: { href: "/engajamento", rotulo: "Ver o catálogo" },
    sem_estoque: { href: "/engajamento", rotulo: "Ver o catálogo" },
    premio_podio: { href: "/podio", rotulo: "Ver o pódio" },
    novo_cadastro: { href: "/pessoas", rotulo: "Ver pessoas e acessos" },
    cadastro_alterado: { href: "/dashboard", rotulo: "Ir para o meu painel" },
    falha_operacional: { href: "/configuracoes#estacoes", rotulo: "Ver as estações" },
    certificado_disponivel: { href: "/ambiental", rotulo: "Ver certificados" },
    relatorio_anual: { href: "/relatorios", rotulo: "Ver relatórios" },
  };
  const destino = porTipo[notificacao.tipo] ?? null;
  if (!destino) return null;
  const rota = destino.href.split(/[?#]/)[0];
  return canAccessRoute(papel, rota) ? destino : null;
}

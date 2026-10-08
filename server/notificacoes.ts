import { and, eq } from "drizzle-orm";
import {
  condominios,
  notificacoes,
  perfisAcesso,
  preferenciasNotificacao,
  tiposNotificacao,
} from "../drizzle/schema";
import { getDb } from "./db";

type TipoNotificacao = (typeof tiposNotificacao)[number];

type DadosNotificacao = {
  condominioId: number;
  tipo: TipoNotificacao;
  titulo: string;
  mensagem: string;
  coletaId?: number | null;
};

/** Tipos que sempre chegam, qualquer que seja a configuração (a pessoa precisa saber: afetam pontos ou são casos graves). */
export const NOTIFICACOES_OBRIGATORIAS: TipoNotificacao[] = [
  "coleta_reprovada",
  "pontos_estornados",
  "auditoria_aberta",
  "auditoria_concluida",
  "pontos_zerados",
  "pontos_ajustados",
  "falha_operacional",
  "cadastro_alterado",
  "descarte_revertido",
  "penalidade_aplicada",
  "penalidade_encerrada",
  "aviso_geral",
  "auditoria_pendente",
  "adesivo_cancelado",
];

/** O perfil do destinatário recebe este tipo de notificação neste condomínio? (O administrador configura em Configurações.) */
async function perfilRecebe(
  db: any,
  destinatarioId: number,
  condominioId: number,
  tipo: TipoNotificacao
) {
  if (NOTIFICACOES_OBRIGATORIAS.includes(tipo)) return true;
  const [perfil] = await db
    .select({ papel: perfisAcesso.papel })
    .from(perfisAcesso)
    .where(eq(perfisAcesso.usuarioId, destinatarioId))
    .limit(1);
  if (!perfil) return true;
  const [preferencia] = await db
    .select({ ativo: preferenciasNotificacao.ativo })
    .from(preferenciasNotificacao)
    .where(
      and(
        eq(preferenciasNotificacao.condominioId, condominioId),
        eq(preferenciasNotificacao.papel, perfil.papel),
        eq(preferenciasNotificacao.tipo, tipo)
      )
    )
    .limit(1);
  return preferencia ? Boolean(preferencia.ativo) : true;
}

/**
 * Notificação para uma pessoa (morador ou administrador). Sem usuário vinculado (morador sem login), não há a quem avisar.
 * Respeita o que o administrador definiu para o perfil da pessoa em Configurações > Notificações.
 */
export async function notificarUsuario(
  db: any,
  destinatarioId: number | null | undefined,
  dados: DadosNotificacao
) {
  if (!destinatarioId) return;
  if (!(await perfilRecebe(db, destinatarioId, dados.condominioId, dados.tipo)))
    return;
  await db
    .insert(notificacoes)
    .values({
      condominioId: dados.condominioId,
      destinatarioId,
      coletaId: dados.coletaId ?? null,
      tipo: dados.tipo,
      titulo: dados.titulo.slice(0, 255),
      mensagem: dados.mensagem,
    });
}

/** Notificação para cada administrador do condomínio; `exceto` pula quem fez a ação (ele já sabe o que fez). */
export async function notificarAdministradores(
  db: any,
  dados: DadosNotificacao,
  exceto?: number | null
) {
  const administradores = await db
    .select({ usuarioId: perfisAcesso.usuarioId })
    .from(perfisAcesso)
    .where(
      and(
        eq(perfisAcesso.condominioId, dados.condominioId),
        eq(perfisAcesso.papel, "administrador")
      )
    );
  for (const administrador of administradores as Array<{ usuarioId: number }>) {
    if (exceto && administrador.usuarioId === exceto) continue;
    await notificarUsuario(db, administrador.usuarioId, dados);
  }
}

/**
 * Aviso para todos do condomínio (uma linha só, sem destinatário): aparece para cada pessoa do público escolhido, e a leitura
 * de cada um fica em notificacoes_lidas (assim a administração vê quem visualizou).
 */
export async function notificarTodos(
  db: any,
  dados: DadosNotificacao & {
    publico?: "todos" | "moradores" | "administradores";
    categoria?: string | null;
    importante?: boolean;
    autorId?: number | null;
  }
) {
  const [inserida] = await db
    .insert(notificacoes)
    .values({
      condominioId: dados.condominioId,
      destinatarioId: null,
      coletaId: dados.coletaId ?? null,
      tipo: dados.tipo,
      titulo: dados.titulo.slice(0, 255),
      mensagem: dados.mensagem,
      publico: dados.publico ?? "todos",
      categoria: dados.categoria ?? null,
      importante: dados.importante ?? false,
      autorId: dados.autorId ?? null,
    })
    .$returningId();
  return inserida.id as number;
}

/**
 * Falha operacional (rotina agendada que quebrou, tablet bloqueado etc.): avisa os administradores de todos os condomínios.
 * Nunca lança erro, para não esconder a falha original.
 */
export async function notificarFalhaOperacional(
  titulo: string,
  detalhe: string,
  condominioId?: number
) {
  try {
    const db = await getDb();
    const alvos = condominioId
      ? [{ id: condominioId }]
      : await db.select({ id: condominios.id }).from(condominios);
    for (const alvo of alvos) {
      await notificarAdministradores(db, {
        condominioId: alvo.id,
        tipo: "falha_operacional",
        titulo,
        mensagem: detalhe.slice(0, 1000),
      });
    }
  } catch (error) {
    console.error(
      "[Notificações] não foi possível avisar a falha operacional:",
      error
    );
  }
}

import type { Request, Response } from "express";
import { and, eq, gte, inArray, lt, lte } from "drizzle-orm";
import { coletas, notificacoes, moradores } from "../../drizzle/schema";
import { getDb } from "../db";
import { residuoNaFrase } from "@shared/rotulos";
import { reminderRecipients } from "../dominio/regrasLembrete";
import { exigirAdministrador } from "../_core/acesso";
import { notificarAdministradores } from "../notificacoes";

/** Depois deste tempo sem conclusão, a coleta agendada vira "aguardando pesagem" para a administração. */
export const HORAS_PARA_AGUARDANDO_PESAGEM = 2;

/** Cria uma única notificação de lembrete para cada destinatário nas 24h anteriores à coleta. */
export async function runCollectionReminders() {
  const db = await getDb();
  const agora = new Date();
  const amanha = new Date(agora.getTime() + 24 * 60 * 60 * 1000);
  const proximas = await db.select().from(coletas).where(and(eq(coletas.status, "agendada"), gte(coletas.agendadaPara, agora), lte(coletas.agendadaPara, amanha)));
  let lembretesCriados = 0;

  for (const coleta of proximas) {
    const moradorVinculado = coleta.moradorId ? await db.select({ usuarioId: moradores.usuarioId }).from(moradores).where(eq(moradores.id, coleta.moradorId)).limit(1) : [];
    const existentes = await db.select({ destinatarioId: notificacoes.destinatarioId }).from(notificacoes).where(and(eq(notificacoes.coletaId, coleta.id), eq(notificacoes.tipo, "lembrete_coleta")));
    const destinatarios = reminderRecipients({ residentUserId: moradorVinculado[0]?.usuarioId ?? null, alreadyNotifiedUserIds: existentes.map((item) => item.destinatarioId).filter((id): id is number => id !== null) });
    for (const destinatarioId of destinatarios) {
      await db.insert(notificacoes).values({ condominioId: coleta.condominioId, destinatarioId, coletaId: coleta.id, tipo: "lembrete_coleta", titulo: "Lembrete de coleta", mensagem: `A coleta de ${residuoNaFrase[coleta.tipoResiduo]} do bloco ${coleta.bloco} está programada para as próximas 24 horas.` });
      lembretesCriados += 1;
    }
  }

  // Coletas cuja hora já passou e que ainda não foram pesadas: um único aviso por coleta aos administradores.
  const limite = new Date(agora.getTime() - HORAS_PARA_AGUARDANDO_PESAGEM * 60 * 60 * 1000);
  const atrasadas = await db.select().from(coletas).where(and(inArray(coletas.status, ["agendada", "em_andamento"]), lt(coletas.agendadaPara, limite)));
  let avisosAtraso = 0;
  for (const coleta of atrasadas) {
    const jaAvisado = await db.select({ id: notificacoes.id }).from(notificacoes).where(and(eq(notificacoes.coletaId, coleta.id), eq(notificacoes.tipo, "aguardando_pesagem"))).limit(1);
    if (jaAvisado[0]) continue;
    await notificarAdministradores(db, { condominioId: coleta.condominioId, coletaId: coleta.id, tipo: "aguardando_pesagem", titulo: "Coleta aguardando pesagem", mensagem: `A coleta nº ${coleta.id} de ${residuoNaFrase[coleta.tipoResiduo]} (bloco ${coleta.bloco}) estava marcada para ${coleta.agendadaPara.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" })} e ainda não foi concluída. Conclua com o peso ou cancele informando o motivo.` });
    avisosAtraso += 1;
  }

  return { evaluatedCollections: proximas.length, remindersCreated: lembretesCriados, overdueWarnings: avisosAtraso };
}

/** Endpoint manual para disparar os lembretes (apenas administradores). */
export async function sendCollectionReminders(req: Request, res: Response) {
  try {
    if (!(await exigirAdministrador(req, res))) return;
    const resultado = await runCollectionReminders();
    return res.json({ ok: true, ...resultado });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "collection-reminder-failed", timestamp: new Date().toISOString() });
  }
}

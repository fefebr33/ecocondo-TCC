import type { Request, Response } from "express";
import { and, eq, gte, lte } from "drizzle-orm";
import { coletas, notificacoes, moradores } from "../../drizzle/schema";
import { getDb } from "../db";
import { reminderRecipients } from "../dominio/regrasLembrete";
import { exigirAdministrador } from "../_core/acesso";

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
    const destinatarios = reminderRecipients({ residentUserId: moradorVinculado[0]?.usuarioId ?? null, collectorUserId: coleta.coletorId, alreadyNotifiedUserIds: existentes.map((item) => item.destinatarioId).filter((id): id is number => id !== null) });
    for (const destinatarioId of destinatarios) {
      await db.insert(notificacoes).values({ condominioId: coleta.condominioId, destinatarioId, coletaId: coleta.id, tipo: "lembrete_coleta", titulo: "Lembrete de coleta", mensagem: `A coleta de ${coleta.tipoResiduo} do bloco ${coleta.bloco} está programada para as próximas 24 horas.` });
      lembretesCriados += 1;
    }
  }

  return { evaluatedCollections: proximas.length, remindersCreated: lembretesCriados };
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

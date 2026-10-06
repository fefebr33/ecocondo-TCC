import { and, eq, gte, lte } from "drizzle-orm";
import { coletas, notificacoes } from "../drizzle/schema";
import { residuoNaFrase } from "@shared/rotulos";
import { notificarAdministradores } from "./notificacoes";
import { plural } from "@shared/plural";

const DIA_MS = 24 * 60 * 60 * 1000;
/** Depois de quanto tempo sem parecer a auditoria vira lembrete para a administração (e de quanto em quanto tempo ele se repete). */
export const LEMBRETE_AUDITORIA_HORAS = 24;

/**
 * Rotina: lembra os administradores das auditorias abertas há mais de um dia sem parecer (no máximo um lembrete por dia
 * para cada descarte), dizendo há quanto tempo está parada e o que falta fazer.
 */
export async function lembrarAuditoriasParadas(db: any, agora = new Date()) {
  const limite = new Date(agora.getTime() - LEMBRETE_AUDITORIA_HORAS * 60 * 60 * 1000);
  const paradas: Array<typeof coletas.$inferSelect> = await db.select().from(coletas).where(and(eq(coletas.aprovacaoPesoStatus, "auditoria"), lte(coletas.auditoriaAbertaEm, limite)));
  let enviados = 0;
  for (const coleta of paradas) {
    const [recente] = await db.select({ id: notificacoes.id }).from(notificacoes).where(and(eq(notificacoes.coletaId, coleta.id), eq(notificacoes.tipo, "auditoria_pendente"), gte(notificacoes.criadoEm, limite))).limit(1);
    if (recente) continue;
    const dias = Math.max(1, Math.floor((agora.getTime() - (coleta.auditoriaAbertaEm ?? agora).getTime()) / DIA_MS));
    const kg = ((coleta.pesoGramas ?? 0) / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
    await notificarAdministradores(db, {
      condominioId: coleta.condominioId,
      coletaId: coleta.id,
      tipo: "auditoria_pendente",
      titulo: `Auditoria parada há ${plural(dias, "dia", "dias")}: descarte nº ${coleta.id}`,
      mensagem: `O descarte nº ${coleta.id} (${kg} kg de ${residuoNaFrase[coleta.tipoResiduo]}, bloco ${coleta.bloco}) está em auditoria há ${plural(dias, "dia", "dias")} sem parecer. Motivo da auditoria: ${coleta.motivoAuditoria ?? "não informado"}. Enquanto isso, os pontos do morador ficam parados. Conclua em Descartes > Em auditoria.`,
    });
    enviados += 1;
  }
  return enviados;
}

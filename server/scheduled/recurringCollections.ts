import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { coletas, regrasRecorrenciaColeta } from "../../drizzle/schema";
import { getDb } from "../db";
import { chaveDataGeracao, calcularAgendamento, deveGerarColetaHoje } from "../dominio/regrasRecorrencia";
import { exigirAdministrador } from "../_core/acesso";

/** Gera automaticamente as coletas do dia para cada regra de recorrência ativa cujo dia da semana bate com hoje. */
export async function runRecurringCollections(dataReferencia = new Date()) {
  const db = await getDb();
  const regras = await db.select().from(regrasRecorrenciaColeta).where(eq(regrasRecorrenciaColeta.ativo, true));
  let geradas = 0;

  for (const regra of regras) {
    if (!deveGerarColetaHoje(regra, dataReferencia)) continue;
    const agendadaPara = calcularAgendamento(regra, dataReferencia);
    await db.insert(coletas).values({
      condominioId: regra.condominioId,
      criadoPorId: regra.criadoPorId,
      tipoResiduo: regra.tipoResiduo,
      bloco: regra.bloco,
      agendadaPara,
      regraRecorrenciaId: regra.id,
      observacoes: "Coleta gerada automaticamente por regra de recorrência.",
    });
    await db.update(regrasRecorrenciaColeta).set({ ultimaGeracaoData: chaveDataGeracao(dataReferencia), atualizadoEm: new Date() }).where(eq(regrasRecorrenciaColeta.id, regra.id));
    geradas += 1;
  }

  return { evaluatedRules: regras.length, collectionsCreated: geradas };
}

/** Endpoint manual para forçar a verificação/geração das coletas recorrentes do dia. */
export async function sendRecurringCollectionsCheck(req: Request, res: Response) {
  try {
    if (!(await exigirAdministrador(req, res))) return;
    const resultado = await runRecurringCollections();
    return res.json({ ok: true, ...resultado });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "recurring-collections-failed", timestamp: new Date().toISOString() });
  }
}

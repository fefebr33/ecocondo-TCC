import type { Request, Response } from "express";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { coletas, regrasRecorrenciaColeta } from "../../drizzle/schema";
import { getDb } from "../db";
import { chaveDataGeracao, proximaOcorrenciaParaGerar } from "../dominio/regrasRecorrencia";
import { exigirAdministrador } from "../_core/acesso";

/**
 * Gera as coletas das regras de recorrência ativas com até um dia de antecedência (roda a cada hora).
 * A marcação da regra e a criação da coleta ficam na mesma transação e são condicionais: duas execuções simultâneas não duplicam a coleta.
 */
export async function runRecurringCollections(agora = new Date()) {
  const db = await getDb();
  const regras = await db.select().from(regrasRecorrenciaColeta).where(eq(regrasRecorrenciaColeta.ativo, true));
  let geradas = 0;

  for (const regra of regras) {
    const agendadaPara = proximaOcorrenciaParaGerar(regra, agora);
    if (!agendadaPara) continue;
    const chave = chaveDataGeracao(agendadaPara);
    const criada = db.transaction((tx) => {
      const marcada = tx.update(regrasRecorrenciaColeta)
        .set({ ultimaGeracaoData: chave, atualizadoEm: new Date() })
        .where(and(eq(regrasRecorrenciaColeta.id, regra.id), or(isNull(regrasRecorrenciaColeta.ultimaGeracaoData), lt(regrasRecorrenciaColeta.ultimaGeracaoData, chave))))
        .returning({ id: regrasRecorrenciaColeta.id }).all();
      if (!marcada.length) return false;
      tx.insert(coletas).values({
        condominioId: regra.condominioId,
        criadoPorId: regra.criadoPorId,
        tipoResiduo: regra.tipoResiduo,
        bloco: regra.bloco,
        agendadaPara,
        regraRecorrenciaId: regra.id,
        observacoes: "Coleta gerada automaticamente por regra de recorrência.",
      }).run();
      return true;
    });
    if (criada) geradas += 1;
  }

  return { evaluatedRules: regras.length, collectionsCreated: geradas };
}

/** Endpoint manual para forçar a verificação/geração das coletas recorrentes. */
export async function sendRecurringCollectionsCheck(req: Request, res: Response) {
  try {
    if (!(await exigirAdministrador(req, res))) return;
    const resultado = await runRecurringCollections();
    return res.json({ ok: true, ...resultado });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "recurring-collections-failed", timestamp: new Date().toISOString() });
  }
}

import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  moradores,
  movimentacoesPontos,
  tiposMovimentacaoPontos,
} from "../drizzle/schema";
import type { MovimentacaoPontos } from "../drizzle/schema";

type TipoMovimentacao = (typeof tiposMovimentacaoPontos)[number];

/** O extrato já tem esta movimentação (a mesma coleta pontuando ou o mesmo resgate sendo debitado duas vezes). */
export class MovimentacaoDuplicadaError extends Error {}

function ehDuplicidade(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const registro = error as { code?: string; errno?: number; cause?: unknown };
  return (
    registro.code === "ER_DUP_ENTRY" ||
    registro.errno === 1062 ||
    ehDuplicidade(registro.cause)
  );
}

/**
 * Lança uma entrada (pontos > 0) ou saída (pontos < 0) no saldo do morador e grava a linha do extrato com o saldo depois dela.
 * Deve rodar dentro de uma transação (db.transaction), para saldo e extrato mudarem juntos.
 * Com `exigirSaldo`, a saída só acontece se o saldo cobrir o valor (devolve null quando não cobre, sem mexer em nada).
 */
export async function movimentarPontos(
  tx: any,
  dados: {
    condominioId: number;
    moradorId: number;
    tipo: TipoMovimentacao;
    pontos: number;
    descricao: string;
    autorId?: number | null;
    coletaId?: number | null;
    resgateId?: number | null;
    /** Revisão do descarte (coletas.revisao): depois de uma reversão para nova avaliação, o mesmo descarte pode pontuar de novo. */
    revisaoColeta?: number;
    penalidadeId?: number | null;
    exigirSaldo?: boolean;
  }
) {
  if (!Number.isInteger(dados.pontos) || dados.pontos === 0)
    throw new Error(
      "Movimentação de pontos precisa de um valor inteiro diferente de zero."
    );
  const condicoes = [eq(moradores.id, dados.moradorId)];
  if (dados.exigirSaldo && dados.pontos < 0)
    condicoes.push(gte(moradores.pontos, -dados.pontos));
  const [resultado] = await tx
    .update(moradores)
    .set({
      pontos: sql`${moradores.pontos} + ${dados.pontos}`,
      atualizadoEm: new Date(),
    })
    .where(and(...condicoes));
  if (!resultado.affectedRows) {
    if (dados.exigirSaldo) return null;
    throw new Error("Morador não encontrado para movimentar pontos.");
  }
  const [saldo] = await tx
    .select({ pontos: moradores.pontos })
    .from(moradores)
    .where(eq(moradores.id, dados.moradorId))
    .limit(1);
  try {
    await tx.insert(movimentacoesPontos).values({
      condominioId: dados.condominioId,
      moradorId: dados.moradorId,
      tipo: dados.tipo,
      pontos: dados.pontos,
      saldoApos: saldo.pontos,
      coletaId: dados.coletaId ?? null,
      resgateId: dados.resgateId ?? null,
      revisaoColeta: dados.revisaoColeta ?? 0,
      penalidadeId: dados.penalidadeId ?? null,
      descricao: dados.descricao.slice(0, 255),
      autorId: dados.autorId ?? null,
    });
  } catch (error) {
    // O índice único do extrato recusou: lançar dentro da transação desfaz a mudança de saldo feita acima.
    if (ehDuplicidade(error))
      throw new MovimentacaoDuplicadaError(
        "Esta movimentação de pontos já foi registrada."
      );
    throw error;
  }
  return saldo.pontos as number;
}

/** Extrato do morador, do mais recente para o mais antigo. */
export async function extratoDoMorador(
  db: any,
  moradorId: number,
  limite = 100
): Promise<MovimentacaoPontos[]> {
  return db
    .select()
    .from(movimentacoesPontos)
    .where(eq(movimentacoesPontos.moradorId, moradorId))
    .orderBy(desc(movimentacoesPontos.criadoEm), desc(movimentacoesPontos.id))
    .limit(limite);
}

/** Moradores cujo saldo gravado não bate com a soma do extrato (deveria voltar sempre vazio). */
export async function saldosInconsistentes(db: any, condominioId?: number) {
  const filtro = condominioId
    ? sql`WHERE m.condominio_id = ${condominioId}`
    : sql``;
  const [linhas] = await db.execute(sql`
    SELECT m.id AS moradorId, m.nome AS nome, m.pontos AS saldo, COALESCE(SUM(p.pontos), 0) AS somaExtrato
    FROM moradores m LEFT JOIN movimentacoes_pontos p ON p.morador_id = m.id
    ${filtro}
    GROUP BY m.id, m.nome, m.pontos
    HAVING m.pontos <> COALESCE(SUM(p.pontos), 0)`);
  return (
    linhas as Array<{
      moradorId: number;
      nome: string;
      saldo: number;
      somaExtrato: number | string;
    }>
  ).map(linha => ({ ...linha, somaExtrato: Number(linha.somaExtrato) }));
}

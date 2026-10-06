import { afterAll, describe, expect, it, vi } from "vitest";

// Banco MySQL temporário e exclusivo deste arquivo, para simular um banco com pontos e resgates antigos recebendo o extrato.
vi.hoisted(() => {
  const endereco = new URL(
    process.env.DATABASE_URL || "mysql://root@127.0.0.1:3306/ecocondo"
  );
  endereco.pathname = `/ecocondo_teste_extrato_${process.pid}_${Date.now()}`;
  process.env.DATABASE_URL = endereco.toString();
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/mysql2/migrator";
import {
  abrirConexao,
  apagarBanco,
  fecharDb,
  getDb,
  prepararBanco,
  separarNomeDoBanco,
  urlDoBanco,
} from "./db";
import { mysqlDisponivelParaTestes } from "./testes/mysqlTeste";
import { saldosInconsistentes } from "./pontos";

const mysqlDisponivel = await mysqlDisponivelParaTestes();
const describeComMysql = mysqlDisponivel ? describe : describe.skip;

let pastaTemporaria: string | null = null;

/** Pasta de migrações só com as duas primeiras (o banco como era antes do extrato de pontos). */
function pastaAteASegundaMigracao() {
  const origem = path.resolve(import.meta.dirname, "..", "drizzle");
  const destino = fs.mkdtempSync(path.join(os.tmpdir(), "ecocondo-extrato-"));
  pastaTemporaria = destino;
  fs.mkdirSync(path.join(destino, "meta"));
  const diario = JSON.parse(
    fs.readFileSync(path.join(origem, "meta", "_journal.json"), "utf8")
  );
  diario.entries = diario.entries.slice(0, 2);
  for (const entrada of diario.entries)
    fs.copyFileSync(
      path.join(origem, `${entrada.tag}.sql`),
      path.join(destino, `${entrada.tag}.sql`)
    );
  fs.writeFileSync(
    path.join(destino, "meta", "_journal.json"),
    JSON.stringify(diario)
  );
  return destino;
}

afterAll(async () => {
  if (pastaTemporaria)
    fs.rmSync(pastaTemporaria, { recursive: true, force: true });
  if (!mysqlDisponivel) return;
  await fecharDb();
  await apagarBanco(urlDoBanco());
});

describeComMysql("migração que cria o extrato de pontos", () => {
  it("monta o extrato a partir do histórico e fecha com o saldo de cada morador", async () => {
    const { nome, urlServidor } = separarNomeDoBanco(urlDoBanco());
    const servidor = await abrirConexao(urlServidor);
    await servidor.query(`CREATE DATABASE IF NOT EXISTS \`${nome}\``);
    await servidor.end();
    const db = await getDb();
    await migrate(db, { migrationsFolder: pastaAteASegundaMigracao() });

    await db.execute(
      sql`INSERT INTO condominios (id, nome) VALUES (1, 'Condomínio antigo')`
    );
    await db.execute(
      sql`INSERT INTO usuarios (id, id_externo, nome) VALUES (1, 'adm', 'Ana')`
    );
    // Ivo: 4 pontos de coleta, 3 gastos num resgate entregue, 2 gastos e devolvidos num resgate cancelado e 5 de um ajuste manual antigo = 6.
    // Rita: nunca pontuou. Caio: 7 pontos de coletas, sem resgates.
    await db.execute(
      sql`INSERT INTO moradores (id, condominio_id, nome, bloco, apartamento, pontos) VALUES (5, 1, 'Ivo', 'A', '101', 6), (6, 1, 'Rita', 'B', '202', 0), (7, 1, 'Caio', 'C', '303', 7)`
    );
    await db.execute(sql`INSERT INTO coletas (id, condominio_id, morador_id, criado_por_id, tipo_residuo, bloco, agendada_para, concluida_em, peso_gramas, pontos_concedidos, status) VALUES
      (10, 1, 5, 1, 'reciclavel', 'A', '2026-08-10 10:00:00', '2026-08-10 11:00:00', 4000, 4, 'concluida'),
      (11, 1, 7, 1, 'reciclavel', 'C', '2026-08-11 10:00:00', '2026-08-11 11:00:00', 3000, 3, 'concluida'),
      (12, 1, 7, 1, 'reciclavel', 'C', '2026-08-12 10:00:00', '2026-08-12 11:00:00', 4500, 4, 'concluida'),
      (13, 1, 6, 1, 'organico', 'B', '2026-08-13 10:00:00', '2026-08-13 11:00:00', 2000, 0, 'concluida')`);
    await db.execute(
      sql`INSERT INTO recompensas (id, condominio_id, titulo, descricao, custo_pontos, estoque) VALUES (1, 1, 'Brinde', 'Brinde antigo', 3, 5), (2, 1, 'Muda', 'Muda antiga', 2, NULL)`
    );
    await db.execute(
      sql`INSERT INTO resgates (id, condominio_id, morador_id, recompensa_id, pontos_gastos, status) VALUES (20, 1, 5, 1, 3, 'entregue'), (21, 1, 5, 2, 2, 'cancelado')`
    );

    await prepararBanco();

    const [linhas] = (await db.execute(
      sql`SELECT morador_id, tipo, pontos, coleta_id, resgate_id FROM movimentacoes_pontos ORDER BY morador_id, tipo, id`
    )) as unknown as [Array<Record<string, unknown>>];
    expect(linhas).toEqual([
      {
        morador_id: 5,
        tipo: "credito_coleta",
        pontos: 4,
        coleta_id: 10,
        resgate_id: null,
      },
      {
        morador_id: 5,
        tipo: "resgate",
        pontos: -3,
        coleta_id: null,
        resgate_id: 20,
      },
      {
        morador_id: 5,
        tipo: "resgate",
        pontos: -2,
        coleta_id: null,
        resgate_id: 21,
      },
      {
        morador_id: 5,
        tipo: "devolucao_resgate",
        pontos: 2,
        coleta_id: null,
        resgate_id: 21,
      },
      {
        morador_id: 5,
        tipo: "ajuste",
        pontos: 5,
        coleta_id: null,
        resgate_id: null,
      },
      {
        morador_id: 7,
        tipo: "credito_coleta",
        pontos: 3,
        coleta_id: 11,
        resgate_id: null,
      },
      {
        morador_id: 7,
        tipo: "credito_coleta",
        pontos: 4,
        coleta_id: 12,
        resgate_id: null,
      },
    ]);
    expect(await saldosInconsistentes(db)).toEqual([]);

    // Colunas novas com valores padrão seguros para o histórico.
    const [coleta] = (await db.execute(
      sql`SELECT pesagem_simulada, motivo_decisao FROM coletas WHERE id = 10`
    )) as unknown as [Array<Record<string, unknown>>];
    expect(coleta[0]).toEqual({ pesagem_simulada: 0, motivo_decisao: null });
  });
});

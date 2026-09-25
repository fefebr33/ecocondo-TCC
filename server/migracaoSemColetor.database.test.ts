import { afterAll, describe, expect, it, vi } from "vitest";

// Banco MySQL temporário e exclusivo deste arquivo, para simular um banco antigo (com coletor e descontos) sendo atualizado.
vi.hoisted(() => {
  const endereco = new URL(process.env.DATABASE_URL || "mysql://root@127.0.0.1:3306/ecocondo");
  endereco.pathname = `/ecocondo_teste_migracao_${process.pid}_${Date.now()}`;
  process.env.DATABASE_URL = endereco.toString();
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { abrirConexao, apagarBanco, fecharDb, getDb, prepararBanco, separarNomeDoBanco, urlDoBanco } from "./db";
import { mysqlDisponivelParaTestes } from "./testes/mysqlTeste";
import { origensDosRegistros } from "./rotas/operacoes";

const mysqlDisponivel = await mysqlDisponivelParaTestes();
const describeComMysql = mysqlDisponivel ? describe : describe.skip;

let pastaTemporaria: string | null = null;

/** Pasta de migrações só com a primeira (o banco como era antes da retirada do coletor). */
function pastaSoComPrimeiraMigracao() {
  const origem = path.resolve(import.meta.dirname, "..", "drizzle");
  const destino = fs.mkdtempSync(path.join(os.tmpdir(), "ecocondo-migracao-"));
  pastaTemporaria = destino;
  fs.mkdirSync(path.join(destino, "meta"));
  fs.copyFileSync(path.join(origem, "0000_banco_mysql.sql"), path.join(destino, "0000_banco_mysql.sql"));
  const diario = JSON.parse(fs.readFileSync(path.join(origem, "meta", "_journal.json"), "utf8"));
  diario.entries = diario.entries.slice(0, 1);
  fs.writeFileSync(path.join(destino, "meta", "_journal.json"), JSON.stringify(diario));
  return destino;
}

afterAll(async () => {
  if (pastaTemporaria) fs.rmSync(pastaTemporaria, { recursive: true, force: true });
  if (!mysqlDisponivel) return;
  await fecharDb();
  await apagarBanco(urlDoBanco());
});

describeComMysql("migração que retira o coletor e troca descontos por prêmios", () => {
  it("mantém o histórico: coletor com apartamento vira morador, os demais perdem o acesso e descontos viram entregas de prêmio", async () => {
    const { nome, urlServidor } = separarNomeDoBanco(urlDoBanco());
    const servidor = await abrirConexao(urlServidor);
    await servidor.query(`CREATE DATABASE IF NOT EXISTS \`${nome}\``);
    await servidor.end();
    const db = await getDb();
    await migrate(db, { migrationsFolder: pastaSoComPrimeiraMigracao() });

    await db.execute(sql`INSERT INTO condominios (id, nome, desconto_podio_mensal_percentual) VALUES (1, 'Condomínio antigo', 5)`);
    await db.execute(sql`INSERT INTO usuarios (id, id_externo, nome) VALUES (1, 'adm', 'Ana'), (2, 'col', 'Carlos Coletor'), (3, 'col-mor', 'Dora Coletora')`);
    await db.execute(sql`INSERT INTO moradores (id, condominio_id, usuario_id, nome, bloco, apartamento) VALUES (5, 1, 3, 'Dora Coletora', 'A', '101'), (6, 1, NULL, 'Edu', 'B', '202')`);
    await db.execute(sql`INSERT INTO perfis_acesso (usuario_id, condominio_id, morador_id, papel) VALUES (1, 1, NULL, 'administrador'), (2, 1, NULL, 'coletor'), (3, 1, 5, 'coletor')`);
    await db.execute(sql`INSERT INTO pessoas (condominio_id, usuario_id, morador_id, nome, email, papel, status_acesso) VALUES (1, 2, NULL, 'Carlos Coletor', 'c@x', 'coletor', 'ativo'), (1, 3, 5, 'Dora Coletora', 'd@x', 'coletor', 'ativo')`);
    await db.execute(sql`INSERT INTO coletas (id, condominio_id, morador_id, criado_por_id, coletor_id, tipo_residuo, bloco, agendada_para, concluida_em, peso_gramas, pontos_concedidos, status) VALUES (10, 1, 6, 1, 2, 'reciclavel', 'B', '2026-08-10 10:00:00', '2026-08-10 11:00:00', 4000, 4, 'concluida')`);
    await db.execute(sql`INSERT INTO aplicacoes_desconto_podio (condominio_id, morador_id, periodo, intervalo_inicio, intervalo_fim, posicao, percentual_aplicado, observacao, aplicado_por_id) VALUES (1, 6, 'mensal', '2026-08-01 00:00:00', '2026-08-31 23:59:59', 1, 5, 'No boleto', 1)`);

    await prepararBanco();

    const [perfis] = (await db.execute(sql`SELECT usuario_id, papel, morador_id FROM perfis_acesso ORDER BY usuario_id`)) as unknown as [Array<Record<string, unknown>>];
    expect(perfis).toEqual([{ usuario_id: 1, papel: "administrador", morador_id: null }, { usuario_id: 3, papel: "morador", morador_id: 5 }]);
    const [pessoas] = (await db.execute(sql`SELECT usuario_id, papel FROM pessoas ORDER BY usuario_id`)) as unknown as [Array<Record<string, unknown>>];
    expect(pessoas).toEqual([{ usuario_id: 3, papel: "morador" }]);

    const [coletas] = (await db.execute(sql`SELECT * FROM coletas WHERE id = 10`)) as unknown as [Array<Record<string, unknown>>];
    expect(coletas[0]).toMatchObject({ coletor_id: 2, estacao_id: null, pontos_concedidos: 4, status: "concluida" });
    const origem = await origensDosRegistros(1, [{ estacaoId: null, coletorId: 2 } as never]);
    expect(origem({ estacaoId: null, coletorId: 2 } as never)).toBe("Coletor: Carlos Coletor (histórico)");

    const [entregas] = (await db.execute(sql`SELECT morador_id, posicao, premio, observacao, entregue_por_id FROM entregas_premio_podio`)) as unknown as [Array<Record<string, unknown>>];
    expect(entregas).toEqual([{ morador_id: 6, posicao: 1, premio: "Desconto de 5% na taxa condominial (regra antiga)", observacao: "No boleto", entregue_por_id: 1 }]);
    const [tabelas] = (await db.execute(sql`SHOW TABLES LIKE 'aplicacoes_desconto_podio'`)) as unknown as [unknown[]];
    expect(tabelas).toHaveLength(0);
    const [colunas] = (await db.execute(sql`SHOW COLUMNS FROM condominios LIKE 'desconto%'`)) as unknown as [unknown[]];
    expect(colunas).toHaveLength(0);
  });
});

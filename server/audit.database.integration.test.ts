import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Banco MySQL temporário e exclusivo deste arquivo; cada teste roda numa transação desfeita ao final.
vi.hoisted(() => {
  const endereco = new URL(process.env.DATABASE_URL || "mysql://root@127.0.0.1:3306/ecocondo");
  endereco.pathname = `/ecocondo_teste_auditoria_${process.pid}_${Date.now()}`;
  process.env.DATABASE_URL = endereco.toString();
});

import type { Connection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { writeAuditLog } from "./audit";
import { appRouter } from "./rotas";
import type { TrpcContext } from "./_core/context";
import { abrirConexao, apagarBanco, criarDrizzle, fecharDb, getDb, prepararBanco, urlDoBanco } from "./db";
import { mysqlDisponivelParaTestes } from "./testes/mysqlTeste";

vi.mock("./db", async (original) => ({ ...(await original<typeof import("./db")>()), getDb: vi.fn() }));

const mysqlDisponivel = await mysqlDisponivelParaTestes();
const describeWithDatabase = mysqlDisponivel ? describe : describe.skip;

function administratorContext(userId: number) {
  return {
    user: { id: userId, idExterno: "database-test-admin", nome: "Administrador de teste", email: "admin@ecocondo.local", metodoLogin: "test", papel: "usuario", criadoEm: new Date(), atualizadoEm: new Date(), ultimoAcesso: new Date() },
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => undefined },
  } as unknown as TrpcContext;
}

describeWithDatabase("auditoria com banco isolado por transação", () => {
  let connection: Connection;
  let db: ReturnType<typeof criarDrizzle>;

  beforeAll(async () => {
    await prepararBanco();
    await fecharDb();
    connection = await abrirConexao();
    db = criarDrizzle(connection);
    vi.mocked(getDb).mockResolvedValue(db as any);

    const [administradores] = await connection.query<RowDataPacket[]>("SELECT id FROM perfis_acesso WHERE papel = 'administrador' LIMIT 1");
    if (!administradores.length) {
      const [condominio] = await connection.query<ResultSetHeader>("INSERT INTO condominios (nome, quantidade_blocos) VALUES ('Condomínio de teste', 1)");
      const [usuario] = await connection.query<ResultSetHeader>("INSERT INTO usuarios (id_externo, nome, papel) VALUES ('teste-admin-seed', 'Administrador de teste', 'administrador')");
      await connection.query("INSERT INTO perfis_acesso (usuario_id, condominio_id, papel) VALUES (?, ?, 'administrador')", [usuario.insertId, condominio.insertId]);
    }
  });

  beforeEach(async () => {
    await connection.beginTransaction();
  });

  afterEach(async () => {
    await connection.rollback();
  });

  afterAll(async () => {
    await connection.end();
    await apagarBanco(urlDoBanco());
  });

  it("insere e consulta um evento sem conservar dado de teste após a transação", async () => {
    const marker = `teste-integracao-auditoria-${Date.now()}`;
    await writeAuditLog(db, {
      condominioId: 1,
      autorId: 1,
      tipoEntidade: "coleta",
      entidadeId: 999999,
      acao: "teste_integracao",
      resumo: marker,
      estadoAnterior: { status: "agendada" },
      estadoNovo: { status: "concluida", weightGrams: 1000 },
    });
    const [rows] = await connection.query<RowDataPacket[]>("SELECT resumo, estado_anterior, estado_novo FROM logs_auditoria WHERE resumo = ?", [marker]);
    expect(rows).toHaveLength(1);
    expect(rows[0].resumo).toBe(marker);
    expect(rows[0].estado_anterior).toContain("agendada");
    expect(rows[0].estado_novo).toContain("1000");
  });

  it("exporta somente a coleta temporária filtrada por período, bloco e categoria antes do rollback", async () => {
    const [administradores] = await connection.query<RowDataPacket[]>("SELECT usuario_id, condominio_id FROM perfis_acesso WHERE papel = 'administrador' LIMIT 1");
    const administrator = administradores[0] as { usuario_id: number; condominio_id: number } | undefined;
    expect(administrator).toBeTruthy();
    const marker = `CSV-${Date.now()}`;
    const excludedMarker = `EXCLUIR-${Date.now()}`;
    const scheduledAt = "2026-08-25 12:00:00";
    await connection.query("INSERT INTO coletas (condominio_id, morador_id, criado_por_id, coletor_id, tipo_residuo, bloco, agendada_para, concluida_em, peso_gramas, pontos_concedidos, status, observacoes) VALUES (?, NULL, ?, NULL, 'reciclavel', ?, ?, ?, 2345, 2, 'concluida', ?)", [administrator!.condominio_id, administrator!.usuario_id, marker, scheduledAt, scheduledAt, marker]);
    await connection.query("INSERT INTO coletas (condominio_id, morador_id, criado_por_id, coletor_id, tipo_residuo, bloco, agendada_para, concluida_em, peso_gramas, pontos_concedidos, status, observacoes) VALUES (?, NULL, ?, NULL, 'organico', ?, ?, ?, 3000, 0, 'concluida', ?)", [administrator!.condominio_id, administrator!.usuario_id, excludedMarker, scheduledAt, scheduledAt, excludedMarker]);
    const caller = appRouter.createCaller(administratorContext(Number(administrator!.usuario_id)));
    const csv = await caller.relatorios.exportarCsv({ startDate: new Date("2026-08-25T00:00:00Z"), endDate: new Date("2026-08-25T23:59:59Z"), block: marker, wasteType: "reciclavel" });
    expect(csv.content).toContain(`"${marker}"`);
    expect(csv.content).toContain('"2,35"');
    expect(csv.content).toContain('"concluida"');
    expect(csv.content).not.toContain(excludedMarker);
  });
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { writeAuditLog } from "./audit";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { getDb } from "./db";

vi.mock("./db", () => ({ getDb: vi.fn() }));

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

function administratorContext(userId: number) {
  return {
    user: { id: userId, idExterno: "database-test-admin", nome: "Administrador de teste", email: "admin@ecocondo.local", metodoLogin: "test", papel: "usuario", criadoEm: new Date(), atualizadoEm: new Date(), ultimoAcesso: new Date() },
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => undefined },
  } as unknown as TrpcContext;
}

describeWithDatabase("auditoria com banco isolado por transação", () => {
  let connection: Database.Database;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    connection = new Database(databaseUrl!);
    db = drizzle(connection);
    vi.mocked(getDb).mockResolvedValue(db as any);

    const hasAdministrator = connection.prepare("SELECT id FROM perfis_acesso WHERE papel = 'administrador' LIMIT 1").get();
    if (!hasAdministrator) {
      const condominioId = (connection.prepare("INSERT INTO condominios (nome, quantidade_blocos) VALUES ('Condomínio de teste', 1) RETURNING id").get() as { id: number }).id;
      const usuarioId = (connection.prepare("INSERT INTO usuarios (id_externo, nome, papel) VALUES ('teste-admin-seed', 'Administrador de teste', 'administrador') RETURNING id").get() as { id: number }).id;
      connection.prepare("INSERT INTO perfis_acesso (usuario_id, condominio_id, papel) VALUES (?, ?, 'administrador')").run(usuarioId, condominioId);
    }
  });

  beforeEach(async () => {
    connection.exec("BEGIN");
  });

  afterEach(async () => {
    connection.exec("ROLLBACK");
  });

  afterAll(async () => {
    connection.close();
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
    const rows = connection.prepare("SELECT resumo, estado_anterior, estado_novo FROM logs_auditoria WHERE resumo = ?").all(marker) as Array<{ resumo: string; estado_anterior: string; estado_novo: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].resumo).toBe(marker);
    expect(rows[0].estado_anterior).toContain("agendada");
    expect(rows[0].estado_novo).toContain("1000");
  });

  it("exporta somente a coleta temporária filtrada por período, bloco e categoria antes do rollback", async () => {
    const administrator = connection.prepare("SELECT usuario_id, condominio_id FROM perfis_acesso WHERE papel = 'administrador' LIMIT 1").get() as { usuario_id: number; condominio_id: number } | undefined;
    expect(administrator).toBeTruthy();
    const marker = `CSV-${Date.now()}`;
    const excludedMarker = `EXCLUIR-${Date.now()}`;
    const scheduledAt = Math.floor(new Date("2026-08-25T12:00:00Z").getTime() / 1000);
    connection.prepare("INSERT INTO coletas (condominio_id, morador_id, criado_por_id, coletor_id, tipo_residuo, bloco, agendada_para, concluida_em, peso_gramas, pontos_concedidos, status, observacoes) VALUES (?, NULL, ?, NULL, 'reciclavel', ?, ?, ?, 2345, 2, 'concluida', ?)").run(administrator!.condominio_id, administrator!.usuario_id, marker, scheduledAt, scheduledAt, marker);
    connection.prepare("INSERT INTO coletas (condominio_id, morador_id, criado_por_id, coletor_id, tipo_residuo, bloco, agendada_para, concluida_em, peso_gramas, pontos_concedidos, status, observacoes) VALUES (?, NULL, ?, NULL, 'organico', ?, ?, ?, 3000, 0, 'concluida', ?)").run(administrator!.condominio_id, administrator!.usuario_id, excludedMarker, scheduledAt, scheduledAt, excludedMarker);
    const caller = appRouter.createCaller(administratorContext(Number(administrator!.usuario_id)));
    const csv = await caller.relatorios.exportarCsv({ startDate: new Date("2026-08-25T00:00:00Z"), endDate: new Date("2026-08-25T23:59:59Z"), block: marker, wasteType: "reciclavel" });
    expect(csv.content).toContain(`"${marker}"`);
    expect(csv.content).toContain('"2,35"');
    expect(csv.content).toContain('"concluida"');
    expect(csv.content).not.toContain(excludedMarker);
  });
});

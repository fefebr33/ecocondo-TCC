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
    user: { id: userId, openId: "database-test-admin", name: "Administrador de teste", email: "admin@ecocondo.local", loginMethod: "test", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
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

    const hasAdministrator = connection.prepare("SELECT id FROM user_profiles WHERE role = 'administrador' LIMIT 1").get();
    if (!hasAdministrator) {
      const condominiumId = (connection.prepare("INSERT INTO condominiums (name, blockCount) VALUES ('Condomínio de teste', 1) RETURNING id").get() as { id: number }).id;
      const userId = (connection.prepare("INSERT INTO users (openId, name, role) VALUES ('teste-admin-seed', 'Administrador de teste', 'admin') RETURNING id").get() as { id: number }).id;
      connection.prepare("INSERT INTO user_profiles (userId, condominiumId, role) VALUES (?, ?, 'administrador')").run(userId, condominiumId);
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
      condominiumId: 1,
      actorUserId: 1,
      entityType: "coleta",
      entityId: 999999,
      action: "teste_integracao",
      summary: marker,
      beforeState: { status: "agendada" },
      afterState: { status: "concluida", weightGrams: 1000 },
    });
    const rows = connection.prepare("SELECT summary, beforeState, afterState FROM audit_logs WHERE summary = ?").all(marker) as Array<{ summary: string; beforeState: string; afterState: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].summary).toBe(marker);
    expect(rows[0].beforeState).toContain("agendada");
    expect(rows[0].afterState).toContain("1000");
  });

  it("exporta somente a coleta temporária filtrada por período, bloco e categoria antes do rollback", async () => {
    const administrator = connection.prepare("SELECT userId, condominiumId FROM user_profiles WHERE role = 'administrador' LIMIT 1").get() as { userId: number; condominiumId: number } | undefined;
    expect(administrator).toBeTruthy();
    const marker = `CSV-${Date.now()}`;
    const excludedMarker = `EXCLUIR-${Date.now()}`;
    const scheduledAt = Math.floor(new Date("2026-08-25T12:00:00Z").getTime() / 1000);
    connection.prepare("INSERT INTO collections (condominiumId, residentId, createdByUserId, collectorUserId, wasteType, block, scheduledAt, completedAt, weightGrams, pointsAwarded, status, notes) VALUES (?, NULL, ?, NULL, 'reciclavel', ?, ?, ?, 2345, 2, 'concluida', ?)").run(administrator!.condominiumId, administrator!.userId, marker, scheduledAt, scheduledAt, marker);
    connection.prepare("INSERT INTO collections (condominiumId, residentId, createdByUserId, collectorUserId, wasteType, block, scheduledAt, completedAt, weightGrams, pointsAwarded, status, notes) VALUES (?, NULL, ?, NULL, 'organico', ?, ?, ?, 3000, 0, 'concluida', ?)").run(administrator!.condominiumId, administrator!.userId, excludedMarker, scheduledAt, scheduledAt, excludedMarker);
    const caller = appRouter.createCaller(administratorContext(Number(administrator!.userId)));
    const csv = await caller.reports.exportCsv({ startDate: new Date("2026-08-25T00:00:00Z"), endDate: new Date("2026-08-25T23:59:59Z"), block: marker, wasteType: "reciclavel" });
    expect(csv.content).toContain(`"${marker}"`);
    expect(csv.content).toContain('"2,35"');
    expect(csv.content).toContain('"concluida"');
    expect(csv.content).not.toContain(excludedMarker);
  });
});

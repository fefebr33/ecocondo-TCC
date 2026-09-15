import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../_core/env", () => ({ ENV: { ownerOpenId: "owner" } }));

import { getDb } from "../db";
import { getOrCreateProfile } from "./ecocondo";

const mockedGetDb = vi.mocked(getDb);

function chain(result: unknown) {
  const api: Record<string, unknown> = {};
  api.from = vi.fn(() => api);
  api.where = vi.fn(() => api);
  api.limit = vi.fn(async () => result);
  return api;
}

describe("vínculo de pessoa pendente no primeiro login", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ativa o perfil de morador existente quando o e-mail autenticado coincide", async () => {
    const condominium = { id: 1, name: "Condomínio", address: null, city: null, state: null, blockCount: 1, isActive: true, createdAt: new Date(), updatedAt: new Date() };
    const pendingPerson = { id: 8, condominiumId: 1, userId: null, residentId: 3, name: "Ana", email: "ana@exemplo.com", phone: null, block: "A", apartment: "12", role: "morador", accessStatus: "pendente", createdAt: new Date(), updatedAt: new Date() };
    const resident = { id: 3, condominiumId: 1, userId: null, name: "Ana", email: "ana@exemplo.com", phone: null, block: "A", apartment: "12", status: "ativo", points: 0, createdAt: new Date(), updatedAt: new Date() };
    const profile = { id: 20, userId: 5, condominiumId: 1, residentId: 3, role: "morador", createdAt: new Date(), updatedAt: new Date() };
    const responses = [[], [condominium], [pendingPerson], [resident], [profile], [resident]];
    const updateSet = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
    const db = {
      select: vi.fn(() => chain(responses.shift() ?? [])),
      update: vi.fn(() => ({ set: updateSet })),
      insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(async () => [{ id: 20 }]) })) })),
    };
    mockedGetDb.mockResolvedValue(db as never);

    const result = await getOrCreateProfile({ id: 5, openId: "ana-id", name: "Ana", email: " ANA@EXEMPLO.COM ", loginMethod: "test", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() });

    expect(result.profile).toMatchObject({ role: "morador", residentId: 3 });
    expect(result.resident).toMatchObject({ id: 3, name: "Ana" });
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ userId: 5, residentId: 3, accessStatus: "ativo", role: "morador" }));
  });
});

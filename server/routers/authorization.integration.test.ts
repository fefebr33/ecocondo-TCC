import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/ecocondo", () => ({ getOrCreateProfile: vi.fn() }));
vi.mock("../db", () => ({ getDb: vi.fn() }));

import { getOrCreateProfile } from "../db/ecocondo";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";

const mockProfile = vi.mocked(getOrCreateProfile);

function contextFor(role: "administrador" | "coletor" | "morador") {
  return {
    user: {
      id: 77,
      openId: `test-${role}`,
      name: "Usuário de teste",
      email: "teste@ecocondo.local",
      loginMethod: "test",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} },
    res: { clearCookie: vi.fn() },
  } as unknown as TrpcContext;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("autorização de procedimentos EcoCondo", () => {
  it("bloqueia morador no cadastro administrativo de moradores", async () => {
    mockProfile.mockResolvedValue({
      profile: { id: 1, userId: 77, condominiumId: 1, residentId: 10, role: "morador", createdAt: new Date(), updatedAt: new Date() },
      condominium: { id: 1, name: "Condomínio de teste", address: null, city: null, state: null, blockCount: 1, isActive: true, createdAt: new Date(), updatedAt: new Date() },
      resident: null,
    });
    const caller = appRouter.createCaller(contextFor("morador"));
    await expect(caller.residents.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("bloqueia coletor na emissão de relatórios administrativos", async () => {
    mockProfile.mockResolvedValue({
      profile: { id: 2, userId: 77, condominiumId: 1, residentId: null, role: "coletor", createdAt: new Date(), updatedAt: new Date() },
      condominium: { id: 1, name: "Condomínio de teste", address: null, city: null, state: null, blockCount: 1, isActive: true, createdAt: new Date(), updatedAt: new Date() },
      resident: null,
    });
    const caller = appRouter.createCaller(contextFor("coletor"));
    await expect(caller.reports.overview({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("bloqueia morador na conclusão de coleta e publicação de comunicados", async () => {
    mockProfile.mockResolvedValue({
      profile: { id: 3, userId: 77, condominiumId: 1, residentId: 10, role: "morador", createdAt: new Date(), updatedAt: new Date() },
      condominium: { id: 1, name: "Condomínio de teste", address: null, city: null, state: null, blockCount: 1, isActive: true, createdAt: new Date(), updatedAt: new Date() },
      resident: null,
    });
    const caller = appRouter.createCaller(contextFor("morador"));
    await expect(caller.collections.updateStatus({ id: 1, status: "concluida", weightGrams: 1000 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.notifications.createCommunication({ title: "Aviso", message: "Mensagem de teste" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("bloqueia coletor na administração de recompensas e perfis", async () => {
    mockProfile.mockResolvedValue({
      profile: { id: 4, userId: 77, condominiumId: 1, residentId: null, role: "coletor", createdAt: new Date(), updatedAt: new Date() },
      condominium: { id: 1, name: "Condomínio de teste", address: null, city: null, state: null, blockCount: 1, isActive: true, createdAt: new Date(), updatedAt: new Date() },
      resident: null,
    });
    const caller = appRouter.createCaller(contextFor("coletor"));
    await expect(caller.engagement.createReward({ title: "Recompensa", description: "Descrição válida", pointsCost: 10, stock: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.profile.setRole({ userId: 12, role: "morador" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("bloqueia coletor nos indicadores e intervenções exclusivos da administração", async () => {
    mockProfile.mockResolvedValue({
      profile: { id: 5, userId: 77, condominiumId: 1, residentId: null, role: "coletor", createdAt: new Date(), updatedAt: new Date() },
      condominium: { id: 1, name: "Condomínio de teste", address: null, city: null, state: null, blockCount: 1, isActive: true, createdAt: new Date(), updatedAt: new Date() },
      resident: null,
    });
    const caller = appRouter.createCaller(contextFor("coletor"));
    await expect(caller.goals.create({ block: "A", title: "Meta válida", targetKg: 20, startDate: new Date("2026-08-01"), endDate: new Date("2026-08-31") })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.incidents.updateStatus({ id: 1, status: "resolvida" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.compliance.overview()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.comparison.timeline({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.campaigns.create({ title: "Campanha", description: "Descrição de campanha válida", targetDescription: "Meta", startDate: new Date("2026-08-01"), endDate: new Date("2026-08-31"), status: "ativa" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.feedback.respond({ id: 1, response: "Resposta válida" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejeita datas inválidas e conteúdo insuficiente antes de acessar o banco", async () => {
    mockProfile.mockResolvedValue({
      profile: { id: 6, userId: 77, condominiumId: 1, residentId: null, role: "administrador", createdAt: new Date(), updatedAt: new Date() },
      condominium: { id: 1, name: "Condomínio de teste", address: null, city: null, state: null, blockCount: 1, isActive: true, createdAt: new Date(), updatedAt: new Date() },
      resident: null,
    });
    const caller = appRouter.createCaller(contextFor("administrador"));
    await expect(caller.goals.create({ block: "A", title: "Meta válida", targetKg: 20, startDate: new Date("2026-09-01"), endDate: new Date("2026-08-31") })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.incidents.create({ block: "A", wasteType: "reciclavel", location: "Ponto central", description: "oi" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.campaigns.create({ title: "Campanha", description: "Descrição de campanha válida", targetDescription: "Meta", startDate: new Date("2026-09-01"), endDate: new Date("2026-08-31"), status: "planejada" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.feedback.create({ rating: 6, message: "Mensagem válida" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

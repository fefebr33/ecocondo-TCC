import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../_core/env", () => ({ ENV: { ownerOpenId: "owner" } }));

import { getDb } from "../db";
import { obterOuCriarPerfil } from "./ecocondo";

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
    const condominio = { id: 1, nome: "Condomínio", endereco: null, cidade: null, estado: null, quantidadeBlocos: 1, ativo: true, criadoEm: new Date(), atualizadoEm: new Date() };
    const pessoaPendente = { id: 8, condominioId: 1, usuarioId: null, moradorId: 3, nome: "Ana", email: "ana@exemplo.com", telefone: null, bloco: "A", apartamento: "12", papel: "morador", statusAcesso: "pendente", criadoEm: new Date(), atualizadoEm: new Date() };
    const morador = { id: 3, condominioId: 1, usuarioId: null, nome: "Ana", email: "ana@exemplo.com", telefone: null, bloco: "A", apartamento: "12", status: "ativo", pontos: 0, criadoEm: new Date(), atualizadoEm: new Date() };
    const perfil = { id: 20, usuarioId: 5, condominioId: 1, moradorId: 3, papel: "morador", criadoEm: new Date(), atualizadoEm: new Date() };
    const responses = [[], [condominio], [pessoaPendente], [morador], [perfil], [morador]];
    const updateSet = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
    const db = {
      select: vi.fn(() => chain(responses.shift() ?? [])),
      update: vi.fn(() => ({ set: updateSet })),
      insert: vi.fn(() => ({ values: vi.fn(() => ({ $returningId: vi.fn(async () => [{ id: 20 }]) })) })),
    };
    mockedGetDb.mockResolvedValue(db as never);

    const result = await obterOuCriarPerfil({ id: 5, idExterno: "ana-id", nome: "Ana", email: " ANA@EXEMPLO.COM ", metodoLogin: "test", papel: "usuario", criadoEm: new Date(), atualizadoEm: new Date(), ultimoAcesso: new Date() });

    expect(result.perfil).toMatchObject({ papel: "morador", moradorId: 3 });
    expect(result.morador).toMatchObject({ id: 3, nome: "Ana" });
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ usuarioId: 5, moradorId: 3, statusAcesso: "ativo", papel: "morador" }));
  });
});

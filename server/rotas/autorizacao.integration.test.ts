import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/ecocondo", () => ({ obterOuCriarPerfil: vi.fn() }));
vi.mock("../db", () => ({ getDb: vi.fn() }));

import { obterOuCriarPerfil } from "../db/ecocondo";
import { appRouter } from "../rotas";
import type { TrpcContext } from "../_core/context";

const mockProfile = vi.mocked(obterOuCriarPerfil);

function contextFor(role: "administrador" | "coletor" | "morador") {
  return {
    user: {
      id: 77,
      idExterno: `test-${role}`,
      nome: "Usuário de teste",
      email: "teste@ecocondo.local",
      metodoLogin: "test",
      papel: "usuario",
      criadoEm: new Date(),
      atualizadoEm: new Date(),
      ultimoAcesso: new Date(),
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
      perfil: { id: 1, usuarioId: 77, condominioId: 1, moradorId: 10, papel: "morador", criadoEm: new Date(), atualizadoEm: new Date() },
      condominio: { id: 1, nome: "Condomínio de teste", endereco: null, cidade: null, estado: null, quantidadeBlocos: 1, ativo: true, criadoEm: new Date(), atualizadoEm: new Date() },
      morador: null,
    });
    const caller = appRouter.createCaller(contextFor("morador"));
    await expect(caller.moradores.listar()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("bloqueia coletor na emissão de relatórios administrativos", async () => {
    mockProfile.mockResolvedValue({
      perfil: { id: 2, usuarioId: 77, condominioId: 1, moradorId: null, papel: "coletor", criadoEm: new Date(), atualizadoEm: new Date() },
      condominio: { id: 1, nome: "Condomínio de teste", endereco: null, cidade: null, estado: null, quantidadeBlocos: 1, ativo: true, criadoEm: new Date(), atualizadoEm: new Date() },
      morador: null,
    });
    const caller = appRouter.createCaller(contextFor("coletor"));
    await expect(caller.relatorios.visaoGeral({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("bloqueia morador na conclusão de coleta e publicação de comunicados", async () => {
    mockProfile.mockResolvedValue({
      perfil: { id: 3, usuarioId: 77, condominioId: 1, moradorId: 10, papel: "morador", criadoEm: new Date(), atualizadoEm: new Date() },
      condominio: { id: 1, nome: "Condomínio de teste", endereco: null, cidade: null, estado: null, quantidadeBlocos: 1, ativo: true, criadoEm: new Date(), atualizadoEm: new Date() },
      morador: null,
    });
    const caller = appRouter.createCaller(contextFor("morador"));
    await expect(caller.coletas.atualizarStatus({ id: 1, status: "concluida", weightGrams: 1000 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.notificacoes.criarComunicado({ title: "Aviso", message: "Mensagem de teste" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("bloqueia coletor na administração de recompensas e perfis", async () => {
    mockProfile.mockResolvedValue({
      perfil: { id: 4, usuarioId: 77, condominioId: 1, moradorId: null, papel: "coletor", criadoEm: new Date(), atualizadoEm: new Date() },
      condominio: { id: 1, nome: "Condomínio de teste", endereco: null, cidade: null, estado: null, quantidadeBlocos: 1, ativo: true, criadoEm: new Date(), atualizadoEm: new Date() },
      morador: null,
    });
    const caller = appRouter.createCaller(contextFor("coletor"));
    await expect(caller.engajamento.criarRecompensa({ title: "Recompensa", description: "Descrição válida", pointsCost: 10, stock: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.perfil.definirPapel({ userId: 12, role: "morador" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("bloqueia coletor nos indicadores e intervenções exclusivos da administração", async () => {
    mockProfile.mockResolvedValue({
      perfil: { id: 5, usuarioId: 77, condominioId: 1, moradorId: null, papel: "coletor", criadoEm: new Date(), atualizadoEm: new Date() },
      condominio: { id: 1, nome: "Condomínio de teste", endereco: null, cidade: null, estado: null, quantidadeBlocos: 1, ativo: true, criadoEm: new Date(), atualizadoEm: new Date() },
      morador: null,
    });
    const caller = appRouter.createCaller(contextFor("coletor"));
    await expect(caller.metas.criar({ block: "A", title: "Meta válida", targetKg: 20, startDate: new Date("2026-08-01"), endDate: new Date("2026-08-31") })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.ocorrencias.atualizarStatus({ id: 1, status: "resolvida" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.conformidade.visaoGeral()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.comparacao.linhaDoTempo({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.auditoria.listar({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.relatorios.exportarCsv({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.campanhas.criar({ title: "Campanha", description: "Descrição de campanha válida", targetDescription: "Meta", startDate: new Date("2026-08-01"), endDate: new Date("2026-08-31"), status: "ativa" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.avaliacoes.responder({ id: 1, response: "Resposta válida" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejeita datas inválidas e conteúdo insuficiente antes de acessar o banco", async () => {
    mockProfile.mockResolvedValue({
      perfil: { id: 6, usuarioId: 77, condominioId: 1, moradorId: null, papel: "administrador", criadoEm: new Date(), atualizadoEm: new Date() },
      condominio: { id: 1, nome: "Condomínio de teste", endereco: null, cidade: null, estado: null, quantidadeBlocos: 1, ativo: true, criadoEm: new Date(), atualizadoEm: new Date() },
      morador: null,
    });
    const caller = appRouter.createCaller(contextFor("administrador"));
    await expect(caller.metas.criar({ block: "A", title: "Meta válida", targetKg: 20, startDate: new Date("2026-09-01"), endDate: new Date("2026-08-31") })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.ocorrencias.criar({ block: "A", wasteType: "reciclavel", location: "Ponto central", description: "oi" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.campanhas.criar({ title: "Campanha", description: "Descrição de campanha válida", targetDescription: "Meta", startDate: new Date("2026-09-01"), endDate: new Date("2026-08-31"), status: "planejada" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.avaliacoes.criar({ rating: 6, message: "Mensagem válida" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

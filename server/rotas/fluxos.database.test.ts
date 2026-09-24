import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Banco SQLite temporário e exclusivo deste arquivo, com as migrações reais aplicadas.
vi.hoisted(() => {
  const nodeFs = require("node:fs") as typeof import("node:fs");
  const nodeOs = require("node:os") as typeof import("node:os");
  const nodePath = require("node:path") as typeof import("node:path");
  process.env.DATABASE_URL = nodePath.join(nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "ecocondo-teste-")), "teste.db");
});

import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { getDb, getUserByOpenId, upsertUser } from "../db";
import { appRouter } from "../rotas";
import { coletas, pessoas, recompensas } from "../../drizzle/schema";
import { runRecurringCollections } from "../scheduled/recurringCollections";
import type { TrpcContext } from "../_core/context";
import type { Usuario } from "../../drizzle/schema";

const FOTO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const amanha = () => new Date(Date.now() + 24 * 60 * 60 * 1000);

async function criarUsuario(idExterno: string, email: string, papel: "administrador" | "usuario" = "usuario") {
  await upsertUser({ idExterno, nome: idExterno, email, metodoLogin: "teste", papel });
  return (await getUserByOpenId(idExterno)) as Usuario;
}

function chamador(usuario: Usuario) {
  return appRouter.createCaller({ user: usuario, req: { protocol: "https", headers: {} }, res: { clearCookie: vi.fn() } } as unknown as TrpcContext);
}

let admin: ReturnType<typeof chamador>;
let admin2: ReturnType<typeof chamador>;
let coletor: ReturnType<typeof chamador>;
let morador: ReturnType<typeof chamador>;
let usuarioAdmin: Usuario;
let usuarioColetor: Usuario;
let moradorId: number;

beforeAll(async () => {
  const db = await getDb();
  migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle") });
  usuarioAdmin = await criarUsuario("admin-1", "admin1@teste.local", "administrador");
  admin = chamador(usuarioAdmin);
  await admin.perfil.meuPerfil();
  admin2 = chamador(await criarUsuario("admin-2", "admin2@teste.local", "administrador"));
  await admin2.perfil.meuPerfil();
  await admin.pessoas.criar({ name: "Carlos Coletor", email: "coletor@teste.local", role: "coletor" });
  usuarioColetor = await criarUsuario("coletor-1", "coletor@teste.local");
  coletor = chamador(usuarioColetor);
  await coletor.perfil.meuPerfil();
  morador = chamador(await criarUsuario("morador-1", "morador@teste.local"));
  moradorId = (await morador.perfil.meuPerfil()).resident!.id;
});

describe("fluxos com banco de dados real", () => {
  it("perfis são criados conforme o cadastro", async () => {
    expect((await admin.perfil.meuPerfil()).role).toBe("administrador");
    expect((await coletor.perfil.meuPerfil()).role).toBe("coletor");
    expect((await morador.perfil.meuPerfil()).role).toBe("morador");
  });

  it("ranking de engajamento não expõe e-mail, telefone nem código QR de vizinhos", async () => {
    const { id } = await admin.moradores.criar({ name: "Vizinha Teste", email: "vizinha@teste.local", phone: "11 90000-0000", block: "B", apartment: "202" });
    await admin.moradores.codigoQr({ id });
    const vizinha = (await morador.engajamento.ranking()).find((linha) => linha.id === id)!;
    expect(vizinha.nome).toBe("Vizinha Teste");
    expect(vizinha).not.toHaveProperty("email");
    expect(vizinha).not.toHaveProperty("telefone");
    expect(vizinha).not.toHaveProperty("codigoAcesso");
  });

  it("recusa coleta agendada para antes de hoje", async () => {
    await expect(morador.coletas.criar({ wasteType: "reciclavel", block: "A", scheduledAt: new Date("2020-01-01T10:00:00") })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("quem concluiu a coleta com peso suspeito não pode aprovar, mesmo com outro coletor atribuído", async () => {
    const primeira = await admin.coletas.criar({ residentId: moradorId, wasteType: "reciclavel", block: "A", scheduledAt: amanha(), collectorUserId: usuarioColetor.id });
    await coletor.coletas.atualizarStatus({ id: primeira.id, status: "concluida", weightGrams: 2000, imageDataUrl: FOTO });

    const suspeita = await admin.coletas.criar({ residentId: moradorId, wasteType: "reciclavel", block: "A", scheduledAt: amanha(), collectorUserId: usuarioColetor.id });
    const totalAntes = (await admin.dashboard.resumo()).totalKg;
    const resultado = await admin.coletas.atualizarStatus({ id: suspeita.id, status: "concluida", weightGrams: 50000, imageDataUrl: FOTO });
    expect(resultado.pendingApproval).toBe(true);
    // Enquanto aguarda aprovação, o peso não entra nos totais, e o outro administrador é avisado.
    expect((await admin.dashboard.resumo()).totalKg).toBe(totalAntes);
    expect((await admin2.notificacoes.listar()).some((item) => item.coletaId === suspeita.id && item.titulo === "Peso aguardando aprovação")).toBe(true);
    await expect(admin.coletas.decidirAprovacaoPeso({ id: suspeita.id, aprovar: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const aprovacao = await admin2.coletas.decidirAprovacaoPeso({ id: suspeita.id, aprovar: true });
    expect(aprovacao.pointsAwarded).toBe(50);
    expect((await admin.dashboard.resumo()).totalKg).toBe(totalAntes + 50);
  });

  it("coletas recorrentes são geradas uma única vez e nunca com horário passado", async () => {
    const agora = new Date();
    const amanhaMesmoHorario = new Date(agora.getTime() + 24 * 60 * 60 * 1000);
    const horario = `${String(amanhaMesmoHorario.getHours()).padStart(2, "0")}:${String(amanhaMesmoHorario.getMinutes()).padStart(2, "0")}`;
    const deAmanha = await admin.recorrencias.criar({ block: "R", wasteType: "reciclavel", weekday: amanhaMesmoHorario.getDay(), time: horario });
    // Regra de hoje à meia-noite: o horário já passou, então não gera nada.
    await admin.recorrencias.criar({ block: "R", wasteType: "organico", weekday: agora.getDay(), time: "00:00" });

    const primeira = await runRecurringCollections(agora);
    const segunda = await runRecurringCollections(agora);
    expect(segunda.collectionsCreated).toBe(0);
    const db = await getDb();
    const geradas = await db.select().from(coletas).where(eq(coletas.bloco, "R"));
    expect(primeira.collectionsCreated).toBe(geradas.length);
    expect(geradas.map((item) => item.regraRecorrenciaId)).toEqual([deAmanha.id]);
    expect(geradas.every((item) => item.agendadaPara > agora)).toBe(true);
  });

  it("cancelar uma coleta concluída devolve os pontos concedidos", async () => {
    const coleta = await admin.coletas.criar({ residentId: moradorId, wasteType: "reciclavel", block: "A", scheduledAt: amanha() });
    const antes = (await morador.perfil.meuPerfil()).resident!.pontos;
    await coletor.coletas.atualizarStatus({ id: coleta.id, status: "concluida", weightGrams: 3000, imageDataUrl: FOTO });
    expect((await morador.perfil.meuPerfil()).resident!.pontos).toBe(antes + 3);
    await admin.coletas.atualizarStatus({ id: coleta.id, status: "cancelada" });
    expect((await morador.perfil.meuPerfil()).resident!.pontos).toBe(antes);
  });

  it("administrador não consegue alterar o próprio perfil", async () => {
    const db = await getDb();
    const minhaPessoa = (await db.select().from(pessoas).where(eq(pessoas.usuarioId, usuarioAdmin.id)))[0];
    await expect(admin.pessoas.definirPapel({ id: minhaPessoa.id, role: "coletor" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await admin.perfil.meuPerfil()).role).toBe("administrador");
  });

  it("resgate respeita estoque e pontos, e cancelar devolve os dois", async () => {
    const { id: rewardId } = await admin.engajamento.criarRecompensa({ title: "Brinde", description: "Uma unidade", pointsCost: 1, stock: 1 });
    const antes = (await morador.perfil.meuPerfil()).resident!.pontos;
    const tentativas = await Promise.allSettled([1, 2, 3].map(() => morador.engajamento.resgatar({ rewardId })));
    expect(tentativas.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect((await morador.perfil.meuPerfil()).resident!.pontos).toBe(antes - 1);

    const [pedido] = await morador.engajamento.meusResgates();
    expect(pedido).toMatchObject({ recompensa: "Brinde", status: "solicitado" });
    const naFila = (await admin.engajamento.listarResgates()).find((item) => item.id === pedido.id);
    expect(naFila?.morador).toBeTruthy();

    await admin.engajamento.atualizarResgate({ id: pedido.id, status: "cancelado" });
    expect((await morador.perfil.meuPerfil()).resident!.pontos).toBe(antes);
    const db = await getDb();
    expect((await db.select().from(recompensas).where(eq(recompensas.id, rewardId)))[0].estoque).toBe(1);
    await expect(admin.engajamento.atualizarResgate({ id: pedido.id, status: "entregue" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("morador não gerencia resgates", async () => {
    await expect(morador.engajamento.listarResgates()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});


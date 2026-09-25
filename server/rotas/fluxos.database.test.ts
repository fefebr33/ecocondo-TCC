import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Banco MySQL temporário e exclusivo deste arquivo (mesmo servidor do DATABASE_URL), com as migrações reais aplicadas.
vi.hoisted(() => {
  const endereco = new URL(process.env.DATABASE_URL || "mysql://root@127.0.0.1:3306/ecocondo");
  endereco.pathname = `/ecocondo_teste_fluxos_${process.pid}_${Date.now()}`;
  process.env.DATABASE_URL = endereco.toString();
});

import { eq } from "drizzle-orm";
import { apagarBanco, fecharDb, getDb, getUserByOpenId, prepararBanco, upsertUser, urlDoBanco } from "../db";
import { mysqlDisponivelParaTestes } from "../testes/mysqlTeste";
import { appRouter } from "../rotas";
import { coletas, moradores, pessoas, recompensas } from "../../drizzle/schema";
import { definirSorteioAmostragem } from "../dominio/estacaoPesagem";
import { CABECALHO_TOKEN_ESTACAO } from "./estacoes";
import { runRecurringCollections } from "../scheduled/recurringCollections";
import type { TrpcContext } from "../_core/context";
import type { Usuario } from "../../drizzle/schema";

const mysqlDisponivel = await mysqlDisponivelParaTestes();
const describeComMysql = mysqlDisponivel ? describe : describe.skip;

const FOTO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const amanha = () => new Date(Date.now() + 24 * 60 * 60 * 1000);

async function criarUsuario(idExterno: string, email: string, papel: "administrador" | "usuario" = "usuario") {
  await upsertUser({ idExterno, nome: idExterno, email, metodoLogin: "teste", papel });
  return (await getUserByOpenId(idExterno)) as Usuario;
}

function chamador(usuario: Usuario) {
  return appRouter.createCaller({ user: usuario, req: { protocol: "https", headers: {} }, res: { clearCookie: vi.fn() } } as unknown as TrpcContext);
}

/** O tablet da estação de pesagem: sem pessoa logada, só o código de pareamento no cabeçalho. */
function tablet(token?: string) {
  return appRouter.createCaller({ user: null, req: { protocol: "https", headers: token ? { [CABECALHO_TOKEN_ESTACAO]: token } : {} }, res: { clearCookie: vi.fn() } } as unknown as TrpcContext);
}

let admin: ReturnType<typeof chamador>;
let admin2: ReturnType<typeof chamador>;
let morador: ReturnType<typeof chamador>;
let usuarioAdmin: Usuario;
let moradorId: number;

beforeAll(async () => {
  if (!mysqlDisponivel) return;
  await prepararBanco();
  usuarioAdmin = await criarUsuario("admin-1", "admin1@teste.local", "administrador");
  admin = chamador(usuarioAdmin);
  await admin.perfil.meuPerfil();
  admin2 = chamador(await criarUsuario("admin-2", "admin2@teste.local", "administrador"));
  await admin2.perfil.meuPerfil();
  morador = chamador(await criarUsuario("morador-1", "morador@teste.local"));
  moradorId = (await morador.perfil.meuPerfil()).resident!.id;
});

afterAll(async () => {
  if (!mysqlDisponivel) return;
  await fecharDb();
  await apagarBanco(urlDoBanco());
});

describeComMysql("fluxos com banco de dados real", () => {
  it("perfis são criados conforme o cadastro", async () => {
    expect((await admin.perfil.meuPerfil()).role).toBe("administrador");
    expect((await morador.perfil.meuPerfil()).role).toBe("morador");
  });

  it("não aceita mais cadastrar ninguém com o perfil coletor", async () => {
    await expect(admin.pessoas.criar({ name: "Carlos Coletor", email: "coletor@teste.local", role: "coletor" as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("recusa coleta agendada para antes de hoje", async () => {
    await expect(morador.coletas.criar({ wasteType: "reciclavel", block: "A", scheduledAt: new Date("2020-01-01T10:00:00") })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("morador não agenda nem conclui coleta no lugar da administração", async () => {
    const coleta = await admin.coletas.criar({ residentId: moradorId, wasteType: "reciclavel", block: "A", scheduledAt: amanha() });
    await expect(morador.coletas.atualizarStatus({ id: coleta.id, status: "concluida", weightGrams: 2000, imageDataUrl: FOTO })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("quem concluiu a coleta com peso suspeito não pode aprovar", async () => {
    const primeira = await admin.coletas.criar({ residentId: moradorId, wasteType: "reciclavel", block: "A", scheduledAt: amanha() });
    await admin.coletas.atualizarStatus({ id: primeira.id, status: "concluida", weightGrams: 2000, imageDataUrl: FOTO });

    const suspeita = await admin.coletas.criar({ residentId: moradorId, wasteType: "reciclavel", block: "A", scheduledAt: amanha() });
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
    await admin.coletas.atualizarStatus({ id: coleta.id, status: "concluida", weightGrams: 3000, imageDataUrl: FOTO });
    expect((await morador.perfil.meuPerfil()).resident!.pontos).toBe(antes + 3);
    await admin.coletas.atualizarStatus({ id: coleta.id, status: "cancelada" });
    expect((await morador.perfil.meuPerfil()).resident!.pontos).toBe(antes);
  });

  it("administrador não consegue alterar o próprio perfil", async () => {
    const db = await getDb();
    const minhaPessoa = (await db.select().from(pessoas).where(eq(pessoas.usuarioId, usuarioAdmin.id)))[0];
    await expect(admin.pessoas.definirPapel({ id: minhaPessoa.id, role: "morador" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
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
  it("estação de pesagem: só tablet pareado registra, com código de uso único, e as travas antifraude valem", async () => {
    definirSorteioAmostragem(() => 1);
    const { id: estacaoId, token } = await admin.estacoes.criar({ name: "Lixeiras do térreo", location: "Garagem" });
    expect(JSON.stringify(await admin.estacoes.listar())).not.toContain(token);
    await expect(tablet().estacao.status()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(tablet("codigo-inventado-123").estacao.status()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const estacao = tablet(token);
    expect((await estacao.estacao.status()).nome).toBe("Lixeiras do térreo");
    await expect(admin.estacao.gerarCodigo()).rejects.toMatchObject({ code: "FORBIDDEN" });

    const antes = (await morador.perfil.meuPerfil()).resident!.pontos;
    const { code } = await morador.estacao.gerarCodigo();
    expect(code).toMatch(/^\d{6}$/);
    const outroCodigo = code === "000000" ? "000001" : "000000";
    await expect(estacao.estacao.identificar({ code: outroCodigo })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await estacao.estacao.identificar({ code })).toMatchObject({ firstName: "morador-1" });
    await expect(estacao.estacao.registrar({ code, wasteType: "reciclavel", weightGrams: 3000, imageDataUrl: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(estacao.estacao.registrar({ code, wasteType: "reciclavel", weightGrams: 31_000, imageDataUrl: FOTO })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const registro = await estacao.estacao.registrar({ code, wasteType: "reciclavel", weightGrams: 3000, imageDataUrl: FOTO });
    expect(registro).toMatchObject({ pointsAwarded: 3, pendingApproval: false });
    expect((await morador.perfil.meuPerfil()).resident!.pontos).toBe(antes + 3);
    const db = await getDb();
    const [gravada] = await db.select().from(coletas).where(eq(coletas.id, registro.id));
    expect(gravada).toMatchObject({ estacaoId, status: "concluida", coletorId: null, pesoGramas: 3000 });
    expect(gravada.urlFoto).toBeTruthy();
    expect((await admin.coletas.listar()).find((item) => item.id === registro.id)?.origin).toBe("Estação: Lixeiras do térreo");

    // O código não vale de novo, e um segundo registro logo em seguida é recusado.
    await expect(estacao.estacao.registrar({ code, wasteType: "reciclavel", weightGrams: 3000, imageDataUrl: FOTO })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const { code: segundo } = await morador.estacao.gerarCodigo();
    await expect(estacao.estacao.registrar({ code: segundo, wasteType: "reciclavel", weightGrams: 2000, imageDataUrl: FOTO })).rejects.toThrow(/Aguarde/);

    // Estação desativada deixa de funcionar na hora.
    await admin.estacoes.alternar({ id: estacaoId, active: false });
    await expect(estacao.estacao.status()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await admin.estacoes.alternar({ id: estacaoId, active: true });
    const { token: novoToken } = await admin.estacoes.novoCodigo({ id: estacaoId });
    await expect(estacao.estacao.status()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect((await tablet(novoToken).estacao.status()).id).toBe(estacaoId);
  });

  it("registro pesado na estação fica em revisão e o próprio administrador único pode aprovar", async () => {
    definirSorteioAmostragem(() => 1);
    const { token } = await admin.estacoes.criar({ name: "Lixeiras do bloco B", location: "Térreo do bloco B" });
    const vizinho = chamador(await criarUsuario("morador-estacao", "estacao@teste.local"));
    await vizinho.perfil.meuPerfil();
    const { code } = await vizinho.estacao.gerarCodigo();
    const registro = await tablet(token).estacao.registrar({ code, wasteType: "reciclavel", weightGrams: 12_000, imageDataUrl: FOTO });
    expect(registro).toMatchObject({ pointsAwarded: 0, pendingApproval: true, pendingPoints: 12 });
    expect((await vizinho.perfil.meuPerfil()).resident!.pontos).toBe(0);
    const pendente = (await admin.coletas.listarPendentesAprovacao()).find((item) => item.id === registro.id);
    expect(pendente?.observacoes).toContain("peso acima de 10 kg");
    expect((await admin.notificacoes.listar()).some((item) => item.coletaId === registro.id)).toBe(true);
    await admin.coletas.decidirAprovacaoPeso({ id: registro.id, aprovar: true });
    expect((await vizinho.perfil.meuPerfil()).resident!.pontos).toBe(12);
  });

  it("pódio e ranking mostram só o top 3 aos moradores; a administração vê todos", async () => {
    const db = await getDb();
    // Quatro vizinhos com mais pontos que o morador de teste no mês: ele fica abaixo do 3º lugar.
    for (const [indice, kg] of [100, 90, 80, 70].entries()) {
      const { id } = await admin.moradores.criar({ name: `Vizinho ${indice + 1}`, email: `vizinho${indice + 1}@teste.local`, phone: "11 90000-0000", block: "C", apartment: `30${indice}` });
      const coleta = await admin.coletas.criar({ residentId: id, wasteType: "reciclavel", block: "C", scheduledAt: amanha() });
      await admin.coletas.atualizarStatus({ id: coleta.id, status: "concluida", weightGrams: kg * 1000, imageDataUrl: FOTO });
    }
    await db.update(moradores).set({ ocultarNomeNoPodio: true }).where(eq(moradores.email, "vizinho2@teste.local"));

    const visaoMorador = await morador.podio.ranking({ periodo: "mensal" });
    expect(visaoMorador.ranking.map((linha) => linha.position)).toEqual([1, 2, 3]);
    expect(visaoMorador.ranking.map((linha) => linha.nome)).toEqual(["Vizinho 1", "Morador(a) do bloco C", "Vizinho 3"]);
    expect(visaoMorador.ranking.every((linha) => linha.moradorId === null && linha.apartamento === null)).toBe(true);
    expect(JSON.stringify(visaoMorador)).not.toContain("Vizinho 4");
    expect(visaoMorador.minhaPosicao!.position).toBeGreaterThan(3);

    const engajamento = await morador.engajamento.ranking();
    expect(engajamento.linhas.length).toBeLessThanOrEqual(3);
    expect(JSON.stringify(engajamento)).not.toMatch(/Vizinho 4|vizinho4@|90000/);
    expect(engajamento.minhaPosicao?.position).toBeGreaterThan(3);

    const visaoAdmin = await admin.podio.ranking({ periodo: "mensal" });
    expect(visaoAdmin.ranking.length).toBe(visaoMorador.totalParticipantes);
    expect(visaoAdmin.ranking.some((linha) => linha.nome === "Vizinho 4")).toBe(true);
    expect((await admin.engajamento.ranking()).linhas.length).toBeGreaterThan(3);
  });

  it("prêmio do pódio: configurado pelo administrador e entregue só a quem está no top 3", async () => {
    const podio = await admin.podio.ranking({ periodo: "mensal" });
    const campeao = podio.ranking[0];
    const quarto = podio.ranking.find((linha) => linha.position > 3)!;
    await expect(admin.podio.marcarPremioEntregue({ moradorId: campeao.moradorId!, periodo: "mensal" })).rejects.toThrow(/Defina o prêmio/);
    await admin.podio.configurarPremios({ periodo: "mensal", premios: [{ posicao: 1, titulo: "Cesta de datas comemorativas", descricao: "Paga com a venda dos recicláveis" }] });
    await expect(morador.podio.configurarPremios({ periodo: "mensal", premios: [] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await morador.podio.ranking({ periodo: "mensal" })).ranking[0].premio?.titulo).toBe("Cesta de datas comemorativas");
    await admin.podio.marcarPremioEntregue({ moradorId: campeao.moradorId!, periodo: "mensal", observacao: "Entregue na portaria" });
    await expect(admin.podio.marcarPremioEntregue({ moradorId: campeao.moradorId!, periodo: "mensal" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(admin.podio.marcarPremioEntregue({ moradorId: quarto.moradorId!, periodo: "mensal" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await admin.podio.historicoPremios())[0]).toMatchObject({ premio: "Cesta de datas comemorativas", posicao: 1 });
    await expect(morador.podio.historicoPremios()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});


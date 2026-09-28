import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Testes obrigatórios do plano de melhorias (item 12), num banco MySQL temporário e exclusivo deste arquivo.
vi.hoisted(() => {
  const endereco = new URL(process.env.DATABASE_URL || "mysql://root@127.0.0.1:3306/ecocondo");
  endereco.pathname = `/ecocondo_teste_plano_${process.pid}_${Date.now()}`;
  process.env.DATABASE_URL = endereco.toString();
});

import { and, eq } from "drizzle-orm";
import { apagarBanco, fecharDb, getDb, getUserByOpenId, prepararBanco, upsertUser, urlDoBanco } from "../db";
import { mysqlDisponivelParaTestes } from "../testes/mysqlTeste";
import { appRouter } from "../rotas";
import { coletas, logsAuditoria, moradores, movimentacoesPontos } from "../../drizzle/schema";
import { definirSorteioAmostragem } from "../dominio/estacaoPesagem";
import { saldosInconsistentes } from "../pontos";
import { CABECALHO_TOKEN_ESTACAO } from "./estacoes";
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

function chamador(usuario: Usuario | null) {
  return appRouter.createCaller({ user: usuario, req: { protocol: "https", headers: {} }, res: { clearCookie: vi.fn() } } as unknown as TrpcContext);
}

function tablet(token: string) {
  return appRouter.createCaller({ user: null, req: { protocol: "https", headers: { [CABECALHO_TOKEN_ESTACAO]: token } }, res: { clearCookie: vi.fn() } } as unknown as TrpcContext);
}

/** Cada teste usa um morador novo: o intervalo mínimo e o limite diário da estação valem por morador. */
async function novoMorador(apelido: string) {
  const usuario = await criarUsuario(apelido, `${apelido}@teste.local`);
  const cliente = chamador(usuario);
  const perfil = await cliente.perfil.meuPerfil();
  return { cliente, usuario, moradorId: perfil.resident!.id };
}

async function saldo(moradorId: number) {
  const db = await getDb();
  return (await db.select({ pontos: moradores.pontos }).from(moradores).where(eq(moradores.id, moradorId)))[0].pontos;
}

let admin: ReturnType<typeof chamador>;
let admin2: ReturnType<typeof chamador>;
let estacaoDemo: ReturnType<typeof tablet>;

beforeAll(async () => {
  if (!mysqlDisponivel) return;
  await prepararBanco();
  admin = chamador(await criarUsuario("plano-admin", "plano-admin@teste.local", "administrador"));
  await admin.perfil.meuPerfil();
  admin2 = chamador(await criarUsuario("plano-admin-2", "plano-admin2@teste.local", "administrador"));
  await admin2.perfil.meuPerfil();
  definirSorteioAmostragem(() => 1);
  const { id, token } = await admin.estacoes.criar({ name: "Estação da banca", location: "Notebook da apresentação" });
  await admin.estacoes.definirModoDemonstracao({ id, enabled: true });
  estacaoDemo = tablet(token);
});

afterAll(async () => {
  if (!mysqlDisponivel) return;
  await fecharDb();
  await apagarBanco(urlDoBanco());
});

describeComMysql("plano de melhorias: testes obrigatórios", () => {
  it("sem login não entra; perfil errado não acessa rotas da administração nem dados de outro morador", async () => {
    const anonimo = chamador(null);
    await expect(anonimo.dashboard.resumo()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anonimo.notificacoes.listar()).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    const { cliente: morador } = await novoMorador("perfil-errado");
    const { moradorId: outro } = await novoMorador("perfil-outro");
    await expect(morador.relatorios.visaoGeral()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(morador.relatorios.exportarCsv({ kind: "pontos" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(morador.auditoria.listar()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(morador.coletas.reprovar({ id: 1, motivo: "tentativa indevida" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(morador.estacoes.definirModoDemonstracao({ id: 1, enabled: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(morador.engajamento.atualizarRecompensa({ id: 1, stock: 99 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(morador.engajamento.extrato({ residentId: outro })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // O administrador não gera código de estação nem resgata prêmio: essas ações são do morador.
    await expect(admin.estacao.gerarCodigo()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("coleta: o morador solicita, a administração é avisada, cancela com motivo auditado e não conclui sem peso", async () => {
    const { cliente: morador, moradorId } = await novoMorador("fluxo-coleta");
    const { id } = await morador.coletas.criar({ wasteType: "eletronico", block: "A", scheduledAt: amanha(), notes: "Monitor antigo" });
    expect((await morador.notificacoes.listar()).some((item) => item.tipo === "solicitacao_criada" && item.coletaId === id)).toBe(true);
    expect((await admin.notificacoes.listar()).some((item) => item.tipo === "nova_coleta" && item.coletaId === id)).toBe(true);

    await expect(admin.coletas.atualizarStatus({ id, status: "concluida", weightGrams: 0, imageDataUrl: FOTO })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await admin.coletas.atualizarStatus({ id, status: "cancelada", notes: "Morador pediu para remarcar" });
    const db = await getDb();
    const [log] = await db.select().from(logsAuditoria).where(and(eq(logsAuditoria.tipoEntidade, "coleta"), eq(logsAuditoria.entidadeId, id), eq(logsAuditoria.acao, "coleta_atualizada")));
    expect(log?.motivo).toBe("Morador pediu para remarcar");
    await expect(admin.coletas.atualizarStatus({ id, status: "em_andamento" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await saldo(moradorId)).toBe(0);
  });

  it("código da estação: válido mostra a prévia sem gastar o código; inválido, expirado e reutilizado são recusados", async () => {
    const { cliente: morador, moradorId } = await novoMorador("codigo-estacao");
    const { code, qrDataUrl } = await morador.estacao.gerarCodigo();
    expect(qrDataUrl).toMatch(/^data:image\/png;base64,/);
    const notificacao = (await morador.notificacoes.listar()).find((item) => item.tipo === "codigo_estacao");
    expect(notificacao?.mensagem).not.toContain(code);

    const previa = await estacaoDemo.estacao.previa({ code, wasteType: "reciclavel", weightGrams: 2500 });
    expect(previa).toMatchObject({ estacao: "Estação da banca", pesoKg: "2,50", unidade: "kg", pesagemSimulada: true, pontosPrevistos: 2, bloqueio: null });
    const outro = code === "000000" ? "000001" : "000000";
    await expect(estacaoDemo.estacao.previa({ code: outro, wasteType: "reciclavel", weightGrams: 2500 })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const registro = await estacaoDemo.estacao.registrar({ code, wasteType: "reciclavel", weightGrams: 2500 });
    expect(registro).toMatchObject({ status: "concluida", pointsAwarded: 2, pendingApproval: false, simulated: true });
    await expect(estacaoDemo.estacao.registrar({ code, wasteType: "reciclavel", weightGrams: 2500 })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const { code: expirado } = await morador.estacao.gerarCodigo();
    const db = await getDb();
    await db.update(moradores).set({ codigoEstacaoExpiraEm: new Date(Date.now() - 60_000) }).where(eq(moradores.id, moradorId));
    await expect(estacaoDemo.estacao.identificar({ code: expirado })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("peso: normal pontua, zero e negativo são recusados, acima do limite é barrado e a mesma coleta não é pesada duas vezes", async () => {
    const { cliente: morador, moradorId } = await novoMorador("pesos");
    const { code } = await morador.estacao.gerarCodigo();
    await expect(estacaoDemo.estacao.registrar({ code, wasteType: "reciclavel", weightGrams: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(estacaoDemo.estacao.registrar({ code, wasteType: "reciclavel", weightGrams: -500 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(estacaoDemo.estacao.registrar({ code, wasteType: "reciclavel", weightGrams: 31_000 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const previaAcima = await estacaoDemo.estacao.previa({ code, wasteType: "reciclavel", weightGrams: 31_000 });
    expect(previaAcima.bloqueio).toMatch(/limite/);

    const registro = await estacaoDemo.estacao.registrar({ code, wasteType: "reciclavel", weightGrams: 4000 });
    expect(registro.pointsAwarded).toBe(4);
    expect(await saldo(moradorId)).toBe(4);
    const db = await getDb();
    expect((await db.select().from(coletas).where(eq(coletas.id, registro.id)))[0]).toMatchObject({ pesoGramas: 4000, pesagemSimulada: true, status: "concluida" });
    await expect(admin.coletas.atualizarStatus({ id: registro.id, status: "concluida", weightGrams: 4000, imageDataUrl: FOTO })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const creditos = await db.select().from(movimentacoesPontos).where(and(eq(movimentacoesPontos.coletaId, registro.id), eq(movimentacoesPontos.tipo, "credito_coleta")));
    expect(creditos).toHaveLength(1);
  });

  it("pontos: registro suspeito fica pendente, a aprovação credita, a reprovação com motivo estorna e tudo fica no extrato e na auditoria", async () => {
    const { cliente: morador, moradorId } = await novoMorador("pontos-fluxo");
    const { code } = await morador.estacao.gerarCodigo();
    const pendente = await estacaoDemo.estacao.registrar({ code, wasteType: "reciclavel", weightGrams: 12_000 });
    expect(pendente).toMatchObject({ pointsAwarded: 0, pendingApproval: true, pendingPoints: 12 });
    expect((await morador.notificacoes.listar()).some((item) => item.tipo === "pontos_pendentes" && item.coletaId === pendente.id)).toBe(true);
    // Acima de 10 kg sem histórico que explique: a administração recebe "pontos pendentes" (fora do padrão do morador seria "peso suspeito").
    expect((await admin.notificacoes.listar()).some((item) => item.tipo === "pontos_pendentes" && item.coletaId === pendente.id)).toBe(true);
    expect(await saldo(moradorId)).toBe(0);

    await expect(admin.coletas.decidirAprovacaoPeso({ id: pendente.id, aprovar: false })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await admin.coletas.decidirAprovacaoPeso({ id: pendente.id, aprovar: true });
    expect(await saldo(moradorId)).toBe(12);
    await expect(admin2.coletas.decidirAprovacaoPeso({ id: pendente.id, aprovar: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await expect(admin.coletas.reprovar({ id: pendente.id, motivo: "ruim" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const reprovacao = await admin.coletas.reprovar({ id: pendente.id, motivo: "Saco com vidro quebrado e rejeito misturado" });
    expect(reprovacao.pointsReversed).toBe(12);
    expect(await saldo(moradorId)).toBe(0);
    await expect(admin2.coletas.reprovar({ id: pendente.id, motivo: "Segunda reprovação da mesma coleta" })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const extrato = await morador.engajamento.extrato();
    expect(extrato.movimentacoes.map((item) => [item.tipo, item.pontos, item.saldoApos])).toEqual([["estorno_coleta", -12, 0], ["credito_coleta", 12, 12]]);
    const tipos = (await morador.notificacoes.listar()).map((item) => item.tipo);
    expect(tipos).toEqual(expect.arrayContaining(["revisao_administrativa", "pontos_ganhos", "coleta_reprovada", "pontos_estornados"]));
    const db = await getDb();
    const [log] = await db.select().from(logsAuditoria).where(and(eq(logsAuditoria.entidadeId, pendente.id), eq(logsAuditoria.acao, "coleta_reprovada")));
    expect(log).toMatchObject({ motivo: "Saco com vidro quebrado e rejeito misturado" });
    expect(log.estadoAnterior).toContain("concluida");
    expect(log.estadoNovo).toContain("rejeitado");
  });

  it("notificações: criar, listar, abrir (marca como lida), marcar uma e marcar todas", async () => {
    const { cliente: morador } = await novoMorador("notificacoes");
    await admin.notificacoes.criarComunicado({ title: "Coleta de eletrônicos", message: "Sábado, das 9h às 12h, no hall do bloco C." });
    const { code } = await morador.estacao.gerarCodigo();
    await estacaoDemo.estacao.registrar({ code, wasteType: "reciclavel", weightGrams: 2000 });
    const lista = await morador.notificacoes.listar();
    expect(lista.map((item) => item.tipo)).toEqual(expect.arrayContaining(["comunicado", "codigo_estacao", "pesagem_registrada", "coleta_concluida", "pontos_ganhos"]));
    const antes = (await morador.notificacoes.contagemNaoLidas()).count;
    expect(antes).toBeGreaterThan(0);

    const pesagem = lista.find((item) => item.tipo === "pesagem_registrada")!;
    expect((await morador.notificacoes.abrir({ id: pesagem.id })).lidaEm).toBeTruthy();
    expect((await morador.notificacoes.contagemNaoLidas()).count).toBe(antes - 1);
    const comunicado = lista.find((item) => item.tipo === "comunicado")!;
    await morador.notificacoes.marcarLida({ id: comunicado.id });
    expect((await morador.notificacoes.contagemNaoLidas()).count).toBe(antes - 2);
    await morador.notificacoes.marcarTodasLidas();
    expect((await morador.notificacoes.contagemNaoLidas()).count).toBe(0);

    // Ninguém abre a notificação pessoal de outra pessoa.
    const { cliente: vizinho } = await novoMorador("notificacoes-vizinho");
    await expect(vizinho.notificacoes.abrir({ id: pesagem.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("resgate: com saldo e estoque dá certo; sem saldo ou sem estoque é recusado, avisado e nada é descontado", async () => {
    const { cliente: morador, moradorId } = await novoMorador("resgates");
    const { code } = await morador.estacao.gerarCodigo();
    await estacaoDemo.estacao.registrar({ code, wasteType: "reciclavel", weightGrams: 6000 });
    expect(await saldo(moradorId)).toBe(6);
    const caro = await admin.engajamento.criarRecompensa({ title: "Prêmio caro", description: "Custa mais que o saldo", pointsCost: 50, stock: 5 });
    const ultimo = await admin.engajamento.criarRecompensa({ title: "Último brinde", description: "Só uma unidade", pointsCost: 4, stock: 1 });

    await expect(morador.engajamento.resgatar({ rewardId: caro.id })).rejects.toThrow(/insuficiente/);
    expect(await saldo(moradorId)).toBe(6);
    const resultado = await morador.engajamento.resgatar({ rewardId: ultimo.id });
    expect(resultado).toMatchObject({ success: true, balance: 2 });
    expect((await admin.notificacoes.listar()).some((item) => item.tipo === "sem_estoque" && item.mensagem.includes("Último brinde"))).toBe(true);

    const { cliente: vizinho, moradorId: vizinhoId } = await novoMorador("resgates-vizinho");
    const { code: codigoVizinho } = await vizinho.estacao.gerarCodigo();
    await estacaoDemo.estacao.registrar({ code: codigoVizinho, wasteType: "reciclavel", weightGrams: 5000 });
    await expect(vizinho.engajamento.resgatar({ rewardId: ultimo.id })).rejects.toThrow(/sem estoque/);
    expect(await saldo(vizinhoId)).toBe(5);
    expect((await vizinho.notificacoes.listar()).filter((item) => item.tipo === "resgate_recusado")).toHaveLength(1);
    expect((await morador.notificacoes.listar()).filter((item) => item.tipo === "resgate_recusado")).toHaveLength(1);

    // Recompensa desativada some do catálogo do morador e não pode ser resgatada.
    await admin.engajamento.atualizarRecompensa({ id: caro.id, active: false });
    expect((await morador.engajamento.recompensas()).some((item) => item.id === caro.id)).toBe(false);
    await expect(morador.engajamento.resgatar({ rewardId: caro.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("painel e relatórios: indicadores do mês, alertas da administração e top 3 sem expor os demais moradores", async () => {
    const painelAdmin = await admin.dashboard.resumo();
    expect(painelAdmin.evolucao).toHaveLength(6);
    expect(painelAdmin.comparacao.atual.coletas).toBeGreaterThan(0);
    expect(painelAdmin.pontosMes.distribuidos).toBeGreaterThan(0);
    expect(painelAdmin.pontosMes.estornados).toBeGreaterThanOrEqual(12);
    expect(painelAdmin.alertas.map((item) => item.id)).toEqual(expect.arrayContaining(["sem-estoque"]));
    expect(painelAdmin.top3.length).toBeLessThanOrEqual(3);

    const { cliente: morador } = await novoMorador("painel-morador");
    const painelMorador = await morador.dashboard.resumo();
    expect(painelMorador.alertas).toEqual([]);
    expect(painelMorador.top3.length).toBeLessThanOrEqual(3);
    expect(painelMorador.saldo).toBe(0);
    expect(painelMorador.minhaPosicao).toBeNull();

    const relatorio = await admin.relatorios.visaoGeral();
    expect(relatorio.rejectedCount).toBeGreaterThan(0);
    expect(relatorio.pontos.estornados).toBeGreaterThan(0);
    expect(relatorio.resgates.total).toBeGreaterThan(0);
    expect(relatorio.auditEvents).toBeGreaterThan(0);
    const planilha = await admin.relatorios.exportarCsv({ kind: "pontos" });
    expect(planilha.content).toContain("Estorno de coleta");
    const auditoria = await admin.relatorios.exportarCsv({ kind: "auditoria" });
    expect(auditoria.content).toContain("Saco com vidro quebrado");
  });

  it("consistência: todo saldo de pontos fecha com a soma do extrato", async () => {
    expect(await saldosInconsistentes(await getDb())).toEqual([]);
  });
});

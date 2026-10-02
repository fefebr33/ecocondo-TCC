import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Banco MySQL temporário e exclusivo deste arquivo (mesmo servidor do DATABASE_URL), com as migrações reais aplicadas.
vi.hoisted(() => {
  const endereco = new URL(process.env.DATABASE_URL || "mysql://root@127.0.0.1:3306/ecocondo");
  endereco.pathname = `/ecocondo_teste_fluxos_${process.pid}_${Date.now()}`;
  process.env.DATABASE_URL = endereco.toString();
});

import { eq, inArray } from "drizzle-orm";
import { apagarBanco, fecharDb, getDb, getUserByOpenId, prepararBanco, upsertUser, urlDoBanco } from "../db";
import { mysqlDisponivelParaTestes } from "../testes/mysqlTeste";
import { appRouter } from "../rotas";
import { coletas, moradores, pessoas, recompensas, usuarios } from "../../drizzle/schema";
import { CABECALHO_TOKEN_ESTACAO } from "./estacoes";
import type { TrpcContext } from "../_core/context";
import type { Usuario } from "../../drizzle/schema";

const mysqlDisponivel = await mysqlDisponivelParaTestes();
const describeComMysql = mysqlDisponivel ? describe : describe.skip;

const FOTO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function criarUsuario(idExterno: string, email: string, papel: "administrador" | "usuario" = "usuario") {
  await upsertUser({ idExterno, nome: idExterno, email, metodoLogin: "teste", papel });
  return (await getUserByOpenId(idExterno)) as Usuario;
}

function chamador(usuario: Usuario) {
  return appRouter.createCaller({ user: usuario, req: { protocol: "https", headers: {} }, res: { clearCookie: vi.fn() } } as unknown as TrpcContext);
}

/** O tablet da estação de pesagem: sem pessoa logada, só o código de pareamento no cabeçalho. */
function tablet(token?: string) {
  return appRouter.createCaller({ user: null, req: { protocol: "https", headers: token ? { [CABECALHO_TOKEN_ESTACAO]: token } : {} }, res: { clearCookie: vi.fn(), cookie: vi.fn() } } as unknown as TrpcContext);
}

let admin: ReturnType<typeof chamador>;
let admin2: ReturnType<typeof chamador>;
let morador: ReturnType<typeof chamador>;
let usuarioAdmin: Usuario;
let moradorId: number;
let tokenEstacao: string;

type Item = { wasteType: "reciclavel" | "organico" | "rejeito" | "eletronico" | "perigoso"; weightGrams: number };
/** O morador gera o código e descarta na estação pareada; o descarte fica pendente de aprovação. */
async function descartar(pessoa: ReturnType<typeof chamador>, itens: Item[]) {
  const { code } = await pessoa.estacao.gerarCodigo();
  const { ids } = await tablet(tokenEstacao).estacao.registrar({ code, itens: itens.map((item) => ({ ...item, imageDataUrl: FOTO })) });
  // Recua 11 minutos, para o próximo descarte da mesma pessoa não esbarrar no intervalo mínimo entre descartes.
  await (await getDb()).update(coletas).set({ concluidaEm: new Date(Date.now() - 11 * 60 * 1000) }).where(inArray(coletas.id, ids));
  return ids;
}

beforeAll(async () => {
  if (!mysqlDisponivel) return;
  await prepararBanco();
  usuarioAdmin = await criarUsuario("admin-1", "admin1@teste.local", "administrador");
  admin = chamador(usuarioAdmin);
  await admin.perfil.meuPerfil();
  // Estes testes cobrem a conferência manual: sem adesivo obrigatório e sem aprovação automática da IA (cobertas em iaAdesivos.database.test.ts).
  await admin.configuracoesIa.salvar({ iaAprovacaoAutomatica: false, iaConfiancaMinima: 80, adesivoObrigatorio: false });
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

  it("não existe mais agendamento nem lançamento manual de descarte pela administração", () => {
    expect("criar" in (appRouter._def.record.coletas as Record<string, unknown>)).toBe(false);
    expect("atualizarStatus" in (appRouter._def.record.coletas as Record<string, unknown>)).toBe(false);
    expect("recorrencias" in appRouter._def.record).toBe(false);
  });

  it("administrador não consegue alterar o próprio perfil", async () => {
    const db = await getDb();
    const minhaPessoa = (await db.select().from(pessoas).where(eq(pessoas.usuarioId, usuarioAdmin.id)))[0];
    await expect(admin.pessoas.definirPapel({ id: minhaPessoa.id, role: "morador" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await admin.perfil.meuPerfil()).role).toBe("administrador");
  });

  it("resgate respeita estoque e pontos, e cancelar devolve os dois", async () => {
    await admin.pontos.ajustar({ residentId: moradorId, points: 2, reason: "Pontos para testar o resgate" });
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
  it("estação de pesagem: só tablet pareado registra, com código de uso único, e tudo fica pendente de aprovação", async () => {
    const { id: estacaoId, token } = await admin.estacoes.criar({ name: "Lixeiras do térreo", location: "Garagem" });
    tokenEstacao = token;
    expect(JSON.stringify(await admin.estacoes.listar())).not.toContain(token);
    await expect(tablet().estacao.status()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(tablet("codigo-inventado-123").estacao.status()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const estacao = tablet(token);
    const status = await estacao.estacao.status();
    expect(status.nome).toBe("Lixeiras do térreo");
    expect(status.tipos.find((tipo) => tipo.tipo === "reciclavel")).toMatchObject({ corSaco: "#1f6fd1", pesoMaximoKg: 30 });
    await expect(admin.estacao.gerarCodigo()).rejects.toMatchObject({ code: "FORBIDDEN" });

    const antes = (await morador.perfil.meuPerfil()).resident!.pontos;
    const { code } = await morador.estacao.gerarCodigo();
    expect(code).toMatch(/^\d{6}$/);
    const outroCodigo = code === "000000" ? "000001" : "000000";
    await expect(estacao.estacao.identificar({ code: outroCodigo })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await estacao.estacao.identificar({ code })).toMatchObject({ firstName: "morador-1" });
    // Sem foto, fora do mínimo/máximo do tipo ou com o mesmo tipo repetido: recusado.
    await expect(estacao.estacao.registrar({ code, itens: [{ wasteType: "reciclavel", weightGrams: 3000, imageDataUrl: "" }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(estacao.estacao.registrar({ code, itens: [{ wasteType: "reciclavel", weightGrams: 31_000, imageDataUrl: FOTO }] })).rejects.toThrow(/passa do limite/);
    await expect(estacao.estacao.registrar({ code, itens: [{ wasteType: "perigoso", weightGrams: 5, imageDataUrl: FOTO }] })).rejects.toThrow(/mínimo/);
    await expect(estacao.estacao.registrar({ code, itens: [{ wasteType: "reciclavel", weightGrams: 1000, imageDataUrl: FOTO }, { wasteType: "reciclavel", weightGrams: 1000, imageDataUrl: FOTO }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const previa = await estacao.estacao.previa({ code, itens: [{ wasteType: "reciclavel", weightGrams: 3000 }, { wasteType: "eletronico", weightGrams: 1500 }, { wasteType: "rejeito", weightGrams: 800 }] });
    expect(previa.itens.map((item) => item.pontosPrevistos)).toEqual([3, 3, 0]);

    // Um descarte com três tipos de uma vez: três registros no mesmo lote, todos pendentes e sem pontos até a aprovação.
    const registro = await estacao.estacao.registrar({ code, itens: [{ wasteType: "reciclavel", weightGrams: 3000, imageDataUrl: FOTO }, { wasteType: "eletronico", weightGrams: 1500, imageDataUrl: FOTO }, { wasteType: "rejeito", weightGrams: 800, imageDataUrl: FOTO }] });
    expect(registro).toMatchObject({ pointsAwarded: 0, pendingApproval: true, pendingPoints: 6, situacao: "pendente" });
    expect(registro.ids).toHaveLength(3);
    expect((await morador.perfil.meuPerfil()).resident!.pontos).toBe(antes);
    const db = await getDb();
    const gravadas = await db.select().from(coletas).where(eq(coletas.lote, registro.lote));
    expect(gravadas).toHaveLength(3);
    expect(gravadas.every((item) => item.estacaoId === estacaoId && item.status === "concluida" && item.aprovacaoPesoStatus === "pendente" && item.urlFoto)).toBe(true);
    const listados = await admin.coletas.listar({ situacao: "pendente" });
    expect(listados.find((item) => item.id === registro.id)).toMatchObject({ origin: "Estação: Lixeiras do térreo", situacao: "pendente", pontosPrevistos: 3 });
    expect((await morador.coletas.detalhe({ id: registro.ids[1] })).itens).toHaveLength(3);
    expect((await admin2.notificacoes.listar()).some((item) => item.coletaId === registro.id && item.tipo === "descarte_aguardando_aprovacao")).toBe(true);

    // Aprovação: os pontos entram pela regra de cada tipo (rejeito não pontua).
    const aprovacao = await admin.coletas.aprovarVarios({ ids: registro.ids });
    expect(aprovacao).toMatchObject({ aprovados: 3, pontos: 6 });
    expect((await morador.perfil.meuPerfil()).resident!.pontos).toBe(antes + 6);
    expect((await admin.coletas.listar()).find((item) => item.id === registro.id)?.situacao).toBe("aprovado");

    // O código não vale de novo, e um segundo registro logo em seguida é recusado.
    await expect(estacao.estacao.registrar({ code, itens: [{ wasteType: "reciclavel", weightGrams: 3000, imageDataUrl: FOTO }] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const { code: segundo } = await morador.estacao.gerarCodigo();
    await expect(estacao.estacao.registrar({ code: segundo, itens: [{ wasteType: "reciclavel", weightGrams: 2000, imageDataUrl: FOTO }] })).rejects.toThrow(/Aguarde/);
    // Tira este descarte do dia, para os próximos testes não esbarrarem no intervalo mínimo.
    await db.update(coletas).set({ concluidaEm: new Date(Date.now() - 3 * 60 * 60 * 1000) }).where(eq(coletas.lote, registro.lote));

    // Estação desativada deixa de funcionar na hora.
    await admin.estacoes.alternar({ id: estacaoId, active: false });
    await expect(estacao.estacao.status()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await admin.estacoes.alternar({ id: estacaoId, active: true });
    const { token: novoToken } = await admin.estacoes.novoCodigo({ id: estacaoId });
    await expect(estacao.estacao.status()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect((await tablet(novoToken).estacao.status()).id).toBe(estacaoId);
    tokenEstacao = novoToken;
  });

  it("reprovação com motivo estorna os pontos de um descarte aprovado; pendente reprovado não credita nada", async () => {
    const vizinho = chamador(await criarUsuario("morador-reprova", "reprova@teste.local"));
    await vizinho.perfil.meuPerfil();
    const [primeiro] = await descartar(vizinho, [{ wasteType: "reciclavel", weightGrams: 4000 }]);
    await admin.coletas.aprovarVarios({ ids: [primeiro] });
    expect((await vizinho.perfil.meuPerfil()).resident!.pontos).toBe(4);
    const reprovacao = await admin.coletas.reprovar({ id: primeiro, motivo: "Material misturado com orgânico" });
    expect(reprovacao.pointsReversed).toBe(4);
    expect((await vizinho.perfil.meuPerfil()).resident!.pontos).toBe(0);

    const [segundo] = await descartar(vizinho, [{ wasteType: "reciclavel", weightGrams: 2000 }]);
    await expect(admin.coletas.decidirAprovacaoPeso({ id: segundo, aprovar: false })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await admin.coletas.decidirAprovacaoPeso({ id: segundo, aprovar: false, observacao: "Foto sem o visor da balança" });
    expect((await vizinho.perfil.meuPerfil()).resident!.pontos).toBe(0);
    expect((await vizinho.coletas.listar()).find((item) => item.id === segundo)?.situacao).toBe("reprovado");
    expect((await vizinho.notificacoes.listar()).some((item) => item.coletaId === segundo && item.tipo === "coleta_reprovada")).toBe(true);
  });

  it("auditoria: o morador é avisado; regular aprova, irregular reprova e pode punir com perda de pontos", async () => {
    const vizinho = chamador(await criarUsuario("morador-auditoria", "auditoria@teste.local"));
    await vizinho.perfil.meuPerfil();
    const [suspeito, outro] = await descartar(vizinho, [{ wasteType: "reciclavel", weightGrams: 9000 }, { wasteType: "organico", weightGrams: 4000 }]);
    await admin.coletas.abrirAuditoria({ id: suspeito, motivo: "Mesmo saco pesado duas vezes na foto" });
    await expect(admin.coletas.decidirAprovacaoPeso({ id: suspeito, aprovar: true })).rejects.toThrow(/auditoria/);
    const aviso = (await vizinho.notificacoes.listar()).find((item) => item.coletaId === suspeito && item.tipo === "auditoria_aberta");
    expect(aviso?.mensagem).toMatch(/mal-entendido/);
    expect((await vizinho.coletas.listar()).find((item) => item.id === suspeito)?.situacao).toBe("auditoria");

    await admin.coletas.aprovarVarios({ ids: [outro] });
    expect((await vizinho.perfil.meuPerfil()).resident!.pontos).toBe(2);
    await expect(admin.coletas.concluirAuditoria({ id: suspeito, resultado: "regular", parecer: "Foi um mal-entendido, tudo certo.", penalidadePontos: 3 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const irregular = await admin.coletas.concluirAuditoria({ id: suspeito, resultado: "irregular", parecer: "O morador confirmou que pesou duas vezes.", penalidadePontos: 1 });
    expect(irregular.penalty).toBe(1);
    expect((await vizinho.perfil.meuPerfil()).resident!.pontos).toBe(1);
    expect((await vizinho.engajamento.extrato()).movimentacoes.some((linha) => linha.tipo === "penalidade" && linha.pontos === -1)).toBe(true);
    expect((await admin.auditoria.listar({})).some((linha) => linha.acao === "auditoria_aberta" && linha.entidadeId === suspeito)).toBe(true);
  });

  it("regras por tipo: o administrador muda mínimo, máximo e pontos por kg, e a estação usa a regra nova", async () => {
    await admin.regrasDescarte.salvar({ wasteType: "organico", minGrams: 500, maxGrams: 8000, pointsPerKg: 2 });
    await expect(admin.regrasDescarte.salvar({ wasteType: "organico", minGrams: 5000, maxGrams: 1000, pointsPerKg: 2 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const regra = (await morador.regrasDescarte.listar()).find((item) => item.tipoResiduo === "organico");
    expect(regra).toMatchObject({ pesoMinimoGramas: 500, pesoMaximoGramas: 8000, pontosPorKg: 2, personalizada: true });
    const vizinho = chamador(await criarUsuario("morador-regra", "regra@teste.local"));
    await vizinho.perfil.meuPerfil();
    const { code } = await vizinho.estacao.gerarCodigo();
    await expect(tablet(tokenEstacao).estacao.registrar({ code, itens: [{ wasteType: "organico", weightGrams: 9000, imageDataUrl: FOTO }] })).rejects.toThrow(/passa do limite/);
    const previa = await tablet(tokenEstacao).estacao.previa({ code, itens: [{ wasteType: "organico", weightGrams: 3000 }] });
    expect(previa.pontosPrevistos).toBe(6);
    await admin.regrasDescarte.restaurarPadrao({ wasteType: "organico" });
    expect((await admin.regrasDescarte.listar()).find((item) => item.tipoResiduo === "organico")?.personalizada).toBe(false);
  });

  it("preferências de notificação: o administrador desliga um aviso por perfil, menos os obrigatórios", async () => {
    await expect(admin.preferenciasNotificacao.salvar({ role: "morador", type: "coleta_reprovada", active: false })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await admin.preferenciasNotificacao.salvar({ role: "morador", type: "pesagem_registrada", active: false });
    const antes = (await morador.notificacoes.listar()).filter((item) => item.tipo === "pesagem_registrada").length;
    await descartar(morador, [{ wasteType: "reciclavel", weightGrams: 1000 }]);
    expect((await morador.notificacoes.listar()).filter((item) => item.tipo === "pesagem_registrada").length).toBe(antes);
    expect((await admin.preferenciasNotificacao.listar()).find((item) => item.papel === "morador" && item.tipo === "pesagem_registrada")?.ativo).toBe(false);
    await admin.preferenciasNotificacao.salvar({ role: "morador", type: "pesagem_registrada", active: true });
    const { ultimaId } = await morador.notificacoes.novas({ afterId: 0 });
    expect((await morador.notificacoes.novas({ afterId: ultimaId })).itens).toHaveLength(0);

    // Avisos gerais (novo prêmio no catálogo) só aparecem para os perfis que recebem o tipo.
    await admin.engajamento.criarRecompensa({ title: "Caneca do condomínio", description: "Caneca de cerâmica.", pointsCost: 5, stock: 3 });
    expect((await morador.notificacoes.listar()).some((item) => item.tipo === "novo_premio")).toBe(true);
    expect((await admin.notificacoes.listar()).some((item) => item.tipo === "novo_premio")).toBe(false);
    await admin.preferenciasNotificacao.salvar({ role: "morador", type: "novo_premio", active: false });
    expect((await morador.notificacoes.listar()).some((item) => item.tipo === "novo_premio")).toBe(false);
    await admin.preferenciasNotificacao.salvar({ role: "morador", type: "novo_premio", active: true });
  });

  it("login com senha: link de primeiro acesso, senha forte, erro genérico e manual lido", async () => {
    const { id: personId } = await admin.pessoas.criar({ name: "Nova Moradora", email: "nova@teste.local", role: "morador", block: "D", apartment: "401" });
    const link = await admin.auth.gerarLinkAcesso({ personId });
    const token = new URL(link.caminho, "https://x").searchParams.get("token")!;
    const publico = tablet();
    expect(await publico.auth.lerLink({ token })).toMatchObject({ valido: true, email: "nova@teste.local", tipo: "primeiro_acesso" });
    await expect(publico.auth.definirSenha({ token, senha: "curta" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await publico.auth.definirSenha({ token, senha: "senhaForte123" });
    await expect(publico.auth.definirSenha({ token, senha: "senhaForte123" })).rejects.toThrow(/expirou|usado/);
    await expect(publico.auth.entrarComSenha({ email: "nova@teste.local", senha: "errada123" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(publico.auth.entrarComSenha({ email: "ninguem@teste.local", senha: "errada123" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(await publico.auth.entrarComSenha({ email: "NOVA@teste.local", senha: "senhaForte123" })).toMatchObject({ success: true, manualLido: false });

    const usuario = (await getDb()).select().from(usuarios).where(eq(usuarios.email, "nova@teste.local"));
    const [nova] = await usuario;
    expect(nova.senhaHash).toMatch(/^scrypt\$/);
    const moradora = chamador(nova);
    expect((await moradora.perfil.meuPerfil()).role).toBe("morador");
    const eu = await moradora.auth.me();
    expect(eu).toMatchObject({ temSenha: true, manualLido: false });
    expect(JSON.stringify(eu)).not.toContain("scrypt");
    await moradora.auth.marcarManualLido();
    const [atualizada] = await (await getDb()).select().from(usuarios).where(eq(usuarios.id, nova.id));
    expect(atualizada.manualLidoEm).toBeInstanceOf(Date);
    // O link de senha nunca volta na tela, nem para um e-mail cadastrado: quem entrega é o síndico.
    expect(await publico.auth.solicitarLink({ email: "ninguem@teste.local" })).toEqual({ enviado: true });
    expect(await publico.auth.solicitarLink({ email: "nova@teste.local" })).toEqual({ enviado: true });
  });

  it("painel pessoal: o morador vê o dele e o administrador abre o de qualquer morador", async () => {
    const painel = await morador.dashboard.morador();
    expect(painel.morador.id).toBe(moradorId);
    expect(painel.porTipo.map((item) => item.wasteType)).toEqual(["reciclavel", "organico", "rejeito", "eletronico", "perigoso"]);
    expect(painel.descartesAprovados).toBeGreaterThan(0);
    await expect(morador.dashboard.morador({ residentId: moradorId + 1000 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await admin.dashboard.morador({ residentId: moradorId })).morador.id).toBe(moradorId);
  });

  it("pódio e ranking mostram só o top 3 aos moradores; a administração vê todos", async () => {
    const db = await getDb();
    // Quatro vizinhos com mais pontos que o morador de teste no mês: ele fica abaixo do 3º lugar.
    for (const [indice, kg] of [28, 26, 24, 22].entries()) {
      await admin.moradores.criar({ name: `Vizinho ${indice + 1}`, email: `vizinho${indice + 1}@teste.local`, phone: "11 90000-0000", block: "C", apartment: `30${indice}` });
      const vizinho = chamador(await criarUsuario(`Vizinho ${indice + 1}`, `vizinho${indice + 1}@teste.local`));
      await vizinho.perfil.meuPerfil();
      await admin.coletas.aprovarVarios({ ids: await descartar(vizinho, [{ wasteType: "reciclavel", weightGrams: kg * 1000 }]) });
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

  it("zerar pontos de todos exige confirmação e motivo, fica no extrato e recomeça o ranking", async () => {
    await expect(admin.pontos.zerarTodos({ confirmation: "sim", reason: "Novo ciclo depois das cestas" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const ajuste = await admin.pontos.ajustar({ residentId: moradorId, points: 5, reason: "Bônus da campanha do mês" });
    expect(ajuste.saldo).toBeGreaterThanOrEqual(5);
    await expect(admin.pontos.ajustar({ residentId: moradorId, points: -9999, reason: "Débito maior que o saldo" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const resultado = await admin.pontos.zerarTodos({ confirmation: "ZERAR", reason: "Novo ciclo depois das cestas" });
    expect(resultado.moradores).toBeGreaterThan(0);
    expect((await morador.perfil.meuPerfil()).resident!.pontos).toBe(0);
    expect((await morador.engajamento.extrato()).movimentacoes[0].tipo).toBe("zeragem");
    expect((await admin.engajamento.ranking()).linhas).toHaveLength(0);
    expect((await morador.notificacoes.listar()).some((item) => item.tipo === "pontos_zerados")).toBe(true);
    expect((await admin.pontos.ciclo()).zeradoEm).toBeInstanceOf(Date);
  });
});


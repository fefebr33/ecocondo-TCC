import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// IA, adesivos QR, medidas administrativas, campanhas, ocorrências e avisos gerais (outubro de 2026), num banco MySQL temporário.
vi.hoisted(() => {
  const endereco = new URL(process.env.DATABASE_URL || "mysql://root@127.0.0.1:3306/ecocondo");
  endereco.pathname = `/ecocondo_teste_ia_${process.pid}_${Date.now()}`;
  process.env.DATABASE_URL = endereco.toString();
  // Os testes nunca chamam a API de verdade: a análise roda no modo de simulação.
  process.env.IA_SIMULACAO = "1";
});

import { and, eq, inArray } from "drizzle-orm";
import { apagarBanco, fecharDb, getDb, getUserByOpenId, prepararBanco, upsertUser, urlDoBanco } from "../db";
import { mysqlDisponivelParaTestes } from "../testes/mysqlTeste";
import { appRouter } from "../rotas";
import { analisesIa, campanhas, coletas, logsAuditoria, moradores, movimentacoesPontos, penalidades } from "../../drizzle/schema";
import { CABECALHO_TOKEN_ESTACAO } from "./estacoes";
import { processarCampanhas } from "../campanhas";
import { encerrarPenalidadesVencidas } from "../penalidades";
import { ID_EXTERNO_SISTEMA_IA } from "../ia/usuarioSistema";
import { PADRAO_CODIGO_ADESIVO } from "@shared/adesivos";
import type { TrpcContext } from "../_core/context";
import type { Usuario } from "../../drizzle/schema";

const mysqlDisponivel = await mysqlDisponivelParaTestes();
const describeComMysql = mysqlDisponivel ? describe : describe.skip;

async function criarUsuario(idExterno: string, email: string, papel: "administrador" | "usuario" = "usuario") {
  await upsertUser({ idExterno, nome: idExterno, email, metodoLogin: "teste", papel });
  return (await getUserByOpenId(idExterno)) as Usuario;
}

function chamador(usuario: Usuario) {
  return appRouter.createCaller({ user: usuario, req: { protocol: "https", headers: {} }, res: { clearCookie: vi.fn() } } as unknown as TrpcContext);
}

let tokenEstacao = "";
function tablet() {
  return appRouter.createCaller({ user: null, req: { protocol: "https", headers: { [CABECALHO_TOKEN_ESTACAO]: tokenEstacao } }, res: { clearCookie: vi.fn() } } as unknown as TrpcContext);
}

type Cliente = ReturnType<typeof chamador>;
type Simulacao = "tudo_certo" | "cor_errada" | "tipo_diferente" | "peso_diferente" | "foto_ilegivel";
let admin: Cliente;
let admin2: Cliente;
let ana: Cliente;
let bruno: Cliente;
let anaId: number;
let brunoId: number;
let anaUsuario: Usuario;

/** Descarte de um saco na estação de demonstração (foto opcional), com o adesivo e a "visão" simulada da IA. */
async function descartar(pessoa: Cliente, item: { wasteType?: "reciclavel" | "organico"; weightGrams?: number; stickerCode?: string | null; simulacaoIa?: Simulacao }, recuarMs = 26 * 60 * 60 * 1000) {
  const { code } = await pessoa.estacao.gerarCodigo();
  const resultado = await tablet().estacao.registrar({ code, itens: [{ wasteType: item.wasteType ?? "reciclavel", weightGrams: item.weightGrams ?? 3000, stickerCode: item.stickerCode ?? null, simulacaoIa: item.simulacaoIa ?? "tudo_certo" }] });
  // Recua para o dia anterior: o próximo descarte não esbarra no intervalo mínimo nem no limite de descartes por dia.
  if (recuarMs) await (await getDb()).update(coletas).set({ concluidaEm: new Date(Date.now() - recuarMs) }).where(inArray(coletas.id, resultado.ids));
  return resultado;
}

async function saldo(moradorId: number) {
  const [linha] = await (await getDb()).select({ pontos: moradores.pontos }).from(moradores).where(eq(moradores.id, moradorId));
  return linha.pontos;
}

/** Adesivos disponíveis do morador (os códigos, na ordem em que foram entregues). */
async function codigosDisponiveis(pessoa: Cliente) {
  return (await pessoa.adesivos.meus()).adesivos.filter((adesivo) => adesivo.status === "disponivel").map((adesivo) => adesivo.codigo).reverse();
}

beforeAll(async () => {
  if (!mysqlDisponivel) return;
  await prepararBanco();
  admin = chamador(await criarUsuario("ia-admin", "ia-admin@teste.local", "administrador"));
  await admin.perfil.meuPerfil();
  admin2 = chamador(await criarUsuario("ia-admin-2", "ia-admin2@teste.local", "administrador"));
  await admin2.perfil.meuPerfil();
  anaUsuario = await criarUsuario("ia-ana", "ana@teste.local");
  ana = chamador(anaUsuario);
  anaId = (await ana.perfil.meuPerfil()).resident!.id;
  bruno = chamador(await criarUsuario("ia-bruno", "bruno@teste.local"));
  brunoId = (await bruno.perfil.meuPerfil()).resident!.id;
  const estacao = await admin.estacoes.criar({ name: "Estação com IA", location: "Garagem" });
  await admin.estacoes.definirModoDemonstracao({ id: estacao.id, enabled: true });
  tokenEstacao = estacao.token;
});

afterAll(async () => {
  if (!mysqlDisponivel) return;
  await fecharDb();
  await apagarBanco(urlDoBanco());
});

describeComMysql("IA, adesivos QR, medidas, campanhas, ocorrências e avisos", () => {
  it("adesivos: o morador pede, a administração é avisada e entrega; códigos únicos sem dados pessoais", async () => {
    const config = await admin.configuracoesIa.obter();
    expect(config).toMatchObject({ iaAprovacaoAutomatica: true, adesivoObrigatorio: true, modoIa: "simulacao" });

    await ana.adesivos.solicitar({ quantidade: 6, observacao: "Kit inicial" });
    await expect(ana.adesivos.solicitar({ quantidade: 2 })).rejects.toThrow(/já tem um pedido/);
    expect((await admin.notificacoes.listar()).some((item) => item.tipo === "adesivos_solicitados")).toBe(true);
    const [pedido] = await admin.adesivos.pedidos({ status: "solicitado" });
    expect(pedido).toMatchObject({ moradorId: anaId, quantidadeSolicitada: 6, disponiveis: 0 });

    const entrega = await admin.adesivos.entregar({ moradorId: anaId, quantidade: 6, pedidoId: pedido.id });
    expect(entrega.codigos).toHaveLength(6);
    expect(new Set(entrega.codigos).size).toBe(6);
    for (const codigo of entrega.codigos) expect(codigo).toMatch(PADRAO_CODIGO_ADESIVO);
    await expect(admin.adesivos.entregar({ moradorId: anaId, quantidade: 6, pedidoId: pedido.id })).rejects.toThrow(/já foi atendido/);

    const meus = await ana.adesivos.meus();
    expect(meus).toMatchObject({ disponivel: 6, utilizado: 0, pedidoAberto: null });
    expect(meus.pedidos[0]).toMatchObject({ status: "entregue", quantidadeEntregue: 6 });
    expect((await ana.notificacoes.listar()).some((item) => item.tipo === "adesivos_entregues")).toBe(true);
    // Entrega direta (sem pedido) para o Bruno.
    await admin.adesivos.entregar({ moradorId: brunoId, quantidade: 3 });
    expect((await bruno.adesivos.meus()).disponivel).toBe(3);
    await expect(bruno.adesivos.pedidos()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("estação: exige adesivo do próprio morador; a IA aprova sozinha o saco certo e o adesivo vira usado", async () => {
    const { code } = await ana.estacao.gerarCodigo();
    const identificado = await tablet().estacao.identificar({ code });
    expect(identificado).toMatchObject({ adesivosDisponiveis: 6, adesivoObrigatorio: true });
    expect(identificado.adesivosDemonstracao).toHaveLength(5);
    await expect(tablet().estacao.registrar({ code, itens: [{ wasteType: "reciclavel", weightGrams: 3000 }] })).rejects.toThrow(/adesivo com QR Code/);
    const [doBruno] = await codigosDisponiveis(bruno);
    await expect(tablet().estacao.registrar({ code, itens: [{ wasteType: "reciclavel", weightGrams: 3000, stickerCode: doBruno }] })).rejects.toThrow(/não pertence a este morador/);

    const [primeiro] = await codigosDisponiveis(ana);
    const antes = await saldo(anaId);
    const resultado = await tablet().estacao.registrar({ code, itens: [{ wasteType: "reciclavel", weightGrams: 3000, stickerCode: primeiro.toLowerCase().replace(/-/g, " ") }] });
    expect(resultado).toMatchObject({ situacao: "aprovado", pendingApproval: false, pointsAwarded: 3, modoIa: "simulacao" });
    expect(resultado.itens[0]).toMatchObject({ adesivo: primeiro, situacao: "aprovado", ia: { resultado: "aprovado_automatico", motivos: [] } });
    expect(await saldo(anaId)).toBe(antes + 3);

    const db = await getDb();
    const [coleta] = await db.select().from(coletas).where(eq(coletas.id, resultado.id));
    expect(coleta).toMatchObject({ aprovacaoPesoStatus: "aprovado", pendenteAprovacaoPeso: false, pontosConcedidos: 3 });
    const sistema = await getUserByOpenId(ID_EXTERNO_SISTEMA_IA);
    expect(coleta.aprovacaoPesoPorId).toBe(sistema!.id);
    const [analise] = await db.select().from(analisesIa).where(eq(analisesIa.coletaId, resultado.id));
    expect(analise).toMatchObject({ modo: "simulacao", resultado: "aprovado_automatico", tipoIdentificado: "reciclavel", corSacoEsperada: "Azul" });
    const acoes = (await db.select({ acao: logsAuditoria.acao }).from(logsAuditoria).where(and(eq(logsAuditoria.tipoEntidade, "coleta"), eq(logsAuditoria.entidadeId, resultado.id)))).map((linha) => linha.acao);
    expect(acoes).toEqual(expect.arrayContaining(["registro_estacao", "descarte_aprovado_ia"]));
    // Uma notificação só para o morador, já com o resultado.
    const avisos = (await ana.notificacoes.listar()).filter((item) => item.coletaId === resultado.id);
    expect(avisos.map((item) => item.tipo)).toEqual(["descarte_aprovado_ia"]);

    // Uso único: o mesmo adesivo não vale de novo.
    await (await getDb()).update(coletas).set({ concluidaEm: new Date(Date.now() - 26 * 60 * 60 * 1000) }).where(eq(coletas.id, resultado.id));
    await expect(descartar(ana, { stickerCode: primeiro })).rejects.toThrow(/já foi usado/);
    const meus = await ana.adesivos.meus();
    expect(meus).toMatchObject({ disponivel: 5, utilizado: 1 });
    expect(meus.adesivos.find((adesivo) => adesivo.codigo === primeiro)).toMatchObject({ status: "utilizado", coletaId: resultado.id });
  });

  it("IA com divergência (cor do saco) deixa pendente, avisa a administração da irregularidade e não credita", async () => {
    const [codigo] = await codigosDisponiveis(ana);
    const antes = await saldo(anaId);
    const resultado = await descartar(ana, { stickerCode: codigo, simulacaoIa: "cor_errada" });
    expect(resultado).toMatchObject({ situacao: "pendente", pendingApproval: true, pointsAwarded: 0 });
    expect(resultado.itens[0].ia.motivos.join(" ")).toMatch(/Cor do saco identificada/);
    expect(await saldo(anaId)).toBe(antes);
    const alerta = (await admin.notificacoes.listar()).find((item) => item.coletaId === resultado.id);
    expect(alerta).toMatchObject({ tipo: "irregularidade_detectada" });
    expect((await ana.notificacoes.listar()).find((item) => item.coletaId === resultado.id)).toMatchObject({ tipo: "pesagem_registrada" });

    // O detalhe do descarte junta adesivo, estação, análise e histórico de alterações.
    const detalhe = await admin.coletas.detalhe({ id: resultado.id });
    expect(detalhe.estacao).toMatchObject({ nome: "Estação com IA", local: "Garagem" });
    expect(detalhe.itens[0]).toMatchObject({ adesivo: codigo, situacao: "pendente", analiseIa: { resultado: "pendente" } });
    expect(detalhe.itens[0].historico.map((item) => item.acao)).toContain("registro_estacao");
    // Aprovação manual depois da conferência.
    await admin.coletas.decidirAprovacaoPeso({ id: resultado.id, aprovar: true });
    expect(await saldo(anaId)).toBe(antes + 3);
  });

  it("com a aprovação automática desligada, até o saco certo fica para a administração", async () => {
    await admin.configuracoesIa.salvar({ iaAprovacaoAutomatica: false, iaConfiancaMinima: 80, adesivoObrigatorio: true });
    const [codigo] = await codigosDisponiveis(ana);
    const resultado = await descartar(ana, { stickerCode: codigo });
    expect(resultado.situacao).toBe("pendente");
    expect(resultado.itens[0].ia.motivos.join(" ")).toMatch(/aprovação automática está desligada/);
    await admin.coletas.decidirAprovacaoPeso({ id: resultado.id, aprovar: true });
    await admin.configuracoesIa.salvar({ iaAprovacaoAutomatica: true, iaConfiancaMinima: 80, adesivoObrigatorio: true });
  });

  it("reversão: a aprovação da IA é desfeita (pontos saem), volta para avaliação e pode ser aprovada de novo", async () => {
    const [codigo] = await codigosDisponiveis(ana);
    const { id } = await descartar(ana, { stickerCode: codigo });
    const aprovado = await saldo(anaId);
    await expect(ana.coletas.reverterAprovacao({ id, motivo: "Denúncia de saco misturado", destino: "nova_avaliacao" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const revertido = await admin.coletas.reverterAprovacao({ id, motivo: "Denúncia de saco misturado", destino: "nova_avaliacao" });
    expect(revertido).toMatchObject({ destino: "nova_avaliacao", pointsReversed: 3 });
    expect(await saldo(anaId)).toBe(aprovado - 3);
    expect((await admin.coletas.detalhe({ id })).itens[0]).toMatchObject({ situacao: "pendente", revisao: 1 });
    expect((await ana.notificacoes.listar()).some((item) => item.tipo === "descarte_revertido" && item.coletaId === id)).toBe(true);
    await admin.coletas.decidirAprovacaoPeso({ id, aprovar: true, observacao: "Conferido de novo: estava certo." });
    expect(await saldo(anaId)).toBe(aprovado);
    const extrato = await (await getDb()).select({ tipo: movimentacoesPontos.tipo, pontos: movimentacoesPontos.pontos }).from(movimentacoesPontos).where(eq(movimentacoesPontos.coletaId, id));
    expect(extrato).toEqual([{ tipo: "credito_coleta", pontos: 3 }, { tipo: "estorno_coleta", pontos: -3 }, { tipo: "credito_coleta", pontos: 3 }]);
  });

  it("leitura do QR: o administrador encontra o dono e o descarte, sem e-mail/telefone, e a consulta fica na auditoria", async () => {
    const usados = (await ana.adesivos.meus()).adesivos.filter((adesivo) => adesivo.status === "utilizado");
    const consulta = await admin.adesivos.consultar({ codigo: `https://ecocondo.exemplo/leitura?adesivo=${usados[0].codigo}`, finalidade: "Saco aberto na lixeira" });
    expect(consulta.morador).toMatchObject({ id: anaId, nome: "ia-ana" });
    expect(consulta.morador).not.toHaveProperty("email");
    expect(consulta.morador).not.toHaveProperty("telefone");
    expect(consulta.descarte).toMatchObject({ id: usados[0].coletaId, estacao: "Estação com IA" });
    expect(consulta.descarte!.ia).not.toBeNull();
    await expect(ana.adesivos.consultar({ codigo: usados[0].codigo })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(admin.adesivos.consultar({ codigo: "EC-2222-2222" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const registros = await (await getDb()).select().from(logsAuditoria).where(eq(logsAuditoria.acao, "adesivo_consultado"));
    expect(registros).toHaveLength(2);
    expect(registros.some((registro) => registro.motivo === "Saco aberto na lixeira")).toBe(true);
  });

  it("medidas: modelos pré-definidos; suspensão deixa descartar sem pontos e tira do pódio; revogar devolve os pontos", async () => {
    const modelos = await admin.penalidades.modelos();
    expect(modelos.length).toBeGreaterThanOrEqual(6);
    const perda = modelos.find((modelo) => modelo.tipo === "perda_pontos")!;
    const suspensao = modelos.find((modelo) => modelo.tipo === "suspensao_participacao")!;
    const antes = await saldo(anaId);
    const pontosNoPodio = async () => (await admin.podio.ranking({ periodo: "mensal" })).ranking.find((linha) => linha.moradorId === anaId)?.pontos ?? 0;
    const podioAntes = await pontosNoPodio();
    const aplicada = await admin.penalidades.aplicar({ moradorId: anaId, modeloId: perda.id, motivo: "Teste de retirada de pontos" });
    expect(await saldo(anaId)).toBe(antes - perda.pontos!);
    // A retirada de pontos também desconta do pódio, não só do saldo de engajamento.
    if (podioAntes > perda.pontos!) expect(await pontosNoPodio()).toBe(podioAntes - perda.pontos!);
    const suspensa = await admin.penalidades.aplicar({ moradorId: anaId, modeloId: suspensao.id, motivo: "Tentativa de fraude confirmada" });
    expect(suspensa.fimEm).not.toBeNull();
    // Suspensa, a Ana continua descartando, mas a estação avisa que o descarte não vale pontos.
    const { code: codigoSuspensa } = await ana.estacao.gerarCodigo();
    const [adesivoSuspensa] = await codigosDisponiveis(ana);
    const previaSuspensa = await tablet().estacao.previa({ code: codigoSuspensa, itens: [{ wasteType: "reciclavel", weightGrams: 3000, stickerCode: adesivoSuspensa }] });
    expect(previaSuspensa.pontosPrevistos).toBe(0);
    expect(previaSuspensa.semPontos).toMatch(/suspensa/);
    // Suspensa, a Ana sai do pódio e do ranking: os vizinhos não veem a suspensão e quem vinha atrás sobe.
    const podioBruno = await bruno.podio.ranking({ periodo: "mensal" });
    expect(podioBruno.ranking.some((linha) => linha.suspensao || /Ana/.test(linha.nome))).toBe(false);
    expect(podioBruno.foraPorSuspensao).toEqual([]);
    const podioAdmin = await admin.podio.ranking({ periodo: "mensal" });
    expect(podioAdmin.ranking.some((linha) => linha.moradorId === anaId)).toBe(false);
    if (podioAntes > perda.pontos!) expect(podioAdmin.foraPorSuspensao.map((linha) => linha.moradorId)).toContain(anaId);
    expect((await bruno.engajamento.ranking()).linhas.some((linha) => /Ana/.test(linha.nome))).toBe(false);
    // O descarte feito durante a suspensão é registrado, mas não rende pontos.
    const saldoSuspensa = await saldo(anaId);
    const registrado = await descartar(ana, { stickerCode: adesivoSuspensa });
    expect(registrado.semPontos).toMatch(/suspensa/);
    expect(await saldo(anaId)).toBe(saldoSuspensa);
    const historico = await ana.penalidades.listar();
    expect(historico.map((medida) => medida.nome)).toEqual(expect.arrayContaining([perda.nome, suspensao.nome]));
    expect(historico.find((medida) => medida.id === suspensa.id)).toMatchObject({ vigente: true, aplicadaPor: "ia-admin" });
    expect((await ana.notificacoes.listar()).filter((item) => item.tipo === "penalidade_aplicada")).toHaveLength(2);
    // Bruno não vê as medidas da Ana.
    expect(await bruno.penalidades.listar()).toEqual([]);

    await admin.penalidades.revogar({ id: aplicada.id, motivo: "Aplicada por engano no teste" });
    expect(await saldo(anaId)).toBe(antes);
    expect((await ana.notificacoes.listar()).some((item) => item.tipo === "penalidade_encerrada" && /voltaram/.test(item.mensagem))).toBe(true);
    // A suspensão termina sozinha quando vence (rotina de hora em hora).
    await (await getDb()).update(penalidades).set({ fimEm: new Date(Date.now() - 1000) }).where(eq(penalidades.id, suspensa.id));
    expect(await encerrarPenalidadesVencidas(await getDb())).toBe(1);
    // Sem suspensão e com a retirada revogada, ela volta ao pódio com os pontos de antes.
    if (podioAntes > perda.pontos!) expect(await pontosNoPodio()).toBe(podioAntes);
    await expect(ana.estacao.gerarCodigo()).resolves.toHaveProperty("code");
    expect((await ana.notificacoes.listar()).some((item) => item.tipo === "penalidade_encerrada")).toBe(true);

    // Excluir notificações: some só para quem excluiu.
    const [primeira] = await ana.notificacoes.listar();
    expect(await ana.notificacoes.excluir({ ids: [primeira.id] })).toEqual({ excluidas: 1 });
    expect((await ana.notificacoes.listar()).some((item) => item.id === primeira.id)).toBe(false);
    await ana.notificacoes.marcarTodasLidas();
    expect((await ana.notificacoes.excluir({ somenteLidas: true })).excluidas).toBeGreaterThan(0);
    expect(await ana.notificacoes.listar()).toEqual([]);
    expect(await ana.notificacoes.contagemNaoLidas()).toEqual({ count: 0 });
    await expect(ana.notificacoes.excluir({})).rejects.toThrow(/Escolha/);
  });

  it("auditoria: ao confirmar a irregularidade, o administrador escolhe as medidas pré-definidas", async () => {
    const [codigo] = await codigosDisponiveis(bruno);
    const { id } = await descartar(bruno, { stickerCode: codigo, simulacaoIa: "foto_ilegivel" });
    await admin.coletas.abrirAuditoria({ id, motivo: "Foto ilegível e peso muito alto" });
    const advertencia = (await admin.penalidades.modelos()).find((modelo) => modelo.tipo === "advertencia")!;
    const campanhasSuspensas = (await admin.penalidades.modelos()).find((modelo) => modelo.tipo === "suspensao_campanhas")!;
    const concluida = await admin.coletas.concluirAuditoria({ id, resultado: "irregular", parecer: "Saco com entulho para pesar mais.", medidas: [advertencia.id, campanhasSuspensas.id] });
    expect(concluida.medidasAplicadas).toEqual([advertencia.nome, campanhasSuspensas.nome]);
    const medidas = await admin.penalidades.listar({ moradorId: brunoId });
    expect(medidas.every((medida) => medida.coletaId === id)).toBe(true);
    expect(medidas.find((medida) => medida.tipo === "advertencia")).toMatchObject({ status: "encerrada" });
    expect(medidas.find((medida) => medida.tipo === "suspensao_campanhas")).toMatchObject({ status: "ativa", vigente: true });
  });

  it("campanhas: anúncio, participação, edição, pausa, retomada, aviso de fim, encerramento com resultado e exclusão", async () => {
    const agora = Date.now();
    const { id } = await admin.campanhas.criar({ title: "Outubro reciclável", description: "Separe bem os recicláveis durante o mês.", targetDescription: "100 kg de recicláveis", startDate: new Date(agora - 60_000), endDate: new Date(agora + 10 * 86_400_000), status: "ativa" });
    expect((await ana.notificacoes.listar()).some((item) => item.tipo === "nova_campanha")).toBe(true);
    expect((await admin.notificacoes.listar()).some((item) => item.tipo === "nova_campanha")).toBe(false);
    await ana.campanhas.participar({ campaignId: id });
    expect((await ana.notificacoes.listar()).some((item) => item.tipo === "campanha_participacao")).toBe(true);
    // Bruno está com as campanhas suspensas (auditoria anterior).
    await expect(bruno.campanhas.participar({ campaignId: id })).rejects.toThrow(/suspensa/);

    await admin.campanhas.atualizar({ id, title: "Outubro reciclável", description: "Separe bem os recicláveis durante o mês.", targetDescription: "120 kg de recicláveis", startDate: new Date(agora - 60_000), endDate: new Date(agora + 2 * 86_400_000) });
    expect((await ana.notificacoes.listar()).some((item) => item.tipo === "campanha_atualizada")).toBe(true);
    await admin.campanhas.pausar({ id, motivo: "Lixeiras em manutenção", ate: new Date(agora + 86_400_000) });
    expect((await admin.campanhas.listar()).find((campanha) => campanha.id === id)).toMatchObject({ status: "pausada", motivoPausa: "Lixeiras em manutenção" });
    await admin.campanhas.retomar({ id });

    const [codigo] = await codigosDisponiveis(ana);
    await descartar(ana, { stickerCode: codigo }, 0);
    const lista = await ana.campanhas.listar();
    const campanha = lista.find((item) => item.id === id)!;
    expect(campanha).toMatchObject({ status: "ativa", joined: true });
    expect(campanha.indicadores).toMatchObject({ participantes: 1, adesao: 50, descartes: 1, kgReciclados: 3 });
    expect(campanha.indicadores.diasRestantes).toBeGreaterThanOrEqual(1);

    const db = await getDb();
    await processarCampanhas(db);
    expect((await ana.notificacoes.listar()).some((item) => item.tipo === "campanha_encerrando")).toBe(true);
    await db.update(campanhas).set({ dataFim: new Date(Date.now() - 1000) }).where(eq(campanhas.id, id));
    await processarCampanhas(db);
    expect((await ana.campanhas.listar()).find((item) => item.id === id)!.status).toBe("encerrada");
    const encerrada = (await ana.notificacoes.listar()).find((item) => item.tipo === "campanha_encerrada")!;
    expect(encerrada.mensagem).toMatch(/1 participante/);

    await admin.campanhas.excluir({ id, motivo: "Limpeza da lista" });
    expect((await admin.campanhas.listar()).some((item) => item.id === id)).toBe(false);
    expect((await db.select().from(campanhas).where(eq(campanhas.id, id)))[0].excluidaEm).not.toBeNull();
  });

  it("ocorrências: denúncia pelo adesivo, o denunciante não vê quem é; encaminhar para auditoria e denúncias falsas repetidas alertam", async () => {
    const usado = (await ana.adesivos.meus()).adesivos.find((adesivo) => adesivo.status === "utilizado")!;
    const { id } = await bruno.ocorrencias.criar({ category: "descarte_irregular", reference: usado.codigo, block: "A", wasteType: "reciclavel", location: "Lixeira da garagem", description: "Saco com lixo orgânico misturado." });
    const doBruno = (await bruno.ocorrencias.listar()).find((item) => item.id === id)!;
    expect(doBruno).toMatchObject({ coletaId: usado.coletaId, moradorEnvolvidoId: null, envolvido: null });
    const doAdmin = (await admin.ocorrencias.listar()).find((item) => item.id === id)!;
    expect(doAdmin).toMatchObject({ moradorEnvolvidoId: anaId, envolvido: { nome: "ia-ana" }, relator: "ia-bruno" });
    expect((await admin.notificacoes.listar()).some((item) => item.tipo === "nova_ocorrencia")).toBe(true);

    await admin.ocorrencias.encaminharDescarte({ id, destino: "auditoria", motivo: "Apurar a denúncia do vizinho" });
    expect((await admin.coletas.detalhe({ id: usado.coletaId! })).itens[0].situacao).toBe("auditoria");
    expect((await admin.ocorrencias.listar()).find((item) => item.id === id)!.status).toBe("em_auditoria");
    await admin.coletas.concluirAuditoria({ id: usado.coletaId!, resultado: "regular", parecer: "As fotos mostram só recicláveis." });

    const advertencia = (await admin.penalidades.modelos()).find((modelo) => modelo.tipo === "advertencia")!;
    const primeira = await admin.ocorrencias.concluir({ id, conclusao: "denuncia_falsa", nota: "O saco estava correto nas fotos.", medidasRelator: [advertencia.id] });
    expect(primeira).toMatchObject({ denunciasFalsasDoAutor: 1, medidasAplicadas: [`autor da denúncia: ${advertencia.nome}`] });
    const outra = await bruno.ocorrencias.criar({ category: "descarte_irregular", reference: String(usado.coletaId), block: "A", wasteType: "reciclavel", location: "Garagem", description: "De novo o mesmo saco errado." });
    const segunda = await admin.ocorrencias.concluir({ id: outra.id, conclusao: "denuncia_falsa", nota: "Mesma denúncia já apurada." });
    expect(segunda.denunciasFalsasDoAutor).toBe(2);
    expect((await admin2.notificacoes.listar()).some((item) => item.titulo === "Denúncias falsas repetidas")).toBe(true);
    // Bruno recebe só a conclusão, sem saber se a Ana recebeu medidas.
    const avisoBruno = (await bruno.notificacoes.listar()).find((item) => item.tipo === "ocorrencia_atualizada" && item.titulo.includes(`nº ${id}`) && item.titulo.includes("concluída"))!;
    expect(avisoBruno.mensagem).not.toMatch(/ia-ana/);
    await expect(bruno.ocorrencias.criar({ category: "outro", reference: "EC-9999-9999", block: "A", wasteType: "reciclavel", location: "Garagem", description: "Código inexistente." })).rejects.toThrow(/Não existe adesivo/);
  });

  it("avisos gerais: só para o público escolhido, com registro de quem visualizou; importantes aparecem no painel", async () => {
    const { id } = await admin.notificacoes.criarComunicado({ title: "Manutenção da balança", message: "A estação fica desligada no sábado de manhã.", publico: "moradores", categoria: "manutencao", importante: true });
    expect((await ana.notificacoes.importantes()).map((aviso) => aviso.id)).toContain(id);
    expect((await admin2.notificacoes.listar()).some((item) => item.id === id)).toBe(false);
    await ana.notificacoes.abrir({ id });
    expect((await ana.notificacoes.importantes()).map((aviso) => aviso.id)).not.toContain(id);
    const enviado = (await admin.notificacoes.enviados()).find((aviso) => aviso.id === id)!;
    expect(enviado).toMatchObject({ publico: "moradores", destinatarios: 2, visualizacoes: 1, autor: "ia-admin", importante: true });
    const quem = await admin.notificacoes.visualizacoes({ id });
    expect(quem.find((pessoa) => pessoa.nome === "ia-ana")!.lidaEm).not.toBeNull();
    expect(quem.find((pessoa) => pessoa.nome === "ia-bruno")!.lidaEm).toBeNull();
    await expect(ana.notificacoes.enviados()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("painéis e relatórios: indicadores de gestão para a administração e relatório completo do morador", async () => {
    const resumo = await admin.dashboard.resumo();
    expect(resumo.gestao!.ia).toMatchObject({ modo: "simulacao" });
    expect(resumo.gestao!.ia.aprovadasAutomaticamente).toBeGreaterThanOrEqual(3);
    expect(resumo.gestao!.penalidades.aplicadas).toBeGreaterThanOrEqual(4);
    expect(resumo.gestao!.adesivos).toMatchObject({ entregues: 9 });
    expect(resumo.gestao!.ocorrencias.denunciasFalsas).toBe(2);
    expect(resumo.gestao!.avisos.enviados).toBe(1);
    const geral = await admin.relatorios.visaoGeral();
    expect(geral.gestao.auditoria.consultasQr).toBe(2);

    const pessoal = await ana.dashboard.resumo();
    expect(pessoal.gestao).toBeNull();
    expect(pessoal.pessoal!.adesivos.disponiveis).toBeGreaterThanOrEqual(0);
    const relatorio = await ana.dashboard.morador();
    expect(relatorio.gestao.medidas.length).toBe(2);
    expect(relatorio.gestao.ocorrenciasEnvolvido).toEqual([]);
    const visaoAdmin = await admin.dashboard.morador({ residentId: anaId });
    expect(visaoAdmin.gestao.ocorrenciasEnvolvido.length).toBe(2);
    expect(visaoAdmin.gestao.ia.aprovadosIa).toBeGreaterThanOrEqual(3);
  });
});

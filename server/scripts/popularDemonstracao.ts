/**
 * Popula o banco MySQL com dados de demonstração (pnpm db:seed), passando pelas mesmas rotas e regras do sistema.
 * Use `pnpm db:seed --limpar` para apagar e recriar o banco (e as fotos enviadas) antes.
 */
import "dotenv/config";
import { CORES_PADRAO } from "@shared/descarte";
import { fotoDoVisor } from "./fotoVisor";
import fs from "node:fs";
import path from "node:path";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  adesivos,
  analisesIa,
  campanhas,
  coletas,
  movimentacoesPontos,
  notificacoes,
  pedidosAdesivos,
  usuarios,
} from "../../drizzle/schema";
import type { Usuario } from "../../drizzle/schema";
import {
  fecharDb,
  getDb,
  getUserByOpenId,
  prepararBanco,
  upsertUser,
} from "../db";
import { appRouter } from "../rotas";
import type { TrpcContext } from "../_core/context";
import { garantirContaDemonstracao } from "../_core/login";
import { gerarHashSenha } from "../senhas";
import { CABECALHO_TOKEN_ESTACAO } from "../rotas/estacoes";
import { saldosInconsistentes } from "../pontos";
import type { SimulacaoIa } from "../ia/analiseDescarte";
import { processarCampanhas } from "../campanhas";

const pastaUploads = path.resolve("data", "uploads");
/** Senha de todas as contas de demonstração no login com e-mail e senha. */
const SENHA_DEMONSTRACAO = "ecocondo123";

function limparUploads() {
  try {
    fs.rmSync(pastaUploads, { recursive: true, force: true });
  } catch (error) {
    console.error(
      "Não foi possível apagar as fotos enviadas. Feche o servidor (pnpm dev) e tente de novo."
    );
    throw error;
  }
}

/** Sorteio com semente fixa: os mesmos dados a cada execução. */
function sorteador(semente: number) {
  return () => {
    semente = (semente + 0x6d2b79f5) | 0;
    let t = Math.imul(semente ^ (semente >>> 15), 1 | semente);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sortear = sorteador(2026);
const entre = (minimo: number, maximo: number) =>
  Math.floor(minimo + sortear() * (maximo - minimo + 1));

function chamador(usuario: Usuario) {
  return appRouter.createCaller({
    user: usuario,
    req: { protocol: "https", headers: {} },
    res: { clearCookie() {}, cookie() {} },
  } as unknown as TrpcContext);
}

/** O tablet da estação: sem login de pessoa, só com o código de pareamento no cabeçalho. */
function tablet(token: string) {
  return appRouter.createCaller({
    user: null,
    req: { protocol: "https", headers: { [CABECALHO_TOKEN_ESTACAO]: token } },
    res: { clearCookie() {}, cookie() {} },
  } as unknown as TrpcContext);
}

async function main() {
  // Os dados de demonstração usam sempre a IA simulada (sem gastar a API), mesmo com ANTHROPIC_API_KEY configurada.
  process.env.IA_SIMULACAO = "1";
  const limpar = process.argv.includes("--limpar");
  if (limpar) limparUploads();
  await prepararBanco({ recriar: limpar });
  const db = await getDb();

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(coletas);
  if (Number(total) > 0) {
    console.log(
      "O banco já tem descartes cadastrados. Para recomeçar do zero, rode: pnpm db:seed --limpar"
    );
    return;
  }

  const usuarioAdmin = await garantirContaDemonstracao("administrador");
  const usuarioMorador = await garantirContaDemonstracao("morador");
  if (!usuarioAdmin || !usuarioMorador)
    throw new Error("Não foi possível criar as contas de demonstração.");
  const admin = chamador(usuarioAdmin);
  const morador = chamador(usuarioMorador);

  await admin.condominio.atualizar({
    name: "Condomínio Parque das Flores",
    address: "Rua das Palmeiras, 250",
    city: "São Paulo",
    state: "SP",
    blockCount: 4,
  });
  const vizinhos = [
    ["João Pereira", "joao@parquedasflores.com", "A", "102"],
    ["Beatriz Lima", "beatriz@parquedasflores.com", "B", "201"],
    ["Rafael Souza", "rafael@parquedasflores.com", "B", "204"],
    ["Camila Rocha", "camila@parquedasflores.com", "C", "301"],
    ["Pedro Almeida", "pedro@parquedasflores.com", "C", "305"],
    ["Luísa Martins", "luisa@parquedasflores.com", "D", "402"],
  ] as const;
  for (const [name, email, block, apartment] of vizinhos) {
    await admin.moradores.criar({
      name,
      email,
      phone: `(11) 9${entre(1000, 9999)}-${entre(1000, 9999)}`,
      block,
      apartment,
    });
  }
  // Cada vizinho tem login próprio (para gerar o código da estação); o primeiro acesso liga o usuário ao cadastro de morador.
  const pessoasPorNome: Record<string, ReturnType<typeof chamador>> = {
    "Marina Moradora": morador,
  };
  for (const [name, email] of vizinhos) {
    const idExterno = `demo-${email.split("@")[0]}`;
    await upsertUser({
      idExterno,
      nome: name,
      email,
      metodoLogin: "demo",
      papel: "usuario",
    });
    pessoasPorNome[name] = chamador((await getUserByOpenId(idExterno))!);
    await pessoasPorNome[name].perfil.meuPerfil();
  }
  // Senha de demonstração para testar o login com e-mail e senha (as contas do botão "Entrar como" também a aceitam).
  const senhaDemo = await gerarHashSenha(SENHA_DEMONSTRACAO);
  await db.update(usuarios).set({ senhaHash: senhaDemo });
  // Os usuários de demonstração já leram o manual, menos a Marina: assim o primeiro acesso dela mostra o manual obrigatório.
  await db
    .update(usuarios)
    .set({ manualLidoEm: new Date() })
    .where(ne(usuarios.id, usuarioMorador.id));

  const agora = new Date();

  // Estação com IA: aprova sozinha o que estiver de acordo e exige um adesivo QR em cada saco.
  await admin.configuracoesIa.salvar({
    iaAprovacaoAutomatica: true,
    iaConfiancaMinima: 80,
    adesivoObrigatorio: true,
  });
  // Kits de adesivos QR entregues há seis meses (um adesivo por saco).
  const idMorador: Record<string, number> = Object.fromEntries(
    (await admin.moradores.listar()).map(item => [item.nome, item.id])
  );
  const seisMesesAtras = new Date(
    agora.getFullYear(),
    agora.getMonth() - 6,
    1,
    10
  );
  for (const nome of Object.keys(pessoasPorNome)) {
    await admin.adesivos.entregar({
      moradorId: idMorador[nome],
      quantidade: 30,
      observacao: "Kit inicial entregue na portaria.",
    });
  }
  await db.update(adesivos).set({ criadoEm: seisMesesAtras });
  await db
    .update(pedidosAdesivos)
    .set({ criadoEm: seisMesesAtras, entregueEm: seisMesesAtras });

  // Estação de pesagem (tablet + balança ao lado das lixeiras).
  const { id: idEstacao, token: tokenEstacao } = await admin.estacoes.criar({
    name: "Lixeiras do térreo",
    location: "Garagem, ao lado do bloco A",
  });
  const estacao = tablet(tokenEstacao);
  // Modo demonstração (balança simulada): pesos rápidos na tela, foto opcional e escolha do que a IA simulada "vê".
  await admin.estacoes.definirModoDemonstracao({
    id: idEstacao,
    enabled: true,
  });

  /** Leva um descarte para uma data passada, junto com as linhas do extrato e as notificações dele (já lidas). */
  async function moverParaData(ids: number[], data: Date) {
    await db
      .update(coletas)
      .set({
        agendadaPara: data,
        concluidaEm: data,
        criadoEm: data,
        atualizadoEm: data,
      })
      .where(inArray(coletas.id, ids));
    await db
      .update(movimentacoesPontos)
      .set({ criadoEm: data })
      .where(inArray(movimentacoesPontos.coletaId, ids));
    await db
      .update(notificacoes)
      .set({ criadoEm: data, lidaEm: data })
      .where(inArray(notificacoes.coletaId, ids));
    await db
      .update(adesivos)
      .set({ utilizadoEm: data })
      .where(inArray(adesivos.coletaId, ids));
    await db
      .update(analisesIa)
      .set({ criadoEm: data })
      .where(inArray(analisesIa.coletaId, ids));
  }

  /** Próximos adesivos ainda não usados do morador (um por saco). */
  async function proximosAdesivos(nome: string, quantidade: number) {
    const linhas = await db
      .select({ codigo: adesivos.codigo })
      .from(adesivos)
      .where(
        and(
          eq(adesivos.moradorId, idMorador[nome]),
          eq(adesivos.status, "disponivel")
        )
      )
      .orderBy(asc(adesivos.id))
      .limit(quantidade);
    return linhas.map(linha => linha.codigo);
  }

  /** `ia`: o que a IA simulada "vê" na foto (padrão: tudo certo, e a IA aprova sozinha). */
  type Item = {
    wasteType:
      | "reciclavel"
      | "organico"
      | "rejeito"
      | "eletronico"
      | "perigoso";
    weightGrams: number;
    ia?: SimulacaoIa;
  };
  /**
   * O morador gera o código no aplicativo e descarta na estação (um ou vários tipos de uma vez, com foto do visor de cada um).
   * Cada saco leva um adesivo QR do morador. A IA aprova sozinha o que estiver de acordo; o que ela mandar para conferência,
   * o administrador aprova (decisao "aprovar") ou deixa pendente. Com `data`, o descarte vai para o passado.
   */
  async function descarte(
    nome: string,
    itens: Item[],
    data: Date | null,
    decisao: "aprovar" | "pendente" = "aprovar"
  ) {
    const { code } = await pessoasPorNome[nome].estacao.gerarCodigo();
    const codigos = await proximosAdesivos(nome, itens.length);
    const resultado = await estacao.estacao.registrar({
      code,
      itens: itens.map((item, indice) => ({
        wasteType: item.wasteType,
        weightGrams: item.weightGrams,
        stickerCode: codigos[indice],
        simulacaoIa: item.ia ?? "tudo_certo",
        imageDataUrl: fotoDoVisor(
          item.weightGrams,
          CORES_PADRAO[item.wasteType].cor
        ),
      })),
    });
    const ids = resultado.ids;
    if (data) await moverParaData(ids, data);
    const pendentes = resultado.itens
      .filter(item => item.situacao === "pendente")
      .map(item => item.id);
    if (decisao === "aprovar" && pendentes.length)
      await admin.coletas.aprovarVarios({ ids: pendentes });
    if (data) await moverParaData(ids, data);
    return ids;
  }

  // Histórico dos últimos cinco meses e do mês atual, já aprovado: alimenta painéis, relatórios, metas, pódio e certificados.
  const participantes: Array<[string, number]> = [
    ["Marina Moradora", 3],
    ["Beatriz Lima", 3],
    ["Camila Rocha", 2],
    ["João Pereira", 2],
    ["Rafael Souza", 1],
    ["Luísa Martins", 2],
    ["Pedro Almeida", 1],
  ];
  for (let mesesAtras = 5; mesesAtras >= 0; mesesAtras -= 1) {
    const ultimoDia =
      mesesAtras === 0
        ? agora.getDate() - 2
        : new Date(
            agora.getFullYear(),
            agora.getMonth() - mesesAtras + 1,
            0
          ).getDate();
    if (ultimoDia < 1) continue;
    for (const [nome, frequencia] of participantes) {
      const quantidade = Math.max(0, frequencia - (sortear() < 0.3 ? 1 : 0));
      for (let vez = 0; vez < quantidade; vez += 1) {
        const data = new Date(
          agora.getFullYear(),
          agora.getMonth() - mesesAtras,
          entre(1, ultimoDia),
          entre(8, 20),
          entre(0, 59)
        );
        // Entre 3 e 8,5 kg de recicláveis, às vezes com orgânico ou rejeito no mesmo descarte.
        const itens: Item[] = [
          { wasteType: "reciclavel", weightGrams: entre(30, 85) * 100 },
        ];
        const sorteio = sortear();
        if (sorteio < 0.3)
          itens.push({
            wasteType: "organico",
            weightGrams: entre(10, 40) * 100,
          });
        else if (sorteio < 0.45)
          itens.push({ wasteType: "rejeito", weightGrams: entre(5, 20) * 100 });
        await descarte(nome, itens, data);
      }
    }
    await descarte(
      "Rafael Souza",
      [{ wasteType: "organico", weightGrams: entre(40, 90) * 100 }],
      new Date(
        agora.getFullYear(),
        agora.getMonth() - mesesAtras,
        Math.max(1, Math.min(ultimoDia, 12)),
        9,
        30
      )
    );
  }
  const ontem = (hora: number, minuto = 0) =>
    new Date(
      agora.getFullYear(),
      agora.getMonth(),
      agora.getDate() - 1,
      hora,
      minuto
    );
  // Descartes de ontem com vários tipos de uma vez (já aprovados).
  await descarte(
    "Pedro Almeida",
    [
      { wasteType: "eletronico", weightGrams: 1800 },
      { wasteType: "perigoso", weightGrams: 400 },
    ],
    ontem(10, 15)
  );
  await descarte(
    "Marina Moradora",
    [
      { wasteType: "reciclavel", weightGrams: 4200 },
      { wasteType: "organico", weightGrams: 1500 },
    ],
    ontem(18, 40)
  );
  const [idDenunciado] = await descarte(
    "Beatriz Lima",
    [{ wasteType: "reciclavel", weightGrams: 4400 }],
    ontem(8, 20)
  );

  // Um descarte reprovado com motivo: os pontos voltam (estorno no extrato) e o caso aparece na auditoria.
  const [idReprovado] = await descarte(
    "João Pereira",
    [{ wasteType: "reciclavel", weightGrams: 5200 }],
    ontem(9, 5)
  );
  await admin.coletas.reprovar({
    id: idReprovado,
    motivo:
      "Saco com rejeito e restos de comida misturados; não conta como reciclável.",
  });
  await moverParaData([idReprovado], ontem(9, 5));

  // Uma auditoria concluída no mês passado: irregularidade confirmada (mesmo saco pesado duas vezes) e punição de 5 pontos.
  const mesPassadoDia = new Date(
    agora.getFullYear(),
    agora.getMonth() - 1,
    20,
    19,
    10
  );
  const [idAuditado] = await descarte(
    "Camila Rocha",
    [{ wasteType: "reciclavel", weightGrams: 7900, ia: "foto_ilegivel" }],
    mesPassadoDia,
    "pendente"
  );
  await admin.coletas.abrirAuditoria({
    id: idAuditado,
    motivo:
      "A foto mostra o mesmo saco do descarte anterior, pesado de novo dez minutos depois.",
  });
  await admin.coletas.concluirAuditoria({
    id: idAuditado,
    resultado: "irregular",
    parecer:
      "Conversamos com a moradora: o saco foi pesado duas vezes. Descarte reprovado e 5 pontos de punição.",
    penalidadePontos: 5,
  });
  await moverParaData([idAuditado], mesPassadoDia);

  // Pendentes de hoje, para a demonstração da aprovação: Beatriz com dois tipos; Luísa com 26 kg (bem acima do padrão dela).
  await descarte(
    "Beatriz Lima",
    [
      { wasteType: "reciclavel", weightGrams: 3100 },
      { wasteType: "eletronico", weightGrams: 800, ia: "cor_errada" },
    ],
    null,
    "pendente"
  );
  await descarte(
    "Luísa Martins",
    [{ wasteType: "reciclavel", weightGrams: 26000 }],
    null,
    "pendente"
  );
  // Um descarte em auditoria aberta: o morador já foi avisado e a administração ainda vai dar o parecer.
  const [idEmAuditoria] = await descarte(
    "Rafael Souza",
    [{ wasteType: "reciclavel", weightGrams: 9800, ia: "peso_diferente" }],
    null,
    "pendente"
  );
  await admin.coletas.abrirAuditoria({
    id: idEmAuditoria,
    motivo:
      "O peso é o dobro do normal do morador e o saco da foto parece o mesmo do descarte anterior.",
  });

  // Metas, recompensas e resgates.
  const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
  const fimMes = new Date(agora.getFullYear(), agora.getMonth() + 1, 0, 23, 59);
  await admin.metas.criar({
    block: "A",
    title: "Bloco A: 40 kg de recicláveis",
    targetKg: 40,
    startDate: inicioMes,
    endDate: fimMes,
  });
  await admin.metas.criar({
    block: "B",
    title: "Bloco B: 30 kg de recicláveis",
    targetKg: 30,
    startDate: inicioMes,
    endDate: fimMes,
  });
  await morador.metaPessoal.definir({
    targetKg: 25,
    startDate: inicioMes,
    endDate: fimMes,
  });
  const cafe = await admin.engajamento.criarRecompensa({
    title: "Vale-café na padaria parceira",
    description: "Um café e um pão de queijo na Padaria Central.",
    pointsCost: 5,
    stock: 10,
  });
  const sacolas = await admin.engajamento.criarRecompensa({
    title: "Kit sacolas retornáveis",
    description: "Três sacolas de algodão para compras.",
    pointsCost: 12,
    stock: 6,
  });
  await admin.engajamento.criarRecompensa({
    title: "Muda de árvore nativa",
    description: "Muda de ipê ou pitanga para o jardim do condomínio.",
    pointsCost: 20,
    stock: null,
  });
  await admin.engajamento.criarRecompensa({
    title: "Garrafa térmica do condomínio",
    description:
      "Garrafa de aço inox de 500 ml com o logo do Parque das Flores.",
    pointsCost: 30,
    stock: 2,
  });
  await morador.engajamento.resgatar({ rewardId: sacolas.id });
  const [resgateSacolas] = await admin.engajamento.listarResgates();
  await admin.engajamento.atualizarResgate({
    id: resgateSacolas.id,
    status: "entregue",
  });
  await morador.engajamento.resgatar({ rewardId: cafe.id });

  // Pódio: prêmios sem custo para os outros moradores e o prêmio do campeão do mês passado já entregue.
  await admin.podio.configurarPremios({
    periodo: "mensal",
    premios: [
      {
        posicao: 1,
        titulo: "Vale-compras no hortifrúti parceiro",
        descricao:
          "Doado pelo comércio parceiro em troca de divulgação no mural.",
      },
      {
        posicao: 2,
        titulo: "Kit de mudas e adubo da composteira",
        descricao: null,
      },
      {
        posicao: 3,
        titulo: "Destaque no mural do condomínio",
        descricao: null,
      },
    ],
  });
  await admin.podio.configurarPremios({
    periodo: "semestral",
    premios: [
      {
        posicao: 1,
        titulo: "Prioridade na reserva do salão de festas",
        descricao: "Escolhe a data antes dos demais no semestre seguinte.",
      },
      { posicao: 2, titulo: "Troféu de material reciclado", descricao: null },
      {
        posicao: 3,
        titulo: "Kit de mudas e adubo da composteira",
        descricao: null,
      },
    ],
  });
  await admin.podio.configurarPremios({
    periodo: "anual",
    premios: [
      {
        posicao: 1,
        titulo: "Cesta de Natal",
        descricao:
          "Paga com o dinheiro da venda dos recicláveis à cooperativa.",
      },
      {
        posicao: 2,
        titulo: "Cesta de Natal (menor)",
        descricao:
          "Paga com o dinheiro da venda dos recicláveis à cooperativa.",
      },
      {
        posicao: 3,
        titulo: "Panetone e troféu de material reciclado",
        descricao: null,
      },
    ],
  });
  const mesPassado = new Date(agora.getFullYear(), agora.getMonth() - 1, 15);
  const podioMesPassado = await admin.podio.ranking({
    periodo: "mensal",
    dataReferencia: mesPassado,
  });
  const campeao = podioMesPassado.ranking[0];
  if (campeao?.moradorId)
    await admin.podio.marcarPremioEntregue({
      moradorId: campeao.moradorId,
      periodo: "mensal",
      dataReferencia: mesPassado,
      observacao: "Entregue na portaria.",
    });

  // Certificados do trimestre anterior para os blocos com coletas.
  for (const bloco of ["A", "B", "C"]) {
    await admin.certificados
      .gerarTrimestral({ block: bloco })
      .catch(() => undefined);
  }

  // Campanha, ocorrência, avaliação e comunicado.
  await admin.campanhas.criar({
    title: "Mês sem plástico",
    description:
      "Um mês para reduzir descartáveis e separar corretamente os plásticos recicláveis.",
    targetDescription: "Todos os moradores",
    startDate: inicioMes,
    endDate: fimMes,
    status: "ativa",
  });
  const [campanha] = await morador.campanhas.listar();
  await morador.campanhas.participar({ campaignId: campanha.id });
  await morador.ocorrencias.criar({
    block: "A",
    wasteType: "reciclavel",
    location: "Lixeira do térreo, bloco A",
    description: "Recicláveis misturados com restos de comida.",
    imageDataUrl: fotoDoVisor(null, CORES_PADRAO.reciclavel.cor),
  });
  await morador.avaliacoes.criar({
    rating: 5,
    message: "A estação de pesagem é rápida de usar.",
  });
  const sacos = await admin.notificacoes.criarComunicado({
    title: "Sacos coloridos na portaria",
    message:
      "Retire na portaria os sacos de cada tipo de resíduo (azul para recicláveis, marrom para orgânicos e cinza para rejeitos). Veja as cores no Guia de descarte.",
    publico: "moradores",
    categoria: "coleta",
  });
  for (const nome of [
    "Beatriz Lima",
    "Camila Rocha",
    "João Pereira",
    "Pedro Almeida",
  ])
    await pessoasPorNome[nome].notificacoes.marcarLida({ id: sacos.id });

  // IA na estação hoje: um descarte aprovado sozinho pela IA e um que ela mandou para conferência (tipo diferente do declarado).
  await descarte(
    "Pedro Almeida",
    [{ wasteType: "reciclavel", weightGrams: 3600 }],
    null,
    "pendente"
  );
  await descarte(
    "João Pereira",
    [{ wasteType: "reciclavel", weightGrams: 2900, ia: "tipo_diferente" }],
    null,
    "pendente"
  );

  // Denúncia com o código do adesivo: a IA tinha aprovado; o administrador reverte a aprovação e manda para nova avaliação.
  const [adesivoDenunciado] = await db
    .select({ codigo: adesivos.codigo })
    .from(adesivos)
    .where(eq(adesivos.coletaId, idDenunciado))
    .limit(1);
  const denuncia = await pessoasPorNome["Camila Rocha"].ocorrencias.criar({
    category: "descarte_irregular",
    reference: adesivoDenunciado.codigo,
    block: "B",
    wasteType: "reciclavel",
    location: "Lixeira de recicláveis da garagem",
    description:
      "Vi este saco azul com restos de comida e fraldas misturados aos recicláveis.",
  });
  await admin.ocorrencias.encaminharDescarte({
    id: denuncia.id,
    destino: "nova_avaliacao",
    motivo:
      "Denúncia com foto: conferir o conteúdo do saco antes de manter os pontos.",
  });

  // Denúncia falsa: Pedro denunciou um descarte do João, a administração conferiu as fotos e concluiu que era falsa (advertência ao Pedro).
  const modelos = await admin.penalidades.modelos({ somenteAtivos: true });
  const modelo = (nome: string) => modelos.find(item => item.nome === nome)!.id;
  const [descarteDoJoao] = await db
    .select({ id: coletas.id })
    .from(coletas)
    .where(
      and(
        eq(coletas.moradorId, idMorador["João Pereira"]),
        eq(coletas.status, "concluida")
      )
    )
    .orderBy(asc(coletas.id))
    .limit(1);
  const falsa = await pessoasPorNome["Pedro Almeida"].ocorrencias.criar({
    category: "suspeita_fraude",
    reference: String(descarteDoJoao.id),
    block: "C",
    wasteType: "reciclavel",
    location: "Estação de pesagem",
    description: "Acho que esse saco foi pesado com o pé em cima da balança.",
  });
  await admin.ocorrencias.concluir({
    id: falsa.id,
    conclusao: "denuncia_falsa",
    nota: "As fotos do visor e o peso batem com o saco; não houve irregularidade. Denúncia sem fundamento.",
    medidasRelator: [modelo("Advertência por escrito")],
  });

  // Medidas administrativas: suspensão das campanhas para o João, pelo descarte reprovado de ontem.
  await admin.penalidades.aplicar({
    moradorId: idMorador["João Pereira"],
    modeloId: modelo("Suspensão das campanhas por 30 dias"),
    motivo:
      "Descarte reprovado: rejeito e restos de comida no saco de recicláveis.",
    coletaId: idReprovado,
  });

  // Campanhas: uma pausada (com data para voltar) e uma encerrada no mês passado, com resultado.
  const ate = new Date(agora.getTime() + 7 * 24 * 60 * 60 * 1000);
  const oleo = await admin.campanhas.criar({
    title: "Óleo de cozinha usado",
    description:
      "Traga o óleo usado em garrafa PET fechada para o coletor da garagem.",
    targetDescription: "50 litros no mês",
    startDate: inicioMes,
    endDate: fimMes,
    status: "ativa",
  });
  await pessoasPorNome["Camila Rocha"].campanhas.participar({
    campaignId: oleo.id,
  });
  await admin.campanhas.pausar({
    id: oleo.id,
    ate,
    motivo: "Coletor de óleo em manutenção.",
  });
  const eletronicos = await admin.campanhas.criar({
    title: "Semana do lixo eletrônico",
    description:
      "Pilhas, celulares e cabos velhos vão para a caixa da portaria.",
    targetDescription: "Todos os blocos",
    startDate: new Date(agora.getFullYear(), agora.getMonth() - 1, 3),
    endDate: new Date(agora.getTime() + 60 * 60 * 1000),
    status: "ativa",
  });
  await pessoasPorNome["Pedro Almeida"].campanhas.participar({
    campaignId: eletronicos.id,
  });
  await pessoasPorNome["Beatriz Lima"].campanhas.participar({
    campaignId: eletronicos.id,
  });
  await db
    .update(campanhas)
    .set({
      dataFim: new Date(agora.getFullYear(), agora.getMonth() - 1, 10, 23, 59),
    })
    .where(eq(campanhas.id, eletronicos.id));
  await processarCampanhas(db, agora);

  // Adesivos: Luísa pediu mais um kit (aguardando entrega).
  await pessoasPorNome["Luísa Martins"].adesivos.solicitar({
    quantidade: 20,
    observacao: "Quero um kit reserva para as festas de fim de ano.",
  });

  // Aviso geral importante: fica em destaque no painel até cada um marcar como lido.
  await admin.notificacoes.criarComunicado({
    title: "Agora cada saco precisa de um adesivo QR",
    message:
      "Cole um adesivo do seu kit em cada saco antes de pesar. A estação lê o QR (ou você digita o código) e a análise automática confere tipo, peso e cor do saco. Peça mais adesivos em Adesivos QR.",
    publico: "todos",
    categoria: "regras",
    importante: true,
  });

  const [{ criadas }] = await db
    .select({ criadas: sql<number>`count(*)` })
    .from(coletas);
  const divergentes = await saldosInconsistentes(db);
  console.log(
    `Dados de demonstração criados: ${criadas} descartes, ${vizinhos.length + 1} moradores. Rode pnpm dev e entre como Administrador ou Morador.`
  );
  console.log(
    `Login com e-mail e senha: admin@ecocondo.local ou morador@ecocondo.local, senha ${SENHA_DEMONSTRACAO}.`
  );
  console.log(
    divergentes.length
      ? `ATENÇÃO: ${divergentes.length === 1 ? "1 saldo de pontos não bate" : `${divergentes.length} saldos de pontos não batem`} com o extrato.`
      : "Saldos de pontos conferidos com o extrato: tudo certo."
  );
  console.log(
    "IA da estação em modo simulação nos dados de demonstração; com ANTHROPIC_API_KEY no .env, os novos descartes são analisados pelo Claude."
  );
  console.log(
    `Estação de pesagem "Lixeiras do térreo" (modo demonstração ligado): abra /estacao?codigo=${encodeURIComponent(tokenEstacao)} no tablet (ou em outra aba) para parear.`
  );
}

main().then(fecharDb, error => {
  console.error(error);
  process.exit(1);
});

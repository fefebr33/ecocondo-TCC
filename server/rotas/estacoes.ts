import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import QRCode from "qrcode";
import { and, asc, count, desc, eq, gt, gte, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import { z } from "zod";
import { adesivos, analisesIa, coletas, condominios, estacoesPesagem, moradores, tiposResiduo } from "../../drizzle/schema";
import type { EstacaoPesagem, Morador } from "../../drizzle/schema";
import { rotuloResiduo, residuoNaFrase } from "@shared/rotulos";
import { getDb } from "../db";
import { administratorOnly, withProfile } from "./nucleo";
import { publicProcedure, router } from "../_core/trpc";
import { writeAuditLog } from "../audit";
import { salvarImagemBase64 } from "../storage";
import { PESO_MAXIMO_CONFIGURAVEL_GRAMAS, formatarPontos, milesimosDoDescarte } from "@shared/descarte";
import { regrasDoCondominio } from "../regrasResiduo";
import { coresDosSacos } from "../guias";
import { notificarAdministradores, notificarFalhaOperacional, notificarUsuario } from "../notificacoes";
import { LimiteAntifraudeExcedidoError } from "../dominio/antifraude";
import {
  LIMITE_PESO_POR_REGISTRO_ESTACAO_GRAMAS,
  MAXIMO_ITENS_POR_DESCARTE,
  VALIDADE_CODIGO_ESTACAO_MINUTOS,
  avaliarDescarteEstacao,
  gerarCodigoEstacao,
  gerarTokenEstacao,
  hashTokenEstacao,
  limparTentativas,
  registrarTentativaErrada,
  verificarBloqueioTentativas,
} from "../dominio/estacaoPesagem";
import { analisarItem, decidirAnalise, mesmaCor, simulacoesIa, type LeituraIa } from "../ia/analiseDescarte";
import { idUsuarioSistemaIa } from "../ia/usuarioSistema";
import { aprovarColeta } from "./operacoes";
import { suspensaoVigente } from "../penalidades";
import { LIMITE_ADESIVOS_ACABANDO, normalizarCodigoAdesivo } from "@shared/adesivos";

/** Cabeçalho enviado pelo tablet pareado com o código de pareamento guardado nele. */
export const CABECALHO_TOKEN_ESTACAO = "x-estacao-token";

/** Procedimentos do tablet: não usam login de pessoa, e sim o código de pareamento de uma estação ativa. */
const estacaoPareada = publicProcedure.use(async ({ ctx, next }) => {
  const cabecalho = ctx.req.headers?.[CABECALHO_TOKEN_ESTACAO];
  const token = Array.isArray(cabecalho) ? cabecalho[0] : cabecalho;
  if (!token) throw new TRPCError({ code: "UNAUTHORIZED", message: "Este tablet ainda não foi pareado como estação de pesagem." });
  const db = await getDb();
  const encontrada = await db.select().from(estacoesPesagem).where(eq(estacoesPesagem.tokenHash, hashTokenEstacao(token))).limit(1);
  const estacao = encontrada[0];
  if (!estacao || !estacao.ativo) throw new TRPCError({ code: "UNAUTHORIZED", message: "Código de pareamento inválido ou estação desativada. Peça um novo código ao administrador." });
  return next({ ctx: { ...ctx, estacao } });
});

const codigoInput = z.string().trim().regex(/^\d{6}$/, "Digite os 6 números do código gerado no aplicativo.");

/** Encontra o morador dono de um código temporário válido; conta a tentativa errada para bloquear chutes no tablet. */
async function moradorPorCodigo(estacao: EstacaoPesagem, codigo: string) {
  try {
    verificarBloqueioTentativas(estacao.id);
  } catch (error) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: error instanceof Error ? error.message : "Tablet bloqueado temporariamente." });
  }
  const db = await getDb();
  const encontrado = await db.select().from(moradores).where(and(
    eq(moradores.condominioId, estacao.condominioId),
    eq(moradores.codigoEstacao, codigo),
    gt(moradores.codigoEstacaoExpiraEm, new Date()),
  )).limit(1);
  const morador = encontrado[0];
  if (!morador || morador.status !== "ativo" || !morador.usuarioId) {
    if (registrarTentativaErrada(estacao.id)) {
      await notificarFalhaOperacional("Muitos códigos errados na estação", `O tablet "${estacao.nome}" (${estacao.local}) recebeu muitos códigos errados seguidos e está pedindo espera entre as tentativas. Se não foi um morador confuso, confira quem está usando o tablet.`, estacao.condominioId);
    }
    throw new TRPCError({ code: "NOT_FOUND", message: "Código inválido ou vencido. Gere um novo código no aplicativo EcoCondo." });
  }
  limparTentativas(estacao.id);
  return { ...morador, usuarioId: morador.usuarioId };
}

/** Meia-noite de Brasília do dia de `data` (o servidor no Render roda em UTC; sem isso o "dia" viraria às 21h). */
export function inicioDoDiaEmBrasilia(data: Date) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(data).map((parte) => [parte.type, parte.value]));
  const comoUtc = Date.UTC(Number(partes.year), Number(partes.month) - 1, Number(partes.day), Number(partes.hour), Number(partes.minute), Number(partes.second));
  const deslocamento = comoUtc - Math.floor(data.getTime() / 1000) * 1000;
  return new Date(Date.UTC(Number(partes.year), Number(partes.month) - 1, Number(partes.day)) - deslocamento);
}

function formatarKg(pesoGramas: number) {
  return (pesoGramas / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type TipoResiduo = (typeof tiposResiduo)[number];
type ItemInformado = { wasteType: TipoResiduo; weightGrams: number };

/** Um descarte na estação: de 1 a 5 tipos diferentes, cada um com o seu peso (e a sua foto do visor da balança). */
const itensInput = z.array(z.object({
  wasteType: z.enum(tiposResiduo),
  weightGrams: z.number().int().min(-1_000_000).max(PESO_MAXIMO_CONFIGURAVEL_GRAMAS * 2),
  imageDataUrl: z.string().max(5_500_000).nullable().optional(),
  /** Código do adesivo com QR Code colado no saco (lido pela câmera do tablet ou digitado). */
  stickerCode: z.string().trim().max(80).nullable().optional(),
  /** Só na estação em modo demonstração: o que a IA simulada deve "ver" na foto, para mostrar à banca o caminho de revisão. */
  simulacaoIa: z.enum(simulacoesIa).nullable().optional(),
})).min(1, "Escolha pelo menos um tipo de descarte.").max(MAXIMO_ITENS_POR_DESCARTE, `Registre no máximo ${MAXIMO_ITENS_POR_DESCARTE} tipos por descarte.`)
  .refine((itens) => new Set(itens.map((item) => item.wasteType)).size === itens.length, "Cada tipo entra uma vez só no mesmo descarte. Some o peso dos sacos do mesmo tipo.");

/**
 * Confere um descarte antes de gravar: limites rígidos (bloqueiam) e, por item, os pontos previstos pela regra do tipo
 * e os alertas para a conferência do administrador. Todo descarte fica pendente de aprovação.
 */
async function avaliarDescarte(estacao: EstacaoPesagem, morador: Morador, itens: ItemInformado[], agora: Date) {
  const db = await getDb();
  const regras = await regrasDoCondominio(estacao.condominioId);
  const registrosHoje = await db.select({ id: coletas.id, pesoGramas: coletas.pesoGramas, concluidaEm: coletas.concluidaEm, lote: coletas.lote }).from(coletas).where(and(
    eq(coletas.moradorId, morador.id),
    isNotNull(coletas.estacaoId),
    eq(coletas.status, "concluida"),
    // Descarte reprovado não conta no limite do dia (o morador pode refazer do jeito certo).
    or(isNull(coletas.aprovacaoPesoStatus), ne(coletas.aprovacaoPesoStatus, "rejeitado")),
    gte(coletas.concluidaEm, inicioDoDiaEmBrasilia(agora)),
  ));
  const itensAvaliados = [];
  for (const item of itens) {
    const historico = await db.select({ pesoGramas: coletas.pesoGramas }).from(coletas).where(and(
      eq(coletas.moradorId, morador.id),
      eq(coletas.status, "concluida"),
      eq(coletas.tipoResiduo, item.wasteType),
      or(isNull(coletas.aprovacaoPesoStatus), eq(coletas.aprovacaoPesoStatus, "aprovado")),
    )).orderBy(desc(coletas.concluidaEm)).limit(10);
    const pesos = historico.map((registro) => registro.pesoGramas ?? 0);
    itensAvaliados.push({ rotulo: rotuloResiduo[item.wasteType], pesoGramas: item.weightGrams, pesoMinimoGramas: regras[item.wasteType].pesoMinimoGramas, pesoMaximoGramas: regras[item.wasteType].pesoMaximoGramas, mediaHistoricaGramas: pesos.length ? pesos.reduce((soma, peso) => soma + peso, 0) / pesos.length : 0 });
  }
  const { alertasPorItem } = avaliarDescarteEstacao({ itens: itensAvaliados, registrosHoje, agora, modoDemonstracao: estacao.modoDemonstracao });
  // Suspensão da participação: o descarte é registrado normalmente, mas não vale pontos até a suspensão acabar ou ser revogada.
  const suspensao = await suspensaoVigente(db, morador.id);
  return itens.map((item, indice) => {
    const milesimos = suspensao ? 0 : milesimosDoDescarte(item.weightGrams, regras[item.wasteType].pontosPorKg);
    return { ...item, alertas: alertasPorItem[indice], milesimos, pontosPrevistos: milesimos / 1000, regra: regras[item.wasteType], suspensao };
  });
}

/** Aviso mostrado no tablet e na notificação quando o morador está suspenso: o descarte vale, os pontos não. */
function textoSemPontos(suspensao: { fimEm: Date | null }) {
  const ate = suspensao.fimEm ? ` até ${suspensao.fimEm.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : "";
  return `Sua participação está suspensa${ate}: o descarte é registrado e conferido normalmente, mas não vale pontos enquanto durar a suspensão.`;
}

/** Configurações do condomínio que valem na estação (adesivo obrigatório e aprovação automática da IA). */
async function configuracoesDaEstacao(condominioId: number) {
  const db = await getDb();
  const [condominio] = await db.select({ adesivoObrigatorio: condominios.adesivoObrigatorio, iaAprovacaoAutomatica: condominios.iaAprovacaoAutomatica, iaConfiancaMinima: condominios.iaConfiancaMinima }).from(condominios).where(eq(condominios.id, condominioId)).limit(1);
  return condominio ?? { adesivoObrigatorio: false, iaAprovacaoAutomatica: false, iaConfiancaMinima: 100 };
}

async function adesivosDisponiveis(moradorId: number) {
  const db = await getDb();
  const [linha] = await db.select({ total: count() }).from(adesivos).where(and(eq(adesivos.moradorId, moradorId), eq(adesivos.status, "disponivel")));
  return Number(linha?.total ?? 0);
}

/**
 * Confere os adesivos dos sacos: cada saco com um adesivo diferente, do próprio morador e ainda não usado.
 * Devolve o adesivo de cada item (ou null quando o condomínio não exige adesivo e o item veio sem).
 */
async function adesivosDoDescarte(estacao: EstacaoPesagem, morador: Morador, itens: Array<{ stickerCode?: string | null }>, obrigatorio: boolean) {
  const codigos = itens.map((item) => normalizarCodigoAdesivo(item.stickerCode));
  itens.forEach((item, indice) => {
    if (item.stickerCode && !codigos[indice]) throw new TRPCError({ code: "BAD_REQUEST", message: `O código do adesivo do ${indice + 1}º saco não é válido. Confira o número impresso embaixo do QR (ex.: EC-7K3F-9Q2M).` });
  });
  if (obrigatorio && codigos.some((codigo) => !codigo)) throw new TRPCError({ code: "BAD_REQUEST", message: "Cada saco precisa do seu adesivo com QR Code. Leia o QR do adesivo colado no saco ou digite o código." });
  const informados = codigos.filter((codigo): codigo is string => Boolean(codigo));
  if (new Set(informados).size !== informados.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Cada saco usa um adesivo diferente: o mesmo adesivo foi lido em dois sacos." });
  if (!informados.length) return codigos.map(() => null);
  const db = await getDb();
  const encontrados = await db.select().from(adesivos).where(and(eq(adesivos.condominioId, estacao.condominioId), inArray(adesivos.codigo, informados)));
  return codigos.map((codigo) => {
    if (!codigo) return null;
    const adesivo = encontrados.find((registro) => registro.codigo === codigo);
    // Mesma mensagem para "não existe" e "é de outro morador": o tablet não revela de quem é um adesivo.
    if (!adesivo || adesivo.moradorId !== morador.id) throw new TRPCError({ code: "BAD_REQUEST", message: `O adesivo ${codigo} não pertence a este morador. Use um adesivo do seu kit.` });
    if (adesivo.status === "utilizado") throw new TRPCError({ code: "BAD_REQUEST", message: `O adesivo ${codigo} já foi usado em outro descarte. Cada adesivo vale para um saco só.` });
    if (adesivo.status === "cancelado") throw new TRPCError({ code: "BAD_REQUEST", message: `O adesivo ${codigo} foi cancelado pela administração. Use outro adesivo do seu kit.` });
    return adesivo;
  });
}

function rotuloResultadoIa(resultado: "aprovado_automatico" | "pendente" | "erro") {
  return resultado === "aprovado_automatico" ? "aprovado pela IA" : resultado === "erro" ? "análise automática indisponível" : "pendente de avaliação";
}

export const estacoesRouter = router({
  estacoes: router({
    listar: administratorOnly.query(async ({ ctx }) => {
      const db = await getDb();
      const linhas = await db.select().from(estacoesPesagem).where(eq(estacoesPesagem.condominioId, ctx.eco.condominio.id)).orderBy(asc(estacoesPesagem.nome));
      return linhas.map(({ tokenHash: _oculto, ...estacao }) => estacao);
    }),
    /** Cadastra um tablet; o código de pareamento volta só nesta resposta (no banco fica apenas o hash). */
    criar: administratorOnly.input(z.object({
      name: z.string().trim().min(3).max(120),
      location: z.string().trim().min(3).max(200),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const token = gerarTokenEstacao();
      const inserida = await db.insert(estacoesPesagem).values({
        condominioId: ctx.eco.condominio.id,
        nome: input.name,
        local: input.location,
        tokenHash: hashTokenEstacao(token),
        criadoPorId: ctx.user.id,
      }).$returningId();
      await writeAuditLog(db, {
        condominioId: ctx.eco.condominio.id,
        autorId: ctx.user.id,
        tipoEntidade: "estacao",
        entidadeId: inserida[0].id,
        acao: "estacao_cadastrada",
        resumo: `Estação de pesagem "${input.name}" cadastrada (${input.location}).`,
        estadoNovo: { nome: input.name, local: input.location },
      });
      return { id: inserida[0].id, token };
    }),
    /** Gera um novo código de pareamento; o antigo para de funcionar na hora (ex.: tablet perdido ou trocado). */
    novoCodigo: administratorOnly.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const token = gerarTokenEstacao();
      const [resultado] = await db.update(estacoesPesagem).set({ tokenHash: hashTokenEstacao(token), atualizadoEm: new Date() }).where(and(eq(estacoesPesagem.id, input.id), eq(estacoesPesagem.condominioId, ctx.eco.condominio.id)));
      if (!resultado.affectedRows) throw new TRPCError({ code: "NOT_FOUND", message: "Estação não encontrada." });
      await writeAuditLog(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "estacao", entidadeId: input.id, acao: "estacao_novo_codigo", resumo: "Novo código de pareamento gerado; o anterior deixou de valer." });
      return { token };
    }),
    alternar: administratorOnly.input(z.object({ id: z.number().int().positive(), active: z.boolean() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [resultado] = await db.update(estacoesPesagem).set({ ativo: input.active, atualizadoEm: new Date() }).where(and(eq(estacoesPesagem.id, input.id), eq(estacoesPesagem.condominioId, ctx.eco.condominio.id)));
      if (!resultado.affectedRows) throw new TRPCError({ code: "NOT_FOUND", message: "Estação não encontrada." });
      await writeAuditLog(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "estacao", entidadeId: input.id, acao: input.active ? "estacao_ativada" : "estacao_desativada", resumo: input.active ? "Estação de pesagem reativada." : "Estação de pesagem desativada." });
      return { success: true };
    }),
    /** Liga o modo demonstração (sem balança real): o peso é digitado como se viesse da balança e a foto do visor fica opcional. */
    definirModoDemonstracao: administratorOnly.input(z.object({ id: z.number().int().positive(), enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [resultado] = await db.update(estacoesPesagem).set({ modoDemonstracao: input.enabled, atualizadoEm: new Date() }).where(and(eq(estacoesPesagem.id, input.id), eq(estacoesPesagem.condominioId, ctx.eco.condominio.id)));
      if (!resultado.affectedRows) throw new TRPCError({ code: "NOT_FOUND", message: "Estação não encontrada." });
      await writeAuditLog(db, {
        condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "estacao", entidadeId: input.id,
        acao: input.enabled ? "estacao_modo_demonstracao_ligado" : "estacao_modo_demonstracao_desligado",
        resumo: input.enabled ? "Modo demonstração ligado: balança simulada e foto opcional." : "Modo demonstração desligado: a estação volta a exigir a foto do visor da balança.",
        estadoAnterior: { modoDemonstracao: !input.enabled }, estadoNovo: { modoDemonstracao: input.enabled },
      });
      return { success: true };
    }),
  }),
  estacao: router({
    /** No app do morador: gera o código de 6 dígitos (uso único, vale poucos minutos) para digitar no tablet. */
    gerarCodigo: withProfile.mutation(async ({ ctx }) => {
      if (ctx.eco.perfil.papel !== "morador" || !ctx.eco.morador || ctx.eco.morador.status !== "ativo") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Apenas moradores ativos registram descartes na estação." });
      }
      const db = await getDb();
      const expiraEm = new Date(Date.now() + VALIDADE_CODIGO_ESTACAO_MINUTOS * 60_000);
      // Repete em caso (raro) de colisão com o código ativo de outro morador do mesmo condomínio.
      for (let tentativa = 0; tentativa < 5; tentativa += 1) {
        const codigo = gerarCodigoEstacao();
        const emUso = await db.select({ id: moradores.id }).from(moradores).where(and(
          eq(moradores.condominioId, ctx.eco.condominio.id),
          eq(moradores.codigoEstacao, codigo),
          ne(moradores.id, ctx.eco.morador.id),
        )).limit(1);
        if (emUso[0]) continue;
        // Sem notificação: o morador acabou de gerar o código e está olhando para ele na tela.
        await db.update(moradores).set({ codigoEstacao: codigo, codigoEstacaoExpiraEm: expiraEm, atualizadoEm: new Date() }).where(eq(moradores.id, ctx.eco.morador.id));
        const qrDataUrl = await QRCode.toDataURL(codigo, { margin: 1, width: 240 });
        return { code: codigo, expiresAt: expiraEm, qrDataUrl };
      }
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível gerar o código agora. Tente de novo." });
    }),
    /** Dados do tablet pareado, com as regras de cada tipo e a cor do saco, para orientar o morador na tela. */
    status: estacaoPareada.query(async ({ ctx }) => {
      const regras = await regrasDoCondominio(ctx.estacao.condominioId);
      const cores = await coresDosSacos(ctx.estacao.condominioId);
      return {
        id: ctx.estacao.id,
        nome: ctx.estacao.nome,
        local: ctx.estacao.local,
        limitePorRegistroKg: LIMITE_PESO_POR_REGISTRO_ESTACAO_GRAMAS / 1000,
        maximoItens: MAXIMO_ITENS_POR_DESCARTE,
        modoDemonstracao: ctx.estacao.modoDemonstracao,
        adesivoObrigatorio: (await configuracoesDaEstacao(ctx.estacao.condominioId)).adesivoObrigatorio,
        simulacoesIa: ctx.estacao.modoDemonstracao ? simulacoesIa : [],
        tipos: tiposResiduo.map((tipo) => ({ tipo, rotulo: rotuloResiduo[tipo], pesoMinimoKg: regras[tipo].pesoMinimoGramas / 1000, pesoMaximoKg: regras[tipo].pesoMaximoGramas / 1000, pontosPorKg: regras[tipo].pontosPorKg, corSaco: cores[tipo].cor, nomeCorSaco: cores[tipo].nome })),
      };
    }),
    /** Mostra no tablet de quem é o código, para o morador confirmar antes de pesar (não consome o código). */
    identificar: estacaoPareada.input(z.object({ code: codigoInput })).mutation(async ({ ctx, input }) => {
      const morador = await moradorPorCodigo(ctx.estacao, input.code);
      const disponiveis = await adesivosDisponiveis(morador.id);
      const { adesivoObrigatorio } = await configuracoesDaEstacao(ctx.estacao.condominioId);
      // Na estação de demonstração, o tablet já sugere adesivos do kit do morador (a banca não precisa de adesivos impressos).
      const sugestoes = ctx.estacao.modoDemonstracao
        ? (await (await getDb()).select({ codigo: adesivos.codigo }).from(adesivos).where(and(eq(adesivos.moradorId, morador.id), eq(adesivos.status, "disponivel"))).orderBy(asc(adesivos.id)).limit(MAXIMO_ITENS_POR_DESCARTE)).map((adesivo) => adesivo.codigo)
        : [];
      return { firstName: morador.nome.split(" ")[0], block: morador.bloco, apartment: morador.apartamento, adesivosDisponiveis: disponiveis, adesivoObrigatorio, adesivosDemonstracao: sugestoes };
    }),
    /**
     * Conferência antes de confirmar: mostra cada tipo com peso, unidade, pontos previstos e alertas (ou o bloqueio),
     * sem gravar nada e sem consumir o código.
     */
    previa: estacaoPareada.input(z.object({ code: codigoInput, itens: itensInput })).mutation(async ({ ctx, input }) => {
      const morador = await moradorPorCodigo(ctx.estacao, input.code);
      const { adesivoObrigatorio } = await configuracoesDaEstacao(ctx.estacao.condominioId);
      const adesivosItens = await adesivosDoDescarte(ctx.estacao, morador, input.itens, adesivoObrigatorio);
      const itensResumo = input.itens.map((item, indice) => ({ wasteType: item.wasteType, material: rotuloResiduo[item.wasteType], pesoKg: formatarKg(Math.max(0, item.weightGrams)), adesivo: adesivosItens[indice]?.codigo ?? null }));
      const resumo = { estacao: ctx.estacao.nome, morador: morador.nome.split(" ")[0], bloco: morador.bloco, unidade: "kg", pesagemSimulada: ctx.estacao.modoDemonstracao, pesoTotalKg: formatarKg(Math.max(0, input.itens.reduce((soma, item) => soma + item.weightGrams, 0))) };
      try {
        const avaliados = await avaliarDescarte(ctx.estacao, morador, input.itens, new Date());
        const suspensao = avaliados[0]?.suspensao ?? null;
        return { ...resumo, bloqueio: null as string | null, semPontos: suspensao ? textoSemPontos(suspensao) : null, itens: avaliados.map((item, indice) => ({ ...itensResumo[indice], pontosPrevistos: item.pontosPrevistos, alertas: item.alertas })), pontosPrevistos: avaliados.reduce((soma, item) => soma + item.milesimos, 0) / 1000 };
      } catch (error) {
        if (error instanceof LimiteAntifraudeExcedidoError) return { ...resumo, bloqueio: error.message, semPontos: null as string | null, itens: itensResumo.map((item) => ({ ...item, pontosPrevistos: 0, alertas: [] as string[] })), pontosPrevistos: 0 };
        throw error;
      }
    }),
    /**
     * Grava o descarte: um registro por saco (tipo), todos no mesmo lote, cada um com o seu adesivo QR (que passa a "utilizado").
     * A IA analisa a foto de cada saco (tipo, peso no visor e cor do saco): o que confere com as regras é aprovado na hora
     * e os pontos entram; o que tiver divergência, dúvida ou alerta antifraude fica pendente para um responsável avaliar.
     */
    registrar: estacaoPareada.input(z.object({ code: codigoInput, itens: itensInput })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const estacao = ctx.estacao;
      const simulada = estacao.modoDemonstracao;
      if (!simulada && input.itens.some((item) => !item.imageDataUrl || item.imageDataUrl.length < 30)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Tire a foto de cada saco na balança, com o visor aparecendo, para registrar." });
      }
      const morador = await moradorPorCodigo(estacao, input.code);
      const configuracoes = await configuracoesDaEstacao(estacao.condominioId);
      const adesivosItens = await adesivosDoDescarte(estacao, morador, input.itens, configuracoes.adesivoObrigatorio);
      const agora = new Date();

      let avaliados;
      try {
        avaliados = await avaliarDescarte(estacao, morador, input.itens, agora);
      } catch (error) {
        if (error instanceof LimiteAntifraudeExcedidoError) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        throw error;
      }

      // Análise da IA antes de gravar (fora da transação, pois pode levar alguns segundos por foto).
      const cores = await coresDosSacos(estacao.condominioId);
      const coresPorTipo = Object.fromEntries(tiposResiduo.map((tipo) => [tipo, cores[tipo].nome])) as Record<TipoResiduo, string>;
      const analises: Array<{ leitura: LeituraIa; resultado: "aprovado_automatico" | "pendente" | "erro"; motivos: string[]; corEsperada: string }> = [];
      for (let indice = 0; indice < avaliados.length; indice += 1) {
        const item = avaliados[indice];
        const corEsperada = cores[item.wasteType].nome;
        const leitura = await analisarItem({ tipoDeclarado: item.wasteType, pesoDeclaradoGramas: item.weightGrams, imagemDataUrl: input.itens[indice].imageDataUrl ?? null, corSacoEsperada: corEsperada, coresPorTipo }, { simulacao: input.itens[indice].simulacaoIa ?? null, estacaoDemonstracao: simulada });
        const decisao = decidirAnalise({ tipoDeclarado: item.wasteType, pesoDeclaradoGramas: item.weightGrams, corSacoEsperada: corEsperada }, leitura, { aprovacaoAutomatica: configuracoes.iaAprovacaoAutomatica, confiancaMinima: configuracoes.iaConfiancaMinima, alertasAntifraude: item.alertas });
        analises.push({ leitura, ...decisao, corEsperada });
      }

      const lote = nanoid(12);
      const fotos: Array<{ key: string | null; url: string | null }> = [];
      for (const item of input.itens) {
        if (!item.imageDataUrl) { fotos.push({ key: null, url: null }); continue; }
        try {
          fotos.push(await salvarImagemBase64(item.imageDataUrl, `coletas/${estacao.condominioId}/estacao-${estacao.id}-${lote}-${item.wasteType}`));
        } catch (error) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Não foi possível salvar a foto da balança." });
        }
      }

      const ids: number[] = [];
      await db.transaction(async (tx) => {
        // Consome o código na mesma transação do registro: dois envios simultâneos com o mesmo código geram um único descarte.
        const [consumo] = await tx.update(moradores).set({ codigoEstacao: null, codigoEstacaoExpiraEm: null }).where(and(eq(moradores.id, morador.id), eq(moradores.codigoEstacao, input.code)));
        if (!consumo.affectedRows) throw new TRPCError({ code: "CONFLICT", message: "Este código já foi usado. Gere um novo código no aplicativo." });
        for (let indice = 0; indice < avaliados.length; indice += 1) {
          const item = avaliados[indice];
          const analise = analises[indice];
          const adesivo = adesivosItens[indice];
          const observacoes = [simulada ? "Pesagem simulada (modo demonstração)." : null, item.alertas.length ? `Atenção na conferência: ${item.alertas.join("; ")}.` : null].filter(Boolean).join(" ") || null;
          const inserida = await tx.insert(coletas).values({
            condominioId: estacao.condominioId,
            moradorId: morador.id,
            criadoPorId: morador.usuarioId,
            concluidoPorId: morador.usuarioId,
            estacaoId: estacao.id,
            tipoResiduo: item.wasteType,
            bloco: morador.bloco,
            agendadaPara: agora,
            concluidaEm: agora,
            pesoGramas: item.weightGrams,
            pontosConcedidos: 0,
            // O valor prometido no tablet fica gravado: se a regra mudar antes da aprovação, vale o que o morador viu.
            pontosPrevistosMilesimos: item.milesimos,
            status: "concluida",
            observacoes,
            chaveFoto: fotos[indice].key,
            urlFoto: fotos[indice].url,
            pendenteAprovacaoPeso: true,
            aprovacaoPesoStatus: "pendente",
            pesagemSimulada: simulada,
            lote,
            adesivoId: adesivo?.id ?? null,
          }).$returningId();
          ids.push(inserida[0].id);
          if (adesivo) {
            // Uso único: só marca se ainda estava disponível (dois tablets com o mesmo adesivo ao mesmo tempo não passam).
            const [uso] = await tx.update(adesivos).set({ status: "utilizado", coletaId: inserida[0].id, utilizadoEm: agora }).where(and(eq(adesivos.id, adesivo.id), eq(adesivos.status, "disponivel")));
            if (!uso.affectedRows) throw new TRPCError({ code: "CONFLICT", message: `O adesivo ${adesivo.codigo} acabou de ser usado em outro descarte.` });
          }
          await tx.insert(analisesIa).values({
            condominioId: estacao.condominioId,
            coletaId: inserida[0].id,
            modo: analise.leitura.modo,
            modelo: analise.leitura.modelo,
            tipoIdentificado: analise.leitura.tipoIdentificado,
            pesoLidoGramas: analise.leitura.pesoLidoGramas,
            corSacoIdentificada: analise.leitura.corSacoIdentificada,
            corSacoEsperada: analise.corEsperada,
            confianca: analise.leitura.confianca,
            resultado: analise.resultado,
            motivos: JSON.stringify(analise.motivos),
            descricao: analise.leitura.descricao || null,
            duracaoMs: analise.leitura.duracaoMs,
          });
        }
        await tx.update(estacoesPesagem).set({ ultimoUsoEm: agora }).where(eq(estacoesPesagem.id, estacao.id));
      });

      for (let indice = 0; indice < avaliados.length; indice += 1) {
        const item = avaliados[indice];
        const analise = analises[indice];
        const kg = formatarKg(item.weightGrams);
        const adesivo = adesivosItens[indice];
        await writeAuditLog(db, {
          condominioId: estacao.condominioId,
          autorId: morador.usuarioId,
          tipoEntidade: "coleta",
          entidadeId: ids[indice],
          acao: "registro_estacao",
          resumo: `Descarte de ${kg} kg de ${residuoNaFrase[item.wasteType]} na estação "${estacao.nome}"${adesivo ? ` com o adesivo ${adesivo.codigo}` : ""}${simulada ? " (balança simulada)" : ""}; análise da IA: ${rotuloResultadoIa(analise.resultado)}${analise.motivos.length ? ` (${analise.motivos.join(" ")})` : ""}${item.suspensao ? "; sem pontos: participação do morador suspensa" : ""}.`,
          estadoNovo: { estacaoId: estacao.id, moradorId: morador.id, lote, tipoResiduo: item.wasteType, pesoGramas: item.weightGrams, adesivo: adesivo?.codigo ?? null, situacao: "pendente", pontosPrevistos: item.pontosPrevistos, alertas: item.alertas, pesagemSimulada: simulada, analiseIa: { modo: analise.leitura.modo, resultado: analise.resultado, confianca: analise.leitura.confianca } },
        });
      }

      // Aprovação automática: a conta técnica "EcoCondo IA" aprova (e credita os pontos) dos sacos que conferem com as regras.
      const situacoes: Array<"aprovado" | "pendente"> = analises.map(() => "pendente");
      let pontosCreditados = 0;
      if (analises.some((analise) => analise.resultado === "aprovado_automatico")) {
        const sistema = { user: { id: await idUsuarioSistemaIa() }, eco: { condominio: { id: estacao.condominioId } } };
        for (let indice = 0; indice < ids.length; indice += 1) {
          if (analises[indice].resultado !== "aprovado_automatico") continue;
          const [coleta] = await db.select().from(coletas).where(eq(coletas.id, ids[indice])).limit(1);
          const aprovado = await aprovarColeta(sistema, coleta, "Aprovado automaticamente: a análise da IA conferiu tipo, peso e cor do saco.", false, { automatico: true, notificar: false });
          pontosCreditados += aprovado.pointsAwarded;
          situacoes[indice] = "aprovado";
        }
      }

      const listaItens = avaliados.map((item) => `${rotuloResiduo[item.wasteType]} ${formatarKg(item.weightGrams)} kg`).join(", ");
      const numeros = ids.map((id) => `nº ${id}`).join(", ");
      const base = { condominioId: estacao.condominioId, coletaId: ids[0] };
      const pendentes = avaliados.map((item, indice) => ({ item, indice })).filter(({ indice }) => situacoes[indice] === "pendente");
      const aprovados = avaliados.filter((_, indice) => situacoes[indice] === "aprovado");
      if (pendentes.length) {
        // Irregularidade: a IA viu algo diferente do declarado (outro tipo, outra cor de saco) ou apontou um problema na foto.
        const irregular = pendentes.some(({ item, indice }) => {
          const { leitura, resultado, corEsperada } = analises[indice];
          return resultado === "pendente" && (leitura.problemas.length > 0 || Boolean(leitura.tipoIdentificado && leitura.tipoIdentificado !== item.wasteType) || Boolean(leitura.corSacoIdentificada && !mesmaCor(leitura.corSacoIdentificada, corEsperada)));
        });
        const historico = pendentes.some(({ item }) => item.alertas.some((alerta) => alerta.includes("histórico")));
        const motivos = pendentes.map(({ item, indice }) => `${rotuloResiduo[item.wasteType]} (nº ${ids[indice]}): ${analises[indice].motivos.join(" ")}`);
        await notificarAdministradores(db, {
          ...base,
          coletaId: ids[pendentes[0].indice],
          tipo: irregular ? "irregularidade_detectada" : historico ? "peso_suspeito" : "descarte_aguardando_aprovacao",
          titulo: irregular ? "A IA apontou irregularidade num descarte" : "Descarte aguardando avaliação",
          mensagem: `${morador.nome} (bloco ${morador.bloco}) descartou ${listaItens} na estação "${estacao.nome}" (${numeros}). ${pendentes.length === avaliados.length ? "Nenhum saco" : `${aprovados.length} saco(s) aprovado(s) pela IA; ${pendentes.length}`} ficou(aram) para avaliação: ${motivos.join(" | ")}`,
        });
      }
      // Uma notificação só para o morador, com o que foi aprovado e o que ficou para conferência.
      const pontosPendentes = pendentes.reduce((soma, { item }) => soma + item.milesimos, 0) / 1000;
      const partes = [
        aprovados.length ? `${aprovados.length === avaliados.length ? "Tudo" : `${aprovados.length} saco(s)`} aprovado(s) na hora pela análise automática${pontosCreditados ? ` (+${pontosCreditados} ponto(s) no saldo)` : ""}.` : null,
        pendentes.length ? `${pendentes.length === avaliados.length ? "O descarte" : `${pendentes.length} saco(s)`} ficou(aram) para a administração conferir${pontosPendentes ? ` (${formatarPontos(pontosPendentes)} ponto(s) previsto(s) depois da aprovação)` : ""}.` : null,
      ].filter(Boolean).join(" ");
      await notificarUsuario(db, morador.usuarioId, {
        ...base,
        tipo: pendentes.length ? "pesagem_registrada" : "descarte_aprovado_ia",
        titulo: pendentes.length ? (aprovados.length ? "Descarte registrado: parte aprovada, parte em conferência" : "Descarte registrado, aguardando avaliação") : pontosCreditados ? `Descarte aprovado: +${pontosCreditados} ponto(s)` : "Descarte aprovado",
        mensagem: `A estação "${estacao.nome}" registrou ${listaItens} (${numeros})${simulada ? ", em modo demonstração" : ""}. ${partes}${avaliados[0]?.suspensao ? ` ${textoSemPontos(avaliados[0].suspensao)}` : ""}`,
      });
      // Aviso de adesivos acabando (quando chega ao limite e quando zera), para o morador pedir mais pelo sistema.
      if (adesivosItens.some(Boolean)) {
        const restantes = await adesivosDisponiveis(morador.id);
        const antes = restantes + adesivosItens.filter(Boolean).length;
        if (restantes === 0 || (antes > LIMITE_ADESIVOS_ACABANDO && restantes <= LIMITE_ADESIVOS_ACABANDO)) {
          await notificarUsuario(db, morador.usuarioId, { condominioId: estacao.condominioId, tipo: "adesivos_acabando", titulo: restantes ? "Seus adesivos estão acabando" : "Seus adesivos acabaram", mensagem: restantes ? `Restam ${restantes} adesivo(s) com QR Code. Peça mais em Meus adesivos para não ficar sem.` : "Você usou todos os adesivos com QR Code. Peça mais em Meus adesivos; sem adesivo não dá para registrar o descarte." });
        }
      }

      const pesoTotal = avaliados.reduce((soma, item) => soma + item.weightGrams, 0);
      return {
        lote,
        ids,
        id: ids[0],
        status: "concluida" as const,
        situacao: pendentes.length ? ("pendente" as const) : ("aprovado" as const),
        pendingApproval: pendentes.length > 0,
        pointsAwarded: pontosCreditados,
        pendingPoints: pontosPendentes,
        semPontos: avaliados[0]?.suspensao ? textoSemPontos(avaliados[0].suspensao) : null,
        modoIa: analises[0]?.leitura.modo ?? "simulacao",
        itens: avaliados.map((item, indice) => ({
          id: ids[indice],
          wasteType: item.wasteType,
          material: rotuloResiduo[item.wasteType],
          pesoKg: formatarKg(item.weightGrams),
          pontosPrevistos: item.pontosPrevistos,
          alertas: item.alertas,
          adesivo: adesivosItens[indice]?.codigo ?? null,
          situacao: situacoes[indice],
          ia: { resultado: analises[indice].resultado, motivos: analises[indice].motivos, confianca: analises[indice].leitura.confianca, descricao: analises[indice].leitura.descricao, corSaco: analises[indice].leitura.corSacoIdentificada, corEsperada: analises[indice].corEsperada },
        })),
        simulated: simulada,
        weightKg: formatarKg(pesoTotal),
        notificationsSent: true,
      };
    }),
  }),
});

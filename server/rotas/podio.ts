import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, isNotNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import { coletas, condominios, entregasPremioPodio, moradores, movimentacoesPontos, notificacoes, periodosPodio, premiosPodio } from "../../drizzle/schema";
import { getDb } from "../db";
import { administratorOnly, withProfile } from "./nucleo";
import { router } from "../_core/trpc";
import { writeAuditLog } from "../audit";
import { pesoConfirmadoGramas } from "../dominio/antifraude";
import { classificarPodio } from "../dominio/regrasPodio";
import { nomePublico, recortarRankingPublico } from "../dominio/privacidadeRanking";
import { suspensoesVigentesDoCondominio } from "../penalidades";

const periodos = periodosPodio;
export type Periodo = (typeof periodos)[number];

/** Soma pontos e peso confirmado de cada morador nas coletas concluídas do período. */
export function somarPorMorador(registros: Array<typeof coletas.$inferSelect>) {
  const totais = new Map<number, { moradorId: number; pontos: number; pesoGramas: number }>();
  for (const registro of registros) {
    if (!registro.moradorId) continue;
    const atual = totais.get(registro.moradorId) ?? { moradorId: registro.moradorId, pontos: 0, pesoGramas: 0 };
    atual.pontos += registro.pontosConcedidos;
    atual.pesoGramas += pesoConfirmadoGramas(registro) ?? 0;
    totais.set(registro.moradorId, atual);
  }
  return Array.from(totais.values());
}

/** Calcula o intervalo [inicio, fim] do período de apuração do pódio, a partir de uma data de referência (padrão: hoje). */
export function calcularIntervalo(periodo: Periodo, dataReferencia: Date) {
  const ano = dataReferencia.getFullYear();
  if (periodo === "mensal") {
    const mes = dataReferencia.getMonth();
    return { inicio: new Date(ano, mes, 1, 0, 0, 0), fim: new Date(ano, mes + 1, 0, 23, 59, 59) };
  }
  if (periodo === "semestral") {
    const primeiroSemestre = dataReferencia.getMonth() < 6;
    return primeiroSemestre
      ? { inicio: new Date(ano, 0, 1, 0, 0, 0), fim: new Date(ano, 5, 30, 23, 59, 59) }
      : { inicio: new Date(ano, 6, 1, 0, 0, 0), fim: new Date(ano, 11, 31, 23, 59, 59) };
  }
  return { inicio: new Date(ano, 0, 1, 0, 0, 0), fim: new Date(ano, 11, 31, 23, 59, 59) };
}

/** Prêmios configurados para o período, por posição (1º, 2º e 3º). */
async function premiosDoPeriodo(condominioId: number, periodo: Periodo) {
  const db = await getDb();
  const linhas = await db.select().from(premiosPodio).where(and(eq(premiosPodio.condominioId, condominioId), eq(premiosPodio.periodo, periodo))).orderBy(asc(premiosPodio.posicao));
  return linhas.map((linha) => ({ posicao: linha.posicao, titulo: linha.titulo, descricao: linha.descricao }));
}

/** Quando o administrador zerou os pontos de todos, o que veio antes da zeragem não conta mais para nenhum ranking. */
export async function inicioDoCiclo(condominioId: number, inicio?: Date) {
  const db = await getDb();
  const [condominio] = await db.select({ zeradoEm: condominios.pontosZeradosEm }).from(condominios).where(eq(condominios.id, condominioId)).limit(1);
  const zeradoEm = condominio?.zeradoEm ?? null;
  if (!zeradoEm) return inicio;
  return !inicio || zeradoEm > inicio ? zeradoEm : inicio;
}

/**
 * Pontos retirados por medidas administrativas (e devolvidos quando a medida é revogada) em cada morador no período.
 * Assim a retirada de pontos de uma auditoria ou ocorrência vale para o saldo e também para o pódio e o ranking.
 */
export async function ajustesDePenalidade(condominioId: number, inicio?: Date, fim?: Date) {
  const db = await getDb();
  const condicoes = [
    eq(movimentacoesPontos.condominioId, condominioId),
    or(eq(movimentacoesPontos.tipo, "penalidade"), and(eq(movimentacoesPontos.tipo, "ajuste"), isNotNull(movimentacoesPontos.penalidadeId))),
  ];
  if (inicio) condicoes.push(gte(movimentacoesPontos.criadoEm, inicio));
  if (fim) condicoes.push(lte(movimentacoesPontos.criadoEm, fim));
  const linhas = await db.select({ moradorId: movimentacoesPontos.moradorId, pontos: movimentacoesPontos.pontos }).from(movimentacoesPontos).where(and(...condicoes));
  const mapa = new Map<number, number>();
  for (const linha of linhas) mapa.set(linha.moradorId, (mapa.get(linha.moradorId) ?? 0) + linha.pontos);
  return mapa;
}

/** Soma os ajustes de penalidade aos totais dos descartes (quem só tem retirada fica negativo e sai da classificação). */
export function descontarPenalidades<T extends { moradorId: number; pontos: number; pesoGramas: number }>(totais: T[], ajustes: Map<number, number>) {
  const porMorador = new Map(totais.map((linha) => [linha.moradorId, { ...linha }]));
  ajustes.forEach((pontos, moradorId) => {
    const atual = porMorador.get(moradorId);
    if (atual) atual.pontos += pontos;
  });
  return Array.from(porMorador.values());
}

export async function classificacaoDoPeriodo(condominioId: number, inicioPeriodo: Date, fim: Date) {
  const db = await getDb();
  const inicio = (await inicioDoCiclo(condominioId, inicioPeriodo))!;
  const registros = await db.select().from(coletas).where(and(
    eq(coletas.condominioId, condominioId),
    eq(coletas.status, "concluida"),
    gte(coletas.concluidaEm, inicio),
    lte(coletas.concluidaEm, fim),
  ));
  return classificarPodio(descontarPenalidades(somarPorMorador(registros), await ajustesDePenalidade(condominioId, inicio, fim)));
}

export const podioRouter = router({
  podio: router({
    /**
     * Administrador: ranking completo, com as entregas de prêmio. Morador: só o top 3 (nome e bloco) e a própria posição;
     * ninguém abaixo do 3º lugar é exposto.
     */
    ranking: withProfile.input(z.object({ periodo: z.enum(periodos), dataReferencia: z.date().optional() })).query(async ({ ctx, input }) => {
      const db = await getDb();
      const dataReferencia = input.dataReferencia ?? new Date();
      const { inicio, fim } = calcularIntervalo(input.periodo, dataReferencia);
      const comunidade = await db.select().from(moradores).where(eq(moradores.condominioId, ctx.eco.condominio.id));
      const moradoresPorId = new Map(comunidade.map((morador) => [morador.id, morador]));
      const classificados = (await classificacaoDoPeriodo(ctx.eco.condominio.id, inicio, fim)).filter((linha) => moradoresPorId.has(linha.moradorId));
      const premios = await premiosDoPeriodo(ctx.eco.condominio.id, input.periodo);
      const premioDaPosicao = (posicao: number) => premios.find((premio) => premio.posicao === posicao) ?? null;
      const ehAdministrador = ctx.eco.perfil.papel === "administrador";

      const entregas = ehAdministrador
        ? await db.select().from(entregasPremioPodio).where(and(
          eq(entregasPremioPodio.condominioId, ctx.eco.condominio.id),
          eq(entregasPremioPodio.periodo, input.periodo),
          eq(entregasPremioPodio.intervaloInicio, inicio),
        ))
        : [];
      const { publicas, minha, total } = recortarRankingPublico(classificados, ctx.eco.morador?.id ?? null);
      const linhasVisiveis = ehAdministrador ? classificados : publicas;
      const suspensoes = await suspensoesVigentesDoCondominio(db, ctx.eco.condominio.id);

      const ranking = linhasVisiveis.map((linha) => {
        const morador = moradoresPorId.get(linha.moradorId)!;
        const entrega = entregas.find((item) => item.moradorId === linha.moradorId);
        const voce = linha.moradorId === ctx.eco.morador?.id;
        const suspensao = suspensoes.get(linha.moradorId) ?? null;
        return {
          position: linha.posicao,
          empatado: linha.empatado,
          moradorId: ehAdministrador ? linha.moradorId : null,
          // Suspenso: para os vizinhos o nome fica oculto até a suspensão acabar ou ser revogada (só ele e a administração veem).
          nome: ehAdministrador || voce ? morador.nome : nomePublico(morador, Boolean(suspensao)),
          suspensao: suspensao ? { periodo: suspensao.periodo, inicioEm: suspensao.inicioEm, fimEm: suspensao.fimEm } : null,
          bloco: morador.bloco,
          apartamento: ehAdministrador ? morador.apartamento : null,
          pontos: linha.pontos,
          pesoKg: Number((linha.pesoGramas / 1000).toFixed(2)),
          noPodio: linha.noPodio,
          voce,
          premio: linha.noPodio ? premioDaPosicao(linha.posicao) : null,
          premioEntregue: entrega ? { premio: entrega.premio, entregueEm: entrega.entregueEm, observacao: entrega.observacao } : null,
        };
      });

      return {
        periodo: input.periodo,
        intervalo: { inicio, fim },
        ranking,
        premios,
        minhaPosicao: minha ? { position: minha.posicao, pontos: minha.pontos, pesoKg: Number((minha.pesoGramas / 1000).toFixed(2)) } : null,
        minhaSuspensao: ctx.eco.morador && suspensoes.get(ctx.eco.morador.id) ? { periodo: suspensoes.get(ctx.eco.morador.id)!.periodo, fimEm: suspensoes.get(ctx.eco.morador.id)!.fimEm } : null,
        totalParticipantes: total,
      };
    }),
    historicoPremios: administratorOnly.query(async ({ ctx }) => {
      const db = await getDb();
      const linhas = await db.select({ entrega: entregasPremioPodio, morador: moradores }).from(entregasPremioPodio)
        .leftJoin(moradores, eq(moradores.id, entregasPremioPodio.moradorId))
        .where(eq(entregasPremioPodio.condominioId, ctx.eco.condominio.id))
        .orderBy(desc(entregasPremioPodio.entregueEm));
      return linhas.map(({ entrega, morador }) => ({ ...entrega, moradorNome: morador?.nome ?? "Morador removido" }));
    }),
    /** Define (ou remove, com título vazio) o prêmio de cada posição do pódio de um período. */
    configurarPremios: administratorOnly.input(z.object({
      periodo: z.enum(periodos),
      premios: z.array(z.object({
        posicao: z.number().int().min(1).max(3),
        titulo: z.string().trim().max(120),
        descricao: z.string().trim().max(500).nullable().optional(),
      })).max(3),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const anteriores = await premiosDoPeriodo(ctx.eco.condominio.id, input.periodo);
      for (const premio of input.premios) {
        const filtro = and(eq(premiosPodio.condominioId, ctx.eco.condominio.id), eq(premiosPodio.periodo, input.periodo), eq(premiosPodio.posicao, premio.posicao));
        if (!premio.titulo) {
          await db.delete(premiosPodio).where(filtro);
          continue;
        }
        if (premio.titulo.length < 3) throw new TRPCError({ code: "BAD_REQUEST", message: "O nome do prêmio precisa ter pelo menos 3 letras." });
        await db.insert(premiosPodio).values({ condominioId: ctx.eco.condominio.id, periodo: input.periodo, posicao: premio.posicao, titulo: premio.titulo, descricao: premio.descricao || null })
          .onDuplicateKeyUpdate({ set: { titulo: premio.titulo, descricao: premio.descricao || null, atualizadoEm: new Date() } });
      }
      const atuais = await premiosDoPeriodo(ctx.eco.condominio.id, input.periodo);
      await writeAuditLog(db, {
        condominioId: ctx.eco.condominio.id,
        autorId: ctx.user.id,
        tipoEntidade: "premio_podio",
        entidadeId: 0,
        acao: "premios_podio_configurados",
        resumo: `Prêmios do pódio ${input.periodo} atualizados.`,
        estadoAnterior: { premios: anteriores.map((premio) => `${premio.posicao}º: ${premio.titulo}`) },
        estadoNovo: { premios: atuais.map((premio) => `${premio.posicao}º: ${premio.titulo}`) },
      });
      return { success: true };
    }),
    marcarPremioEntregue: administratorOnly.input(z.object({
      moradorId: z.number().int().positive(),
      periodo: z.enum(periodos),
      dataReferencia: z.date().optional(),
      observacao: z.string().trim().max(500).nullable().optional(),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const dataReferencia = input.dataReferencia ?? new Date();
      const { inicio, fim } = calcularIntervalo(input.periodo, dataReferencia);
      const classificado = (await classificacaoDoPeriodo(ctx.eco.condominio.id, inicio, fim)).find((linha) => linha.moradorId === input.moradorId);
      if (!classificado?.noPodio) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Este morador não está entre os três primeiros colocados do período informado." });
      }
      const premio = (await premiosDoPeriodo(ctx.eco.condominio.id, input.periodo)).find((item) => item.posicao === classificado.posicao);
      if (!premio) throw new TRPCError({ code: "BAD_REQUEST", message: `Defina o prêmio do ${classificado.posicao}º lugar deste período antes de registrar a entrega.` });

      const morador = await db.select().from(moradores).where(and(eq(moradores.id, input.moradorId), eq(moradores.condominioId, ctx.eco.condominio.id))).limit(1);
      if (!morador[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Morador não encontrado." });
      const suspensao = (await suspensoesVigentesDoCondominio(db, ctx.eco.condominio.id)).get(input.moradorId);
      if (suspensao) throw new TRPCError({ code: "BAD_REQUEST", message: `${morador[0].nome} está com a participação suspensa (${suspensao.periodo}) e não pode receber prêmios até a suspensão acabar ou ser revogada.` });

      const existente = await db.select().from(entregasPremioPodio).where(and(
        eq(entregasPremioPodio.moradorId, input.moradorId),
        eq(entregasPremioPodio.periodo, input.periodo),
        eq(entregasPremioPodio.intervaloInicio, inicio),
      )).limit(1);
      if (existente[0]) throw new TRPCError({ code: "CONFLICT", message: "O prêmio deste morador já foi registrado como entregue neste período." });

      const inserido = await db.insert(entregasPremioPodio).values({
        condominioId: ctx.eco.condominio.id,
        moradorId: input.moradorId,
        periodo: input.periodo,
        intervaloInicio: inicio,
        intervaloFim: fim,
        posicao: classificado.posicao,
        premio: premio.titulo,
        observacao: input.observacao || null,
        entreguePorId: ctx.user.id,
      }).$returningId();

      await writeAuditLog(db, {
        condominioId: ctx.eco.condominio.id,
        autorId: ctx.user.id,
        tipoEntidade: "premio_podio",
        entidadeId: inserido[0].id,
        acao: "premio_podio_entregue",
        resumo: `Prêmio "${premio.titulo}" entregue a ${morador[0].nome} (${classificado.posicao}º lugar, período ${input.periodo}).`,
        estadoNovo: { moradorId: input.moradorId, periodo: input.periodo, posicao: classificado.posicao, premio: premio.titulo, observacao: input.observacao || null },
      });
      if (morador[0].usuarioId) {
        await db.insert(notificacoes).values({ condominioId: ctx.eco.condominio.id, destinatarioId: morador[0].usuarioId, tipo: "premio_podio", titulo: "Prêmio do pódio", mensagem: `Parabéns pelo ${classificado.posicao}º lugar! Seu prêmio "${premio.titulo}" foi registrado como entregue.` });
      }
      return { id: inserido[0].id };
    }),
    /** O próprio morador escolhe se aparece com o nome ou só como "Morador(a) do bloco X" quando estiver no top 3. */
    definirExibicaoNome: withProfile.input(z.object({ hideName: z.boolean() })).mutation(async ({ ctx, input }) => {
      if (!ctx.eco.morador) throw new TRPCError({ code: "FORBIDDEN", message: "Apenas moradores têm posição no pódio." });
      const db = await getDb();
      await db.update(moradores).set({ ocultarNomeNoPodio: input.hideName, atualizadoEm: new Date() }).where(eq(moradores.id, ctx.eco.morador.id));
      return { success: true };
    }),
  }),
});

import { and, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import {
  adesivos,
  analisesIa,
  campanhas,
  coletas,
  logsAuditoria,
  notificacoes,
  notificacoesLidas,
  ocorrencias,
  participantesCampanha,
  pedidosAdesivos,
  penalidades,
  perfisAcesso,
} from "../drizzle/schema";
import { situacaoDescarte } from "@shared/descarte";
import { historicoPenalidades, penalidadeVigente } from "./penalidades";
import { modoIaAtual } from "./ia/analiseDescarte";

type Periodo = { startDate?: Date; endDate?: Date } | undefined;

function noPeriodo(coluna: any, periodo: Periodo) {
  const condicoes = [];
  if (periodo?.startDate) condicoes.push(gte(coluna, periodo.startDate));
  if (periodo?.endDate) condicoes.push(lte(coluna, periodo.endDate));
  return condicoes;
}

function contarPor<T>(lista: T[], chave: (item: T) => string) {
  return lista.reduce<Record<string, number>>((mapa, item) => {
    const valor = chave(item);
    mapa[valor] = (mapa[valor] ?? 0) + 1;
    return mapa;
  }, {});
}

/**
 * Indicadores de gestão do condomínio (painel e relatórios do administrador): análise da IA, auditorias, medidas,
 * campanhas, adesivos, ocorrências e avisos gerais.
 */
export async function indicadoresGerais(
  db: any,
  condominioId: number,
  periodo?: Periodo
) {
  const analises = await db
    .select({
      resultado: analisesIa.resultado,
      motivos: analisesIa.motivos,
      confianca: analisesIa.confianca,
      modo: analisesIa.modo,
    })
    .from(analisesIa)
    .where(
      and(
        eq(analisesIa.condominioId, condominioId),
        ...noPeriodo(analisesIa.criadoEm, periodo)
      )
    );
  const motivos: string[] = analises.flatMap((analise: { motivos: string }) =>
    (JSON.parse(analise.motivos) as string[]).map((motivo: string) =>
      motivo
        .replace(/\(.*?\)/g, "")
        .replace(/:.*$/, "")
        .replace(/\s+\./g, ".")
        .trim()
        .slice(0, 80)
    )
  );
  const motivosComuns = Object.entries(contarPor(motivos, motivo => motivo))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([motivo, quantidade]) => ({ motivo, quantidade }));
  const aprovadasIa = analises.filter(
    (analise: { resultado: string }) =>
      analise.resultado === "aprovado_automatico"
  ).length;

  const eventos = await db
    .select({ acao: logsAuditoria.acao })
    .from(logsAuditoria)
    .where(
      and(
        eq(logsAuditoria.condominioId, condominioId),
        inArray(logsAuditoria.acao, [
          "auditoria_aberta",
          "auditoria_concluida_regular",
          "coleta_reprovada",
          "aprovacao_revertida",
          "adesivo_consultado",
          "denuncia_falsa",
        ]),
        ...noPeriodo(logsAuditoria.criadoEm, periodo)
      )
    );
  const porAcao = contarPor(eventos, (evento: { acao: string }) => evento.acao);
  const emAuditoria = await db
    .select({ id: coletas.id })
    .from(coletas)
    .where(
      and(
        eq(coletas.condominioId, condominioId),
        eq(coletas.aprovacaoPesoStatus, "auditoria")
      )
    );

  const medidas = await db
    .select()
    .from(penalidades)
    .where(
      and(
        eq(penalidades.condominioId, condominioId),
        ...noPeriodo(penalidades.criadoEm, periodo)
      )
    );
  const todasVigentes = (
    await db
      .select()
      .from(penalidades)
      .where(
        and(
          eq(penalidades.condominioId, condominioId),
          eq(penalidades.status, "ativa")
        )
      )
  ).filter((medida: typeof penalidades.$inferSelect) =>
    penalidadeVigente(medida)
  );

  const listaCampanhas = await db
    .select({ id: campanhas.id, status: campanhas.status })
    .from(campanhas)
    .where(
      and(
        eq(campanhas.condominioId, condominioId),
        isNull(campanhas.excluidaEm)
      )
    );
  const participantes = listaCampanhas.length
    ? await db
        .select({ id: participantesCampanha.id })
        .from(participantesCampanha)
        .where(
          inArray(
            participantesCampanha.campanhaId,
            listaCampanhas.map((campanha: { id: number }) => campanha.id)
          )
        )
    : [];

  const etiquetas = await db
    .select({ status: adesivos.status })
    .from(adesivos)
    .where(eq(adesivos.condominioId, condominioId));
  const pedidos = await db
    .select({
      status: pedidosAdesivos.status,
      quantidadeEntregue: pedidosAdesivos.quantidadeEntregue,
      entregueEm: pedidosAdesivos.entregueEm,
    })
    .from(pedidosAdesivos)
    .where(eq(pedidosAdesivos.condominioId, condominioId));

  const listaOcorrencias = await db
    .select({
      status: ocorrencias.status,
      categoria: ocorrencias.categoria,
      conclusao: ocorrencias.conclusao,
    })
    .from(ocorrencias)
    .where(
      and(
        eq(ocorrencias.condominioId, condominioId),
        ...noPeriodo(ocorrencias.criadoEm, periodo)
      )
    );

  const avisos = await db
    .select({ id: notificacoes.id, publico: notificacoes.publico })
    .from(notificacoes)
    .where(
      and(
        eq(notificacoes.condominioId, condominioId),
        isNull(notificacoes.destinatarioId),
        eq(notificacoes.tipo, "aviso_geral"),
        ...noPeriodo(notificacoes.criadoEm, periodo)
      )
    );
  let taxaVisualizacao = null as number | null;
  if (avisos.length) {
    const perfis = await db
      .select({ usuarioId: perfisAcesso.usuarioId, papel: perfisAcesso.papel })
      .from(perfisAcesso)
      .where(eq(perfisAcesso.condominioId, condominioId));
    const leituras = await db
      .select({
        notificacaoId: notificacoesLidas.notificacaoId,
        usuarioId: notificacoesLidas.usuarioId,
      })
      .from(notificacoesLidas)
      .where(
        inArray(
          notificacoesLidas.notificacaoId,
          avisos.map((aviso: { id: number }) => aviso.id)
        )
      );
    let esperado = 0;
    let visto = 0;
    for (const aviso of avisos as Array<{
      id: number;
      publico: string | null;
    }>) {
      const alvo = perfis.filter(
        (perfil: { papel: string }) =>
          !aviso.publico ||
          aviso.publico === "todos" ||
          (aviso.publico === "moradores"
            ? perfil.papel === "morador"
            : perfil.papel === "administrador")
      );
      esperado += alvo.length;
      visto += alvo.filter((perfil: { usuarioId: number }) =>
        leituras.some(
          (leitura: { notificacaoId: number; usuarioId: number }) =>
            leitura.notificacaoId === aviso.id &&
            leitura.usuarioId === perfil.usuarioId
        )
      ).length;
    }
    taxaVisualizacao = esperado ? Math.round((visto / esperado) * 100) : null;
  }

  return {
    ia: {
      modo: modoIaAtual(),
      analises: analises.length,
      aprovadasAutomaticamente: aprovadasIa,
      pendentes: analises.filter(
        (analise: { resultado: string }) => analise.resultado === "pendente"
      ).length,
      erros: analises.filter(
        (analise: { resultado: string }) => analise.resultado === "erro"
      ).length,
      taxaAprovacaoAutomatica: analises.length
        ? Math.round((aprovadasIa / analises.length) * 100)
        : null,
      confiancaMedia: analises.length
        ? Math.round(
            analises.reduce(
              (soma: number, analise: { confianca: number | null }) =>
                soma + (analise.confianca ?? 0),
              0
            ) / analises.length
          )
        : null,
      motivosComuns,
    },
    auditoria: {
      abertas: porAcao.auditoria_aberta ?? 0,
      emAndamento: emAuditoria.length,
      concluidasRegulares: porAcao.auditoria_concluida_regular ?? 0,
      reprovacoes: porAcao.coleta_reprovada ?? 0,
      aprovacoesRevertidas: porAcao.aprovacao_revertida ?? 0,
      consultasQr: porAcao.adesivo_consultado ?? 0,
    },
    penalidades: {
      aplicadas: medidas.length,
      vigentes: todasVigentes.length,
      revogadas: medidas.filter(
        (medida: { status: string }) => medida.status === "revogada"
      ).length,
      porTipo: contarPor(medidas, (medida: { tipo: string }) => medida.tipo),
    },
    campanhas: {
      ativas: listaCampanhas.filter(
        (campanha: { status: string }) => campanha.status === "ativa"
      ).length,
      pausadas: listaCampanhas.filter(
        (campanha: { status: string }) => campanha.status === "pausada"
      ).length,
      encerradas: listaCampanhas.filter(
        (campanha: { status: string }) => campanha.status === "encerrada"
      ).length,
      planejadas: listaCampanhas.filter(
        (campanha: { status: string }) => campanha.status === "planejada"
      ).length,
      participacoes: participantes.length,
    },
    adesivos: {
      entregues: etiquetas.length,
      utilizados: etiquetas.filter(
        (item: { status: string }) => item.status === "utilizado"
      ).length,
      disponiveis: etiquetas.filter(
        (item: { status: string }) => item.status === "disponivel"
      ).length,
      cancelados: etiquetas.filter(
        (item: { status: string }) => item.status === "cancelado"
      ).length,
      pedidosAbertos: pedidos.filter(
        (pedido: { status: string }) => pedido.status === "solicitado"
      ).length,
    },
    ocorrencias: {
      total: listaOcorrencias.length,
      abertas: listaOcorrencias.filter(
        (item: { status: string }) => item.status !== "resolvida"
      ).length,
      emAuditoria: listaOcorrencias.filter(
        (item: { status: string }) => item.status === "em_auditoria"
      ).length,
      procedentes: listaOcorrencias.filter(
        (item: { conclusao: string | null }) => item.conclusao === "procedente"
      ).length,
      improcedentes: listaOcorrencias.filter(
        (item: { conclusao: string | null }) =>
          item.conclusao === "improcedente"
      ).length,
      denunciasFalsas: listaOcorrencias.filter(
        (item: { conclusao: string | null }) =>
          item.conclusao === "denuncia_falsa"
      ).length,
      porCategoria: contarPor(
        listaOcorrencias,
        (item: { categoria: string }) => item.categoria
      ),
    },
    avisos: { enviados: avisos.length, taxaVisualizacao },
  };
}

/** Parte de gestão do relatório de um morador: medidas, adesivos, campanhas, ocorrências e resultado da IA nos descartes dele. */
export async function gestaoDoMorador(
  db: any,
  condominioId: number,
  moradorId: number,
  usuarioId: number | null,
  paraAdministrador: boolean
) {
  const medidas = await historicoPenalidades(db, condominioId, moradorId);
  const etiquetas = await db
    .select({ status: adesivos.status })
    .from(adesivos)
    .where(eq(adesivos.moradorId, moradorId));
  const pedidos = await db
    .select()
    .from(pedidosAdesivos)
    .where(eq(pedidosAdesivos.moradorId, moradorId))
    .orderBy(desc(pedidosAdesivos.criadoEm))
    .limit(10);
  const minhasCampanhas: Array<{
    id: number;
    titulo: string;
    status: (typeof campanhas.$inferSelect)["status"];
    dataFim: Date;
    entrouEm: Date;
  }> = await db
    .select({
      id: campanhas.id,
      titulo: campanhas.titulo,
      status: campanhas.status,
      dataFim: campanhas.dataFim,
      entrouEm: participantesCampanha.entrouEm,
    })
    .from(participantesCampanha)
    .innerJoin(campanhas, eq(campanhas.id, participantesCampanha.campanhaId))
    .where(
      and(
        eq(participantesCampanha.moradorId, moradorId),
        isNull(campanhas.excluidaEm)
      )
    )
    .orderBy(desc(campanhas.dataInicio));
  const registradas = usuarioId
    ? await db
        .select({
          id: ocorrencias.id,
          categoria: ocorrencias.categoria,
          status: ocorrencias.status,
          conclusao: ocorrencias.conclusao,
          criadoEm: ocorrencias.criadoEm,
        })
        .from(ocorrencias)
        .where(
          and(
            eq(ocorrencias.condominioId, condominioId),
            eq(ocorrencias.relatorId, usuarioId)
          )
        )
        .orderBy(desc(ocorrencias.criadoEm))
        .limit(20)
    : [];
  // Ocorrências sobre descartes do morador: só o administrador vê (quem denunciou não é revelado a ninguém).
  const envolvido = paraAdministrador
    ? await db
        .select({
          id: ocorrencias.id,
          categoria: ocorrencias.categoria,
          status: ocorrencias.status,
          conclusao: ocorrencias.conclusao,
          coletaId: ocorrencias.coletaId,
          criadoEm: ocorrencias.criadoEm,
        })
        .from(ocorrencias)
        .where(
          and(
            eq(ocorrencias.condominioId, condominioId),
            eq(ocorrencias.moradorEnvolvidoId, moradorId)
          )
        )
        .orderBy(desc(ocorrencias.criadoEm))
        .limit(20)
    : [];
  const registros = await db
    .select({
      id: coletas.id,
      status: coletas.status,
      pendenteAprovacaoPeso: coletas.pendenteAprovacaoPeso,
      aprovacaoPesoStatus: coletas.aprovacaoPesoStatus,
    })
    .from(coletas)
    .where(eq(coletas.moradorId, moradorId));
  const analises = registros.length
    ? await db
        .select({
          coletaId: analisesIa.coletaId,
          resultado: analisesIa.resultado,
        })
        .from(analisesIa)
        .where(
          inArray(
            analisesIa.coletaId,
            registros.map((registro: { id: number }) => registro.id)
          )
        )
    : [];
  return {
    medidas,
    medidasVigentes: medidas.filter(
      (medida: { vigente: boolean }) => medida.vigente
    ).length,
    adesivos: {
      disponiveis: etiquetas.filter(
        (item: { status: string }) => item.status === "disponivel"
      ).length,
      utilizados: etiquetas.filter(
        (item: { status: string }) => item.status === "utilizado"
      ).length,
      cancelados: etiquetas.filter(
        (item: { status: string }) => item.status === "cancelado"
      ).length,
      pedidos,
    },
    campanhas: minhasCampanhas,
    ocorrenciasRegistradas: registradas,
    ocorrenciasEnvolvido: envolvido,
    ia: {
      analisados: analises.length,
      aprovadosIa: analises.filter(
        (analise: { resultado: string }) =>
          analise.resultado === "aprovado_automatico"
      ).length,
      paraRevisao: analises.filter(
        (analise: { resultado: string }) =>
          analise.resultado !== "aprovado_automatico"
      ).length,
      emAuditoria: registros.filter(
        (registro: any) => situacaoDescarte(registro) === "auditoria"
      ).length,
    },
  };
}

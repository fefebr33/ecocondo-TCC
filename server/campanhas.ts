import { and, count, eq, gte, inArray, isNull } from "drizzle-orm";
import {
  campanhas,
  coletas,
  moradores,
  participantesCampanha,
} from "../drizzle/schema";
import type { Campanha } from "../drizzle/schema";
import { situacaoDescarte } from "@shared/descarte";
import {
  notificarAdministradores,
  notificarTodos,
  notificarUsuario,
} from "./notificacoes";
import { writeAuditLog } from "./audit";
import { palavra, plural } from "@shared/plural";

const DIA_MS = 24 * 60 * 60 * 1000;
/** Quantos dias antes do fim os participantes recebem o aviso "a campanha está acabando". */
export const DIAS_AVISO_ENCERRAMENTO = 3;

type TipoAvisoCampanha =
  | "campanha_participacao"
  | "campanha_atualizada"
  | "campanha_pausada"
  | "campanha_encerrando"
  | "campanha_encerrada";

/** Avisa cada morador que entrou na campanha. */
export async function notificarParticipantes(
  db: any,
  campanha: Campanha,
  tipo: TipoAvisoCampanha,
  titulo: string,
  mensagem: string
) {
  const linhas = await db
    .select({ usuarioId: moradores.usuarioId })
    .from(participantesCampanha)
    .innerJoin(moradores, eq(moradores.id, participantesCampanha.moradorId))
    .where(eq(participantesCampanha.campanhaId, campanha.id));
  for (const linha of linhas as Array<{ usuarioId: number | null }>)
    await notificarUsuario(db, linha.usuarioId, {
      condominioId: campanha.condominioId,
      tipo,
      titulo,
      mensagem,
    });
  return linhas.length;
}

/** Aviso geral para os moradores de que há uma campanha nova (ou que começou agora). */
export async function anunciarCampanha(
  db: any,
  campanha: Campanha,
  autorId?: number | null
) {
  await notificarTodos(db, {
    condominioId: campanha.condominioId,
    tipo: "nova_campanha",
    titulo: `Nova campanha: ${campanha.titulo}`,
    mensagem: `${campanha.descricao.slice(0, 300)} Meta: ${campanha.descricaoMeta}. Vai até ${campanha.dataFim.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}. Entre pela tela Comunidade.`,
    publico: "moradores",
    categoria: "campanha",
    autorId: autorId ?? null,
  });
}

/**
 * Indicadores de cada campanha: participantes (e % dos moradores ativos), andamento do prazo, dias restantes e resultados
 * (kg reciclados e descartes aprovados dos participantes durante a campanha).
 */
export async function indicadoresCampanhas(
  db: any,
  condominioId: number,
  lista: Campanha[],
  agora = new Date()
) {
  if (!lista.length) return new Map<number, ReturnType<typeof vazio>>();
  const ids = lista.map(campanha => campanha.id);
  const participantes = await db
    .select()
    .from(participantesCampanha)
    .where(inArray(participantesCampanha.campanhaId, ids));
  const [contagem] = await db
    .select({ total: count() })
    .from(moradores)
    .where(
      and(
        eq(moradores.condominioId, condominioId),
        eq(moradores.status, "ativo")
      )
    );
  const ativos = Number(contagem?.total ?? 0);
  const inicio = new Date(
    Math.min(...lista.map(campanha => campanha.dataInicio.getTime()))
  );
  const moradoresParticipantes = Array.from(
    new Set(participantes.map((item: { moradorId: number }) => item.moradorId))
  ) as number[];
  const registros = moradoresParticipantes.length
    ? await db
        .select()
        .from(coletas)
        .where(
          and(
            eq(coletas.condominioId, condominioId),
            inArray(coletas.moradorId, moradoresParticipantes),
            eq(coletas.status, "concluida"),
            gte(coletas.concluidaEm, inicio)
          )
        )
    : [];
  const resultado = new Map<number, ReturnType<typeof vazio>>();
  for (const campanha of lista) {
    const daCampanha = participantes.filter(
      (item: { campanhaId: number }) => item.campanhaId === campanha.id
    ) as Array<{ moradorId: number; entrouEm: Date }>;
    const fim = Math.min(campanha.dataFim.getTime(), agora.getTime());
    const validos = registros.filter(
      (registro: typeof coletas.$inferSelect) => {
        const entrada = daCampanha.find(
          item => item.moradorId === registro.moradorId
        );
        return (
          entrada &&
          registro.concluidaEm &&
          registro.concluidaEm.getTime() >= campanha.dataInicio.getTime() &&
          registro.concluidaEm.getTime() <= fim &&
          situacaoDescarte(registro) === "aprovado"
        );
      }
    );
    const duracao = Math.max(
      1,
      campanha.dataFim.getTime() - campanha.dataInicio.getTime()
    );
    resultado.set(campanha.id, {
      participantes: daCampanha.length,
      adesao: ativos ? Math.round((daCampanha.length / ativos) * 100) : 0,
      andamento: Math.max(
        0,
        Math.min(
          100,
          Math.round(
            ((agora.getTime() - campanha.dataInicio.getTime()) / duracao) * 100
          )
        )
      ),
      diasRestantes:
        campanha.status === "encerrada"
          ? 0
          : Math.max(
              0,
              Math.ceil((campanha.dataFim.getTime() - agora.getTime()) / DIA_MS)
            ),
      kgReciclados:
        Math.round(
          validos.reduce(
            (soma: number, registro: typeof coletas.$inferSelect) =>
              soma + (registro.pesoGramas ?? 0),
            0
          ) / 10
        ) / 100,
      descartes: validos.length,
    });
  }
  return resultado;
}

function vazio() {
  return {
    participantes: 0,
    adesao: 0,
    andamento: 0,
    diasRestantes: 0,
    kgReciclados: 0,
    descartes: 0,
  };
}

/**
 * Rotina (de hora em hora): começa as campanhas planejadas que chegaram na data, retoma as pausas vencidas, avisa quando
 * faltam poucos dias e encerra as que passaram do fim, avisando participantes e administradores.
 */
export async function processarCampanhas(db: any, agora = new Date()) {
  const abertas: Campanha[] = await db
    .select()
    .from(campanhas)
    .where(
      and(
        isNull(campanhas.excluidaEm),
        inArray(campanhas.status, ["planejada", "ativa", "pausada"])
      )
    );
  let alteradas = 0;
  for (const campanha of abertas) {
    if (campanha.dataFim.getTime() <= agora.getTime()) {
      const [alteracao] = await db
        .update(campanhas)
        .set({
          status: "encerrada",
          avisoEncerradaEm: agora,
          atualizadoEm: agora,
        })
        .where(
          and(
            eq(campanhas.id, campanha.id),
            eq(campanhas.status, campanha.status)
          )
        );
      if (!alteracao.affectedRows) continue;
      alteradas += 1;
      const indicadores =
        (
          await indicadoresCampanhas(
            db,
            campanha.condominioId,
            [campanha],
            agora
          )
        ).get(campanha.id) ?? vazio();
      const resumo = `${plural(indicadores.participantes, "participante", "participantes")}, ${indicadores.kgReciclados.toLocaleString("pt-BR")} kg reciclados em ${plural(indicadores.descartes, "descarte aprovado", "descartes aprovados")}.`;
      await notificarParticipantes(
        db,
        campanha,
        "campanha_encerrada",
        `Campanha encerrada: ${campanha.titulo}`,
        `A campanha "${campanha.titulo}" terminou. Resultado: ${resumo} Obrigado por participar!`
      );
      await notificarAdministradores(db, {
        condominioId: campanha.condominioId,
        tipo: "campanha_encerrada",
        titulo: `Campanha encerrada: ${campanha.titulo}`,
        mensagem: `A campanha terminou no prazo. ${resumo}`,
      });
      await writeAuditLog(db, {
        condominioId: campanha.condominioId,
        autorId: campanha.criadoPorId,
        tipoEntidade: "campanha",
        entidadeId: campanha.id,
        acao: "campanha_encerrada_prazo",
        resumo: `Campanha "${campanha.titulo}" encerrada automaticamente no fim do prazo. ${resumo}`,
        estadoAnterior: { status: campanha.status },
        estadoNovo: { status: "encerrada", ...indicadores },
      });
      continue;
    }
    if (
      campanha.status === "planejada" &&
      campanha.dataInicio.getTime() <= agora.getTime()
    ) {
      const [alteracao] = await db
        .update(campanhas)
        .set({ status: "ativa", atualizadoEm: agora })
        .where(
          and(eq(campanhas.id, campanha.id), eq(campanhas.status, "planejada"))
        );
      if (alteracao.affectedRows) {
        alteradas += 1;
        await anunciarCampanha(db, campanha);
      }
      continue;
    }
    if (
      campanha.status === "pausada" &&
      campanha.pausadaAte &&
      campanha.pausadaAte.getTime() <= agora.getTime()
    ) {
      const [alteracao] = await db
        .update(campanhas)
        .set({
          status: "ativa",
          pausadaEm: null,
          pausadaAte: null,
          motivoPausa: null,
          atualizadoEm: agora,
        })
        .where(
          and(eq(campanhas.id, campanha.id), eq(campanhas.status, "pausada"))
        );
      if (alteracao.affectedRows) {
        alteradas += 1;
        await notificarParticipantes(
          db,
          campanha,
          "campanha_pausada",
          `Campanha retomada: ${campanha.titulo}`,
          `A pausa terminou e a campanha "${campanha.titulo}" voltou a valer.`
        );
      }
      continue;
    }
    if (
      campanha.status === "ativa" &&
      !campanha.avisoEncerrandoEm &&
      campanha.dataFim.getTime() - agora.getTime() <=
        DIAS_AVISO_ENCERRAMENTO * DIA_MS
    ) {
      const [alteracao] = await db
        .update(campanhas)
        .set({ avisoEncerrandoEm: agora })
        .where(
          and(
            eq(campanhas.id, campanha.id),
            isNull(campanhas.avisoEncerrandoEm)
          )
        );
      if (!alteracao.affectedRows) continue;
      alteradas += 1;
      const dias = Math.max(
        1,
        Math.ceil((campanha.dataFim.getTime() - agora.getTime()) / DIA_MS)
      );
      await notificarParticipantes(
        db,
        campanha,
        "campanha_encerrando",
        `${palavra(dias, "Falta", "Faltam")} ${plural(dias, "dia", "dias")}: ${campanha.titulo}`,
        `A campanha "${campanha.titulo}" termina em ${plural(dias, "dia", "dias")}. Aproveite para registrar seus descartes.`
      );
      await notificarAdministradores(db, {
        condominioId: campanha.condominioId,
        tipo: "campanha_encerrando",
        titulo: `Campanha perto do fim: ${campanha.titulo}`,
        mensagem: `${palavra(dias, "Falta", "Faltam")} ${plural(dias, "dia", "dias")} para o fim da campanha.`,
      });
    }
  }
  return alteradas;
}

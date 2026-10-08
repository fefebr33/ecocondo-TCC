import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  ne,
  or,
} from "drizzle-orm";
import { z } from "zod";
import {
  adesivos,
  analisesIa,
  coletas,
  estacoesPesagem,
  logsAuditoria,
  ocorrencias,
  penalidades,
  statusColeta,
  pessoas,
  moradores,
  statusMorador,
  usuarios,
  tiposResiduo,
} from "../../drizzle/schema";
import type { Coleta } from "../../drizzle/schema";
import { getDb } from "../db";
import { residuoNaFrase } from "@shared/rotulos";

import { administratorOnly, withProfile } from "./nucleo";
import { router } from "../_core/trpc";
import { buildPendingResidentPerson } from "../dominio/regrasPessoas";
import { writeAuditLog } from "../audit";
import { MovimentacaoDuplicadaError, movimentarPontos } from "../pontos";
import { notificarAdministradores, notificarUsuario } from "../notificacoes";
import { regrasDoCondominio } from "../regrasResiduo";
import { aplicarPenalidade } from "../penalidades";
import {
  creditarComResto,
  estornarComResto,
  formatarPontos,
  milesimosDoDescarte,
  situacaoDescarte,
} from "@shared/descarte";
import { palavra, plural } from "@shared/plural";

const moradorInput = z.object({
  name: z.string().trim().min(3).max(180),
  email: z.string().trim().email().max(320).nullable().optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  block: z.string().trim().min(1).max(32),
  apartment: z.string().trim().min(1).max(32),
  status: z.enum(statusMorador).default("ativo"),
});

const filtrosColeta = z.object({
  wasteType: z.enum(tiposResiduo).optional(),
  block: z.string().trim().max(32).optional(),
  status: z.enum(statusColeta).optional(),
  situacao: z
    .enum(["pendente", "aprovado", "reprovado", "auditoria", "cancelado"])
    .optional(),
  /** Nome, apartamento, bloco ou número do descarte. */
  search: z.string().trim().max(120).optional(),
  residentId: z.number().int().positive().optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
});

/** Busca sem diferenciar maiúsculas nem acentos ("luisa" encontra "Luísa"). */
function normalizar(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Descreve de onde veio cada registro: estação de pesagem (o próprio morador), coletor (só coletas antigas,
 * de antes da retirada do perfil) ou administração.
 */
export async function origensDosRegistros(
  condominioId: number,
  registros: Array<typeof coletas.$inferSelect>
) {
  const db = await getDb();
  const estacoes = registros.some(registro => registro.estacaoId !== null)
    ? await db
        .select({ id: estacoesPesagem.id, nome: estacoesPesagem.nome })
        .from(estacoesPesagem)
        .where(eq(estacoesPesagem.condominioId, condominioId))
    : [];
  const idsColetores = Array.from(
    new Set(
      registros
        .map(registro => registro.coletorId)
        .filter((id): id is number => id !== null)
    )
  );
  const coletores = idsColetores.length
    ? await db
        .select({ id: usuarios.id, nome: usuarios.nome })
        .from(usuarios)
        .where(inArray(usuarios.id, idsColetores))
    : [];
  return (registro: typeof coletas.$inferSelect) => {
    if (registro.estacaoId !== null)
      return `Estação: ${estacoes.find(estacao => estacao.id === registro.estacaoId)?.nome ?? "removida"}`;
    if (registro.coletorId !== null)
      return `Coletor: ${coletores.find(coletor => coletor.id === registro.coletorId)?.nome ?? "sem nome"} (histórico)`;
    return "Administração";
  };
}

export const operationsRouter = router({
  moradores: router({
    listar: administratorOnly.query(async ({ ctx }) => {
      const db = await getDb();
      return db
        .select()
        .from(moradores)
        .where(eq(moradores.condominioId, ctx.eco.condominio.id))
        .orderBy(asc(moradores.nome));
    }),
    criar: administratorOnly
      .input(moradorInput)
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        const inserido = await db
          .insert(moradores)
          .values({
            condominioId: ctx.eco.condominio.id,
            nome: input.name,
            email: input.email || null,
            telefone: input.phone || null,
            bloco: input.block,
            apartamento: input.apartment,
            status: input.status,
          })
          .$returningId();
        await writeAuditLog(db, {
          condominioId: ctx.eco.condominio.id,
          autorId: ctx.user.id,
          tipoEntidade: "morador",
          entidadeId: inserido[0].id,
          acao: "morador_cadastrado",
          resumo: `Morador ${input.name} cadastrado (bloco ${input.block}, apto. ${input.apartment}).`,
          estadoNovo: {
            nome: input.name,
            bloco: input.block,
            apartamento: input.apartment,
            status: input.status,
          },
        });
        await notificarAdministradores(
          db,
          {
            condominioId: ctx.eco.condominio.id,
            tipo: "novo_cadastro",
            titulo: "Novo morador cadastrado",
            mensagem: `${input.name} (bloco ${input.block}, apto. ${input.apartment}) foi cadastrado.`,
          },
          ctx.user.id
        );
        return { id: inserido[0].id };
      }),
    atualizar: administratorOnly
      .input(moradorInput.partial().extend({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        const { id, ...atualizacao } = input;
        const existente = await db
          .select()
          .from(moradores)
          .where(
            and(
              eq(moradores.id, id),
              eq(moradores.condominioId, ctx.eco.condominio.id)
            )
          )
          .limit(1);
        if (!existente[0])
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Morador não encontrado.",
          });
        const proximoEmail =
          atualizacao.email === undefined
            ? existente[0].email
            : atualizacao.email || null;
        const proximoTelefone =
          atualizacao.phone === undefined
            ? existente[0].telefone
            : atualizacao.phone || null;
        await db
          .update(moradores)
          .set({
            nome: atualizacao.name ?? existente[0].nome,
            bloco: atualizacao.block ?? existente[0].bloco,
            apartamento: atualizacao.apartment ?? existente[0].apartamento,
            status: atualizacao.status ?? existente[0].status,
            email: proximoEmail,
            telefone: proximoTelefone,
            atualizadoEm: new Date(),
          })
          .where(eq(moradores.id, id));
        const antes = {
          nome: existente[0].nome,
          bloco: existente[0].bloco,
          apartamento: existente[0].apartamento,
          status: existente[0].status,
          email: existente[0].email,
          telefone: existente[0].telefone,
        };
        const depois = {
          nome: atualizacao.name ?? existente[0].nome,
          bloco: atualizacao.block ?? existente[0].bloco,
          apartamento: atualizacao.apartment ?? existente[0].apartamento,
          status: atualizacao.status ?? existente[0].status,
          email: proximoEmail,
          telefone: proximoTelefone,
        };
        const alterados = (
          Object.keys(antes) as Array<keyof typeof antes>
        ).filter(campo => antes[campo] !== depois[campo]);
        if (alterados.length) {
          await writeAuditLog(db, {
            condominioId: ctx.eco.condominio.id,
            autorId: ctx.user.id,
            tipoEntidade: "morador",
            entidadeId: id,
            acao: "morador_atualizado",
            resumo: `Cadastro de ${depois.nome} alterado (${alterados.join(", ")}).`,
            estadoAnterior: antes,
            estadoNovo: depois,
          });
          const rotulos: Record<string, string> = {
            nome: "nome",
            bloco: "bloco",
            apartamento: "apartamento",
            status: "situação",
            email: "e-mail",
            telefone: "telefone",
          };
          await notificarUsuario(db, existente[0].usuarioId, {
            condominioId: ctx.eco.condominio.id,
            tipo: "cadastro_alterado",
            titulo: "Seu cadastro foi alterado",
            mensagem: `A administração alterou ${alterados.map(campo => rotulos[campo]).join(", ")} do seu cadastro. Se algo estiver errado, fale com o síndico.`,
          });
        }
        const pessoa = await db
          .select()
          .from(pessoas)
          .where(eq(pessoas.moradorId, id))
          .limit(1);
        if (pessoa[0]) {
          await db
            .update(pessoas)
            .set({
              nome: atualizacao.name ?? existente[0].nome,
              email: proximoEmail || pessoa[0].email,
              telefone: proximoTelefone,
              bloco: atualizacao.block ?? existente[0].bloco,
              apartamento: atualizacao.apartment ?? existente[0].apartamento,
              atualizadoEm: new Date(),
            })
            .where(eq(pessoas.id, pessoa[0].id));
        } else if (proximoEmail) {
          await db
            .insert(pessoas)
            .values({
              condominioId: ctx.eco.condominio.id,
              ...buildPendingResidentPerson({
                id,
                usuarioId: existente[0].usuarioId,
                nome: atualizacao.name ?? existente[0].nome,
                email: proximoEmail,
                telefone: proximoTelefone,
                bloco: atualizacao.block ?? existente[0].bloco,
                apartamento: atualizacao.apartment ?? existente[0].apartamento,
              }),
            });
        }
        return { success: true };
      }),
  }),
  coletas: router({
    /**
     * Descartes com filtros (tipo, bloco, situação, período, nome ou apartamento do morador). O morador só vê os dele;
     * o administrador vê todos e pode filtrar por um morador.
     */
    listar: withProfile
      .input(filtrosColeta.optional())
      .query(async ({ ctx, input }) => {
        const db = await getDb();
        const condicoes = [eq(coletas.condominioId, ctx.eco.condominio.id)];
        if (ctx.eco.perfil.papel === "morador") {
          if (!ctx.eco.morador) return [];
          condicoes.push(eq(coletas.moradorId, ctx.eco.morador.id));
        } else if (input?.residentId) {
          condicoes.push(eq(coletas.moradorId, input.residentId));
        }
        if (input?.wasteType)
          condicoes.push(eq(coletas.tipoResiduo, input.wasteType));
        if (input?.block) condicoes.push(eq(coletas.bloco, input.block));
        if (input?.status) condicoes.push(eq(coletas.status, input.status));
        if (input?.startDate)
          condicoes.push(gte(coletas.agendadaPara, input.startDate));
        if (input?.endDate)
          condicoes.push(lte(coletas.agendadaPara, input.endDate));

        const registros = await db
          .select()
          .from(coletas)
          .where(and(...condicoes))
          .orderBy(desc(coletas.agendadaPara), desc(coletas.id));
        const comunidade = await db
          .select({
            id: moradores.id,
            nome: moradores.nome,
            apartamento: moradores.apartamento,
          })
          .from(moradores)
          .where(eq(moradores.condominioId, ctx.eco.condominio.id));
        const porId = new Map(comunidade.map(morador => [morador.id, morador]));
        const origens = await origensDosRegistros(
          ctx.eco.condominio.id,
          registros
        );
        const regras = await regrasDoCondominio(ctx.eco.condominio.id);
        const busca = input?.search ? normalizar(input.search) : "";
        return registros
          .map(registro => {
            const morador = registro.moradorId
              ? porId.get(registro.moradorId)
              : undefined;
            const situacao = situacaoDescarte(registro);
            return {
              ...registro,
              residentName: morador?.nome ?? null,
              apartment: morador?.apartamento ?? null,
              origin: origens(registro),
              situacao,
              pontosPrevistos:
                situacao === "pendente" || situacao === "auditoria"
                  ? milesimosPrevistos(registro, regras) / 1000
                  : registro.pontosConcedidos,
            };
          })
          .filter(
            registro =>
              (!input?.situacao || registro.situacao === input.situacao) &&
              (!busca ||
                normalizar(
                  `${registro.residentName ?? ""} ${registro.apartment ?? ""} ${registro.bloco} ${registro.id}`
                ).includes(busca))
          );
      }),
    /** Um descarte e os outros tipos registrados com ele (mesmo lote); o morador só abre os dele. Usado ao tocar numa notificação. */
    detalhe: withProfile
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const db = await getDb();
        const coleta = await coletaDoCondominio(
          ctx.eco.condominio.id,
          input.id
        );
        if (
          ctx.eco.perfil.papel === "morador" &&
          coleta.moradorId !== ctx.eco.morador?.id
        )
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Descarte não encontrado.",
          });
        const mesmoLote = coleta.lote
          ? await db
              .select()
              .from(coletas)
              .where(
                and(
                  eq(coletas.condominioId, ctx.eco.condominio.id),
                  eq(coletas.lote, coleta.lote)
                )
              )
              .orderBy(asc(coletas.id))
          : [coleta];
        const [morador] = coleta.moradorId
          ? await db
              .select({
                nome: moradores.nome,
                bloco: moradores.bloco,
                apartamento: moradores.apartamento,
              })
              .from(moradores)
              .where(eq(moradores.id, coleta.moradorId))
              .limit(1)
          : [];
        const origens = await origensDosRegistros(
          ctx.eco.condominio.id,
          mesmoLote
        );
        const regras = await regrasDoCondominio(ctx.eco.condominio.id);
        const ids = mesmoLote.map(registro => registro.id);
        const administrador = ctx.eco.perfil.papel === "administrador";
        // Tudo o que está ligado ao descarte: adesivo, estação, análise da IA, histórico de alterações, ocorrências e medidas.
        const adesivosLote = await db
          .select({ id: adesivos.id, codigo: adesivos.codigo })
          .from(adesivos)
          .where(inArray(adesivos.coletaId, ids));
        const analises = await db
          .select()
          .from(analisesIa)
          .where(inArray(analisesIa.coletaId, ids))
          .orderBy(desc(analisesIa.id));
        const [estacao] = coleta.estacaoId
          ? await db
              .select({
                nome: estacoesPesagem.nome,
                local: estacoesPesagem.local,
              })
              .from(estacoesPesagem)
              .where(eq(estacoesPesagem.id, coleta.estacaoId))
              .limit(1)
          : [];
        const historico = await db
          .select({
            id: logsAuditoria.id,
            entidadeId: logsAuditoria.entidadeId,
            acao: logsAuditoria.acao,
            resumo: logsAuditoria.resumo,
            motivo: logsAuditoria.motivo,
            criadoEm: logsAuditoria.criadoEm,
            autor: usuarios.nome,
            autorId: logsAuditoria.autorId,
          })
          .from(logsAuditoria)
          .leftJoin(usuarios, eq(usuarios.id, logsAuditoria.autorId))
          .where(
            and(
              eq(logsAuditoria.condominioId, ctx.eco.condominio.id),
              eq(logsAuditoria.tipoEntidade, "coleta"),
              inArray(logsAuditoria.entidadeId, ids)
            )
          )
          .orderBy(asc(logsAuditoria.criadoEm), asc(logsAuditoria.id));
        const relacionadas = administrador
          ? await db
              .select({
                id: ocorrencias.id,
                coletaId: ocorrencias.coletaId,
                status: ocorrencias.status,
                categoria: ocorrencias.categoria,
                conclusao: ocorrencias.conclusao,
                descricao: ocorrencias.descricao,
                criadoEm: ocorrencias.criadoEm,
              })
              .from(ocorrencias)
              .where(
                and(
                  eq(ocorrencias.condominioId, ctx.eco.condominio.id),
                  inArray(ocorrencias.coletaId, ids)
                )
              )
          : [];
        const medidas = await db
          .select({
            id: penalidades.id,
            coletaId: penalidades.coletaId,
            nome: penalidades.nome,
            tipo: penalidades.tipo,
            status: penalidades.status,
            inicioEm: penalidades.inicioEm,
            fimEm: penalidades.fimEm,
            motivo: penalidades.motivo,
          })
          .from(penalidades)
          .where(inArray(penalidades.coletaId, ids));
        const aprovadores = await db
          .select({ id: usuarios.id, nome: usuarios.nome })
          .from(usuarios)
          .where(
            inArray(
              usuarios.id,
              mesmoLote.map(registro => registro.aprovacaoPesoPorId ?? 0)
            )
          );
        return {
          id: coleta.id,
          lote: coleta.lote,
          morador: morador ?? null,
          estacao: estacao ?? null,
          itens: mesmoLote.map(registro => {
            const situacao = situacaoDescarte(registro);
            const analise = analises.find(
              item => item.coletaId === registro.id
            );
            return {
              ...registro,
              situacao,
              origin: origens(registro),
              pontosPrevistos:
                situacao === "pendente" || situacao === "auditoria"
                  ? milesimosPrevistos(registro, regras) / 1000
                  : registro.pontosConcedidos,
              adesivo:
                adesivosLote.find(item => item.id === registro.adesivoId)
                  ?.codigo ?? null,
              decididoPor: registro.aprovacaoPesoPorId
                ? (aprovadores.find(
                    item => item.id === registro.aprovacaoPesoPorId
                  )?.nome ?? null)
                : null,
              analiseIa: analise
                ? {
                    ...analise,
                    motivos: JSON.parse(analise.motivos) as string[],
                  }
                : null,
              historico: historico
                .filter(item => item.entidadeId === registro.id)
                .map(item => ({
                  ...item,
                  autor:
                    administrador || item.autorId === ctx.user.id
                      ? (item.autor ?? "Sistema")
                      : item.autor?.startsWith("EcoCondo IA")
                        ? item.autor
                        : "Administração",
                  autorId: undefined,
                })),
              ocorrencias: relacionadas.filter(
                item => item.coletaId === registro.id
              ),
              medidas: medidas.filter(item => item.coletaId === registro.id),
            };
          }),
        };
      }),
    /** Descartes aguardando a aprovação do administrador e os que estão em auditoria. */
    listarPendentesAprovacao: administratorOnly.query(async ({ ctx }) => {
      const db = await getDb();
      const registros = await db
        .select()
        .from(coletas)
        .where(
          and(
            eq(coletas.condominioId, ctx.eco.condominio.id),
            eq(coletas.pendenteAprovacaoPeso, true)
          )
        )
        .orderBy(desc(coletas.concluidaEm), asc(coletas.id));
      const regras = await regrasDoCondominio(ctx.eco.condominio.id);
      const moradorIds = Array.from(
        new Set(
          registros
            .map(registro => registro.moradorId)
            .filter((id): id is number => id !== null)
        )
      );
      const moradoresRelacionados = moradorIds.length
        ? await db
            .select()
            .from(moradores)
            .where(eq(moradores.condominioId, ctx.eco.condominio.id))
        : [];
      const origens = await origensDosRegistros(
        ctx.eco.condominio.id,
        registros
      );
      return registros.map(registro => ({
        ...registro,
        pontosCalculados: milesimosPrevistos(registro, regras) / 1000,
        situacao: situacaoDescarte(registro),
        residentName:
          moradoresRelacionados.find(
            morador => morador.id === registro.moradorId
          )?.nome ?? null,
        apartment:
          moradoresRelacionados.find(
            morador => morador.id === registro.moradorId
          )?.apartamento ?? null,
        origin: origens(registro),
      }));
    }),
    /** Decide um descarte pendente: aprovar libera os pontos; reprovar exige motivo (vai para o morador) e cancela os pontos previstos. */
    decidirAprovacaoPeso: administratorOnly
      .input(
        z.object({
          id: z.number().int().positive(),
          aprovar: z.boolean(),
          observacao: z.string().trim().max(500).nullable().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const coleta = await coletaDoCondominio(
          ctx.eco.condominio.id,
          input.id
        );
        if (
          !coleta.pendenteAprovacaoPeso ||
          coleta.aprovacaoPesoStatus === "auditoria"
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              coleta.aprovacaoPesoStatus === "auditoria"
                ? "Este descarte está em auditoria. Conclua a auditoria para decidir."
                : "Este descarte não está pendente de aprovação.",
          });
        if ((coleta.concluidoPorId ?? coleta.coletorId) === ctx.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Quem registrou o descarte não pode aprovar o próprio lançamento. Peça para outro administrador revisar.",
          });
        }
        if (!input.aprovar) {
          if (!input.observacao || input.observacao.length < 5)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Informe o motivo da reprovação (pelo menos 5 letras); ele é enviado ao morador.",
            });
          return reprovarColeta(ctx, coleta, input.observacao);
        }
        return aprovarColeta(ctx, coleta, input.observacao || null);
      }),
    /** Aprova de uma vez vários descartes pendentes (ex.: os tipos de um mesmo lote, depois de conferir as fotos). */
    aprovarVarios: administratorOnly
      .input(
        z.object({ ids: z.array(z.number().int().positive()).min(1).max(100) })
      )
      .mutation(async ({ ctx, input }) => {
        let aprovados = 0;
        let pontos = 0;
        const recusados: Array<{ id: number; motivo: string }> = [];
        for (const id of Array.from(new Set(input.ids))) {
          try {
            const coleta = await coletaDoCondominio(ctx.eco.condominio.id, id);
            if (
              !coleta.pendenteAprovacaoPeso ||
              coleta.aprovacaoPesoStatus === "auditoria"
            )
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "não está pendente",
              });
            if ((coleta.concluidoPorId ?? coleta.coletorId) === ctx.user.id)
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "registrado por você",
              });
            const resultado = await aprovarColeta(ctx, coleta, null);
            aprovados += 1;
            pontos += resultado.pointsAwarded;
          } catch (error) {
            recusados.push({
              id,
              motivo: error instanceof Error ? error.message : "erro",
            });
          }
        }
        return { aprovados, pontos, recusados };
      }),
    /**
     * Abre uma auditoria num descarte (caso grave: suspeita de furto, peso forjado, tentativa de burlar a estação).
     * O peso sai dos indicadores enquanto durar, e o morador é avisado de que o descarte está sob auditoria.
     */
    abrirAuditoria: administratorOnly
      .input(
        z.object({
          id: z.number().int().positive(),
          motivo: z
            .string()
            .trim()
            .min(10, "Descreva o motivo da auditoria (pelo menos 10 letras).")
            .max(800),
        })
      )
      .mutation(async ({ ctx, input }) =>
        abrirAuditoriaColeta(
          ctx,
          await coletaDoCondominio(ctx.eco.condominio.id, input.id),
          input.motivo
        )
      ),
    /**
     * Reverte uma aprovação (feita pela IA ou por um administrador) quando um problema aparece depois: os pontos do descarte saem
     * do saldo e ele volta para nova avaliação ("nova_avaliacao") ou vai direto para auditoria ("auditoria", pontos mantidos
     * até a conclusão, como em qualquer auditoria).
     */
    reverterAprovacao: administratorOnly
      .input(
        z.object({
          id: z.number().int().positive(),
          motivo: z
            .string()
            .trim()
            .min(10, "Explique o motivo da reversão (pelo menos 10 letras).")
            .max(800),
          destino: z.enum(["nova_avaliacao", "auditoria"]),
          ocorrenciaId: z.number().int().positive().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const coleta = await coletaDoCondominio(
          ctx.eco.condominio.id,
          input.id
        );
        if (situacaoDescarte(coleta) !== "aprovado")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Só descartes aprovados podem ter a aprovação revertida.",
          });
        const motivo = input.ocorrenciaId
          ? `${input.motivo} (ocorrência nº ${input.ocorrenciaId})`
          : input.motivo;
        if (input.destino === "auditoria")
          return abrirAuditoriaColeta(ctx, coleta, motivo);
        return reverterParaNovaAvaliacao(ctx, coleta, motivo);
      }),
    /**
     * Conclui a auditoria. "regular": foi um mal-entendido, o descarte é aprovado e os pontos entram (se ainda não entraram).
     * "irregular": o descarte é reprovado (pontos estornados) e o administrador escolhe as medidas pré-definidas a aplicar
     * (retirada de pontos, suspensões, advertência); cada medida fica no histórico do morador com período e responsável.
     */
    concluirAuditoria: administratorOnly
      .input(
        z.object({
          id: z.number().int().positive(),
          resultado: z.enum(["regular", "irregular"]),
          parecer: z
            .string()
            .trim()
            .min(10, "Escreva o parecer da auditoria (pelo menos 10 letras).")
            .max(800),
          /** Retirada de pontos avulsa (além das medidas pré-definidas). */
          penalidadePontos: z.number().int().min(0).max(1000).default(0),
          /** Medidas pré-definidas escolhidas na hora (Configurações > Medidas administrativas). */
          medidas: z.array(z.number().int().positive()).max(5).default([]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        const coleta = await coletaDoCondominio(
          ctx.eco.condominio.id,
          input.id
        );
        if (coleta.aprovacaoPesoStatus !== "auditoria")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Este descarte não está em auditoria.",
          });
        if (
          input.resultado === "regular" &&
          (input.penalidadePontos > 0 || input.medidas.length)
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Punição só vale quando a irregularidade é confirmada.",
          });
        const base = { condominioId: coleta.condominioId, coletaId: coleta.id };
        const usuarioMorador = await usuarioDoMorador(coleta.moradorId);
        if (input.resultado === "regular") {
          const resultado = await aprovarColeta(
            ctx,
            coleta,
            `Auditoria concluída sem irregularidade: ${input.parecer}`,
            true
          );
          await notificarUsuario(db, usuarioMorador, {
            ...base,
            tipo: "auditoria_concluida",
            titulo: "Auditoria concluída: tudo certo",
            mensagem: `A auditoria do descarte nº ${coleta.id} terminou sem irregularidade. ${input.parecer}`,
          });
          await notificarAdministradores(db, {
            ...base,
            tipo: "auditoria_concluida",
            titulo: `Auditoria concluída: nº ${coleta.id} regular`,
            mensagem: `A auditoria do descarte nº ${coleta.id} (bloco ${coleta.bloco}) terminou sem irregularidade e o descarte foi aprovado. Parecer: ${input.parecer}`,
          });
          return { ...resultado, penalty: 0, medidasAplicadas: [] as string[] };
        }
        const resultado = await reprovarColeta(
          ctx,
          coleta,
          `Irregularidade confirmada na auditoria: ${input.parecer}`
        );
        let penalidade = 0;
        const aplicadas: string[] = [];
        if (coleta.moradorId) {
          const motivo = `Irregularidade confirmada na auditoria do descarte nº ${coleta.id}: ${input.parecer}`;
          if (input.penalidadePontos > 0) {
            await aplicarPenalidade(db, {
              condominioId: coleta.condominioId,
              autorId: ctx.user.id,
              moradorId: coleta.moradorId,
              coletaId: coleta.id,
              motivo,
              personalizada: {
                tipo: "perda_pontos",
                nome: `Retirada de ${plural(input.penalidadePontos, "ponto", "pontos")}`,
                pontos: input.penalidadePontos,
              },
            });
            penalidade += input.penalidadePontos;
            aplicadas.push(
              `-${plural(input.penalidadePontos, "ponto", "pontos")}`
            );
          }
          for (const modeloId of Array.from(new Set(input.medidas))) {
            const aplicada = await aplicarPenalidade(db, {
              condominioId: coleta.condominioId,
              autorId: ctx.user.id,
              moradorId: coleta.moradorId,
              coletaId: coleta.id,
              motivo,
              modeloId,
            });
            aplicadas.push(aplicada.nome);
          }
        }
        await notificarAdministradores(db, {
          ...base,
          tipo: "auditoria_concluida",
          titulo: `Auditoria concluída: nº ${coleta.id} irregular`,
          mensagem: `A auditoria do descarte nº ${coleta.id} (bloco ${coleta.bloco}) confirmou a irregularidade: descarte reprovado${aplicadas.length ? `; medidas aplicadas: ${aplicadas.join("; ")}` : "; nenhuma medida aplicada"}. Parecer: ${input.parecer}`,
        });
        await notificarUsuario(db, usuarioMorador, {
          ...base,
          tipo: "auditoria_concluida",
          titulo: "Auditoria concluída: irregularidade confirmada",
          mensagem: `A auditoria do descarte nº ${coleta.id} confirmou a irregularidade e o descarte foi reprovado. ${input.parecer}${aplicadas.length ? ` Medidas aplicadas: ${aplicadas.join("; ")}.` : ""}`,
        });
        return {
          ...resultado,
          penalty: penalidade,
          medidasAplicadas: aplicadas,
        };
      }),
    /**
     * Reprova um descarte concluído (pendente, aprovado ou em auditoria), com motivo obrigatório. Pontos previstos são cancelados;
     * pontos já lançados são estornados do saldo (que pode ficar negativo se o morador já os gastou).
     */
    reprovar: administratorOnly
      .input(
        z.object({
          id: z.number().int().positive(),
          motivo: z
            .string()
            .trim()
            .min(5, "Informe o motivo da reprovação (pelo menos 5 letras).")
            .max(500),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const coleta = await coletaDoCondominio(
          ctx.eco.condominio.id,
          input.id
        );
        if (
          coleta.pendenteAprovacaoPeso &&
          (coleta.concluidoPorId ?? coleta.coletorId) === ctx.user.id
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Quem registrou o descarte não pode decidir a revisão dele. Peça para outro administrador revisar.",
          });
        }
        return reprovarColeta(ctx, coleta, input.motivo);
      }),
  }),
});

export type ContextoAdministrador = {
  user: { id: number };
  eco: { condominio: { id: number } };
};

export async function coletaDoCondominio(condominioId: number, id: number) {
  const db = await getDb();
  const encontrada = await db
    .select()
    .from(coletas)
    .where(and(eq(coletas.id, id), eq(coletas.condominioId, condominioId)))
    .limit(1);
  if (!encontrada[0])
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Descarte não encontrado.",
    });
  return encontrada[0];
}

export async function usuarioDoMorador(moradorId: number | null) {
  if (!moradorId) return null;
  const db = await getDb();
  const encontrado = await db
    .select({ usuarioId: moradores.usuarioId })
    .from(moradores)
    .where(eq(moradores.id, moradorId))
    .limit(1);
  return encontrado[0]?.usuarioId ?? null;
}

function formatarKg(pesoGramas: number | null) {
  return ((pesoGramas ?? 0) / 1000).toLocaleString("pt-BR", {
    maximumFractionDigits: 2,
  });
}

/** O índice único do extrato recusou pontuar a mesma coleta duas vezes: vira um erro legível na tela. */
function converterDuplicidade(error: unknown): never {
  if (error instanceof MovimentacaoDuplicadaError)
    throw new TRPCError({
      code: "CONFLICT",
      message: "Os pontos deste descarte já foram lançados.",
    });
  throw error;
}

type RegrasPorTipo = Awaited<ReturnType<typeof regrasDoCondominio>>;

/** Valor do descarte em milésimos de ponto: o que o tablet prometeu (gravado no registro) ou, nos registros antigos, pela regra atual. */
function milesimosPrevistos(
  registro: Pick<
    Coleta,
    "pontosPrevistosMilesimos" | "pesoGramas" | "tipoResiduo"
  >,
  regras: RegrasPorTipo
) {
  return (
    registro.pontosPrevistosMilesimos ??
    milesimosDoDescarte(
      registro.pesoGramas,
      regras[registro.tipoResiduo].pontosPorKg,
      registro.tipoResiduo
    )
  );
}

/** O descarte já entrou no saldo (e na fração guardada do morador)? Vale para os aprovados e para os que foram à auditoria depois de aprovados. */
function jaContabilizado(coleta: Coleta) {
  return (
    coleta.pontosConcedidos > 0 ||
    (coleta.aprovacaoPesoEm !== null &&
      coleta.aprovacaoPesoStatus !== "pendente")
  );
}

/**
 * Aprova um descarte pendente (ou em auditoria, ao concluí-la sem irregularidade) e credita o valor prometido no tablet.
 * A fração de ponto não se perde: soma com a que sobrou dos descartes anteriores do morador e vira ponto inteiro quando passa de 1.
 */
export async function aprovarColeta(
  ctx: ContextoAdministrador,
  coleta: Coleta,
  observacao: string | null,
  daAuditoria = false,
  opcoes: { automatico?: boolean; notificar?: boolean } = {}
) {
  const db = await getDb();
  const regras = await regrasDoCondominio(coleta.condominioId);
  // Numa auditoria sobre um descarte já aprovado, os pontos já estavam no saldo: não credita de novo.
  const jaCreditados = jaContabilizado(coleta);
  const exato = milesimosPrevistos(coleta, regras);
  let pontos = jaCreditados ? coleta.pontosConcedidos : 0;
  const agora = new Date();
  await db
    .transaction(async tx => {
      let novoResto: number | null = null;
      if (!jaCreditados && coleta.moradorId) {
        // Trava a linha do morador: duas aprovações ao mesmo tempo não podem usar a mesma fração guardada.
        const [morador] = await tx
          .select({ resto: moradores.restoPontosMilesimos })
          .from(moradores)
          .where(eq(moradores.id, coleta.moradorId))
          .for("update");
        const credito = creditarComResto(morador?.resto ?? 0, exato);
        pontos = credito.pontos;
        novoResto = credito.resto;
      }
      const [alteracao] = await tx
        .update(coletas)
        .set({
          pendenteAprovacaoPeso: false,
          aprovacaoPesoStatus: "aprovado",
          aprovacaoPesoPorId: ctx.user.id,
          aprovacaoPesoEm: agora,
          motivoDecisao: observacao,
          pontosConcedidos: pontos,
          pontosPrevistosMilesimos: exato,
          atualizadoEm: agora,
        })
        .where(
          and(
            eq(coletas.id, coleta.id),
            eq(coletas.pendenteAprovacaoPeso, true),
            eq(
              coletas.aprovacaoPesoStatus,
              daAuditoria ? "auditoria" : "pendente"
            )
          )
        );
      if (!alteracao.affectedRows)
        throw new TRPCError({
          code: "CONFLICT",
          message: "Outro administrador já decidiu este descarte.",
        });
      if (coleta.moradorId && novoResto !== null)
        await tx
          .update(moradores)
          .set({ restoPontosMilesimos: novoResto })
          .where(eq(moradores.id, coleta.moradorId));
      if (coleta.moradorId && pontos > 0 && !jaCreditados) {
        await movimentarPontos(tx, {
          condominioId: coleta.condominioId,
          moradorId: coleta.moradorId,
          tipo: "credito_coleta",
          pontos,
          coletaId: coleta.id,
          revisaoColeta: coleta.revisao,
          autorId: ctx.user.id,
          descricao: `Descarte nº ${coleta.id} ${opcoes.automatico ? "aprovado pela IA" : "aprovado"} (${formatarKg(coleta.pesoGramas)} kg de ${residuoNaFrase[coleta.tipoResiduo]}, vale ${formatarPontos(exato / 1000)} ${palavra(exato / 1000, "ponto", "pontos")})`,
        });
      }
    })
    .catch(converterDuplicidade);

  const valor = formatarPontos(exato / 1000);
  const efeitoPontos = jaCreditados
    ? "pontos já creditados antes"
    : !exato
      ? "sem pontos (regra do tipo)"
      : pontos
        ? `vale ${valor} ${palavra(exato / 1000, "ponto", "pontos")}; ${plural(pontos, "ponto inteiro entrou", "pontos inteiros entraram")} no saldo`
        : `vale ${valor} ${palavra(exato / 1000, "ponto, guardado", "pontos, guardados")} como fração até completar 1 ponto`;
  await writeAuditLog(db, {
    condominioId: coleta.condominioId,
    autorId: ctx.user.id,
    tipoEntidade: "coleta",
    entidadeId: coleta.id,
    acao: daAuditoria
      ? "auditoria_concluida_regular"
      : opcoes.automatico
        ? "descarte_aprovado_ia"
        : "descarte_aprovado",
    resumo: daAuditoria
      ? `Auditoria do descarte nº ${coleta.id} concluída sem irregularidade; descarte aprovado${jaCreditados ? " (pontos mantidos)" : `; ${efeitoPontos}`}.`
      : opcoes.automatico
        ? `Descarte nº ${coleta.id} aprovado automaticamente pela análise da IA (tipo, peso e cor do saco conferem); ${efeitoPontos}.`
        : `Descarte nº ${coleta.id} conferido (foto e peso) e aprovado; ${efeitoPontos}.`,
    estadoAnterior: {
      situacao: daAuditoria ? "auditoria" : "pendente",
      pontosConcedidos: coleta.pontosConcedidos,
    },
    estadoNovo: {
      situacao: "aprovado",
      pontosConcedidos: pontos,
      valorMilesimos: exato,
      efeitoPontos,
    },
    motivo: observacao,
  });

  const usuarioMorador = await usuarioDoMorador(coleta.moradorId);
  const base = { condominioId: coleta.condominioId, coletaId: coleta.id };
  // Uma notificação só (antes eram duas: "aprovado" e "+N pontos").
  if (!daAuditoria && opcoes.notificar !== false) {
    const sobrePontos = !exato
      ? ""
      : pontos
        ? ` Ele vale ${valor} ${palavra(exato / 1000, "ponto", "pontos")}: +${pontos} no seu saldo.`
        : ` Ele vale ${valor} ${palavra(exato / 1000, "ponto, que fica guardado e se soma", "pontos, que ficam guardados e se somam")} e se somam aos próximos descartes até completar 1 ponto.`;
    await notificarUsuario(db, usuarioMorador, {
      ...base,
      tipo: pontos > 0 ? "pontos_ganhos" : "revisao_administrativa",
      titulo:
        pontos > 0
          ? `Descarte aprovado: +${plural(pontos, "ponto", "pontos")}`
          : "Descarte aprovado",
      mensagem: `A administração conferiu a foto e o peso e aprovou o descarte nº ${coleta.id} (${formatarKg(coleta.pesoGramas)} kg de ${residuoNaFrase[coleta.tipoResiduo]}).${sobrePontos}${observacao ? ` Observação: ${observacao}` : ""}`,
    });
  }
  return { success: true, pointsAwarded: jaCreditados ? 0 : pontos };
}

export async function reprovarColeta(
  ctx: ContextoAdministrador,
  coleta: Coleta,
  motivo: string
) {
  if (coleta.status !== "concluida")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Só descartes concluídos podem ser reprovados.",
    });
  if (coleta.aprovacaoPesoStatus === "rejeitado")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Este descarte já foi reprovado.",
    });
  const db = await getDb();
  const agora = new Date();
  const contabilizado = jaContabilizado(coleta);
  const regras = await regrasDoCondominio(coleta.condominioId);
  const exato = contabilizado
    ? (coleta.pontosPrevistosMilesimos ?? coleta.pontosConcedidos * 1000)
    : milesimosPrevistos(coleta, regras);
  const pontosPendentes = contabilizado ? 0 : exato / 1000;
  let pontosEstornados = 0;
  await db
    .transaction(async tx => {
      let novoResto: number | null = null;
      if (contabilizado && coleta.moradorId) {
        // Desfaz exatamente o valor do descarte: os pontos inteiros que ele gerou e o que dele ficou na fração guardada.
        const [morador] = await tx
          .select({ resto: moradores.restoPontosMilesimos })
          .from(moradores)
          .where(eq(moradores.id, coleta.moradorId))
          .for("update");
        const estorno = estornarComResto(
          morador?.resto ?? 0,
          exato,
          coleta.pontosConcedidos
        );
        pontosEstornados = estorno.pontos;
        novoResto = estorno.resto;
      }
      const [alteracao] = await tx
        .update(coletas)
        .set({
          pendenteAprovacaoPeso: false,
          aprovacaoPesoStatus: "rejeitado",
          aprovacaoPesoPorId: ctx.user.id,
          aprovacaoPesoEm: agora,
          motivoDecisao: motivo,
          pontosConcedidos: 0,
          atualizadoEm: agora,
        })
        .where(
          and(
            eq(coletas.id, coleta.id),
            eq(coletas.status, "concluida"),
            or(
              isNull(coletas.aprovacaoPesoStatus),
              ne(coletas.aprovacaoPesoStatus, "rejeitado")
            )
          )
        );
      if (!alteracao.affectedRows)
        throw new TRPCError({
          code: "CONFLICT",
          message: "Este descarte já foi reprovado por outro administrador.",
        });
      if (coleta.moradorId && novoResto !== null)
        await tx
          .update(moradores)
          .set({ restoPontosMilesimos: novoResto })
          .where(eq(moradores.id, coleta.moradorId));
      if (coleta.moradorId && pontosEstornados > 0) {
        await movimentarPontos(tx, {
          condominioId: coleta.condominioId,
          moradorId: coleta.moradorId,
          tipo: "estorno_coleta",
          pontos: -pontosEstornados,
          coletaId: coleta.id,
          revisaoColeta: coleta.revisao,
          autorId: ctx.user.id,
          descricao: `Estorno: descarte nº ${coleta.id} reprovado (${motivo})`,
        });
      }
    })
    .catch((error: unknown) => {
      if (error instanceof MovimentacaoDuplicadaError)
        throw new TRPCError({
          code: "CONFLICT",
          message: "Os pontos deste descarte já foram estornados.",
        });
      throw error;
    });

  const efeito =
    pontosEstornados > 0
      ? plural(pontosEstornados, "ponto estornado", "pontos estornados")
      : contabilizado && exato > 0
        ? `${formatarPontos(exato / 1000)} ${palavra(exato / 1000, "ponto de fração retirado", "pontos de fração retirados")}`
        : pontosPendentes > 0
          ? `${formatarPontos(pontosPendentes)} ${palavra(pontosPendentes, "ponto pendente cancelado", "pontos pendentes cancelados")}`
          : "nenhum ponto envolvido";
  await writeAuditLog(db, {
    condominioId: coleta.condominioId,
    autorId: ctx.user.id,
    tipoEntidade: "coleta",
    entidadeId: coleta.id,
    acao: "coleta_reprovada",
    resumo: `Descarte nº ${coleta.id} reprovado pela administração; ${efeito}.`,
    estadoAnterior: {
      status: coleta.status,
      pesoGramas: coleta.pesoGramas,
      aprovacaoPesoStatus: coleta.aprovacaoPesoStatus,
      pendenteAprovacaoPeso: !contabilizado,
      pontosConcedidos: coleta.pontosConcedidos,
    },
    estadoNovo: {
      status: coleta.status,
      aprovacaoPesoStatus: "rejeitado",
      pontosConcedidos: 0,
      pontosEstornados,
      pontosPendentesCancelados: pontosPendentes,
      efeitoPontos: efeito,
      reprovadaEm: agora,
    },
    motivo,
  });

  const usuarioMorador = await usuarioDoMorador(coleta.moradorId);
  const base = { condominioId: coleta.condominioId, coletaId: coleta.id };
  // Uma notificação só, com o motivo e o efeito nos pontos (antes eram duas).
  const efeitoParaMorador =
    pontosEstornados > 0
      ? ` ${plural(pontosEstornados, "ponto foi retirado", "pontos foram retirados")} do seu saldo.`
      : contabilizado && exato > 0
        ? ` O valor dele (${formatarPontos(exato / 1000)} ${palavra(exato / 1000, "ponto", "pontos")}) saiu da fração guardada.`
        : pontosPendentes > 0
          ? ` ${formatarPontos(pontosPendentes)} ${palavra(pontosPendentes, "ponto previsto não será creditado", "pontos previstos não serão creditados")}.`
          : "";
  await notificarUsuario(db, usuarioMorador, {
    ...base,
    tipo: "coleta_reprovada",
    titulo:
      pontosEstornados > 0
        ? `Descarte reprovado: -${plural(pontosEstornados, "ponto", "pontos")}`
        : "Descarte reprovado",
    mensagem: `A administração reprovou o descarte nº ${coleta.id} (${formatarKg(coleta.pesoGramas)} kg de ${residuoNaFrase[coleta.tipoResiduo]}). Motivo: ${motivo.replace(/[.!\s]+$/, "")}.${efeitoParaMorador}`,
  });
  await notificarAdministradores(
    db,
    {
      ...base,
      tipo: "coleta_reprovada",
      titulo: "Descarte reprovado",
      mensagem: `O descarte nº ${coleta.id} (bloco ${coleta.bloco}) foi reprovado: ${motivo}. Efeito: ${efeito}.`,
    },
    ctx.user.id
  );
  return {
    success: true,
    pointsAwarded: 0,
    pointsReversed: pontosEstornados,
    pendingPointsCancelled: pontosPendentes,
  };
}

/**
 * Abre uma auditoria num descarte (caso grave: suspeita de furto, peso forjado, tentativa de burlar a estação).
 * O peso sai dos indicadores enquanto durar, e o morador é avisado de que o descarte está sob auditoria.
 */
export async function abrirAuditoriaColeta(
  ctx: ContextoAdministrador,
  coleta: Coleta,
  motivo: string
) {
  const db = await getDb();
  if (coleta.status !== "concluida")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Só descartes concluídos podem ir para auditoria.",
    });
  if (coleta.aprovacaoPesoStatus === "auditoria")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Este descarte já está em auditoria.",
    });
  if (coleta.aprovacaoPesoStatus === "rejeitado")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Este descarte já foi reprovado.",
    });
  const agora = new Date();
  const [alteracao] = await db
    .update(coletas)
    .set({
      pendenteAprovacaoPeso: true,
      aprovacaoPesoStatus: "auditoria",
      motivoAuditoria: motivo,
      auditoriaAbertaEm: agora,
      atualizadoEm: agora,
    })
    .where(
      and(
        eq(coletas.id, coleta.id),
        eq(coletas.status, "concluida"),
        or(
          isNull(coletas.aprovacaoPesoStatus),
          inArray(coletas.aprovacaoPesoStatus, ["pendente", "aprovado"])
        )
      )
    );
  if (!alteracao.affectedRows)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "O descarte acabou de ser alterado por outro administrador. Atualize a página.",
    });
  await writeAuditLog(db, {
    condominioId: coleta.condominioId,
    autorId: ctx.user.id,
    tipoEntidade: "coleta",
    entidadeId: coleta.id,
    acao: "auditoria_aberta",
    resumo: `Auditoria aberta no descarte nº ${coleta.id} (${formatarKg(coleta.pesoGramas)} kg de ${residuoNaFrase[coleta.tipoResiduo]})${situacaoDescarte(coleta) === "aprovado" ? "; a aprovação anterior fica suspensa até o parecer" : ""}.`,
    estadoAnterior: {
      situacao: situacaoDescarte(coleta),
      pontosConcedidos: coleta.pontosConcedidos,
    },
    estadoNovo: {
      situacao: "auditoria",
      pontosConcedidos: coleta.pontosConcedidos,
    },
    motivo,
  });
  const base = { condominioId: coleta.condominioId, coletaId: coleta.id };
  await notificarUsuario(db, await usuarioDoMorador(coleta.moradorId), {
    ...base,
    tipo: "auditoria_aberta",
    titulo: "Seu descarte está em auditoria",
    mensagem: `A administração abriu uma auditoria no descarte nº ${coleta.id} por algo que pareceu suspeito: ${motivo} Pode ser só um mal-entendido; se quiser, procure a administração para explicar. Se a irregularidade for confirmada, o descarte é reprovado e pode haver medidas administrativas (perda de pontos ou suspensão).`,
  });
  // Para todos os administradores (inclusive quem abriu): é uma tarefa em aberto até alguém dar o parecer.
  await notificarAdministradores(db, {
    ...base,
    tipo: "auditoria_aberta",
    titulo: `Auditoria aberta: descarte nº ${coleta.id}`,
    mensagem: `O descarte nº ${coleta.id} (${formatarKg(coleta.pesoGramas)} kg de ${residuoNaFrase[coleta.tipoResiduo]}, bloco ${coleta.bloco}) foi para auditoria. Motivo: ${motivo.replace(/[.!\s]+$/, "")}. O que fazer: confira a foto, o peso, o adesivo e o histórico do morador e conclua em Descartes > Em auditoria, como regular (aprova) ou irregular (reprova e, se quiser, aplica medidas).`,
  });
  return { success: true, destino: "auditoria" as const, pointsReversed: 0 };
}

/** Tira os pontos de um descarte aprovado e o devolve para a fila de aprovação (nova avaliação por um responsável). */
export async function reverterParaNovaAvaliacao(
  ctx: ContextoAdministrador,
  coleta: Coleta,
  motivo: string
) {
  const db = await getDb();
  const agora = new Date();
  const contabilizado = jaContabilizado(coleta);
  const exato =
    coleta.pontosPrevistosMilesimos ?? coleta.pontosConcedidos * 1000;
  let pontosEstornados = 0;
  await db
    .transaction(async tx => {
      let novoResto: number | null = null;
      if (contabilizado && coleta.moradorId) {
        const [morador] = await tx
          .select({ resto: moradores.restoPontosMilesimos })
          .from(moradores)
          .where(eq(moradores.id, coleta.moradorId))
          .for("update");
        const estorno = estornarComResto(
          morador?.resto ?? 0,
          exato,
          coleta.pontosConcedidos
        );
        pontosEstornados = estorno.pontos;
        novoResto = estorno.resto;
      }
      const [alteracao] = await tx
        .update(coletas)
        .set({
          pendenteAprovacaoPeso: true,
          aprovacaoPesoStatus: "pendente",
          aprovacaoPesoPorId: null,
          aprovacaoPesoEm: null,
          motivoDecisao: `Aprovação revertida: ${motivo}`,
          pontosConcedidos: 0,
          pontosPrevistosMilesimos: exato || coleta.pontosPrevistosMilesimos,
          revisao: coleta.revisao + 1,
          atualizadoEm: agora,
        })
        .where(
          and(
            eq(coletas.id, coleta.id),
            eq(coletas.revisao, coleta.revisao),
            eq(coletas.pendenteAprovacaoPeso, false),
            or(
              isNull(coletas.aprovacaoPesoStatus),
              eq(coletas.aprovacaoPesoStatus, "aprovado")
            )
          )
        );
      if (!alteracao.affectedRows)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "O descarte acabou de ser alterado por outro administrador. Atualize a página.",
        });
      if (coleta.moradorId && novoResto !== null)
        await tx
          .update(moradores)
          .set({ restoPontosMilesimos: novoResto })
          .where(eq(moradores.id, coleta.moradorId));
      if (coleta.moradorId && pontosEstornados > 0) {
        await movimentarPontos(tx, {
          condominioId: coleta.condominioId,
          moradorId: coleta.moradorId,
          tipo: "estorno_coleta",
          pontos: -pontosEstornados,
          coletaId: coleta.id,
          revisaoColeta: coleta.revisao,
          autorId: ctx.user.id,
          descricao: `Aprovação do descarte nº ${coleta.id} revertida para nova avaliação`,
        });
      }
    })
    .catch(converterDuplicidade);
  await writeAuditLog(db, {
    condominioId: coleta.condominioId,
    autorId: ctx.user.id,
    tipoEntidade: "coleta",
    entidadeId: coleta.id,
    acao: "aprovacao_revertida",
    resumo: `Aprovação do descarte nº ${coleta.id} revertida; voltou para nova avaliação${pontosEstornados ? ` e ${plural(pontosEstornados, "ponto saiu", "pontos saíram")} do saldo` : ""}.`,
    estadoAnterior: {
      situacao: "aprovado",
      pontosConcedidos: coleta.pontosConcedidos,
      aprovadoPorId: coleta.aprovacaoPesoPorId,
    },
    estadoNovo: {
      situacao: "pendente",
      pontosConcedidos: 0,
      pontosEstornados,
      revisao: coleta.revisao + 1,
    },
    motivo,
  });
  const base = { condominioId: coleta.condominioId, coletaId: coleta.id };
  await notificarUsuario(db, await usuarioDoMorador(coleta.moradorId), {
    ...base,
    tipo: "descarte_revertido",
    titulo: "Descarte voltou para conferência",
    mensagem: `A aprovação do descarte nº ${coleta.id} foi revertida e ele será avaliado de novo. Motivo: ${motivo.replace(/[.!\s]+$/, "")}.${pontosEstornados ? ` ${plural(pontosEstornados, "ponto saiu", "pontos saíram")} do seu saldo até a nova decisão.` : ""}`,
  });
  await notificarAdministradores(
    db,
    {
      ...base,
      tipo: "descarte_revertido",
      titulo: "Aprovação revertida",
      mensagem: `O descarte nº ${coleta.id} (bloco ${coleta.bloco}) voltou para nova avaliação: ${motivo}`,
    },
    ctx.user.id
  );
  return {
    success: true,
    destino: "nova_avaliacao" as const,
    pointsReversed: pontosEstornados,
  };
}

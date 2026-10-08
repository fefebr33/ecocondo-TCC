import { randomInt } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  adesivos,
  analisesIa,
  coletas,
  condominios,
  estacoesPesagem,
  moradores,
  ocorrencias,
  pedidosAdesivos,
  penalidades,
  statusPedidoAdesivos,
} from "../../drizzle/schema";
import {
  ALFABETO_ADESIVO,
  MAXIMO_ADESIVOS_POR_PEDIDO,
  normalizarCodigoAdesivo,
} from "@shared/adesivos";
import { residuoNaFrase, rotuloResiduo } from "@shared/rotulos";
import { situacaoDescarte } from "@shared/descarte";
import { getDb } from "../db";
import { router } from "../_core/trpc";
import { writeAuditLog } from "../audit";
import { notificarAdministradores, notificarUsuario } from "../notificacoes";
import { administratorOnly, withProfile } from "./nucleo";
import { MODELO_IA, modoIaAtual } from "../ia/analiseDescarte";
import { palavra, plural } from "@shared/plural";

/** Gera um código de adesivo (EC-XXXX-XXXX) com sorteio criptográfico; a unicidade é garantida pelo índice do banco. */
export function gerarCodigoAdesivo() {
  const parte = () =>
    Array.from(
      { length: 4 },
      () => ALFABETO_ADESIVO[randomInt(ALFABETO_ADESIVO.length)]
    ).join("");
  return `EC-${parte()}-${parte()}`;
}

/** Cria `quantidade` adesivos novos para o morador (tenta de novo em caso de colisão de código). */
export async function criarAdesivos(
  tx: any,
  dados: {
    condominioId: number;
    moradorId: number;
    pedidoId: number;
    quantidade: number;
  }
) {
  const codigos: string[] = [];
  while (codigos.length < dados.quantidade) {
    const codigo = gerarCodigoAdesivo();
    if (codigos.includes(codigo)) continue;
    try {
      await tx
        .insert(adesivos)
        .values({
          condominioId: dados.condominioId,
          moradorId: dados.moradorId,
          pedidoId: dados.pedidoId,
          codigo,
        });
      codigos.push(codigo);
    } catch (error: any) {
      if (
        error?.code === "ER_DUP_ENTRY" ||
        error?.cause?.code === "ER_DUP_ENTRY"
      )
        continue;
      throw error;
    }
  }
  return codigos;
}

async function contagemPorStatus(moradorIds: number[]) {
  if (!moradorIds.length)
    return new Map<
      number,
      { disponivel: number; utilizado: number; cancelado: number }
    >();
  const db = await getDb();
  const linhas = await db
    .select({
      moradorId: adesivos.moradorId,
      status: adesivos.status,
      total: count(),
    })
    .from(adesivos)
    .where(inArray(adesivos.moradorId, moradorIds))
    .groupBy(adesivos.moradorId, adesivos.status);
  const mapa = new Map<
    number,
    { disponivel: number; utilizado: number; cancelado: number }
  >();
  for (const id of moradorIds)
    mapa.set(id, { disponivel: 0, utilizado: 0, cancelado: 0 });
  for (const linha of linhas)
    mapa.get(linha.moradorId)![linha.status] = Number(linha.total);
  return mapa;
}

async function moradorDoCondominio(condominioId: number, moradorId: number) {
  const db = await getDb();
  const [morador] = await db
    .select()
    .from(moradores)
    .where(
      and(eq(moradores.id, moradorId), eq(moradores.condominioId, condominioId))
    )
    .limit(1);
  if (!morador)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Morador não encontrado.",
    });
  return morador;
}

/** Entrega adesivos a um morador (atendendo a um pedido ou direto pela administração) e avisa o morador. */
async function entregarAdesivos(
  ctx: { user: { id: number }; eco: { condominio: { id: number } } },
  dados: {
    moradorId: number;
    quantidade: number;
    pedidoId?: number | null;
    observacao?: string | null;
  }
) {
  const db = await getDb();
  const condominioId = ctx.eco.condominio.id;
  const morador = await moradorDoCondominio(condominioId, dados.moradorId);
  const agora = new Date();
  let pedidoId = dados.pedidoId ?? 0;
  let codigos: string[] = [];
  await db.transaction(async tx => {
    if (pedidoId) {
      const [alteracao] = await tx
        .update(pedidosAdesivos)
        .set({
          status: "entregue",
          quantidadeEntregue: dados.quantidade,
          entreguePorId: ctx.user.id,
          entregueEm: agora,
          observacao: dados.observacao ?? undefined,
        })
        .where(
          and(
            eq(pedidosAdesivos.id, pedidoId),
            eq(pedidosAdesivos.condominioId, condominioId),
            eq(pedidosAdesivos.status, "solicitado")
          )
        );
      if (!alteracao.affectedRows)
        throw new TRPCError({
          code: "CONFLICT",
          message: "Este pedido já foi atendido ou recusado.",
        });
    } else {
      const [inserido] = await tx
        .insert(pedidosAdesivos)
        .values({
          condominioId,
          moradorId: morador.id,
          quantidadeSolicitada: dados.quantidade,
          quantidadeEntregue: dados.quantidade,
          status: "entregue",
          observacao: dados.observacao ?? "Entrega feita pela administração",
          solicitadoPorId: ctx.user.id,
          entreguePorId: ctx.user.id,
          entregueEm: agora,
        })
        .$returningId();
      pedidoId = inserido.id;
    }
    codigos = await criarAdesivos(tx, {
      condominioId,
      moradorId: morador.id,
      pedidoId,
      quantidade: dados.quantidade,
    });
  });
  await writeAuditLog(db, {
    condominioId,
    autorId: ctx.user.id,
    tipoEntidade: "adesivo",
    entidadeId: pedidoId,
    acao: "adesivos_entregues",
    resumo: `${plural(dados.quantidade, "adesivo", "adesivos")} com QR Code ${palavra(dados.quantidade, "entregue", "entregues")} a ${morador.nome} (bloco ${morador.bloco}, apto ${morador.apartamento}); de ${codigos[0]} a ${codigos[codigos.length - 1]}.`,
    estadoNovo: {
      pedidoId,
      moradorId: morador.id,
      quantidade: dados.quantidade,
      codigos,
    },
    motivo: dados.observacao ?? null,
  });
  await notificarUsuario(db, morador.usuarioId, {
    condominioId,
    tipo: "adesivos_entregues",
    titulo: `${plural(dados.quantidade, "adesivo entregue", "adesivos entregues")}`,
    mensagem: `A administração entregou ${plural(dados.quantidade, "adesivo", "adesivos")} com QR Code para os seus sacos. Cada adesivo vale para um saco só. Confira a quantidade em Meus adesivos.`,
  });
  return { pedidoId, codigos };
}

export const adesivosRouter = router({
  configuracoesIa: router({
    /** Como a estação funciona neste condomínio: aprovação automática, confiança mínima, adesivo obrigatório e se a IA é real ou simulada. */
    obter: withProfile.query(async ({ ctx }) => {
      const db = await getDb();
      const [condominio] = await db
        .select({
          iaAprovacaoAutomatica: condominios.iaAprovacaoAutomatica,
          iaConfiancaMinima: condominios.iaConfiancaMinima,
          adesivoObrigatorio: condominios.adesivoObrigatorio,
        })
        .from(condominios)
        .where(eq(condominios.id, ctx.eco.condominio.id))
        .limit(1);
      return {
        ...condominio,
        modoIa: modoIaAtual(),
        modelo: modoIaAtual() === "claude" ? MODELO_IA : null,
      };
    }),
    salvar: administratorOnly
      .input(
        z.object({
          iaAprovacaoAutomatica: z.boolean(),
          iaConfiancaMinima: z.number().int().min(50).max(100),
          adesivoObrigatorio: z.boolean(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        const [anterior] = await db
          .select({
            iaAprovacaoAutomatica: condominios.iaAprovacaoAutomatica,
            iaConfiancaMinima: condominios.iaConfiancaMinima,
            adesivoObrigatorio: condominios.adesivoObrigatorio,
          })
          .from(condominios)
          .where(eq(condominios.id, ctx.eco.condominio.id))
          .limit(1);
        await db
          .update(condominios)
          .set({ ...input, atualizadoEm: new Date() })
          .where(eq(condominios.id, ctx.eco.condominio.id));
        await writeAuditLog(db, {
          condominioId: ctx.eco.condominio.id,
          autorId: ctx.user.id,
          tipoEntidade: "configuracao",
          entidadeId: ctx.eco.condominio.id,
          acao: "configuracao_ia_alterada",
          resumo: `Análise automática: aprovação automática ${input.iaAprovacaoAutomatica ? "ligada" : "desligada"}, confiança mínima ${input.iaConfiancaMinima}%, adesivo QR ${input.adesivoObrigatorio ? "obrigatório" : "opcional"}.`,
          estadoAnterior: anterior,
          estadoNovo: input,
        });
        return { success: true };
      }),
  }),
  adesivos: router({
    /** Morador: quantos adesivos tem, os códigos e o histórico de pedidos e entregas. */
    meus: withProfile.query(async ({ ctx }) => {
      if (ctx.eco.perfil.papel !== "morador" || !ctx.eco.morador)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Apenas moradores têm adesivos.",
        });
      const db = await getDb();
      const moradorId = ctx.eco.morador.id;
      const lista = await db
        .select({
          id: adesivos.id,
          codigo: adesivos.codigo,
          status: adesivos.status,
          coletaId: adesivos.coletaId,
          utilizadoEm: adesivos.utilizadoEm,
          criadoEm: adesivos.criadoEm,
        })
        .from(adesivos)
        .where(eq(adesivos.moradorId, moradorId))
        .orderBy(desc(adesivos.utilizadoEm), desc(adesivos.id))
        .limit(300);
      const pedidos = await db
        .select()
        .from(pedidosAdesivos)
        .where(eq(pedidosAdesivos.moradorId, moradorId))
        .orderBy(desc(pedidosAdesivos.criadoEm), desc(pedidosAdesivos.id))
        .limit(50);
      const contagem = (await contagemPorStatus([moradorId])).get(moradorId)!;
      return {
        ...contagem,
        total: contagem.disponivel + contagem.utilizado + contagem.cancelado,
        adesivos: lista,
        pedidos,
        pedidoAberto:
          pedidos.find(pedido => pedido.status === "solicitado") ?? null,
      };
    }),
    /** Morador pede mais adesivos; os administradores são avisados. */
    solicitar: withProfile
      .input(
        z.object({
          quantidade: z.number().int().min(1).max(MAXIMO_ADESIVOS_POR_PEDIDO),
          observacao: z.string().trim().max(300).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (
          ctx.eco.perfil.papel !== "morador" ||
          !ctx.eco.morador ||
          ctx.eco.morador.status !== "ativo"
        )
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Apenas moradores ativos pedem adesivos.",
          });
        const db = await getDb();
        const morador = ctx.eco.morador;
        const [aberto] = await db
          .select({ id: pedidosAdesivos.id })
          .from(pedidosAdesivos)
          .where(
            and(
              eq(pedidosAdesivos.moradorId, morador.id),
              eq(pedidosAdesivos.status, "solicitado")
            )
          )
          .limit(1);
        if (aberto)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Você já tem um pedido de adesivos aguardando a administração.",
          });
        const [inserido] = await db
          .insert(pedidosAdesivos)
          .values({
            condominioId: ctx.eco.condominio.id,
            moradorId: morador.id,
            quantidadeSolicitada: input.quantidade,
            observacao: input.observacao || null,
            solicitadoPorId: ctx.user.id,
          })
          .$returningId();
        await writeAuditLog(db, {
          condominioId: ctx.eco.condominio.id,
          autorId: ctx.user.id,
          tipoEntidade: "adesivo",
          entidadeId: inserido.id,
          acao: "adesivos_solicitados",
          resumo: `${morador.nome} pediu ${plural(input.quantidade, "adesivo", "adesivos")} com QR Code.`,
          estadoNovo: { quantidade: input.quantidade },
          motivo: input.observacao || null,
        });
        await notificarAdministradores(db, {
          condominioId: ctx.eco.condominio.id,
          tipo: "adesivos_solicitados",
          titulo: "Pedido de adesivos",
          mensagem: `${morador.nome} (bloco ${morador.bloco}, apto ${morador.apartamento}) pediu ${plural(input.quantidade, "adesivo", "adesivos")} com QR Code.${input.observacao ? ` Observação: ${input.observacao}` : ""}`,
        });
        return { id: inserido.id };
      }),
    /** Administrador: pedidos (abertos primeiro) com a quantidade que cada morador ainda tem. */
    pedidos: administratorOnly
      .input(
        z.object({ status: z.enum(statusPedidoAdesivos).optional() }).optional()
      )
      .query(async ({ ctx, input }) => {
        const db = await getDb();
        const condicoes = [
          eq(pedidosAdesivos.condominioId, ctx.eco.condominio.id),
        ];
        if (input?.status)
          condicoes.push(eq(pedidosAdesivos.status, input.status));
        const linhas = await db
          .select({
            pedido: pedidosAdesivos,
            morador: moradores.nome,
            bloco: moradores.bloco,
            apartamento: moradores.apartamento,
          })
          .from(pedidosAdesivos)
          .innerJoin(moradores, eq(moradores.id, pedidosAdesivos.moradorId))
          .where(and(...condicoes))
          .orderBy(desc(pedidosAdesivos.criadoEm), desc(pedidosAdesivos.id))
          .limit(200);
        const contagem = await contagemPorStatus(
          Array.from(new Set(linhas.map(linha => linha.pedido.moradorId)))
        );
        return linhas
          .map(linha => ({
            ...linha.pedido,
            morador: linha.morador,
            bloco: linha.bloco,
            apartamento: linha.apartamento,
            disponiveis: contagem.get(linha.pedido.moradorId)?.disponivel ?? 0,
          }))
          .sort(
            (a, b) =>
              Number(b.status === "solicitado") -
              Number(a.status === "solicitado")
          );
      }),
    /** Administrador: situação dos adesivos de cada morador (disponíveis, usados, cancelados). */
    porMorador: administratorOnly.query(async ({ ctx }) => {
      const db = await getDb();
      const lista = await db
        .select({
          id: moradores.id,
          nome: moradores.nome,
          bloco: moradores.bloco,
          apartamento: moradores.apartamento,
          status: moradores.status,
        })
        .from(moradores)
        .where(eq(moradores.condominioId, ctx.eco.condominio.id))
        .orderBy(moradores.bloco, moradores.apartamento);
      const contagem = await contagemPorStatus(
        lista.map(morador => morador.id)
      );
      return lista.map(morador => ({
        ...morador,
        ...contagem.get(morador.id)!,
      }));
    }),
    /** Administrador: entrega adesivos (atende um pedido ou entrega direto); devolve os códigos para imprimir. */
    entregar: administratorOnly
      .input(
        z.object({
          moradorId: z.number().int().positive(),
          quantidade: z.number().int().min(1).max(MAXIMO_ADESIVOS_POR_PEDIDO),
          pedidoId: z.number().int().positive().optional(),
          observacao: z.string().trim().max(300).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (input.pedidoId) {
          const db = await getDb();
          const [pedido] = await db
            .select()
            .from(pedidosAdesivos)
            .where(
              and(
                eq(pedidosAdesivos.id, input.pedidoId),
                eq(pedidosAdesivos.condominioId, ctx.eco.condominio.id)
              )
            )
            .limit(1);
          if (!pedido || pedido.moradorId !== input.moradorId)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Pedido não encontrado.",
            });
        }
        return entregarAdesivos(ctx, {
          moradorId: input.moradorId,
          quantidade: input.quantidade,
          pedidoId: input.pedidoId ?? null,
          observacao: input.observacao || null,
        });
      }),
    recusar: administratorOnly
      .input(
        z.object({
          pedidoId: z.number().int().positive(),
          motivo: z.string().trim().min(5).max(300),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        const [pedido] = await db
          .select()
          .from(pedidosAdesivos)
          .where(
            and(
              eq(pedidosAdesivos.id, input.pedidoId),
              eq(pedidosAdesivos.condominioId, ctx.eco.condominio.id)
            )
          )
          .limit(1);
        if (!pedido)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Pedido não encontrado.",
          });
        const [alteracao] = await db
          .update(pedidosAdesivos)
          .set({
            status: "recusado",
            observacao: input.motivo,
            entreguePorId: ctx.user.id,
            entregueEm: new Date(),
          })
          .where(
            and(
              eq(pedidosAdesivos.id, pedido.id),
              eq(pedidosAdesivos.status, "solicitado")
            )
          );
        if (!alteracao.affectedRows)
          throw new TRPCError({
            code: "CONFLICT",
            message: "Este pedido já foi atendido ou recusado.",
          });
        await writeAuditLog(db, {
          condominioId: ctx.eco.condominio.id,
          autorId: ctx.user.id,
          tipoEntidade: "adesivo",
          entidadeId: pedido.id,
          acao: "pedido_adesivos_recusado",
          resumo: `Pedido de ${plural(pedido.quantidadeSolicitada, "adesivo", "adesivos")} recusado.`,
          motivo: input.motivo,
        });
        const usuarioId = (
          await moradorDoCondominio(ctx.eco.condominio.id, pedido.moradorId)
        ).usuarioId;
        await notificarUsuario(db, usuarioId, {
          condominioId: ctx.eco.condominio.id,
          tipo: "adesivos_entregues",
          titulo: "Pedido de adesivos não atendido",
          mensagem: `A administração não atendeu o seu pedido de ${plural(pedido.quantidadeSolicitada, "adesivo", "adesivos")}. Motivo: ${input.motivo}`,
        });
        return { success: true };
      }),
    /** Códigos de um pedido entregue, para imprimir a folha de adesivos de novo. */
    folha: administratorOnly
      .input(z.object({ pedidoId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const db = await getDb();
        const [pedido] = await db
          .select({
            pedido: pedidosAdesivos,
            morador: moradores.nome,
            bloco: moradores.bloco,
            apartamento: moradores.apartamento,
          })
          .from(pedidosAdesivos)
          .innerJoin(moradores, eq(moradores.id, pedidosAdesivos.moradorId))
          .where(
            and(
              eq(pedidosAdesivos.id, input.pedidoId),
              eq(pedidosAdesivos.condominioId, ctx.eco.condominio.id)
            )
          )
          .limit(1);
        if (!pedido)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Pedido não encontrado.",
          });
        const lista = await db
          .select({ codigo: adesivos.codigo, status: adesivos.status })
          .from(adesivos)
          .where(eq(adesivos.pedidoId, input.pedidoId))
          .orderBy(adesivos.id);
        return {
          ...pedido.pedido,
          morador: pedido.morador,
          bloco: pedido.bloco,
          apartamento: pedido.apartamento,
          adesivos: lista,
        };
      }),
    /** Cancela um adesivo perdido ou danificado: ele deixa de valer na estação. */
    cancelar: administratorOnly
      .input(
        z.object({
          codigo: z.string().trim().min(4).max(80),
          motivo: z.string().trim().min(5).max(300),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const codigo = normalizarCodigoAdesivo(input.codigo);
        if (!codigo)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Código de adesivo inválido.",
          });
        const db = await getDb();
        const [alteracao] = await db
          .update(adesivos)
          .set({ status: "cancelado" })
          .where(
            and(
              eq(adesivos.codigo, codigo),
              eq(adesivos.condominioId, ctx.eco.condominio.id),
              eq(adesivos.status, "disponivel")
            )
          );
        if (!alteracao.affectedRows)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Adesivo não encontrado ou já usado.",
          });
        const [adesivo] = await db
          .select()
          .from(adesivos)
          .where(eq(adesivos.codigo, codigo))
          .limit(1);
        await writeAuditLog(db, {
          condominioId: ctx.eco.condominio.id,
          autorId: ctx.user.id,
          tipoEntidade: "adesivo",
          entidadeId: adesivo.id,
          acao: "adesivo_cancelado",
          resumo: `Adesivo ${codigo} cancelado.`,
          estadoAnterior: { status: "disponivel" },
          estadoNovo: { status: "cancelado" },
          motivo: input.motivo,
        });
        const [dono] = await db
          .select({ usuarioId: moradores.usuarioId })
          .from(moradores)
          .where(eq(moradores.id, adesivo.moradorId))
          .limit(1);
        const [restantes] = await db
          .select({ total: count() })
          .from(adesivos)
          .where(
            and(
              eq(adesivos.moradorId, adesivo.moradorId),
              eq(adesivos.status, "disponivel")
            )
          );
        const sobra = Number(restantes?.total ?? 0);
        await notificarUsuario(db, dono?.usuarioId ?? null, {
          condominioId: ctx.eco.condominio.id,
          tipo: "adesivo_cancelado",
          titulo: "Adesivo cancelado",
          mensagem: `A administração cancelou o seu adesivo ${codigo}: ele não vale mais na estação. Motivo: ${input.motivo.replace(/[.!\s]+$/, "")}. ${sobra ? `Você ainda tem ${plural(sobra, "adesivo disponível", "adesivos disponíveis")}.` : "Você ficou sem adesivos disponíveis: peça mais em Meus adesivos."}`,
        });
        return { success: true };
      }),
    /**
     * Leitura do QR pelo administrador: localiza o dono do adesivo e o descarte em que ele foi usado.
     * Mostra só o necessário (nome, bloco e apartamento; sem e-mail nem telefone) e registra a consulta na auditoria (LGPD).
     */
    consultar: administratorOnly
      .input(
        z.object({
          codigo: z.string().trim().min(4).max(300),
          finalidade: z.string().trim().max(200).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const codigo = normalizarCodigoAdesivo(input.codigo);
        if (!codigo)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Não reconheci um código de adesivo. Ele tem o formato EC-XXXX-XXXX.",
          });
        const db = await getDb();
        const condominioId = ctx.eco.condominio.id;
        const [adesivo] = await db
          .select()
          .from(adesivos)
          .where(
            and(
              eq(adesivos.codigo, codigo),
              eq(adesivos.condominioId, condominioId)
            )
          )
          .limit(1);
        if (!adesivo) {
          await writeAuditLog(db, {
            condominioId,
            autorId: ctx.user.id,
            tipoEntidade: "adesivo",
            entidadeId: 0,
            acao: "adesivo_consultado",
            resumo: `Consulta ao adesivo ${codigo}: não encontrado neste condomínio.`,
            motivo: input.finalidade || null,
          });
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `O adesivo ${codigo} não existe neste condomínio.`,
          });
        }
        const [morador] = await db
          .select({
            id: moradores.id,
            nome: moradores.nome,
            bloco: moradores.bloco,
            apartamento: moradores.apartamento,
            status: moradores.status,
            pontos: moradores.pontos,
          })
          .from(moradores)
          .where(eq(moradores.id, adesivo.moradorId))
          .limit(1);
        let descarte = null;
        if (adesivo.coletaId) {
          const [registro] = await db
            .select({
              coleta: coletas,
              estacao: estacoesPesagem.nome,
              local: estacoesPesagem.local,
            })
            .from(coletas)
            .leftJoin(
              estacoesPesagem,
              eq(estacoesPesagem.id, coletas.estacaoId)
            )
            .where(eq(coletas.id, adesivo.coletaId))
            .limit(1);
          const [analise] = await db
            .select()
            .from(analisesIa)
            .where(eq(analisesIa.coletaId, adesivo.coletaId))
            .orderBy(desc(analisesIa.id))
            .limit(1);
          if (registro)
            descarte = {
              id: registro.coleta.id,
              data: registro.coleta.concluidaEm,
              tipo: registro.coleta.tipoResiduo,
              material: rotuloResiduo[registro.coleta.tipoResiduo],
              pesoGramas: registro.coleta.pesoGramas,
              situacao: situacaoDescarte(registro.coleta),
              pontos: registro.coleta.pontosConcedidos,
              estacao: registro.estacao,
              local: registro.local,
              urlFoto: registro.coleta.urlFoto,
              ia: analise
                ? {
                    resultado: analise.resultado,
                    confianca: analise.confianca,
                    motivos: JSON.parse(analise.motivos) as string[],
                    modo: analise.modo,
                  }
                : null,
            };
        }
        const recentes = await db
          .select({
            id: coletas.id,
            data: coletas.concluidaEm,
            tipo: coletas.tipoResiduo,
            pesoGramas: coletas.pesoGramas,
            pendente: coletas.pendenteAprovacaoPeso,
            status: coletas.status,
            aprovacaoPesoStatus: coletas.aprovacaoPesoStatus,
            pontosConcedidos: coletas.pontosConcedidos,
          })
          .from(coletas)
          .where(eq(coletas.moradorId, adesivo.moradorId))
          .orderBy(desc(coletas.concluidaEm), desc(coletas.id))
          .limit(5);
        const medidas = await db
          .select({
            id: penalidades.id,
            nome: penalidades.nome,
            tipo: penalidades.tipo,
            status: penalidades.status,
            inicioEm: penalidades.inicioEm,
            fimEm: penalidades.fimEm,
          })
          .from(penalidades)
          .where(eq(penalidades.moradorId, adesivo.moradorId))
          .orderBy(desc(penalidades.criadoEm))
          .limit(5);
        const relacionadas = adesivo.coletaId
          ? await db
              .select({
                id: ocorrencias.id,
                status: ocorrencias.status,
                categoria: ocorrencias.categoria,
                conclusao: ocorrencias.conclusao,
                criadoEm: ocorrencias.criadoEm,
              })
              .from(ocorrencias)
              .where(
                and(
                  eq(ocorrencias.condominioId, condominioId),
                  eq(ocorrencias.coletaId, adesivo.coletaId)
                )
              )
              .limit(10)
          : [];
        const contagem = (await contagemPorStatus([adesivo.moradorId])).get(
          adesivo.moradorId
        )!;
        await writeAuditLog(db, {
          condominioId,
          autorId: ctx.user.id,
          tipoEntidade: "adesivo",
          entidadeId: adesivo.id,
          acao: "adesivo_consultado",
          resumo: `Consulta ao adesivo ${codigo} (de ${morador?.nome ?? "morador removido"}, bloco ${morador?.bloco ?? "-"})${adesivo.coletaId ? `, usado no descarte nº ${adesivo.coletaId}` : ""}.`,
          estadoNovo: {
            codigo,
            moradorId: adesivo.moradorId,
            coletaId: adesivo.coletaId,
          },
          motivo: input.finalidade || null,
        });
        return {
          codigo,
          status: adesivo.status,
          utilizadoEm: adesivo.utilizadoEm,
          entregueEm: adesivo.criadoEm,
          morador: morador ? { ...morador, adesivos: contagem } : null,
          descarte,
          recentes: recentes.map(registro => ({
            id: registro.id,
            data: registro.data,
            material: rotuloResiduo[registro.tipo],
            pesoGramas: registro.pesoGramas,
            situacao: situacaoDescarte({
              status: registro.status,
              pendenteAprovacaoPeso: registro.pendente,
              aprovacaoPesoStatus: registro.aprovacaoPesoStatus,
            }),
            pontos: registro.pontosConcedidos,
          })),
          medidas,
          ocorrencias: relacionadas,
          aviso: `Consulta registrada na auditoria em nome de quem consultou. Use estes dados só para tratar ${descarte ? `o descarte de ${residuoNaFrase[descarte.tipo]}` : "o descarte"} (LGPD).`,
        };
      }),
  }),
});

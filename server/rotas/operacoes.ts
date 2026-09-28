import { TRPCError } from "@trpc/server";
import QRCode from "qrcode";
import { customAlphabet } from "nanoid";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or } from "drizzle-orm";
import { z } from "zod";
import { coletas, estacoesPesagem, statusColeta, pessoas, moradores, statusMorador, usuarios, tiposResiduo } from "../../drizzle/schema";
import type { Coleta } from "../../drizzle/schema";
import { getDb } from "../db";
import { residuoNaFrase, rotuloStatusColeta } from "@shared/rotulos";

const gerarCodigoMorador = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 8);
import { administratorOnly, withProfile } from "./nucleo";
import { router } from "../_core/trpc";
import { calculateCollectionPoints, prepareCollectionCompletion, verificarTransicaoColeta } from "../dominio/regrasColeta";
import { buildPendingResidentPerson } from "../dominio/regrasPessoas";
import { collectionAuditState, writeAuditLog } from "../audit";
import { salvarImagemBase64 } from "../storage";
import { MovimentacaoDuplicadaError, movimentarPontos } from "../pontos";
import { notificarAdministradores, notificarUsuario } from "../notificacoes";
import {
  LIMITE_PESO_POR_COLETA_GRAMAS,
  LimiteAntifraudeExcedidoError,
  ehPesoAnomalo,
  verificarLimiteDiarioMorador,
  verificarLimitePorColeta,
  verificarSegregacaoDeFuncao,
} from "../dominio/antifraude";

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
  startDate: z.date().optional(),
  endDate: z.date().optional(),
});

/**
 * Descreve de onde veio cada registro: estação de pesagem (o próprio morador), coletor (só coletas antigas,
 * de antes da retirada do perfil) ou administração.
 */
export async function origensDosRegistros(condominioId: number, registros: Array<typeof coletas.$inferSelect>) {
  const db = await getDb();
  const estacoes = registros.some((registro) => registro.estacaoId !== null)
    ? await db.select({ id: estacoesPesagem.id, nome: estacoesPesagem.nome }).from(estacoesPesagem).where(eq(estacoesPesagem.condominioId, condominioId))
    : [];
  const idsColetores = Array.from(new Set(registros.map((registro) => registro.coletorId).filter((id): id is number => id !== null)));
  const coletores = idsColetores.length ? await db.select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios).where(inArray(usuarios.id, idsColetores)) : [];
  return (registro: typeof coletas.$inferSelect) => {
    if (registro.estacaoId !== null) return `Estação: ${estacoes.find((estacao) => estacao.id === registro.estacaoId)?.nome ?? "removida"}`;
    if (registro.coletorId !== null) return `Coletor: ${coletores.find((coletor) => coletor.id === registro.coletorId)?.nome ?? "sem nome"} (histórico)`;
    return "Administração";
  };
}

export const operationsRouter = router({
  moradores: router({
    listar: administratorOnly.query(async ({ ctx }) => {
      const db = await getDb();
      return db.select().from(moradores).where(eq(moradores.condominioId, ctx.eco.condominio.id)).orderBy(asc(moradores.nome));
    }),
    criar: administratorOnly.input(moradorInput).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const inserido = await db.insert(moradores).values({
        condominioId: ctx.eco.condominio.id,
        nome: input.name,
        email: input.email || null,
        telefone: input.phone || null,
        bloco: input.block,
        apartamento: input.apartment,
        status: input.status,
      }).$returningId();
      await writeAuditLog(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "morador", entidadeId: inserido[0].id, acao: "morador_cadastrado", resumo: `Morador ${input.name} cadastrado (bloco ${input.block}, apto. ${input.apartment}).`, estadoNovo: { nome: input.name, bloco: input.block, apartamento: input.apartment, status: input.status } });
      await notificarAdministradores(db, { condominioId: ctx.eco.condominio.id, tipo: "novo_cadastro", titulo: "Novo morador cadastrado", mensagem: `${input.name} (bloco ${input.block}, apto. ${input.apartment}) foi cadastrado.` }, ctx.user.id);
      return { id: inserido[0].id };
    }),
    atualizar: administratorOnly.input(moradorInput.partial().extend({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const { id, ...atualizacao } = input;
      const existente = await db.select().from(moradores).where(and(eq(moradores.id, id), eq(moradores.condominioId, ctx.eco.condominio.id))).limit(1);
      if (!existente[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Morador não encontrado." });
      const proximoEmail = atualizacao.email === undefined ? existente[0].email : atualizacao.email || null;
      const proximoTelefone = atualizacao.phone === undefined ? existente[0].telefone : atualizacao.phone || null;
      await db.update(moradores).set({
        nome: atualizacao.name ?? existente[0].nome,
        bloco: atualizacao.block ?? existente[0].bloco,
        apartamento: atualizacao.apartment ?? existente[0].apartamento,
        status: atualizacao.status ?? existente[0].status,
        email: proximoEmail,
        telefone: proximoTelefone,
        atualizadoEm: new Date(),
      }).where(eq(moradores.id, id));
      const antes = { nome: existente[0].nome, bloco: existente[0].bloco, apartamento: existente[0].apartamento, status: existente[0].status, email: existente[0].email, telefone: existente[0].telefone };
      const depois = { nome: atualizacao.name ?? existente[0].nome, bloco: atualizacao.block ?? existente[0].bloco, apartamento: atualizacao.apartment ?? existente[0].apartamento, status: atualizacao.status ?? existente[0].status, email: proximoEmail, telefone: proximoTelefone };
      const alterados = (Object.keys(antes) as Array<keyof typeof antes>).filter((campo) => antes[campo] !== depois[campo]);
      if (alterados.length) {
        await writeAuditLog(db, { condominioId: ctx.eco.condominio.id, autorId: ctx.user.id, tipoEntidade: "morador", entidadeId: id, acao: "morador_atualizado", resumo: `Cadastro de ${depois.nome} alterado (${alterados.join(", ")}).`, estadoAnterior: antes, estadoNovo: depois });
        const rotulos: Record<string, string> = { nome: "nome", bloco: "bloco", apartamento: "apartamento", status: "situação", email: "e-mail", telefone: "telefone" };
        await notificarUsuario(db, existente[0].usuarioId, { condominioId: ctx.eco.condominio.id, tipo: "cadastro_alterado", titulo: "Seu cadastro foi alterado", mensagem: `A administração alterou ${alterados.map((campo) => rotulos[campo]).join(", ")} do seu cadastro. Se algo estiver errado, fale com o síndico.` });
      }
      const pessoa = await db.select().from(pessoas).where(eq(pessoas.moradorId, id)).limit(1);
      if (pessoa[0]) {
        await db.update(pessoas).set({ nome: atualizacao.name ?? existente[0].nome, email: proximoEmail || pessoa[0].email, telefone: proximoTelefone, bloco: atualizacao.block ?? existente[0].bloco, apartamento: atualizacao.apartment ?? existente[0].apartamento, atualizadoEm: new Date() }).where(eq(pessoas.id, pessoa[0].id));
      } else if (proximoEmail) {
        await db.insert(pessoas).values({ condominioId: ctx.eco.condominio.id, ...buildPendingResidentPerson({ id, usuarioId: existente[0].usuarioId, nome: atualizacao.name ?? existente[0].nome, email: proximoEmail, telefone: proximoTelefone, bloco: atualizacao.block ?? existente[0].bloco, apartamento: atualizacao.apartment ?? existente[0].apartamento }) });
      }
      return { success: true };
    }),
    /** Gera (na primeira vez) e devolve o código + QR code do apartamento, para o administrador identificar o morador num registro manual. */
    codigoQr: administratorOnly.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const db = await getDb();
      const encontrado = await db.select().from(moradores).where(and(eq(moradores.id, input.id), eq(moradores.condominioId, ctx.eco.condominio.id))).limit(1);
      const morador = encontrado[0];
      if (!morador) throw new TRPCError({ code: "NOT_FOUND", message: "Morador não encontrado." });
      let codigo = morador.codigoAcesso;
      if (!codigo) {
        codigo = gerarCodigoMorador();
        await db.update(moradores).set({ codigoAcesso: codigo, atualizadoEm: new Date() }).where(eq(moradores.id, morador.id));
      }
      const qrDataUrl = await QRCode.toDataURL(codigo, { margin: 1, width: 220 });
      return { code: codigo, qrDataUrl };
    }),
    porCodigo: administratorOnly.input(z.object({ code: z.string().trim().min(1).max(32) })).query(async ({ ctx, input }) => {
      const db = await getDb();
      const encontrado = await db.select().from(moradores).where(and(eq(moradores.codigoAcesso, input.code.toUpperCase()), eq(moradores.condominioId, ctx.eco.condominio.id))).limit(1);
      if (!encontrado[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Nenhum morador encontrado para este código." });
      return encontrado[0];
    }),
  }),
  coletas: router({
    listar: withProfile.input(filtrosColeta.optional()).query(async ({ ctx, input }) => {
      const db = await getDb();
      const condicoes = [eq(coletas.condominioId, ctx.eco.condominio.id)];
      if (ctx.eco.perfil.papel === "morador") {
        if (!ctx.eco.morador) return [];
        condicoes.push(eq(coletas.moradorId, ctx.eco.morador.id));
      }
      if (input?.wasteType) condicoes.push(eq(coletas.tipoResiduo, input.wasteType));
      if (input?.block) condicoes.push(eq(coletas.bloco, input.block));
      if (input?.status) condicoes.push(eq(coletas.status, input.status));
      if (input?.startDate) condicoes.push(gte(coletas.agendadaPara, input.startDate));
      if (input?.endDate) condicoes.push(lte(coletas.agendadaPara, input.endDate));

      const registros = await db.select().from(coletas).where(and(...condicoes)).orderBy(desc(coletas.agendadaPara));
      const moradorIds = Array.from(new Set(registros.map((registro) => registro.moradorId).filter((id): id is number => id !== null)));
      const moradoresRelacionados = moradorIds.length
        ? await db.select().from(moradores).where(and(eq(moradores.condominioId, ctx.eco.condominio.id)))
        : [];
      const origens = await origensDosRegistros(ctx.eco.condominio.id, registros);
      return registros.map((registro) => ({
        ...registro,
        residentName: moradoresRelacionados.find((morador) => morador.id === registro.moradorId)?.nome ?? null,
        origin: origens(registro),
      }));
    }),
    criar: withProfile.input(z.object({
      residentId: z.number().int().positive().nullable().optional(),
      wasteType: z.enum(tiposResiduo),
      block: z.string().trim().min(1).max(32),
      scheduledAt: z.date(),
      notes: z.string().trim().max(1200).nullable().optional(),
    })).mutation(async ({ ctx, input }) => {
      const inicioDeHoje = new Date();
      inicioDeHoje.setHours(0, 0, 0, 0);
      if (input.scheduledAt < inicioDeHoje) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A data da coleta não pode ser anterior a hoje." });
      }
      const db = await getDb();
      let moradorId = input.residentId ?? null;
      let bloco = input.block;
      const pedidoDoMorador = ctx.eco.perfil.papel === "morador";

      if (pedidoDoMorador) {
        if (!ctx.eco.morador || ctx.eco.morador.status !== "ativo") throw new TRPCError({ code: "FORBIDDEN", message: "O perfil do morador não está habilitado para solicitar coletas." });
        moradorId = ctx.eco.morador.id;
        bloco = ctx.eco.morador.bloco;
      }

      let morador = null;
      if (moradorId) {
        const encontrado = await db.select().from(moradores).where(and(eq(moradores.id, moradorId), eq(moradores.condominioId, ctx.eco.condominio.id))).limit(1);
        morador = encontrado[0] ?? null;
        if (!morador) throw new TRPCError({ code: "NOT_FOUND", message: "Morador não encontrado neste condomínio." });
      }

      const inserido = await db.insert(coletas).values({
        condominioId: ctx.eco.condominio.id,
        moradorId,
        criadoPorId: ctx.user.id,
        tipoResiduo: input.wasteType,
        bloco,
        agendadaPara: input.scheduledAt,
        observacoes: input.notes || null,
      }).$returningId();
      const coletaId = inserido[0].id;
      await writeAuditLog(db, {
        condominioId: ctx.eco.condominio.id,
        autorId: ctx.user.id,
        tipoEntidade: "coleta",
        entidadeId: coletaId,
        acao: pedidoDoMorador ? "coleta_solicitada" : "coleta_criada",
        resumo: pedidoDoMorador ? `Coleta de ${residuoNaFrase[input.wasteType]} solicitada pelo morador (bloco ${bloco}).` : `Coleta de ${residuoNaFrase[input.wasteType]} criada para o bloco ${bloco}.`,
        estadoNovo: { status: "agendada", tipoResiduo: input.wasteType, bloco, agendadaPara: input.scheduledAt, moradorId, observacoes: input.notes || null },
      });
      const quando = dataHoraCurta(input.scheduledAt);
      if (pedidoDoMorador) {
        await notificarUsuario(db, ctx.user.id, { condominioId: ctx.eco.condominio.id, coletaId, tipo: "solicitacao_criada", titulo: "Solicitação de coleta recebida", mensagem: `Sua coleta de ${residuoNaFrase[input.wasteType]} foi registrada para ${quando} (coleta nº ${coletaId}). Você recebe um lembrete na véspera.` });
        await notificarAdministradores(db, { condominioId: ctx.eco.condominio.id, coletaId, tipo: "nova_coleta", titulo: "Nova coleta solicitada", mensagem: `${morador?.nome ?? "Um morador"} (bloco ${bloco}) pediu uma coleta de ${residuoNaFrase[input.wasteType]} para ${quando}.` });
      } else if (morador?.usuarioId) {
        await notificarUsuario(db, morador.usuarioId, { condominioId: ctx.eco.condominio.id, coletaId, tipo: "coleta_agendada", titulo: "Coleta agendada", mensagem: `Uma coleta de ${residuoNaFrase[input.wasteType]} foi agendada para o bloco ${bloco} em ${quando}.` });
      }
      return { id: coletaId };
    }),
    atualizarStatus: administratorOnly.input(z.object({
      id: z.number().int().positive(),
      status: z.enum(statusColeta),
      weightGrams: z.number().int().min(0).max(LIMITE_PESO_POR_COLETA_GRAMAS).nullable().optional(),
      notes: z.string().trim().max(1200).nullable().optional(),
      imageDataUrl: z.string().max(5_500_000).nullable().optional(),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const encontrada = await db.select().from(coletas).where(and(eq(coletas.id, input.id), eq(coletas.condominioId, ctx.eco.condominio.id))).limit(1);
      const coleta = encontrada[0];
      if (!coleta) throw new TRPCError({ code: "NOT_FOUND", message: "Coleta não encontrada." });
      let conclusao;
      try {
        verificarTransicaoColeta(coleta.status, input.status);
        conclusao = prepareCollectionCompletion(
          { status: input.status, weightGrams: input.weightGrams, notes: input.notes },
          { weightGrams: coleta.pesoGramas, notes: coleta.observacoes, wasteType: coleta.tipoResiduo },
        );
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Não foi possível concluir a coleta." });
      }

      if (input.status === "concluida" && !coleta.chaveFoto && !input.imageDataUrl) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Anexe uma foto da coleta para concluir." });
      }

      let moradorBeneficiado = null;
      if (coleta.moradorId) {
        const encontrado = await db.select().from(moradores).where(eq(moradores.id, coleta.moradorId)).limit(1);
        moradorBeneficiado = encontrado[0] ?? null;
      }
      let pesoAnomalo = false;
      if (input.status === "concluida" && conclusao.weightGrams) {
        try {
          verificarSegregacaoDeFuncao(ctx.user.id, moradorBeneficiado?.usuarioId);
          verificarLimitePorColeta(conclusao.weightGrams);
          if (coleta.moradorId) {
            const inicioDoDia = new Date();
            inicioDoDia.setHours(0, 0, 0, 0);
            const concluidasHoje = await db.select().from(coletas).where(and(eq(coletas.moradorId, coleta.moradorId), eq(coletas.status, "concluida"), gte(coletas.concluidaEm, inicioDoDia)));
            const pesoJaConcluidoHoje = concluidasHoje.filter((registro) => registro.id !== coleta.id).reduce((soma, registro) => soma + (registro.pesoGramas ?? 0), 0);
            verificarLimiteDiarioMorador(pesoJaConcluidoHoje, conclusao.weightGrams);
            const historico = await db.select().from(coletas).where(and(eq(coletas.moradorId, coleta.moradorId), eq(coletas.status, "concluida"))).orderBy(desc(coletas.concluidaEm)).limit(10);
            const pesosHistoricos = historico.filter((registro) => registro.id !== coleta.id).map((registro) => registro.pesoGramas ?? 0);
            const mediaHistorica = pesosHistoricos.length ? pesosHistoricos.reduce((soma, peso) => soma + peso, 0) / pesosHistoricos.length : 0;
            pesoAnomalo = ehPesoAnomalo(conclusao.weightGrams, mediaHistorica);
          }
        } catch (error) {
          if (error instanceof LimiteAntifraudeExcedidoError) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
          throw error;
        }
      }

      let foto: { key: string | null; url: string | null } = { key: coleta.chaveFoto, url: coleta.urlFoto };
      if (input.imageDataUrl) {
        try {
          foto = await salvarImagemBase64(input.imageDataUrl, `coletas/${ctx.eco.condominio.id}/${coleta.id}`);
        } catch (error) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Não foi possível salvar a foto da coleta." });
        }
      }

      const novoPeso = conclusao.weightGrams;
      // Peso anômalo em uma coleta concluída: os pontos ficam retidos até a aprovação de um segundo administrador (dupla aprovação).
      const pontosCalculados = conclusao.pointsAwarded;
      const novosPontos = pesoAnomalo ? 0 : pontosCalculados;
      const concluidaEm = conclusao.completedAt ? new Date() : null;
      const kg = formatarKg(novoPeso);
      await db.transaction(async (tx) => {
        // Só altera se ninguém mudou a coleta desde a leitura: dois cliques em "Concluir" não pesam nem pontuam duas vezes.
        const [alteracao] = await tx.update(coletas).set({
          status: input.status,
          pesoGramas: novoPeso,
          pontosConcedidos: novosPontos,
          concluidaEm,
          concluidoPorId: input.status === "concluida" ? ctx.user.id : null,
          observacoes: conclusao.notes,
          chaveFoto: foto.key,
          urlFoto: foto.url,
          pendenteAprovacaoPeso: pesoAnomalo,
          aprovacaoPesoStatus: pesoAnomalo ? "pendente" : null,
          atualizadoEm: new Date(),
        }).where(and(eq(coletas.id, coleta.id), eq(coletas.status, coleta.status)));
        if (!alteracao.affectedRows) throw new TRPCError({ code: "CONFLICT", message: "A coleta acabou de ser alterada por outra pessoa. Atualize a página e confira." });
        if (coleta.moradorId && novosPontos > 0) {
          await movimentarPontos(tx, { condominioId: ctx.eco.condominio.id, moradorId: coleta.moradorId, tipo: "credito_coleta", pontos: novosPontos, coletaId: coleta.id, autorId: ctx.user.id, descricao: `Coleta nº ${coleta.id} concluída (${kg} kg de ${residuoNaFrase[coleta.tipoResiduo]})` });
        }
      }).catch(converterDuplicidade);
      await writeAuditLog(db, {
        condominioId: ctx.eco.condominio.id,
        autorId: ctx.user.id,
        tipoEntidade: "coleta",
        entidadeId: coleta.id,
        acao: "coleta_atualizada",
        resumo: `Coleta atualizada para o status "${rotuloStatusColeta[input.status]}".`,
        estadoAnterior: collectionAuditState({ status: coleta.status, pesoGramas: coleta.pesoGramas, pontosConcedidos: coleta.pontosConcedidos, coletorId: coleta.coletorId, agendadaPara: coleta.agendadaPara, concluidaEm: coleta.concluidaEm, observacoes: coleta.observacoes }),
        estadoNovo: {
          status: input.status,
          pesoGramas: novoPeso,
          pontosConcedidos: novosPontos,
          concluidaEm,
          observacoes: conclusao.notes,
        },
        motivo: input.status === "cancelada" || input.status === "ocorrencia" ? conclusao.notes : null,
      });
      if (pesoAnomalo) {
        await writeAuditLog(db, {
          condominioId: ctx.eco.condominio.id,
          autorId: ctx.user.id,
          tipoEntidade: "coleta",
          entidadeId: coleta.id,
          acao: "coleta_sinalizada_suspeita",
          resumo: `Peso informado (${kg} kg) muito acima do histórico do morador. Pontos retidos até aprovação de um segundo administrador.`,
          estadoNovo: { pesoGramas: novoPeso, moradorId: coleta.moradorId, pontosPendentes: pontosCalculados },
        });
        // Avisa os demais administradores: quem concluiu a coleta não pode aprovar o próprio lançamento.
        await notificarAdministradores(db, { condominioId: ctx.eco.condominio.id, coletaId: coleta.id, tipo: "peso_suspeito", titulo: "Peso suspeito aguardando aprovação", mensagem: `A coleta nº ${coleta.id} (${residuoNaFrase[coleta.tipoResiduo]}, bloco ${coleta.bloco}) foi concluída com ${kg} kg, bem acima do histórico do morador. Revise em Coletas > Registros aguardando aprovação.` }, ctx.user.id);
      } else if (input.status === "concluida") {
        await notificarAdministradores(db, { condominioId: ctx.eco.condominio.id, coletaId: coleta.id, tipo: "coleta_concluida", titulo: "Coleta concluída", mensagem: `A coleta nº ${coleta.id} (${residuoNaFrase[coleta.tipoResiduo]}, bloco ${coleta.bloco}) foi concluída com ${kg} kg.` }, ctx.user.id);
      }

      if (moradorBeneficiado?.usuarioId) {
        const destino = moradorBeneficiado.usuarioId;
        const base = { condominioId: ctx.eco.condominio.id, coletaId: coleta.id };
        if (input.status === "concluida") {
          await notificarUsuario(db, destino, { ...base, tipo: "coleta_concluida", titulo: "Coleta concluída", mensagem: pesoAnomalo ? `Sua coleta nº ${coleta.id} foi concluída com ${kg} kg. O peso está acima do seu padrão e os ${pontosCalculados} ponto(s) ficam pendentes até a revisão de um administrador.` : `Sua coleta nº ${coleta.id} foi concluída com ${kg} kg.` });
          if (novosPontos > 0) await notificarUsuario(db, destino, { ...base, tipo: "pontos_ganhos", titulo: `+${novosPontos} ponto(s)`, mensagem: `Você ganhou ${novosPontos} ponto(s) pela coleta nº ${coleta.id}. Veja o extrato em Engajamento.` });
        } else {
          await notificarUsuario(db, destino, { ...base, tipo: "sistema", titulo: "Atualização de coleta", mensagem: `O status da sua coleta nº ${coleta.id} foi atualizado para "${rotuloStatusColeta[input.status]}"${conclusao.notes && input.status !== "em_andamento" ? `: ${conclusao.notes}` : "."}` });
        }
      }
      return { success: true, pointsAwarded: novosPontos, pendingApproval: pesoAnomalo };
    }),
    listarPendentesAprovacao: administratorOnly.query(async ({ ctx }) => {
      const db = await getDb();
      const registros = await db.select().from(coletas).where(and(eq(coletas.condominioId, ctx.eco.condominio.id), eq(coletas.pendenteAprovacaoPeso, true))).orderBy(desc(coletas.concluidaEm));
      const moradorIds = Array.from(new Set(registros.map((registro) => registro.moradorId).filter((id): id is number => id !== null)));
      const moradoresRelacionados = moradorIds.length ? await db.select().from(moradores).where(eq(moradores.condominioId, ctx.eco.condominio.id)) : [];
      const origens = await origensDosRegistros(ctx.eco.condominio.id, registros);
      return registros.map((registro) => ({
        ...registro,
        pontosCalculados: calculateCollectionPoints(registro.status, registro.tipoResiduo, registro.pesoGramas),
        residentName: moradoresRelacionados.find((morador) => morador.id === registro.moradorId)?.nome ?? null,
        origin: origens(registro),
      }));
    }),
    /** Decide um registro pendente: aprovar libera os pontos; reprovar exige motivo e cancela os pontos pendentes. */
    decidirAprovacaoPeso: administratorOnly.input(z.object({
      id: z.number().int().positive(),
      aprovar: z.boolean(),
      observacao: z.string().trim().max(500).nullable().optional(),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const coleta = await coletaDoCondominio(ctx.eco.condominio.id, input.id);
      if (!coleta.pendenteAprovacaoPeso) throw new TRPCError({ code: "BAD_REQUEST", message: "Esta coleta não está pendente de aprovação." });
      if ((coleta.concluidoPorId ?? coleta.coletorId) === ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Quem concluiu a coleta não pode ser quem aprova o peso suspeito. Peça para outro administrador revisar." });
      }
      if (!input.aprovar) {
        if (!input.observacao || input.observacao.length < 5) throw new TRPCError({ code: "BAD_REQUEST", message: "Informe o motivo da reprovação (pelo menos 5 letras); ele é enviado ao morador." });
        return reprovarColeta(ctx, coleta, input.observacao);
      }

      const pontos = calculateCollectionPoints(coleta.status, coleta.tipoResiduo, coleta.pesoGramas);
      const agora = new Date();
      await db.transaction(async (tx) => {
        const [alteracao] = await tx.update(coletas).set({
          pendenteAprovacaoPeso: false,
          aprovacaoPesoStatus: "aprovado",
          aprovacaoPesoPorId: ctx.user.id,
          aprovacaoPesoEm: agora,
          motivoDecisao: input.observacao || null,
          pontosConcedidos: pontos,
          atualizadoEm: agora,
        }).where(and(eq(coletas.id, coleta.id), eq(coletas.pendenteAprovacaoPeso, true)));
        if (!alteracao.affectedRows) throw new TRPCError({ code: "CONFLICT", message: "Outro administrador já decidiu este registro." });
        if (coleta.moradorId && pontos > 0) {
          await movimentarPontos(tx, { condominioId: coleta.condominioId, moradorId: coleta.moradorId, tipo: "credito_coleta", pontos, coletaId: coleta.id, autorId: ctx.user.id, descricao: `Coleta nº ${coleta.id} aprovada na revisão (${formatarKg(coleta.pesoGramas)} kg)` });
        }
      }).catch(converterDuplicidade);

      await writeAuditLog(db, {
        condominioId: ctx.eco.condominio.id,
        autorId: ctx.user.id,
        tipoEntidade: "coleta",
        entidadeId: coleta.id,
        acao: "peso_suspeito_aprovado",
        resumo: coleta.estacaoId !== null
          ? `Registro da estação conferido e aprovado pela administração; ${pontos} ponto(s) liberado(s).`
          : `Peso suspeito aprovado por segundo administrador; ${pontos} ponto(s) liberado(s).`,
        estadoAnterior: { aprovacaoPesoStatus: "pendente", pontosConcedidos: 0, pontosPendentes: pontos },
        estadoNovo: { aprovacaoPesoStatus: "aprovado", pontosConcedidos: pontos, efeitoPontos: pontos ? `${pontos} ponto(s) creditado(s)` : "sem pontos (material não reciclável ou menos de 1 kg)" },
        motivo: input.observacao || null,
      });

      const usuarioMorador = await usuarioDoMorador(coleta.moradorId);
      const base = { condominioId: ctx.eco.condominio.id, coletaId: coleta.id };
      await notificarUsuario(db, usuarioMorador, { ...base, tipo: "revisao_administrativa", titulo: "Registro aprovado na revisão", mensagem: `A administração conferiu e aprovou a coleta nº ${coleta.id} (${formatarKg(coleta.pesoGramas)} kg).${input.observacao ? ` Observação: ${input.observacao}` : ""}` });
      if (pontos > 0) await notificarUsuario(db, usuarioMorador, { ...base, tipo: "pontos_ganhos", titulo: `+${pontos} ponto(s)`, mensagem: `${pontos} ponto(s) da coleta nº ${coleta.id} foram creditados depois da revisão.` });
      return { success: true, pointsAwarded: pontos };
    }),
    /**
     * Reprova uma coleta concluída (pendente ou já aprovada), com motivo obrigatório. Pontos pendentes são cancelados;
     * pontos já lançados são estornados do saldo (que pode ficar negativo se o morador já os gastou).
     */
    reprovar: administratorOnly.input(z.object({
      id: z.number().int().positive(),
      motivo: z.string().trim().min(5, "Informe o motivo da reprovação (pelo menos 5 letras).").max(500),
    })).mutation(async ({ ctx, input }) => {
      const coleta = await coletaDoCondominio(ctx.eco.condominio.id, input.id);
      if (coleta.pendenteAprovacaoPeso && (coleta.concluidoPorId ?? coleta.coletorId) === ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Quem concluiu a coleta não pode decidir a revisão dela. Peça para outro administrador revisar." });
      }
      return reprovarColeta(ctx, coleta, input.motivo);
    }),
  }),
});

type ContextoAdministrador = { user: { id: number }; eco: { condominio: { id: number } } };

async function coletaDoCondominio(condominioId: number, id: number) {
  const db = await getDb();
  const encontrada = await db.select().from(coletas).where(and(eq(coletas.id, id), eq(coletas.condominioId, condominioId))).limit(1);
  if (!encontrada[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Coleta não encontrada." });
  return encontrada[0];
}

async function usuarioDoMorador(moradorId: number | null) {
  if (!moradorId) return null;
  const db = await getDb();
  const encontrado = await db.select({ usuarioId: moradores.usuarioId }).from(moradores).where(eq(moradores.id, moradorId)).limit(1);
  return encontrado[0]?.usuarioId ?? null;
}

function formatarKg(pesoGramas: number | null) {
  return ((pesoGramas ?? 0) / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function dataHoraCurta(data: Date) {
  return data.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
}

/** O índice único do extrato recusou pontuar a mesma coleta duas vezes: vira um erro legível na tela. */
function converterDuplicidade(error: unknown): never {
  if (error instanceof MovimentacaoDuplicadaError) throw new TRPCError({ code: "CONFLICT", message: "Os pontos desta coleta já foram lançados." });
  throw error;
}

async function reprovarColeta(ctx: ContextoAdministrador, coleta: Coleta, motivo: string) {
  if (coleta.status !== "concluida") throw new TRPCError({ code: "BAD_REQUEST", message: "Só coletas concluídas podem ser reprovadas. Para uma coleta ainda não feita, use Cancelar." });
  if (coleta.aprovacaoPesoStatus === "rejeitado") throw new TRPCError({ code: "BAD_REQUEST", message: "Esta coleta já foi reprovada." });
  const db = await getDb();
  const agora = new Date();
  const eraPendente = coleta.pendenteAprovacaoPeso;
  const pontosPendentes = eraPendente ? calculateCollectionPoints(coleta.status, coleta.tipoResiduo, coleta.pesoGramas) : 0;
  const pontosEstornados = coleta.pontosConcedidos;
  await db.transaction(async (tx) => {
    const [alteracao] = await tx.update(coletas).set({
      pendenteAprovacaoPeso: false,
      aprovacaoPesoStatus: "rejeitado",
      aprovacaoPesoPorId: ctx.user.id,
      aprovacaoPesoEm: agora,
      motivoDecisao: motivo,
      pontosConcedidos: 0,
      atualizadoEm: agora,
    }).where(and(eq(coletas.id, coleta.id), eq(coletas.status, "concluida"), or(isNull(coletas.aprovacaoPesoStatus), ne(coletas.aprovacaoPesoStatus, "rejeitado"))));
    if (!alteracao.affectedRows) throw new TRPCError({ code: "CONFLICT", message: "Esta coleta já foi reprovada por outro administrador." });
    if (coleta.moradorId && pontosEstornados > 0) {
      await movimentarPontos(tx, { condominioId: coleta.condominioId, moradorId: coleta.moradorId, tipo: "estorno_coleta", pontos: -pontosEstornados, coletaId: coleta.id, autorId: ctx.user.id, descricao: `Estorno: coleta nº ${coleta.id} reprovada (${motivo})` });
    }
  }).catch((error: unknown) => {
    if (error instanceof MovimentacaoDuplicadaError) throw new TRPCError({ code: "CONFLICT", message: "Os pontos desta coleta já foram estornados." });
    throw error;
  });

  const efeito = pontosEstornados > 0 ? `${pontosEstornados} ponto(s) estornado(s)` : pontosPendentes > 0 ? `${pontosPendentes} ponto(s) pendente(s) cancelado(s)` : "nenhum ponto envolvido";
  await writeAuditLog(db, {
    condominioId: coleta.condominioId,
    autorId: ctx.user.id,
    tipoEntidade: "coleta",
    entidadeId: coleta.id,
    acao: eraPendente ? "peso_suspeito_rejeitado" : "coleta_reprovada",
    resumo: `Coleta nº ${coleta.id} reprovada pela administração; ${efeito}.`,
    estadoAnterior: { status: coleta.status, pesoGramas: coleta.pesoGramas, aprovacaoPesoStatus: coleta.aprovacaoPesoStatus, pendenteAprovacaoPeso: eraPendente, pontosConcedidos: coleta.pontosConcedidos },
    estadoNovo: { status: coleta.status, aprovacaoPesoStatus: "rejeitado", pontosConcedidos: 0, pontosEstornados, pontosPendentesCancelados: pontosPendentes, efeitoPontos: efeito, reprovadaEm: agora },
    motivo,
  });

  const usuarioMorador = await usuarioDoMorador(coleta.moradorId);
  const base = { condominioId: coleta.condominioId, coletaId: coleta.id };
  await notificarUsuario(db, usuarioMorador, { ...base, tipo: "coleta_reprovada", titulo: "Coleta reprovada", mensagem: `A administração reprovou a coleta nº ${coleta.id} (${formatarKg(coleta.pesoGramas)} kg). Motivo: ${motivo}` });
  if (pontosEstornados > 0 || pontosPendentes > 0) {
    await notificarUsuario(db, usuarioMorador, { ...base, tipo: "pontos_estornados", titulo: pontosEstornados > 0 ? `-${pontosEstornados} ponto(s) estornado(s)` : "Pontos pendentes cancelados", mensagem: pontosEstornados > 0 ? `Os ${pontosEstornados} ponto(s) da coleta nº ${coleta.id} foram retirados do seu saldo porque o registro foi reprovado.` : `Os ${pontosPendentes} ponto(s) pendente(s) da coleta nº ${coleta.id} não serão creditados porque o registro foi reprovado.` });
  }
  await notificarAdministradores(db, { ...base, tipo: "coleta_reprovada", titulo: "Coleta reprovada", mensagem: `A coleta nº ${coleta.id} (bloco ${coleta.bloco}) foi reprovada: ${motivo}. Efeito: ${efeito}.` }, ctx.user.id);
  return { success: true, pointsAwarded: 0, pointsReversed: pontosEstornados, pendingPointsCancelled: pontosPendentes };
}

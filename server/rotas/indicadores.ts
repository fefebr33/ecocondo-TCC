import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { and, asc, desc, eq, gte, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { coletas, guiasDescarte, notificacoesLidas, notificacoes, moradores, recompensas, resgates, perfisAcesso, usuarios, tiposResiduo } from "../../drizzle/schema";
import { getDb } from "../db";
import { administratorOnly, withProfile } from "./nucleo";
import { router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { countUnreadNotifications } from "../dominio/regrasNotificacao";
import { buildCollectionsCsv } from "../dominio/exportacaoCsv";

const periodInput = z.object({ startDate: z.date().optional(), endDate: z.date().optional() }).optional();
const csvFiltersInput = z.object({
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  block: z.string().trim().min(1).max(32).optional(),
  wasteType: z.enum(tiposResiduo).optional(),
}).optional();

function condicoesPeriodo(condominioId: number, periodo?: { startDate?: Date; endDate?: Date }) {
  const condicoes = [eq(coletas.condominioId, condominioId)];
  if (periodo?.startDate) condicoes.push(gte(coletas.agendadaPara, periodo.startDate));
  if (periodo?.endDate) condicoes.push(lte(coletas.agendadaPara, periodo.endDate));
  return condicoes;
}

function condicoesCsv(condominioId: number, filtros?: { startDate?: Date; endDate?: Date; block?: string; wasteType?: (typeof tiposResiduo)[number] }) {
  const condicoes = condicoesPeriodo(condominioId, filtros);
  if (filtros?.block) condicoes.push(eq(coletas.bloco, filtros.block));
  if (filtros?.wasteType) condicoes.push(eq(coletas.tipoResiduo, filtros.wasteType));
  return condicoes;
}

function resumir(registros: Array<typeof coletas.$inferSelect>) {
  const concluidas = registros.filter((registro) => registro.status === "concluida");
  const totalGramas = concluidas.reduce((soma, registro) => soma + (registro.pesoGramas ?? 0), 0);
  const gramasReciclaveis = concluidas.filter((registro) => registro.tipoResiduo === "reciclavel").reduce((soma, registro) => soma + (registro.pesoGramas ?? 0), 0);
  const totalKg = totalGramas / 1000;
  const reciclavelKg = gramasReciclaveis / 1000;
  const taxaReciclagem = totalGramas > 0 ? Number(((gramasReciclaveis / totalGramas) * 100).toFixed(1)) : null;
  const co2EstimadoKg = Number((reciclavelKg * 0.75).toFixed(1));
  const porTipoResiduo = ["reciclavel", "organico", "rejeito", "eletronico", "perigoso"].map((tipoResiduo) => ({
    wasteType: tipoResiduo,
    kilograms: Number((concluidas.filter((registro) => registro.tipoResiduo === tipoResiduo).reduce((soma, registro) => soma + (registro.pesoGramas ?? 0), 0) / 1000).toFixed(2)),
  }));
  return { totalKg: Number(totalKg.toFixed(2)), recyclableKg: Number(reciclavelKg.toFixed(2)), recyclingRate: taxaReciclagem, co2EstimateKg: co2EstimadoKg, completedCount: concluidas.length, occurrenceCount: registros.filter((registro) => registro.status === "ocorrencia").length, byWasteType: porTipoResiduo };
}

const guiasPadrao = [
  { tipoResiduo: "reciclavel", titulo: "Recicláveis", itensAceitos: "Papel, plástico, metal e vidro limpos e secos.", itensRejeitados: "Embalagens com resíduos de alimento, papel higiênico e espelhos.", instrucoes: "Esvazie, limpe quando necessário e mantenha os materiais secos antes do descarte." },
  { tipoResiduo: "organico", titulo: "Orgânicos", itensAceitos: "Restos de frutas, legumes, folhas e borra de café.", itensRejeitados: "Pilhas, plásticos, metais e produtos químicos.", instrucoes: "Acondicione em recipiente fechado; quando houver compostagem, encaminhe os materiais adequados." },
  { tipoResiduo: "rejeito", titulo: "Rejeitos", itensAceitos: "Materiais sem possibilidade de reciclagem ou reaproveitamento no fluxo local.", itensRejeitados: "Eletrônicos, pilhas, baterias e lâmpadas.", instrucoes: "Descarte apenas materiais que não possam ser direcionados às demais categorias." },
  { tipoResiduo: "eletronico", titulo: "Eletrônicos", itensAceitos: "Cabos, carregadores, celulares, periféricos e pequenos eletroeletrônicos.", itensRejeitados: "Resíduos orgânicos e materiais comuns.", instrucoes: "Não descarte com recicláveis convencionais. Use ponto de recebimento ou coleta especializada." },
  { tipoResiduo: "perigoso", titulo: "Resíduos perigosos", itensAceitos: "Pilhas, baterias, lâmpadas, tintas e produtos químicos domésticos.", itensRejeitados: "Materiais recicláveis ou orgânicos.", instrucoes: "Mantenha a embalagem identificada e procure os canais de logística reversa adequados." },
] as const;

export const analyticsRouter = router({
  dashboard: router({
    resumo: withProfile.query(async ({ ctx }) => {
      const db = await getDb();
      const registros = await db.select().from(coletas).where(and(...condicoesPeriodo(ctx.eco.condominio.id))).orderBy(desc(coletas.agendadaPara));
      const registrosPermitidos = ctx.eco.perfil.papel === "morador" && ctx.eco.morador ? registros.filter((registro) => registro.moradorId === ctx.eco.morador?.id) : registros;
      return { ...resumir(registrosPermitidos), recent: registrosPermitidos.slice(0, 5) };
    }),
  }),
  relatorios: router({
    visaoGeral: administratorOnly.input(periodInput).query(async ({ ctx, input }) => {
      const db = await getDb();
      const registros = await db.select().from(coletas).where(and(...condicoesPeriodo(ctx.eco.condominio.id, input))).orderBy(desc(coletas.agendadaPara));
      const comunidade = await db.select().from(moradores).where(eq(moradores.condominioId, ctx.eco.condominio.id));
      const ranking = [...comunidade].sort((a, b) => b.pontos - a.pontos).slice(0, 10).map((morador, indice) => ({ position: indice + 1, id: morador.id, name: morador.nome, block: morador.bloco, points: morador.pontos }));
      const participantes = new Set(registros.filter((registro) => registro.status === "concluida" && registro.moradorId !== null).map((registro) => registro.moradorId));
      return { ...resumir(registros), ranking, participationRate: comunidade.length ? Number(((participantes.size / comunidade.length) * 100).toFixed(1)) : null, residentsCount: comunidade.length, period: input ?? {} };
    }),
    exportarPdf: administratorOnly.input(periodInput).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const registros = await db.select().from(coletas).where(and(...condicoesPeriodo(ctx.eco.condominio.id, input))).orderBy(desc(coletas.agendadaPara));
      const relatorio = resumir(registros);
      const pdf = await PDFDocument.create();
      const pagina = pdf.addPage([595, 842]);
      const fonte = await pdf.embedFont(StandardFonts.Helvetica);
      const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
      const desenhar = (texto: string, x: number, y: number, tamanho = 11, ehNegrito = false, cor = rgb(0.12, 0.18, 0.15)) => pagina.drawText(texto, { x, y, size: tamanho, font: ehNegrito ? negrito : fonte, color: cor });
      desenhar("EcoCondo", 48, 790, 23, true, rgb(0.04, 0.39, 0.25));
      desenhar("Relatório de gestão de coleta seletiva", 48, 765, 14, true);
      desenhar(`Condomínio: ${ctx.eco.condominio.nome}`, 48, 735);
      desenhar(`Período: ${input?.startDate ? input.startDate.toLocaleDateString("pt-BR") : "início"} a ${input?.endDate ? input.endDate.toLocaleDateString("pt-BR") : "atual"}`, 48, 715);
      const linhas = [
        ["Total coletado", `${relatorio.totalKg.toLocaleString("pt-BR")} kg`],
        ["Recicláveis", `${relatorio.recyclableKg.toLocaleString("pt-BR")} kg`],
        ["Taxa de reciclagem", relatorio.recyclingRate === null ? "Sem dados" : `${relatorio.recyclingRate}%`],
        ["Coletas concluídas", `${relatorio.completedCount}`],
        ["Ocorrências", `${relatorio.occurrenceCount}`],
        ["CO₂ evitado (estimativa)", `${relatorio.co2EstimateKg.toLocaleString("pt-BR")} kg CO₂e`],
      ];
      let y = 665;
      linhas.forEach(([rotulo, valor]) => { desenhar(rotulo, 54, y, 11); desenhar(valor, 350, y, 11, true, rgb(0.04, 0.39, 0.25)); y -= 31; });
      desenhar("Composição por categoria", 48, y - 15, 13, true); y -= 48;
      relatorio.byWasteType.forEach((item) => { desenhar(`${item.wasteType}: ${item.kilograms.toLocaleString("pt-BR")} kg`, 54, y); y -= 23; });
      desenhar("Nota metodológica", 48, 180, 11, true);
      desenhar("A estimativa de CO₂ utiliza o fator configurável de 0,75 kg CO₂e por kg de reciclável.", 48, 162, 9);
      desenhar("Os dados devem ser interpretados como estimativas de apoio à gestão e à prestação de contas.", 48, 148, 9);
      desenhar(`Gerado em ${new Date().toLocaleString("pt-BR")}`, 48, 72, 9);
      const bytes = await pdf.save();
      return { filename: `relatorio-ecocondo-${new Date().toISOString().slice(0, 10)}.pdf`, contentBase64: Buffer.from(bytes).toString("base64") };
    }),
    exportarCsv: administratorOnly.input(csvFiltersInput).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const registros = await db.select().from(coletas).where(and(...condicoesCsv(ctx.eco.condominio.id, input))).orderBy(desc(coletas.agendadaPara));
      const comunidade = await db.select().from(moradores).where(eq(moradores.condominioId, ctx.eco.condominio.id));
      const perfisColetor = await db.select({ usuarioId: perfisAcesso.usuarioId, nome: usuarios.nome }).from(perfisAcesso).leftJoin(usuarios, eq(usuarios.id, perfisAcesso.usuarioId)).where(eq(perfisAcesso.condominioId, ctx.eco.condominio.id));
      const conteudo = buildCollectionsCsv(registros.map((registro) => ({
        id: registro.id,
        status: registro.status,
        wasteType: registro.tipoResiduo,
        block: registro.bloco,
        scheduledAt: registro.agendadaPara,
        completedAt: registro.concluidaEm,
        weightGrams: registro.pesoGramas,
        pointsAwarded: registro.pontosConcedidos,
        notes: registro.observacoes,
        residentName: comunidade.find((morador) => morador.id === registro.moradorId)?.nome ?? null,
        collectorName: perfisColetor.find((perfil) => perfil.usuarioId === registro.coletorId)?.nome ?? null,
      })));
      return { filename: `coletas-ecocondo-${new Date().toISOString().slice(0, 10)}.csv`, content: conteudo };
    }),
  }),
  engajamento: router({
    ranking: withProfile.query(async ({ ctx }) => {
      const db = await getDb();
      const comunidade = await db.select().from(moradores).where(eq(moradores.condominioId, ctx.eco.condominio.id));
      return [...comunidade].sort((a, b) => b.pontos - a.pontos).map((morador, indice) => ({ position: indice + 1, ...morador }));
    }),
    recompensas: withProfile.query(async ({ ctx }) => {
      const db = await getDb();
      return db.select().from(recompensas).where(and(eq(recompensas.condominioId, ctx.eco.condominio.id), eq(recompensas.ativo, true))).orderBy(asc(recompensas.custoPontos));
    }),
    criarRecompensa: administratorOnly.input(z.object({ title: z.string().trim().min(3).max(140), description: z.string().trim().min(4).max(1000), pointsCost: z.number().int().min(1), stock: z.number().int().min(0).nullable() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const inserida = await db.insert(recompensas).values({ condominioId: ctx.eco.condominio.id, titulo: input.title, descricao: input.description, custoPontos: input.pointsCost, estoque: input.stock }).returning({ id: recompensas.id });
      return { id: inserida[0].id };
    }),
    resgatar: withProfile.input(z.object({ rewardId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (ctx.eco.perfil.papel !== "morador" || !ctx.eco.morador || ctx.eco.morador.status !== "ativo") throw new TRPCError({ code: "FORBIDDEN", message: "Apenas moradores ativos podem solicitar recompensas." });
      const encontrada = await db.select().from(recompensas).where(and(eq(recompensas.id, input.rewardId), eq(recompensas.condominioId, ctx.eco.condominio.id), eq(recompensas.ativo, true))).limit(1);
      const recompensa = encontrada[0];
      if (!recompensa) throw new TRPCError({ code: "NOT_FOUND", message: "Recompensa não encontrada." });
      if (recompensa.estoque !== null && recompensa.estoque <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Esta recompensa está sem estoque." });
      if (ctx.eco.morador.pontos < recompensa.custoPontos) throw new TRPCError({ code: "BAD_REQUEST", message: "Pontuação insuficiente para esta recompensa." });
      await db.insert(resgates).values({ condominioId: ctx.eco.condominio.id, moradorId: ctx.eco.morador.id, recompensaId: recompensa.id, pontosGastos: recompensa.custoPontos });
      await db.update(moradores).set({ pontos: ctx.eco.morador.pontos - recompensa.custoPontos, atualizadoEm: new Date() }).where(eq(moradores.id, ctx.eco.morador.id));
      if (recompensa.estoque !== null) await db.update(recompensas).set({ estoque: recompensa.estoque - 1, atualizadoEm: new Date() }).where(eq(recompensas.id, recompensa.id));
      return { success: true };
    }),
  }),
  notificacoes: router({
    listar: withProfile.query(async ({ ctx }) => {
      const db = await getDb();
      const linhas = await db.select({ notificacao: notificacoes, leitura: notificacoesLidas }).from(notificacoes).leftJoin(notificacoesLidas, and(eq(notificacoesLidas.notificacaoId, notificacoes.id), eq(notificacoesLidas.usuarioId, ctx.user.id))).where(and(eq(notificacoes.condominioId, ctx.eco.condominio.id), or(eq(notificacoes.destinatarioId, ctx.user.id), sql`${notificacoes.destinatarioId} IS NULL`))).orderBy(desc(notificacoes.criadoEm));
      return linhas.map(({ notificacao, leitura }) => ({ ...notificacao, lidaEm: leitura?.lidaEm ?? notificacao.lidaEm ?? null }));
    }),
    contagemNaoLidas: withProfile.query(async ({ ctx }) => {
      const db = await getDb();
      const linhas = await db.select({ notificacao: notificacoes, leitura: notificacoesLidas }).from(notificacoes).leftJoin(notificacoesLidas, and(eq(notificacoesLidas.notificacaoId, notificacoes.id), eq(notificacoesLidas.usuarioId, ctx.user.id))).where(and(eq(notificacoes.condominioId, ctx.eco.condominio.id), or(eq(notificacoes.destinatarioId, ctx.user.id), sql`${notificacoes.destinatarioId} IS NULL`)));
      return { count: countUnreadNotifications(linhas.map((linha) => linha.notificacao.id), ctx.user.id, linhas.flatMap((linha) => (linha.leitura || linha.notificacao.lidaEm ? [{ notificationId: linha.notificacao.id, userId: ctx.user.id }] : []))) };
    }),
    marcarLida: withProfile.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const visivel = await db.select().from(notificacoes).where(and(eq(notificacoes.id, input.id), eq(notificacoes.condominioId, ctx.eco.condominio.id), or(eq(notificacoes.destinatarioId, ctx.user.id), sql`${notificacoes.destinatarioId} IS NULL`))).limit(1);
      if (!visivel[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Notificação não encontrada." });
      await db.insert(notificacoesLidas).values({ notificacaoId: input.id, usuarioId: ctx.user.id }).onConflictDoUpdate({ target: [notificacoesLidas.notificacaoId, notificacoesLidas.usuarioId], set: { lidaEm: new Date() } });
      return { success: true };
    }),
    marcarTodasLidas: withProfile.mutation(async ({ ctx }) => {
      const db = await getDb();
      const visiveis = await db.select().from(notificacoes).where(and(eq(notificacoes.condominioId, ctx.eco.condominio.id), or(eq(notificacoes.destinatarioId, ctx.user.id), sql`${notificacoes.destinatarioId} IS NULL`)));
      for (const item of visiveis) await db.insert(notificacoesLidas).values({ notificacaoId: item.id, usuarioId: ctx.user.id }).onConflictDoUpdate({ target: [notificacoesLidas.notificacaoId, notificacoesLidas.usuarioId], set: { lidaEm: new Date() } });
      return { success: true };
    }),
    criarComunicado: administratorOnly.input(z.object({ title: z.string().trim().min(3).max(180), message: z.string().trim().min(3).max(2000) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const inserida = await db.insert(notificacoes).values({ condominioId: ctx.eco.condominio.id, destinatarioId: null, tipo: "comunicado", titulo: input.title, mensagem: input.message }).returning({ id: notificacoes.id });
      return { id: inserida[0].id };
    }),
  }),
  guias: router({
    listar: withProfile.query(async ({ ctx }) => {
      const db = await getDb();
      const armazenadas = await db.select().from(guiasDescarte).where(and(eq(guiasDescarte.condominioId, ctx.eco.condominio.id), eq(guiasDescarte.publicado, true))).orderBy(asc(guiasDescarte.tipoResiduo));
      return armazenadas.length ? armazenadas : guiasPadrao.map((guia, indice) => ({ id: -(indice + 1), condominioId: ctx.eco.condominio.id, publicado: true, atualizadoEm: new Date(), ...guia }));
    }),
  }),
});

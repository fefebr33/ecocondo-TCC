import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { certificadosSustentabilidade, coletas } from "../../drizzle/schema";
import { getDb } from "../db";
import { administratorOnly, withProfile } from "./nucleo";
import { router } from "../_core/trpc";
import { storagePut } from "../storage";
import { calcularTrimestre, trimestreAnterior } from "../dominio/trimestre";
import { calcularEquivalenciasAmbientais } from "../dominio/impactoAmbiental";
import { pesoConfirmadoGramas } from "../dominio/antifraude";

async function gerarPdfCertificado(condominioNome: string, bloco: string, rotuloTrimestre: string, kg: number) {
  const equivalencias = calcularEquivalenciasAmbientais(kg);
  const pdf = await PDFDocument.create();
  const pagina = pdf.addPage([595, 420]);
  const fonte = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  const desenhar = (texto: string, x: number, y: number, tamanho = 12, ehNegrito = false, cor = rgb(0.12, 0.18, 0.15)) =>
    pagina.drawText(texto, { x, y, size: tamanho, font: ehNegrito ? negrito : fonte, color: cor });

  pagina.drawRectangle({ x: 20, y: 20, width: 555, height: 380, borderColor: rgb(0.04, 0.39, 0.25), borderWidth: 2 });
  desenhar("Certificado de Sustentabilidade", 90, 340, 22, true, rgb(0.04, 0.39, 0.25));
  desenhar(condominioNome, 90, 305, 15, true);
  desenhar(`Bloco ${bloco} reciclou ${kg.toLocaleString("pt-BR")} kg neste trimestre (${rotuloTrimestre})`, 90, 275, 13);
  desenhar(`Equivalente a aproximadamente ${equivalencias.arvoresPoupadas} árvore(s) poupada(s),`, 90, 240, 11);
  desenhar(`${equivalencias.litrosAguaPoupados.toLocaleString("pt-BR")} litros de água e ${equivalencias.co2EvitadoKg.toLocaleString("pt-BR")} kg de CO2e evitados.`, 90, 224, 11);
  desenhar("Reconhecimento emitido automaticamente pelo sistema EcoCondo com base nas coletas registradas.", 90, 180, 9, false, rgb(0.35, 0.4, 0.38));
  desenhar(`Emitido em ${new Date().toLocaleDateString("pt-BR")}`, 90, 60, 9);
  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

export const certificatesRouter = router({
  certificados: router({
    listar: withProfile.query(async ({ ctx }) => {
      const db = await getDb();
      const condicoes = [eq(certificadosSustentabilidade.condominioId, ctx.eco.condominio.id)];
      if (ctx.eco.perfil.papel === "morador" && ctx.eco.morador) condicoes.push(eq(certificadosSustentabilidade.bloco, ctx.eco.morador.bloco));
      return db.select().from(certificadosSustentabilidade).where(and(...condicoes)).orderBy(desc(certificadosSustentabilidade.geradoEm));
    }),
    gerarTrimestral: administratorOnly.input(z.object({
      block: z.string().trim().min(1).max(32),
      useCurrentQuarter: z.boolean().default(false),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const { rotulo, inicio, fim } = input.useCurrentQuarter ? calcularTrimestre(new Date()) : trimestreAnterior(new Date());
      const registros = await db.select().from(coletas).where(and(
        eq(coletas.condominioId, ctx.eco.condominio.id),
        eq(coletas.bloco, input.block),
        eq(coletas.status, "concluida"),
        gte(coletas.concluidaEm, inicio),
        lte(coletas.concluidaEm, fim),
      ));
      const gramas = registros.reduce((soma, registro) => soma + (pesoConfirmadoGramas(registro) ?? 0), 0);
      const kg = Number((gramas / 1000).toFixed(1));
      if (kg <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Não há coletas concluídas suficientes neste bloco no trimestre selecionado." });

      const pdfBuffer = await gerarPdfCertificado(ctx.eco.condominio.nome, input.block, rotulo, kg);
      const arquivo = await storagePut(`certificados/${ctx.eco.condominio.id}/${input.block}-${rotulo}.pdf`, pdfBuffer, "application/pdf");

      const existente = await db.select().from(certificadosSustentabilidade).where(and(
        eq(certificadosSustentabilidade.condominioId, ctx.eco.condominio.id),
        eq(certificadosSustentabilidade.bloco, input.block),
        eq(certificadosSustentabilidade.trimestre, rotulo),
      )).limit(1);

      if (existente[0]) {
        await db.update(certificadosSustentabilidade).set({ pesoKg: kg, chaveArquivo: arquivo.key, urlArquivo: arquivo.url, geradoPorId: ctx.user.id, geradoEm: new Date() }).where(eq(certificadosSustentabilidade.id, existente[0].id));
        return { id: existente[0].id, url: arquivo.url };
      }
      const inserido = await db.insert(certificadosSustentabilidade).values({
        condominioId: ctx.eco.condominio.id,
        bloco: input.block,
        trimestre: rotulo,
        pesoKg: kg,
        chaveArquivo: arquivo.key,
        urlArquivo: arquivo.url,
        geradoPorId: ctx.user.id,
      }).returning({ id: certificadosSustentabilidade.id });
      return { id: inserido[0].id, url: arquivo.url };
    }),
  }),
});

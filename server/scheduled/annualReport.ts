import type { Request, Response } from "express";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { and, eq, gte, lte } from "drizzle-orm";
import { coletas, condominios, notificacoes, perfisAcesso, relatoriosAnuais } from "../../drizzle/schema";
import { getDb } from "../db";
import { storagePut } from "../storage";
import { calcularEquivalenciasAmbientais } from "../dominio/impactoAmbiental";
import { pesoConfirmadoGramas } from "../dominio/antifraude";
import { exigirAdministrador } from "../_core/acesso";

async function gerarPdfRelatorioAnual(condominioNome: string, ano: number, totalKg: number, reciclavelKg: number, coletasConcluidas: number) {
  const equivalencias = calcularEquivalenciasAmbientais(reciclavelKg);
  const pdf = await PDFDocument.create();
  const pagina = pdf.addPage([595, 842]);
  const fonte = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  const desenhar = (texto: string, x: number, y: number, tamanho = 11, ehNegrito = false, cor = rgb(0.12, 0.18, 0.15)) =>
    pagina.drawText(texto, { x, y, size: tamanho, font: ehNegrito ? negrito : fonte, color: cor });
  desenhar("EcoCondo", 48, 790, 23, true, rgb(0.04, 0.39, 0.25));
  desenhar(`Relatório anual de sustentabilidade — ${ano}`, 48, 765, 14, true);
  desenhar(`Condomínio: ${condominioNome}`, 48, 735);
  const linhas = [
    ["Total coletado no ano", `${totalKg.toLocaleString("pt-BR")} kg`],
    ["Recicláveis", `${reciclavelKg.toLocaleString("pt-BR")} kg`],
    ["Coletas concluídas", `${coletasConcluidas}`],
    ["Árvores poupadas (estimativa)", `${equivalencias.arvoresPoupadas}`],
    ["Água poupada (estimativa)", `${equivalencias.litrosAguaPoupados.toLocaleString("pt-BR")} litros`],
    ["CO2 evitado (estimativa)", `${equivalencias.co2EvitadoKg.toLocaleString("pt-BR")} kg CO2e`],
  ];
  let y = 690;
  linhas.forEach(([rotulo, valor]) => { desenhar(rotulo, 54, y, 11); desenhar(valor, 350, y, 11, true, rgb(0.04, 0.39, 0.25)); y -= 31; });
  desenhar("Relatório gerado automaticamente em janeiro, consolidando o ano anterior.", 48, 150, 9, false, rgb(0.35, 0.4, 0.38));
  desenhar(`Gerado em ${new Date().toLocaleString("pt-BR")}`, 48, 72, 9);
  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

/** Gera (se ainda não existir) e notifica ao síndico o relatório anual consolidado do ano anterior, sempre que executado em janeiro. */
export async function runAnnualReport(dataReferencia = new Date()) {
  if (dataReferencia.getMonth() !== 0) return { skipped: true, reason: "fora-de-janeiro" as const };
  const ano = dataReferencia.getFullYear() - 1;
  const db = await getDb();
  const todosCondominios = await db.select().from(condominios);
  let gerados = 0;

  for (const condominio of todosCondominios) {
    const existente = await db.select().from(relatoriosAnuais).where(and(eq(relatoriosAnuais.condominioId, condominio.id), eq(relatoriosAnuais.ano, ano))).limit(1);
    if (existente[0]) continue;

    const inicio = new Date(ano, 0, 1, 0, 0, 0);
    const fim = new Date(ano, 11, 31, 23, 59, 59);
    const registros = await db.select().from(coletas).where(and(eq(coletas.condominioId, condominio.id), eq(coletas.status, "concluida"), gte(coletas.concluidaEm, inicio), lte(coletas.concluidaEm, fim)));
    const totalGramas = registros.reduce((soma, registro) => soma + (pesoConfirmadoGramas(registro) ?? 0), 0);
    const gramasReciclaveis = registros.filter((registro) => registro.tipoResiduo === "reciclavel").reduce((soma, registro) => soma + (pesoConfirmadoGramas(registro) ?? 0), 0);
    const totalKg = Number((totalGramas / 1000).toFixed(1));
    const reciclavelKg = Number((gramasReciclaveis / 1000).toFixed(1));

    const pdfBuffer = await gerarPdfRelatorioAnual(condominio.nome, ano, totalKg, reciclavelKg, registros.length);
    const arquivo = await storagePut(`relatorios-anuais/${condominio.id}/${ano}.pdf`, pdfBuffer, "application/pdf");
    await db.insert(relatoriosAnuais).values({ condominioId: condominio.id, ano, chaveArquivo: arquivo.key, urlArquivo: arquivo.url });

    const administradores = await db.select({ usuarioId: perfisAcesso.usuarioId }).from(perfisAcesso).where(and(eq(perfisAcesso.condominioId, condominio.id), eq(perfisAcesso.papel, "administrador")));
    for (const admin of administradores) {
      await db.insert(notificacoes).values({
        condominioId: condominio.id,
        destinatarioId: admin.usuarioId,
        tipo: "relatorio_anual",
        titulo: `Relatório anual ${ano} disponível`,
        mensagem: `O relatório consolidado de sustentabilidade de ${ano} foi gerado automaticamente e já está disponível para download.`,
      });
    }
    gerados += 1;
  }

  return { skipped: false, ano, reportsGenerated: gerados };
}

/** Endpoint manual para forçar a verificação/geração do relatório anual. */
export async function sendAnnualReportCheck(req: Request, res: Response) {
  try {
    if (!(await exigirAdministrador(req, res))) return;
    const resultado = await runAnnualReport();
    return res.json({ ok: true, ...resultado });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "annual-report-failed", timestamp: new Date().toISOString() });
  }
}

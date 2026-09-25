/**
 * Popula o banco MySQL com dados de demonstração (pnpm db:seed), passando pelas mesmas rotas e regras do sistema.
 * Use `pnpm db:seed --limpar` para apagar e recriar o banco (e as fotos enviadas) antes.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { coletas } from "../../drizzle/schema";
import type { Usuario } from "../../drizzle/schema";
import { fecharDb, getDb, prepararBanco } from "../db";
import { appRouter } from "../rotas";
import type { TrpcContext } from "../_core/context";
import { garantirContaDemonstracao } from "../_core/login";

const pastaUploads = path.resolve("data", "uploads");
const FOTO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function limparUploads() {
  try {
    fs.rmSync(pastaUploads, { recursive: true, force: true });
  } catch (error) {
    console.error("Não foi possível apagar as fotos enviadas. Feche o servidor (pnpm dev) e tente de novo.");
    throw error;
  }
}

/** Sorteio com semente fixa: os mesmos dados a cada execução. */
function sorteador(semente: number) {
  return () => {
    semente = (semente + 0x6d2b79f5) | 0;
    let t = Math.imul(semente ^ (semente >>> 15), 1 | semente);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sortear = sorteador(2026);
const entre = (minimo: number, maximo: number) => Math.floor(minimo + sortear() * (maximo - minimo + 1));

function chamador(usuario: Usuario) {
  return appRouter.createCaller({ user: usuario, req: { protocol: "https", headers: {} }, res: { clearCookie() {}, cookie() {} } } as unknown as TrpcContext);
}

async function main() {
  const limpar = process.argv.includes("--limpar");
  if (limpar) limparUploads();
  await prepararBanco({ recriar: limpar });
  const db = await getDb();

  const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(coletas);
  if (Number(total) > 0) {
    console.log("O banco já tem coletas cadastradas. Para recomeçar do zero, rode: pnpm db:seed --limpar");
    return;
  }

  const usuarioAdmin = await garantirContaDemonstracao("administrador");
  const usuarioColetor = await garantirContaDemonstracao("coletor");
  const usuarioMorador = await garantirContaDemonstracao("morador");
  if (!usuarioAdmin || !usuarioColetor || !usuarioMorador) throw new Error("Não foi possível criar as contas de demonstração.");
  const admin = chamador(usuarioAdmin);
  const coletor = chamador(usuarioColetor);
  const morador = chamador(usuarioMorador);

  await admin.condominio.atualizar({ name: "Condomínio Parque das Flores", address: "Rua das Palmeiras, 250", city: "São Paulo", state: "SP", blockCount: 4 });
  const vizinhos = [
    ["João Pereira", "joao@parquedasflores.com", "A", "102"],
    ["Beatriz Lima", "beatriz@parquedasflores.com", "B", "201"],
    ["Rafael Souza", "rafael@parquedasflores.com", "B", "204"],
    ["Camila Rocha", "camila@parquedasflores.com", "C", "301"],
    ["Pedro Almeida", "pedro@parquedasflores.com", "C", "305"],
    ["Luísa Martins", "luisa@parquedasflores.com", "D", "402"],
  ] as const;
  for (const [name, email, block, apartment] of vizinhos) {
    await admin.moradores.criar({ name, email, phone: `(11) 9${entre(1000, 9999)}-${entre(1000, 9999)}`, block, apartment });
  }
  const porNome = Object.fromEntries((await admin.moradores.listar()).map((item) => [item.nome, item]));

  const agora = new Date();
  const emHoras = (horas: number) => new Date(agora.getTime() + horas * 60 * 60 * 1000);

  /** Agenda e conclui pela API (regras antifraude valem) e depois move a coleta para a data histórica. */
  async function coletaConcluida(nome: string, tipo: "reciclavel" | "organico" | "eletronico", pesoGramas: number, data: Date | null) {
    const alvo = porNome[nome];
    const { id } = await admin.coletas.criar({ residentId: alvo.id, wasteType: tipo, block: alvo.bloco, scheduledAt: emHoras(1), collectorUserId: usuarioColetor!.id, notes: null });
    await coletor.coletas.atualizarStatus({ id, status: "concluida", weightGrams: pesoGramas, imageDataUrl: FOTO });
    if (data) await db.update(coletas).set({ agendadaPara: data, concluidaEm: data, criadoEm: data, atualizadoEm: data }).where(eq(coletas.id, id));
  }

  // Histórico dos últimos cinco meses e do mês atual: alimenta relatórios, metas, pódio e certificados.
  const participantes: Array<[string, number]> = [
    ["Marina Moradora", 3], ["Beatriz Lima", 3], ["Camila Rocha", 2], ["João Pereira", 2], ["Rafael Souza", 1], ["Luísa Martins", 2], ["Pedro Almeida", 1],
  ];
  for (let mesesAtras = 5; mesesAtras >= 0; mesesAtras -= 1) {
    const ultimoDia = mesesAtras === 0 ? agora.getDate() - 1 : new Date(agora.getFullYear(), agora.getMonth() - mesesAtras + 1, 0).getDate();
    if (ultimoDia < 1) continue;
    for (const [nome, frequencia] of participantes) {
      const quantidade = Math.max(0, frequencia - (sortear() < 0.3 ? 1 : 0));
      for (let vez = 0; vez < quantidade; vez += 1) {
        const data = new Date(agora.getFullYear(), agora.getMonth() - mesesAtras, entre(1, ultimoDia), entre(8, 17), entre(0, 59));
        // Entre 3 e 8,5 kg: nenhum lançamento histórico passa de 3× a média e vira peso suspeito por acaso.
        await coletaConcluida(nome, "reciclavel", entre(30, 85) * 100, data);
      }
    }
    await coletaConcluida("Rafael Souza", "organico", entre(40, 90) * 100, new Date(agora.getFullYear(), agora.getMonth() - mesesAtras, Math.min(ultimoDia, 12), 9, 30));
  }
  await coletaConcluida("Pedro Almeida", "eletronico", 1800, null);
  await coletaConcluida("Beatriz Lima", "reciclavel", 6400, null);

  // Um peso muito acima do histórico: fica aguardando a aprovação de um segundo administrador.
  await coletaConcluida("Luísa Martins", "reciclavel", 26000, null);

  // Próximas coletas, uma em andamento, uma cancelada e um pedido do próprio morador.
  const futuras: Array<[string | null, "reciclavel" | "organico" | "perigoso", number, string?]> = [
    ["Marina Moradora", "reciclavel", 26], ["Camila Rocha", "organico", 30], ["Rafael Souza", "reciclavel", 50], ["Pedro Almeida", "perigoso", 74], [null, "reciclavel", 98, "B"],
  ];
  const idsFuturas: number[] = [];
  for (const [nome, tipo, horas, bloco] of futuras) {
    const alvo = nome ? porNome[nome] : null;
    const { id } = await admin.coletas.criar({ residentId: alvo?.id ?? null, wasteType: tipo, block: alvo?.bloco ?? bloco!, scheduledAt: emHoras(horas), collectorUserId: usuarioColetor.id, notes: alvo ? null : "Coleta coletiva do bloco" });
    idsFuturas.push(id);
  }
  await coletor.coletas.atualizarStatus({ id: idsFuturas[1], status: "em_andamento" });
  await admin.coletas.atualizarStatus({ id: idsFuturas[3], status: "cancelada", notes: "Morador em viagem" });
  await morador.coletas.criar({ wasteType: "eletronico", block: "A", scheduledAt: emHoras(52), notes: "Monitor antigo e cabos" });

  // Recorrência, metas, recompensas e resgates.
  await admin.recorrencias.criar({ block: "B", wasteType: "reciclavel", weekday: 2, time: "08:00" });
  await admin.recorrencias.criar({ block: "C", wasteType: "organico", weekday: 5, time: "07:30" });
  const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
  const fimMes = new Date(agora.getFullYear(), agora.getMonth() + 1, 0, 23, 59);
  await admin.metas.criar({ block: "A", title: "Bloco A: 40 kg de recicláveis", targetKg: 40, startDate: inicioMes, endDate: fimMes });
  await admin.metas.criar({ block: "B", title: "Bloco B: 30 kg de recicláveis", targetKg: 30, startDate: inicioMes, endDate: fimMes });
  await morador.metaPessoal.definir({ targetKg: 25, startDate: inicioMes, endDate: fimMes });
  const cafe = await admin.engajamento.criarRecompensa({ title: "Vale-café na padaria parceira", description: "Um café e um pão de queijo na Padaria Central.", pointsCost: 5, stock: 10 });
  const sacolas = await admin.engajamento.criarRecompensa({ title: "Kit sacolas retornáveis", description: "Três sacolas de algodão para compras.", pointsCost: 12, stock: 6 });
  await admin.engajamento.criarRecompensa({ title: "Muda de árvore nativa", description: "Muda de ipê ou pitanga para o jardim do condomínio.", pointsCost: 20, stock: null });
  await morador.engajamento.resgatar({ rewardId: sacolas.id });
  const [resgateSacolas] = await admin.engajamento.listarResgates();
  await admin.engajamento.atualizarResgate({ id: resgateSacolas.id, status: "entregue" });
  await morador.engajamento.resgatar({ rewardId: cafe.id });

  // Pódio: percentuais sugeridos e o desconto do campeão do mês passado já registrado.
  await admin.podio.configurarDescontos({ mensal: 5, semestral: 10, anual: 15 });
  const mesPassado = new Date(agora.getFullYear(), agora.getMonth() - 1, 15);
  const podioMesPassado = await admin.podio.ranking({ periodo: "mensal", dataReferencia: mesPassado });
  const campeao = podioMesPassado.ranking[0];
  if (campeao) await admin.podio.marcarDescontoAplicado({ moradorId: campeao.moradorId, periodo: "mensal", dataReferencia: mesPassado, percentual: 5, observacao: "Aplicado no boleto do mês seguinte." });

  // Certificados do trimestre anterior para os blocos com coletas.
  for (const bloco of ["A", "B", "C"]) {
    await admin.certificados.gerarTrimestral({ block: bloco }).catch(() => undefined);
  }

  // Campanha, ocorrência, avaliação e comunicado.
  await admin.campanhas.criar({ title: "Mês sem plástico", description: "Um mês para reduzir descartáveis e separar corretamente os plásticos recicláveis.", targetDescription: "Todos os moradores", startDate: inicioMes, endDate: fimMes, status: "ativa" });
  const [campanha] = await morador.campanhas.listar();
  await morador.campanhas.participar({ campaignId: campanha.id });
  await morador.ocorrencias.criar({ block: "A", wasteType: "reciclavel", location: "Lixeira do térreo, bloco A", description: "Recicláveis misturados com restos de comida.", imageDataUrl: FOTO });
  await morador.avaliacoes.criar({ rating: 5, message: "Coleta pontual e coletor muito atencioso." });
  await admin.notificacoes.criarComunicado({ title: "Nova coleta de eletrônicos", message: "No sábado teremos coleta especial de eletrônicos no hall do bloco C, das 9h às 12h." });

  const [{ criadas }] = await db.select({ criadas: sql<number>`count(*)` }).from(coletas);
  console.log(`Dados de demonstração criados: ${criadas} coletas, ${vizinhos.length + 1} moradores. Rode pnpm dev e entre como Administrador, Coletor ou Morador.`);
}

main().then(fecharDb, (error) => {
  console.error(error);
  process.exit(1);
});

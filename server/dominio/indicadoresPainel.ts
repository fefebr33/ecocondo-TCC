/**
 * Cálculos do painel (dashboard) e dos relatórios, separados das rotas para poderem ser testados sem banco.
 * Todos usam o peso confirmado: registros pendentes de revisão ou reprovados não entram no peso.
 */
import { pesoConfirmadoGramas } from "./antifraude";

type RegistroColeta = {
  status: string;
  agendadaPara: Date;
  concluidaEm: Date | null;
  pesoGramas: number | null;
  pendenteAprovacaoPeso: boolean;
  aprovacaoPesoStatus: string | null;
};

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Data que vale para o registro: a da conclusão, se houver; senão, a do agendamento. */
function dataDoRegistro(registro: RegistroColeta) {
  return registro.concluidaEm ?? registro.agendadaPara;
}

function somarPeriodo(registros: RegistroColeta[], inicio: Date, fim: Date) {
  const concluidas = registros.filter((registro) => registro.status === "concluida" && dataDoRegistro(registro) >= inicio && dataDoRegistro(registro) < fim && registro.aprovacaoPesoStatus !== "rejeitado");
  const gramas = concluidas.reduce((soma, registro) => soma + (pesoConfirmadoGramas(registro) ?? 0), 0);
  return { coletas: concluidas.length, kg: Number((gramas / 1000).toFixed(2)) };
}

function variacao(atual: number, anterior: number) {
  if (anterior <= 0) return null;
  return Number((((atual - anterior) / anterior) * 100).toFixed(1));
}

/** Mês atual (até agora) comparado com o mês anterior inteiro. Sem dados no mês anterior, a variação fica nula. */
export function compararPeriodos(registros: RegistroColeta[], agora: Date) {
  const inicioAtual = new Date(agora.getFullYear(), agora.getMonth(), 1);
  const inicioAnterior = new Date(agora.getFullYear(), agora.getMonth() - 1, 1);
  const fimAtual = new Date(agora.getFullYear(), agora.getMonth() + 1, 1);
  const atual = somarPeriodo(registros, inicioAtual, fimAtual);
  const anterior = somarPeriodo(registros, inicioAnterior, inicioAtual);
  return {
    atual: { ...atual, rotulo: `${MESES[inicioAtual.getMonth()]}/${String(inicioAtual.getFullYear()).slice(2)}` },
    anterior: { ...anterior, rotulo: `${MESES[inicioAnterior.getMonth()]}/${String(inicioAnterior.getFullYear()).slice(2)}` },
    variacaoKg: variacao(atual.kg, anterior.kg),
    variacaoColetas: variacao(atual.coletas, anterior.coletas),
    temDadosAnteriores: anterior.coletas > 0,
  };
}

/** Coletas concluídas e peso confirmado de cada um dos últimos `meses` meses (o atual incluído), do mais antigo ao mais recente. */
export function evolucaoMensal(registros: RegistroColeta[], agora: Date, meses = 6) {
  return Array.from({ length: meses }, (_, indice) => {
    const inicio = new Date(agora.getFullYear(), agora.getMonth() - (meses - 1 - indice), 1);
    const fim = new Date(inicio.getFullYear(), inicio.getMonth() + 1, 1);
    return { mes: `${MESES[inicio.getMonth()]}/${String(inicio.getFullYear()).slice(2)}`, ...somarPeriodo(registros, inicio, fim) };
  });
}

/**
 * Taxa de conclusão: das coletas que já tiveram desfecho ou cuja data já chegou, quantas foram concluídas (sem reprovação).
 * Coletas futuras ainda abertas ficam de fora; atrasadas são as agendadas ou em andamento com a data já passada.
 */
export function taxaDeConclusao(registros: RegistroColeta[], agora: Date) {
  const vencidas = registros.filter((registro) => (registro.status !== "agendada" && registro.status !== "em_andamento") || registro.agendadaPara <= agora);
  const concluidas = vencidas.filter((registro) => registro.status === "concluida" && registro.aprovacaoPesoStatus !== "rejeitado").length;
  const reprovadas = vencidas.filter((registro) => registro.status === "concluida" && registro.aprovacaoPesoStatus === "rejeitado").length;
  const canceladas = vencidas.filter((registro) => registro.status === "cancelada").length;
  const ocorrencias = vencidas.filter((registro) => registro.status === "ocorrencia").length;
  const atrasadas = vencidas.filter((registro) => registro.status === "agendada" || registro.status === "em_andamento").length;
  return { percentual: vencidas.length ? Number(((concluidas / vencidas.length) * 100).toFixed(1)) : null, total: vencidas.length, concluidas, reprovadas, canceladas, ocorrencias, atrasadas };
}

/** Soma do extrato por tipo: pontos distribuídos (créditos), estornados, gastos em resgates e devolvidos. */
export function resumirPontos(movimentacoes: Array<{ tipo: string; pontos: number }>) {
  const somar = (tipo: string) => movimentacoes.filter((item) => item.tipo === tipo).reduce((soma, item) => soma + Math.abs(item.pontos), 0);
  const distribuidos = somar("credito_coleta");
  const estornados = somar("estorno_coleta");
  const resgatados = somar("resgate");
  const devolvidos = somar("devolucao_resgate");
  return { distribuidos, estornados, resgatados, devolvidos, movimentados: distribuidos + estornados + resgatados + devolvidos };
}

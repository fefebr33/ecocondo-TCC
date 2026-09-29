/**
 * Regras antifraude da estação de pesagem: um tablet com balança ao lado das lixeiras, onde o próprio morador
 * pesa e registra o descarte. Limites rígidos bloqueiam o registro; todo descarte registrado fica pendente até o
 * administrador conferir a foto do visor e o peso (os pontos só entram depois da aprovação), e os sinais de risco viram
 * alertas para essa conferência.
 */
import { createHash, randomBytes, randomInt } from "node:crypto";
import { LimiteAntifraudeExcedidoError, ehPesoAnomalo } from "./antifraude";

/** Peso mínimo de um descarte quando o tipo não tem regra própria (as regras de cada tipo ficam em Configurações). */
export const PESO_MINIMO_ESTACAO_GRAMAS = 100;
/** Um saco de recicláveis de um apartamento raramente passa disso (limite padrão por item, se o tipo não tiver regra). */
export const LIMITE_PESO_POR_REGISTRO_ESTACAO_GRAMAS = 30_000;
/** Soma máxima registrada por morador no mesmo dia. */
export const LIMITE_PESO_DIARIO_ESTACAO_GRAMAS = 40_000;
/** Quantidade máxima de descartes (idas à estação, cada uma com um ou vários tipos) por morador no mesmo dia. */
export const LIMITE_REGISTROS_DIARIOS_ESTACAO = 4;
/** Intervalo mínimo entre duas idas do mesmo morador à estação (impede pesar o mesmo saco várias vezes seguidas). */
export const INTERVALO_MINIMO_ENTRE_REGISTROS_MINUTOS = 10;
/** Tipos diferentes que cabem num mesmo descarte (um código, várias pesagens). */
export const MAXIMO_ITENS_POR_DESCARTE = 5;
/** Acima deste peso o item recebe um alerta para o administrador olhar com mais cuidado. */
export const PESO_REVISAO_OBRIGATORIA_GRAMAS = 10_000;
/** Validade do código temporário que o morador gera no app para se identificar no tablet. */
export const VALIDADE_CODIGO_ESTACAO_MINUTOS = 5;
/** Tentativas de código errado aceitas por tablet antes de bloqueá-lo por alguns minutos. */
export const LIMITE_TENTATIVAS_CODIGO = 8;
export const BLOQUEIO_TENTATIVAS_MINUTOS = 15;

type RegistroAnterior = { pesoGramas: number | null; concluidaEm: Date | null; lote?: string | null; id?: number };

export type ItemDescarte = {
  rotulo: string;
  pesoGramas: number;
  pesoMinimoGramas?: number;
  pesoMaximoGramas?: number;
  mediaHistoricaGramas: number;
};

const kg = (gramas: number) => (gramas / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/**
 * Confere um descarte (um ou vários tipos pesados com o mesmo código). Lança LimiteAntifraudeExcedidoError quando um
 * limite rígido é violado. Todo descarte vai para a aprovação do administrador; os alertas devolvidos (por item)
 * mostram o que merece mais atenção na conferência da foto e do peso.
 */
export function avaliarDescarteEstacao(dados: { itens: ItemDescarte[]; registrosHoje: RegistroAnterior[]; agora: Date }) {
  const { itens, registrosHoje, agora } = dados;
  if (!itens.length) throw new LimiteAntifraudeExcedidoError("Escolha pelo menos um tipo de descarte.");
  if (itens.length > MAXIMO_ITENS_POR_DESCARTE) throw new LimiteAntifraudeExcedidoError(`Registre no máximo ${MAXIMO_ITENS_POR_DESCARTE} tipos por descarte.`);
  for (const item of itens) {
    const minimo = item.pesoMinimoGramas ?? PESO_MINIMO_ESTACAO_GRAMAS;
    const maximo = item.pesoMaximoGramas ?? LIMITE_PESO_POR_REGISTRO_ESTACAO_GRAMAS;
    if (!Number.isFinite(item.pesoGramas) || item.pesoGramas < minimo) {
      throw new LimiteAntifraudeExcedidoError(`${item.rotulo}: o peso mínimo por descarte é ${kg(minimo)} kg.`);
    }
    if (item.pesoGramas > maximo) {
      throw new LimiteAntifraudeExcedidoError(`${item.rotulo}: o peso informado passa do limite de ${kg(maximo)} kg por descarte. Procure a administração para volumes maiores.`);
    }
  }
  // Cada ida à estação conta uma vez, mesmo com vários tipos (registros antigos, sem lote, contam um a um).
  const idasHoje = new Set(registrosHoje.map((registro, indice) => registro.lote ?? `avulso-${registro.id ?? indice}`)).size;
  if (idasHoje >= LIMITE_REGISTROS_DIARIOS_ESTACAO) {
    throw new LimiteAntifraudeExcedidoError(`Você já fez ${LIMITE_REGISTROS_DIARIOS_ESTACAO} descartes hoje, o máximo por dia. Tente de novo amanhã.`);
  }
  const pesoHoje = registrosHoje.reduce((soma, registro) => soma + (registro.pesoGramas ?? 0), 0);
  const pesoAgora = itens.reduce((soma, item) => soma + item.pesoGramas, 0);
  if (pesoHoje + pesoAgora > LIMITE_PESO_DIARIO_ESTACAO_GRAMAS) {
    throw new LimiteAntifraudeExcedidoError(`Este descarte passaria do limite diário de ${LIMITE_PESO_DIARIO_ESTACAO_GRAMAS / 1000} kg por morador.`);
  }
  const ultimo = registrosHoje.reduce<Date | null>((maisRecente, registro) => (registro.concluidaEm && (!maisRecente || registro.concluidaEm > maisRecente) ? registro.concluidaEm : maisRecente), null);
  if (ultimo && agora.getTime() - ultimo.getTime() < INTERVALO_MINIMO_ENTRE_REGISTROS_MINUTOS * 60_000) {
    throw new LimiteAntifraudeExcedidoError(`Aguarde ${INTERVALO_MINIMO_ENTRE_REGISTROS_MINUTOS} minutos entre um descarte e outro.`);
  }
  return {
    alertasPorItem: itens.map((item) => {
      const alertas: string[] = [];
      if (item.pesoGramas > PESO_REVISAO_OBRIGATORIA_GRAMAS) alertas.push(`peso acima de ${PESO_REVISAO_OBRIGATORIA_GRAMAS / 1000} kg`);
      if (ehPesoAnomalo(item.pesoGramas, item.mediaHistoricaGramas)) alertas.push("peso muito acima do histórico do morador");
      return alertas;
    }),
  };
}

/** Código de pareamento do tablet: longo e aleatório, mostrado uma única vez ao administrador. */
export function gerarTokenEstacao() {
  return randomBytes(18).toString("base64url");
}

export function hashTokenEstacao(token: string) {
  return createHash("sha256").update(token.trim()).digest("hex");
}

/** Código temporário de 6 dígitos que o morador digita no tablet. */
export function gerarCodigoEstacao() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Controle de tentativas erradas por tablet, em memória: após várias tentativas, o tablet fica bloqueado por alguns minutos. */
const tentativas = new Map<number, { erros: number; primeiraEm: number; bloqueadoAte: number }>();

export function verificarBloqueioTentativas(estacaoId: number, agora = Date.now()) {
  const registro = tentativas.get(estacaoId);
  if (registro && registro.bloqueadoAte > agora) {
    throw new LimiteAntifraudeExcedidoError("Muitos códigos errados neste tablet. Aguarde alguns minutos e gere um novo código no aplicativo.");
  }
}

/** Estações com o tablet bloqueado agora por excesso de códigos errados (alerta no painel do administrador). */
export function estacoesBloqueadas(agora = Date.now()) {
  return Array.from(tentativas.entries()).filter(([, registro]) => registro.bloqueadoAte > agora).map(([estacaoId]) => estacaoId);
}

/** Registra um código errado; devolve true quando esta tentativa acabou de bloquear o tablet. */
export function registrarTentativaErrada(estacaoId: number, agora = Date.now()) {
  const janela = BLOQUEIO_TENTATIVAS_MINUTOS * 60_000;
  const atual = tentativas.get(estacaoId);
  const registro = !atual || agora - atual.primeiraEm > janela ? { erros: 0, primeiraEm: agora, bloqueadoAte: 0 } : atual;
  registro.erros += 1;
  const bloqueouAgora = registro.erros >= LIMITE_TENTATIVAS_CODIGO && registro.bloqueadoAte <= agora;
  if (registro.erros >= LIMITE_TENTATIVAS_CODIGO) registro.bloqueadoAte = agora + janela;
  tentativas.set(estacaoId, registro);
  return bloqueouAgora;
}

export function limparTentativas(estacaoId: number) {
  tentativas.delete(estacaoId);
}

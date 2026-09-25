/**
 * Regras antifraude da estação de pesagem: um tablet com balança ao lado das lixeiras, onde o próprio morador
 * pesa e registra a reciclagem. Sem um coletor conferindo, as travas abaixo substituem a conferência humana:
 * limites rígidos bloqueiam o registro, e os sinais de risco mandam o registro para a revisão do administrador
 * (os pontos só entram depois da aprovação).
 */
import { createHash, randomBytes, randomInt } from "node:crypto";
import { LimiteAntifraudeExcedidoError, ehPesoAnomalo } from "./antifraude";

/** Peso mínimo de um registro: evita registros vazios só para testar a balança. */
export const PESO_MINIMO_ESTACAO_GRAMAS = 100;
/** Um saco de recicláveis de um apartamento raramente passa disso. */
export const LIMITE_PESO_POR_REGISTRO_ESTACAO_GRAMAS = 30_000;
/** Soma máxima registrada por morador no mesmo dia. */
export const LIMITE_PESO_DIARIO_ESTACAO_GRAMAS = 40_000;
/** Quantidade máxima de registros por morador no mesmo dia. */
export const LIMITE_REGISTROS_DIARIOS_ESTACAO = 4;
/** Intervalo mínimo entre dois registros do mesmo morador (impede pesar o mesmo saco várias vezes seguidas). */
export const INTERVALO_MINIMO_ENTRE_REGISTROS_MINUTOS = 10;
/** Acima deste peso o registro sempre passa pela revisão do administrador. */
export const PESO_REVISAO_OBRIGATORIA_GRAMAS = 10_000;
/** Fração dos registros sorteada para revisão, mesmo sem nenhum sinal de risco (auditoria por amostragem). */
export const FRACAO_AMOSTRAGEM_REVISAO = 0.1;
/** Validade do código temporário que o morador gera no app para se identificar no tablet. */
export const VALIDADE_CODIGO_ESTACAO_MINUTOS = 5;
/** Tentativas de código errado aceitas por tablet antes de bloqueá-lo por alguns minutos. */
export const LIMITE_TENTATIVAS_CODIGO = 8;
export const BLOQUEIO_TENTATIVAS_MINUTOS = 15;

type RegistroAnterior = { pesoGramas: number | null; concluidaEm: Date | null };

let sorteio: () => number = Math.random;

/** Permite fixar o sorteio da amostragem (testes e dados de demonstração). */
export function definirSorteioAmostragem(funcao: () => number) {
  sorteio = funcao;
}

/**
 * Confere um registro da estação. Lança LimiteAntifraudeExcedidoError quando um limite rígido é violado;
 * caso contrário, devolve os motivos para revisão (lista vazia = pontos liberados na hora).
 */
export function avaliarRegistroEstacao(dados: {
  pesoGramas: number;
  registrosHoje: RegistroAnterior[];
  mediaHistoricaGramas: number;
  agora: Date;
}) {
  const { pesoGramas, registrosHoje, mediaHistoricaGramas, agora } = dados;
  if (pesoGramas < PESO_MINIMO_ESTACAO_GRAMAS) {
    throw new LimiteAntifraudeExcedidoError(`O peso mínimo por registro é ${(PESO_MINIMO_ESTACAO_GRAMAS / 1000).toLocaleString("pt-BR")} kg.`);
  }
  if (pesoGramas > LIMITE_PESO_POR_REGISTRO_ESTACAO_GRAMAS) {
    throw new LimiteAntifraudeExcedidoError(`O peso informado passa do limite de ${LIMITE_PESO_POR_REGISTRO_ESTACAO_GRAMAS / 1000} kg por registro. Procure a administração para registrar volumes maiores.`);
  }
  if (registrosHoje.length >= LIMITE_REGISTROS_DIARIOS_ESTACAO) {
    throw new LimiteAntifraudeExcedidoError(`Você já fez ${LIMITE_REGISTROS_DIARIOS_ESTACAO} registros hoje, o máximo por dia. Tente de novo amanhã.`);
  }
  const pesoHoje = registrosHoje.reduce((soma, registro) => soma + (registro.pesoGramas ?? 0), 0);
  if (pesoHoje + pesoGramas > LIMITE_PESO_DIARIO_ESTACAO_GRAMAS) {
    throw new LimiteAntifraudeExcedidoError(`Este registro passaria do limite diário de ${LIMITE_PESO_DIARIO_ESTACAO_GRAMAS / 1000} kg por morador.`);
  }
  const ultimo = registrosHoje.reduce<Date | null>((maisRecente, registro) => (registro.concluidaEm && (!maisRecente || registro.concluidaEm > maisRecente) ? registro.concluidaEm : maisRecente), null);
  if (ultimo && agora.getTime() - ultimo.getTime() < INTERVALO_MINIMO_ENTRE_REGISTROS_MINUTOS * 60_000) {
    throw new LimiteAntifraudeExcedidoError(`Aguarde ${INTERVALO_MINIMO_ENTRE_REGISTROS_MINUTOS} minutos entre um registro e outro.`);
  }

  const motivosRevisao: string[] = [];
  if (pesoGramas > PESO_REVISAO_OBRIGATORIA_GRAMAS) motivosRevisao.push(`peso acima de ${PESO_REVISAO_OBRIGATORIA_GRAMAS / 1000} kg`);
  if (ehPesoAnomalo(pesoGramas, mediaHistoricaGramas)) motivosRevisao.push("peso muito acima do histórico do morador");
  if (!motivosRevisao.length && sorteio() < FRACAO_AMOSTRAGEM_REVISAO) motivosRevisao.push("sorteado para conferência por amostragem");
  return { motivosRevisao };
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

export function registrarTentativaErrada(estacaoId: number, agora = Date.now()) {
  const janela = BLOQUEIO_TENTATIVAS_MINUTOS * 60_000;
  const atual = tentativas.get(estacaoId);
  const registro = !atual || agora - atual.primeiraEm > janela ? { erros: 0, primeiraEm: agora, bloqueadoAte: 0 } : atual;
  registro.erros += 1;
  if (registro.erros >= LIMITE_TENTATIVAS_CODIGO) registro.bloqueadoAte = agora + janela;
  tentativas.set(estacaoId, registro);
}

export function limparTentativas(estacaoId: number) {
  tentativas.delete(estacaoId);
}

import type { statusColeta, statusOcorrencia, tiposResiduo } from "../drizzle/schema";

/** Rótulos em português dos valores gravados no banco, para textos que as pessoas leem (notificações, auditoria, PDFs). */

/** Nome da categoria, como aparece nas telas (Painel, Coletas, Gestão ambiental). */
export const rotuloResiduo: Record<(typeof tiposResiduo)[number], string> = { reciclavel: "Reciclável", organico: "Orgânico", rejeito: "Rejeito", eletronico: "Eletrônico", perigoso: "Perigoso" };

/** Categoria no meio de uma frase: "Uma coleta de recicláveis foi agendada...". */
export const residuoNaFrase: Record<(typeof tiposResiduo)[number], string> = { reciclavel: "recicláveis", organico: "orgânicos", rejeito: "rejeitos", eletronico: "eletrônicos", perigoso: "resíduos perigosos" };

/** Status gravado do descarte (os valores "agendada" e "em_andamento" só existem em registros antigos, do tempo do agendamento). */
export const rotuloStatusColeta: Record<(typeof statusColeta)[number], string> = { agendada: "Agendado", em_andamento: "Em andamento", concluida: "Concluído", cancelada: "Cancelado", ocorrencia: "Ocorrência" };

export const rotuloStatusOcorrencia: Record<(typeof statusOcorrencia)[number], string> = { aberta: "Aberta", em_analise: "Em análise", resolvida: "Resolvida" };

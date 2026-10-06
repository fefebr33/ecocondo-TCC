import type {
  categoriasOcorrencia,
  conclusoesOcorrencia,
  statusCampanha,
  statusColeta,
  statusOcorrencia,
  tiposPenalidade,
  tiposResiduo,
} from "../drizzle/schema";

/** Rótulos em português dos valores gravados no banco, para textos que as pessoas leem (notificações, auditoria, PDFs). */

/** Nome da categoria, como aparece nas telas (Painel, Coletas, Gestão ambiental). */
export const rotuloResiduo: Record<(typeof tiposResiduo)[number], string> = {
  reciclavel: "Reciclável",
  organico: "Orgânico",
  rejeito: "Rejeito",
  eletronico: "Eletrônico",
  perigoso: "Perigoso",
};

/** Categoria no meio de uma frase: "Uma coleta de recicláveis foi agendada...". */
export const residuoNaFrase: Record<(typeof tiposResiduo)[number], string> = {
  reciclavel: "recicláveis",
  organico: "orgânicos",
  rejeito: "rejeitos",
  eletronico: "eletrônicos",
  perigoso: "resíduos perigosos",
};

/** Status gravado do descarte (os valores "agendada" e "em_andamento" só existem em registros antigos, do tempo do agendamento). */
export const rotuloStatusColeta: Record<(typeof statusColeta)[number], string> =
  {
    agendada: "Agendado",
    em_andamento: "Em andamento",
    concluida: "Concluído",
    cancelada: "Cancelado",
    ocorrencia: "Ocorrência",
  };

export const rotuloStatusOcorrencia: Record<
  (typeof statusOcorrencia)[number],
  string
> = {
  aberta: "Aberta",
  em_analise: "Em análise",
  em_auditoria: "Em auditoria",
  resolvida: "Resolvida",
};

export const rotuloCategoriaOcorrencia: Record<
  (typeof categoriasOcorrencia)[number],
  string
> = {
  ambiental: "Problema ambiental",
  descarte_irregular: "Descarte irregular",
  suspeita_fraude: "Suspeita de fraude",
  problema_sistema: "Problema no sistema",
  outro: "Outro",
};

export const rotuloConclusaoOcorrencia: Record<
  (typeof conclusoesOcorrencia)[number],
  string
> = {
  procedente: "Procedente",
  improcedente: "Improcedente",
  denuncia_falsa: "Denúncia falsa",
};

export const rotuloStatusCampanha: Record<
  (typeof statusCampanha)[number],
  string
> = {
  planejada: "Planejada",
  ativa: "Ativa",
  pausada: "Pausada",
  encerrada: "Encerrada",
};

export const rotuloTipoPenalidade: Record<
  (typeof tiposPenalidade)[number],
  string
> = {
  perda_pontos: "Retirada de pontos",
  suspensao_campanhas: "Suspensão das campanhas",
  suspensao_participacao: "Suspensão da participação no programa",
  advertencia: "Advertência",
  outra: "Outra medida",
};

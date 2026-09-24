export type RegraRecorrencia = {
  id: number;
  diaSemana: number;
  horario: string;
  ativo: boolean;
  ultimaGeracaoData: string | null;
};

/** Data no fuso local do servidor (AAAA-MM-DD), o mesmo usado por getDay(); toISOString() usaria UTC e trocaria o dia perto da meia-noite. */
function dataParaChave(data: Date) {
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${data.getFullYear()}-${mes}-${dia}`;
}

/** Combina a data de referência com o horário "HH:MM" da regra para obter o instante agendado. */
export function calcularAgendamento(regra: { horario: string }, dataReferencia: Date) {
  const [horas, minutos] = regra.horario.split(":").map((parte) => Number.parseInt(parte, 10));
  const agendado = new Date(dataReferencia);
  agendado.setHours(Number.isFinite(horas) ? horas : 8, Number.isFinite(minutos) ? minutos : 0, 0, 0);
  return agendado;
}

/**
 * Próxima ocorrência da regra (hoje ou amanhã) que ainda não foi gerada e cujo horário ainda não passou.
 * Gerar com até um dia de antecedência garante o lembrete de 24h; ignorar horários passados evita criar coletas "atrasadas"
 * quando o servidor é ligado depois do horário. `ultimaGeracaoData` guarda o dia da última ocorrência gerada.
 */
export function proximaOcorrenciaParaGerar(regra: RegraRecorrencia, agora: Date) {
  if (!regra.ativo) return null;
  for (const deslocamento of [0, 1]) {
    const dia = new Date(agora);
    dia.setDate(dia.getDate() + deslocamento);
    if (dia.getDay() !== regra.diaSemana) continue;
    if (regra.ultimaGeracaoData && regra.ultimaGeracaoData >= dataParaChave(dia)) continue;
    const agendadaPara = calcularAgendamento(regra, dia);
    if (agendadaPara <= agora) continue;
    return agendadaPara;
  }
  return null;
}

export { dataParaChave as chaveDataGeracao };

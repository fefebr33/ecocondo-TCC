export type RegraRecorrencia = {
  id: number;
  diaSemana: number;
  horario: string;
  ativo: boolean;
  ultimaGeracaoData: string | null;
};

function dataParaChave(data: Date) {
  return data.toISOString().slice(0, 10);
}

/** Decide se uma regra de recorrência deve gerar uma coleta na data de referência (evita duplicar no mesmo dia). */
export function deveGerarColetaHoje(regra: RegraRecorrencia, dataReferencia: Date) {
  if (!regra.ativo) return false;
  if (regra.diaSemana !== dataReferencia.getDay()) return false;
  return regra.ultimaGeracaoData !== dataParaChave(dataReferencia);
}

/** Combina a data de referência com o horário "HH:MM" da regra para obter o instante agendado. */
export function calcularAgendamento(regra: { horario: string }, dataReferencia: Date) {
  const [horas, minutos] = regra.horario.split(":").map((parte) => Number.parseInt(parte, 10));
  const agendado = new Date(dataReferencia);
  agendado.setHours(Number.isFinite(horas) ? horas : 8, Number.isFinite(minutos) ? minutos : 0, 0, 0);
  return agendado;
}

export { dataParaChave as chaveDataGeracao };

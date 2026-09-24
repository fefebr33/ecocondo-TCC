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

/** Calcula o intervalo [inicio, fim] e o rótulo (ex.: "2026-T1") do trimestre civil que contém a data de referência. */
export function calcularTrimestre(dataReferencia: Date) {
  const ano = dataReferencia.getFullYear();
  const trimestreIndice = Math.floor(dataReferencia.getMonth() / 3); // 0..3
  const mesInicio = trimestreIndice * 3;
  const inicio = new Date(ano, mesInicio, 1, 0, 0, 0);
  const fim = new Date(ano, mesInicio + 3, 0, 23, 59, 59);
  return { rotulo: `${ano}-T${trimestreIndice + 1}`, inicio, fim };
}

/** Trimestre anterior ao que contém a data de referência (usado para fechar o certificado do trimestre já encerrado). */
export function trimestreAnterior(dataReferencia: Date) {
  const atual = calcularTrimestre(dataReferencia);
  const umDiaAntes = new Date(atual.inicio.getTime() - 24 * 60 * 60 * 1000);
  return calcularTrimestre(umDiaAntes);
}

import { toKilograms } from "./regrasSustentabilidade";

export type ColetaParaMetaPessoal = {
  moradorId: number | null;
  status: string;
  concluidaEm: Date | null;
  pesoGramas: number | null;
};

/** Progresso da meta pessoal do morador, na mesma lógica de acompanhamento das metas por bloco. */
export function calculatePersonalGoalProgress(
  meta: { moradorId: number; metaKg: number; dataInicio: Date; dataFim: Date },
  registros: ColetaParaMetaPessoal[],
) {
  const gramasColetados = registros
    .filter((registro) =>
      registro.moradorId === meta.moradorId &&
      registro.status === "concluida" &&
      registro.concluidaEm !== null &&
      registro.concluidaEm >= meta.dataInicio &&
      registro.concluidaEm <= meta.dataFim,
    )
    .reduce((soma, registro) => soma + (registro.pesoGramas ?? 0), 0);
  const coletadoKg = toKilograms(gramasColetados);
  return {
    coletadoKg,
    progresso: meta.metaKg > 0 ? Math.min(100, Math.round((coletadoKg / meta.metaKg) * 100)) : 0,
    atingida: meta.metaKg > 0 && coletadoKg >= meta.metaKg,
  };
}

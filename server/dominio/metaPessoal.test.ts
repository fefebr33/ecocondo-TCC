import { describe, expect, it } from "vitest";
import { calculatePersonalGoalProgress } from "./metaPessoal";

const meta = { moradorId: 1, metaKg: 10, dataInicio: new Date("2026-01-01"), dataFim: new Date("2026-01-31") };

describe("calculatePersonalGoalProgress", () => {
  it("soma apenas coletas concluídas do próprio morador dentro do período", () => {
    const registros = [
      { moradorId: 1, status: "concluida", concluidaEm: new Date("2026-01-10"), pesoGramas: 4000 },
      { moradorId: 1, status: "concluida", concluidaEm: new Date("2026-01-20"), pesoGramas: 3000 },
      { moradorId: 2, status: "concluida", concluidaEm: new Date("2026-01-10"), pesoGramas: 9000 },
      { moradorId: 1, status: "agendada", concluidaEm: null, pesoGramas: null },
      { moradorId: 1, status: "concluida", concluidaEm: new Date("2025-12-31"), pesoGramas: 5000 },
    ];
    const resultado = calculatePersonalGoalProgress(meta, registros);
    expect(resultado.coletadoKg).toBe(7);
    expect(resultado.progresso).toBe(70);
    expect(resultado.atingida).toBe(false);
  });

  it("marca a meta como atingida quando o total ultrapassa o alvo, sem passar de 100%", () => {
    const registros = [{ moradorId: 1, status: "concluida", concluidaEm: new Date("2026-01-15"), pesoGramas: 15000 }];
    const resultado = calculatePersonalGoalProgress(meta, registros);
    expect(resultado.progresso).toBe(100);
    expect(resultado.atingida).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  compararPeriodos,
  evolucaoMensal,
  resumirPontos,
  taxaDeConclusao,
} from "./indicadoresPainel";

const agora = new Date(2026, 8, 20, 12, 0); // 20/09/2026

function coleta(
  data: Date,
  dados: Partial<{
    status: string;
    pesoGramas: number | null;
    pendenteAprovacaoPeso: boolean;
    aprovacaoPesoStatus: string | null;
  }> = {}
) {
  const status = dados.status ?? "concluida";
  return {
    status,
    agendadaPara: data,
    concluidaEm: status === "concluida" ? data : null,
    pesoGramas: dados.pesoGramas === undefined ? 2000 : dados.pesoGramas,
    pendenteAprovacaoPeso: dados.pendenteAprovacaoPeso ?? false,
    aprovacaoPesoStatus: dados.aprovacaoPesoStatus ?? null,
  };
}

describe("indicadores do painel", () => {
  it("compara o mês atual com o anterior usando só o peso confirmado", () => {
    const registros = [
      coleta(new Date(2026, 7, 5)),
      coleta(new Date(2026, 7, 25)),
      coleta(new Date(2026, 8, 3), { pesoGramas: 3000 }),
      coleta(new Date(2026, 8, 10), { pesoGramas: 3000 }),
      coleta(new Date(2026, 8, 12), { pesoGramas: 1000 }),
      coleta(new Date(2026, 8, 14), {
        pesoGramas: 20_000,
        pendenteAprovacaoPeso: true,
      }),
      coleta(new Date(2026, 8, 15), {
        pesoGramas: 9000,
        aprovacaoPesoStatus: "rejeitado",
      }),
    ];
    const comparacao = compararPeriodos(registros, agora);
    expect(comparacao.atual).toEqual({ coletas: 4, kg: 7, rotulo: "set/26" });
    expect(comparacao.anterior).toEqual({
      coletas: 2,
      kg: 4,
      rotulo: "ago/26",
    });
    expect(comparacao.variacaoKg).toBe(75);
    expect(comparacao.variacaoColetas).toBe(100);
  });

  it("sem dados no mês anterior, a variação fica nula em vez de infinita", () => {
    const comparacao = compararPeriodos([coleta(new Date(2026, 8, 2))], agora);
    expect(comparacao.variacaoKg).toBeNull();
    expect(comparacao.temDadosAnteriores).toBe(false);
  });

  it("evolução mensal traz os últimos 6 meses em ordem, inclusive os vazios", () => {
    const evolucao = evolucaoMensal(
      [
        coleta(new Date(2026, 3, 10)),
        coleta(new Date(2026, 8, 1), { pesoGramas: 1500 }),
      ],
      agora
    );
    expect(evolucao.map(item => item.mes)).toEqual([
      "abr/26",
      "mai/26",
      "jun/26",
      "jul/26",
      "ago/26",
      "set/26",
    ]);
    expect(evolucao[0]).toMatchObject({ coletas: 1, kg: 2 });
    expect(evolucao[1]).toMatchObject({ coletas: 0, kg: 0 });
    expect(evolucao[5]).toMatchObject({ coletas: 1, kg: 1.5 });
  });

  it("taxa de conclusão ignora coletas futuras e separa atrasadas, canceladas e reprovadas", () => {
    const registros = [
      coleta(new Date(2026, 8, 1)),
      coleta(new Date(2026, 8, 2)),
      coleta(new Date(2026, 8, 3), { aprovacaoPesoStatus: "rejeitado" }),
      coleta(new Date(2026, 8, 4), { status: "cancelada" }),
      coleta(new Date(2026, 8, 19), { status: "agendada" }),
      coleta(new Date(2026, 8, 25), { status: "agendada" }),
    ];
    expect(taxaDeConclusao(registros, agora)).toEqual({
      percentual: 40,
      total: 5,
      concluidas: 2,
      reprovadas: 1,
      canceladas: 1,
      ocorrencias: 0,
      atrasadas: 1,
    });
    expect(taxaDeConclusao([], agora).percentual).toBeNull();
    // Coleta agendada para amanhã, mas já concluída (a estação registra na hora): entra na conta.
    expect(
      taxaDeConclusao([coleta(new Date(2026, 8, 21))], agora)
    ).toMatchObject({ percentual: 100, total: 1, concluidas: 1 });
  });

  it("resume o extrato por tipo de movimentação", () => {
    const resumo = resumirPontos([
      { tipo: "credito_coleta", pontos: 5 },
      { tipo: "credito_coleta", pontos: 3 },
      { tipo: "estorno_coleta", pontos: -3 },
      { tipo: "resgate", pontos: -4 },
      { tipo: "devolucao_resgate", pontos: 4 },
      { tipo: "ajuste", pontos: 2 },
    ]);
    expect(resumo).toEqual({
      distribuidos: 8,
      estornados: 3,
      resgatados: 4,
      devolvidos: 4,
      movimentados: 19,
    });
  });
});

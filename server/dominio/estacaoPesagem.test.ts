import { describe, expect, it } from "vitest";
import { LimiteAntifraudeExcedidoError } from "./antifraude";
import {
  avaliarDescarteEstacao,
  gerarCodigoEstacao,
  hashTokenEstacao,
  registrarTentativaErrada,
  verificarBloqueioTentativas,
  LIMITE_TENTATIVAS_CODIGO,
} from "./estacaoPesagem";

const agora = new Date("2026-09-25T15:00:00");
const minutosAntes = (minutos: number) => new Date(agora.getTime() - minutos * 60_000);
const item = (pesoGramas: number, extra: Partial<Parameters<typeof avaliarDescarteEstacao>[0]["itens"][number]> = {}) => ({ rotulo: "Reciclável", pesoGramas, mediaHistoricaGramas: 0, ...extra });

describe("regras antifraude da estação de pesagem", () => {
  it("aceita um descarte comum sem alertas", () => {
    expect(avaliarDescarteEstacao({ itens: [item(3200, { mediaHistoricaGramas: 3000 })], registrosHoje: [], agora }).alertasPorItem).toEqual([[]]);
  });

  it("aceita vários tipos no mesmo descarte e confere o peso mínimo e máximo de cada tipo", () => {
    const resultado = avaliarDescarteEstacao({ itens: [item(2000), item(800, { rotulo: "Eletrônico", pesoMinimoGramas: 50, pesoMaximoGramas: 20_000 })], registrosHoje: [], agora });
    expect(resultado.alertasPorItem).toHaveLength(2);
    expect(() => avaliarDescarteEstacao({ itens: [item(30, { rotulo: "Orgânico", pesoMinimoGramas: 100 })], registrosHoje: [], agora })).toThrow(/Orgânico: o peso mínimo/);
    expect(() => avaliarDescarteEstacao({ itens: [item(6000, { rotulo: "Perigoso", pesoMaximoGramas: 5000 })], registrosHoje: [], agora })).toThrow(/Perigoso: o peso informado passa do limite de 5 kg/);
    expect(() => avaliarDescarteEstacao({ itens: [], registrosHoje: [], agora })).toThrow(LimiteAntifraudeExcedidoError);
  });

  it("bloqueia peso zero ou negativo, acima do limite padrão e acima do limite diário", () => {
    expect(() => avaliarDescarteEstacao({ itens: [item(0)], registrosHoje: [], agora })).toThrow(LimiteAntifraudeExcedidoError);
    expect(() => avaliarDescarteEstacao({ itens: [item(-500)], registrosHoje: [], agora })).toThrow(LimiteAntifraudeExcedidoError);
    expect(() => avaliarDescarteEstacao({ itens: [item(31_000)], registrosHoje: [], agora })).toThrow(LimiteAntifraudeExcedidoError);
    expect(() => avaliarDescarteEstacao({ itens: [item(15_000)], registrosHoje: [{ pesoGramas: 28_000, concluidaEm: minutosAntes(120) }], agora })).toThrow(/limite diário/);
  });

  it("bloqueia descartes seguidos e o excesso de idas à estação no dia (cada ida conta uma vez, mesmo com vários tipos)", () => {
    expect(() => avaliarDescarteEstacao({ itens: [item(2000)], registrosHoje: [{ pesoGramas: 2000, concluidaEm: minutosAntes(3) }], agora })).toThrow(/Aguarde/);
    const tresIdasComDoisTipos = [1, 2, 3].flatMap((hora) => [{ pesoGramas: 500, concluidaEm: minutosAntes(hora * 60), lote: `L${hora}` }, { pesoGramas: 500, concluidaEm: minutosAntes(hora * 60), lote: `L${hora}` }]);
    expect(() => avaliarDescarteEstacao({ itens: [item(1000)], registrosHoje: tresIdasComDoisTipos, agora })).not.toThrow();
    const quatro = [1, 2, 3, 4].map((hora) => ({ pesoGramas: 1000, concluidaEm: minutosAntes(hora * 60), lote: `L${hora}` }));
    expect(() => avaliarDescarteEstacao({ itens: [item(1000)], registrosHoje: quatro, agora })).toThrow(/máximo por dia/);
  });

  it("aponta alertas para a conferência: peso alto e peso fora do histórico", () => {
    expect(avaliarDescarteEstacao({ itens: [item(12_000, { mediaHistoricaGramas: 11_000 })], registrosHoje: [], agora }).alertasPorItem).toEqual([["peso acima de 10 kg"]]);
    expect(avaliarDescarteEstacao({ itens: [item(7000, { mediaHistoricaGramas: 2000 })], registrosHoje: [], agora }).alertasPorItem).toEqual([["peso muito acima do histórico do morador"]]);
  });

  it("gera códigos de 6 dígitos e guarda só o hash do código de pareamento", () => {
    expect(gerarCodigoEstacao()).toMatch(/^\d{6}$/);
    expect(hashTokenEstacao("abc")).toHaveLength(64);
    expect(hashTokenEstacao(" abc ")).toBe(hashTokenEstacao("abc"));
  });

  it("bloqueia o tablet depois de muitos códigos errados", () => {
    const estacaoId = 999;
    const bloqueios = Array.from({ length: LIMITE_TENTATIVAS_CODIGO }, () => registrarTentativaErrada(estacaoId, 1000));
    // Só a tentativa que bloqueia avisa (para o administrador receber um único alerta de falha operacional).
    expect(bloqueios.filter(Boolean)).toHaveLength(1);
    expect(bloqueios.at(-1)).toBe(true);
    expect(() => verificarBloqueioTentativas(estacaoId, 2000)).toThrow(LimiteAntifraudeExcedidoError);
    expect(() => verificarBloqueioTentativas(estacaoId, 1000 + 16 * 60_000)).not.toThrow();
  });
});

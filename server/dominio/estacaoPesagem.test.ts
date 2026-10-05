import { describe, expect, it } from "vitest";
import { LimiteAntifraudeExcedidoError } from "./antifraude";
import {
  avaliarDescarteEstacao,
  gerarCodigoEstacao,
  hashTokenEstacao,
  registrarTentativaErrada,
  verificarBloqueioTentativas,
  esperaRestanteMs,
  limparTentativas,
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

  it("no modo demonstração não há espera entre descartes nem limite do dia; fora dele as regras continuam", () => {
    const seguidos = [1, 2, 3, 4].map((minuto) => ({ pesoGramas: 9000, concluidaEm: minutosAntes(minuto), lote: `L${minuto}` }));
    expect(() => avaliarDescarteEstacao({ itens: [item(2000)], registrosHoje: seguidos, agora, modoDemonstracao: true })).not.toThrow();
    expect(() => avaliarDescarteEstacao({ itens: [item(2000)], registrosHoje: seguidos, agora })).toThrow(LimiteAntifraudeExcedidoError);
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

  it("depois de alguns códigos errados, o tablet pede uma espera crescente, de no máximo 2 minutos", () => {
    const estacaoId = 9001;
    for (let erro = 1; erro < LIMITE_TENTATIVAS_CODIGO; erro += 1) registrarTentativaErrada(estacaoId, 1000);
    expect(() => verificarBloqueioTentativas(estacaoId, 1000)).not.toThrow();
    registrarTentativaErrada(estacaoId, 1000);
    expect(esperaRestanteMs(estacaoId, 1000)).toBe(15_000);
    expect(() => verificarBloqueioTentativas(estacaoId, 2000)).toThrow(LimiteAntifraudeExcedidoError);
    expect(() => verificarBloqueioTentativas(estacaoId, 16_001)).not.toThrow();
    registrarTentativaErrada(estacaoId, 20_000);
    expect(esperaRestanteMs(estacaoId, 20_000)).toBe(30_000);
    const avisos = Array.from({ length: 10 }, (_, indice) => registrarTentativaErrada(estacaoId, 30_000 + indice));
    // Só o erro que atinge o limite avisa (o administrador recebe um único alerta de falha operacional).
    expect(avisos.filter(Boolean)).toHaveLength(1);
    expect(esperaRestanteMs(estacaoId, 30_009)).toBe(120_000);
    // Um código certo zera a contagem.
    limparTentativas(estacaoId);
    expect(() => verificarBloqueioTentativas(estacaoId, 30_010)).not.toThrow();
  });
});

describe("dia da estação no horário de Brasília", () => {
  it("o dia vira à meia-noite de Brasília, mesmo com o servidor em UTC", async () => {
    const { inicioDoDiaEmBrasilia } = await import("../rotas/estacoes");
    expect(inicioDoDiaEmBrasilia(new Date("2026-09-30T23:30:00Z")).toISOString()).toBe("2026-09-30T03:00:00.000Z");
    expect(inicioDoDiaEmBrasilia(new Date("2026-10-01T02:59:00Z")).toISOString()).toBe("2026-09-30T03:00:00.000Z");
    expect(inicioDoDiaEmBrasilia(new Date("2026-10-01T03:00:00Z")).toISOString()).toBe("2026-10-01T03:00:00.000Z");
  });
});

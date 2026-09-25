import { afterEach, describe, expect, it } from "vitest";
import { LimiteAntifraudeExcedidoError } from "./antifraude";
import {
  avaliarRegistroEstacao,
  definirSorteioAmostragem,
  gerarCodigoEstacao,
  hashTokenEstacao,
  registrarTentativaErrada,
  verificarBloqueioTentativas,
  LIMITE_TENTATIVAS_CODIGO,
} from "./estacaoPesagem";

const agora = new Date("2026-09-25T15:00:00");
const minutosAntes = (minutos: number) => new Date(agora.getTime() - minutos * 60_000);

afterEach(() => definirSorteioAmostragem(Math.random));

describe("regras antifraude da estação de pesagem", () => {
  it("libera um registro comum sem revisão", () => {
    definirSorteioAmostragem(() => 0.99);
    expect(avaliarRegistroEstacao({ pesoGramas: 3200, registrosHoje: [], mediaHistoricaGramas: 3000, agora }).motivosRevisao).toEqual([]);
  });

  it("bloqueia peso abaixo do mínimo, acima do limite por registro e acima do limite diário", () => {
    expect(() => avaliarRegistroEstacao({ pesoGramas: 50, registrosHoje: [], mediaHistoricaGramas: 0, agora })).toThrow(LimiteAntifraudeExcedidoError);
    expect(() => avaliarRegistroEstacao({ pesoGramas: 31_000, registrosHoje: [], mediaHistoricaGramas: 0, agora })).toThrow(LimiteAntifraudeExcedidoError);
    expect(() => avaliarRegistroEstacao({ pesoGramas: 15_000, registrosHoje: [{ pesoGramas: 28_000, concluidaEm: minutosAntes(120) }], mediaHistoricaGramas: 0, agora })).toThrow(/limite diário/);
  });

  it("bloqueia registros seguidos e o excesso de registros no dia", () => {
    expect(() => avaliarRegistroEstacao({ pesoGramas: 2000, registrosHoje: [{ pesoGramas: 2000, concluidaEm: minutosAntes(3) }], mediaHistoricaGramas: 2000, agora })).toThrow(/Aguarde/);
    const quatro = [1, 2, 3, 4].map((hora) => ({ pesoGramas: 1000, concluidaEm: minutosAntes(hora * 60) }));
    expect(() => avaliarRegistroEstacao({ pesoGramas: 1000, registrosHoje: quatro, mediaHistoricaGramas: 1000, agora })).toThrow(/máximo por dia/);
  });

  it("manda para revisão peso alto, peso fora do histórico e a amostragem sorteada", () => {
    definirSorteioAmostragem(() => 0.99);
    expect(avaliarRegistroEstacao({ pesoGramas: 12_000, registrosHoje: [], mediaHistoricaGramas: 11_000, agora }).motivosRevisao).toEqual(["peso acima de 10 kg"]);
    expect(avaliarRegistroEstacao({ pesoGramas: 7000, registrosHoje: [], mediaHistoricaGramas: 2000, agora }).motivosRevisao).toEqual(["peso muito acima do histórico do morador"]);
    definirSorteioAmostragem(() => 0.01);
    expect(avaliarRegistroEstacao({ pesoGramas: 2000, registrosHoje: [], mediaHistoricaGramas: 2000, agora }).motivosRevisao).toEqual(["sorteado para conferência por amostragem"]);
  });

  it("gera códigos de 6 dígitos e guarda só o hash do código de pareamento", () => {
    expect(gerarCodigoEstacao()).toMatch(/^\d{6}$/);
    expect(hashTokenEstacao("abc")).toHaveLength(64);
    expect(hashTokenEstacao(" abc ")).toBe(hashTokenEstacao("abc"));
  });

  it("bloqueia o tablet depois de muitos códigos errados", () => {
    const estacaoId = 999;
    for (let vez = 0; vez < LIMITE_TENTATIVAS_CODIGO; vez += 1) registrarTentativaErrada(estacaoId, 1000);
    expect(() => verificarBloqueioTentativas(estacaoId, 2000)).toThrow(LimiteAntifraudeExcedidoError);
    expect(() => verificarBloqueioTentativas(estacaoId, 1000 + 16 * 60_000)).not.toThrow();
  });
});

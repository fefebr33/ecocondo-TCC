import { describe, expect, it } from "vitest";
import { calcularAgendamento, chaveDataGeracao, proximaOcorrenciaParaGerar } from "./regrasRecorrencia";

describe("proximaOcorrenciaParaGerar", () => {
  const tercaCedo = new Date("2026-01-06T06:00:00"); // terça-feira, antes das 08:00
  const regraTerca = { id: 1, diaSemana: 2, horario: "08:00", ativo: true, ultimaGeracaoData: null };

  it("gera a coleta de hoje quando o horário ainda não passou", () => {
    const agendada = proximaOcorrenciaParaGerar(regraTerca, tercaCedo);
    expect(agendada && chaveDataGeracao(agendada)).toBe("2026-01-06");
    expect(agendada?.getHours()).toBe(8);
  });

  it("gera com um dia de antecedência para o lembrete de 24h", () => {
    const segunda = new Date("2026-01-05T15:00:00");
    const agendada = proximaOcorrenciaParaGerar(regraTerca, segunda);
    expect(agendada && chaveDataGeracao(agendada)).toBe("2026-01-06");
  });

  it("não cria coleta com horário já passado", () => {
    const tercaTarde = new Date("2026-01-06T10:00:00");
    expect(proximaOcorrenciaParaGerar(regraTerca, tercaTarde)).toBeNull();
  });

  it("não gera se a regra estiver inativa", () => {
    expect(proximaOcorrenciaParaGerar({ ...regraTerca, ativo: false }, tercaCedo)).toBeNull();
  });

  it("não gera se o dia da semana não for hoje nem amanhã", () => {
    expect(proximaOcorrenciaParaGerar({ ...regraTerca, diaSemana: 4 }, tercaCedo)).toBeNull();
  });

  it("não gera duas vezes a mesma ocorrência", () => {
    const segunda = new Date("2026-01-05T15:00:00");
    const jaGerada = { ...regraTerca, ultimaGeracaoData: "2026-01-06" };
    expect(proximaOcorrenciaParaGerar(jaGerada, segunda)).toBeNull();
    expect(proximaOcorrenciaParaGerar(jaGerada, tercaCedo)).toBeNull();
  });

  it("volta a gerar na semana seguinte", () => {
    const segundaSeguinte = new Date("2026-01-12T09:00:00");
    const agendada = proximaOcorrenciaParaGerar({ ...regraTerca, ultimaGeracaoData: "2026-01-06" }, segundaSeguinte);
    expect(agendada && chaveDataGeracao(agendada)).toBe("2026-01-13");
  });
});

describe("calcularAgendamento", () => {
  it("combina a data de referência com o horário informado", () => {
    const agendado = calcularAgendamento({ horario: "14:30" }, new Date("2026-01-06T00:00:00"));
    expect(agendado.getHours()).toBe(14);
    expect(agendado.getMinutes()).toBe(30);
  });
});

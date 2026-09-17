import { describe, expect, it } from "vitest";
import { calcularAgendamento, chaveDataGeracao, deveGerarColetaHoje } from "./regrasRecorrencia";

describe("deveGerarColetaHoje", () => {
  const terca = new Date("2026-01-06T12:00:00"); // terça-feira

  it("gera quando o dia da semana bate e ainda não foi gerada hoje", () => {
    const regra = { id: 1, diaSemana: 2, horario: "08:00", ativo: true, ultimaGeracaoData: null };
    expect(deveGerarColetaHoje(regra, terca)).toBe(true);
  });

  it("não gera se a regra estiver inativa", () => {
    const regra = { id: 1, diaSemana: 2, horario: "08:00", ativo: false, ultimaGeracaoData: null };
    expect(deveGerarColetaHoje(regra, terca)).toBe(false);
  });

  it("não gera se o dia da semana não corresponder", () => {
    const regra = { id: 1, diaSemana: 3, horario: "08:00", ativo: true, ultimaGeracaoData: null };
    expect(deveGerarColetaHoje(regra, terca)).toBe(false);
  });

  it("não gera duas vezes no mesmo dia", () => {
    const regra = { id: 1, diaSemana: 2, horario: "08:00", ativo: true, ultimaGeracaoData: chaveDataGeracao(terca) };
    expect(deveGerarColetaHoje(regra, terca)).toBe(false);
  });
});

describe("calcularAgendamento", () => {
  it("combina a data de referência com o horário informado", () => {
    const agendado = calcularAgendamento({ horario: "14:30" }, new Date("2026-01-06T00:00:00"));
    expect(agendado.getHours()).toBe(14);
    expect(agendado.getMinutes()).toBe(30);
  });
});

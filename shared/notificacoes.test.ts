import { describe, expect, it } from "vitest";
import {
  destinoDaNotificacao,
  gruposNotificacao,
  rotuloTipoNotificacao,
  tiposPorPerfil,
} from "./notificacoes";

describe("destino das notificações", () => {
  it("leva direto ao descarte citado na notificação", () => {
    expect(
      destinoDaNotificacao(
        { tipo: "coleta_reprovada", coletaId: 42 },
        "morador"
      )
    ).toEqual({ href: "/descartes?id=42", rotulo: "Abrir o descarte nº 42" });
    expect(
      destinoDaNotificacao(
        { tipo: "descarte_aguardando_aprovacao", coletaId: 7 },
        "administrador"
      )?.href
    ).toBe("/descartes?id=7");
  });

  it("respeita o perfil: pontos vão para o extrato do morador, e o morador nunca é levado a telas da administração", () => {
    expect(
      destinoDaNotificacao({ tipo: "pontos_ganhos", coletaId: 3 }, "morador")
        ?.href
    ).toBe("/engajamento#extrato");
    expect(
      destinoDaNotificacao({ tipo: "novo_cadastro", coletaId: null }, "morador")
    ).toBeNull();
    expect(
      destinoDaNotificacao(
        { tipo: "relatorio_anual", coletaId: null },
        "morador"
      )
    ).toBeNull();
    expect(
      destinoDaNotificacao(
        { tipo: "novo_cadastro", coletaId: null },
        "administrador"
      )?.href
    ).toBe("/pessoas");
  });

  it("todo tipo configurável tem nome para a tela de configurações", () => {
    for (const tipo of [
      ...tiposPorPerfil.morador,
      ...tiposPorPerfil.administrador,
    ])
      expect(rotuloTipoNotificacao[tipo]).toBeTruthy();
  });

  it('todo tipo configurável aparece em algum grupo da tela "Quem recebe cada aviso"', () => {
    const agrupados = new Set<string>(
      gruposNotificacao.flatMap(grupo => [...grupo.tipos])
    );
    for (const tipo of [
      ...tiposPorPerfil.morador,
      ...tiposPorPerfil.administrador,
    ])
      expect(agrupados.has(tipo), tipo).toBe(true);
  });

  it("adesivo cancelado leva o morador aos seus adesivos", () => {
    expect(
      destinoDaNotificacao(
        { tipo: "adesivo_cancelado", coletaId: null },
        "morador"
      )?.href
    ).toBeTruthy();
  });
});

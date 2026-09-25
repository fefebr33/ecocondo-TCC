import { describe, expect, it } from "vitest";
import { allowedRoutesFor, canAccessRoute } from "./permissions";

describe("matriz de permissões do EcoCondo", () => {
  it("permite ao administrador acessar os módulos de gestão", () => {
    expect(canAccessRoute("administrador", "/moradores")).toBe(true);
    expect(canAccessRoute("administrador", "/pessoas")).toBe(true);
    expect(canAccessRoute("administrador", "/relatorios")).toBe(true);
    expect(canAccessRoute("administrador", "/configuracoes")).toBe(true);
  });

  it("não existe mais o perfil coletor: só administrador e morador", () => {
    expect(allowedRoutesFor("coletor" as never)).toEqual([]);
    expect(canAccessRoute("morador", "/moradores")).toBe(false);
    expect(canAccessRoute("morador", "/relatorios")).toBe(false);
  });

  it("mantém o morador nos módulos de participação e consulta", () => {
    expect(allowedRoutesFor("morador")).toEqual(["/dashboard", "/coletas", "/engajamento", "/podio", "/guia", "/notificacoes", "/ambiental", "/comunidade"]);
    expect(canAccessRoute("morador", "/configuracoes")).toBe(false);
  });

  it("permite a todos consultar calendário e registrar ocorrências no espaço apropriado", () => {
    expect(canAccessRoute("administrador", "/ambiental")).toBe(true);
    expect(canAccessRoute("administrador", "/comunidade")).toBe(true);
    expect(canAccessRoute("morador", "/ambiental")).toBe(true);
  });
});

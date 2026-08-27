import { describe, expect, it } from "vitest";
import { allowedRoutesFor, canAccessRoute } from "./permissions";

describe("matriz de permissões do EcoCondo", () => {
  it("permite ao administrador acessar os módulos de gestão", () => {
    expect(canAccessRoute("administrador", "/moradores")).toBe(true);
    expect(canAccessRoute("administrador", "/pessoas")).toBe(true);
    expect(canAccessRoute("administrador", "/relatorios")).toBe(true);
    expect(canAccessRoute("administrador", "/configuracoes")).toBe(true);
  });

  it("restringe ao coletor os módulos administrativos", () => {
    expect(canAccessRoute("coletor", "/coletas")).toBe(true);
    expect(canAccessRoute("coletor", "/moradores")).toBe(false);
    expect(canAccessRoute("coletor", "/pessoas")).toBe(false);
    expect(canAccessRoute("coletor", "/relatorios")).toBe(false);
  });

  it("mantém o morador nos módulos de participação e consulta", () => {
    expect(allowedRoutesFor("morador")).toEqual(["/dashboard", "/coletas", "/engajamento", "/guia", "/notificacoes", "/ambiental", "/comunidade"]);
    expect(canAccessRoute("morador", "/configuracoes")).toBe(false);
  });

  it("permite a todos consultar calendário e registrar ocorrências no espaço apropriado", () => {
    expect(canAccessRoute("administrador", "/ambiental")).toBe(true);
    expect(canAccessRoute("coletor", "/comunidade")).toBe(true);
    expect(canAccessRoute("morador", "/ambiental")).toBe(true);
  });
});

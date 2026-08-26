import { describe, expect, it } from "vitest";
import { allowedRoutesFor, canAccessRoute } from "./permissions";

describe("matriz de permissões do EcoCondo", () => {
  it("permite ao administrador acessar os módulos de gestão", () => {
    expect(canAccessRoute("administrador", "/moradores")).toBe(true);
    expect(canAccessRoute("administrador", "/relatorios")).toBe(true);
    expect(canAccessRoute("administrador", "/configuracoes")).toBe(true);
  });

  it("restringe ao coletor os módulos administrativos", () => {
    expect(canAccessRoute("coletor", "/coletas")).toBe(true);
    expect(canAccessRoute("coletor", "/moradores")).toBe(false);
    expect(canAccessRoute("coletor", "/relatorios")).toBe(false);
  });

  it("mantém o morador nos módulos de participação e consulta", () => {
    expect(allowedRoutesFor("morador")).toEqual(["/dashboard", "/coletas", "/engajamento", "/guia", "/notificacoes"]);
    expect(canAccessRoute("morador", "/configuracoes")).toBe(false);
  });
});

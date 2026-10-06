import { describe, expect, it } from "vitest";
import { conferirSenha, gerarHashSenha, hashDoToken, loginBloqueado, registrarTentativa, SenhaInvalidaError, TENTATIVAS_MAXIMAS, validarForcaSenha } from "./senhas";

describe("senhas", () => {
  it("guarda só o hash (com sal) e confere a senha certa", async () => {
    const hash = await gerarHashSenha("minhaSenha123");
    expect(hash).toMatch(/^scrypt\$/);
    expect(hash).not.toContain("minhaSenha123");
    expect(await gerarHashSenha("minhaSenha123")).not.toBe(hash);
    expect(await conferirSenha("minhaSenha123", hash)).toBe(true);
    expect(await conferirSenha("minhaSenha124", hash)).toBe(false);
    expect(await conferirSenha("qualquer", null)).toBe(false);
  });

  it("exige senha com pelo menos 8 caracteres, letras e números", () => {
    expect(() => validarForcaSenha("abc123")).toThrow(SenhaInvalidaError);
    expect(() => validarForcaSenha("somenteletras")).toThrow(/letras e números/);
    expect(() => validarForcaSenha("boaSenha2026")).not.toThrow();
  });

  it("bloqueia o e-mail depois de várias senhas erradas seguidas, só para a origem que errou", () => {
    const agora = Date.now();
    for (let tentativa = 0; tentativa < TENTATIVAS_MAXIMAS; tentativa += 1) registrarTentativa("alvo@teste.local", false, { origem: "10.0.0.9", agora });
    expect(loginBloqueado("ALVO@teste.local", { origem: "10.0.0.9", agora: agora + 1000 })).toBe(true);
    // O dono da conta, de outra rede, continua entrando.
    expect(loginBloqueado("alvo@teste.local", { origem: "200.1.2.3", agora: agora + 1000 })).toBe(false);
    expect(loginBloqueado("alvo@teste.local", { origem: "10.0.0.9", agora: agora + 16 * 60 * 1000 })).toBe(false);
  });

  it("o token do link é guardado como hash", () => {
    expect(hashDoToken("abc")).toHaveLength(64);
    expect(hashDoToken("abc")).not.toBe(hashDoToken("abd"));
  });
});

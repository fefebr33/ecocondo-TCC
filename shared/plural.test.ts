import { describe, expect, it } from "vitest";
import { palavra, plural } from "./plural";

describe("plural", () => {
  it("concorda a palavra com o número", () => {
    expect(plural(1, "ponto", "pontos")).toBe("1 ponto");
    expect(plural(0, "ponto", "pontos")).toBe("0 pontos");
    expect(plural(3.1, "ponto", "pontos")).toBe("3,1 pontos");
    expect(plural(1.5, "ponto", "pontos")).toBe("1,5 ponto");
    expect(palavra(4, "adesivo disponível", "adesivos disponíveis")).toBe("adesivos disponíveis");
  });
});

import { describe, expect, it } from "vitest";
import { hashesDosScriptsEmbutidos } from "./seguranca";

describe("cabeçalhos de segurança", () => {
  it("calcula o hash só dos scripts escritos dentro do HTML", () => {
    const html = `<script>alert(1)</script><script type="module" src="/a.js"></script><script> </script>`;
    expect(hashesDosScriptsEmbutidos(html)).toEqual(["'sha256-bhHHL3z2vDgxUt0W3dWQOrprscmda2Y5pLsLg4GF+pI='"]);
  });
});

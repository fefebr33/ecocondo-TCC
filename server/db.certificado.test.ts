import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lerCertificado } from "./db";

const PEM = "-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----\n";

describe("lerCertificado (DATABASE_SSL_CA)", () => {
  it("aceita o texto do certificado colado na variável, inclusive com \\n literais", () => {
    expect(lerCertificado(PEM)).toBe(PEM);
    expect(lerCertificado(PEM.replace(/\n/g, "\\n"))).toBe(PEM);
  });

  it("lê o certificado de um arquivo quando recebe um caminho", () => {
    const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ca-")), "ca.pem");
    fs.writeFileSync(arquivo, PEM);
    expect(lerCertificado(arquivo)).toBe(PEM);
  });
});

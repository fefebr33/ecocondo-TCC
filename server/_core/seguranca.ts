import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Express } from "express";
import helmet from "helmet";

/** Hashes (CSP) dos scripts escritos dentro do index.html (ex.: o que aplica o modo escuro antes de desenhar a página). */
export function hashesDosScriptsEmbutidos(html: string) {
  return Array.from(
    html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)
  )
    .map(script => script[1])
    .filter(conteudo => conteudo.trim())
    .map(
      conteudo =>
        `'sha256-${createHash("sha256").update(conteudo).digest("base64")}'`
    );
}

/**
 * Cabeçalhos de segurança (helmet): impede abrir o EcoCondo dentro de outro site (clickjacking), desliga a detecção de tipo
 * do navegador e, em produção, limita de onde a página carrega scripts, estilos, fontes e imagens (CSP). Em desenvolvimento
 * a CSP fica desligada, porque o Vite injeta scripts para recarregar a página.
 */
export function registrarCabecalhosDeSeguranca(app: Express) {
  const producao = process.env.NODE_ENV !== "development";
  let scriptsEmbutidos: string[] = [];
  if (producao) {
    const indice = path.resolve(import.meta.dirname, "public", "index.html");
    if (fs.existsSync(indice))
      scriptsEmbutidos = hashesDosScriptsEmbutidos(
        fs.readFileSync(indice, "utf8")
      );
  }
  app.use(
    helmet({
      contentSecurityPolicy: producao
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", ...scriptsEmbutidos],
              // Gráficos e componentes da interface usam estilo inline; a fonte Inter vem do Google Fonts.
              styleSrc: [
                "'self'",
                "'unsafe-inline'",
                "https://fonts.googleapis.com",
              ],
              fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
              // Fotos da balança, QR Codes e prévia da câmera chegam como data: e blob:.
              imgSrc: ["'self'", "data:", "blob:"],
              mediaSrc: ["'self'", "blob:"],
              connectSrc: ["'self'"],
              objectSrc: ["'none'"],
              frameAncestors: ["'none'"],
              baseUri: ["'self'"],
              formAction: ["'self'"],
              upgradeInsecureRequests: null,
            },
          }
        : false,
      // A fonte do Google não manda o cabeçalho que o COEP exigiria.
      crossOriginEmbedderPolicy: false,
    })
  );
}

import path from "node:path";
import express, { type Express } from "express";
import { autenticarComPerfil } from "./acesso";

const UPLOADS_DIR = path.resolve(process.cwd(), "data", "uploads");

// Serve os arquivos enviados (fotos, certificados, relatórios) direto do disco local, apenas para usuários
// logados do mesmo condomínio. As chaves seguem o formato "<categoria>/<condominioId>/...".
export function registerStorageProxy(app: Express) {
  app.use(
    "/uploads",
    async (req, res, next) => {
      const acesso = await autenticarComPerfil(req, res);
      if (!acesso) return;
      const condominioDoArquivo = Number(req.path.split("/").filter(Boolean)[1]);
      if (condominioDoArquivo !== acesso.condominio.id) {
        res.status(404).end();
        return;
      }
      next();
    },
    express.static(UPLOADS_DIR, { fallthrough: false, maxAge: "1h" }),
  );
}

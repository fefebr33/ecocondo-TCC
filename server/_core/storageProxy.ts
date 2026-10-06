import path from "node:path";
import express, { type Express } from "express";
import { lerArquivo } from "../storage";
import { autenticarComPerfil } from "./acesso";

/** Arquivos gravados em disco antes de irem para o banco (instalações antigas); só servem de reserva. */
const UPLOADS_DIR = path.resolve(process.cwd(), "data", "uploads");

// Serve os arquivos enviados (fotos, certificados, relatórios), guardados no MySQL, apenas para usuários
// logados do mesmo condomínio. As chaves seguem o formato "<categoria>/<condominioId>/...".
export function registerStorageProxy(app: Express) {
  app.use(
    "/uploads",
    async (req, res, next) => {
      const acesso = await autenticarComPerfil(req, res);
      if (!acesso) return;
      const condominioDoArquivo = Number(
        req.path.split("/").filter(Boolean)[1]
      );
      if (condominioDoArquivo !== acesso.condominio.id) {
        res.status(404).end();
        return;
      }
      try {
        const arquivo = await lerArquivo(decodeURIComponent(req.path));
        if (!arquivo) return next();
        res.setHeader("Content-Type", arquivo.tipoConteudo);
        res.setHeader("Cache-Control", "private, max-age=3600");
        res.send(arquivo.dados);
      } catch (error) {
        next(error);
      }
    },
    express.static(UPLOADS_DIR, { fallthrough: false, maxAge: "1h" })
  );
}

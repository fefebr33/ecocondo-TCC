import path from "node:path";
import express, { type Express } from "express";

const UPLOADS_DIR = path.resolve(process.cwd(), "data", "uploads");

// Serve os arquivos enviados (ex.: fotos de ocorrências) direto do disco local.
export function registerStorageProxy(app: Express) {
  app.use("/uploads", express.static(UPLOADS_DIR, { fallthrough: true, maxAge: "1y" }));
}

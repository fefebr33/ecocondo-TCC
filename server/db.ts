import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { NovoUsuario, usuarios } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

// Banco local em arquivo (SQLite) — sem depender de nenhum servidor externo.
export async function getDb() {
  if (!_db) {
    const file = path.resolve(ENV.databaseUrl || "./data/ecocondo.db");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const sqlite = new Database(file);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    _db = drizzle(sqlite);
  }
  return _db;
}

export async function upsertUser(usuario: NovoUsuario): Promise<void> {
  if (!usuario.idExterno) {
    throw new Error("idExterno é obrigatório para salvar o usuário");
  }

  const db = await getDb();

  try {
    const valores: NovoUsuario = {
      idExterno: usuario.idExterno,
    };
    const conjuntoAtualizacao: Record<string, unknown> = {};

    const camposTexto = ["nome", "email", "metodoLogin"] as const;
    type CampoTexto = (typeof camposTexto)[number];

    const atribuirSeInformado = (campo: CampoTexto) => {
      const valor = usuario[campo];
      if (valor === undefined) return;
      const normalizado = valor ?? null;
      valores[campo] = normalizado;
      conjuntoAtualizacao[campo] = normalizado;
    };

    camposTexto.forEach(atribuirSeInformado);

    if (usuario.ultimoAcesso !== undefined) {
      valores.ultimoAcesso = usuario.ultimoAcesso;
      conjuntoAtualizacao.ultimoAcesso = usuario.ultimoAcesso;
    }
    if (usuario.papel !== undefined) {
      valores.papel = usuario.papel;
      conjuntoAtualizacao.papel = usuario.papel;
    } else if (usuario.idExterno === ENV.ownerOpenId) {
      valores.papel = "administrador";
      conjuntoAtualizacao.papel = "administrador";
    }

    if (!valores.ultimoAcesso) {
      valores.ultimoAcesso = new Date();
    }

    if (Object.keys(conjuntoAtualizacao).length === 0) {
      conjuntoAtualizacao.ultimoAcesso = new Date();
    }

    const existente = await db.select().from(usuarios).where(eq(usuarios.idExterno, valores.idExterno)).limit(1);
    if (existente[0]) {
      await db.update(usuarios).set(conjuntoAtualizacao).where(eq(usuarios.idExterno, valores.idExterno));
    } else {
      await db.insert(usuarios).values(valores);
    }
  } catch (error) {
    console.error("[Banco de dados] Falha ao salvar usuário:", error);
    throw error;
  }
}

export async function getUserByOpenId(idExterno: string) {
  const db = await getDb();
  const resultado = await db.select().from(usuarios).where(eq(usuarios.idExterno, idExterno)).limit(1);

  return resultado.length > 0 ? resultado[0] : undefined;
}

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";
import fs from "node:fs";
import path from "node:path";
import { NovoUsuario, usuarios } from "../drizzle/schema";
import { ENV } from "./_core/env";

/** Endereço padrão: MySQL local, usuário root sem senha (como fica o MySQL portátil iniciado com --initialize-insecure). */
export const URL_PADRAO_BANCO = "mysql://root@127.0.0.1:3306/ecocondo";
const pastaMigracoes = path.resolve(import.meta.dirname, "..", "drizzle");

export function urlDoBanco() {
  return ENV.databaseUrl || URL_PADRAO_BANCO;
}

/** DATABASE_SSL_CA aceita o caminho do certificado (ex.: ./ca.pem) ou o próprio texto dele, colado numa variável do painel de hospedagem. */
export function lerCertificado(valor: string) {
  if (valor.includes("-----BEGIN")) return valor.replace(/\\n/g, "\n");
  return fs.readFileSync(path.resolve(valor), "utf8");
}

/** SSL opcional, exigido pela maioria dos serviços de MySQL na nuvem; DATABASE_SSL_CA traz o certificado do provedor, quando ele fornece um. */
function opcoesSsl() {
  if (process.env.DATABASE_SSL !== "true") return {};
  const ca = process.env.DATABASE_SSL_CA ? lerCertificado(process.env.DATABASE_SSL_CA) : undefined;
  return { ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) } };
}

/** Opções de conexão comuns: datas sempre em UTC. */
function opcoesConexao(url: string) {
  return { uri: url, timezone: "Z", charset: "utf8mb4", ...opcoesSsl() };
}

export function criarDrizzle(conexao: mysql.Pool | mysql.Connection) {
  return drizzle(conexao);
}

export type BancoDados = ReturnType<typeof criarDrizzle>;

let _pool: mysql.Pool | null = null;
let _db: BancoDados | null = null;

// Banco MySQL acessado por um pool de conexões; cada conexão nova grava e lê datas em UTC.
export async function getDb() {
  if (!_db) {
    _pool = mysql.createPool({ ...opcoesConexao(urlDoBanco()), connectionLimit: 10 });
    _pool.on("connection", (conexao) => {
      conexao.query("SET time_zone = '+00:00'");
    });
    _db = criarDrizzle(_pool);
  }
  return _db;
}

/** Encerra o pool (scripts e testes chamam ao final para o processo terminar). */
export async function fecharDb() {
  if (_pool) await _pool.end();
  _pool = null;
  _db = null;
}

/** Abre uma conexão avulsa (sem pool) com as mesmas opções; usada em testes que precisam de transação manual. */
export async function abrirConexao(url = urlDoBanco()) {
  const conexao = await mysql.createConnection(opcoesConexao(url));
  await conexao.query("SET time_zone = '+00:00'");
  return conexao;
}

/** Separa o nome do banco do endereço do servidor (ex.: mysql://root@localhost:3306/ecocondo → "ecocondo"). */
export function separarNomeDoBanco(url: string) {
  const endereco = new URL(url);
  const nome = decodeURIComponent(endereco.pathname.replace(/^\//, ""));
  if (!/^[A-Za-z0-9_]+$/.test(nome)) throw new Error(`Nome de banco inválido em DATABASE_URL: "${nome}". Use só letras, números e _.`);
  endereco.pathname = "/";
  return { nome, urlServidor: endereco.toString() };
}

/** Cria o banco (se ainda não existir) e aplica as migrações pendentes. Pode ser chamada várias vezes. */
export async function prepararBanco(opcoes: { recriar?: boolean } = {}) {
  const { nome, urlServidor } = separarNomeDoBanco(urlDoBanco());
  const servidor = await abrirConexao(urlServidor);
  try {
    if (opcoes.recriar) await servidor.query(`DROP DATABASE IF EXISTS \`${nome}\``);
    await servidor.query(`CREATE DATABASE IF NOT EXISTS \`${nome}\` CHARACTER SET utf8mb4`);
  } finally {
    await servidor.end();
  }
  await migrate(await getDb(), { migrationsFolder: pastaMigracoes });
}

/** Apaga um banco inteiro (usado pelos testes para remover o banco temporário). */
export async function apagarBanco(url: string) {
  const { nome, urlServidor } = separarNomeDoBanco(url);
  const servidor = await abrirConexao(urlServidor);
  try {
    await servidor.query(`DROP DATABASE IF EXISTS \`${nome}\``);
  } finally {
    await servidor.end();
  }
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

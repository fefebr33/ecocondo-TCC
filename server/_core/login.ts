import { COOKIE_NAME, ONE_YEAR_MS } from "../../shared/const";
import { eq } from "drizzle-orm";
import type { Express, Request, Response } from "express";
import * as bancoUsuarios from "../db";
import { getDb } from "../db";
import { condominios, papeisEco, pessoas, moradores, perfisAcesso } from "../../drizzle/schema";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import { ENV } from "./env";

type PapelEco = (typeof papeisEco)[number];

const CONTAS_DEMONSTRACAO: Record<PapelEco, { idExterno: string; nome: string; email: string }> = {
  administrador: { idExterno: "demo-administrador", nome: "Ana Administradora", email: "admin@ecocondo.local" },
  coletor: { idExterno: "demo-coletor", nome: "Carlos Coletor", email: "coletor@ecocondo.local" },
  morador: { idExterno: "demo-morador", nome: "Marina Moradora", email: "morador@ecocondo.local" },
};

async function garantirCondominio() {
  const db = await getDb();
  const existente = await db.select().from(condominios).limit(1);
  if (existente[0]) return existente[0];
  const inserido = await db.insert(condominios).values({
    nome: "Condomínio Parque das Flores",
    cidade: "São Paulo",
    estado: "SP",
    quantidadeBlocos: 4,
  }).returning({ id: condominios.id });
  return { id: inserido[0].id };
}

/** Cria (ou reaproveita) a conta fixa de demonstração de um perfil, com perfil de acesso e cadastro de pessoa. Também usada pelo `pnpm db:seed`. */
export async function garantirContaDemonstracao(papel: PapelEco) {
  const conta = CONTAS_DEMONSTRACAO[papel];
  const db = await getDb();

  await bancoUsuarios.upsertUser({
    idExterno: conta.idExterno,
    nome: conta.nome,
    email: conta.email,
    metodoLogin: "demo",
    papel: papel === "administrador" ? "administrador" : "usuario",
    ultimoAcesso: new Date(),
  });
  const usuario = await bancoUsuarios.getUserByOpenId(conta.idExterno);
  if (!usuario) return null;

  const condominio = await garantirCondominio();

  let moradorId: number | null = null;
  if (papel === "morador") {
    const moradorExistente = await db.select().from(moradores).where(eq(moradores.usuarioId, usuario.id)).limit(1);
    if (moradorExistente[0]) {
      moradorId = moradorExistente[0].id;
    } else {
      const moradorInserido = await db.insert(moradores).values({
        condominioId: condominio.id,
        usuarioId: usuario.id,
        nome: conta.nome,
        email: conta.email,
        bloco: "A",
        apartamento: "101",
      }).returning({ id: moradores.id });
      moradorId = moradorInserido[0].id;
    }
  }

  const perfilExistente = await db.select().from(perfisAcesso).where(eq(perfisAcesso.usuarioId, usuario.id)).limit(1);
  if (perfilExistente[0]) {
    await db.update(perfisAcesso).set({ papel, moradorId, atualizadoEm: new Date() }).where(eq(perfisAcesso.usuarioId, usuario.id));
  } else {
    await db.insert(perfisAcesso).values({ usuarioId: usuario.id, condominioId: condominio.id, moradorId, papel });
  }

  const pessoaExistente = await db.select().from(pessoas).where(eq(pessoas.usuarioId, usuario.id)).limit(1);
  if (pessoaExistente[0]) {
    await db.update(pessoas).set({ papel, moradorId, statusAcesso: "ativo", atualizadoEm: new Date() }).where(eq(pessoas.usuarioId, usuario.id));
  } else {
    await db.insert(pessoas).values({
      condominioId: condominio.id,
      usuarioId: usuario.id,
      moradorId,
      nome: conta.nome,
      email: conta.email,
      papel,
      statusAcesso: "ativo",
    });
  }
  return usuario;
}

/** Login local de demonstração — cria/reaproveita uma conta fixa por perfil, sem depender de nenhum serviço externo. */
export function registerLoginRoute(app: Express) {
  if (ENV.isProduction && ENV.loginDemonstracaoAtivo) {
    console.warn("[Segurança] Login de demonstração ativo em produção: qualquer visitante pode entrar como administrador. Use LOGIN_DEMONSTRACAO=desativado num servidor público.");
  }
  app.get("/api/auth/entrar", async (req: Request, res: Response) => {
    if (!ENV.loginDemonstracaoAtivo) {
      res.status(403).json({ error: "O login de demonstração está desativado neste servidor." });
      return;
    }
    const papelParam = req.query.role;
    const papel: PapelEco = papeisEco.includes(papelParam as PapelEco) ? (papelParam as PapelEco) : "morador";
    const conta = CONTAS_DEMONSTRACAO[papel];
    const usuario = await garantirContaDemonstracao(papel);
    if (!usuario) {
      res.status(500).json({ error: "Não foi possível criar o usuário de demonstração." });
      return;
    }

    const sessionToken = await sdk.createSessionToken(conta.idExterno, { name: conta.nome, expiresInMs: ONE_YEAR_MS });
    res.cookie(COOKIE_NAME, sessionToken, { ...getSessionCookieOptions(req), maxAge: ONE_YEAR_MS });
    res.redirect(302, "/dashboard");
  });
}

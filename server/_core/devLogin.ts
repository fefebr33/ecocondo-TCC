import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { ENV } from "./env";
import { sdk } from "./sdk";

// Login de demonstração local, usado apenas fora de produção quando não há um
// servidor OAuth configurado (ex.: apresentação em sala, ambiente de teste).
// Cria/reaproveita um usuário administrador de demonstração e assina a sessão
// normalmente, sem depender de nenhum serviço externo.
export function registerDevLoginRoute(app: Express) {
  if (ENV.isProduction) return;

  app.get("/api/dev/login", async (_req: Request, res: Response) => {
    const openId = "demo-administrador";

    await db.upsertUser({
      openId,
      name: "Administrador (demonstração)",
      email: "demo@ecocondo.local",
      loginMethod: "demo",
      role: "admin",
      lastSignedIn: new Date(),
    });

    const sessionToken = await sdk.createSessionToken(openId, {
      name: "Administrador (demonstração)",
      expiresInMs: ONE_YEAR_MS,
    });

    // http local (sem TLS): sameSite "none" exige "secure", que não existe aqui.
    res.cookie(COOKIE_NAME, sessionToken, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: false,
      maxAge: ONE_YEAR_MS,
    });
    res.redirect(302, "/dashboard");
  });
}

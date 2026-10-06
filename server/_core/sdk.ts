import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import { ForbiddenError } from "../../shared/_core/errors";
import { ENV } from "./env";
import { SESSAO_MS } from "../../shared/const";
import { randomBytes } from "node:crypto";
import { acessoDesativado, sessaoEncerrada } from "../senhas";

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export type SessionPayload = {
  openId: string;
  appId: string;
  name: string;
  /** Versão da sessão do usuário quando o token foi emitido (usuarios.versao_sessao). */
  versao: number;
  /** Identificador desta sessão (deste aparelho), para o "Sair" encerrar só ela. */
  sessaoId: string;
};

class SDKServer {
  private parseCookies(cookieHeader: string | undefined) {
    if (!cookieHeader) return new Map<string, string>();
    return new Map(Object.entries(parseCookieHeader(cookieHeader)));
  }

  private getSessionSecret() {
    return new TextEncoder().encode(ENV.cookieSecret);
  }

  /**
   * Assina um token de sessão (JWT) para o openId informado.
   */
  async createSessionToken(
    openId: string,
    options: { expiresInMs?: number; name?: string; versao?: number } = {}
  ): Promise<string> {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || "",
        versao: options.versao ?? 0,
        sessaoId: randomBytes(16).toString("hex"),
      },
      options
    );
  }

  async signSession(
    payload: SessionPayload,
    options: { expiresInMs?: number } = {}
  ): Promise<string> {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? SESSAO_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);

    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name,
      v: payload.versao,
      sid: payload.sessaoId,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime(expirationSeconds)
      .sign(this.getSessionSecret());
  }

  async verifySession(
    cookieValue: string | undefined | null
  ): Promise<(SessionPayload & { expiraEm: Date | null }) | null> {
    if (!cookieValue) return null;

    try {
      const { payload } = await jwtVerify(
        cookieValue,
        this.getSessionSecret(),
        {
          algorithms: ["HS256"],
        }
      );
      const { openId, appId, name, v, sid, exp } = payload as Record<
        string,
        unknown
      >;

      if (
        !isNonEmptyString(openId) ||
        !isNonEmptyString(appId) ||
        !isNonEmptyString(name)
      ) {
        return null;
      }

      return {
        openId,
        appId,
        name,
        versao: typeof v === "number" ? v : 0,
        sessaoId: typeof sid === "string" ? sid : "",
        expiraEm: typeof exp === "number" ? new Date(exp * 1000) : null,
      };
    } catch {
      return null;
    }
  }

  /** Token de sessão da requisição: cookie ou cabeçalho Authorization: Bearer. */
  tokenDaRequisicao(req: Pick<Request, "headers">) {
    const cookies = this.parseCookies(req.headers?.cookie);
    const sessionToken = cookies.get("app_session_id");
    if (sessionToken) return sessionToken;
    const authHeader = req.headers?.authorization;
    return typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : undefined;
  }

  async authenticateRequest(req: Request): Promise<AuthenticatedUser> {
    const db = await import("../db");
    const session = await this.verifySession(this.tokenDaRequisicao(req));
    if (!session) throw ForbiddenError("Sessão inválida ou expirada.");

    const user = await db.getUserByOpenId(session.openId);
    if (!user) throw ForbiddenError("Usuário não encontrado.");
    // Saiu do sistema, trocou a senha ou teve o acesso desativado depois que este token foi emitido: a sessão não vale mais.
    if (session.versao !== user.versaoSessao)
      throw ForbiddenError("Sessão encerrada. Entre de novo.");
    if (await sessaoEncerrada(session.sessaoId))
      throw ForbiddenError("Sessão encerrada. Entre de novo.");
    if (await acessoDesativado(user.id))
      throw ForbiddenError(
        "Seu acesso ao EcoCondo foi desativado pela administração."
      );

    await db.upsertUser({
      idExterno: user.idExterno,
      ultimoAcesso: new Date(),
    });

    return user;
  }
}

export type AuthenticatedUser = import("../../drizzle/schema").Usuario;

export const sdk = new SDKServer();

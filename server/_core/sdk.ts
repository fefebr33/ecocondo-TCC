import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import { ForbiddenError } from "../../shared/_core/errors";
import { ENV } from "./env";

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export type SessionPayload = {
  openId: string;
  appId: string;
  name: string;
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
    options: { expiresInMs?: number; name?: string } = {},
  ): Promise<string> {
    return this.signSession(
      { openId, appId: ENV.appId, name: options.name || "" },
      options,
    );
  }

  async signSession(
    payload: SessionPayload,
    options: { expiresInMs?: number } = {},
  ): Promise<string> {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? 1000 * 60 * 60 * 24 * 365;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);

    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime(expirationSeconds)
      .sign(this.getSessionSecret());
  }

  async verifySession(
    cookieValue: string | undefined | null,
  ): Promise<{ openId: string; appId: string; name: string } | null> {
    if (!cookieValue) return null;

    try {
      const { payload } = await jwtVerify(cookieValue, this.getSessionSecret(), {
        algorithms: ["HS256"],
      });
      const { openId, appId, name } = payload as Record<string, unknown>;

      if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || !isNonEmptyString(name)) {
        return null;
      }

      return { openId, appId, name };
    } catch {
      return null;
    }
  }

  async authenticateRequest(req: Request): Promise<AuthenticatedUser> {
    const db = await import("../db");
    const cookies = this.parseCookies(req.headers.cookie);
    let sessionToken = cookies.get("app_session_id");

    if (!sessionToken) {
      const authHeader = req.headers.authorization;
      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        sessionToken = authHeader.slice(7);
      }
    }

    const session = await this.verifySession(sessionToken);
    if (!session) throw ForbiddenError("Sessão inválida ou expirada.");

    const user = await db.getUserByOpenId(session.openId);
    if (!user) throw ForbiddenError("Usuário não encontrado.");

    await db.upsertUser({ openId: user.openId, lastSignedIn: new Date() });

    return user;
  }
}

export type AuthenticatedUser = import("../../drizzle/schema").User;

export const sdk = new SDKServer();

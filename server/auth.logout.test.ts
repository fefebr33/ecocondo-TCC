import { describe, expect, it, vi } from "vitest";

// Sair também encerra esta sessão no servidor; aqui só conferimos a chamada, sem banco.
const encerrarSessao = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("./senhas", async (original) => ({ ...(await original<typeof import("./senhas")>()), encerrarSessao }));
vi.mock("./db", async (original) => ({ ...(await original<typeof import("./db")>()), getDb: vi.fn(async () => ({})) }));
import { appRouter } from "./rotas";
import { sdk } from "./_core/sdk";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";

type CookieCall = {
  name: string;
  options: Record<string, unknown>;
};

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext; clearedCookies: CookieCall[] } {
  const clearedCookies: CookieCall[] = [];

  const user: AuthenticatedUser = {
    id: 1,
    openId: "sample-user",
    email: "sample@example.com",
    name: "Sample User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as TrpcContext["res"],
  };

  return { ctx, clearedCookies };
}

describe("auth.logout", () => {
  it("clears the session cookie and reports success", async () => {
    const { ctx, clearedCookies } = createAuthContext();
    const token = await sdk.createSessionToken("sample-user", { name: "Sample User" });
    ctx.req.headers.cookie = `${COOKIE_NAME}=${token}`;
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.logout();

    expect(result).toEqual({ success: true });
    expect(encerrarSessao).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ usuarioId: 1, sessaoId: expect.stringMatching(/^[0-9a-f]{32}$/) }));
    expect(clearedCookies).toHaveLength(1);
    expect(clearedCookies[0]?.name).toBe(COOKIE_NAME);
    expect(clearedCookies[0]?.options).toMatchObject({
      maxAge: -1,
      secure: true,
      sameSite: "lax",
      httpOnly: true,
      path: "/",
    });
  });
});

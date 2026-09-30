import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { publicProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { encerrarSessao } from "./senhas";
import { sdk } from "./_core/sdk";
import { ecoRouter } from "./rotas/nucleo";
import { operationsRouter } from "./rotas/operacoes";
import { analyticsRouter } from "./rotas/indicadores";
import { sustainabilityRouter } from "./rotas/sustentabilidade";
import { auditRouter } from "./rotas/auditoria";
import { podioRouter } from "./rotas/podio";
import { personalGoalsRouter } from "./rotas/metasPessoais";
import { certificatesRouter } from "./rotas/certificados";
import { estacoesRouter } from "./rotas/estacoes";
import { contaRouter } from "./rotas/conta";
import { configuracoesDescarteRouter } from "./rotas/configuracoesDescarte";

export const appRouter = router({
  auth: router({
    ...contaRouter._def.record,
    logout: publicProcedure.mutation(async ({ ctx }) => {
      // Sair encerra esta sessão no servidor: o cookie copiado ou esquecido neste aparelho deixa de valer.
      const sessao = await sdk.verifySession(sdk.tokenDaRequisicao(ctx.req));
      if (ctx.user && sessao) await encerrarSessao(await getDb(), { sessaoId: sessao.sessaoId, usuarioId: ctx.user.id, expiraEm: sessao.expiraEm }).catch((error) => console.warn("[Sessão] Não foi possível encerrar a sessão no servidor:", error));
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  ...ecoRouter._def.record,
  ...operationsRouter._def.record,
  ...analyticsRouter._def.record,
  ...sustainabilityRouter._def.record,
  ...auditRouter._def.record,
  ...podioRouter._def.record,
  ...personalGoalsRouter._def.record,
  ...certificatesRouter._def.record,
  ...estacoesRouter._def.record,
  ...configuracoesDescarteRouter._def.record,
});

export type AppRouter = typeof appRouter;

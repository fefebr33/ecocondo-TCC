import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { publicProcedure, router } from "./_core/trpc";
import { ecoRouter } from "./rotas/nucleo";
import { operationsRouter } from "./rotas/operacoes";
import { analyticsRouter } from "./rotas/indicadores";
import { sustainabilityRouter } from "./rotas/sustentabilidade";
import { auditRouter } from "./rotas/auditoria";
import { podioRouter } from "./rotas/podio";
import { personalGoalsRouter } from "./rotas/metasPessoais";
import { certificatesRouter } from "./rotas/certificados";
import { recurrenceRouter } from "./rotas/recorrencia";
import { estacoesRouter } from "./rotas/estacoes";

export const appRouter = router({
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
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
  ...recurrenceRouter._def.record,
  ...estacoesRouter._def.record,
});

export type AppRouter = typeof appRouter;

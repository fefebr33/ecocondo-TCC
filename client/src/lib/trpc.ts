import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "../../../server/rotas";

export const trpc = createTRPCReact<AppRouter>();

import { randomBytes } from "node:crypto";

const isProduction = process.env.NODE_ENV === "production";

/** Em produção, sem JWT_SECRET, nunca usa a chave pública de demonstração: gera uma aleatória (as sessões expiram ao reiniciar). */
function segredoDaSessao() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (!isProduction) return "chave-local-de-demonstracao-troque-em-producao";
  console.warn("[Segurança] JWT_SECRET não definido: usando uma chave aleatória. Defina JWT_SECRET para manter as sessões após reiniciar o servidor.");
  return randomBytes(32).toString("hex");
}

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "ecocondo",
  cookieSecret: segredoDaSessao(),
  databaseUrl: process.env.DATABASE_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction,
  /** O login de demonstração (sem senha) é o único acesso do protótipo; LOGIN_DEMONSTRACAO=desativado o desliga num servidor público. */
  loginDemonstracaoAtivo: process.env.LOGIN_DEMONSTRACAO !== "desativado",
};

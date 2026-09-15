export const ENV = {
  appId: process.env.VITE_APP_ID ?? "ecocondo",
  cookieSecret: process.env.JWT_SECRET ?? "chave-local-de-demonstracao-troque-em-producao",
  databaseUrl: process.env.DATABASE_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
};

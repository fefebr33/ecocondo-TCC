/** Cria o banco MySQL (se ainda não existir) e aplica as migrações da pasta drizzle/ (pnpm db:push). */
import "dotenv/config";
import { fecharDb, prepararBanco } from "../db";

prepararBanco()
  .then(async () => {
    console.log("Banco MySQL pronto: tabelas criadas/atualizadas.");
    await fecharDb();
  })
  .catch((error) => {
    console.error("Não foi possível preparar o banco MySQL. Confira se o MySQL está rodando e o DATABASE_URL do arquivo .env.");
    console.error(error);
    process.exit(1);
  });

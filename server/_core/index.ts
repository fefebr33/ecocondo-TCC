import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerLoginRoute } from "./login";
import { registrarCabecalhosDeSeguranca } from "./seguranca";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../rotas";
import { getDb, prepararBanco, urlDoBanco } from "../db";
import { encerrarPenalidadesVencidas } from "../penalidades";
import { lembrarAuditoriasParadas } from "../lembretesAuditoria";
import { processarCampanhas } from "../campanhas";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { runAnnualReport, sendAnnualReportCheck } from "../scheduled/annualReport";
import { notificarFalhaOperacional } from "../notificacoes";

/** Registra a falha no log do servidor e avisa os administradores (notificação de falha operacional). */
function falhaDaRotina(rotina: string) {
  return (error: unknown) => {
    console.error(`[${rotina}] falha na verificação:`, error);
    return notificarFalhaOperacional(`Falha na rotina: ${rotina}`, `A rotina automática "${rotina}" falhou: ${error instanceof Error ? error.message : String(error)}. Ela roda de novo na próxima hora; se o aviso se repetir, confira o servidor e o banco de dados.`);
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

/** Cria o banco MySQL (se preciso) e aplica as migrações antes de abrir o servidor. */
async function conectarBanco() {
  try {
    await prepararBanco();
  } catch (error) {
    const endereco = new URL(urlDoBanco());
    endereco.password = endereco.password ? "****" : "";
    console.error(`[Banco de dados] Não foi possível conectar ao MySQL em ${endereco.toString()}. Confira se o MySQL está rodando e o DATABASE_URL do arquivo .env (veja o README).`);
    throw error;
  }
}

async function startServer() {
  await conectarBanco();
  const app = express();
  // Atrás do proxy do Render ou do Codespaces: confia só no último salto, para req.ip ser o endereço real de quem acessa
  // (usado no bloqueio de senhas erradas por origem). Sem proxy, não confia no cabeçalho (que o próprio visitante poderia
  // inventar para fugir do bloqueio). TRUST_PROXY=1 liga e TRUST_PROXY=0 desliga em outros servidores.
  const atrasDeProxy = process.env.TRUST_PROXY ? process.env.TRUST_PROXY === "1" : Boolean(process.env.RENDER || process.env.CODESPACES);
  app.set("trust proxy", atrasDeProxy ? 1 : false);
  const server = createServer(app);
  // Fotos chegam em base64 dentro do JSON (até ~5,5 MB validados nas rotas); o limite fica logo acima disso.
  registrarCabecalhosDeSeguranca(app);
  app.use(express.json({ limit: "8mb" }));
  app.use(express.urlencoded({ limit: "1mb", extended: true }));
  registerStorageProxy(app);
  registerLoginRoute(app);
  app.get("/api/health", (_req, res) => res.json({ ok: true, timestamp: Date.now() }));
  app.post("/api/scheduled/annual-report", sendAnnualReportCheck);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });

  // Em janeiro, gera o relatório anual consolidado.
  runAnnualReport().catch(falhaDaRotina("Relatório anual"));
  setInterval(() => {
    runAnnualReport().catch(falhaDaRotina("Relatório anual"));
  }, DAY_MS);

  // De hora em hora: encerra suspensões vencidas, lembra auditorias paradas e cuida das campanhas (começo, fim da pausa, "faltam poucos dias", encerramento).
  const rotinaHoraria = async () => {
    const db = await getDb();
    await encerrarPenalidadesVencidas(db);
    await processarCampanhas(db);
    await lembrarAuditoriasParadas(db);
  };
  rotinaHoraria().catch(falhaDaRotina("Campanhas e medidas"));
  setInterval(() => {
    rotinaHoraria().catch(falhaDaRotina("Campanhas e medidas"));
  }, HOUR_MS);
}

startServer().catch((error) => {
  console.error(error);
  process.exit(1);
});

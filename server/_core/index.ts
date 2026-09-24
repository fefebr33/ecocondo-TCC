import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerLoginRoute } from "./login";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../rotas";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { runCollectionReminders, sendCollectionReminders } from "../scheduled/collectionReminders";
import { runAnnualReport, sendAnnualReportCheck } from "../scheduled/annualReport";
import { runRecurringCollections, sendRecurringCollectionsCheck } from "../scheduled/recurringCollections";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

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

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Fotos chegam em base64 dentro do JSON (até ~5,5 MB validados nas rotas); o limite fica logo acima disso.
  app.use(express.json({ limit: "8mb" }));
  app.use(express.urlencoded({ limit: "1mb", extended: true }));
  registerStorageProxy(app);
  registerLoginRoute(app);
  app.get("/api/health", (_req, res) => res.json({ ok: true, timestamp: Date.now() }));
  app.post("/api/scheduled/collection-reminders", sendCollectionReminders);
  app.post("/api/scheduled/annual-report", sendAnnualReportCheck);
  app.post("/api/scheduled/recurring-collections", sendRecurringCollectionsCheck);
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

  // A cada hora, sem agendador externo: gera as coletas recorrentes ("toda terça, bloco B") com um dia de antecedência e, em seguida,
  // cria os lembretes das coletas das próximas 24h (a ordem garante que a coleta recém-gerada já receba o lembrete).
  const verificarColetas = () =>
    runRecurringCollections()
      .catch((error) => console.error("[Recorrência] falha na verificação:", error))
      .then(() => runCollectionReminders())
      .catch((error) => console.error("[Lembretes] falha na verificação:", error));
  verificarColetas();
  setInterval(verificarColetas, HOUR_MS);

  // Em janeiro, gera o relatório anual consolidado.
  runAnnualReport().catch((error) => console.error("[Relatório anual] falha na verificação inicial:", error));
  setInterval(() => {
    runAnnualReport().catch((error) => console.error("[Relatório anual] falha na verificação periódica:", error));
  }, DAY_MS);
}

startServer().catch(console.error);

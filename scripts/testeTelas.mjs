// Teste das telas no navegador (usado no CI depois do build): entra como administrador e como morador, abre as telas
// no notebook (1366 px) e no celular (390 px) e falha se houver erro de JavaScript, resposta de erro do servidor,
// rolagem lateral no celular ou problema de acessibilidade (axe, WCAG 2 AA).
// Uso: com o servidor rodando e os dados de demonstração (pnpm db:seed --limpar), `pnpm test:telas`.
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const BASE = process.env.URL_TESTE ?? "http://localhost:3000";
const SENHA = "ecocondo123";
const ROTAS = ["/dashboard", "/descartes", "/moradores", "/pessoas", "/relatorios", "/auditoria", "/engajamento", "/podio", "/guia", "/notificacoes", "/ambiental", "/comunidade", "/configuracoes", "/manual"];
const PERFIS = [["administrador", "admin@ecocondo.local"], ["morador", "morador@ecocondo.local"]];
const TELAS = [["notebook", { width: 1366, height: 800 }], ["celular", { width: 390, height: 844 }]];

const navegador = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const problemas = [];
let abertas = 0;

async function entrar(contexto, email) {
  const pagina = await contexto.newPage();
  await pagina.goto(`${BASE}/entrar`);
  await pagina.fill("input[type=email]", email);
  await pagina.fill("input[type=password]", SENHA);
  await pagina.click('button:has-text("Entrar")');
  await pagina.waitForURL(/\/(dashboard|manual)/, { timeout: 15_000 });
  // No primeiro acesso a Marina cai no manual obrigatório.
  if (pagina.url().includes("/manual")) {
    await pagina.check("input[type=checkbox]");
    await pagina.click('button:has-text("Li e entendi")');
    await pagina.waitForURL(/\/dashboard/, { timeout: 15_000 });
  }
  await pagina.close();
}

for (const [perfil, email] of PERFIS) {
  for (const [tela, viewport] of TELAS) {
    const contexto = await navegador.newContext({ viewport, locale: "pt-BR" });
    await entrar(contexto, email);
    for (const rota of ROTAS) {
      const pagina = await contexto.newPage();
      const erros = [];
      pagina.on("pageerror", (erro) => erros.push(`erro de JavaScript: ${erro.message}`));
      pagina.on("response", (resposta) => {
        if (resposta.url().startsWith(BASE) && resposta.status() >= 400) erros.push(`HTTP ${resposta.status()} em ${resposta.url().replace(BASE, "")}`);
      });
      await pagina.goto(`${BASE}${rota}`, { waitUntil: "networkidle" });
      await pagina.waitForTimeout(500);
      abertas += 1;
      if (tela === "celular") {
        const sobra = await pagina.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (sobra > 2) erros.push(`rolagem lateral de ${sobra} px`);
      } else {
        const { violations } = await new AxeBuilder({ page: pagina }).withTags(["wcag2a", "wcag2aa"]).analyze();
        for (const violacao of violations) erros.push(`acessibilidade: ${violacao.id} (${violacao.nodes.length}) em ${violacao.nodes[0]?.target.join(" ")}`);
      }
      for (const erro of erros) problemas.push(`${perfil} · ${tela} · ${rota}: ${erro}`);
      await pagina.close();
    }
    await contexto.close();
  }
}
await navegador.close();

console.log(`${abertas} telas abertas.`);
if (problemas.length) {
  console.error(`${problemas.length} problema(s):\n${problemas.join("\n")}`);
  process.exit(1);
}
console.log("Nenhum problema: sem erros, sem rolagem lateral no celular e sem violações de acessibilidade.");

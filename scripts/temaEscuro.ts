/**
 * Gera client/src/tema-escuro.css: as telas usam muitas cores fixas (ex.: bg-[#e8f4ed], text-[#0f7350]) pensadas para o fundo claro.
 * Este script procura essas classes no código e escreve, para o modo escuro, a versão de cada cor: fundos claros viram
 * superfícies escuras do mesmo tom, textos escuros ficam claros e bordas claras ficam discretas. As regras ficam fora das
 * camadas do Tailwind, então valem por cima das classes originais quando a página tem a classe "dark".
 *
 * Roda sozinho no `pnpm dev` e no `pnpm build` (plugin do Vite); à mão: `pnpm tema:escuro`.
 */
import fs from "node:fs";
import path from "node:path";

type Rgb = { r: number; g: number; b: number; a: number };
type Hsl = { h: number; s: number; l: number };

const PREFIXOS: Record<string, { propriedade: string; tipo: "fundo" | "texto" | "borda" | "anel" | "divisoria" }> = {
  bg: { propriedade: "background-color", tipo: "fundo" },
  text: { propriedade: "color", tipo: "texto" },
  border: { propriedade: "border-color", tipo: "borda" },
  "border-t": { propriedade: "border-top-color", tipo: "borda" },
  "border-b": { propriedade: "border-bottom-color", tipo: "borda" },
  "border-l": { propriedade: "border-left-color", tipo: "borda" },
  "border-r": { propriedade: "border-right-color", tipo: "borda" },
  divide: { propriedade: "border-color", tipo: "divisoria" },
  ring: { propriedade: "--tw-ring-color", tipo: "anel" },
  outline: { propriedade: "outline-color", tipo: "anel" },
  fill: { propriedade: "fill", tipo: "texto" },
  stroke: { propriedade: "stroke", tipo: "texto" },
};

const VARIANTES: Record<string, (seletor: string) => string> = {
  "": (seletor) => `.dark ${seletor}`,
  "hover:": (seletor) => `.dark ${seletor}:hover`,
  "focus:": (seletor) => `.dark ${seletor}:focus`,
  "focus-visible:": (seletor) => `.dark ${seletor}:focus-visible`,
  "active:": (seletor) => `.dark ${seletor}:active`,
  "disabled:": (seletor) => `.dark ${seletor}:disabled`,
  "group-hover:": (seletor) => `.dark .group:hover ${seletor}`,
};

const CLASSE_COR = /(?<![\w-])((?:[a-z-]+:)?)(bg|text|border(?:-[tblr])?|divide|ring|outline|fill|stroke)-\[#([0-9a-fA-F]{3,8})\](?:\/(\d{1,3}))?(?![\w-])/g;
const CLASSE_GRADIENTE = /(?<![\w-])((?:[a-z-]+:)?)bg-\[((?:linear|radial)-gradient\([^\]\s"'`]*\))\](?![\w-])/g;

function lerHex(hex: string): Rgb {
  const cheio = hex.length <= 4 ? hex.split("").map((c) => c + c).join("") : hex;
  const n = (i: number) => parseInt(cheio.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: cheio.length === 8 ? n(6) / 255 : 1 };
}

function paraHsl({ r, g, b }: Rgb): Hsl {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rr ? (gg - bb) / d + (gg < bb ? 6 : 0) : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
  return { h: h * 60, s, l };
}

function paraRgb({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255), a: 1 };
}

function escrever(cor: Rgb, alfa = cor.a) {
  const hex = `#${[cor.r, cor.g, cor.b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  return alfa >= 1 ? hex : `rgb(${cor.r} ${cor.g} ${cor.b} / ${Math.round(alfa * 1000) / 1000})`;
}

const limitar = (valor: number, min: number, max: number) => Math.min(max, Math.max(min, valor));

/** Fundo claro vira superfície escura do mesmo tom; fundos escuros (botões, faixas verdes) ficam como estão. */
function fundoEscuro(cor: Rgb): Rgb | null {
  const hsl = paraHsl(cor);
  if (hsl.l < 0.8) return null;
  if (cor.r === 255 && cor.g === 255 && cor.b === 255) return lerHex("16201b");
  return paraRgb({ h: hsl.h, s: Math.min(hsl.s * 0.45, 0.4), l: limitar(0.12 + (1 - hsl.l) * 0.9, 0.13, 0.26) });
}

/** Texto escuro fica claro, mantendo o tom (verde continua verde, vermelho continua vermelho). */
function textoClaro(cor: Rgb): Rgb | null {
  const hsl = paraHsl(cor);
  if (hsl.l >= 0.62) return null;
  const neutro = hsl.s < 0.15;
  if (neutro) return paraRgb({ h: hsl.h, s: Math.min(hsl.s, 0.1), l: limitar(0.75 + (0.62 - hsl.l) * 0.3, 0.75, 0.92) });
  return paraRgb({ h: hsl.h, s: Math.min(hsl.s, 0.55), l: limitar(0.64 + (0.62 - hsl.l) * 0.15, 0.64, 0.74) });
}

/** Borda clara fica discreta no fundo escuro. */
function bordaEscura(cor: Rgb): Rgb | null {
  const hsl = paraHsl(cor);
  if (hsl.l < 0.72) return null;
  return paraRgb({ h: hsl.h, s: Math.min(hsl.s * 0.4, 0.25), l: limitar(0.2 + (1 - hsl.l) * 0.4, 0.2, 0.3) });
}

function converter(tipo: string, cor: Rgb): Rgb | null {
  if (tipo === "fundo") return fundoEscuro(cor);
  if (tipo === "texto" || tipo === "anel") return textoClaro(cor);
  return bordaEscura(cor);
}

/** Escapa o nome da classe para usar no seletor CSS (ex.: bg-[#fff]/80 → bg-\[\#fff\]\/80). */
function escaparClasse(classe: string) {
  return classe.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

function arquivosDoCliente(pasta: string): string[] {
  return fs.readdirSync(pasta, { withFileTypes: true }).flatMap((item) => {
    const caminho = path.join(pasta, item.name);
    if (item.isDirectory()) return arquivosDoCliente(caminho);
    return /\.(tsx?|jsx?)$/.test(item.name) ? [caminho] : [];
  });
}

/** Regras fixas: classes do Tailwind com nome (bg-white etc.), gráficos e a impressão da folha do QR. */
const REGRAS_FIXAS = `
.dark .bg-white { background-color: var(--card); }
.dark .bg-white\\/80 { background-color: color-mix(in oklab, var(--card) 80%, transparent); }
.dark .hover\\:bg-white:hover { background-color: var(--card); }
.dark .bg-red-100 { background-color: #3a1d1b; }
.dark .text-red-500 { color: #f28b82; }
.dark .text-slate-900 { color: var(--foreground); }
.dark .text-slate-700, .dark .text-slate-600 { color: var(--muted-foreground); }
.dark .border-black\\/10 { border-color: rgb(255 255 255 / 0.12); }
.dark .recharts-cartesian-grid line { stroke: #26332c; }
.dark .recharts-default-tooltip { background: var(--card) !important; border-color: var(--border) !important; color: var(--card-foreground); }
.dark .recharts-legend-item-text { color: var(--muted-foreground) !important; }
.dark img[alt^="Foto"], .dark img[alt^="foto"] { filter: brightness(.92); }
`;

export function gerarCssTemaEscuro(raiz: string) {
  const pasta = path.join(raiz, "client", "src");
  const regras = new Map<string, string>();
  const ignoradas = new Set<string>();
  for (const arquivo of arquivosDoCliente(pasta).sort()) {
    const texto = fs.readFileSync(arquivo, "utf8");
    for (const [classe, variante, prefixo, hex, opacidade] of Array.from(texto.matchAll(CLASSE_COR))) {
      const montarSeletor = VARIANTES[variante];
      if (!montarSeletor) { ignoradas.add(classe); continue; }
      const { propriedade, tipo } = PREFIXOS[prefixo];
      const original = lerHex(hex);
      const nova = converter(tipo, original);
      if (!nova) continue;
      const alfa = opacidade ? Number(opacidade) / 100 : original.a;
      const seletor = montarSeletor(`.${escaparClasse(classe)}`);
      const valor = escrever(nova, alfa);
      const declaracao = tipo === "divisoria" ? `${seletor} > :not(:last-child) { ${propriedade}: ${valor}; }` : `${seletor} { ${propriedade}: ${valor}; }`;
      regras.set(`${seletor}|${propriedade}`, declaracao);
    }
    for (const [classe, variante, gradiente] of Array.from(texto.matchAll(CLASSE_GRADIENTE))) {
      const montarSeletor = VARIANTES[variante];
      if (!montarSeletor) { ignoradas.add(classe); continue; }
      let mudou = false;
      const novo = gradiente.replace(/#([0-9a-fA-F]{3,8})\b/g, (trecho: string, hex: string) => {
        const nova = fundoEscuro(lerHex(hex));
        if (!nova) return trecho;
        mudou = true;
        return escrever(nova);
      });
      if (!mudou) continue;
      const seletor = montarSeletor(`.${escaparClasse(classe)}`);
      regras.set(`${seletor}|background-image`, `${seletor} { background-image: ${novo.replace(/_/g, " ")}; }`);
    }
  }
  const cabecalho = "/* Gerado por scripts/temaEscuro.ts a partir das cores fixas das telas. Não edite à mão: rode `pnpm tema:escuro`. */\n";
  const corpo = Array.from(regras.values()).sort().join("\n");
  return { css: `${cabecalho}${REGRAS_FIXAS.trim()}\n${corpo}\n`, ignoradas: Array.from(ignoradas).sort() };
}

export const ARQUIVO_TEMA_ESCURO = path.join("client", "src", "tema-escuro.css");

/** Escreve o arquivo só quando muda (evita recarregar a página à toa no modo dev). Devolve true quando escreveu. */
export function atualizarTemaEscuro(raiz: string) {
  const { css, ignoradas } = gerarCssTemaEscuro(raiz);
  const destino = path.join(raiz, ARQUIVO_TEMA_ESCURO);
  const atual = fs.existsSync(destino) ? fs.readFileSync(destino, "utf8") : "";
  if (ignoradas.length) console.warn(`[tema escuro] Variantes sem regra (ficam com a cor clara): ${ignoradas.join(", ")}`);
  if (atual === css) return false;
  fs.writeFileSync(destino, css);
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.dirname, "temaEscuro.ts")) {
  const raiz = path.resolve(import.meta.dirname, "..");
  const escreveu = atualizarTemaEscuro(raiz);
  console.log(escreveu ? `[tema escuro] ${ARQUIVO_TEMA_ESCURO} atualizado.` : `[tema escuro] ${ARQUIVO_TEMA_ESCURO} já estava em dia.`);
}

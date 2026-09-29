import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import { atualizarTemaEscuro } from "./scripts/temaEscuro";

/** Mantém client/src/tema-escuro.css em dia com as cores usadas nas telas (modo escuro). */
function temaEscuro(): Plugin {
  const raiz = import.meta.dirname;
  return {
    name: "ecocondo-tema-escuro",
    buildStart() {
      atualizarTemaEscuro(raiz);
    },
    handleHotUpdate({ file }) {
      if (/client[\\/]src[\\/].*\.(tsx?|jsx?)$/.test(file)) atualizarTemaEscuro(raiz);
    },
  };
}

const plugins = [temaEscuro(), react(), tailwindcss(), jsxLocPlugin()];

export default defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    host: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});

import { useEffect } from "react";

/** Rola até o trecho indicado depois do "#" no endereço (ex.: /engajamento#extrato) quando a página termina de carregar. */
export function useAncora(pronto = true) {
  useEffect(() => {
    if (!pronto || typeof window === "undefined" || !window.location.hash) return;
    const id = decodeURIComponent(window.location.hash.slice(1));
    const temporizador = window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    return () => window.clearTimeout(temporizador);
  }, [pronto]);
}

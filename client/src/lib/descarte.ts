import type { SituacaoDescarte, TipoResiduo } from "@shared/descarte";
import { CORES_PADRAO, formatarPontos, rotuloSituacao, TIPOS_RESIDUO } from "@shared/descarte";
import { rotuloResiduo } from "@shared/rotulos";

export { CORES_PADRAO, formatarPontos, rotuloResiduo, rotuloSituacao, TIPOS_RESIDUO };
export type { SituacaoDescarte, TipoResiduo };

/** Nome curto da situação, para selos pequenos e filtros. */
export const rotuloSituacaoCurto: Record<SituacaoDescarte, string> = { pendente: "Pendente", aprovado: "Aprovado", reprovado: "Reprovado", auditoria: "Em auditoria", cancelado: "Cancelado" };

/** Cores do selo de cada situação (claro e escuro). */
export const estiloSituacao: Record<SituacaoDescarte, string> = {
  pendente: "border-0 bg-[#fff3df] text-[#7a4d0a] hover:bg-[#fff3df]",
  aprovado: "border-0 bg-[#e7f5ec] text-[#0a7048] hover:bg-[#e7f5ec]",
  reprovado: "border-0 bg-[#fbeceb] text-[#b3382c] hover:bg-[#fbeceb]",
  auditoria: "border-0 bg-[#efe9fb] text-[#5b3aa6] hover:bg-[#efe9fb]",
  cancelado: "border-0 bg-[#f0f4f2] text-muted-foreground hover:bg-[#f0f4f2]",
};

export function formatarKg(gramas: number | null | undefined) {
  if (gramas === null || gramas === undefined) return "—";
  return `${(gramas / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} kg`;
}

export function formatarDataHora(data: Date | string | null | undefined) {
  if (!data) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(data));
}

/** Bolinha com a cor do saco do tipo (o condomínio fornece sacos coloridos). */
export function corDoTipo(tipo: TipoResiduo, cores?: Partial<Record<TipoResiduo, string>>) {
  return cores?.[tipo] ?? CORES_PADRAO[tipo].cor;
}

function luminancia(hex: string) {
  const [r, g, b] = [1, 3, 5].map((inicio) => parseInt(hex.slice(inicio, inicio + 2), 16) / 255).map((canal) => (canal <= 0.03928 ? canal / 12.92 : ((canal + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Cor do texto sobre a cor do saco: branco quando dá contraste de 4,5:1 (WCAG AA); senão, quase preto (ex.: cinza e laranja). */
export function corDeTextoSobre(fundo: string) {
  if (!/^#[0-9a-f]{6}$/i.test(fundo)) return "#ffffff";
  return 1.05 / (luminancia(fundo) + 0.05) >= 4.5 ? "#ffffff" : "#161a17";
}

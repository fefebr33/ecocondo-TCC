import { eq } from "drizzle-orm";
import { regrasResiduo } from "../drizzle/schema";
import { REGRAS_PADRAO, TIPOS_RESIDUO, pontosDoDescarte, type TipoResiduo } from "@shared/descarte";
import { getDb } from "./db";

export type RegraDoTipo = { tipoResiduo: TipoResiduo; pesoMinimoGramas: number; pesoMaximoGramas: number; pontosPorKg: number; personalizada: boolean };

/** Regras de cada tipo de descarte do condomínio: as que o administrador salvou, e a padrão para os tipos que ele não mexeu. */
export async function regrasDoCondominio(condominioId: number): Promise<Record<TipoResiduo, RegraDoTipo>> {
  const db = await getDb();
  const salvas = await db.select().from(regrasResiduo).where(eq(regrasResiduo.condominioId, condominioId));
  return Object.fromEntries(TIPOS_RESIDUO.map((tipo) => {
    const salva = salvas.find((regra) => regra.tipoResiduo === tipo);
    return [tipo, salva
      ? { tipoResiduo: tipo, pesoMinimoGramas: salva.pesoMinimoGramas, pesoMaximoGramas: salva.pesoMaximoGramas, pontosPorKg: salva.pontosPorKg, personalizada: true }
      : { tipoResiduo: tipo, ...REGRAS_PADRAO[tipo], personalizada: false }];
  })) as Record<TipoResiduo, RegraDoTipo>;
}

/** Pontos de um descarte concluído pela regra do condomínio. */
export async function pontosPelaRegra(condominioId: number, tipo: TipoResiduo, pesoGramas: number | null) {
  const regras = await regrasDoCondominio(condominioId);
  return pontosDoDescarte(pesoGramas, regras[tipo].pontosPorKg);
}

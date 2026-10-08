import { and, eq } from "drizzle-orm";
import { guiasDescarte } from "../drizzle/schema";
import {
  CORES_PADRAO,
  TIPOS_RESIDUO,
  type TipoResiduo,
} from "@shared/descarte";
import { getDb } from "./db";

/** Conteúdo padrão do guia de descarte, usado enquanto o condomínio não personaliza o seu. */
export const guiasPadrao: Array<{
  tipoResiduo: TipoResiduo;
  titulo: string;
  itensAceitos: string;
  itensRejeitados: string;
  instrucoes: string;
}> = [
  {
    tipoResiduo: "reciclavel",
    titulo: "Recicláveis",
    itensAceitos: "Papel, plástico, metal e vidro limpos e secos.",
    itensRejeitados:
      "Embalagens com resíduos de alimento, papel higiênico e espelhos.",
    instrucoes:
      "Esvazie, limpe quando necessário e mantenha os materiais secos antes do descarte.",
  },
  {
    tipoResiduo: "organico",
    titulo: "Orgânicos",
    itensAceitos: "Restos de frutas, legumes, folhas e borra de café.",
    itensRejeitados: "Pilhas, plásticos, metais e produtos químicos.",
    instrucoes:
      "Acondicione em recipiente fechado; quando houver compostagem, encaminhe os materiais adequados.",
  },
  {
    tipoResiduo: "rejeito",
    titulo: "Rejeitos",
    itensAceitos:
      "Materiais sem possibilidade de reciclagem ou reaproveitamento no fluxo local.",
    itensRejeitados: "Eletrônicos, pilhas, baterias e lâmpadas.",
    instrucoes:
      "Descarte apenas materiais que não possam ser direcionados às demais categorias.",
  },
  {
    tipoResiduo: "eletronico",
    titulo: "Eletrônicos",
    itensAceitos:
      "Cabos, carregadores, celulares, periféricos e pequenos eletroeletrônicos.",
    itensRejeitados: "Resíduos orgânicos e materiais comuns.",
    instrucoes:
      "Não descarte com recicláveis convencionais. Use o saco próprio e a estação de pesagem.",
  },
  {
    tipoResiduo: "perigoso",
    titulo: "Resíduos perigosos",
    itensAceitos:
      "Pilhas, baterias, lâmpadas, tintas e produtos químicos domésticos.",
    itensRejeitados: "Materiais recicláveis ou orgânicos.",
    instrucoes:
      "Mantenha a embalagem identificada e use o saco próprio; a administração encaminha para a logística reversa.",
  },
];

/** Cor do saco de cada tipo: a que o administrador definiu no guia ou a padrão (CONAMA 275). */
export async function coresDosSacos(
  condominioId: number
): Promise<Record<TipoResiduo, { cor: string; nome: string }>> {
  const db = await getDb();
  const guias = await db
    .select({
      tipo: guiasDescarte.tipoResiduo,
      cor: guiasDescarte.corSaco,
      nome: guiasDescarte.nomeCorSaco,
    })
    .from(guiasDescarte)
    .where(eq(guiasDescarte.condominioId, condominioId));
  return Object.fromEntries(
    TIPOS_RESIDUO.map(tipo => {
      const guia = guias.find(item => item.tipo === tipo);
      return [
        tipo,
        guia?.cor
          ? { cor: guia.cor, nome: guia.nome || CORES_PADRAO[tipo].nome }
          : CORES_PADRAO[tipo],
      ];
    })
  ) as Record<TipoResiduo, { cor: string; nome: string }>;
}

/** Guia completo do condomínio (os tipos sem personalização usam o texto padrão), já com a cor do saco. */
export async function guiasDoCondominio(condominioId: number) {
  const db = await getDb();
  const salvas = await db
    .select()
    .from(guiasDescarte)
    .where(
      and(
        eq(guiasDescarte.condominioId, condominioId),
        eq(guiasDescarte.publicado, true)
      )
    );
  return TIPOS_RESIDUO.map((tipo, indice) => {
    const salva = salvas.find(guia => guia.tipoResiduo === tipo);
    const padrao = guiasPadrao.find(guia => guia.tipoResiduo === tipo)!;
    const base = salva ?? {
      id: -(indice + 1),
      condominioId,
      publicado: true,
      atualizadoEm: new Date(),
      corSaco: null,
      nomeCorSaco: null,
      ...padrao,
    };
    return {
      ...base,
      corSaco: base.corSaco || CORES_PADRAO[tipo].cor,
      nomeCorSaco: base.nomeCorSaco || CORES_PADRAO[tipo].nome,
    };
  });
}

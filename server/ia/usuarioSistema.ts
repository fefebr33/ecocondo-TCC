import { eq } from "drizzle-orm";
import { usuarios } from "../../drizzle/schema";
import { getDb } from "../db";

/** Conta técnica que aparece como autora das aprovações automáticas na auditoria ("EcoCondo IA"). Não tem senha e não entra no sistema. */
export const ID_EXTERNO_SISTEMA_IA = "sistema-ia-ecocondo";
export const NOME_SISTEMA_IA = "EcoCondo IA (análise automática)";

/** Id do usuário técnico da IA, criado na primeira vez que for preciso. */
export async function idUsuarioSistemaIa() {
  const db = await getDb();
  const existente = await db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.idExterno, ID_EXTERNO_SISTEMA_IA)).limit(1);
  if (existente[0]) return existente[0].id;
  await db.insert(usuarios).values({ idExterno: ID_EXTERNO_SISTEMA_IA, nome: NOME_SISTEMA_IA, metodoLogin: "sistema" }).onDuplicateKeyUpdate({ set: { nome: NOME_SISTEMA_IA } });
  const criado = await db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.idExterno, ID_EXTERNO_SISTEMA_IA)).limit(1);
  return criado[0].id;
}

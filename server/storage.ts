// Armazenamento de arquivos (fotos do visor, certificados, relatórios) no próprio MySQL — sem serviço externo e sem depender
// do disco do servidor, que no plano gratuito do Render é apagado a cada reinício ou nova publicação.
import { eq } from "drizzle-orm";
import { arquivos } from "../drizzle/schema";
import { getDb } from "./db";

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const key = appendHashSuffix(normalizeKey(relKey));
  const dados = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const db = await getDb();
  await db.insert(arquivos).values({ chave: key, tipoConteudo: contentType, tamanho: dados.length, dados });
  return { key, url: `/uploads/${key}` };
}

/** Lê um arquivo guardado no banco (null se não existir). */
export async function lerArquivo(relKey: string) {
  const db = await getDb();
  const [arquivo] = await db.select().from(arquivos).where(eq(arquivos.chave, normalizeKey(relKey))).limit(1);
  return arquivo ?? null;
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: `/uploads/${key}` };
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  return `/uploads/${normalizeKey(relKey)}`;
}

/** Decodifica uma imagem enviada como data URL (ex.: "data:image/webp;base64,...") e salva no armazenamento local. */
export async function salvarImagemBase64(imageDataUrl: string | null | undefined, prefixoChave: string) {
  if (!imageDataUrl) return { key: null as string | null, url: null as string | null };
  const match = imageDataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("Envie uma imagem PNG, JPEG ou WebP válida.");
  const subtype = match[1] === "jpg" ? "jpeg" : match[1];
  const extension = subtype === "jpeg" ? "jpg" : subtype;
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > 4 * 1024 * 1024) throw new Error("A imagem deve ter no máximo 4 MB.");
  const key = `${prefixoChave}/${Date.now()}.${extension}`;
  return storagePut(key, bytes, `image/${subtype}`);
}

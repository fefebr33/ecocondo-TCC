// Armazenamento de arquivos em disco local — sem depender de nenhum serviço externo.
import fs from "node:fs";
import path from "node:path";

const UPLOADS_DIR = path.resolve(process.cwd(), "data", "uploads");

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
  _contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const key = appendHashSuffix(normalizeKey(relKey));
  const filePath = path.join(UPLOADS_DIR, key);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, data);
  return { key, url: `/uploads/${key}` };
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

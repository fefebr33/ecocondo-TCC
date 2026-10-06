import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { pessoas, sessoesEncerradas, tiposTokenSenha, tokensSenha, usuarios } from "../drizzle/schema";
import { getDb } from "./db";

const scrypt = promisify(scryptCallback) as (senha: string, sal: Buffer, tamanho: number) => Promise<Buffer>;

type TipoToken = (typeof tiposTokenSenha)[number];

export const SENHA_MINIMA = 8;
/** Validade do link: o de primeiro acesso dura 3 dias (o síndico manda pelo WhatsApp); o de recuperação, 2 horas. */
export const VALIDADE_TOKEN_MS: Record<TipoToken, number> = { primeiro_acesso: 72 * 60 * 60 * 1000, recuperacao: 2 * 60 * 60 * 1000 };
/**
 * Depois de tantas senhas erradas seguidas para o mesmo e-mail, vindas do mesmo aparelho/rede (endereço de origem), o login
 * fica bloqueado por 15 minutos para essa origem. O dono da conta, entrando de outro lugar, não é trancado por quem errou.
 */
export const TENTATIVAS_MAXIMAS = 5;
const BLOQUEIO_MS = 15 * 60 * 1000;

export class SenhaInvalidaError extends Error {}

export function validarForcaSenha(senha: string) {
  if (senha.length < SENHA_MINIMA) throw new SenhaInvalidaError(`A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`);
  if (senha.length > 128) throw new SenhaInvalidaError("A senha pode ter no máximo 128 caracteres.");
  if (!/[A-Za-z]/.test(senha) || !/\d/.test(senha)) throw new SenhaInvalidaError("Use letras e números na senha.");
}

/** Hash no formato `scrypt$<sal>$<hash>` (base64). */
export async function gerarHashSenha(senha: string) {
  const sal = randomBytes(16);
  const hash = await scrypt(senha, sal, 64);
  return `scrypt$${sal.toString("base64")}$${hash.toString("base64")}`;
}

export async function conferirSenha(senha: string, armazenado: string | null | undefined) {
  if (!armazenado) return false;
  const [algoritmo, salB64, hashB64] = armazenado.split("$");
  if (algoritmo !== "scrypt" || !salB64 || !hashB64) return false;
  const esperado = Buffer.from(hashB64, "base64");
  const calculado = await scrypt(senha, Buffer.from(salB64, "base64"), esperado.length);
  return calculado.length === esperado.length && timingSafeEqual(calculado, esperado);
}

export function hashDoToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function normalizarEmail(email: string) {
  return email.trim().toLowerCase();
}

/** Cria um link de uso único (só o hash vai para o banco) e invalida os links anteriores do mesmo e-mail. */
export async function criarTokenSenha(db: any, dados: { email: string; tipo: TipoToken; criadoPorId?: number | null; agora?: Date }) {
  const email = normalizarEmail(dados.email);
  const agora = dados.agora ?? new Date();
  const token = randomBytes(32).toString("base64url");
  await db.update(tokensSenha).set({ usadoEm: agora }).where(and(eq(tokensSenha.email, email), isNull(tokensSenha.usadoEm)));
  const expiraEm = new Date(agora.getTime() + VALIDADE_TOKEN_MS[dados.tipo]);
  await db.insert(tokensSenha).values({ email, tokenHash: hashDoToken(token), tipo: dados.tipo, expiraEm, criadoPorId: dados.criadoPorId ?? null });
  return { token, expiraEm, caminho: `/definir-senha?token=${token}` };
}

/** Confere um link sem gastá-lo (para a tela mostrar de quem é). */
export async function lerTokenSenha(db: any, token: string, agora = new Date()) {
  const [linha] = await db.select().from(tokensSenha).where(and(eq(tokensSenha.tokenHash, hashDoToken(token)), isNull(tokensSenha.usadoEm), gt(tokensSenha.expiraEm, agora))).limit(1);
  return linha ?? null;
}

/**
 * Grava a senha de quem abriu o link e gasta o link. Se a pessoa ainda não tinha usuário (cadastrada pelo síndico e nunca entrou),
 * o usuário é criado aqui; o perfil (morador ou administrador) vem do cadastro em Pessoas no primeiro acesso.
 */
export async function definirSenhaPorToken(db: any, token: string, senha: string, agora = new Date()) {
  validarForcaSenha(senha);
  const registro = await lerTokenSenha(db, token, agora);
  if (!registro) throw new SenhaInvalidaError("Este link expirou ou já foi usado. Peça um novo link.");
  const [gasto] = await db.update(tokensSenha).set({ usadoEm: agora }).where(and(eq(tokensSenha.id, registro.id), isNull(tokensSenha.usadoEm)));
  if (!gasto.affectedRows) throw new SenhaInvalidaError("Este link já foi usado. Peça um novo link.");
  const senhaHash = await gerarHashSenha(senha);
  const [existente] = await db.select().from(usuarios).where(eq(usuarios.email, registro.email)).limit(1);
  if (existente) {
    // Senha nova encerra as sessões abertas com a senha antiga (ex.: celular perdido).
    await db.update(usuarios).set({ senhaHash, versaoSessao: sql`${usuarios.versaoSessao} + 1`, atualizadoEm: agora }).where(eq(usuarios.id, existente.id));
    const [atualizado] = await db.select().from(usuarios).where(eq(usuarios.id, existente.id)).limit(1);
    return atualizado;
  }
  const [pessoa] = await db.select().from(pessoas).where(eq(pessoas.email, registro.email)).limit(1);
  await db.insert(usuarios).values({ idExterno: `senha:${registro.email}`, nome: pessoa?.nome ?? null, email: registro.email, metodoLogin: "senha", papel: pessoa?.papel === "administrador" ? "administrador" : "usuario", senhaHash, ultimoAcesso: agora });
  const [criado] = await db.select().from(usuarios).where(eq(usuarios.idExterno, `senha:${registro.email}`)).limit(1);
  return criado;
}

const tentativas = new Map<string, { erros: number; bloqueadoAte: number }>();

type OrigemTentativa = { origem?: string | null; agora?: number };

function chaveTentativa(email: string, origem?: string | null) {
  return `${normalizarEmail(email)}|${origem ?? ""}`;
}

export function loginBloqueado(email: string, { origem, agora = Date.now() }: OrigemTentativa = {}) {
  const registro = tentativas.get(chaveTentativa(email, origem));
  return Boolean(registro && registro.bloqueadoAte > agora);
}

export function registrarTentativa(email: string, acertou: boolean, { origem, agora = Date.now() }: OrigemTentativa = {}) {
  const chave = chaveTentativa(email, origem);
  if (acertou) {
    tentativas.delete(chave);
    return;
  }
  const registro = tentativas.get(chave) ?? { erros: 0, bloqueadoAte: 0 };
  registro.erros += 1;
  if (registro.erros >= TENTATIVAS_MAXIMAS) {
    registro.erros = 0;
    registro.bloqueadoAte = agora + BLOQUEIO_MS;
  }
  tentativas.set(chave, registro);
}

/** Encerra todas as sessões abertas do usuário (trocar a senha, acesso desativado): os tokens emitidos antes deixam de valer. */
export async function encerrarSessoes(db: any, usuarioId: number) {
  await db.update(usuarios).set({ versaoSessao: sql`${usuarios.versaoSessao} + 1` }).where(eq(usuarios.id, usuarioId));
  const [linha] = await db.select({ versaoSessao: usuarios.versaoSessao }).from(usuarios).where(eq(usuarios.id, usuarioId)).limit(1);
  return (linha?.versaoSessao ?? 0) as number;
}

/** A administração desativou o acesso desta pessoa em Pessoas e acessos (por usuário ou, antes do primeiro login, por e-mail)? */
export async function acessoDesativado(usuarioId: number | null, email?: string | null, dbInformado?: any) {
  const db = dbInformado ?? (await getDb());
  const condicao = usuarioId ? eq(pessoas.usuarioId, usuarioId) : email ? eq(pessoas.email, normalizarEmail(email)) : null;
  if (!condicao) return false;
  const [pessoa] = await db.select({ statusAcesso: pessoas.statusAcesso }).from(pessoas).where(and(condicao, eq(pessoas.statusAcesso, "desativado"))).limit(1);
  return Boolean(pessoa);
}

/** "Sair": encerra só a sessão deste aparelho (o cookie copiado ou esquecido deixa de valer); as dos outros aparelhos continuam. */
export async function encerrarSessao(db: any, dados: { sessaoId: string; usuarioId: number; expiraEm: Date | null }) {
  if (!dados.sessaoId) return;
  const agora = new Date();
  await db.delete(sessoesEncerradas).where(lt(sessoesEncerradas.expiraEm, agora));
  await db.insert(sessoesEncerradas).values({ sessaoId: dados.sessaoId, usuarioId: dados.usuarioId, expiraEm: dados.expiraEm ?? new Date(agora.getTime() + 31 * 24 * 60 * 60 * 1000) }).onDuplicateKeyUpdate({ set: { usuarioId: dados.usuarioId } });
}

export async function sessaoEncerrada(sessaoId: string) {
  if (!sessaoId) return false;
  const db = await getDb();
  const [linha] = await db.select({ id: sessoesEncerradas.id }).from(sessoesEncerradas).where(eq(sessoesEncerradas.sessaoId, sessaoId)).limit(1);
  return Boolean(linha);
}

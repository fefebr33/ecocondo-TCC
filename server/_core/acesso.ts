import type { Request, Response } from "express";
import { obterContextoPerfilPorUsuarioId } from "../db/ecocondo";
import { sdk } from "./sdk";

/** Identifica o usuário da requisição (cookie de sessão) e o perfil dele no condomínio; responde 401 e devolve null quando não há sessão válida. */
export async function autenticarComPerfil(req: Request, res: Response) {
  const usuario = await sdk.authenticateRequest(req).catch(() => null);
  const contexto = usuario ? await obterContextoPerfilPorUsuarioId(usuario.id) : null;
  if (!usuario || !contexto) {
    res.status(401).json({ error: "Sessão inválida ou expirada." });
    return null;
  }
  return { usuario, ...contexto };
}

/** Como autenticarComPerfil, mas exige perfil de administrador (responde 403 caso contrário). */
export async function exigirAdministrador(req: Request, res: Response) {
  const acesso = await autenticarComPerfil(req, res);
  if (!acesso) return null;
  if (acesso.perfil.papel !== "administrador") {
    res.status(403).json({ error: "Esta operação requer perfil de administrador." });
    return null;
  }
  return acesso;
}

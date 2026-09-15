import { and, eq } from "drizzle-orm";
import {
  condominios,
  PerfilAcesso,
  pessoas,
  moradores,
  perfisAcesso,
  Usuario,
} from "../../drizzle/schema";
import { ENV } from "../_core/env";
import { getDb } from "../db";

export type ContextoPerfil = {
  perfil: PerfilAcesso;
  condominio: typeof condominios.$inferSelect;
  morador: typeof moradores.$inferSelect | null;
};

async function obterCondominioPadrao() {
  const db = await getDb();
  const existente = await db.select().from(condominios).limit(1);
  if (existente[0]) return existente[0];

  const resultado = await db.insert(condominios).values({
    nome: "Condomínio Parque das Flores",
    cidade: "São Paulo",
    estado: "SP",
    quantidadeBlocos: 4,
  }).returning({ id: condominios.id });
  const criado = await db.select().from(condominios).where(eq(condominios.id, resultado[0].id)).limit(1);
  if (!criado[0]) throw new Error("Não foi possível inicializar o condomínio.");
  return criado[0];
}

export async function obterOuCriarPerfil(usuario: Usuario): Promise<ContextoPerfil> {
  const db = await getDb();

  const existente = await db.select().from(perfisAcesso).where(eq(perfisAcesso.usuarioId, usuario.id)).limit(1);
  if (existente[0]) {
    const condominio = await db.select().from(condominios).where(eq(condominios.id, existente[0].condominioId)).limit(1);
    const morador = existente[0].moradorId
      ? await db.select().from(moradores).where(eq(moradores.id, existente[0].moradorId)).limit(1)
      : [];
    if (!condominio[0]) throw new Error("Condomínio do perfil não encontrado.");
    const chaveEmail = (usuario.email || `usuario-${usuario.id}@ecocondo.local`).trim().toLowerCase();
    const pessoaPorUsuario = await db.select().from(pessoas).where(eq(pessoas.usuarioId, usuario.id)).limit(1);
    const pessoaCadastrada = pessoaPorUsuario[0] ? pessoaPorUsuario : await db.select().from(pessoas).where(and(eq(pessoas.condominioId, condominio[0].id), eq(pessoas.email, chaveEmail))).limit(1);
    if (pessoaCadastrada[0]) {
      await db.update(pessoas).set({ usuarioId: usuario.id, moradorId: existente[0].moradorId, statusAcesso: "ativo", papel: existente[0].papel, nome: usuario.nome || pessoaCadastrada[0].nome, atualizadoEm: new Date() }).where(eq(pessoas.id, pessoaCadastrada[0].id));
    } else {
      await db.insert(pessoas).values({
        condominioId: condominio[0].id,
        usuarioId: usuario.id,
        moradorId: existente[0].moradorId,
        nome: usuario.nome || morador[0]?.nome || "Usuário EcoCondo",
        email: chaveEmail,
        telefone: morador[0]?.telefone || null,
        bloco: morador[0]?.bloco || null,
        apartamento: morador[0]?.apartamento || null,
        papel: existente[0].papel,
        statusAcesso: "ativo",
      });
    }
    return { perfil: existente[0], condominio: condominio[0], morador: morador[0] ?? null };
  }

  const condominio = await obterCondominioPadrao();
  const chaveEmail = (usuario.email || `usuario-${usuario.id}@ecocondo.local`).trim().toLowerCase();
  const pessoaPendente = await db.select().from(pessoas).where(and(eq(pessoas.condominioId, condominio.id), eq(pessoas.email, chaveEmail))).limit(1);
  const ehAdministrador = usuario.idExterno === ENV.ownerOpenId || usuario.papel === "administrador";
  const papel = ehAdministrador ? "administrador" : pessoaPendente[0]?.papel || "morador";
  let moradorId: number | null = pessoaPendente[0]?.moradorId ?? null;

  if (papel === "morador") {
    const moradorEncontrado = moradorId
      ? await db.select().from(moradores).where(eq(moradores.id, moradorId)).limit(1)
      : usuario.email
      ? await db.select().from(moradores).where(and(eq(moradores.condominioId, condominio.id), eq(moradores.email, chaveEmail))).limit(1)
      : [];
    if (moradorEncontrado[0]) {
      moradorId = moradorEncontrado[0].id;
      await db.update(moradores).set({ usuarioId: usuario.id, atualizadoEm: new Date() }).where(eq(moradores.id, moradorEncontrado[0].id));
    } else {
      const criado = await db.insert(moradores).values({
        condominioId: condominio.id,
        usuarioId: usuario.id,
        nome: usuario.nome || "Morador",
        email: usuario.email || null,
        bloco: "A",
        apartamento: "A definir",
      }).returning({ id: moradores.id });
      moradorId = criado[0].id;
    }
  }

  if (pessoaPendente[0]) {
    await db.update(pessoas).set({ usuarioId: usuario.id, moradorId, statusAcesso: "ativo", papel, nome: usuario.nome || pessoaPendente[0].nome, atualizadoEm: new Date() }).where(eq(pessoas.id, pessoaPendente[0].id));
  } else {
    await db.insert(pessoas).values({
      condominioId: condominio.id,
      usuarioId: usuario.id,
      moradorId,
      nome: usuario.nome || "Usuário EcoCondo",
      email: chaveEmail,
      papel,
      statusAcesso: "ativo",
    });
  }

  const inserido = await db.insert(perfisAcesso).values({
    usuarioId: usuario.id,
    condominioId: condominio.id,
    moradorId,
    papel,
  }).returning({ id: perfisAcesso.id });
  const perfil = await db.select().from(perfisAcesso).where(eq(perfisAcesso.id, inserido[0].id)).limit(1);
  const morador = moradorId ? await db.select().from(moradores).where(eq(moradores.id, moradorId)).limit(1) : [];
  if (!perfil[0]) throw new Error("Não foi possível criar o perfil de acesso.");
  return { perfil: perfil[0], condominio, morador: morador[0] ?? null };
}

export async function obterContextoPerfilPorUsuarioId(usuarioId: number) {
  const db = await getDb();
  const perfil = await db.select().from(perfisAcesso).where(eq(perfisAcesso.usuarioId, usuarioId)).limit(1);
  if (!perfil[0]) return null;
  const condominio = await db.select().from(condominios).where(eq(condominios.id, perfil[0].condominioId)).limit(1);
  const morador = perfil[0].moradorId ? await db.select().from(moradores).where(eq(moradores.id, perfil[0].moradorId)).limit(1) : [];
  if (!condominio[0]) return null;
  return { perfil: perfil[0], condominio: condominio[0], morador: morador[0] ?? null } satisfies ContextoPerfil;
}

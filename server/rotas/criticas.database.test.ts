import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Correções do relatório de críticas de 30/09/2026, num banco MySQL temporário e exclusivo deste arquivo.
vi.hoisted(() => {
  const endereco = new URL(
    process.env.DATABASE_URL || "mysql://root@127.0.0.1:3306/ecocondo"
  );
  endereco.pathname = `/ecocondo_teste_criticas_${process.pid}_${Date.now()}`;
  process.env.DATABASE_URL = endereco.toString();
});

import { eq } from "drizzle-orm";
import {
  apagarBanco,
  fecharDb,
  getDb,
  getUserByOpenId,
  prepararBanco,
  upsertUser,
  urlDoBanco,
} from "../db";
import { mysqlDisponivelParaTestes } from "../testes/mysqlTeste";
import { appRouter } from "../rotas";
import { moradores, pessoas } from "../../drizzle/schema";
import { saldosInconsistentes } from "../pontos";
import { lerArquivo, storagePut } from "../storage";
import { sdk } from "../_core/sdk";
import { COOKIE_NAME } from "../../shared/const";
import { CABECALHO_TOKEN_ESTACAO } from "./estacoes";
import type { TrpcContext } from "../_core/context";
import type { Usuario } from "../../drizzle/schema";

const mysqlDisponivel = await mysqlDisponivelParaTestes();
const describeComMysql = mysqlDisponivel ? describe : describe.skip;

async function criarUsuario(
  idExterno: string,
  email: string,
  papel: "administrador" | "usuario" = "usuario"
) {
  await upsertUser({
    idExterno,
    nome: idExterno,
    email,
    metodoLogin: "teste",
    papel,
  });
  return (await getUserByOpenId(idExterno)) as Usuario;
}

const cookiesGravados: string[] = [];

/** Chamador com resposta simulada: os cookies de sessão que as rotas gravam ficam em cookiesGravados. */
function chamador(usuario: Usuario | null, tokenSessao?: string) {
  const res = {
    clearCookie: vi.fn(),
    cookie: vi.fn((nome: string, valor: string) => {
      if (nome === COOKIE_NAME) cookiesGravados.push(valor);
    }),
  };
  const headers = tokenSessao
    ? { cookie: `${COOKIE_NAME}=${tokenSessao}` }
    : {};
  return appRouter.createCaller({
    user: usuario,
    req: { protocol: "https", headers },
    res,
  } as unknown as TrpcContext);
}

function tablet(token: string) {
  return appRouter.createCaller({
    user: null,
    req: { protocol: "https", headers: { [CABECALHO_TOKEN_ESTACAO]: token } },
    res: { clearCookie: vi.fn() },
  } as unknown as TrpcContext);
}

/** O servidor aceita este cookie? (mesma checagem de toda requisição) */
async function sessaoValida(token: string | undefined) {
  return sdk
    .authenticateRequest({
      headers: { cookie: `${COOKIE_NAME}=${token}` },
    } as never)
    .then(
      () => true,
      () => false
    );
}

async function novoMorador(apelido: string) {
  const usuario = await criarUsuario(apelido, `${apelido}@teste.local`);
  const cliente = chamador(usuario);
  const perfil = await cliente.perfil.meuPerfil();
  return { cliente, usuario, moradorId: perfil.resident!.id };
}

async function moradorDb(moradorId: number) {
  const [linha] = await (await getDb())
    .select()
    .from(moradores)
    .where(eq(moradores.id, moradorId));
  return linha;
}

let admin: ReturnType<typeof chamador>;
let adminUsuario: Usuario;
let estacaoDemo: ReturnType<typeof tablet>;

beforeAll(async () => {
  if (!mysqlDisponivel) return;
  await prepararBanco();
  adminUsuario = await criarUsuario(
    "criticas-admin",
    "criticas-admin@teste.local",
    "administrador"
  );
  admin = chamador(adminUsuario);
  await admin.perfil.meuPerfil();
  // Estes testes cobrem a conferência manual: sem adesivo obrigatório e sem aprovação automática da IA (cobertas em iaAdesivos.database.test.ts).
  await admin.configuracoesIa.salvar({
    iaAprovacaoAutomatica: false,
    iaConfiancaMinima: 80,
    adesivoObrigatorio: false,
  });
  const { id, token } = await admin.estacoes.criar({
    name: "Estação de teste",
    location: "Térreo",
  });
  await admin.estacoes.definirModoDemonstracao({ id, enabled: true });
  estacaoDemo = tablet(token);
});

afterAll(async () => {
  if (!mysqlDisponivel) return;
  await fecharDb();
  await apagarBanco(urlDoBanco());
});

describeComMysql("correções do relatório de críticas", () => {
  it("sair encerra a sessão daquele aparelho; trocar a senha encerra as dos outros", async () => {
    const usuario = await criarUsuario("sessao", "sessao@teste.local");
    const celular = await sdk.createSessionToken(usuario.idExterno, {
      name: "sessao",
      versao: usuario.versaoSessao,
    });
    const notebook = await sdk.createSessionToken(usuario.idExterno, {
      name: "sessao",
      versao: usuario.versaoSessao,
    });
    expect(await sessaoValida(celular)).toBe(true);
    await chamador(usuario, celular).auth.logout();
    // O cookie do celular não vale mais, mesmo que alguém o tenha copiado; o notebook continua logado.
    expect(await sessaoValida(celular)).toBe(false);
    expect(await sessaoValida(notebook)).toBe(true);

    const atualizado = (await getUserByOpenId("sessao"))!;
    const outroAparelho = await sdk.createSessionToken(atualizado.idExterno, {
      name: "sessao",
      versao: atualizado.versaoSessao,
    });
    const esteAparelho = chamador(atualizado);
    await esteAparelho.auth.alterarSenha({ nova: "novaSenha123" });
    expect(await sessaoValida(outroAparelho)).toBe(false);
    // Quem trocou a senha continua logado, com um cookie novo.
    expect(await sessaoValida(cookiesGravados.at(-1))).toBe(true);
  });

  it("esqueci minha senha nunca devolve o link na tela, nem para e-mail cadastrado", async () => {
    const publico = chamador(null);
    expect(
      await publico.auth.solicitarLink({ email: "criticas-admin@teste.local" })
    ).toEqual({ enviado: true });
    expect(
      await publico.auth.solicitarLink({ email: "ninguem@teste.local" })
    ).toEqual({ enviado: true });
  });

  it("desativar o acesso tira a pessoa do sistema na hora e bloqueia login, link e descartes", async () => {
    const { cliente, usuario } = await novoMorador("mudou-se");
    const db = await getDb();
    const [pessoa] = await db
      .select()
      .from(pessoas)
      .where(eq(pessoas.usuarioId, usuario.id));
    const link = await admin.auth.gerarLinkAcesso({ personId: pessoa.id });
    const token = new URL(link.caminho, "https://x").searchParams.get("token")!;
    await chamador(null).auth.definirSenha({ token, senha: "senhaForte123" });
    const logado = (await getUserByOpenId(usuario.idExterno))!;
    const sessao = await sdk.createSessionToken(logado.idExterno, {
      name: "x",
      versao: logado.versaoSessao,
    });
    expect(await sessaoValida(sessao)).toBe(true);

    await expect(
      chamador(adminUsuario).pessoas.definirAcesso({
        id: (
          await db
            .select()
            .from(pessoas)
            .where(eq(pessoas.usuarioId, adminUsuario.id))
        )[0].id,
        active: false,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      cliente.pessoas.definirAcesso({ id: pessoa.id, active: false })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await admin.pessoas.definirAcesso({
      id: pessoa.id,
      active: false,
      reason: "Mudou-se do condomínio",
    });

    expect(await sessaoValida(sessao)).toBe(false);
    await expect(
      chamador(null).auth.entrarComSenha({
        email: "mudou-se@teste.local",
        senha: "senhaForte123",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      admin.auth.gerarLinkAcesso({ personId: pessoa.id })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(cliente.estacao.gerarCodigo()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const [depois] = await db
      .select()
      .from(pessoas)
      .where(eq(pessoas.id, pessoa.id));
    expect(depois.statusAcesso).toBe("desativado");

    await admin.pessoas.definirAcesso({ id: pessoa.id, active: true });
    expect(
      (
        await chamador(null).auth.entrarComSenha({
          email: "mudou-se@teste.local",
          senha: "senhaForte123",
        })
      ).success
    ).toBe(true);
    expect((await cliente.estacao.gerarCodigo()).code).toMatch(/^\d{6}$/);
  });

  it("frações de ponto se somam: 0,99 kg de reciclável + 1,9 kg de orgânico viram 1 ponto e sobram 0,94", async () => {
    const { cliente, moradorId } = await novoMorador("fracoes");
    const registro = await estacaoDemo.estacao.registrar({
      code: (await cliente.estacao.gerarCodigo()).code,
      itens: [
        { wasteType: "reciclavel", weightGrams: 990 },
        { wasteType: "organico", weightGrams: 1900 },
      ],
    });
    expect(registro.itens.map(item => item.pontosPrevistos)).toEqual([
      0.99, 0.95,
    ]);
    await admin.coletas.aprovarVarios({ ids: registro.ids });
    expect(await moradorDb(moradorId)).toMatchObject({
      pontos: 1,
      restoPontosMilesimos: 940,
    });

    // Reprovar depois de aprovado tira exatamente o valor do descarte (0,95): 1,94 − 0,95 = 0,99.
    await admin.coletas.reprovar({
      id: registro.ids[1],
      motivo: "Orgânico misturado com rejeito",
    });
    expect(await moradorDb(moradorId)).toMatchObject({
      pontos: 0,
      restoPontosMilesimos: 990,
    });
    expect(await saldosInconsistentes(await getDb())).toEqual([]);
  });

  it("a aprovação credita o que o tablet prometeu, mesmo se a regra mudar antes", async () => {
    const { cliente, moradorId } = await novoMorador("regra-mudou");
    const registro = await estacaoDemo.estacao.registrar({
      code: (await cliente.estacao.gerarCodigo()).code,
      itens: [{ wasteType: "reciclavel", weightGrams: 5000 }],
    });
    expect(registro.pendingPoints).toBe(5);
    await admin.regrasDescarte.salvar({
      wasteType: "reciclavel",
      minGrams: 100,
      maxGrams: 30_000,
      pointsPerKg: 0.2,
    });
    try {
      expect(
        (
          await admin.coletas.decidirAprovacaoPeso({
            id: registro.id,
            aprovar: true,
          })
        ).pointsAwarded
      ).toBe(5);
      expect((await moradorDb(moradorId)).pontos).toBe(5);
    } finally {
      await admin.regrasDescarte.restaurarPadrao({ wasteType: "reciclavel" });
    }
  });

  it("zerar os pontos também zera as frações guardadas", async () => {
    const { cliente, moradorId } = await novoMorador("zerar-fracao");
    const registro = await estacaoDemo.estacao.registrar({
      code: (await cliente.estacao.gerarCodigo()).code,
      itens: [{ wasteType: "reciclavel", weightGrams: 1500 }],
    });
    await admin.coletas.aprovarVarios({ ids: registro.ids });
    expect(await moradorDb(moradorId)).toMatchObject({
      pontos: 1,
      restoPontosMilesimos: 500,
    });
    await admin.pontos.zerarTodos({
      confirmation: "ZERAR",
      reason: "Novo ciclo depois da entrega dos prêmios",
    });
    expect(await moradorDb(moradorId)).toMatchObject({
      pontos: 0,
      restoPontosMilesimos: 0,
    });
  });

  it("fotos e arquivos ficam no banco e continuam lá depois de reiniciar o servidor", async () => {
    const { key, url } = await storagePut(
      "coletas/1/foto.png",
      Buffer.from([1, 2, 3]),
      "image/png"
    );
    expect(url).toBe(`/uploads/${key}`);
    const arquivo = await lerArquivo(key);
    expect(arquivo).toMatchObject({ tipoConteudo: "image/png", tamanho: 3 });
    expect(Buffer.from(arquivo!.dados)).toEqual(Buffer.from([1, 2, 3]));
    expect(await lerArquivo("coletas/1/nao-existe.png")).toBeNull();
  });
});

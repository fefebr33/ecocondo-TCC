import { abrirConexao, separarNomeDoBanco, urlDoBanco } from "../db";

/**
 * Os testes com banco real criam um banco MySQL temporário (ecocondo_teste_...) no mesmo servidor do DATABASE_URL.
 * Sem MySQL acessível, esses testes são ignorados; com EXIGIR_MYSQL=1 (usado no CI), a falta do MySQL vira erro.
 */
export async function mysqlDisponivelParaTestes() {
  try {
    const conexao = await abrirConexao(separarNomeDoBanco(urlDoBanco()).urlServidor);
    await conexao.end();
    return true;
  } catch (error) {
    if (process.env.EXIGIR_MYSQL === "1") throw error;
    console.warn(`[Testes] MySQL indisponível (${error instanceof Error ? error.message : error}); testes com banco real ignorados.`);
    return false;
  }
}

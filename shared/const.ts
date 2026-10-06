export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
/** Validade da sessão (cookie de login): 30 dias. Sair do sistema ou trocar a senha encerra antes. */
export const SESSAO_MS = 1000 * 60 * 60 * 24 * 30;
export const UNAUTHED_ERR_MSG = "Faça login para continuar (10001)";
export const NOT_ADMIN_ERR_MSG =
  "Você não tem permissão para esta ação (10002)";

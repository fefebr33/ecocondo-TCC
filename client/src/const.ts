export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Leva o usuário para a tela de login local (sem depender de nenhum serviço externo).
export const startLogin = () => {
  window.location.href = "/entrar";
};

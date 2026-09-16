export const ecoRoles = ["administrador", "coletor", "morador"] as const;
export type EcoRole = (typeof ecoRoles)[number];

const routePermissions: Record<string, EcoRole[]> = {
  "/dashboard": ["administrador", "coletor", "morador"],
  "/coletas": ["administrador", "coletor", "morador"],
  "/moradores": ["administrador"],
  "/pessoas": ["administrador"],
  "/relatorios": ["administrador"],
  "/auditoria": ["administrador"],
  "/engajamento": ["administrador", "morador"],
  "/podio": ["administrador", "coletor", "morador"],
  "/guia": ["administrador", "coletor", "morador"],
  "/notificacoes": ["administrador", "coletor", "morador"],
  "/ambiental": ["administrador", "coletor", "morador"],
  "/comunidade": ["administrador", "coletor", "morador"],
  "/configuracoes": ["administrador"],
};

export function canAccessRoute(role: EcoRole, route: string) {
  return routePermissions[route]?.includes(role) ?? false;
}

export function allowedRoutesFor(role: EcoRole) {
  return Object.keys(routePermissions).filter((route) => canAccessRoute(role, route));
}

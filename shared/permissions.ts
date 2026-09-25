export const ecoRoles = ["administrador", "morador"] as const;
export type EcoRole = (typeof ecoRoles)[number];

const routePermissions: Record<string, EcoRole[]> = {
  "/dashboard": ["administrador", "morador"],
  "/coletas": ["administrador", "morador"],
  "/moradores": ["administrador"],
  "/pessoas": ["administrador"],
  "/relatorios": ["administrador"],
  "/auditoria": ["administrador"],
  "/engajamento": ["administrador", "morador"],
  "/podio": ["administrador", "morador"],
  "/guia": ["administrador", "morador"],
  "/notificacoes": ["administrador", "morador"],
  "/ambiental": ["administrador", "morador"],
  "/comunidade": ["administrador", "morador"],
  "/configuracoes": ["administrador"],
};

export function canAccessRoute(role: EcoRole, route: string) {
  return routePermissions[route]?.includes(role) ?? false;
}

export function allowedRoutesFor(role: EcoRole) {
  return Object.keys(routePermissions).filter((route) => canAccessRoute(role, route));
}

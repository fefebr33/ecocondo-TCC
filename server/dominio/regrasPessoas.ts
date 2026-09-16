export function normalizeAccessEmail(email: string) {
  return email.trim().toLowerCase();
}

export function buildPendingResidentPerson(morador: { id: number; usuarioId: number | null; nome: string; email: string; telefone: string | null; bloco: string; apartamento: string }) {
  return {
    usuarioId: morador.usuarioId,
    moradorId: morador.id,
    nome: morador.nome,
    email: normalizeAccessEmail(morador.email),
    telefone: morador.telefone,
    bloco: morador.bloco,
    apartamento: morador.apartamento,
    papel: "morador" as const,
    statusAcesso: morador.usuarioId ? ("ativo" as const) : ("pendente" as const),
  };
}

export function normalizeAccessEmail(email: string) {
  return email.trim().toLowerCase();
}

export function buildPendingResidentPerson(resident: { id: number; userId: number | null; name: string; email: string; phone: string | null; block: string; apartment: string }) {
  return {
    userId: resident.userId,
    residentId: resident.id,
    name: resident.name,
    email: normalizeAccessEmail(resident.email),
    phone: resident.phone,
    block: resident.block,
    apartment: resident.apartment,
    role: "morador" as const,
    accessStatus: resident.userId ? "ativo" as const : "pendente" as const,
  };
}

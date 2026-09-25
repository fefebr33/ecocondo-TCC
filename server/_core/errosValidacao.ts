import type { ZodError } from "zod";

type Problema = ZodError["issues"][number];

/** Nome dos campos da API como aparecem para quem usa as telas. */
const ROTULOS: Record<string, string> = {
  name: "Nome",
  title: "Título",
  description: "Descrição",
  message: "Mensagem",
  email: "E-mail",
  phone: "Telefone",
  block: "Bloco",
  apartment: "Apartamento",
  weightGrams: "Peso",
  targetKg: "Meta (kg)",
  pointsCost: "Pontos necessários",
  stock: "Estoque",
  scheduledAt: "Data da coleta",
  startDate: "Data inicial",
  endDate: "Data final",
  time: "Horário",
  location: "Local",
  notes: "Observações",
  response: "Resposta",
  targetDescription: "Público-alvo",
  state: "UF",
  city: "Cidade",
  address: "Endereço",
  blockCount: "Quantidade de blocos",
  percentual: "Percentual",
  rating: "Nota",
};

function formatarLimite(campo: string, limite: number | bigint) {
  const valor = Number(limite);
  // O peso trafega em gramas, mas é digitado em quilos.
  if (campo === "weightGrams") return `${(valor / 1000).toLocaleString("pt-BR")} kg`;
  return valor.toLocaleString("pt-BR");
}

/** Converte um problema de validação do Zod em uma frase em português, sem jargão técnico. */
export function mensagemDeValidacao(problema: Problema) {
  const campo = String(problema.path[problema.path.length - 1] ?? "");
  const rotulo = ROTULOS[campo] ?? "Um dos campos";
  switch (problema.code) {
    case "too_big":
      return problema.origin === "string"
        ? `${rotulo}: use no máximo ${formatarLimite(campo, problema.maximum)} caracteres.`
        : `${rotulo}: o valor máximo é ${formatarLimite(campo, problema.maximum)}.`;
    case "too_small":
      return problema.origin === "string"
        ? Number(problema.minimum) <= 1
          ? `${rotulo}: preencha este campo.`
          : `${rotulo}: use pelo menos ${formatarLimite(campo, problema.minimum)} caracteres.`
        : `${rotulo}: o valor mínimo é ${formatarLimite(campo, problema.minimum)}.`;
    case "invalid_format":
      return problema.format === "email" ? `${rotulo}: informe um e-mail válido.` : `${rotulo}: formato inválido.`;
    case "invalid_type":
      return `${rotulo}: valor ausente ou inválido.`;
    case "invalid_value":
      return `${rotulo}: escolha uma das opções disponíveis.`;
    case "custom":
      return problema.message;
    default:
      return `${rotulo}: valor inválido.`;
  }
}

export function mensagensDeValidacao(erro: ZodError) {
  return erro.issues.map(mensagemDeValidacao).join(" ");
}

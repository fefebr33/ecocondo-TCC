import { formatarNumero } from "@/lib/utils";
import { ArrowRight } from "lucide-react";

/**
 * Mostra o que mudou num registro da auditoria em linguagem simples ("Situação: pendente → aprovado"),
 * no lugar dos blocos de código (JSON) com o valor anterior e o novo.
 */

const nomesCampos: Record<string, string> = {
  situacao: "Situação",
  situacaoDescarte: "Situação do descarte",
  status: "Status",
  aprovacaoPesoStatus: "Aprovação",
  pendenteAprovacaoPeso: "Aguardando aprovação",
  pontosConcedidos: "Pontos do descarte",
  pontosEstornados: "Pontos estornados",
  pontosPendentesCancelados: "Pontos previstos cancelados",
  pontosPrevistos: "Pontos previstos",
  valorMilesimos: "Valor do descarte (pontos)",
  efeitoPontos: "Efeito nos pontos",
  pontos: "Pontos",
  saldo: "Saldo de pontos",
  saldos: "Saldos",
  pesoGramas: "Peso",
  weightGrams: "Peso",
  pesoMinimoGramas: "Peso mínimo",
  pesoMaximoGramas: "Peso máximo",
  pontosPorKg: "Pontos por kg",
  tipoResiduo: "Tipo de resíduo",
  tipo: "Tipo",
  nome: "Nome",
  titulo: "Título",
  descricao: "Descrição",
  papel: "Perfil",
  statusAcesso: "Acesso",
  bloco: "Bloco",
  apartamento: "Apartamento",
  estoque: "Estoque",
  custoPontos: "Custo em pontos",
  ativo: "Ativo",
  dataInicio: "Início",
  dataFim: "Fim",
  inicioEm: "Início",
  fimEm: "Fim",
  pausadaAte: "Pausada até",
  reprovadaEm: "Reprovado em",
  cicloIniciadoEm: "Novo ciclo desde",
  premio: "Prêmio",
  premios: "Prêmios",
  posicao: "Posição",
  periodo: "Período",
  observacao: "Observação",
  conclusao: "Conclusão",
  categoria: "Assunto",
  publico: "Para quem",
  importante: "Importante",
  quantidade: "Quantidade",
  adesivo: "Adesivo",
  alertas: "Alertas",
  local: "Local",
  modoDemonstracao: "Modo demonstração",
  pesagemSimulada: "Balança simulada",
  corSaco: "Cor do saco",
  nomeCorSaco: "Nome da cor",
  revisao: "Revisão",
  medidas: "Medidas",
  modo: "Modo",
  confianca: "Confiança",
  resultado: "Resultado",
  excluida: "Excluída",
  lote: "Lote",
  nota: "Nota",
  participantes: "Participantes",
  adesao: "Adesão (%)",
  andamento: "Andamento (%)",
  diasRestantes: "Dias restantes",
  kgReciclados: "Kg reciclados",
  descartes: "Descartes",
  meta: "Meta",
  motivo: "Motivo",
  motivoPausa: "Motivo da pausa",
  codigo: "Código",
  quantidadeAdesivos: "Adesivos",
  entregues: "Entregues",
};

/** Campos técnicos (identificadores internos) que não ajudam quem lê. */
const camposOcultos = new Set([
  "moradorId",
  "coletaId",
  "estacaoId",
  "ocorrenciaId",
  "relatorId",
  "aprovadoPorId",
  "hasImage",
  "analiseIa",
  "id",
]);

const valoresLegiveis: Record<string, string> = {
  pendente: "pendente",
  aprovado: "aprovado",
  rejeitado: "reprovado",
  reprovado: "reprovado",
  auditoria: "em auditoria",
  concluida: "concluída",
  cancelada: "cancelada",
  ativa: "ativa",
  ativo: "ativo",
  encerrada: "encerrada",
  revogada: "revogada",
  pausada: "pausada",
  planejada: "planejada",
  administrador: "administrador",
  morador: "morador",
  reciclavel: "reciclável",
  organico: "orgânico",
  rejeito: "rejeito",
  eletronico: "eletrônico",
  perigoso: "perigoso",
  perda_pontos: "retirada de pontos",
  advertencia: "advertência",
  suspensao_campanhas: "suspensão das campanhas",
  suspensao_participacao: "suspensão da participação",
  outra: "outra medida",
  procedente: "procedente",
  improcedente: "improcedente",
  denuncia_falsa: "denúncia falsa",
  todos: "todos",
  moradores: "só moradores",
  administradores: "só administradores",
};

const ehData = (valor: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(valor);

function formatar(campo: string, valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return "—";
  if (typeof valor === "boolean") return valor ? "sim" : "não";
  if (typeof valor === "number") {
    if (/Gramas$/.test(campo) || campo === "weightGrams")
      return `${formatarNumero(valor / 1000)} kg`;
    if (campo === "valorMilesimos") return formatarNumero(valor / 1000);
    return formatarNumero(valor);
  }
  if (typeof valor === "string") {
    if (ehData(valor))
      return new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(valor));
    return valoresLegiveis[valor] ?? valor;
  }
  if (valor instanceof Date)
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(valor);
  if (Array.isArray(valor))
    return valor.length
      ? valor.map(item => formatar(campo, item)).join("; ")
      : "nenhum";
  if (typeof valor === "object") {
    return Object.entries(valor as Record<string, unknown>)
      .filter(([chave]) => !camposOcultos.has(chave))
      .map(
        ([chave, item]) => `${nomesCampos[chave] ?? chave}: ${formatar(chave, item)}`
      )
      .join(" · ");
  }
  return String(valor);
}

function comoObjeto(valor: unknown): Record<string, unknown> {
  if (!valor) return {};
  if (typeof valor === "string") {
    try {
      const lido = JSON.parse(valor);
      return lido && typeof lido === "object" && !Array.isArray(lido)
        ? lido
        : { valor: lido };
    } catch {
      return { valor };
    }
  }
  if (typeof valor === "object" && !Array.isArray(valor))
    return valor as Record<string, unknown>;
  return { valor };
}

export type LinhaMudanca = {
  campo: string;
  rotulo: string;
  antes: string | null;
  depois: string | null;
};

/** Lista os campos que mudaram (ou que foram registrados, quando não havia valor anterior). */
export function descreverMudancas(
  anterior: unknown,
  novo: unknown
): LinhaMudanca[] {
  const antes = comoObjeto(anterior);
  const depois = comoObjeto(novo);
  const temAnterior = Object.keys(antes).length > 0;
  const campos = Array.from(
    new Set([...Object.keys(antes), ...Object.keys(depois)])
  ).filter(campo => !camposOcultos.has(campo));
  return campos
    .map(campo => {
      const valorAntes = campo in antes ? formatar(campo, antes[campo]) : null;
      const valorDepois =
        campo in depois ? formatar(campo, depois[campo]) : null;
      return {
        campo,
        rotulo: nomesCampos[campo] ?? campo.replace(/([A-Z])/g, " $1").toLowerCase(),
        antes: temAnterior ? valorAntes : null,
        depois: valorDepois,
      };
    })
    .filter(linha => !temAnterior || linha.antes !== linha.depois);
}

export default function MudancasAuditoria({
  anterior,
  novo,
}: {
  anterior: unknown;
  novo: unknown;
}) {
  const linhas = descreverMudancas(anterior, novo);
  if (!linhas.length) return null;
  const soRegistro = linhas.every(linha => linha.antes === null);
  return (
    <div className="mt-3 rounded-xl border border-[#e5eee8] bg-white px-3 py-2.5 text-xs">
      <p className="font-semibold text-[#0f7350]">
        {soRegistro ? "Dados registrados" : "O que mudou"}
      </p>
      <dl className="mt-1.5 grid gap-1">
        {linhas.map(linha => (
          <div
            key={linha.campo}
            className="grid gap-0.5 sm:grid-cols-[minmax(130px,auto)_1fr] sm:gap-3"
          >
            <dt className="text-muted-foreground">{linha.rotulo}</dt>
            <dd className="flex flex-wrap items-center gap-1.5">
              {linha.antes !== null && (
                <>
                  <span className="rounded bg-[#fbeceb] px-1.5 text-[#8c2c22] line-through decoration-[#b3382c]/40">
                    {linha.antes}
                  </span>
                  <ArrowRight
                    className="h-3 w-3 text-muted-foreground"
                    aria-label="passou para"
                  />
                </>
              )}
              <span className="rounded bg-[#edf7f1] px-1.5 font-medium text-[#0a5a3c]">
                {linha.depois ?? "—"}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

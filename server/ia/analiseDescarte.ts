/**
 * Análise automática (IA) dos descartes registrados na estação.
 *
 * Com a variável ANTHROPIC_API_KEY configurada, a foto de cada saco é enviada à API do Claude (visão), que identifica o tipo
 * de resíduo, lê o peso no visor da balança e diz a cor do saco. Sem a chave, o sistema roda em modo de simulação: o resultado
 * é calculado de forma determinística a partir do que foi informado no tablet, para a banca e os testes funcionarem sem custo.
 *
 * A decisão (aprovar sozinho ou deixar pendente para um responsável) é sempre tomada por regras do próprio sistema
 * (decidirAnalise), nunca pelo texto da IA: qualquer divergência, dúvida ou confiança baixa manda o descarte para a avaliação humana.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import { TIPOS_RESIDUO, type TipoResiduo } from "@shared/descarte";
import { rotuloResiduo } from "@shared/rotulos";

/** Modelo usado na análise (o mais recente com visão). */
export const MODELO_IA = "claude-opus-5-5";

/** Diferença tolerada entre o peso lido na foto e o informado: 10% ou 100 g, o que for maior. */
export const TOLERANCIA_PESO_RELATIVA = 0.1;
export const TOLERANCIA_PESO_MINIMA_GRAMAS = 100;

/** Situações que o apresentador pode simular numa estação em modo demonstração, para mostrar a IA mandando o descarte para revisão. */
export const simulacoesIa = [
  "tudo_certo",
  "cor_errada",
  "tipo_diferente",
  "peso_diferente",
  "foto_ilegivel",
] as const;
export type SimulacaoIa = (typeof simulacoesIa)[number];
export const rotuloSimulacaoIa: Record<SimulacaoIa, string> = {
  tudo_certo: "Tudo certo",
  cor_errada: "Saco de cor errada",
  tipo_diferente: "Resíduo de outro tipo",
  peso_diferente: "Peso diferente do visor",
  foto_ilegivel: "Foto ilegível",
};

export type ModoIa = "claude" | "simulacao";

/** O que a IA viu na foto. */
export type LeituraIa = {
  modo: ModoIa;
  modelo: string | null;
  tipoIdentificado: TipoResiduo | null;
  pesoLidoGramas: number | null;
  corSacoIdentificada: string | null;
  /** 0 a 100. */
  confianca: number;
  fotoLegivel: boolean;
  problemas: string[];
  descricao: string;
  /** A análise falhou (sem rede, chave inválida, recusa): o descarte vai para a avaliação humana. */
  erro: string | null;
  duracaoMs: number;
};

export type ItemParaAnalise = {
  tipoDeclarado: TipoResiduo;
  pesoDeclaradoGramas: number;
  /** Foto do saco na balança, como data URL (data:image/...;base64,...). */
  imagemDataUrl: string | null;
  /** Cor do saco que o condomínio usa para o tipo declarado (nome, ex.: "Azul"). */
  corSacoEsperada: string;
  /** Cores de todos os tipos, para a IA saber o que cada cor significa neste condomínio. */
  coresPorTipo: Record<TipoResiduo, string>;
};

/** A chave da API está configurada? Sem ela, a análise roda em modo de simulação. */
export function iaReal() {
  return (
    Boolean(process.env.ANTHROPIC_API_KEY) && process.env.IA_SIMULACAO !== "1"
  );
}

export function modoIaAtual(): ModoIa {
  return iaReal() ? "claude" : "simulacao";
}

/** Compara nomes de cor sem diferenciar maiúsculas e acentos ("Marrom" = "marrom"). */
export function mesmaCor(
  a: string | null | undefined,
  b: string | null | undefined
) {
  const normalizar = (texto: string) =>
    texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  return Boolean(a && b && normalizar(a) === normalizar(b));
}

const formatarKg = (gramas: number) =>
  (gramas / 1000).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/**
 * Regras da aprovação automática. Aprova só quando a foto é legível, o tipo, o peso e a cor do saco batem com o que foi
 * informado, a confiança passa do mínimo configurado e não há alerta antifraude. Qualquer outra coisa vai para pendente.
 */
export function decidirAnalise(
  item: Pick<
    ItemParaAnalise,
    "tipoDeclarado" | "pesoDeclaradoGramas" | "corSacoEsperada"
  >,
  leitura: LeituraIa,
  opcoes: {
    aprovacaoAutomatica: boolean;
    confiancaMinima: number;
    alertasAntifraude?: string[];
  }
): {
  resultado: "aprovado_automatico" | "pendente" | "erro";
  motivos: string[];
} {
  if (leitura.erro)
    return {
      resultado: "erro",
      motivos: [
        `A análise automática não pôde ser feita (${leitura.erro}); o descarte aguarda a avaliação de um responsável.`,
      ],
    };
  const motivos: string[] = [];
  if (!leitura.fotoLegivel)
    motivos.push("Foto ilegível ou sem foto do saco na balança.");
  if (
    leitura.tipoIdentificado &&
    leitura.tipoIdentificado !== item.tipoDeclarado
  ) {
    motivos.push(
      `A IA identificou ${rotuloResiduo[leitura.tipoIdentificado].toLowerCase()}, mas foi declarado ${rotuloResiduo[item.tipoDeclarado].toLowerCase()}.`
    );
  } else if (!leitura.tipoIdentificado) {
    motivos.push("A IA não conseguiu identificar o tipo de resíduo.");
  }
  if (leitura.pesoLidoGramas === null) {
    motivos.push("A IA não conseguiu ler o peso no visor da balança.");
  } else {
    const tolerancia = Math.max(
      TOLERANCIA_PESO_MINIMA_GRAMAS,
      item.pesoDeclaradoGramas * TOLERANCIA_PESO_RELATIVA
    );
    if (
      Math.abs(leitura.pesoLidoGramas - item.pesoDeclaradoGramas) > tolerancia
    ) {
      motivos.push(
        `Peso lido na foto (${formatarKg(leitura.pesoLidoGramas)} kg) diferente do informado (${formatarKg(item.pesoDeclaradoGramas)} kg).`
      );
    }
  }
  if (!mesmaCor(leitura.corSacoIdentificada, item.corSacoEsperada)) {
    motivos.push(
      `Cor do saco identificada: ${leitura.corSacoIdentificada || "não identificada"}; o esperado para ${rotuloResiduo[item.tipoDeclarado].toLowerCase()} é ${item.corSacoEsperada.toLowerCase()}.`
    );
  }
  if (leitura.confianca < opcoes.confiancaMinima)
    motivos.push(
      `Confiança da análise baixa (${leitura.confianca}%; mínimo configurado ${opcoes.confiancaMinima}%).`
    );
  for (const problema of leitura.problemas)
    motivos.push(`A IA apontou: ${problema}`);
  for (const alerta of opcoes.alertasAntifraude ?? [])
    motivos.push(`Alerta antifraude: ${alerta}.`);
  if (!motivos.length && !opcoes.aprovacaoAutomatica)
    motivos.push(
      "Tudo certo na análise, mas a aprovação automática está desligada nas configurações."
    );
  return {
    resultado: motivos.length ? "pendente" : "aprovado_automatico",
    motivos,
  };
}

/**
 * Simulação determinística da IA (sem chave de API): devolve o que foi informado, com a variação escolhida na estação
 * de demonstração. Assim a banca vê os dois caminhos (aprovado sozinho e pendente) sem depender de rede nem de custo.
 */
export function simularLeitura(
  item: ItemParaAnalise,
  simulacao: SimulacaoIa = "tudo_certo"
): LeituraIa {
  const outroTipo =
    TIPOS_RESIDUO.find(tipo => tipo !== item.tipoDeclarado) ??
    item.tipoDeclarado;
  const outraCor =
    Object.values(item.coresPorTipo).find(
      cor => !mesmaCor(cor, item.corSacoEsperada)
    ) ?? "Preto";
  const base: LeituraIa = {
    modo: "simulacao",
    modelo: null,
    tipoIdentificado: item.tipoDeclarado,
    pesoLidoGramas: item.pesoDeclaradoGramas,
    corSacoIdentificada: item.corSacoEsperada,
    confianca: 95,
    fotoLegivel: true,
    problemas: [],
    descricao: `Simulação: saco ${item.corSacoEsperada.toLowerCase()} com ${rotuloResiduo[item.tipoDeclarado].toLowerCase()}, ${formatarKg(item.pesoDeclaradoGramas)} kg no visor.`,
    erro: null,
    duracaoMs: 0,
  };
  switch (simulacao) {
    case "cor_errada":
      return {
        ...base,
        corSacoIdentificada: outraCor,
        descricao: `Simulação: o saco da foto é ${outraCor.toLowerCase()}, não ${item.corSacoEsperada.toLowerCase()}.`,
      };
    case "tipo_diferente":
      return {
        ...base,
        tipoIdentificado: outroTipo,
        confianca: 88,
        descricao: `Simulação: o conteúdo parece ${rotuloResiduo[outroTipo].toLowerCase()}.`,
      };
    case "peso_diferente":
      return {
        ...base,
        pesoLidoGramas: Math.round(item.pesoDeclaradoGramas * 0.6),
        descricao: `Simulação: o visor mostra ${formatarKg(Math.round(item.pesoDeclaradoGramas * 0.6))} kg.`,
      };
    case "foto_ilegivel":
      return {
        ...base,
        fotoLegivel: false,
        pesoLidoGramas: null,
        confianca: 30,
        descricao: "Simulação: foto escura e tremida; o visor não aparece.",
      };
    default:
      return base;
  }
}

const esquemaLeitura = z.object({
  tipo_residuo: z.enum([...TIPOS_RESIDUO, "indefinido"]),
  peso_visor_kg: z.number().nullable(),
  cor_saco: z.string(),
  confianca: z.number(),
  foto_legivel: z.boolean(),
  problemas: z.array(z.string()),
  descricao: z.string(),
});

const INSTRUCOES = `Você confere descartes de lixo de um condomínio residencial. Cada morador coloca o saco na balança da estação de pesagem, fotografa o saco com o visor da balança e informa o tipo e o peso. Sua função é olhar a foto e dizer, com honestidade, o que ela mostra; a decisão de aprovar é tomada depois por regras do sistema.

Responda em português, só com o que dá para ver na foto:
- tipo_residuo: reciclavel, organico, rejeito, eletronico, perigoso, ou indefinido se não der para saber.
- peso_visor_kg: o número mostrado no visor da balança, em kg; null se o visor não aparece ou não dá para ler.
- cor_saco: o nome da cor do saco, usando de preferência um dos nomes da lista de cores do condomínio; "não visível" se não der para ver.
- confianca: de 0 a 100, o quanto você está seguro da leitura como um todo.
- foto_legivel: false se a foto está escura, tremida, cortada ou não mostra o saco e o visor.
- problemas: sinais de irregularidade (mistura de tipos, saco vazio ou com outro objeto pesando, foto de tela ou de outra foto, visor encoberto). Lista vazia se não houver.
- descricao: uma frase curta descrevendo a foto.`;

/** Lê a foto com a API do Claude. Qualquer falha vira `erro` (o descarte vai para a avaliação humana, nunca é aprovado). */
export async function lerComClaude(item: ItemParaAnalise): Promise<LeituraIa> {
  const inicio = Date.now();
  const vazia: LeituraIa = {
    modo: "claude",
    modelo: MODELO_IA,
    tipoIdentificado: null,
    pesoLidoGramas: null,
    corSacoIdentificada: null,
    confianca: 0,
    fotoLegivel: false,
    problemas: [],
    descricao: "",
    erro: null,
    duracaoMs: 0,
  };
  const foto = item.imagemDataUrl?.match(
    /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/
  );
  if (!foto)
    return {
      ...vazia,
      descricao: "Sem foto para analisar.",
      duracaoMs: Date.now() - inicio,
    };
  const tipoMidia = (foto[1] === "image/jpg" ? "image/jpeg" : foto[1]) as
    | "image/png"
    | "image/jpeg"
    | "image/webp";
  const cores = TIPOS_RESIDUO.map(
    tipo =>
      `${rotuloResiduo[tipo]}: saco ${item.coresPorTipo[tipo].toLowerCase()}`
  ).join("; ");
  try {
    const cliente = new Anthropic({ timeout: 45_000, maxRetries: 1 });
    const resposta = await cliente.messages.parse({
      model: MODELO_IA,
      max_tokens: 2000,
      system: INSTRUCOES,
      output_config: { effort: "low", format: zodOutputFormat(esquemaLeitura) },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: tipoMidia, data: foto[2] },
            },
            // Sem o que o morador declarou: a IA diz só o que vê (sem ser induzida a concordar); a comparação é feita por decidirAnalise.
            {
              type: "text",
              text: `Cores dos sacos neste condomínio: ${cores}.\nDescreva o que a foto mostra.`,
            },
          ],
        },
      ],
    });
    if (resposta.stop_reason === "refusal")
      return {
        ...vazia,
        erro: "a IA recusou a análise",
        duracaoMs: Date.now() - inicio,
      };
    const dados = resposta.parsed_output;
    if (!dados)
      return {
        ...vazia,
        erro: "resposta da IA em formato inesperado",
        duracaoMs: Date.now() - inicio,
      };
    return {
      modo: "claude",
      modelo: MODELO_IA,
      tipoIdentificado:
        dados.tipo_residuo === "indefinido" ? null : dados.tipo_residuo,
      pesoLidoGramas:
        dados.peso_visor_kg === null || !Number.isFinite(dados.peso_visor_kg)
          ? null
          : Math.round(dados.peso_visor_kg * 1000),
      corSacoIdentificada: dados.cor_saco.slice(0, 40),
      confianca: Math.max(0, Math.min(100, Math.round(dados.confianca))),
      fotoLegivel: dados.foto_legivel,
      problemas: dados.problemas
        .slice(0, 5)
        .map(problema => problema.slice(0, 200)),
      descricao: dados.descricao.slice(0, 500),
      erro: null,
      duracaoMs: Date.now() - inicio,
    };
  } catch (error) {
    const mensagem =
      error instanceof Anthropic.AuthenticationError
        ? "chave da API inválida"
        : error instanceof Anthropic.RateLimitError
          ? "limite de uso da API atingido"
          : error instanceof Anthropic.APIConnectionError
            ? "sem conexão com a API"
            : error instanceof Anthropic.APIError
              ? `erro ${error.status ?? ""} da API`.trim()
              : "erro inesperado";
    console.warn("[IA] análise do descarte falhou:", error);
    return { ...vazia, erro: mensagem, duracaoMs: Date.now() - inicio };
  }
}

/** Motivo gravado quando uma estação de verdade (fora do modo demonstração) não tem a IA configurada. */
export const ERRO_SEM_CHAVE_IA =
  "sem chave da API do Claude configurada no servidor";

/**
 * Analisa um item: API do Claude quando há chave (e não é uma simulação pedida na estação de demonstração).
 * A simulação vale só na estação em modo demonstração. Numa estação de verdade sem chave, a análise fica indisponível
 * e o descarte vai para a avaliação de um responsável: nunca é aprovado sozinho sem alguém (pessoa ou IA) olhar a foto.
 */
export async function analisarItem(
  item: ItemParaAnalise,
  opcoes: { simulacao?: SimulacaoIa | null; estacaoDemonstracao: boolean }
): Promise<LeituraIa> {
  const simulacaoPedida =
    opcoes.estacaoDemonstracao &&
    opcoes.simulacao &&
    opcoes.simulacao !== "tudo_certo";
  if (iaReal() && !simulacaoPedida && item.imagemDataUrl)
    return lerComClaude(item);
  if (iaReal() && !simulacaoPedida && !opcoes.estacaoDemonstracao)
    return {
      ...simularLeitura(item),
      modo: "claude",
      modelo: MODELO_IA,
      fotoLegivel: false,
      pesoLidoGramas: null,
      confianca: 0,
      descricao: "Sem foto para analisar.",
    };
  if (!opcoes.estacaoDemonstracao) {
    return {
      modo: "simulacao",
      modelo: null,
      tipoIdentificado: null,
      pesoLidoGramas: null,
      corSacoIdentificada: null,
      confianca: 0,
      fotoLegivel: false,
      problemas: [],
      descricao:
        "Análise automática indisponível: a foto aguarda a conferência de um responsável.",
      erro: ERRO_SEM_CHAVE_IA,
      duracaoMs: 0,
    };
  }
  return simularLeitura(item, opcoes.simulacao ?? "tudo_certo");
}

import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  rgb,
  type RGB,
} from "pdf-lib";
import {
  rotuloCategoriaOcorrencia,
  rotuloResiduo,
  rotuloTipoPenalidade,
} from "@shared/rotulos";
import { TIPOS_RESIDUO } from "@shared/descarte";
import type { TipoResiduo } from "@shared/descarte";
import { palavra, plural } from "@shared/plural";

/**
 * Relatório de gestão em PDF, no mesmo espírito do painel: cartões com os números principais, gráficos de barras
 * (por tipo, por mês, por bloco, situação dos descartes e pontos), tabelas e os indicadores de gestão (IA, auditoria,
 * medidas, campanhas, adesivos, ocorrências e avisos). Quebra de página e de linha automáticas, para nada ficar
 * escrito por cima de outra coisa.
 */

export type DadosRelatorioPdf = {
  condominio: string;
  bloco?: string;
  inicio?: Date;
  fim?: Date;
  geradoEm: Date;
  totalKg: number;
  recyclableKg: number;
  recyclingRate: number | null;
  co2EstimateKg: number;
  completedCount: number;
  porSituacao: Record<
    "pendente" | "aprovado" | "reprovado" | "auditoria" | "cancelado",
    number
  >;
  byWasteType: Array<{ wasteType: TipoResiduo; kilograms: number }>;
  participationRate: number | null;
  residentsCount: number;
  participantsCount: number;
  equivalencias: {
    arvoresPoupadas: number;
    litrosAguaPoupados: number;
    co2EvitadoKg: number;
  };
  pontos: {
    distribuidos: number;
    estornados: number;
    resgatados: number;
    devolvidos: number;
  };
  resgates: {
    total: number;
    entregues: number;
    pendentes: number;
    cancelados: number;
    porRecompensa: Array<{
      titulo: string;
      quantidade: number;
      pontos: number;
    }>;
  };
  environmentalIncidents: number;
  auditEvents: number;
  porBloco: Array<{
    block: string;
    kilograms: number;
    recyclableKg: number;
    descartes: number;
    moradores: number;
    participantes: number;
    participationRate: number | null;
    kgPorMorador: number | null;
    pontos: number;
  }>;
  porMes: Array<Record<string, number | string>>;
  top3: Array<{
    posicao: number;
    nome: string;
    bloco: string;
    pontos: number;
    pesoKg: number;
  }>;
  gestao: {
    ia: {
      modo: string;
      analises: number;
      aprovadasAutomaticamente: number;
      pendentes: number;
      erros: number;
      taxaAprovacaoAutomatica: number | null;
      confiancaMedia: number | null;
      motivosComuns: Array<{ motivo: string; quantidade: number }>;
    };
    auditoria: {
      abertas: number;
      emAndamento: number;
      concluidasRegulares: number;
      reprovacoes: number;
      aprovacoesRevertidas: number;
      consultasQr: number;
    };
    penalidades: {
      aplicadas: number;
      vigentes: number;
      revogadas: number;
      porTipo: Record<string, number>;
    };
    campanhas: {
      ativas: number;
      pausadas: number;
      encerradas: number;
      planejadas: number;
      participacoes: number;
    };
    adesivos: {
      entregues: number;
      utilizados: number;
      disponiveis: number;
      cancelados: number;
      pedidosAbertos: number;
    };
    ocorrencias: {
      total: number;
      abertas: number;
      emAuditoria: number;
      procedentes: number;
      improcedentes: number;
      denunciasFalsas: number;
      porCategoria: Record<string, number>;
    };
    avisos: { enviados: number; taxaVisualizacao: number | null };
  };
};

const LARGURA = 595;
const ALTURA = 842;
const MARGEM = 40;
const UTIL = LARGURA - MARGEM * 2;

const VERDE = rgb(0.06, 0.45, 0.31);
const VERDE_ESCURO = rgb(0.03, 0.3, 0.2);
const VERDE_CLARO = rgb(0.93, 0.97, 0.94);
const TEXTO = rgb(0.12, 0.18, 0.15);
const CINZA = rgb(0.42, 0.47, 0.44);
const BORDA = rgb(0.86, 0.91, 0.88);
const BRANCO = rgb(1, 1, 1);

const corDoTipo: Record<TipoResiduo, RGB> = {
  reciclavel: rgb(0.06, 0.45, 0.31),
  organico: rgb(0.55, 0.38, 0.2),
  rejeito: rgb(0.45, 0.47, 0.46),
  eletronico: rgb(0.16, 0.39, 0.65),
  perigoso: rgb(0.7, 0.22, 0.17),
};
const corDaSituacao: Record<string, RGB> = {
  aprovado: rgb(0.06, 0.45, 0.31),
  pendente: rgb(0.85, 0.6, 0.15),
  auditoria: rgb(0.36, 0.23, 0.65),
  reprovado: rgb(0.7, 0.22, 0.17),
  cancelado: rgb(0.6, 0.63, 0.61),
};
const rotuloSituacaoPdf: Record<string, string> = {
  aprovado: "Aprovados",
  pendente: "Pendentes",
  auditoria: "Em auditoria",
  reprovado: "Reprovados",
  cancelado: "Cancelados",
};

/** As fontes padrão do PDF só têm o alfabeto latino básico: troca o que não existe nelas (setas, CO₂, emojis). */
function limpar(texto: string) {
  return texto
    .replace(/→/g, "->")
    .replace(/[₂]/g, "2")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, "...")
    .replace(/[^\u0009\u000A -~ -ÿ—–•]/g, "");
}

const numero = (valor: number, casas = 1) =>
  valor.toLocaleString("pt-BR", { maximumFractionDigits: casas });
const data = (valor: Date) =>
  valor.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

class Documento {
  pagina!: PDFPage;
  y = 0;
  paginas: PDFPage[] = [];
  constructor(
    private pdf: PDFDocument,
    public fonte: PDFFont,
    public negrito: PDFFont,
    private cabecalhoContinuacao: string
  ) {}

  novaPagina(primeira = false) {
    this.pagina = this.pdf.addPage([LARGURA, ALTURA]);
    this.paginas.push(this.pagina);
    this.y = ALTURA - MARGEM;
    if (!primeira) {
      this.texto(this.cabecalhoContinuacao, MARGEM, this.y - 10, 9, {
        cor: CINZA,
      });
      this.pagina.drawLine({
        start: { x: MARGEM, y: this.y - 16 },
        end: { x: LARGURA - MARGEM, y: this.y - 16 },
        thickness: 0.6,
        color: BORDA,
      });
      this.y -= 32;
    }
  }

  /** Garante espaço vertical; se não couber, começa uma nova página. */
  espaco(altura: number) {
    if (this.y - altura < MARGEM + 24) this.novaPagina();
  }

  largura(texto: string, tamanho: number, ehNegrito = false) {
    return (ehNegrito ? this.negrito : this.fonte).widthOfTextAtSize(
      limpar(texto),
      tamanho
    );
  }

  texto(
    texto: string,
    x: number,
    y: number,
    tamanho = 10,
    opcoes: { negrito?: boolean; cor?: RGB } = {}
  ) {
    this.pagina.drawText(limpar(texto), {
      x,
      y,
      size: tamanho,
      font: opcoes.negrito ? this.negrito : this.fonte,
      color: opcoes.cor ?? TEXTO,
    });
  }

  /** Corta o texto em linhas que cabem na largura. */
  quebrar(texto: string, largura: number, tamanho: number, ehNegrito = false) {
    const linhas: string[] = [];
    for (const paragrafo of limpar(texto).split("\n")) {
      let atual = "";
      for (const palavra of paragrafo.split(/\s+/)) {
        const tentativa = atual ? `${atual} ${palavra}` : palavra;
        if (this.largura(tentativa, tamanho, ehNegrito) <= largura)
          atual = tentativa;
        else {
          if (atual) linhas.push(atual);
          atual = palavra;
        }
      }
      linhas.push(atual);
    }
    return linhas;
  }

  /** Parágrafo com quebra de linha automática (avança o cursor). */
  paragrafo(
    texto: string,
    tamanho = 9.5,
    opcoes: { cor?: RGB; negrito?: boolean; x?: number; largura?: number } = {}
  ) {
    const x = opcoes.x ?? MARGEM;
    const linhas = this.quebrar(
      texto,
      opcoes.largura ?? UTIL - (x - MARGEM),
      tamanho,
      opcoes.negrito
    );
    const altura = tamanho + 3.5;
    for (const linha of linhas) {
      this.espaco(altura);
      this.texto(linha, x, this.y - tamanho, tamanho, opcoes);
      this.y -= altura;
    }
  }

  titulo(texto: string, subtitulo?: string) {
    this.espaco(subtitulo ? 46 : 32);
    this.y -= 8;
    this.pagina.drawRectangle({
      x: MARGEM,
      y: this.y - 14,
      width: 4,
      height: 16,
      color: VERDE,
    });
    this.texto(texto, MARGEM + 10, this.y - 12, 13, {
      negrito: true,
      cor: VERDE_ESCURO,
    });
    this.y -= 22;
    if (subtitulo) {
      this.paragrafo(subtitulo, 8.5, { cor: CINZA });
      this.y -= 2;
    }
    this.y -= 4;
  }

  /** Cartões com um número grande e a descrição embaixo (como os do painel). */
  cartoes(
    itens: Array<{ rotulo: string; valor: string; ajuda?: string }>,
    porLinha = 4
  ) {
    const gap = 8;
    const largura = (UTIL - gap * (porLinha - 1)) / porLinha;
    const altura = 58;
    for (let indice = 0; indice < itens.length; indice += porLinha) {
      this.espaco(altura + gap);
      itens.slice(indice, indice + porLinha).forEach((item, coluna) => {
        const x = MARGEM + coluna * (largura + gap);
        this.pagina.drawRectangle({
          x,
          y: this.y - altura,
          width: largura,
          height: altura,
          color: VERDE_CLARO,
          borderColor: BORDA,
          borderWidth: 0.6,
        });
        this.texto(
          this.cortar(item.rotulo.toUpperCase(), largura - 16, 6.8, true),
          x + 8,
          this.y - 14,
          6.8,
          { negrito: true, cor: CINZA }
        );
        this.texto(
          this.cortar(item.valor, largura - 16, 15, true),
          x + 8,
          this.y - 33,
          15,
          { negrito: true, cor: VERDE_ESCURO }
        );
        if (item.ajuda)
          this.texto(
            this.cortar(item.ajuda, largura - 16, 7),
            x + 8,
            this.y - 47,
            7,
            { cor: CINZA }
          );
      });
      this.y -= altura + gap;
    }
  }

  cortar(texto: string, largura: number, tamanho: number, ehNegrito = false) {
    let atual = limpar(texto);
    if (this.largura(atual, tamanho, ehNegrito) <= largura) return atual;
    while (
      atual.length > 1 &&
      this.largura(`${atual}...`, tamanho, ehNegrito) > largura
    )
      atual = atual.slice(0, -1);
    return `${atual.trimEnd()}...`;
  }

  /** Barras horizontais: rótulo à esquerda, barra proporcional e o valor no fim. */
  barrasHorizontais(
    itens: Array<{ rotulo: string; valor: number; texto: string; cor?: RGB }>
  ) {
    const maximo = Math.max(1, ...itens.map(item => item.valor));
    const colunaRotulo = 120;
    const colunaValor = 90;
    const larguraBarra = UTIL - colunaRotulo - colunaValor - 10;
    for (const item of itens) {
      this.espaco(18);
      this.texto(
        this.cortar(item.rotulo, colunaRotulo - 6, 9),
        MARGEM,
        this.y - 10,
        9
      );
      this.pagina.drawRectangle({
        x: MARGEM + colunaRotulo,
        y: this.y - 12,
        width: larguraBarra,
        height: 10,
        color: rgb(0.95, 0.96, 0.95),
      });
      const largura =
        item.valor > 0 ? Math.max(2, (item.valor / maximo) * larguraBarra) : 0;
      if (largura)
        this.pagina.drawRectangle({
          x: MARGEM + colunaRotulo,
          y: this.y - 12,
          width: largura,
          height: 10,
          color: item.cor ?? VERDE,
        });
      this.texto(
        item.texto,
        MARGEM + colunaRotulo + larguraBarra + 8,
        this.y - 10,
        9,
        { negrito: true }
      );
      this.y -= 17;
    }
    this.y -= 4;
  }

  /** Colunas empilhadas por mês, com legenda por tipo de resíduo. */
  colunasEmpilhadas(meses: Array<Record<string, number | string>>) {
    const alturaGrafico = 130;
    this.espaco(alturaGrafico + 50);
    const base = this.y - alturaGrafico - 8;
    const totais = meses.map(mes =>
      TIPOS_RESIDUO.reduce((soma, tipo) => soma + Number(mes[tipo] ?? 0), 0)
    );
    const maximo = Math.max(1, ...totais);
    const larguraEixo = UTIL - 30;
    const passo = larguraEixo / Math.max(1, meses.length);
    const larguraColuna = Math.min(46, passo * 0.6);
    for (let linha = 0; linha <= 4; linha += 1) {
      const y = base + (alturaGrafico * linha) / 4;
      this.pagina.drawLine({
        start: { x: MARGEM + 30, y },
        end: { x: LARGURA - MARGEM, y },
        thickness: 0.4,
        color: BORDA,
      });
      this.texto(numero((maximo * linha) / 4, 0), MARGEM, y - 3, 7, {
        cor: CINZA,
      });
    }
    meses.forEach((mes, indice) => {
      const x = MARGEM + 30 + passo * indice + (passo - larguraColuna) / 2;
      let topo = base;
      for (const tipo of TIPOS_RESIDUO) {
        const valor = Number(mes[tipo] ?? 0);
        if (valor <= 0) continue;
        const altura = (valor / maximo) * alturaGrafico;
        this.pagina.drawRectangle({
          x,
          y: topo,
          width: larguraColuna,
          height: altura,
          color: corDoTipo[tipo],
        });
        topo += altura;
      }
      if (totais[indice] > 0)
        this.texto(`${numero(totais[indice])} kg`, x, topo + 3, 7, {
          negrito: true,
        });
      this.texto(
        String(mes.mes),
        x + larguraColuna / 2 - this.largura(String(mes.mes), 8) / 2,
        base - 12,
        8,
        { cor: CINZA }
      );
    });
    this.y = base - 24;
    this.legenda(
      TIPOS_RESIDUO.map(tipo => ({
        rotulo: rotuloResiduo[tipo],
        cor: corDoTipo[tipo],
      }))
    );
  }

  /** Barra única de 100% dividida por partes (situação dos descartes). */
  barraComposta(partes: Array<{ rotulo: string; valor: number; cor: RGB }>) {
    const total = partes.reduce((soma, parte) => soma + parte.valor, 0);
    this.espaco(40);
    let x = MARGEM;
    if (!total)
      this.pagina.drawRectangle({
        x,
        y: this.y - 16,
        width: UTIL,
        height: 16,
        color: rgb(0.95, 0.96, 0.95),
      });
    for (const parte of partes) {
      if (!parte.valor || !total) continue;
      const largura = (parte.valor / total) * UTIL;
      this.pagina.drawRectangle({
        x,
        y: this.y - 16,
        width: largura,
        height: 16,
        color: parte.cor,
      });
      const porcentagem = `${Math.round((parte.valor / total) * 100)}%`;
      if (largura > this.largura(porcentagem, 8, true) + 6)
        this.texto(porcentagem, x + 4, this.y - 11.5, 8, {
          negrito: true,
          cor: BRANCO,
        });
      x += largura;
    }
    this.y -= 24;
    this.legenda(
      partes.map(parte => ({
        rotulo: `${parte.rotulo}: ${parte.valor}`,
        cor: parte.cor,
      }))
    );
  }

  legenda(itens: Array<{ rotulo: string; cor: RGB }>) {
    this.espaco(16);
    let x = MARGEM;
    for (const item of itens) {
      const largura = this.largura(item.rotulo, 8) + 22;
      if (x + largura > LARGURA - MARGEM) {
        x = MARGEM;
        this.y -= 13;
        this.espaco(16);
      }
      this.pagina.drawRectangle({
        x,
        y: this.y - 8,
        width: 8,
        height: 8,
        color: item.cor,
      });
      this.texto(item.rotulo, x + 11, this.y - 7.5, 8);
      x += largura;
    }
    this.y -= 18;
  }

  /** Tabela simples com cabeçalho verde e linhas zebradas; repete o cabeçalho quando quebra a página. */
  tabela(
    colunas: Array<{ titulo: string; largura: number; alinhar?: "direita" }>,
    linhas: string[][]
  ) {
    const total = colunas.reduce((soma, coluna) => soma + coluna.largura, 0);
    const larguras = colunas.map(coluna => (coluna.largura / total) * UTIL);
    const cabecalho = () => {
      this.espaco(36);
      this.pagina.drawRectangle({
        x: MARGEM,
        y: this.y - 16,
        width: UTIL,
        height: 16,
        color: VERDE,
      });
      let x = MARGEM;
      colunas.forEach((coluna, indice) => {
        const texto = this.cortar(coluna.titulo, larguras[indice] - 8, 8, true);
        const deslocamento =
          coluna.alinhar === "direita"
            ? larguras[indice] - 5 - this.largura(texto, 8, true)
            : 5;
        this.texto(texto, x + deslocamento, this.y - 11.5, 8, {
          negrito: true,
          cor: BRANCO,
        });
        x += larguras[indice];
      });
      this.y -= 16;
    };
    cabecalho();
    linhas.forEach((linha, numeroLinha) => {
      if (this.y - 15 < MARGEM + 24) {
        this.novaPagina();
        cabecalho();
      }
      if (numeroLinha % 2 === 1)
        this.pagina.drawRectangle({
          x: MARGEM,
          y: this.y - 15,
          width: UTIL,
          height: 15,
          color: rgb(0.97, 0.98, 0.97),
        });
      let x = MARGEM;
      linha.forEach((celula, indice) => {
        const texto = this.cortar(celula, larguras[indice] - 8, 8.5);
        const deslocamento =
          colunas[indice].alinhar === "direita"
            ? larguras[indice] - 5 - this.largura(texto, 8.5)
            : 5;
        this.texto(texto, x + deslocamento, this.y - 10.5, 8.5);
        x += larguras[indice];
      });
      this.y -= 15;
    });
    this.pagina.drawLine({
      start: { x: MARGEM, y: this.y },
      end: { x: LARGURA - MARGEM, y: this.y },
      thickness: 0.6,
      color: BORDA,
    });
    this.y -= 10;
  }

  /** Pares rótulo/valor em duas colunas (indicadores de gestão). */
  pares(titulo: string, itens: Array<[string, string]>) {
    const altura = 16 + Math.ceil(itens.length / 2) * 14 + 8;
    this.espaco(altura);
    this.pagina.drawRectangle({
      x: MARGEM,
      y: this.y - altura,
      width: UTIL,
      height: altura,
      borderColor: BORDA,
      borderWidth: 0.6,
      color: BRANCO,
    });
    this.texto(titulo, MARGEM + 8, this.y - 13, 9.5, {
      negrito: true,
      cor: VERDE_ESCURO,
    });
    const meia = UTIL / 2;
    itens.forEach(([rotulo, valor], indice) => {
      const coluna = indice % 2;
      const linha = Math.floor(indice / 2);
      const x = MARGEM + 8 + coluna * meia;
      const y = this.y - 30 - linha * 14;
      this.texto(this.cortar(rotulo, meia - 70, 8.5), x, y, 8.5, {
        cor: CINZA,
      });
      const textoValor = this.cortar(valor, 60, 8.5, true);
      this.texto(
        textoValor,
        x + meia - 16 - this.largura(textoValor, 8.5, true),
        y,
        8.5,
        { negrito: true }
      );
    });
    this.y -= altura + 8;
  }
}

export async function gerarRelatorioPdf(dados: DadosRelatorioPdf) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Relatório EcoCondo - ${dados.condominio}`);
  pdf.setAuthor("EcoCondo");
  const fonte = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  const periodo = `${dados.inicio ? data(dados.inicio) : "início"} a ${dados.fim ? data(dados.fim) : data(dados.geradoEm)}`;
  const recorte = dados.bloco ? `Bloco ${dados.bloco}` : "Todos os blocos";
  const doc = new Documento(
    pdf,
    fonte,
    negrito,
    `EcoCondo · ${dados.condominio} · ${recorte} · ${periodo}`
  );
  doc.novaPagina(true);

  // Cabeçalho
  doc.pagina.drawRectangle({
    x: 0,
    y: ALTURA - 112,
    width: LARGURA,
    height: 112,
    color: VERDE_ESCURO,
  });
  doc.texto("EcoCondo", MARGEM, ALTURA - 50, 24, {
    negrito: true,
    cor: BRANCO,
  });
  doc.texto(
    "Relatório de gestão de resíduos e engajamento",
    MARGEM,
    ALTURA - 70,
    12,
    { cor: rgb(0.85, 0.94, 0.89) }
  );
  doc.texto(
    `${dados.condominio} · ${recorte} · Período: ${periodo}`,
    MARGEM,
    ALTURA - 92,
    9.5,
    { cor: BRANCO }
  );
  doc.y = ALTURA - 128;

  doc.titulo(
    "Resumo do período",
    "Só descartes aprovados entram no peso. Pendentes, reprovados e em auditoria ficam de fora até a decisão."
  );
  doc.cartoes([
    {
      rotulo: "Peso confirmado",
      valor: `${numero(dados.totalKg)} kg`,
      ajuda: plural(
        dados.porSituacao.aprovado,
        "descarte aprovado",
        "descartes aprovados"
      ),
    },
    {
      rotulo: "Recicláveis",
      valor: `${numero(dados.recyclableKg)} kg`,
      ajuda:
        dados.recyclingRate === null
          ? "sem dados"
          : `${numero(dados.recyclingRate)}% do total`,
    },
    {
      rotulo: "CO2 evitado",
      valor: `${numero(dados.co2EstimateKg)} kg`,
      ajuda: "estimativa (0,75 kg por kg reciclável)",
    },
    {
      rotulo: "Participação",
      valor:
        dados.participationRate === null
          ? "-"
          : `${numero(dados.participationRate)}%`,
      ajuda: `${dados.participantsCount} de ${plural(dados.residentsCount, "morador", "moradores")}`,
    },
    {
      rotulo: "Pontos distribuídos",
      valor: numero(dados.pontos.distribuidos, 0),
      ajuda: `${numero(dados.pontos.estornados, 0)} ${palavra(dados.pontos.estornados, "estornado", "estornados")}`,
    },
    {
      rotulo: "Pontos em resgates",
      valor: numero(dados.pontos.resgatados, 0),
      ajuda: `${plural(dados.resgates.total, "resgate", "resgates")}, ${plural(dados.resgates.entregues, "entregue", "entregues")}`,
    },
    {
      rotulo: "Aguardando decisão",
      valor: String(dados.porSituacao.pendente + dados.porSituacao.auditoria),
      ajuda: `${plural(dados.porSituacao.pendente, "pendente", "pendentes")}, ${dados.porSituacao.auditoria} em auditoria`,
    },
    {
      rotulo: "Ocorrências",
      valor: String(dados.environmentalIncidents),
      ajuda: `${plural(dados.auditEvents, "evento", "eventos")} na auditoria`,
    },
  ]);

  doc.titulo("Peso aprovado por tipo de resíduo");
  doc.barrasHorizontais(
    dados.byWasteType.map(item => ({
      rotulo: rotuloResiduo[item.wasteType],
      valor: item.kilograms,
      texto: `${numero(item.kilograms, 2)} kg`,
      cor: corDoTipo[item.wasteType],
    }))
  );

  doc.titulo(
    "Evolução mensal",
    "Quilos aprovados nos últimos seis meses, separados por tipo de resíduo."
  );
  doc.colunasEmpilhadas(dados.porMes);

  doc.titulo("Situação dos descartes");
  doc.barraComposta(
    ["aprovado", "pendente", "auditoria", "reprovado", "cancelado"].map(
      chave => ({
        rotulo: rotuloSituacaoPdf[chave],
        valor:
          dados.porSituacao[chave as keyof DadosRelatorioPdf["porSituacao"]] ??
          0,
        cor: corDaSituacao[chave],
      })
    )
  );

  doc.titulo(
    "Comparação entre blocos",
    "Quilos aprovados, participação e pontos de cada bloco no período."
  );
  doc.barrasHorizontais(
    dados.porBloco.map(bloco => ({
      rotulo: `Bloco ${bloco.block}${dados.bloco === bloco.block ? " (filtro)" : ""}`,
      valor: bloco.kilograms,
      texto: `${numero(bloco.kilograms, 2)} kg`,
    }))
  );
  doc.tabela(
    [
      { titulo: "Bloco", largura: 1 },
      { titulo: "Kg aprovados", largura: 1.2, alinhar: "direita" },
      { titulo: "Recicláveis", largura: 1.2, alinhar: "direita" },
      { titulo: "Descartes", largura: 1, alinhar: "direita" },
      { titulo: "Participação", largura: 1.6, alinhar: "direita" },
      { titulo: "Kg/morador", largura: 1.1, alinhar: "direita" },
      { titulo: "Pontos", largura: 0.9, alinhar: "direita" },
    ],
    dados.porBloco.map(bloco => [
      bloco.block,
      numero(bloco.kilograms, 2),
      numero(bloco.recyclableKg, 2),
      String(bloco.descartes),
      `${bloco.participantes}/${bloco.moradores}${bloco.participationRate === null ? "" : ` (${numero(bloco.participationRate)}%)`}`,
      bloco.kgPorMorador === null ? "-" : numero(bloco.kgPorMorador, 2),
      numero(bloco.pontos, 0),
    ])
  );

  doc.titulo("Pontos e resgates");
  doc.barrasHorizontais([
    {
      rotulo: "Distribuídos",
      valor: dados.pontos.distribuidos,
      texto: numero(dados.pontos.distribuidos, 0),
      cor: VERDE,
    },
    {
      rotulo: "Estornados",
      valor: dados.pontos.estornados,
      texto: numero(dados.pontos.estornados, 0),
      cor: corDaSituacao.reprovado,
    },
    {
      rotulo: "Gastos em resgates",
      valor: dados.pontos.resgatados,
      texto: numero(dados.pontos.resgatados, 0),
      cor: rgb(0.42, 0.25, 0.63),
    },
    {
      rotulo: "Devolvidos",
      valor: dados.pontos.devolvidos,
      texto: numero(dados.pontos.devolvidos, 0),
      cor: corDaSituacao.cancelado,
    },
  ]);
  if (dados.resgates.porRecompensa.length) {
    doc.tabela(
      [
        { titulo: "Recompensa", largura: 3 },
        { titulo: "Resgates", largura: 1, alinhar: "direita" },
        { titulo: "Pontos", largura: 1, alinhar: "direita" },
      ],
      dados.resgates.porRecompensa
        .slice(0, 12)
        .map(item => [
          item.titulo,
          String(item.quantidade),
          numero(item.pontos, 0),
        ])
    );
  }

  doc.titulo(
    "Top 3 do período",
    "Mesma privacidade do pódio: quem pediu para ocultar o nome, ou está com a participação suspensa, aparece só pelo bloco. Pontos já descontam as retiradas por medidas administrativas."
  );
  if (dados.top3.length)
    doc.tabela(
      [
        { titulo: "Posição", largura: 0.8 },
        { titulo: "Morador(a)", largura: 3 },
        { titulo: "Bloco", largura: 0.8 },
        { titulo: "Pontos", largura: 1, alinhar: "direita" },
        { titulo: "Peso (kg)", largura: 1, alinhar: "direita" },
      ],
      dados.top3.map(linha => [
        `${linha.posicao}º`,
        linha.nome,
        linha.bloco,
        numero(linha.pontos, 0),
        numero(linha.pesoKg, 2),
      ])
    );
  else doc.paragrafo("Ninguém pontuou no período.", 9.5, { cor: CINZA });

  const gestao = dados.gestao;
  doc.titulo(
    "Indicadores de gestão",
    "Análise automática, auditoria, medidas administrativas, campanhas, adesivos, ocorrências e avisos."
  );
  doc.pares("Análise automática (IA)", [
    ["Fotos analisadas", String(gestao.ia.analises)],
    [
      "Aprovadas na hora",
      `${gestao.ia.aprovadasAutomaticamente}${gestao.ia.taxaAprovacaoAutomatica === null ? "" : ` (${gestao.ia.taxaAprovacaoAutomatica}%)`}`,
    ],
    ["Enviadas para a administração", String(gestao.ia.pendentes)],
    [
      "Confiança média",
      gestao.ia.confiancaMedia === null ? "-" : `${gestao.ia.confiancaMedia}%`,
    ],
    ["Erros de análise", String(gestao.ia.erros)],
    ["Modo", gestao.ia.modo === "claude" ? "IA real" : "Simulação"],
  ]);
  if (gestao.ia.motivosComuns.length) {
    doc.paragrafo(
      `Motivos mais comuns para revisão: ${gestao.ia.motivosComuns.map(item => `${item.motivo} (${item.quantidade})`).join("; ")}.`,
      8.5,
      { cor: CINZA }
    );
    doc.y -= 6;
  }
  doc.pares("Auditoria e fiscalização", [
    ["Auditorias abertas", String(gestao.auditoria.abertas)],
    ["Em andamento agora", String(gestao.auditoria.emAndamento)],
    ["Concluídas como regulares", String(gestao.auditoria.concluidasRegulares)],
    ["Descartes reprovados", String(gestao.auditoria.reprovacoes)],
    ["Aprovações revertidas", String(gestao.auditoria.aprovacoesRevertidas)],
    ["Consultas de QR", String(gestao.auditoria.consultasQr)],
  ]);
  doc.pares("Medidas administrativas", [
    ["Aplicadas no período", String(gestao.penalidades.aplicadas)],
    ["Valendo agora", String(gestao.penalidades.vigentes)],
    ["Revogadas", String(gestao.penalidades.revogadas)],
    ...Object.entries(gestao.penalidades.porTipo).map(
      ([tipo, quantidade]) =>
        [
          rotuloTipoPenalidade[tipo as keyof typeof rotuloTipoPenalidade] ??
            tipo,
          String(quantidade),
        ] as [string, string]
    ),
  ]);
  doc.pares("Campanhas e comunidade", [
    ["Campanhas ativas", String(gestao.campanhas.ativas)],
    [
      "Planejadas / pausadas",
      `${gestao.campanhas.planejadas} / ${gestao.campanhas.pausadas}`,
    ],
    ["Encerradas", String(gestao.campanhas.encerradas)],
    ["Participações", String(gestao.campanhas.participacoes)],
    ["Avisos gerais enviados", String(gestao.avisos.enviados)],
    [
      "Visualização dos avisos",
      gestao.avisos.taxaVisualizacao === null
        ? "-"
        : `${gestao.avisos.taxaVisualizacao}%`,
    ],
  ]);
  doc.pares("Adesivos QR", [
    ["Entregues", String(gestao.adesivos.entregues)],
    ["Usados", String(gestao.adesivos.utilizados)],
    ["Disponíveis com moradores", String(gestao.adesivos.disponiveis)],
    ["Cancelados", String(gestao.adesivos.cancelados)],
    ["Pedidos em aberto", String(gestao.adesivos.pedidosAbertos)],
  ]);
  doc.pares("Ocorrências e denúncias", [
    ["Registradas no período", String(gestao.ocorrencias.total)],
    ["Em aberto", String(gestao.ocorrencias.abertas)],
    ["Procedentes", String(gestao.ocorrencias.procedentes)],
    ["Improcedentes", String(gestao.ocorrencias.improcedentes)],
    ["Denúncias falsas", String(gestao.ocorrencias.denunciasFalsas)],
    ["Em auditoria", String(gestao.ocorrencias.emAuditoria)],
    ...Object.entries(gestao.ocorrencias.porCategoria).map(
      ([categoria, quantidade]) =>
        [
          rotuloCategoriaOcorrencia[
            categoria as keyof typeof rotuloCategoriaOcorrencia
          ] ?? categoria,
          String(quantidade),
        ] as [string, string]
    ),
  ]);

  doc.titulo("Impacto ambiental estimado");
  doc.cartoes(
    [
      {
        rotulo: "Árvores poupadas",
        valor: numero(dados.equivalencias.arvoresPoupadas),
        ajuda: "17 kg de papel = 1 árvore",
      },
      {
        rotulo: "Água poupada",
        valor: `${numero(dados.equivalencias.litrosAguaPoupados, 0)} L`,
        ajuda: "20 L por kg reciclado",
      },
      {
        rotulo: "CO2 evitado",
        valor: `${numero(dados.equivalencias.co2EvitadoKg)} kg`,
        ajuda: "0,75 kg CO2e por kg",
      },
    ],
    3
  );

  doc.titulo("Nota metodológica");
  doc.paragrafo(
    "Os pesos vêm da estação de pesagem (balança e foto do visor) e só entram depois da aprovação pela análise automática ou pela administração. Pendentes, reprovados e descartes em auditoria não entram nos totais. Os pontos do ranking são os pontos ganhos com descartes aprovados no período, menos as retiradas de pontos aplicadas como medida administrativa. As equivalências ambientais usam fatores médios (EPA WARM / Cempre) e devem ser lidas como estimativas de apoio à gestão e à prestação de contas.",
    8.5,
    { cor: CINZA }
  );

  // Rodapé com numeração em todas as páginas.
  doc.paginas.forEach((pagina, indice) => {
    const texto = limpar(
      `Gerado em ${dados.geradoEm.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · Página ${indice + 1} de ${doc.paginas.length}`
    );
    pagina.drawLine({
      start: { x: MARGEM, y: MARGEM + 6 },
      end: { x: LARGURA - MARGEM, y: MARGEM + 6 },
      thickness: 0.5,
      color: BORDA,
    });
    pagina.drawText(texto, {
      x: MARGEM,
      y: MARGEM - 6,
      size: 7.5,
      font: fonte,
      color: CINZA,
    });
    pagina.drawText("EcoCondo", {
      x: LARGURA - MARGEM - negrito.widthOfTextAtSize("EcoCondo", 7.5),
      y: MARGEM - 6,
      size: 7.5,
      font: negrito,
      color: VERDE,
    });
  });
  return pdf.save();
}

import { deflateSync } from "node:zlib";

/**
 * Foto de demonstração do visor da balança (PNG gerado na hora): o saco na cor do tipo em cima da balança e o visor
 * com o peso. Serve para a tela de aprovação dos dados de demonstração parecer com a de verdade, sem guardar imagens no repositório.
 */
const LARGURA = 320;
const ALTURA = 200;
type Cor = [number, number, number];

const SEGMENTOS: Record<string, string> = {
  "0": "abcdef",
  "1": "bc",
  "2": "abged",
  "3": "abgcd",
  "4": "fgbc",
  "5": "afgcd",
  "6": "afgedc",
  "7": "abc",
  "8": "abcdefg",
  "9": "abcfgd",
};

function lerCor(hex: string): Cor {
  const limpo = hex.replace("#", "");
  return [
    parseInt(limpo.slice(0, 2), 16),
    parseInt(limpo.slice(2, 4), 16),
    parseInt(limpo.slice(4, 6), 16),
  ];
}

const tabelaCrc = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(dados: Buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < dados.length; i += 1)
    c = tabelaCrc[(c ^ dados[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bloco(tipo: string, dados: Buffer) {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, "ascii"), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([tamanho, corpo, crc]);
}

function codificarPng(pixels: Uint8Array) {
  const cabecalho = Buffer.alloc(13);
  cabecalho.writeUInt32BE(LARGURA, 0);
  cabecalho.writeUInt32BE(ALTURA, 4);
  cabecalho[8] = 8; // bits por canal
  cabecalho[9] = 2; // RGB
  const linhas = Buffer.alloc((LARGURA * 3 + 1) * ALTURA);
  for (let y = 0; y < ALTURA; y += 1) {
    linhas[y * (LARGURA * 3 + 1)] = 0;
    Buffer.from(
      pixels.buffer,
      pixels.byteOffset + y * LARGURA * 3,
      LARGURA * 3
    ).copy(linhas, y * (LARGURA * 3 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    bloco("IHDR", cabecalho),
    bloco("IDAT", deflateSync(linhas)),
    bloco("IEND", Buffer.alloc(0)),
  ]);
}

export function fotoDoVisor(pesoGramas: number | null, corSaco = "#1f6fd1") {
  const pixels = new Uint8Array(LARGURA * ALTURA * 3);
  const pintar = (
    x0: number,
    y0: number,
    largura: number,
    altura: number,
    cor: Cor
  ) => {
    for (let y = Math.max(0, y0); y < Math.min(ALTURA, y0 + altura); y += 1) {
      for (let x = Math.max(0, x0); x < Math.min(LARGURA, x0 + largura); x += 1)
        pixels.set(cor, (y * LARGURA + x) * 3);
    }
  };
  // Parede e piso da área das lixeiras.
  for (let y = 0; y < ALTURA; y += 1)
    pintar(
      0,
      y,
      LARGURA,
      1,
      y < 150
        ? [
            214 - Math.round(y / 12),
            210 - Math.round(y / 12),
            202 - Math.round(y / 12),
          ]
        : [150, 146, 138]
    );
  // Saco na cor do tipo, com o nó em cima.
  const cor = lerCor(corSaco);
  const escura: Cor = [
    Math.round(cor[0] * 0.75),
    Math.round(cor[1] * 0.75),
    Math.round(cor[2] * 0.75),
  ];
  for (let y = 52; y < 128; y += 1) {
    const recuo = Math.max(0, Math.round((70 - (y - 52)) / 5));
    pintar(34 + recuo, y, 150 - recuo * 2, 1, y % 17 === 0 ? escura : cor);
  }
  pintar(98, 38, 22, 16, escura);
  // Balança: plataforma, base e a coluna com o visor.
  pintar(18, 126, 250, 12, [120, 126, 132]);
  pintar(24, 138, 238, 30, [58, 63, 68]);
  pintar(270, 70, 10, 98, [58, 63, 68]);
  pintar(206, 18, 106, 56, [40, 44, 48]);
  pintar(212, 26, 94, 40, [178, 214, 164]);
  // Peso no visor (sete segmentos), alinhado à direita.
  if (pesoGramas !== null) {
    const texto = (pesoGramas / 1000).toFixed(2);
    const tinta: Cor = [24, 40, 22];
    let x = 300;
    for (const caractere of texto.split("").reverse()) {
      if (caractere === ".") {
        pintar(x - 4, 56, 4, 4, tinta);
        x -= 7;
        continue;
      }
      x -= 16;
      const s = SEGMENTOS[caractere] ?? "";
      if (s.includes("a")) pintar(x + 2, 30, 10, 3, tinta);
      if (s.includes("b")) pintar(x + 11, 32, 3, 12, tinta);
      if (s.includes("c")) pintar(x + 11, 46, 3, 12, tinta);
      if (s.includes("d")) pintar(x + 2, 57, 10, 3, tinta);
      if (s.includes("e")) pintar(x, 46, 3, 12, tinta);
      if (s.includes("f")) pintar(x, 32, 3, 12, tinta);
      if (s.includes("g")) pintar(x + 2, 44, 10, 3, tinta);
      x -= 3;
    }
  }
  return `data:image/png;base64,${codificarPng(pixels).toString("base64")}`;
}

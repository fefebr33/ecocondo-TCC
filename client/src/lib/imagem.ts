/** Valida e reduz uma foto (lado maior até 1600 px, WebP) antes de enviar ao servidor como data URL. */
export function reduzirFoto(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return Promise.reject(new Error("Envie imagem PNG, JPEG ou WebP."));
  if (file.size > 12 * 1024 * 1024) return Promise.reject(new Error("A imagem é grande demais. Tente de novo com a câmera do aparelho."));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Não foi possível abrir a imagem."));
      image.onload = () => {
        const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/webp", 0.82));
      };
      image.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Confere se a foto do visor está legível: nem escura, nem estourada, nem tremida (variância do laplaciano numa cópia pequena).
 * Não bloqueia o envio; só avisa a pessoa para tirar de novo, o que evita reprovação por foto ruim.
 */
export function avaliarFoto(dataUrl: string): Promise<{ ok: boolean; dica: string | null; brilho: number; nitidez: number }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onerror = () => resolve({ ok: true, dica: null, brilho: 0, nitidez: 0 });
    image.onload = () => {
      const escala = Math.min(1, 240 / Math.max(image.width, image.height));
      const largura = Math.max(3, Math.round(image.width * escala));
      const altura = Math.max(3, Math.round(image.height * escala));
      const canvas = document.createElement("canvas");
      canvas.width = largura;
      canvas.height = altura;
      const contexto = canvas.getContext("2d");
      if (!contexto) return resolve({ ok: true, dica: null, brilho: 0, nitidez: 0 });
      contexto.drawImage(image, 0, 0, largura, altura);
      const { data } = contexto.getImageData(0, 0, largura, altura);
      const cinza = new Float32Array(largura * altura);
      let soma = 0;
      for (let indice = 0; indice < cinza.length; indice += 1) {
        cinza[indice] = 0.299 * data[indice * 4] + 0.587 * data[indice * 4 + 1] + 0.114 * data[indice * 4 + 2];
        soma += cinza[indice];
      }
      const brilho = soma / cinza.length;
      let somaLaplaciano = 0;
      let somaQuadrados = 0;
      let pontos = 0;
      for (let y = 1; y < altura - 1; y += 1) {
        for (let x = 1; x < largura - 1; x += 1) {
          const centro = y * largura + x;
          const valor = cinza[centro - 1] + cinza[centro + 1] + cinza[centro - largura] + cinza[centro + largura] - 4 * cinza[centro];
          somaLaplaciano += valor;
          somaQuadrados += valor * valor;
          pontos += 1;
        }
      }
      const media = somaLaplaciano / Math.max(1, pontos);
      const nitidez = somaQuadrados / Math.max(1, pontos) - media * media;
      const dica = brilho < 45 ? "A foto ficou escura. Aproxime o visor da luz ou ligue a lanterna." : brilho > 235 ? "A foto ficou clara demais (reflexo). Incline um pouco o tablet." : nitidez < 25 ? "A foto parece tremida ou fora de foco. Segure firme e tire de novo." : null;
      resolve({ ok: dica === null, dica, brilho, nitidez });
    };
    image.src = dataUrl;
  });
}

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

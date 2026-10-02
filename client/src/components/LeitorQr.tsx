import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";

type Detector = {
  detect: (fonte: HTMLVideoElement) => Promise<Array<{ rawValue: string }>>;
};

/** A câmera do navegador só abre em conexão segura (https ou localhost) e com o leitor de QR nativo (Chrome/Edge no Android). */
export function cameraDisponivel() {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "BarcodeDetector" in window &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

/**
 * Lê um QR com a câmera. `extrair` diz o que vale no texto lido (o código de 6 números do app ou o código de um adesivo);
 * enquanto não achar, continua lendo.
 */
export default function LeitorQr({
  onLer,
  onCancelar,
  extrair = texto => {
    const numeros = texto.replace(/\D/g, "");
    return numeros.length === 6 ? numeros : null;
  },
}: {
  onLer: (valor: string) => void;
  onCancelar: () => void;
  extrair?: (texto: string) => string | null;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [falha, setFalha] = useState<string | null>(null);
  useEffect(() => {
    let ativo = true;
    let fluxo: MediaStream | null = null;
    const Construtor = (
      window as unknown as {
        BarcodeDetector: new (opcoes: { formats: string[] }) => Detector;
      }
    ).BarcodeDetector;
    const detector = new Construtor({ formats: ["qr_code"] });
    (async () => {
      try {
        fluxo = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (!video.current) return;
        video.current.srcObject = fluxo;
        await video.current.play();
        while (ativo && video.current) {
          const achados = await detector.detect(video.current).catch(() => []);
          const codigo = achados
            .map(item => extrair(item.rawValue))
            .find(Boolean);
          if (codigo) {
            onLer(codigo);
            return;
          }
          await new Promise(resolver => setTimeout(resolver, 250));
        }
      } catch {
        setFalha("Não foi possível abrir a câmera. Digite o código.");
      }
    })();
    return () => {
      ativo = false;
      fluxo?.getTracks().forEach(trilha => trilha.stop());
    };
  }, []);
  return (
    <div className="mt-3 grid gap-2">
      {falha ? (
        <p
          role="alert"
          className="rounded-xl bg-[#fbeceb] px-4 py-3 text-sm text-[#b3382c]"
        >
          {falha}
        </p>
      ) : (
        <video
          ref={video}
          muted
          playsInline
          aria-label="Imagem da câmera para ler o QR"
          className="max-h-64 w-full rounded-2xl bg-black object-cover"
        />
      )}
      <Button
        type="button"
        variant="ghost"
        onClick={onCancelar}
        className="h-10 rounded-xl"
      >
        Fechar a câmera
      </Button>
    </div>
  );
}

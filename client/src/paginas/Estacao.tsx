import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { esquecerTokenEstacao, guardarTokenEstacao, lerTokenEstacao } from "@/lib/estacao";
import { reduzirFoto } from "@/lib/imagem";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, Camera, CheckCircle2, Clock, FlaskConical, KeyRound, Leaf, QrCode, Scale, ShieldCheck } from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";

const wasteLabels = { reciclavel: "Reciclável", organico: "Orgânico", rejeito: "Rejeito", eletronico: "Eletrônico", perigoso: "Perigoso" } as const;
type WasteType = keyof typeof wasteLabels;
type Morador = { firstName: string; block: string; apartment: string };
type Resultado = { id: number; pointsAwarded: number; pendingApproval: boolean; pendingPoints: number; reviewReasons: string[]; simulated: boolean; weightKg: string };
type Previa = { estacao: string; morador: string; bloco: string; material: string; pesoKg: string; unidade: string; pesagemSimulada: boolean; bloqueio: string | null; pontosPrevistos: number; motivosRevisao: string[]; sujeitoASorteio: boolean };

/** Pesos prontos para a balança simulada (modo demonstração). */
const PESOS_DEMONSTRACAO = ["0,50", "1,20", "2,50", "5,00", "12,00"];

/** Depois de um tempo sem uso, a tela volta ao início para o próximo morador não registrar no nome de outro. */
const TEMPO_OCIOSO_MS = 120_000;

/** Tela do tablet ao lado das lixeiras: o morador digita o código do app, pesa, fotografa o visor da balança e registra. */
export default function Estacao() {
  const [token, setToken] = useState<string | null>(() => lerTokenEstacao());
  useEffect(() => {
    // Link de pareamento (/estacao?codigo=...): guarda o código no tablet e tira da barra de endereço.
    const codigo = new URLSearchParams(window.location.search).get("codigo");
    if (codigo) {
      guardarTokenEstacao(codigo);
      setToken(codigo);
      window.history.replaceState(null, "", "/estacao");
    }
  }, []);
  const status = trpc.estacao.status.useQuery(undefined, { enabled: Boolean(token), retry: false });

  function parear(codigo: string) {
    guardarTokenEstacao(codigo);
    setToken(codigo);
  }
  function desparear() {
    esquecerTokenEstacao();
    setToken(null);
  }

  return (
    <div className="min-h-screen bg-[#f3f8f5] text-foreground">
      <header className="mx-auto flex max-w-[860px] items-center justify-between px-5 py-5">
        <span className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[linear-gradient(145deg,#0f7350,#0c4f3a)] text-white"><Leaf className="h-5 w-5" /></span>
          <span>
            <span className="block text-base font-bold tracking-[-.03em]">EcoCondo · Estação de pesagem</span>
            <span className="block text-xs text-muted-foreground">{status.data ? `${status.data.nome} · ${status.data.local}` : "Tablet da coleta seletiva"}</span>
          </span>
        </span>
      </header>
      {status.data?.modoDemonstracao && !status.error && (
        <div role="status" className="mx-auto mb-4 flex max-w-[860px] items-start gap-3 rounded-2xl border-2 border-dashed border-[#d98c1f] bg-[#fff6e6] px-5 py-3 text-sm text-[#7a4d0a] sm:mx-auto">
          <FlaskConical className="mt-0.5 h-5 w-5 shrink-0" />
          <span><b className="font-bold uppercase tracking-[.06em]">Modo demonstração · simulação de hardware.</b> Esta estação não está ligada a uma balança: o peso é informado manualmente, como se viesse dela. Os registros ficam marcados como "pesagem simulada".</span>
        </div>
      )}
      <main className="mx-auto max-w-[860px] px-5 pb-16">
        {!token || status.error ? (
          <Pareamento erro={token ? status.error?.message ?? null : null} onParear={parear} onEsquecer={token ? desparear : undefined} />
        ) : status.isLoading ? (
          <p className="py-20 text-center text-muted-foreground">Conectando a estação...</p>
        ) : (
          <Registro limiteKg={status.data?.limitePorRegistroKg ?? 30} demonstracao={status.data?.modoDemonstracao ?? false} estacao={status.data ? `${status.data.nome} · ${status.data.local}` : ""} />
        )}
      </main>
    </div>
  );
}

function Pareamento({ erro, onParear, onEsquecer }: { erro: string | null; onParear: (codigo: string) => void; onEsquecer?: () => void }) {
  const [codigo, setCodigo] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (codigo.trim().length >= 10) onParear(codigo.trim());
  }
  return (
    <section className="rounded-[28px] border border-[#dce8e0] bg-white p-6 sm:p-8">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#e8f4ed] text-[#0f7350]"><KeyRound className="h-6 w-6" /></span>
      <h1 className="mt-5 text-2xl font-bold tracking-[-.04em]">Parear este tablet</h1>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Só um tablet cadastrado pelo administrador pode registrar reciclagem. No computador do síndico, abra Configurações &gt; Estações de pesagem, cadastre a estação e digite aqui o código de pareamento (ou abra o link de pareamento neste tablet).</p>
      {erro && <p role="alert" className="mt-4 rounded-xl bg-[#fbeceb] px-4 py-3 text-sm text-[#b3382c]">{erro}</p>}
      <form onSubmit={submit} className="mt-5 flex flex-col gap-3 sm:flex-row">
        <Input aria-label="Código de pareamento" value={codigo} onChange={(event) => setCodigo(event.target.value)} placeholder="Código de pareamento" autoComplete="off" className="h-12 rounded-xl text-base" />
        <Button disabled={codigo.trim().length < 10} className="h-12 rounded-xl bg-[#0f7350] px-6 text-white hover:bg-[#0a6243]">Parear</Button>
      </form>
      {onEsquecer && <Button variant="ghost" onClick={onEsquecer} className="mt-3 h-9 rounded-xl text-xs text-muted-foreground">Apagar o código salvo neste tablet</Button>}
    </section>
  );
}

function Registro({ limiteKg, demonstracao, estacao }: { limiteKg: number; demonstracao: boolean; estacao: string }) {
  const [etapa, setEtapa] = useState<"codigo" | "pesar" | "conferir" | "feito">("codigo");
  const [codigo, setCodigo] = useState("");
  const [morador, setMorador] = useState<Morador | null>(null);
  const [tipo, setTipo] = useState<WasteType>("reciclavel");
  const [pesoKg, setPesoKg] = useState("");
  const [foto, setFoto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [lendoQr, setLendoQr] = useState(false);

  function recomecar() {
    setEtapa("codigo");
    setCodigo("");
    setMorador(null);
    setTipo("reciclavel");
    setPesoKg("");
    setFoto("");
    setErro(null);
    setPrevia(null);
    setResultado(null);
    setLendoQr(false);
  }

  useEffect(() => {
    if (etapa === "codigo" && !codigo) return;
    const espera = setTimeout(recomecar, etapa === "feito" ? 20_000 : TEMPO_OCIOSO_MS);
    return () => clearTimeout(espera);
  }, [etapa, codigo, pesoKg, foto]);

  const identificar = trpc.estacao.identificar.useMutation({
    onSuccess: (dados) => { setMorador(dados); setErro(null); setEtapa("pesar"); },
    onError: (issue) => setErro(issue.message),
  });
  const conferir = trpc.estacao.previa.useMutation({
    onSuccess: (dados) => { setPrevia(dados); setErro(null); setEtapa("conferir"); },
    onError: (issue) => setErro(issue.message),
  });
  const registrar = trpc.estacao.registrar.useMutation({
    onSuccess: (dados) => { setResultado(dados); setErro(null); setEtapa("feito"); },
    onError: (issue) => setErro(issue.message),
  });

  function enviarCodigo(valor = codigo) {
    if (/^\d{6}$/.test(valor) && !identificar.isPending) identificar.mutate({ code: valor });
  }
  // Leitor de QR (USB/Bluetooth) funciona como teclado: digita os 6 números e o registro segue sozinho.
  function aoDigitarCodigo(valor: string) {
    const numeros = valor.replace(/\D/g, "").slice(0, 6);
    setCodigo(numeros);
    if (numeros.length === 6) enviarCodigo(numeros);
  }
  async function aoTirarFoto(event: ChangeEvent<HTMLInputElement>) {
    const arquivo = event.target.files?.[0];
    event.target.value = "";
    if (!arquivo) return;
    try {
      setFoto(await reduzirFoto(arquivo));
      setErro(null);
    } catch (issue) {
      setErro(issue instanceof Error ? issue.message : "Não foi possível usar a foto.");
    }
  }
  function pesoEmGramas() {
    const kg = Number(pesoKg.replace(",", "."));
    return Number.isFinite(kg) ? Math.round(kg * 1000) : NaN;
  }
  function irParaConferencia(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const gramas = pesoEmGramas();
    if (!Number.isFinite(gramas) || gramas <= 0) { setErro("Informe um peso maior que zero."); return; }
    if (gramas > limiteKg * 1000) { setErro(`O limite é ${limiteKg} kg por registro. Procure a administração para volumes maiores.`); return; }
    if (!demonstracao && !foto) { setErro("Tire a foto do visor da balança com o saco em cima."); return; }
    conferir.mutate({ code: codigo, wasteType: tipo, weightGrams: gramas });
  }
  function confirmar() {
    if (registrar.isPending) return;
    registrar.mutate({ code: codigo, wasteType: tipo, weightGrams: pesoEmGramas(), imageDataUrl: foto || null });
  }

  if (etapa === "feito" && resultado) {
    return (
      <section className="rounded-[28px] border border-[#cfe1d7] bg-white p-6 text-center sm:p-8">
        <span className={`mx-auto grid h-16 w-16 place-items-center rounded-full ${resultado.pendingApproval ? "bg-[#fff3df] text-[#7a4d0a]" : "bg-[#e7f5ec] text-[#0a7048]"}`}>{resultado.pendingApproval ? <Clock className="h-8 w-8" /> : <CheckCircle2 className="h-8 w-8" />}</span>
        <h1 className="mt-5 text-2xl font-bold tracking-[-.04em]">{resultado.pendingApproval ? "Registro recebido" : "Reciclagem registrada!"}</h1>
        <dl className="mx-auto mt-5 grid max-w-md gap-2 text-left text-sm">
          <Linha rotulo="Coleta" valor={`nº ${resultado.id}`} />
          <Linha rotulo="Peso" valor={`${resultado.weightKg} kg${resultado.simulated ? " (balança simulada)" : ""}`} />
          <Linha rotulo="Status" valor={resultado.pendingApproval ? "Concluída, em conferência pela administração" : "Concluída"} />
          <Linha rotulo="Pontos" valor={resultado.pendingApproval ? `${resultado.pendingPoints} pendente(s) até a aprovação` : `+${resultado.pointsAwarded}`} />
          <Linha rotulo="Notificações" valor={resultado.pendingApproval ? "Morador e administração avisados" : "Morador avisado no aplicativo"} />
        </dl>
        {resultado.pendingApproval && <p className="mx-auto mt-3 max-w-md text-xs text-muted-foreground">Motivo da conferência: {resultado.reviewReasons.join("; ")}.</p>}
        <Button onClick={recomecar} className="mt-6 h-12 rounded-xl bg-[#0f7350] px-8 text-base text-white hover:bg-[#0a6243]">Novo registro</Button>
      </section>
    );
  }

  if (etapa === "conferir" && previa) {
    return (
      <section className="rounded-[28px] border border-[#dce8e0] bg-white p-6 sm:p-8">
        <h1 className="text-2xl font-bold tracking-[-.04em]">Confira antes de confirmar</h1>
        <p className="mt-1 text-sm text-muted-foreground">Nada foi gravado ainda. Se algo estiver errado, volte e corrija.</p>
        <dl className="mt-5 grid gap-2 text-sm">
          <Linha rotulo="Estação" valor={estacao || previa.estacao} />
          <Linha rotulo="Coleta" valor="Nova (o número sai ao confirmar)" />
          <Linha rotulo="Morador" valor={`${previa.morador} · Bloco ${previa.bloco}`} />
          <Linha rotulo="Material" valor={previa.material} />
          <Linha rotulo="Peso" valor={`${previa.pesoKg} ${previa.unidade}${previa.pesagemSimulada ? " · balança simulada" : ""}`} destaque />
          <Linha rotulo="Resultado" valor={previa.bloqueio ? `Bloqueado: ${previa.bloqueio}` : previa.motivosRevisao.length ? `Vai para conferência (${previa.motivosRevisao.join("; ")}); ${previa.pontosPrevistos} ponto(s) pendente(s)` : `${previa.pontosPrevistos} ponto(s) na hora${previa.sujeitoASorteio ? " (10% dos registros são sorteados para conferência)" : ""}`} alerta={Boolean(previa.bloqueio)} />
        </dl>
        {erro && <p role="alert" className="mt-4 rounded-xl bg-[#fbeceb] px-4 py-3 text-sm text-[#b3382c]">{erro}</p>}
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Button type="button" variant="outline" onClick={() => { setErro(null); setEtapa("pesar"); }} className="h-12 rounded-xl text-base">Voltar e corrigir</Button>
          <Button type="button" disabled={Boolean(previa.bloqueio) || registrar.isPending} onClick={confirmar} className="h-12 rounded-xl bg-[#0f7350] text-base text-white hover:bg-[#0a6243]">{registrar.isPending ? "Registrando..." : "Confirmar registro"}</Button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-[28px] border border-[#dce8e0] bg-white p-6 sm:p-8">
      {etapa === "codigo" ? (
        <form onSubmit={(event) => { event.preventDefault(); enviarCodigo(); }}>
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#e8f4ed] text-[#0f7350]"><ShieldCheck className="h-6 w-6" /></span>
          <h1 className="mt-5 text-2xl font-bold tracking-[-.04em]">Digite ou leia o código do seu aplicativo</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">No aplicativo EcoCondo, abra Coletas e toque em <b>Gerar código para a estação</b>. Digite os 6 números ou aproxime o QR do leitor. O código vale por 5 minutos e só pode ser usado uma vez.</p>
          <Input autoFocus aria-label="Código de 6 números" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={codigo} onChange={(event) => aoDigitarCodigo(event.target.value)} placeholder="000000" className="mt-5 h-16 rounded-2xl text-center text-3xl font-bold tracking-[.4em]" />
          {erro && <p role="alert" className="mt-3 rounded-xl bg-[#fbeceb] px-4 py-3 text-sm text-[#b3382c]">{erro}</p>}
          <Button disabled={codigo.length !== 6 || identificar.isPending} className="mt-4 h-12 w-full rounded-xl bg-[#0f7350] text-base text-white hover:bg-[#0a6243]">{identificar.isPending ? "Conferindo..." : "Continuar"}</Button>
          {cameraDisponivel() && (lendoQr
            ? <LeitorQr onLer={(valor) => { setLendoQr(false); aoDigitarCodigo(valor); }} onCancelar={() => setLendoQr(false)} />
            : <Button type="button" variant="outline" onClick={() => setLendoQr(true)} className="mt-3 h-12 w-full rounded-xl text-base"><QrCode className="mr-2 h-5 w-5" />Ler o QR com a câmera</Button>)}
        </form>
      ) : (
        <form onSubmit={irParaConferencia} className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-muted-foreground">Registrando para</p>
              <p className="text-xl font-bold tracking-[-.03em]">{morador?.firstName} · Bloco {morador?.block} · {morador?.apartment}</p>
            </div>
            <Button type="button" variant="ghost" onClick={recomecar} className="h-10 rounded-xl text-sm">Não sou eu</Button>
          </div>
          <label className="grid gap-1.5 text-sm font-semibold">Tipo de material
            <select value={tipo} onChange={(event) => setTipo(event.target.value as WasteType)} className="h-12 rounded-xl border border-[#dce8e0] bg-white px-3 text-base">
              {Object.entries(wasteLabels).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
            </select>
            <span className="text-xs font-normal text-muted-foreground">Só material reciclável soma pontos (1 ponto por kg completo).</span>
          </label>
          {demonstracao ? (
            <div className="rounded-2xl border-2 border-dashed border-[#d98c1f] bg-[#fffaf1] p-4">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.08em] text-[#7a4d0a]"><FlaskConical className="h-4 w-4" />Balança simulada</p>
              <p aria-live="polite" className="mt-2 rounded-xl bg-[#1d2a24] px-4 py-3 text-right font-mono text-4xl font-bold text-[#8ff0b5]">{pesoKg ? Number(pesoKg.replace(",", ".") || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0,00"} kg</p>
              <div className="mt-3 flex flex-wrap gap-2">{PESOS_DEMONSTRACAO.map((valor) => <Button key={valor} type="button" variant="outline" onClick={() => setPesoKg(valor)} className="h-10 rounded-xl bg-white">{valor} kg</Button>)}</div>
              <label className="mt-3 grid gap-1.5 text-sm font-semibold">Ou digite o peso (kg)
                <Input required inputMode="decimal" value={pesoKg} onChange={(event) => setPesoKg(event.target.value.replace(/[^\d.,-]/g, ""))} placeholder="Ex.: 2,50" className="h-12 rounded-xl bg-white text-xl font-bold" />
              </label>
            </div>
          ) : (
            <label className="grid gap-1.5 text-sm font-semibold">Peso mostrado na balança (kg)
              <Input required inputMode="decimal" value={pesoKg} onChange={(event) => setPesoKg(event.target.value.replace(/[^\d.,-]/g, ""))} placeholder="Ex.: 3,4" className="h-14 rounded-xl text-2xl font-bold" />
            </label>
          )}
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#b9d8c5] bg-[#f6faf7] px-4 py-5 text-base font-semibold text-[#0f7350]">
            <Camera className="h-5 w-5" />{foto ? "Tirar outra foto" : demonstracao ? "Fotografar o visor (opcional na demonstração)" : "Fotografar o visor da balança (obrigatório)"}
            <input className="sr-only" type="file" accept="image/*" capture="environment" onChange={aoTirarFoto} />
          </label>
          {foto && <img src={foto} alt="Foto do visor da balança" className="max-h-56 w-full rounded-2xl border border-[#e2ebe5] object-contain" />}
          <p className="flex items-start gap-2 rounded-xl bg-[#f7fbf8] px-4 py-3 text-xs leading-5 text-muted-foreground"><Scale className="mt-0.5 h-4 w-4 shrink-0 text-[#0f7350]" />O peso{demonstracao ? "" : " e a foto"} ficam gravados. Registros acima de 10 kg ou fora do seu padrão{demonstracao ? "" : ", e alguns sorteados,"} passam pela administração antes de somar pontos.</p>
          {erro && <p role="alert" className="rounded-xl bg-[#fbeceb] px-4 py-3 text-sm text-[#b3382c]">{erro}</p>}
          <Button disabled={conferir.isPending} className="h-12 rounded-xl bg-[#0f7350] text-base text-white hover:bg-[#0a6243]">{conferir.isPending ? "Conferindo..." : "Conferir registro"}</Button>
        </form>
      )}
    </section>
  );
}

function Linha({ rotulo, valor, destaque, alerta }: { rotulo: string; valor: string; destaque?: boolean; alerta?: boolean }) {
  return (
    <div className={`flex flex-wrap items-baseline justify-between gap-2 rounded-xl px-4 py-2.5 ${alerta ? "bg-[#fbeceb] text-[#b3382c]" : "bg-[#f6faf7]"}`}>
      <dt className="text-xs font-bold uppercase tracking-[.08em] text-muted-foreground">{rotulo}</dt>
      <dd className={`text-right ${destaque ? "text-2xl font-bold text-[#0f7350]" : "font-semibold"}`}>{alerta && <AlertTriangle className="mr-1 inline h-4 w-4" />}{valor}</dd>
    </div>
  );
}

type Detector = { detect: (fonte: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> };

/** A câmera do navegador só abre em conexão segura (https ou localhost) e com o leitor de QR nativo (Chrome/Edge no Android). */
function cameraDisponivel() {
  return typeof window !== "undefined" && window.isSecureContext && "BarcodeDetector" in window && Boolean(navigator.mediaDevices?.getUserMedia);
}

function LeitorQr({ onLer, onCancelar }: { onLer: (valor: string) => void; onCancelar: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [falha, setFalha] = useState<string | null>(null);
  useEffect(() => {
    let ativo = true;
    let fluxo: MediaStream | null = null;
    const Construtor = (window as unknown as { BarcodeDetector: new (opcoes: { formats: string[] }) => Detector }).BarcodeDetector;
    const detector = new Construtor({ formats: ["qr_code"] });
    (async () => {
      try {
        fluxo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current) return;
        video.current.srcObject = fluxo;
        await video.current.play();
        while (ativo && video.current) {
          const achados = await detector.detect(video.current).catch(() => []);
          const codigo = achados.map((item) => item.rawValue.replace(/\D/g, "")).find((valor) => valor.length === 6);
          if (codigo) { onLer(codigo); return; }
          await new Promise((resolver) => setTimeout(resolver, 250));
        }
      } catch {
        setFalha("Não foi possível abrir a câmera. Digite o código.");
      }
    })();
    return () => { ativo = false; fluxo?.getTracks().forEach((trilha) => trilha.stop()); };
  }, []);
  return (
    <div className="mt-3 grid gap-2">
      {falha ? <p role="alert" className="rounded-xl bg-[#fbeceb] px-4 py-3 text-sm text-[#b3382c]">{falha}</p> : <video ref={video} muted playsInline aria-label="Imagem da câmera para ler o QR" className="max-h-64 w-full rounded-2xl bg-black object-cover" />}
      <Button type="button" variant="ghost" onClick={onCancelar} className="h-10 rounded-xl">Fechar a câmera</Button>
    </div>
  );
}

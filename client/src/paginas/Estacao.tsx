import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { esquecerTokenEstacao, guardarTokenEstacao, lerTokenEstacao } from "@/lib/estacao";
import { reduzirFoto } from "@/lib/imagem";
import { trpc } from "@/lib/trpc";
import { Camera, CheckCircle2, Clock, KeyRound, Leaf, Scale, ShieldCheck } from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useState } from "react";

const wasteLabels = { reciclavel: "Reciclável", organico: "Orgânico", rejeito: "Rejeito", eletronico: "Eletrônico", perigoso: "Perigoso" } as const;
type WasteType = keyof typeof wasteLabels;
type Morador = { firstName: string; block: string; apartment: string };
type Resultado = { pointsAwarded: number; pendingApproval: boolean; pendingPoints: number; kg: string };

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
      <main className="mx-auto max-w-[860px] px-5 pb-16">
        {!token || status.error ? (
          <Pareamento erro={token ? status.error?.message ?? null : null} onParear={parear} onEsquecer={token ? desparear : undefined} />
        ) : status.isLoading ? (
          <p className="py-20 text-center text-muted-foreground">Conectando a estação...</p>
        ) : (
          <Registro limiteKg={status.data?.limitePorRegistroKg ?? 30} />
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

function Registro({ limiteKg }: { limiteKg: number }) {
  const [etapa, setEtapa] = useState<"codigo" | "pesar" | "feito">("codigo");
  const [codigo, setCodigo] = useState("");
  const [morador, setMorador] = useState<Morador | null>(null);
  const [tipo, setTipo] = useState<WasteType>("reciclavel");
  const [pesoKg, setPesoKg] = useState("");
  const [foto, setFoto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  function recomecar() {
    setEtapa("codigo");
    setCodigo("");
    setMorador(null);
    setTipo("reciclavel");
    setPesoKg("");
    setFoto("");
    setErro(null);
    setResultado(null);
  }

  useEffect(() => {
    if (etapa === "codigo" && !codigo) return;
    const espera = setTimeout(recomecar, etapa === "feito" ? 15_000 : TEMPO_OCIOSO_MS);
    return () => clearTimeout(espera);
  }, [etapa, codigo, pesoKg, foto]);

  const identificar = trpc.estacao.identificar.useMutation({
    onSuccess: (dados) => { setMorador(dados); setErro(null); setEtapa("pesar"); },
    onError: (issue) => setErro(issue.message),
  });
  const registrar = trpc.estacao.registrar.useMutation({
    onSuccess: (dados) => { setResultado({ ...dados, kg: Number(pesoKg.replace(",", ".")).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) }); setErro(null); setEtapa("feito"); },
    onError: (issue) => setErro(issue.message),
  });

  function enviarCodigo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (/^\d{6}$/.test(codigo)) identificar.mutate({ code: codigo });
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
  function enviarRegistro(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const kg = Number(pesoKg.replace(",", "."));
    if (!Number.isFinite(kg) || kg <= 0) { setErro("Informe o peso mostrado na balança."); return; }
    if (kg > limiteKg) { setErro(`O limite é ${limiteKg} kg por registro. Procure a administração para volumes maiores.`); return; }
    if (!foto) { setErro("Tire a foto do visor da balança com o saco em cima."); return; }
    registrar.mutate({ code: codigo, wasteType: tipo, weightGrams: Math.round(kg * 1000), imageDataUrl: foto });
  }

  if (etapa === "feito" && resultado) {
    return (
      <section className="rounded-[28px] border border-[#cfe1d7] bg-white p-8 text-center">
        <span className={`mx-auto grid h-16 w-16 place-items-center rounded-full ${resultado.pendingApproval ? "bg-[#fff3df] text-[#7a4d0a]" : "bg-[#e7f5ec] text-[#0a7048]"}`}>{resultado.pendingApproval ? <Clock className="h-8 w-8" /> : <CheckCircle2 className="h-8 w-8" />}</span>
        <h1 className="mt-5 text-2xl font-bold tracking-[-.04em]">{resultado.pendingApproval ? "Registro recebido" : "Reciclagem registrada!"}</h1>
        <p className="mx-auto mt-2 max-w-md text-base leading-7 text-muted-foreground">
          {resultado.pendingApproval
            ? `${resultado.kg} kg registrados. O registro vai ser conferido pela administração e os ${resultado.pendingPoints} ponto(s) entram depois da aprovação.`
            : `${resultado.kg} kg registrados${resultado.pointsAwarded ? ` e ${resultado.pointsAwarded} ponto(s) somados à sua conta` : ""}. Obrigado por reciclar!`}
        </p>
        <Button onClick={recomecar} className="mt-6 h-12 rounded-xl bg-[#0f7350] px-8 text-base text-white hover:bg-[#0a6243]">Novo registro</Button>
      </section>
    );
  }

  return (
    <section className="rounded-[28px] border border-[#dce8e0] bg-white p-6 sm:p-8">
      {etapa === "codigo" ? (
        <form onSubmit={enviarCodigo}>
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#e8f4ed] text-[#0f7350]"><ShieldCheck className="h-6 w-6" /></span>
          <h1 className="mt-5 text-2xl font-bold tracking-[-.04em]">Digite o código do seu aplicativo</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">No aplicativo EcoCondo, abra Coletas e toque em <b>Gerar código para a estação</b>. O código tem 6 números, vale por 5 minutos e só pode ser usado uma vez.</p>
          <Input aria-label="Código de 6 números" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={codigo} onChange={(event) => setCodigo(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" className="mt-5 h-16 rounded-2xl text-center text-3xl font-bold tracking-[.4em]" />
          {erro && <p role="alert" className="mt-3 rounded-xl bg-[#fbeceb] px-4 py-3 text-sm text-[#b3382c]">{erro}</p>}
          <Button disabled={codigo.length !== 6 || identificar.isPending} className="mt-4 h-12 w-full rounded-xl bg-[#0f7350] text-base text-white hover:bg-[#0a6243]">{identificar.isPending ? "Conferindo..." : "Continuar"}</Button>
        </form>
      ) : (
        <form onSubmit={enviarRegistro} className="grid gap-4">
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
          <label className="grid gap-1.5 text-sm font-semibold">Peso mostrado na balança (kg)
            <Input required inputMode="decimal" value={pesoKg} onChange={(event) => setPesoKg(event.target.value.replace(/[^\d.,]/g, ""))} placeholder="Ex.: 3,4" className="h-14 rounded-xl text-2xl font-bold" />
          </label>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#b9d8c5] bg-[#f6faf7] px-4 py-5 text-base font-semibold text-[#0f7350]">
            <Camera className="h-5 w-5" />{foto ? "Tirar outra foto" : "Fotografar o visor da balança (obrigatório)"}
            <input className="sr-only" type="file" accept="image/*" capture="environment" onChange={aoTirarFoto} />
          </label>
          {foto && <img src={foto} alt="Foto do visor da balança" className="max-h-56 w-full rounded-2xl border border-[#e2ebe5] object-contain" />}
          <p className="flex items-start gap-2 rounded-xl bg-[#f7fbf8] px-4 py-3 text-xs leading-5 text-muted-foreground"><Scale className="mt-0.5 h-4 w-4 shrink-0 text-[#0f7350]" />A foto e o peso ficam gravados. Registros acima de 10 kg, fora do seu padrão ou sorteados para conferência passam pela administração antes de somar pontos.</p>
          {erro && <p role="alert" className="rounded-xl bg-[#fbeceb] px-4 py-3 text-sm text-[#b3382c]">{erro}</p>}
          <Button disabled={registrar.isPending} className="h-12 rounded-xl bg-[#0f7350] text-base text-white hover:bg-[#0a6243]">{registrar.isPending ? "Registrando..." : "Registrar"}</Button>
        </form>
      )}
    </section>
  );
}

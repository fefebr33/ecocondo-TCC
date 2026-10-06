import { Button } from "@/components/ui/button";
import { pontuaPorEntrega } from "@shared/descarte";
import { Input } from "@/components/ui/input";
import {
  esquecerTokenEstacao,
  guardarTokenEstacao,
  lerTokenEstacao,
} from "@/lib/estacao";
import { avaliarFoto, reduzirFoto } from "@/lib/imagem";
import { formatarPontos, type TipoResiduo } from "@/lib/descarte";
import BotaoTema from "@/components/BotaoTema";
import { manualEstacao, SecoesManual } from "@/components/Manual";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import LeitorQr, { cameraDisponivel } from "@/components/LeitorQr";
import { normalizarCodigoAdesivo } from "@shared/adesivos";
import {
  AlertTriangle,
  BookOpen,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  FlaskConical,
  KeyRound,
  Leaf,
  QrCode,
  ShieldCheck,
  ShoppingBag,
} from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { palavra, plural } from "@shared/plural";

type WasteType = TipoResiduo;
type Morador = {
  firstName: string;
  block: string;
  apartment: string;
  adesivosDisponiveis: number;
  adesivoObrigatorio: boolean;
  adesivosDemonstracao: string[];
};
type ResultadoIa = {
  resultado: "aprovado_automatico" | "pendente" | "erro";
  motivos: string[];
  confianca: number;
  descricao: string;
};
type Resultado = {
  id: number;
  semPontos: string | null;
  pendingPoints: number;
  pointsAwarded: number;
  pontosAprovados: number;
  pendingApproval: boolean;
  simulated: boolean;
  weightKg: string;
  modoIa: string;
  itens: Array<{
    id: number;
    wasteType: WasteType;
    material: string;
    pesoKg: string;
    pontosPrevistos: number;
    alertas: string[];
    adesivo: string | null;
    situacao: "aprovado" | "pendente";
    ia: ResultadoIa;
  }>;
};
/** O que a IA simulada deve "ver" na foto (só na estação em modo demonstração). */
type SimulacaoIa =
  | "tudo_certo"
  | "cor_errada"
  | "tipo_diferente"
  | "peso_diferente"
  | "foto_ilegivel";
const rotuloSimulacaoIa: Record<SimulacaoIa, string> = {
  tudo_certo: "Tudo certo (a IA aprova)",
  cor_errada: "Saco de cor errada",
  tipo_diferente: "Resíduo de outro tipo",
  peso_diferente: "Peso diferente do visor",
  foto_ilegivel: "Foto ilegível",
};
type Previa = {
  estacao: string;
  morador: string;
  bloco: string;
  unidade: string;
  pesagemSimulada: boolean;
  pesoTotalKg: string;
  bloqueio: string | null;
  semPontos: string | null;
  pontosPrevistos: number;
  itens: Array<{
    wasteType: WasteType;
    material: string;
    pesoKg: string;
    pontosPrevistos: number;
    alertas: string[];
    adesivo: string | null;
  }>;
};

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
  const status = trpc.estacao.status.useQuery(undefined, {
    enabled: Boolean(token),
    retry: false,
  });
  const [manualAberto, setManualAberto] = useState(false);

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
      <header className="mx-auto flex max-w-[860px] flex-wrap items-center justify-between gap-3 px-5 py-5">
        <span className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[linear-gradient(145deg,#0f7350,#0c4f3a)] text-white">
            <Leaf className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-base font-bold tracking-[-.03em]">
              EcoCondo · Estação de pesagem
            </span>
            <span className="block text-xs text-muted-foreground">
              {status.data
                ? `${status.data.nome} · ${status.data.local}`
                : "Tablet dos descartes"}
            </span>
          </span>
        </span>
        <span className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setManualAberto(true)}
            className="h-10 rounded-xl"
          >
            <BookOpen className="mr-2 h-4 w-4" />
            Como usar
          </Button>
          <BotaoTema />
        </span>
      </header>
      <Dialog open={manualAberto} onOpenChange={setManualAberto}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Como usar a estação de pesagem</DialogTitle>
            <DialogDescription>
              O passo a passo do descarte, do código até a aprovação.
            </DialogDescription>
          </DialogHeader>
          <SecoesManual
            secoes={manualEstacao(
              Object.fromEntries(
                (status.data?.tipos ?? []).map(tipo => [
                  tipo.tipo,
                  tipo.nomeCorSaco,
                ])
              )
            )}
          />
          <Button
            onClick={() => setManualAberto(false)}
            className="h-11 rounded-xl bg-[#0f7350] text-white hover:bg-[#0a6243]"
          >
            Entendi
          </Button>
        </DialogContent>
      </Dialog>
      {status.data?.modoDemonstracao && !status.error && (
        <div
          role="status"
          className="mx-auto mb-4 flex max-w-[860px] items-start gap-3 rounded-2xl border-2 border-dashed border-[#d98c1f] bg-[#fff6e6] px-5 py-3 text-sm text-[#7a4d0a] sm:mx-auto"
        >
          <FlaskConical className="mt-0.5 h-5 w-5 shrink-0" />
          <span>
            <b className="font-bold uppercase tracking-[.06em]">
              Modo demonstração · simulação de hardware.
            </b>{" "}
            Esta estação não está ligada a uma balança: o peso é informado
            manualmente, como se viesse dela. Os registros ficam marcados como
            "pesagem simulada".
          </span>
        </div>
      )}
      <main className="mx-auto max-w-[860px] px-5 pb-16">
        {!token || status.error ? (
          <Pareamento
            erro={token ? (status.error?.message ?? null) : null}
            onParear={parear}
            onEsquecer={token ? desparear : undefined}
          />
        ) : status.isLoading ? (
          <p className="py-20 text-center text-muted-foreground">
            Conectando a estação...
          </p>
        ) : (
          <Registro
            tipos={status.data?.tipos ?? []}
            maximoItens={status.data?.maximoItens ?? 5}
            demonstracao={status.data?.modoDemonstracao ?? false}
            estacao={
              status.data ? `${status.data.nome} · ${status.data.local}` : ""
            }
          />
        )}
      </main>
    </div>
  );
}

function Pareamento({
  erro,
  onParear,
  onEsquecer,
}: {
  erro: string | null;
  onParear: (codigo: string) => void;
  onEsquecer?: () => void;
}) {
  const [codigo, setCodigo] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (codigo.trim().length >= 10) onParear(codigo.trim());
  }
  return (
    <section className="rounded-[28px] border border-[#dce8e0] bg-white p-6 sm:p-8">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#e8f4ed] text-[#0f7350]">
        <KeyRound className="h-6 w-6" />
      </span>
      <h1 className="mt-5 text-2xl font-bold tracking-[-.04em]">
        Parear este tablet
      </h1>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        Só um tablet cadastrado pelo administrador pode registrar descartes. No
        computador do síndico, abra Configurações &gt; Estações de pesagem,
        cadastre a estação e digite aqui o código de pareamento (ou abra o link
        de pareamento neste tablet).
      </p>
      {erro && (
        <p
          role="alert"
          className="mt-4 rounded-xl bg-[#fbeceb] px-4 py-3 text-sm text-[#b3382c]"
        >
          {erro}
        </p>
      )}
      <form onSubmit={submit} className="mt-5 flex flex-col gap-3 sm:flex-row">
        <Input
          aria-label="Código de pareamento"
          value={codigo}
          onChange={event => setCodigo(event.target.value)}
          placeholder="Código de pareamento"
          autoComplete="off"
          className="h-12 rounded-xl text-base"
        />
        <Button
          disabled={codigo.trim().length < 10}
          className="h-12 rounded-xl bg-[#0f7350] px-6 text-white hover:bg-[#0a6243]"
        >
          Parear
        </Button>
      </form>
      {onEsquecer && (
        <Button
          variant="ghost"
          onClick={onEsquecer}
          className="mt-3 h-9 rounded-xl text-xs text-muted-foreground"
        >
          Apagar o código salvo neste tablet
        </Button>
      )}
    </section>
  );
}

type TipoEstacao = {
  tipo: WasteType;
  rotulo: string;
  pesoMinimoKg: number;
  pesoMaximoKg: number;
  pontosPorKg: number;
  corSaco: string;
  nomeCorSaco: string;
};
type Item = {
  wasteType: WasteType;
  pesoKg: string;
  foto: string;
  avisoFoto: string | null;
  /** Código do adesivo QR colado no saco. */
  adesivo: string;
  simulacaoIa: SimulacaoIa;
};

function kgParaGramas(valor: string) {
  const kg = Number(valor.replace(",", "."));
  return Number.isFinite(kg) ? Math.round(kg * 1000) : NaN;
}
const kgTexto = (kg: number) =>
  kg.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

function Registro({
  tipos,
  maximoItens,
  demonstracao,
  estacao,
}: {
  tipos: TipoEstacao[];
  maximoItens: number;
  demonstracao: boolean;
  estacao: string;
}) {
  const [etapa, setEtapa] = useState<
    "codigo" | "tipos" | "pesar" | "conferir" | "feito"
  >("codigo");
  const [codigo, setCodigo] = useState("");
  const [morador, setMorador] = useState<Morador | null>(null);
  const [escolhidos, setEscolhidos] = useState<WasteType[]>([]);
  const [itens, setItens] = useState<Item[]>([]);
  const [atual, setAtual] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [lendoQr, setLendoQr] = useState(false);
  const [conferindoFoto, setConferindoFoto] = useState(false);
  const [lendoAdesivo, setLendoAdesivo] = useState(false);
  const porTipo = (tipo: WasteType) => tipos.find(item => item.tipo === tipo)!;

  function recomecar() {
    setEtapa("codigo");
    setCodigo("");
    setMorador(null);
    setEscolhidos([]);
    setItens([]);
    setAtual(0);
    setErro(null);
    setPrevia(null);
    setResultado(null);
    setLendoQr(false);
    setLendoAdesivo(false);
  }

  useEffect(() => {
    if (etapa === "codigo" && !codigo) return;
    const espera = setTimeout(
      recomecar,
      etapa === "feito" ? 20_000 : TEMPO_OCIOSO_MS
    );
    return () => clearTimeout(espera);
  }, [etapa, codigo, itens, escolhidos, atual]);

  const identificar = trpc.estacao.identificar.useMutation({
    onSuccess: dados => {
      setMorador(dados);
      setErro(null);
      setEtapa("tipos");
    },
    onError: issue => setErro(issue.message),
  });
  const conferir = trpc.estacao.previa.useMutation({
    onSuccess: dados => {
      setPrevia(dados);
      setErro(null);
      setEtapa("conferir");
    },
    onError: issue => setErro(issue.message),
  });
  const registrar = trpc.estacao.registrar.useMutation({
    onSuccess: dados => {
      setResultado(dados);
      setErro(null);
      setEtapa("feito");
    },
    onError: issue => setErro(issue.message),
  });

  function enviarCodigo(valor = codigo) {
    if (/^\d{6}$/.test(valor) && !identificar.isPending)
      identificar.mutate({ code: valor });
  }
  // Leitor de QR (USB/Bluetooth) funciona como teclado: digita os 6 números e o registro segue sozinho.
  function aoDigitarCodigo(valor: string) {
    const numeros = valor.replace(/\D/g, "").slice(0, 6);
    setCodigo(numeros);
    if (numeros.length === 6) enviarCodigo(numeros);
  }
  function alternarTipo(tipo: WasteType) {
    setErro(null);
    setEscolhidos(lista =>
      lista.includes(tipo)
        ? lista.filter(item => item !== tipo)
        : lista.length >= maximoItens
          ? lista
          : [...lista, tipo]
    );
  }
  function comecarPesagem() {
    if (!escolhidos.length) {
      setErro("Escolha pelo menos um tipo.");
      return;
    }
    const ordenados = tipos
      .map(item => item.tipo)
      .filter(tipo => escolhidos.includes(tipo));
    setItens(
      ordenados.map(
        (tipo, indice) =>
          itens.find(item => item.wasteType === tipo) ?? {
            wasteType: tipo,
            pesoKg: "",
            foto: "",
            avisoFoto: null,
            // Na demonstração, o tablet já sugere um adesivo do kit do morador (a banca não precisa de adesivo impresso).
            adesivo: demonstracao
              ? (morador?.adesivosDemonstracao[indice] ?? "")
              : "",
            simulacaoIa: "tudo_certo",
          }
      )
    );
    setAtual(0);
    setErro(null);
    setEtapa("pesar");
  }
  function mudarItem(alteracao: Partial<Item>) {
    setItens(lista =>
      lista.map((item, indice) =>
        indice === atual ? { ...item, ...alteracao } : item
      )
    );
  }
  async function aoTirarFoto(event: ChangeEvent<HTMLInputElement>) {
    const arquivo = event.target.files?.[0];
    event.target.value = "";
    if (!arquivo) return;
    setConferindoFoto(true);
    try {
      const foto = await reduzirFoto(arquivo);
      const qualidade = await avaliarFoto(foto);
      mudarItem({ foto, avisoFoto: qualidade.dica });
      setErro(null);
    } catch (issue) {
      setErro(
        issue instanceof Error ? issue.message : "Não foi possível usar a foto."
      );
    } finally {
      setConferindoFoto(false);
    }
  }
  function avancar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const item = itens[atual];
    const regra = porTipo(item.wasteType);
    const gramas = kgParaGramas(item.pesoKg);
    if (!Number.isFinite(gramas) || gramas <= 0) {
      setErro("Informe o peso mostrado na balança.");
      return;
    }
    if (gramas < regra.pesoMinimoKg * 1000) {
      setErro(
        `${regra.rotulo}: o mínimo por descarte é ${kgTexto(regra.pesoMinimoKg)} kg.`
      );
      return;
    }
    if (gramas > regra.pesoMaximoKg * 1000) {
      setErro(
        `${regra.rotulo}: o máximo por descarte é ${kgTexto(regra.pesoMaximoKg)} kg. Procure a administração para volumes maiores.`
      );
      return;
    }
    if (!demonstracao && !item.foto) {
      setErro("Tire a foto do saco na balança, com o visor aparecendo.");
      return;
    }
    const adesivo = normalizarCodigoAdesivo(item.adesivo);
    if (item.adesivo.trim() && !adesivo) {
      setErro(
        "O código do adesivo não é válido. Ele tem o formato EC-XXXX-XXXX."
      );
      return;
    }
    if (morador?.adesivoObrigatorio && !adesivo) {
      setErro(
        "Leia o QR do adesivo colado no saco ou digite o código impresso embaixo dele."
      );
      return;
    }
    if (
      adesivo &&
      itens.some(
        (outro, indice) =>
          indice !== atual && normalizarCodigoAdesivo(outro.adesivo) === adesivo
      )
    ) {
      setErro("Cada saco usa um adesivo diferente.");
      return;
    }
    setErro(null);
    if (atual < itens.length - 1) {
      setAtual(atual + 1);
      return;
    }
    conferir.mutate({
      code: codigo,
      itens: itens.map(registro => ({
        wasteType: registro.wasteType,
        weightGrams: kgParaGramas(registro.pesoKg),
        stickerCode: registro.adesivo || null,
      })),
    });
  }
  function confirmar() {
    if (registrar.isPending) return;
    registrar.mutate({
      code: codigo,
      itens: itens.map(item => ({
        wasteType: item.wasteType,
        weightGrams: kgParaGramas(item.pesoKg),
        imageDataUrl: item.foto || null,
        stickerCode: item.adesivo || null,
        simulacaoIa: demonstracao ? item.simulacaoIa : null,
      })),
    });
  }

  if (etapa === "feito" && resultado) {
    const tudoAprovado = !resultado.pendingApproval;
    return (
      <section className="rounded-[28px] border border-[#cfe1d7] bg-white p-6 text-center sm:p-8">
        <span
          className={`mx-auto grid h-16 w-16 place-items-center rounded-full ${tudoAprovado ? "bg-[#e7f5ec] text-[#0a7048]" : "bg-[#fff3df] text-[#7a4d0a]"}`}
        >
          {tudoAprovado ? (
            <CheckCircle2 className="h-8 w-8" />
          ) : (
            <Clock className="h-8 w-8" />
          )}
        </span>
        <h1 className="mt-5 text-2xl font-bold tracking-[-.04em]">
          {tudoAprovado ? "Descarte aprovado!" : "Descarte registrado!"}
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Agora coloque cada saco na lixeira da mesma cor.{" "}
          {tudoAprovado
            ? "A análise automática conferiu as fotos e os pontos já entraram."
            : "O que a análise automática não conseguiu confirmar fica para a administração conferir; os pontos desses sacos entram depois da aprovação."}
        </p>
        <dl className="mx-auto mt-5 grid max-w-md gap-2 text-left text-sm">
          {resultado.itens.map(item => (
            <div key={item.id} className="grid gap-1">
              <Linha
                rotulo={`${item.material} · nº ${item.id}`}
                valor={`${item.pesoKg} kg · ${item.situacao === "aprovado" ? "aprovado pela IA" : "em conferência"}`}
                cor={porTipo(item.wasteType).corSaco}
                alerta={item.situacao !== "aprovado"}
              />
              {item.adesivo && (
                <p className="px-3 text-xs text-muted-foreground">
                  Adesivo {item.adesivo} usado
                </p>
              )}
              {item.situacao !== "aprovado" && item.ia.motivos.length > 0 && (
                <p className="px-3 text-xs text-[#7a4d0a]">
                  {item.ia.motivos.join(" ")}
                </p>
              )}
            </div>
          ))}
          <Linha
            rotulo="Total"
            valor={`${resultado.weightKg} kg${resultado.simulated ? " (balança simulada)" : ""}`}
            destaque
          />
          {resultado.semPontos && (
            <Linha rotulo="Pontos" valor={resultado.semPontos} alerta />
          )}
          {resultado.pontosAprovados > 0 && (
            <Linha
              rotulo="Valor do descarte aprovado"
              valor={formatarPontos(resultado.pontosAprovados)}
            />
          )}
          {resultado.pontosAprovados > 0 && (
            <Linha
              rotulo="Entrou no saldo agora"
              valor={`+${resultado.pointsAwarded}`}
            />
          )}
          {resultado.pontosAprovados > 0 &&
            resultado.pontosAprovados !== resultado.pointsAwarded && (
              <p className="px-4 text-xs leading-5 text-muted-foreground">
                O saldo recebe só pontos inteiros: a fração fica guardada e se
                soma aos próximos descartes até virar mais um ponto.
              </p>
            )}
          {resultado.pendingPoints > 0 && (
            <Linha
              rotulo="Pontos previstos (após conferência)"
              valor={formatarPontos(resultado.pendingPoints)}
            />
          )}
          <Linha
            rotulo="Análise"
            valor={
              resultado.modoIa === "claude"
                ? "IA (Claude) com visão"
                : resultado.simulated
                  ? "IA em modo demonstração (simulada)"
                  : "Conferência pela administração (análise automática indisponível)"
            }
          />
        </dl>
        <Button
          onClick={recomecar}
          className="mt-6 h-12 rounded-xl bg-[#0f7350] px-8 text-base text-white hover:bg-[#0a6243]"
        >
          Novo descarte
        </Button>
      </section>
    );
  }

  if (etapa === "conferir" && previa) {
    return (
      <section className="rounded-[28px] border border-[#dce8e0] bg-white p-6 sm:p-8">
        <Passos atual={3} />
        <h1 className="mt-4 text-2xl font-bold tracking-[-.04em]">
          Confira antes de confirmar
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Nada foi gravado ainda. Se algo estiver errado, volte e corrija.
        </p>
        <dl className="mt-5 grid gap-2 text-sm">
          <Linha rotulo="Estação" valor={estacao || previa.estacao} />
          <Linha
            rotulo="Morador"
            valor={`${previa.morador} · Bloco ${previa.bloco}`}
          />
          {previa.itens.map((item, indice) => (
            <div
              key={item.wasteType}
              className="grid gap-2 rounded-xl bg-[#f6faf7] p-3 sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <div className="flex items-center gap-3">
                {itens[indice]?.foto ? (
                  <img
                    src={itens[indice].foto}
                    alt=""
                    className="h-12 w-12 rounded-lg object-cover"
                  />
                ) : (
                  <span
                    className="h-12 w-12 rounded-lg"
                    style={{ background: porTipo(item.wasteType).corSaco }}
                  />
                )}
                <div>
                  <p className="font-semibold">{item.material}</p>
                  <p className="text-xs text-muted-foreground">
                    Saco {porTipo(item.wasteType).nomeCorSaco.toLowerCase()}
                    {item.adesivo ? ` · adesivo ${item.adesivo}` : ""}
                    {item.alertas.length
                      ? ` · Atenção: ${item.alertas.join("; ")}`
                      : ""}
                  </p>
                </div>
              </div>
              <p className="text-right">
                <span className="text-xl font-bold text-[#0f7350]">
                  {item.pesoKg} kg
                </span>
                <span className="block text-xs text-muted-foreground">
                  {formatarPontos(item.pontosPrevistos)}{" "}
                  {palavra(
                    item.pontosPrevistos,
                    "ponto previsto",
                    "pontos previstos"
                  )}
                </span>
              </p>
            </div>
          ))}
          <Linha
            rotulo="Total"
            valor={`${previa.pesoTotalKg} ${previa.unidade}${previa.pesagemSimulada ? " · balança simulada" : ""}`}
            destaque
          />
          <Linha
            rotulo="Resultado"
            valor={
              previa.bloqueio
                ? `Bloqueado: ${previa.bloqueio}`
                : `A IA confere cada foto: o que estiver certo é aprovado na hora (${formatarPontos(previa.pontosPrevistos)} ${palavra(previa.pontosPrevistos, "ponto previsto", "pontos previstos")}); o resto vai para a administração`
            }
            alerta={Boolean(previa.bloqueio)}
          />
          {previa.semPontos && !previa.bloqueio && (
            <Linha rotulo="Pontos" valor={previa.semPontos} alerta />
          )}
        </dl>
        {erro && (
          <p
            role="alert"
            className="mt-4 rounded-xl bg-[#fbeceb] px-4 py-3 text-sm text-[#b3382c]"
          >
            {erro}
          </p>
        )}
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setErro(null);
              setAtual(0);
              setEtapa("pesar");
            }}
            className="h-12 rounded-xl text-base"
          >
            Voltar e corrigir
          </Button>
          <Button
            type="button"
            disabled={Boolean(previa.bloqueio) || registrar.isPending}
            onClick={confirmar}
            className="h-12 rounded-xl bg-[#0f7350] text-base text-white hover:bg-[#0a6243]"
          >
            {registrar.isPending ? "Registrando..." : "Confirmar descarte"}
          </Button>
        </div>
      </section>
    );
  }

  if (etapa === "tipos") {
    return (
      <section className="rounded-[28px] border border-[#dce8e0] bg-white p-6 sm:p-8">
        <Passos atual={1} />
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">Descarte de</p>
            <p className="text-xl font-bold tracking-[-.03em]">
              {morador?.firstName} · Bloco {morador?.block} ·{" "}
              {morador?.apartment}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={recomecar}
            className="h-10 rounded-xl text-sm"
          >
            Não sou eu
          </Button>
        </div>
        <h1 className="mt-5 text-2xl font-bold tracking-[-.04em]">
          O que você trouxe hoje?
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Toque em todos os tipos (até {maximoItens}). Cada tipo vai no saco da
          sua cor e é pesado separado.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {tipos.map(tipo => {
            const marcado = escolhidos.includes(tipo.tipo);
            return (
              <button
                key={tipo.tipo}
                type="button"
                onClick={() => alternarTipo(tipo.tipo)}
                aria-pressed={marcado}
                className={`flex items-center gap-4 rounded-2xl border-2 p-4 text-left transition-colors ${marcado ? "border-[#0f7350] bg-[#edf7f1]" : "border-[#dce8e0] bg-white hover:border-[#b9d8c5]"}`}
              >
                <span
                  className="grid h-14 w-12 shrink-0 place-items-end rounded-b-xl rounded-t-md border border-black/10 pb-1 text-[10px] font-bold text-white"
                  style={{ background: tipo.corSaco }}
                >
                  <ShoppingBag className="mx-auto h-5 w-5 opacity-80" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-bold">{tipo.rotulo}</span>
                  <span className="block text-xs text-muted-foreground">
                    Saco {tipo.nomeCorSaco.toLowerCase()} ·{" "}
                    {kgTexto(tipo.pesoMinimoKg)} a {kgTexto(tipo.pesoMaximoKg)}{" "}
                    kg ·{" "}
                    {tipo.pontosPorKg
                      ? `${kgTexto(tipo.pontosPorKg)} ${pontuaPorEntrega(tipo.tipo) ? "pt por entrega" : "pt/kg"}`
                      : "sem pontos"}
                  </span>
                </span>
                <span
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 ${marcado ? "border-[#0f7350] bg-[#0f7350] text-white" : "border-[#cfdcd4]"}`}
                >
                  {marcado && <Check className="h-4 w-4" />}
                </span>
              </button>
            );
          })}
        </div>
        {erro && (
          <p
            role="alert"
            className="mt-4 rounded-xl bg-[#fbeceb] px-4 py-3 text-sm text-[#b3382c]"
          >
            {erro}
          </p>
        )}
        <Button
          type="button"
          onClick={comecarPesagem}
          disabled={!escolhidos.length}
          className="mt-5 h-12 w-full rounded-xl bg-[#0f7350] text-base text-white hover:bg-[#0a6243]"
        >
          {escolhidos.length
            ? `Pesar ${plural(escolhidos.length, "tipo", "tipos")}`
            : "Escolha pelo menos um tipo"}
        </Button>
      </section>
    );
  }

  if (etapa === "pesar" && itens[atual]) {
    const item = itens[atual];
    const regra = porTipo(item.wasteType);
    return (
      <section className="rounded-[28px] border border-[#dce8e0] bg-white p-6 sm:p-8">
        <Passos atual={2} />
        <form onSubmit={avancar} className="mt-4 grid gap-4">
          <div
            className="flex items-center gap-4 rounded-2xl p-4 text-white"
            style={{ background: regra.corSaco }}
          >
            <ShoppingBag className="h-9 w-9 shrink-0 opacity-90" />
            <div>
              <p className="text-xs font-bold uppercase tracking-[.1em] opacity-90">
                Tipo {atual + 1} de {itens.length}
              </p>
              <p className="text-2xl font-bold tracking-[-.03em]">
                {regra.rotulo} · saco {regra.nomeCorSaco.toLowerCase()}
              </p>
            </div>
          </div>
          <ol className="grid gap-1.5 rounded-2xl bg-[#f6faf7] p-4 text-sm leading-6">
            <li>
              <b>1.</b> Tire os outros sacos da balança e coloque{" "}
              <b>só o saco {regra.nomeCorSaco.toLowerCase()}</b>.
            </li>
            <li>
              <b>2.</b> Espere o número parar e informe o peso abaixo (
              {kgTexto(regra.pesoMinimoKg)} a {kgTexto(regra.pesoMaximoKg)} kg).
            </li>
            <li>
              <b>3.</b> Fotografe o saco em cima da balança, com o visor
              aparecendo: a IA confere o tipo, a cor do saco e o peso.
            </li>
          </ol>
          {demonstracao ? (
            <div className="rounded-2xl border-2 border-dashed border-[#d98c1f] bg-[#fffaf1] p-4">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.08em] text-[#7a4d0a]">
                <FlaskConical className="h-4 w-4" />
                Balança simulada
              </p>
              <p
                aria-live="polite"
                className="mt-2 rounded-xl bg-[#1d2a24] px-4 py-3 text-right font-mono text-4xl font-bold text-[#8ff0b5]"
              >
                {item.pesoKg
                  ? Number(item.pesoKg.replace(",", ".") || 0).toLocaleString(
                      "pt-BR",
                      { minimumFractionDigits: 2, maximumFractionDigits: 2 }
                    )
                  : "0,00"}{" "}
                kg
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {PESOS_DEMONSTRACAO.map(valor => (
                  <Button
                    key={valor}
                    type="button"
                    variant="outline"
                    onClick={() => mudarItem({ pesoKg: valor })}
                    className="h-10 rounded-xl bg-white"
                  >
                    {valor} kg
                  </Button>
                ))}
              </div>
              <label className="mt-3 grid gap-1.5 text-sm font-semibold">
                Ou digite o peso (kg)
                <Input
                  required
                  inputMode="decimal"
                  value={item.pesoKg}
                  onChange={event =>
                    mudarItem({
                      pesoKg: event.target.value.replace(/[^\d.,]/g, ""),
                    })
                  }
                  placeholder="Ex.: 2,50"
                  className="h-12 rounded-xl bg-white text-xl font-bold"
                />
              </label>
            </div>
          ) : (
            <label className="grid gap-1.5 text-sm font-semibold">
              Peso mostrado na balança (kg)
              <Input
                required
                autoFocus
                inputMode="decimal"
                value={item.pesoKg}
                onChange={event =>
                  mudarItem({
                    pesoKg: event.target.value.replace(/[^\d.,]/g, ""),
                  })
                }
                placeholder="Ex.: 3,4"
                className="h-14 rounded-xl text-2xl font-bold"
              />
            </label>
          )}
          <div className="grid gap-2 rounded-2xl border border-[#dce8e0] p-4">
            <label className="grid gap-1.5 text-sm font-semibold">
              <span className="flex items-center gap-2">
                <QrCode className="h-4 w-4 text-[#0f7350]" />
                Adesivo QR do saco
                {morador?.adesivoObrigatorio ? " (obrigatório)" : " (opcional)"}
              </span>
              <Input
                value={item.adesivo}
                onChange={event =>
                  mudarItem({ adesivo: event.target.value.toUpperCase() })
                }
                placeholder="EC-XXXX-XXXX"
                autoCapitalize="characters"
                className="h-12 rounded-xl font-mono text-lg tracking-[.08em]"
              />
            </label>
            <p className="text-xs text-muted-foreground">
              Cole um adesivo do seu kit no saco e leia o QR (ou digite o código
              impresso embaixo dele). Cada adesivo vale para um saco só.
              {morador
                ? ` Você ainda tem ${plural(Math.max(0, morador.adesivosDisponiveis - itens.slice(0, atual).filter(anterior => anterior.adesivo.trim()).length), "adesivo disponível", "adesivos disponíveis")}.`
                : ""}
            </p>
            {cameraDisponivel() &&
              (lendoAdesivo ? (
                <LeitorQr
                  extrair={normalizarCodigoAdesivo}
                  onLer={valor => {
                    setLendoAdesivo(false);
                    mudarItem({ adesivo: valor });
                  }}
                  onCancelar={() => setLendoAdesivo(false)}
                />
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setLendoAdesivo(true)}
                  className="h-10 rounded-xl"
                >
                  <QrCode className="mr-2 h-4 w-4" />
                  Ler o QR do adesivo
                </Button>
              ))}
          </div>
          {demonstracao && (
            <label className="grid gap-1.5 rounded-2xl border-2 border-dashed border-[#d98c1f] bg-[#fffaf1] p-4 text-sm font-semibold text-[#7a4d0a]">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.08em]">
                <FlaskConical className="h-4 w-4" />O que a IA vai ver
                (demonstração)
              </span>
              <select
                value={item.simulacaoIa}
                onChange={event =>
                  mudarItem({ simulacaoIa: event.target.value as SimulacaoIa })
                }
                className="h-11 rounded-xl border border-[#e8d2ad] bg-white px-3 text-sm font-medium text-foreground"
              >
                {(Object.keys(rotuloSimulacaoIa) as SimulacaoIa[]).map(
                  opcao => (
                    <option key={opcao} value={opcao}>
                      {rotuloSimulacaoIa[opcao]}
                    </option>
                  )
                )}
              </select>
              <span className="text-xs font-normal">
                Sem chave da API, a análise é simulada. Escolha uma situação
                para mostrar o descarte indo para a conferência da
                administração.
              </span>
            </label>
          )}
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#b9d8c5] bg-[#f6faf7] px-4 py-5 text-base font-semibold text-[#0f7350]">
            <Camera className="h-5 w-5" />
            {conferindoFoto
              ? "Conferindo a foto..."
              : item.foto
                ? "Tirar outra foto"
                : demonstracao
                  ? "Fotografar o visor (opcional na demonstração)"
                  : "Fotografar o visor da balança (obrigatório)"}
            <input
              className="sr-only"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={aoTirarFoto}
            />
          </label>
          {item.foto && (
            <div className="grid gap-2">
              <img
                src={item.foto}
                alt="Foto do visor da balança"
                className="max-h-56 w-full rounded-2xl border border-[#e2ebe5] object-contain"
              />
              {item.avisoFoto ? (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-xl bg-[#fff3df] px-4 py-3 text-sm text-[#7a4d0a]"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {item.avisoFoto} Foto ruim pode fazer o descarte ser
                  reprovado.
                </p>
              ) : (
                <p className="flex items-center gap-2 text-sm text-[#0a7048]">
                  <CheckCircle2 className="h-4 w-4" />
                  Foto nítida. Confira se o número do visor aparece inteiro.
                </p>
              )}
            </div>
          )}
          {erro && (
            <p
              role="alert"
              className="rounded-xl bg-[#fbeceb] px-4 py-3 text-sm text-[#b3382c]"
            >
              {erro}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setErro(null);
                if (atual === 0) setEtapa("tipos");
                else setAtual(atual - 1);
              }}
              className="h-12 rounded-xl text-base"
            >
              Voltar
            </Button>
            <Button
              disabled={conferir.isPending || conferindoFoto}
              className="h-12 rounded-xl bg-[#0f7350] text-base text-white hover:bg-[#0a6243]"
            >
              {conferir.isPending
                ? "Conferindo..."
                : atual < itens.length - 1
                  ? `Próximo: ${porTipo(itens[atual + 1].wasteType).rotulo}`
                  : "Conferir descarte"}
            </Button>
          </div>
        </form>
      </section>
    );
  }

  return (
    <section className="rounded-[28px] border border-[#dce8e0] bg-white p-6 sm:p-8">
      <form
        onSubmit={event => {
          event.preventDefault();
          enviarCodigo();
        }}
      >
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#e8f4ed] text-[#0f7350]">
          <ShieldCheck className="h-6 w-6" />
        </span>
        <h1 className="mt-5 text-2xl font-bold tracking-[-.04em]">
          Digite ou leia o código do seu aplicativo
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          No aplicativo EcoCondo, abra Descartes e toque em{" "}
          <b>Gerar código para a estação</b>. Digite os 6 números ou aproxime o
          QR do leitor. O código vale por 5 minutos e só pode ser usado uma vez.
          Tenha em mãos um adesivo QR para cada saco.
        </p>
        <Input
          autoFocus
          aria-label="Código de 6 números"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={codigo}
          onChange={event => aoDigitarCodigo(event.target.value)}
          placeholder="000000"
          className="mt-5 h-16 rounded-2xl text-center text-3xl font-bold tracking-[.4em]"
        />
        {erro && (
          <p
            role="alert"
            className="mt-3 rounded-xl bg-[#fbeceb] px-4 py-3 text-sm text-[#b3382c]"
          >
            {erro}
          </p>
        )}
        <Button
          disabled={codigo.length !== 6 || identificar.isPending}
          className="mt-4 h-12 w-full rounded-xl bg-[#0f7350] text-base text-white hover:bg-[#0a6243]"
        >
          {identificar.isPending ? "Conferindo..." : "Continuar"}
        </Button>
        {cameraDisponivel() &&
          (lendoQr ? (
            <LeitorQr
              onLer={valor => {
                setLendoQr(false);
                aoDigitarCodigo(valor);
              }}
              onCancelar={() => setLendoQr(false)}
            />
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => setLendoQr(true)}
              className="mt-3 h-12 w-full rounded-xl text-base"
            >
              <QrCode className="mr-2 h-5 w-5" />
              Ler o QR com a câmera
            </Button>
          ))}
      </form>
    </section>
  );
}

/** Onde a pessoa está: 1 escolher os tipos, 2 pesar e fotografar, 3 conferir. */
function Passos({ atual }: { atual: 1 | 2 | 3 }) {
  const passos = ["Tipos", "Pesar e fotografar", "Conferir"];
  return (
    <ol
      className="flex gap-2 text-xs font-semibold"
      aria-label="Etapas do descarte"
    >
      {passos.map((passo, indice) => (
        <li
          key={passo}
          aria-current={indice + 1 === atual ? "step" : undefined}
          className={`flex flex-1 items-center gap-2 rounded-full px-3 py-1.5 ${indice + 1 === atual ? "bg-[#0f7350] text-white" : indice + 1 < atual ? "bg-[#e7f5ec] text-[#0a7048]" : "bg-[#f0f4f2] text-muted-foreground"}`}
        >
          <span>{indice + 1}</span>
          <span className="truncate">{passo}</span>
        </li>
      ))}
    </ol>
  );
}

function Linha({
  rotulo,
  valor,
  destaque,
  alerta,
  cor,
}: {
  rotulo: string;
  valor: string;
  destaque?: boolean;
  alerta?: boolean;
  cor?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-baseline justify-between gap-2 rounded-xl px-4 py-2.5 ${alerta ? "bg-[#fbeceb] text-[#b3382c]" : "bg-[#f6faf7]"}`}
    >
      <dt className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.08em] text-muted-foreground">
        {cor && (
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: cor }}
          />
        )}
        {rotulo}
      </dt>
      <dd
        className={`text-right ${destaque ? "text-2xl font-bold text-[#0f7350]" : "font-semibold"}`}
      >
        {alerta && <AlertTriangle className="mr-1 inline h-4 w-4" />}
        {valor}
      </dd>
    </div>
  );
}

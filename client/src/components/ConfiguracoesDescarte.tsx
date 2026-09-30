import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { rotuloResiduo, type TipoResiduo } from "@/lib/descarte";
import { trpc } from "@/lib/trpc";
import { formatarNumero } from "@/lib/utils";
import {
  rotuloTipoNotificacao,
  type TipoNotificacao,
} from "@shared/notificacoes";
import type { EcoRole } from "@shared/permissions";
import { BellRing, Coins, RotateCcw, Scale } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";

const cartao =
  "rounded-[24px] border border-[#dce8e0] bg-white p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.35)] sm:p-6";

function Cabecalho({
  icone: Icone,
  titulo,
  texto,
}: {
  icone: typeof Scale;
  titulo: string;
  texto: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#e8f4ed] text-[#0f7350]">
        <Icone className="h-5 w-5" />
      </span>
      <div>
        <p className="font-semibold">{titulo}</p>
        <p className="text-sm text-muted-foreground">{texto}</p>
      </div>
    </div>
  );
}

const kg = (gramas: number) => String(gramas / 1000).replace(".", ",");
const numero = (texto: string) => Number(texto.replace(",", "."));

/** Peso mínimo e máximo por descarte, pontos por kg e cor do saco de cada tipo (itens 5, 8 e 20 do PDF). */
export function RegrasDescarte() {
  const utils = trpc.useUtils();
  const regras = trpc.regrasDescarte.listar.useQuery();
  const guias = trpc.guias.listar.useQuery();
  return (
    <section className={cartao}>
      <Cabecalho
        icone={Scale}
        titulo="Regras de cada tipo de descarte"
        texto="Peso mínimo e máximo aceitos em um descarte, pontos por kg aprovado e a cor do saco. Vale para a estação e para o guia."
      />
      {regras.isLoading || guias.isLoading ? (
        <p className="mt-5 text-sm text-muted-foreground">
          Carregando regras...
        </p>
      ) : (
        <div className="mt-5 grid gap-3">
          {(regras.data ?? []).map(regra => (
            <LinhaRegra
              key={regra.tipoResiduo}
              regra={regra}
              guia={guias.data?.find(
                guia => guia.tipoResiduo === regra.tipoResiduo
              )}
              onSalvo={() => {
                utils.regrasDescarte.listar.invalidate();
                utils.guias.listar.invalidate();
                utils.estacao.invalidate();
              }}
            />
          ))}
        </div>
      )}
      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        Os pontos são calculados assim: kg aprovados × pontos por kg, com fração
        (1,9 kg de orgânico a 0,5 ponto/kg vale 0,95). As frações de cada
        morador se somam e viram ponto inteiro no saldo. Mudar a regra não
        altera os descartes já registrados: vale o que o tablet mostrou ao
        morador. Coloque 0 para um tipo que não dá pontos (ele continua contando
        nos indicadores).
      </p>
    </section>
  );
}

type Regra = {
  tipoResiduo: TipoResiduo;
  pesoMinimoGramas: number;
  pesoMaximoGramas: number;
  pontosPorKg: number;
  personalizada: boolean;
};
type Guia = {
  tipoResiduo: TipoResiduo;
  titulo: string;
  itensAceitos: string;
  itensRejeitados: string;
  instrucoes: string;
  corSaco: string;
  nomeCorSaco: string;
};

function LinhaRegra({
  regra,
  guia,
  onSalvo,
}: {
  regra: Regra;
  guia?: Guia;
  onSalvo: () => void;
}) {
  const [form, setForm] = useState({
    min: kg(regra.pesoMinimoGramas),
    max: kg(regra.pesoMaximoGramas),
    pontos: String(regra.pontosPorKg).replace(".", ","),
    cor: guia?.corSaco ?? "#888888",
    nomeCor: guia?.nomeCorSaco ?? "",
  });
  useEffect(
    () =>
      setForm({
        min: kg(regra.pesoMinimoGramas),
        max: kg(regra.pesoMaximoGramas),
        pontos: String(regra.pontosPorKg).replace(".", ","),
        cor: guia?.corSaco ?? "#888888",
        nomeCor: guia?.nomeCorSaco ?? "",
      }),
    [regra, guia]
  );
  const salvarRegra = trpc.regrasDescarte.salvar.useMutation();
  const salvarGuia = trpc.guias.salvar.useMutation();
  const restaurar = trpc.regrasDescarte.restaurarPadrao.useMutation({
    onSuccess: () => {
      toast.success(
        `Regra de ${rotuloResiduo[regra.tipoResiduo]} voltou ao padrão.`
      );
      onSalvo();
    },
    onError: issue => toast.error(issue.message),
  });
  async function salvar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await salvarRegra.mutateAsync({
        wasteType: regra.tipoResiduo,
        minGrams: Math.round(numero(form.min) * 1000),
        maxGrams: Math.round(numero(form.max) * 1000),
        pointsPerKg: numero(form.pontos),
      });
      if (
        guia &&
        (form.cor.toLowerCase() !== guia.corSaco.toLowerCase() ||
          form.nomeCor !== guia.nomeCorSaco)
      ) {
        await salvarGuia.mutateAsync({
          wasteType: regra.tipoResiduo,
          title: guia.titulo,
          accepted: guia.itensAceitos,
          rejected: guia.itensRejeitados,
          instructions: guia.instrucoes,
          bagColor: form.cor,
          bagColorName: form.nomeCor,
        });
      }
      toast.success(`${rotuloResiduo[regra.tipoResiduo]}: regra salva.`);
      onSalvo();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível salvar."
      );
    }
  }
  const salvando = salvarRegra.isPending || salvarGuia.isPending;
  return (
    <form
      onSubmit={salvar}
      className="grid gap-3 rounded-2xl border border-[#e2ebe5] bg-[#fbfdfc] p-4 lg:grid-cols-[150px_repeat(3,minmax(0,1fr))_minmax(0,1.3fr)_auto] lg:items-end"
    >
      <div className="flex items-center gap-2 lg:self-center">
        <span
          className="h-4 w-4 shrink-0 rounded-full border border-black/10"
          style={{ background: form.cor }}
        />
        <span className="text-sm font-semibold">
          {rotuloResiduo[regra.tipoResiduo]}
        </span>
        {regra.personalizada && (
          <Badge className="border-0 bg-[#e8f4ed] text-[10px] text-[#0f7350] hover:bg-[#e8f4ed]">
            Ajustada
          </Badge>
        )}
      </div>
      <label className="grid gap-1 text-[11px] font-semibold">
        Mínimo (kg)
        <Input
          required
          inputMode="decimal"
          value={form.min}
          onChange={event => setForm({ ...form, min: event.target.value })}
          className="h-9 rounded-lg bg-white"
        />
      </label>
      <label className="grid gap-1 text-[11px] font-semibold">
        Máximo (kg)
        <Input
          required
          inputMode="decimal"
          value={form.max}
          onChange={event => setForm({ ...form, max: event.target.value })}
          className="h-9 rounded-lg bg-white"
        />
      </label>
      <label className="grid gap-1 text-[11px] font-semibold">
        Pontos por kg
        <Input
          required
          inputMode="decimal"
          value={form.pontos}
          onChange={event => setForm({ ...form, pontos: event.target.value })}
          className="h-9 rounded-lg bg-white"
        />
      </label>
      <div className="grid gap-1 text-[11px] font-semibold">
        Saco
        <div className="flex gap-2">
          <input
            type="color"
            aria-label={`Cor do saco de ${rotuloResiduo[regra.tipoResiduo]}`}
            value={form.cor}
            onChange={event => setForm({ ...form, cor: event.target.value })}
            className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-[#dce8e0] bg-white p-1"
          />
          <Input
            required
            aria-label="Nome da cor"
            placeholder="Azul"
            value={form.nomeCor}
            onChange={event =>
              setForm({ ...form, nomeCor: event.target.value })
            }
            className="h-9 rounded-lg bg-white"
          />
        </div>
      </div>
      <div className="flex gap-1.5">
        <Button
          disabled={salvando}
          className="h-9 rounded-lg bg-[#0f7350] px-3 text-xs text-white hover:bg-[#0a6243]"
        >
          {salvando ? "Salvando..." : "Salvar"}
        </Button>
        {regra.personalizada && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={restaurar.isPending}
            onClick={() => restaurar.mutate({ wasteType: regra.tipoResiduo })}
            className="h-9 w-9 rounded-lg"
            aria-label="Voltar ao padrão"
            title="Voltar peso e pontos ao padrão"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        )}
      </div>
    </form>
  );
}

/** Quais avisos cada perfil recebe (item 2 do PDF). Os que mexem com pontos ou são graves ficam sempre ligados. */
export function PreferenciasAvisos() {
  const utils = trpc.useUtils();
  const lista = trpc.preferenciasNotificacao.listar.useQuery();
  const salvar = trpc.preferenciasNotificacao.salvar.useMutation({
    onSuccess: () => utils.preferenciasNotificacao.listar.invalidate(),
    onError: issue => toast.error(issue.message),
  });
  const perfis: { papel: EcoRole; titulo: string }[] = [
    { papel: "morador", titulo: "Moradores recebem" },
    { papel: "administrador", titulo: "Administradores recebem" },
  ];
  return (
    <section className={cartao}>
      <Cabecalho
        icone={BellRing}
        titulo="Quem recebe cada aviso"
        texto="Ligue ou desligue os avisos de cada perfil. Os marcados como obrigatórios mexem com pontos ou são casos graves."
      />
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {perfis.map(({ papel, titulo }) => (
          <div key={papel}>
            <p className="text-xs font-bold uppercase tracking-[.12em] text-muted-foreground">
              {titulo}
            </p>
            <ul className="mt-2 divide-y divide-[#edf2ef] rounded-2xl border border-[#e2ebe5]">
              {(lista.data ?? [])
                .filter(linha => linha.papel === papel)
                .map(linha => (
                  <li
                    key={linha.tipo}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
                  >
                    <span>
                      {rotuloTipoNotificacao[linha.tipo as TipoNotificacao]}
                      {linha.obrigatoria && (
                        <span className="ml-2 text-[11px] text-muted-foreground">
                          obrigatório
                        </span>
                      )}
                    </span>
                    <Switch
                      checked={linha.ativo}
                      disabled={linha.obrigatoria || salvar.isPending}
                      onCheckedChange={ativo =>
                        salvar.mutate({
                          role: papel,
                          type: linha.tipo as TipoNotificacao,
                          active: ativo,
                        })
                      }
                      aria-label={`${rotuloTipoNotificacao[linha.tipo as TipoNotificacao]} para ${papel === "morador" ? "moradores" : "administradores"}`}
                    />
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Zerar os pontos de todos para começar um novo ciclo (item 9 do PDF). */
export function ZerarPontos() {
  const utils = trpc.useUtils();
  const ciclo = trpc.pontos.ciclo.useQuery();
  const [aberto, setAberto] = useState(false);
  const [confirmacao, setConfirmacao] = useState("");
  const [motivo, setMotivo] = useState("");
  const zerar = trpc.pontos.zerarTodos.useMutation({
    onSuccess: resultado => {
      toast.success(
        `Pontos zerados: ${formatarNumero(resultado.pontos)} ponto(s) de ${resultado.moradores} morador(es). Novo ciclo começou.`
      );
      setAberto(false);
      setConfirmacao("");
      setMotivo("");
      utils.invalidate();
    },
    onError: issue => toast.error(issue.message),
  });
  return (
    <section className={cartao}>
      <Cabecalho
        icone={Coins}
        titulo="Ciclo de pontos"
        texto="A administração controla os pontos: ajuste o saldo de um morador em Moradores > Pontos, ou zere os pontos de todos para começar um novo ciclo."
      />
      <p className="mt-4 text-sm text-muted-foreground">
        {ciclo.data?.zeradoEm
          ? `Ciclo atual desde ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeStyle: "short" }).format(new Date(ciclo.data.zeradoEm))}.`
          : "Os pontos nunca foram zerados neste condomínio."}{" "}
        O pódio e o ranking contam a partir do início do ciclo.
      </p>
      {!aberto ? (
        <Button
          variant="outline"
          onClick={() => setAberto(true)}
          className="mt-4 h-10 rounded-xl border-[#f0c9c4] text-[#b3382c] hover:bg-[#fbeceb] hover:text-[#b3382c]"
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          Zerar pontos de todos
        </Button>
      ) : (
        <form
          onSubmit={event => {
            event.preventDefault();
            zerar.mutate({ confirmation: "ZERAR", reason: motivo });
          }}
          className="mt-4 grid gap-3 rounded-2xl border border-[#f0c9c4] bg-[#fdf6f5] p-4"
        >
          <p className="text-sm text-[#8c2c22]">
            Todos os saldos voltam a 0. Cada morador vê a linha "Pontos zerados
            (novo ciclo)" no extrato e recebe um aviso. Não dá para desfazer.
          </p>
          <label className="grid gap-1.5 text-xs font-semibold">
            Motivo (fica no extrato e na auditoria)
            <Input
              required
              minLength={10}
              value={motivo}
              onChange={event => setMotivo(event.target.value)}
              placeholder="Ex.: fim do ciclo de 2026, cestas de Natal entregues"
              className="h-10 rounded-xl bg-white"
            />
          </label>
          <label className="grid gap-1.5 text-xs font-semibold">
            Para confirmar, digite ZERAR
            <Input
              required
              value={confirmacao}
              onChange={event =>
                setConfirmacao(event.target.value.toUpperCase())
              }
              className="h-10 rounded-xl bg-white"
            />
          </label>
          <div className="flex gap-2">
            <Button
              disabled={
                confirmacao !== "ZERAR" ||
                motivo.trim().length < 10 ||
                zerar.isPending
              }
              className="h-10 rounded-xl bg-[#b3382c] text-white hover:bg-[#962e24]"
            >
              {zerar.isPending ? "Zerando..." : "Zerar agora"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setAberto(false)}
              className="h-10 rounded-xl"
            >
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

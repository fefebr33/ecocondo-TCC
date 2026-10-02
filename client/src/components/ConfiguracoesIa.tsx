import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { rotuloTipoPenalidade } from "@shared/rotulos";
import { Bot, Gavel } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";

const cartao =
  "rounded-[24px] border border-[#dce8e0] bg-white p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.35)] sm:p-6";

type TipoPenalidade = keyof typeof rotuloTipoPenalidade;

/** Aprovação automática pela IA, confiança mínima e adesivo QR obrigatório. */
export function ConfiguracaoAnaliseIa() {
  const utils = trpc.useUtils();
  const config = trpc.configuracoesIa.obter.useQuery();
  const [form, setForm] = useState({
    iaAprovacaoAutomatica: true,
    iaConfiancaMinima: 80,
    adesivoObrigatorio: true,
  });
  useEffect(() => {
    if (config.data)
      setForm({
        iaAprovacaoAutomatica: config.data.iaAprovacaoAutomatica,
        iaConfiancaMinima: config.data.iaConfiancaMinima,
        adesivoObrigatorio: config.data.adesivoObrigatorio,
      });
  }, [config.data]);
  const salvar = trpc.configuracoesIa.salvar.useMutation({
    onSuccess: () => {
      void utils.configuracoesIa.obter.invalidate();
      toast.success("Configuração da análise automática salva.");
    },
    onError: erro => toast.error(erro.message),
  });
  return (
    <section className={cartao}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e8f4ed] text-[#0f7350]">
            <Bot className="h-5 w-5" />
          </span>
          <div>
            <p className="font-semibold">Análise automática (IA)</p>
            <p className="text-sm text-muted-foreground">
              A IA confere a foto de cada saco: tipo de resíduo, peso no visor e
              cor do saco.
            </p>
          </div>
        </div>
        <Badge
          className={
            config.data?.modoIa === "claude"
              ? "border-0 bg-[#e7f5ec] text-[#0a7048]"
              : "border-0 bg-[#fff3df] text-[#7a4d0a]"
          }
        >
          {config.data?.modoIa === "claude"
            ? `Claude ativo (${config.data.modelo})`
            : "Modo demonstração (sem chave da API)"}
        </Badge>
      </div>
      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          salvar.mutate(form);
        }}
        className="mt-5 grid gap-4"
      >
        <label className="flex items-start justify-between gap-4 rounded-2xl border border-[#e6eee9] p-4 text-sm">
          <span>
            <b>Aprovar sozinho o que estiver de acordo com as regras</b>
            <span className="block text-muted-foreground">
              Os demais (divergência, dúvida, confiança baixa, alerta
              antifraude ou falha da análise) ficam pendentes para um
              administrador.
            </span>
          </span>
          <Switch
            checked={form.iaAprovacaoAutomatica}
            onCheckedChange={valor =>
              setForm(atual => ({ ...atual, iaAprovacaoAutomatica: valor }))
            }
          />
        </label>
        <label className="grid gap-1.5 rounded-2xl border border-[#e6eee9] p-4 text-sm">
          <b>Confiança mínima para aprovar sem revisão: {form.iaConfiancaMinima}%</b>
          <input
            type="range"
            min={50}
            max={100}
            step={5}
            value={form.iaConfiancaMinima}
            onChange={event =>
              setForm(atual => ({
                ...atual,
                iaConfiancaMinima: Number(event.target.value),
              }))
            }
          />
        </label>
        <label className="flex items-start justify-between gap-4 rounded-2xl border border-[#e6eee9] p-4 text-sm">
          <span>
            <b>Exigir o adesivo QR em cada saco</b>
            <span className="block text-muted-foreground">
              Sem adesivo do próprio morador, a estação não registra. Cada
              adesivo vale para um saco só.
            </span>
          </span>
          <Switch
            checked={form.adesivoObrigatorio}
            onCheckedChange={valor =>
              setForm(atual => ({ ...atual, adesivoObrigatorio: valor }))
            }
          />
        </label>
        <p className="text-xs text-muted-foreground">
          Para usar o Claude de verdade, configure a variável ANTHROPIC_API_KEY
          no servidor. Sem ela, a análise roda em modo de demonstração.
        </p>
        <Button
          disabled={salvar.isPending}
          className="h-10 w-fit rounded-xl bg-[#0f7350] text-white hover:bg-[#0a6243]"
        >
          {salvar.isPending ? "Salvando..." : "Salvar"}
        </Button>
      </form>
    </section>
  );
}

const vazio = {
  id: undefined as number | undefined,
  nome: "",
  tipo: "advertencia" as TipoPenalidade,
  pontos: "",
  duracaoValor: "",
  duracaoUnidade: "dias" as "dias" | "meses",
  descricao: "",
  ativo: true,
};

/** Medidas pré-definidas que o administrador escolhe na auditoria e nas ocorrências. */
export function MedidasAdministrativas() {
  const utils = trpc.useUtils();
  const modelos = trpc.penalidades.modelos.useQuery();
  const [form, setForm] = useState(vazio);
  const salvar = trpc.penalidades.salvarModelo.useMutation({
    onSuccess: () => {
      void utils.penalidades.modelos.invalidate();
      setForm(vazio);
      toast.success("Medida salva.");
    },
    onError: erro => toast.error(erro.message),
  });
  const comPontos = form.tipo === "perda_pontos";
  const comPeriodo = !comPontos && form.tipo !== "advertencia";
  function enviar(event: FormEvent) {
    event.preventDefault();
    salvar.mutate({
      id: form.id,
      nome: form.nome,
      tipo: form.tipo,
      pontos: comPontos ? Number(form.pontos) || null : null,
      duracaoValor: comPeriodo ? Number(form.duracaoValor) || null : null,
      duracaoUnidade: comPeriodo && form.duracaoValor ? form.duracaoUnidade : null,
      descricao: form.descricao || null,
      ativo: form.ativo,
    });
  }
  return (
    <section className={cartao}>
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#fbeceb] text-[#b3382c]">
          <Gavel className="h-5 w-5" />
        </span>
        <div>
          <p className="font-semibold">Medidas administrativas</p>
          <p className="text-sm text-muted-foreground">
            Retirada de pontos, suspensões e advertências que podem ser
            escolhidas ao concluir uma auditoria ou uma ocorrência.
          </p>
        </div>
      </div>
      <ul className="mt-4 grid gap-2">
        {modelos.data?.map(modelo => (
          <li
            key={modelo.id}
            className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm ${modelo.ativo ? "border-[#e6eee9]" : "border-dashed border-[#d5dcd8] opacity-70"}`}
          >
            <span>
              <b>{modelo.nome}</b>{" "}
              <Badge className="ml-1 border-0 bg-[#f0f4f2] text-[10px] text-muted-foreground">
                {rotuloTipoPenalidade[modelo.tipo]}
              </Badge>
              {modelo.descricao && (
                <span className="block text-xs text-muted-foreground">
                  {modelo.descricao}
                </span>
              )}
            </span>
            <span className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setForm({
                    id: modelo.id,
                    nome: modelo.nome,
                    tipo: modelo.tipo,
                    pontos: modelo.pontos ? String(modelo.pontos) : "",
                    duracaoValor: modelo.duracaoValor
                      ? String(modelo.duracaoValor)
                      : "",
                    duracaoUnidade: modelo.duracaoUnidade ?? "dias",
                    descricao: modelo.descricao ?? "",
                    ativo: modelo.ativo,
                  })
                }
              >
                Editar
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={salvar.isPending}
                onClick={() =>
                  salvar.mutate({
                    id: modelo.id,
                    nome: modelo.nome,
                    tipo: modelo.tipo,
                    pontos: modelo.pontos,
                    duracaoValor: modelo.duracaoValor,
                    duracaoUnidade: modelo.duracaoUnidade,
                    descricao: modelo.descricao,
                    ativo: !modelo.ativo,
                  })
                }
              >
                {modelo.ativo ? "Desativar" : "Ativar"}
              </Button>
            </span>
          </li>
        ))}
      </ul>
      <form
        onSubmit={enviar}
        className="mt-4 grid gap-3 rounded-2xl bg-[#f6faf7] p-4 sm:grid-cols-2"
      >
        <p className="text-sm font-semibold sm:col-span-2">
          {form.id ? "Editar medida" : "Nova medida"}
        </p>
        <label className="grid gap-1 text-xs font-semibold">
          Nome
          <Input
            required
            minLength={3}
            value={form.nome}
            onChange={event => setForm({ ...form, nome: event.target.value })}
            className="h-10 rounded-xl bg-white"
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          Tipo
          <select
            value={form.tipo}
            onChange={event =>
              setForm({ ...form, tipo: event.target.value as TipoPenalidade })
            }
            className="h-10 rounded-xl border border-[#dce8e0] bg-white px-3 text-sm font-normal"
          >
            {(Object.keys(rotuloTipoPenalidade) as TipoPenalidade[]).map(tipo => (
              <option key={tipo} value={tipo}>
                {rotuloTipoPenalidade[tipo]}
              </option>
            ))}
          </select>
        </label>
        {comPontos && (
          <label className="grid gap-1 text-xs font-semibold">
            Pontos retirados
            <Input
              required
              type="number"
              min={1}
              value={form.pontos}
              onChange={event => setForm({ ...form, pontos: event.target.value })}
              className="h-10 rounded-xl bg-white"
            />
          </label>
        )}
        {comPeriodo && (
          <label className="grid gap-1 text-xs font-semibold">
            Duração
            <span className="flex gap-2">
              <Input
                type="number"
                min={1}
                required={form.tipo !== "outra"}
                value={form.duracaoValor}
                onChange={event =>
                  setForm({ ...form, duracaoValor: event.target.value })
                }
                className="h-10 rounded-xl bg-white"
              />
              <select
                value={form.duracaoUnidade}
                onChange={event =>
                  setForm({
                    ...form,
                    duracaoUnidade: event.target.value as "dias" | "meses",
                  })
                }
                className="h-10 rounded-xl border border-[#dce8e0] bg-white px-3 text-sm font-normal"
              >
                <option value="dias">dias</option>
                <option value="meses">meses</option>
              </select>
            </span>
          </label>
        )}
        <label className="grid gap-1 text-xs font-semibold sm:col-span-2">
          Descrição (aparece para quem escolhe a medida)
          <Input
            value={form.descricao}
            maxLength={500}
            onChange={event => setForm({ ...form, descricao: event.target.value })}
            className="h-10 rounded-xl bg-white"
          />
        </label>
        <div className="flex gap-2 sm:col-span-2">
          <Button
            disabled={salvar.isPending}
            className="h-10 rounded-xl bg-[#0f7350] text-white hover:bg-[#0a6243]"
          >
            {form.id ? "Salvar alterações" : "Criar medida"}
          </Button>
          {form.id && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setForm(vazio)}
            >
              Cancelar
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}

import PageIntro from "@/components/PageIntro";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, EyeOff, Gift, History, Lightbulb, Medal, Trophy, UserRound } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";

function formatDate(value: Date | string) {
  return new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

const periodos = [
  { value: "mensal" as const, label: "Mensal" },
  { value: "semestral" as const, label: "Semestral" },
  { value: "anual" as const, label: "Anual" },
];
type Periodo = (typeof periodos)[number]["value"];

const medalha = ["#c99a2e", "#9aa4ad", "#a5672f"];

/** Ideias de prêmio que não pesam no bolso dos outros moradores (não saem da taxa condominial). */
const ideiasDePremio = [
  "Cesta de Natal ou de data comemorativa, paga com a venda dos recicláveis",
  "Vale-compras de comércio parceiro do bairro",
  "Prioridade na reserva do salão de festas ou da churrasqueira",
  "Kit de mudas e adubo da composteira do condomínio",
  "Troféu feito de material reciclado e destaque no mural",
  "Vaga de visitante reservada por um mês",
];

const premiosVazios = () => [1, 2, 3].map((posicao) => ({ posicao, titulo: "", descricao: "" }));

export default function Podio() {
  const [periodo, setPeriodo] = useState<Periodo>("mensal");
  const utils = trpc.useUtils();
  const profile = trpc.perfil.meuPerfil.useQuery();
  const { data, isLoading } = trpc.podio.ranking.useQuery({ periodo });
  const isAdmin = profile.data?.role === "administrador";
  const isResident = profile.data?.role === "morador";
  const historico = trpc.podio.historicoPremios.useQuery(undefined, { enabled: isAdmin });
  const [marcandoId, setMarcandoId] = useState<number | null>(null);
  const [observacao, setObservacao] = useState("");
  const marcarEntregue = trpc.podio.marcarPremioEntregue.useMutation({
    onSuccess: () => {
      utils.podio.ranking.invalidate();
      utils.podio.historicoPremios.invalidate();
      toast.success("Entrega do prêmio registrada.");
      setMarcandoId(null);
      setObservacao("");
    },
    onError: (issue) => toast.error(issue.message),
  });
  const definirExibicao = trpc.podio.definirExibicaoNome.useMutation({
    onSuccess: () => { utils.perfil.meuPerfil.invalidate(); utils.podio.ranking.invalidate(); utils.engajamento.ranking.invalidate(); toast.success("Preferência salva."); },
    onError: (issue) => toast.error(issue.message),
  });

  // Empatados no 3º lugar também sobem ao pódio (a posição vem calculada do servidor).
  const top3 = data?.ranking.filter((linha) => linha.noPodio) ?? [];
  // Só a administração recebe as posições abaixo do 3º lugar.
  const demais = data?.ranking.filter((linha) => !linha.noPodio) ?? [];

  return (
    <div>
      <PageIntro
        eyebrow="Reconhecimento"
        title="Pódio de reciclagem"
        description="Os três moradores que mais reciclaram no período sobem ao pódio e ganham o prêmio definido pelo síndico. Para proteger a privacidade de todos, ninguém abaixo do 3º lugar é mostrado aos moradores."
        action={<div className="flex gap-2 rounded-xl border border-[#dce8e0] bg-white p-1">{periodos.map((item) => (
          <Button key={item.value} size="sm" variant="ghost" onClick={() => setPeriodo(item.value)} className={`h-8 rounded-lg px-3 text-xs font-semibold ${periodo === item.value ? "bg-[#0f7350] text-white hover:bg-[#0a6243] hover:text-white" : "text-muted-foreground"}`}>{item.label}</Button>
        ))}</div>}
      />

      <section className="rounded-[24px] border border-[#dce8e0] bg-white p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.35)] sm:p-6">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#fff3df] text-[#7a4d0a]"><Trophy className="h-5 w-5" /></span>
          <div>
            <p className="font-semibold">Top 3 do período {periodos.find((item) => item.value === periodo)?.label.toLowerCase()}</p>
            <p className="text-sm text-muted-foreground">Pontuação das coletas concluídas neste período. Empate nos pontos é decidido pelo peso; se continuar, os moradores dividem a posição.</p>
          </div>
        </div>

        {isLoading ? (
          <p className="mt-6 text-sm text-muted-foreground">Calculando ranking do período...</p>
        ) : top3.length === 0 ? (
          <p className="mt-6 text-sm leading-6 text-muted-foreground">Ainda não há coletas concluídas suficientes neste período para formar o pódio.</p>
        ) : (
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {top3.map((linha, indice) => (
              <article key={linha.moradorId ?? `pos-${indice}`} className={`rounded-2xl border p-4 text-center ${linha.voce ? "border-[#0f7350]/40 bg-[#f1f8f4]" : "border-[#e0ebe4] bg-[#fbfdfc]"}`}>
                <span className="mx-auto grid h-11 w-11 place-items-center rounded-full text-white" style={{ backgroundColor: medalha[linha.position - 1] }}>
                  <Medal className="h-5 w-5" />
                </span>
                <p className="mt-3 text-xs font-bold uppercase tracking-[.08em] text-muted-foreground">{linha.position}º lugar{linha.empatado ? " (empate)" : ""}</p>
                <p className="mt-1 text-sm font-semibold">{linha.nome}{linha.voce ? " (você)" : ""}</p>
                <p className="text-xs text-muted-foreground">Bloco {linha.bloco}{linha.apartamento ? ` · ${linha.apartamento}` : ""}</p>
                <p className="mt-3 text-lg font-bold text-[#0f7350]">{linha.pontos} pts</p>
                <p className="text-xs text-muted-foreground">{linha.pesoKg} kg reciclados</p>
                <p className="mt-3 flex items-center justify-center gap-1.5 rounded-lg bg-[#fff8ec] px-2 py-1.5 text-[11px] font-semibold text-[#7a4d0a]"><Gift className="h-3.5 w-3.5 shrink-0" />{linha.premio ? linha.premio.titulo : "Prêmio a definir"}</p>
                {isAdmin && linha.moradorId !== null && (
                  linha.premioEntregue ? (
                    <p className="mt-2 flex items-center justify-center gap-1.5 rounded-lg bg-[#e8f4ed] px-2 py-1.5 text-[11px] font-semibold text-[#0a7048]"><CheckCircle2 className="h-3.5 w-3.5" />Entregue em {formatDate(linha.premioEntregue.entregueEm)}</p>
                  ) : marcandoId === linha.moradorId ? (
                    <div className="mt-2 grid gap-2">
                      <Input aria-label="Observação da entrega do prêmio" placeholder="Observação (opcional)" value={observacao} onChange={(event) => setObservacao(event.target.value)} className="h-9 rounded-lg bg-white text-xs" />
                      <div className="flex gap-2">
                        <Button size="sm" disabled={marcarEntregue.isPending} onClick={() => marcarEntregue.mutate({ moradorId: linha.moradorId!, periodo, observacao: observacao.trim() || undefined })} className="h-8 flex-1 rounded-lg bg-[#0f7350] text-xs text-white hover:bg-[#0a6243]">Confirmar</Button>
                        <Button size="sm" variant="ghost" onClick={() => setMarcandoId(null)} className="h-8 rounded-lg text-xs">Cancelar</Button>
                      </div>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" disabled={!linha.premio} onClick={() => { setMarcandoId(linha.moradorId); setObservacao(""); }} className="mt-2 h-8 w-full rounded-lg text-xs">Marcar prêmio como entregue</Button>
                  )
                )}
              </article>
            ))}
          </div>
        )}

        {isResident && (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="flex items-start gap-3 rounded-2xl border border-[#cfe1d7] bg-[#f7fbf8] p-4">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#e8f4ed] text-[#0f7350]"><UserRound className="h-4 w-4" /></span>
              <div>
                <p className="text-sm font-semibold">{data?.minhaPosicao ? `Sua posição: ${data.minhaPosicao.position}º de ${data.totalParticipantes}` : "Você ainda não pontuou neste período"}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{data?.minhaPosicao ? `${data.minhaPosicao.pontos} pts · ${data.minhaPosicao.pesoKg} kg reciclados. Só você vê a sua posição.` : "Registre sua reciclagem na estação de pesagem para entrar na disputa."}</p>
              </div>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[#e0ebe4] bg-white p-4">
              <input type="checkbox" className="mt-1 h-4 w-4 accent-[#0f7350]" checked={profile.data?.resident?.ocultarNomeNoPodio ?? false} disabled={definirExibicao.isPending} onChange={(event) => definirExibicao.mutate({ hideName: event.target.checked })} />
              <span>
                <span className="flex items-center gap-1.5 text-sm font-semibold"><EyeOff className="h-4 w-4 text-muted-foreground" />Não mostrar meu nome no pódio</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">Se você ficar entre os três primeiros, aparece como "Morador(a) do bloco {profile.data?.resident?.bloco ?? "?"}". Você continua concorrendo ao prêmio.</span>
              </span>
            </label>
          </div>
        )}

        {isAdmin && demais.length > 0 && (
          <div className="mt-6">
            <p className="text-xs font-bold uppercase tracking-[.08em] text-muted-foreground">Demais colocados (visível só para a administração)</p>
            <ol className="mt-2 divide-y divide-[#edf2ef]">
              {demais.map((linha) => (
                <li key={linha.moradorId} className="flex items-center justify-between py-3">
                  <span className="flex items-center gap-3">
                    <b className="grid h-8 w-8 place-items-center rounded-xl bg-[#f0f5f2] text-xs text-muted-foreground">{linha.position}</b>
                    <span><span className="block text-sm font-semibold">{linha.nome}</span><span className="text-xs text-muted-foreground">Bloco {linha.bloco} · {linha.apartamento}</span></span>
                  </span>
                  <span className="text-sm font-bold text-[#0f7350]">{linha.pontos} pts</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>

      {isAdmin && <PremiosDoPeriodo periodo={periodo} premios={data?.premios} />}

      {isAdmin && (
        <section className="mt-5 rounded-[24px] border border-[#dce8e0] bg-white p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.35)] sm:p-6">
          <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e8f4ed] text-[#0f7350]"><History className="h-5 w-5" /></span><div><p className="font-semibold">Histórico de prêmios entregues</p><p className="text-sm text-muted-foreground">Fecha o ciclo do pódio: cada linha registra quem entregou o prêmio e quando.</p></div></div>
          <div className="mt-4 grid gap-2">
            {historico.data?.length ? historico.data.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#e5eee8] bg-[#fbfdfc] px-4 py-3 text-sm">
                <span><b className="font-semibold">{item.moradorNome}</b> · {item.posicao}º lugar · {item.periodo}</span>
                <span className="text-xs text-muted-foreground">{item.premio} · entregue em {formatDate(item.entregueEm)}{item.observacao ? ` · ${item.observacao}` : ""}</span>
              </div>
            )) : <p className="rounded-2xl bg-[#f6faf7] p-5 text-sm leading-6 text-muted-foreground">Nenhum prêmio foi registrado como entregue ainda.</p>}
          </div>
        </section>
      )}
    </div>
  );
}

function PremiosDoPeriodo({ periodo, premios }: { periodo: Periodo; premios?: Array<{ posicao: number; titulo: string; descricao: string | null }> }) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState(premiosVazios);
  useEffect(() => {
    setForm(premiosVazios().map((vazio) => {
      const salvo = premios?.find((premio) => premio.posicao === vazio.posicao);
      return salvo ? { posicao: salvo.posicao, titulo: salvo.titulo, descricao: salvo.descricao ?? "" } : vazio;
    }));
  }, [premios, periodo]);
  const salvar = trpc.podio.configurarPremios.useMutation({
    onSuccess: () => { utils.podio.ranking.invalidate(); toast.success("Prêmios do pódio salvos."); },
    onError: (issue) => toast.error(issue.message),
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    salvar.mutate({ periodo, premios: form.map((premio) => ({ posicao: premio.posicao, titulo: premio.titulo.trim(), descricao: premio.descricao.trim() || null })) });
  }
  function usarIdeia(ideia: string) {
    const vazio = form.findIndex((premio) => !premio.titulo.trim());
    const alvo = vazio === -1 ? 2 : vazio;
    setForm(form.map((premio, indice) => (indice === alvo ? { ...premio, titulo: ideia } : premio)));
  }
  const rotulo = periodos.find((item) => item.value === periodo)?.label.toLowerCase();
  return (
    <section className="mt-5 rounded-[24px] border border-[#dce8e0] bg-white p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.35)] sm:p-6">
      <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#fff3df] text-[#7a4d0a]"><Gift className="h-5 w-5" /></span><div><p className="font-semibold">Prêmios do pódio {rotulo}</p><p className="text-sm text-muted-foreground">Defina o que o 1º, o 2º e o 3º lugar ganham neste período. Prefira prêmios que não saiam da taxa condominial, para não pesar no bolso dos outros moradores.</p></div></div>
      <form onSubmit={submit} className="mt-4 grid gap-3">
        {form.map((premio, indice) => (
          <div key={premio.posicao} className="grid gap-2 rounded-2xl border border-[#e5eee8] bg-[#fbfdfc] p-3 sm:grid-cols-[90px_1fr_1fr] sm:items-center">
            <span className="text-sm font-semibold">{premio.posicao}º lugar</span>
            <Input aria-label={`Prêmio do ${premio.posicao}º lugar`} placeholder="Nome do prêmio (vazio = sem prêmio)" value={premio.titulo} onChange={(event) => setForm(form.map((item, posicao) => (posicao === indice ? { ...item, titulo: event.target.value } : item)))} className="h-10 rounded-xl bg-white" />
            <Input aria-label={`Detalhes do prêmio do ${premio.posicao}º lugar`} placeholder="Detalhes (opcional)" value={premio.descricao} onChange={(event) => setForm(form.map((item, posicao) => (posicao === indice ? { ...item, descricao: event.target.value } : item)))} className="h-10 rounded-xl bg-white" />
          </div>
        ))}
        <div><Button disabled={salvar.isPending} className="h-10 rounded-xl bg-[#0f7350] text-white hover:bg-[#0a6243]">Salvar prêmios</Button></div>
      </form>
      <div className="mt-5 rounded-2xl bg-[#f7fbf8] p-4">
        <p className="flex items-center gap-2 text-sm font-semibold"><Lightbulb className="h-4 w-4 text-[#7a4d0a]" />Ideias sem custo para os outros moradores</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {ideiasDePremio.map((ideia) => (
            <button key={ideia} type="button" onClick={() => usarIdeia(ideia)} className="rounded-full border border-[#cfe1d7] bg-white px-3 py-1.5 text-left text-xs text-[#0f7350] hover:bg-[#edf7f1]">{ideia}</button>
          ))}
        </div>
      </div>
    </section>
  );
}

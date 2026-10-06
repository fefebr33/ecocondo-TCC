import PageIntro from "@/components/PageIntro";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import {
  ArrowDownRight,
  ArrowUpRight,
  Coins,
  Gift,
  Medal,
  Pencil,
  Plus,
  Sparkles,
} from "lucide-react";
import { FormEvent, useState } from "react";
import { toast } from "sonner";
import { useAncora } from "@/hooks/useAncora";
import { palavra, plural } from "@shared/plural";

const redemptionStatusLabels = {
  solicitado: "Aguardando síndico",
  aprovado: "Aprovado",
  entregue: "Entregue",
  cancelado: "Cancelado",
} as const;
const redemptionStatusStyles = {
  solicitado: "bg-[#fff4dd] text-[#7a4d0a]",
  aprovado: "bg-[#e8f1fb] text-[#1f4f82]",
  entregue: "bg-[#e7f5ec] text-[#0a7048]",
  cancelado: "bg-[#f0f4f2] text-muted-foreground",
} as const;
const formatDate = (value: Date) =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(value);

const rewardForm = { title: "", description: "", pointsCost: "", stock: "" };

export default function Engagement() {
  const utils = trpc.useUtils();
  const profile = trpc.perfil.meuPerfil.useQuery();
  const { data: ranking } = trpc.engajamento.ranking.useQuery();
  const { data: rewards } = trpc.engajamento.recompensas.useQuery();
  const createReward = trpc.engajamento.criarRecompensa.useMutation({
    onSuccess: () => {
      utils.engajamento.recompensas.invalidate();
      toast.success("Recompensa adicionada ao catálogo.");
      setForm(rewardForm);
      setIsFormOpen(false);
    },
    onError: issue => toast.error(issue.message),
  });
  const refreshPoints = () => {
    utils.engajamento.ranking.invalidate();
    utils.engajamento.recompensas.invalidate();
    utils.engajamento.meusResgates.invalidate();
    utils.engajamento.extrato.invalidate();
    utils.perfil.meuPerfil.invalidate();
    utils.notificacoes.contagemNaoLidas.invalidate();
  };
  const redeem = trpc.engajamento.resgatar.useMutation({
    onSuccess: result => {
      refreshPoints();
      toast.success(
        `Resgate solicitado. Saldo atual: ${plural(result.balance ?? 0, "ponto", "pontos")}.`
      );
    },
    onError: issue => {
      refreshPoints();
      toast.error(issue.message);
    },
  });
  const updateReward = trpc.engajamento.atualizarRecompensa.useMutation({
    onSuccess: () => {
      utils.engajamento.recompensas.invalidate();
      toast.success("Recompensa atualizada.");
    },
    onError: issue => toast.error(issue.message),
  });
  const saldo = ranking?.saldo ?? 0;
  function editReward(reward: {
    id: number;
    titulo: string;
    custoPontos: number;
    estoque: number | null;
  }) {
    const custo = window.prompt(
      `Pontos necessários para "${reward.titulo}":`,
      String(reward.custoPontos)
    );
    if (custo === null) return;
    const estoque = window.prompt(
      "Estoque (deixe vazio para estoque aberto):",
      reward.estoque === null ? "" : String(reward.estoque)
    );
    if (estoque === null) return;
    const pointsCost = Number(custo);
    const stock = estoque.trim() === "" ? null : Number(estoque);
    if (
      !Number.isInteger(pointsCost) ||
      pointsCost < 1 ||
      (stock !== null && (!Number.isInteger(stock) || stock < 0))
    ) {
      toast.error(
        "Informe números inteiros: custo a partir de 1 e estoque a partir de 0."
      );
      return;
    }
    updateReward.mutate({ id: reward.id, pointsCost, stock });
  }
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [form, setForm] = useState(rewardForm);
  const isAdmin = profile.data?.role === "administrador";
  const isResident = profile.data?.role === "morador";
  useAncora(Boolean(profile.data));
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createReward.mutate({
      title: form.title,
      description: form.description,
      pointsCost: Number(form.pointsCost),
      stock: form.stock ? Number(form.stock) : null,
    });
  }
  return (
    <div>
      <PageIntro
        eyebrow="Participação"
        title="Engajamento"
        description="Valorize a participação de moradores com pontos, ranking e recompensas alinhadas à rotina do condomínio."
        action={
          isAdmin ? (
            <Button
              onClick={() => setIsFormOpen(open => !open)}
              className="h-10 rounded-xl bg-[#0f7350] font-semibold text-white hover:bg-[#0a6243]"
            >
              <Plus className="mr-2 h-4 w-4" />
              Nova recompensa
            </Button>
          ) : undefined
        }
      />
      <div className="grid gap-5 xl:grid-cols-[.9fr_1.1fr]">
        <section className="rounded-[24px] border border-[#dce8e0] bg-white p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.35)] sm:p-6">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#fff3df] text-[#7a4d0a]">
              <Medal className="h-5 w-5" />
            </span>
            <div>
              <p className="font-semibold">Ranking do condomínio</p>
              <p className="text-sm text-muted-foreground">
                {isAdmin
                  ? "Pontos ganhos por todos os moradores, desde o início (só a administração vê a lista completa). Resgatar não tira ninguém do ranking."
                  : "Os três moradores com mais pontos ganhos. Resgatar recompensas não tira ninguém do ranking."}
              </p>
            </div>
          </div>
          {ranking?.linhas.length ? (
            <ol className="mt-5 divide-y divide-[#edf2ef]">
              {ranking.linhas.map((resident, indice) => (
                <li
                  key={resident.id ?? `pos-${indice}`}
                  className="flex items-center justify-between py-3"
                >
                  <span className="flex items-center gap-3">
                    <b
                      className={`grid h-8 w-8 place-items-center rounded-xl text-xs ${resident.position <= 3 ? "bg-[#fff3df] text-[#9c691e]" : "bg-[#f0f5f2] text-muted-foreground"}`}
                    >
                      {resident.position}
                    </b>
                    <span>
                      <span className={`block text-sm font-semibold ${resident.suspensaoPeriodo ? "text-muted-foreground" : ""}`}>
                        {resident.nome}
                        {resident.voce ? " (você)" : ""}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Bloco {resident.bloco}
                        {resident.apartamento
                          ? ` · ${resident.apartamento}`
                          : ""}
                        {resident.suspensaoPeriodo
                          ? ` · participação suspensa ${resident.suspensaoPeriodo}`
                          : ""}
                      </span>
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-sm font-bold text-[#0f7350]">
                      {plural(resident.pontos, "pt", "pts")}
                    </span>
                    {isAdmin && resident.saldo !== null && (
                      <span className="text-[11px] text-muted-foreground">
                        saldo {resident.saldo}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-6 text-sm leading-6 text-muted-foreground">
              O ranking aparece quando os primeiros descartes forem aprovados.
            </p>
          )}
          {isAdmin && (ranking?.foraPorSuspensao.length ?? 0) > 0 && (
            <p className="mt-4 rounded-xl bg-[#f6f7f6] p-3 text-xs leading-5 text-muted-foreground">
              Fora do ranking por suspensão:{" "}
              {ranking!.foraPorSuspensao
                .map(
                  linha =>
                    `${linha.nome} (bloco ${linha.bloco}, ${plural(linha.pontos, "ponto", "pontos")}, suspenso(a) ${linha.periodo})`
                )
                .join("; ")}
              . Os vizinhos não veem a suspensão.
            </p>
          )}
          {isResident && (
            <p className="mt-4 rounded-2xl bg-[#f6faf7] px-4 py-3 text-sm text-muted-foreground">
              {ranking?.minhaPosicao ? (
                <>
                  Sua posição:{" "}
                  <b className="text-foreground">
                    {ranking.minhaPosicao.position}º de{" "}
                    {ranking.totalParticipantes}
                  </b>{" "}
                  com {plural(ranking.minhaPosicao.pontos, "ponto", "pontos")}.
                </>
              ) : (
                "Você ainda não tem pontos. Registre sua reciclagem na estação para entrar no ranking."
              )}{" "}
              Por privacidade, só os três primeiros aparecem para os moradores.
            </p>
          )}
        </section>
        <section className="rounded-[24px] border border-[#dce8e0] bg-white p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.35)] sm:p-6">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e8f4ed] text-[#0f7350]">
              <Gift className="h-5 w-5" />
            </span>
            <div>
              <p className="font-semibold">Catálogo de recompensas</p>
              <p className="text-sm text-muted-foreground">
                {isResident ? (
                  <>
                    Seu saldo:{" "}
                    <b className="text-foreground">{plural(saldo, "ponto", "pontos")}</b>. O
                    resgate só acontece se houver saldo e estoque.
                  </>
                ) : (
                  "Custo e disponibilidade de cada recompensa. Recompensas desativadas não aparecem para os moradores."
                )}
              </p>
            </div>
          </div>
          {isFormOpen && (
            <form
              onSubmit={submit}
              className="mt-5 grid gap-3 rounded-2xl border border-[#cfe1d7] bg-[#f7fbf8] p-4 sm:grid-cols-2"
            >
              <label className="grid gap-1.5 text-xs font-semibold sm:col-span-2">
                Título
                <Input
                  required
                  value={form.title}
                  onChange={event =>
                    setForm({ ...form, title: event.target.value })
                  }
                  className="h-10 rounded-xl bg-white"
                />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold sm:col-span-2">
                Descrição
                <Input
                  required
                  value={form.description}
                  onChange={event =>
                    setForm({ ...form, description: event.target.value })
                  }
                  className="h-10 rounded-xl bg-white"
                />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold">
                Pontos necessários
                <Input
                  required
                  type="number"
                  min="1"
                  value={form.pointsCost}
                  onChange={event =>
                    setForm({ ...form, pointsCost: event.target.value })
                  }
                  className="h-10 rounded-xl bg-white"
                />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold">
                Estoque (opcional)
                <Input
                  type="number"
                  min="0"
                  value={form.stock}
                  onChange={event =>
                    setForm({ ...form, stock: event.target.value })
                  }
                  className="h-10 rounded-xl bg-white"
                />
              </label>
              <div className="flex gap-2 sm:col-span-2">
                <Button
                  disabled={createReward.isPending}
                  className="h-10 rounded-xl bg-[#0f7350] text-white hover:bg-[#0a6243]"
                >
                  Salvar recompensa
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setIsFormOpen(false)}
                  className="h-10 rounded-xl"
                >
                  Cancelar
                </Button>
              </div>
            </form>
          )}
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {rewards?.length ? (
              rewards.map(reward => (
                <article
                  key={reward.id}
                  className="rounded-2xl border border-[#e0ebe4] bg-[#fbfdfc] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#e8f4ed] text-[#0f7350]">
                      <Sparkles className="h-4 w-4" />
                    </span>
                    <Badge className="border-0 bg-[#edf7f1] text-[#0a7048] hover:bg-[#edf7f1]">
                      {plural(reward.custoPontos, "pt", "pts")}
                    </Badge>
                  </div>
                  <h2 className="mt-4 text-sm font-bold">{reward.titulo}</h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {reward.descricao}
                  </p>
                  <div className="mt-4 flex items-center justify-between">
                    <span
                      className={`text-[11px] ${!reward.disponivel ? "font-semibold text-[#b3382c]" : reward.estoqueBaixo ? "font-semibold text-[#7a4d0a]" : "text-muted-foreground"}`}
                    >
                      {!reward.ativo
                        ? "Desativada"
                        : reward.estoque === null
                          ? "Estoque aberto"
                          : reward.estoque === 0
                            ? "Esgotado"
                            : `${plural(reward.estoque, "disponível", "disponíveis")}${reward.estoqueBaixo ? " · estoque baixo" : ""}`}
                    </span>
                    {isResident ? (
                      <Button
                        size="sm"
                        disabled={redeem.isPending || !reward.disponivel}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Resgatar "${reward.titulo}" por ${plural(reward.custoPontos, "ponto", "pontos")}? Seu saldo passa de ${saldo} para ${saldo - reward.custoPontos}.`
                            )
                          )
                            redeem.mutate({ rewardId: reward.id });
                        }}
                        className="h-8 rounded-lg bg-[#0f7350] text-xs text-white hover:bg-[#0a6243]"
                      >
                        {!reward.disponivel
                          ? "Esgotado"
                          : saldo < reward.custoPontos
                            ? `${palavra(reward.custoPontos - saldo, "Falta", "Faltam")} ${plural(reward.custoPontos - saldo, "pt", "pts")}`
                            : "Resgatar"}
                      </Button>
                    ) : isAdmin ? (
                      <span className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => editReward(reward)}
                          aria-label={`Editar ${reward.titulo}`}
                          className="h-8 rounded-lg text-xs"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={updateReward.isPending}
                          onClick={() =>
                            updateReward.mutate({
                              id: reward.id,
                              active: !reward.ativo,
                            })
                          }
                          className="h-8 rounded-lg text-xs"
                        >
                          {reward.ativo ? "Desativar" : "Reativar"}
                        </Button>
                      </span>
                    ) : null}
                  </div>
                </article>
              ))
            ) : (
              <p className="py-8 text-sm text-muted-foreground sm:col-span-2">
                O administrador pode montar o primeiro catálogo de recompensas
                nesta área.
              </p>
            )}
          </div>
        </section>
      </div>
      {isResident && <PointsStatement />}
      {isAdmin ? <RedemptionRequests /> : isResident ? <MyRedemptions /> : null}
    </div>
  );
}

function RedemptionStatus({
  status,
}: {
  status: keyof typeof redemptionStatusLabels;
}) {
  return (
    <Badge
      className={`border-0 ${redemptionStatusStyles[status]} hover:bg-inherit`}
    >
      {redemptionStatusLabels[status]}
    </Badge>
  );
}

function MyRedemptions() {
  const { data } = trpc.engajamento.meusResgates.useQuery();
  return (
    <section
      id="resgates"
      className="mt-5 scroll-mt-24 rounded-[24px] border border-[#dce8e0] bg-white p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.35)] sm:p-6"
    >
      <p className="font-semibold">Meus resgates</p>
      <p className="text-sm text-muted-foreground">
        Acompanhe os pedidos feitos no catálogo. Se o síndico cancelar um
        pedido, os pontos voltam para você.
      </p>
      {data?.length ? (
        <ul className="mt-4 divide-y divide-[#edf2ef]">
          {data.map(item => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-2 py-3"
            >
              <span>
                <span className="block text-sm font-semibold">
                  {item.recompensa ?? "Recompensa removida"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDate(item.criadoEm)} ·{" "}
                  {plural(item.pontosGastos, "pt", "pts")}
                </span>
              </span>
              <RedemptionStatus status={item.status} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 rounded-2xl bg-[#f6faf7] p-5 text-sm text-muted-foreground">
          Você ainda não fez nenhum resgate.
        </p>
      )}
    </section>
  );
}

function RedemptionRequests() {
  const utils = trpc.useUtils();
  const { data } = trpc.engajamento.listarResgates.useQuery();
  const update = trpc.engajamento.atualizarResgate.useMutation({
    onSuccess: () => {
      utils.engajamento.listarResgates.invalidate();
      utils.engajamento.recompensas.invalidate();
      utils.engajamento.ranking.invalidate();
      toast.success("Resgate atualizado.");
    },
    onError: issue => toast.error(issue.message),
  });
  function cancel(id: number, name: string | null) {
    if (
      window.confirm(
        `Cancelar o resgate de ${name ?? "este morador"}? Os pontos e a unidade voltam para o estoque.`
      )
    )
      update.mutate({ id, status: "cancelado" });
  }
  return (
    <section
      id="pedidos"
      className="mt-5 scroll-mt-24 rounded-[24px] border border-[#dce8e0] bg-white p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.35)] sm:p-6"
    >
      <p className="font-semibold">Pedidos de resgate</p>
      <p className="text-sm text-muted-foreground">
        Aprove, marque como entregue ou cancele os pedidos dos moradores.
        Cancelar devolve os pontos.
      </p>
      {data?.length ? (
        <ul className="mt-4 divide-y divide-[#edf2ef]">
          {data.map(item => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <span>
                <span className="block text-sm font-semibold">
                  {item.recompensa ?? "Recompensa removida"} ·{" "}
                  {item.morador ?? "Morador removido"}
                </span>
                <span className="text-xs text-muted-foreground">
                  Bloco {item.bloco ?? "—"} · {item.apartamento ?? "—"} ·{" "}
                  {formatDate(item.criadoEm)} ·{" "}
                  {plural(item.pontosGastos, "pt", "pts")}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <RedemptionStatus status={item.status} />
                {item.status === "solicitado" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={update.isPending}
                    onClick={() =>
                      update.mutate({ id: item.id, status: "aprovado" })
                    }
                    className="h-8 rounded-lg text-xs"
                  >
                    Aprovar
                  </Button>
                )}
                {(item.status === "solicitado" ||
                  item.status === "aprovado") && (
                  <>
                    <Button
                      size="sm"
                      disabled={update.isPending}
                      onClick={() =>
                        update.mutate({ id: item.id, status: "entregue" })
                      }
                      className="h-8 rounded-lg bg-[#0f7350] text-xs text-white hover:bg-[#0a6243]"
                    >
                      Marcar entregue
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={update.isPending}
                      onClick={() => cancel(item.id, item.morador)}
                      className="h-8 rounded-lg text-xs text-destructive"
                    >
                      Cancelar
                    </Button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 rounded-2xl bg-[#f6faf7] p-5 text-sm text-muted-foreground">
          Nenhum pedido de resgate até agora.
        </p>
      )}
    </section>
  );
}

/** Extrato de pontos do morador: cada entrada (descartes aprovados, devoluções, ajustes) e saída (estornos, resgates, penalidades, zeragem do ciclo), com o saldo depois de cada uma. */
function PointsStatement() {
  const { data, isLoading, error } = trpc.engajamento.extrato.useQuery();
  return (
    <section
      id="extrato"
      className="mt-5 scroll-mt-24 rounded-[24px] border border-[#dce8e0] bg-white p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.35)] sm:p-6"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#fff3df] text-[#7a4d0a]">
            <Coins className="h-5 w-5" />
          </span>
          <div>
            <p className="font-semibold">Extrato de pontos</p>
            <p className="text-sm text-muted-foreground">
              Entradas e saídas do seu saldo, da mais recente para a mais
              antiga.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <span className="rounded-xl bg-[#f6faf7] px-3 py-2">
            <b className="block text-base text-foreground">
              {data?.saldo ?? "—"}
            </b>
            saldo
          </span>
          <span className="rounded-xl bg-[#f6faf7] px-3 py-2">
            <b className="block text-base text-[#0a7048]">
              {data?.ganhos ?? "—"}
            </b>
            entradas
          </span>
          <span className="rounded-xl bg-[#f6faf7] px-3 py-2">
            <b className="block text-base text-[#b3382c]">
              {data?.gastos ?? "—"}
            </b>
            saídas
          </span>
        </div>
      </div>
      {error ? (
        <p className="mt-4 text-sm text-destructive">{error.message}</p>
      ) : isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Carregando extrato...
        </p>
      ) : data?.movimentacoes.length ? (
        <ul className="mt-4 divide-y divide-[#edf2ef]">
          {data.movimentacoes.map(item => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-3 py-3"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span
                  className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${item.pontos > 0 ? "bg-[#e7f5ec] text-[#0a7048]" : "bg-[#fbeceb] text-[#b3382c]"}`}
                >
                  {item.pontos > 0 ? (
                    <ArrowUpRight className="h-4 w-4" />
                  ) : (
                    <ArrowDownRight className="h-4 w-4" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">
                    {item.descricao}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {item.rotulo} · {formatDate(item.criadoEm)}
                  </span>
                </span>
              </span>
              <span className="shrink-0 text-right">
                <b
                  className={`block text-sm ${item.pontos > 0 ? "text-[#0a7048]" : "text-[#b3382c]"}`}
                >
                  {item.pontos > 0 ? "+" : ""}
                  {item.pontos}
                </b>
                {item.saldoApos !== null && (
                  <span className="text-[11px] text-muted-foreground">
                    saldo {item.saldoApos}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 rounded-2xl bg-[#f6faf7] p-5 text-sm text-muted-foreground">
          Seu extrato aparece aqui depois do primeiro descarte aprovado.
        </p>
      )}
    </section>
  );
}

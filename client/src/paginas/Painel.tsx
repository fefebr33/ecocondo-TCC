import PageIntro from "@/components/PageIntro";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { formatarNumero } from "@/lib/utils";
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, CalendarDays, CheckCircle2, CircleAlert, Coins, Medal, Recycle, RefreshCw, Sprout, TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "wouter";

const statusLabels: Record<string, string> = { agendada: "Agendada", em_andamento: "Em andamento", concluida: "Concluída", cancelada: "Cancelada", ocorrencia: "Ocorrência" };
const labels: Record<string, string> = { reciclavel: "Reciclável", organico: "Orgânico", rejeito: "Rejeito", eletronico: "Eletrônico", perigoso: "Perigoso" };
const medalha = ["#c99a2e", "#9aa4ad", "#a5672f"];
const cartao = "rounded-[24px] border border-[#dce8e0] bg-white p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.35)] sm:p-6";

function Variacao({ valor }: { valor: number | null }) {
  if (valor === null) return <span className="text-xs text-muted-foreground">sem dados do mês anterior</span>;
  const subiu = valor >= 0;
  const Icone = subiu ? ArrowUpRight : ArrowDownRight;
  return <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${subiu ? "text-[#0a7048]" : "text-[#b3382c]"}`}><Icone className="h-3.5 w-3.5" />{subiu ? "+" : ""}{formatarNumero(valor, 1)}%</span>;
}

export default function Dashboard() {
  const { data, isLoading, error, refetch, isFetching } = trpc.dashboard.resumo.useQuery();
  const profile = trpc.perfil.meuPerfil.useQuery();
  const isAdmin = profile.data?.role === "administrador";
  const attentionCount = (data?.occurrenceCount ?? 0) + (data?.openIncidentCount ?? 0);
  const hasCompleted = Boolean(data?.completedCount);
  const metrics = [
    { label: "Total coletado", value: data?.totalKg ? `${formatarNumero(data.totalKg)} kg` : "—", helper: data?.completedCount ? `${data.completedCount} coleta(s) concluída(s), peso confirmado` : "Aguardando registros", icon: Recycle, tone: "emerald" },
    { label: "Taxa de reciclagem", value: data?.recyclingRate === null || data?.recyclingRate === undefined ? "—" : `${formatarNumero(data.recyclingRate, 1)}%`, helper: data?.recyclingRate === null ? "Disponível após as coletas" : "Sobre o material coletado", icon: Sprout, tone: "sage" },
    { label: "Coletas concluídas", value: data?.completedCount ? `${data.completedCount}` : "—", helper: data?.pendingReviewCount ? `${data.pendingReviewCount} em revisão` : data?.completedCount ? "Desde o início" : "Nenhuma coleta finalizada", icon: CalendarDays, tone: "blue" },
    { label: "Ocorrências", value: attentionCount ? `${attentionCount}` : "0", helper: attentionCount ? `${data?.occurrenceCount ?? 0} em coletas · ${data?.openIncidentCount ?? 0} ambiental(is) em aberto` : "Nada pendente no momento", icon: CircleAlert, tone: "orange" },
  ];
  const tones = { emerald: "bg-[#e5f6ec] text-[#0a7048]", sage: "bg-[#edf4dc] text-[#637b20]", blue: "bg-[#e8f1fb] text-[#2863a5]", orange: "bg-[#fff0e7] text-[#b45522]" };
  const chartData = (data?.byWasteType ?? []).map((item: { wasteType: string; kilograms: number }) => ({ name: labels[item.wasteType] ?? item.wasteType, kg: item.kilograms }));
  const hasData = chartData.some((item) => item.kg > 0);
  const evolucao = data?.evolucao ?? [];
  const temEvolucao = evolucao.some((item) => item.coletas > 0);

  if (error) {
    return <div>
      <PageIntro eyebrow="Painel operacional" title="A sustentabilidade começa com uma operação clara." description="Acompanhe os indicadores de coleta, o engajamento dos moradores e as atividades que precisam de atenção." />
      <section role="alert" className={`${cartao} text-center`}>
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#fbeceb] text-[#b3382c]"><AlertTriangle className="h-5 w-5" /></span>
        <p className="mt-4 font-semibold">Não foi possível carregar o painel agora.</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Confira a conexão e tente de novo. Se continuar, o servidor ou o banco de dados pode estar fora do ar. ({error.message})</p>
        <Button onClick={() => refetch()} disabled={isFetching} className="mt-5 h-10 rounded-xl bg-[#0f7350] text-white hover:bg-[#0a6243]"><RefreshCw className="mr-2 h-4 w-4" />{isFetching ? "Tentando..." : "Tentar de novo"}</Button>
      </section>
    </div>;
  }

  return <div aria-busy={isLoading}>
    <PageIntro eyebrow="Painel operacional" title="A sustentabilidade começa com uma operação clara." description="Acompanhe os indicadores de coleta, o engajamento dos moradores e as atividades que precisam de atenção." action={<Button asChild className="h-10 rounded-xl bg-[#0f7350] px-4 font-semibold text-white hover:bg-[#0a6243]"><Link href="/coletas">{isAdmin ? "Ir para coletas" : "Registrar reciclagem"} <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>} />

    {isAdmin && data?.alertas && data.alertas.length > 0 && <section aria-label="Alertas administrativos" className="mb-5 rounded-[24px] border border-[#f3c98a] bg-[#fff8ec] p-5 sm:p-6">
      <p className="flex items-center gap-2 font-semibold text-[#7a4d0a]"><AlertTriangle className="h-5 w-5" />Precisa de atenção</p>
      <ul className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">{data.alertas.map((alerta) => <li key={alerta.id} className="min-w-0"><Link href={alerta.link} className={`flex items-start justify-between gap-3 rounded-2xl border bg-white p-3 text-sm hover:border-[#0f7350] ${alerta.nivel === "critico" ? "border-[#e3b6b0]" : "border-[#f3dcb4]"}`}><span className="min-w-0"><span className="block font-semibold">{alerta.titulo}</span><span className="block truncate text-xs text-muted-foreground">{alerta.detalhe}</span></span><Badge className={`shrink-0 border-0 ${alerta.nivel === "critico" ? "bg-[#fbeceb] text-[#b3382c]" : "bg-[#fff3df] text-[#7a4d0a]"} hover:bg-inherit`}>{alerta.quantidade}</Badge></Link></li>)}</ul>
    </section>}
    {isAdmin && data && data.alertas.length === 0 && <p className="mb-5 flex items-center gap-2 rounded-2xl bg-[#eef7f1] px-4 py-3 text-sm text-[#0a7048]"><CheckCircle2 className="h-4 w-4" />Nenhum alerta: nada aguardando aprovação, pesagem, resgate ou estoque.</p>}

    <section aria-label="Indicadores da operação" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{metrics.map((metric) => { const Icon = metric.icon; return <article key={metric.label} className="rounded-[22px] border border-[#dce8e0] bg-white p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.42)]"><div className="flex items-start justify-between gap-3"><p className="text-sm font-medium text-muted-foreground">{metric.label}</p><span className={`grid h-9 w-9 place-items-center rounded-xl ${tones[metric.tone as keyof typeof tones]}`}><Icon className="h-[18px] w-[18px]" /></span></div>{isLoading ? <span className="mt-6 block h-9 w-24 animate-pulse rounded-lg bg-[#edf3ef]" /> : <p className="mt-6 text-[30px] font-bold tracking-[-0.05em] text-foreground">{metric.value}</p>}<p className="mt-1 text-xs leading-5 text-muted-foreground">{metric.helper}</p></article>; })}</section>

    <section aria-label="Comparação e pontos" className="mt-5 grid gap-4 md:grid-cols-3">
      <article className={cartao}>
        <p className="flex items-center gap-2 text-sm font-semibold"><TrendingUp className="h-4 w-4 text-[#0f7350]" />{data ? `${data.comparacao.atual.rotulo} x ${data.comparacao.anterior.rotulo}` : "Mês atual x anterior"}</p>
        {isLoading ? <span className="mt-4 block h-16 animate-pulse rounded-xl bg-[#edf3ef]" /> : data && <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-xs text-muted-foreground">Peso confirmado</dt><dd className="text-xl font-bold">{formatarNumero(data.comparacao.atual.kg)} kg</dd><dd className="text-xs text-muted-foreground">antes {formatarNumero(data.comparacao.anterior.kg)} kg · <Variacao valor={data.comparacao.variacaoKg} /></dd></div>
          <div><dt className="text-xs text-muted-foreground">Coletas concluídas</dt><dd className="text-xl font-bold">{data.comparacao.atual.coletas}</dd><dd className="text-xs text-muted-foreground">antes {data.comparacao.anterior.coletas} · <Variacao valor={data.comparacao.variacaoColetas} /></dd></div>
        </dl>}
      </article>
      <article className={cartao}>
        <p className="flex items-center gap-2 text-sm font-semibold"><CheckCircle2 className="h-4 w-4 text-[#0f7350]" />Taxa de conclusão</p>
        {isLoading ? <span className="mt-4 block h-16 animate-pulse rounded-xl bg-[#edf3ef]" /> : data && <>
          <p className="mt-3 text-[30px] font-bold tracking-[-0.05em]">{data.taxaConclusao.percentual === null ? "—" : `${formatarNumero(data.taxaConclusao.percentual, 1)}%`}</p>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-[#edf3ef]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={data.taxaConclusao.percentual ?? 0} aria-label="Taxa de conclusão"><span className="block h-full rounded-full bg-[#0f7350]" style={{ width: `${data.taxaConclusao.percentual ?? 0}%` }} /></div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">{data.taxaConclusao.concluidas} de {data.taxaConclusao.total} com desfecho ou data vencida · {data.taxaConclusao.atrasadas} aguardando pesagem · {data.taxaConclusao.canceladas} cancelada(s) · {data.taxaConclusao.reprovadas} reprovada(s)</p>
        </>}
      </article>
      <article className={cartao}>
        <p className="flex items-center gap-2 text-sm font-semibold"><Coins className="h-4 w-4 text-[#7a4d0a]" />{isAdmin ? "Pontos movimentados no mês" : "Seus pontos no mês"}</p>
        {isLoading ? <span className="mt-4 block h-16 animate-pulse rounded-xl bg-[#edf3ef]" /> : data && <>
          <p className="mt-3 text-[30px] font-bold tracking-[-0.05em]">{isAdmin ? data.pontosMes.movimentados : `${data.saldo ?? 0} pts`}</p>
          <p className="text-xs text-muted-foreground">{isAdmin ? "entradas e saídas somadas" : "saldo atual"}</p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground"><span className="font-semibold text-[#0a7048]">+{data.pontosMes.distribuidos} ganhos</span> · <span className="font-semibold text-[#b3382c]">-{data.pontosMes.estornados} estornados</span> · -{data.pontosMes.resgatados} em resgates{data.pontosMes.devolvidos ? ` · +${data.pontosMes.devolvidos} devolvidos` : ""}</p>
        </>}
      </article>
    </section>

    <section className="mt-5 grid gap-5 xl:grid-cols-2">
      <article className={`${cartao} min-h-[330px]`}><div className="flex items-start justify-between gap-4"><div><p className="text-base font-semibold tracking-[-0.025em]">Evolução das coletas</p><p className="mt-1 text-sm text-muted-foreground">Peso confirmado e coletas concluídas nos últimos 6 meses.</p></div><Badge variant="outline" className="border-[#dce8e0] bg-[#f8fbf9] text-xs font-medium text-muted-foreground">6 meses</Badge></div>{isLoading ? <span className="mt-5 block h-[230px] animate-pulse rounded-2xl bg-[#f3f7f4]" /> : temEvolucao ? <div className="mt-5 h-[230px]" role="img" aria-label={`Evolução mensal: ${evolucao.map((item) => `${item.mes} ${formatarNumero(item.kg)} kg em ${item.coletas} coletas`).join("; ")}`}><ResponsiveContainer width="100%" height="100%"><LineChart data={evolucao} margin={{ top: 12, right: 8, left: -20, bottom: 0 }}><CartesianGrid stroke="#edf3ef" vertical={false} /><XAxis dataKey="mes" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#6b7e74" }} /><YAxis yAxisId="kg" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#6b7e74" }} tickFormatter={(value) => formatarNumero(Number(value))} /><YAxis yAxisId="coletas" orientation="right" axisLine={false} tickLine={false} allowDecimals={false} tick={{ fontSize: 11, fill: "#9aa9a1" }} /><Tooltip contentStyle={{ borderRadius: 14, border: "1px solid #dce8e0", fontSize: 12 }} formatter={(value, nome) => (nome === "kg" ? [`${formatarNumero(Number(value))} kg`, "Peso"] : [value, "Coletas"])} /><Line yAxisId="kg" type="monotone" dataKey="kg" stroke="#0f7350" strokeWidth={2.5} dot={{ r: 3 }} /><Line yAxisId="coletas" type="monotone" dataKey="coletas" stroke="#c99a2e" strokeWidth={2} strokeDasharray="4 3" dot={{ r: 2.5 }} /></LineChart></ResponsiveContainer></div> : <EmptyChart texto="A evolução aparece depois das primeiras coletas concluídas." />}</article>
      <article className={`${cartao} min-h-[330px]`}><div className="flex items-start justify-between gap-4"><div><p className="text-base font-semibold tracking-[-0.025em]">Resíduos por categoria</p><p className="mt-1 text-sm text-muted-foreground">Peso confirmado de cada categoria, desde o início.</p></div><Badge variant="outline" className="border-[#dce8e0] bg-[#f8fbf9] text-xs font-medium text-muted-foreground">Dados ao vivo</Badge></div>{isLoading ? <span className="mt-5 block h-[230px] animate-pulse rounded-2xl bg-[#f3f7f4]" /> : hasData ? <div className="mt-5 h-[230px]" role="img" aria-label={`Peso por categoria: ${chartData.map((item) => `${item.name} ${formatarNumero(item.kg)} kg`).join("; ")}`}><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} margin={{ top: 12, right: 5, left: -24, bottom: 0 }}><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#6b7e74" }} /><YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#6b7e74" }} tickFormatter={(value) => formatarNumero(Number(value))} /><Tooltip cursor={{ fill: "#edf7f1" }} contentStyle={{ borderRadius: 14, border: "1px solid #dce8e0", fontSize: 12 }} formatter={(value) => [`${formatarNumero(Number(value))} kg`, "Volume"]} /><Bar dataKey="kg" fill="#0f7350" radius={[8, 8, 2, 2]} /></BarChart></ResponsiveContainer></div> : <EmptyChart texto="Registre a primeira coleta concluída para iniciar a leitura do desempenho ambiental do condomínio." />}</article>
    </section>

    <section className="mt-5 grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
      <article className={cartao}>
        <div className="flex items-center justify-between gap-3"><p className="flex items-center gap-2 text-base font-semibold tracking-[-0.025em]"><Medal className="h-5 w-5 text-[#c99a2e]" />Top 3 do mês</p><Link href="/podio" className="text-sm font-semibold text-[#0f7350] hover:underline">Ver pódio</Link></div>
        {isLoading ? <span className="mt-4 block h-24 animate-pulse rounded-2xl bg-[#f3f7f4]" /> : data?.top3.length ? <ol className="mt-4 grid gap-2 sm:grid-cols-3">{data.top3.map((linha, indice) => <li key={`${linha.position}-${indice}`} className={`rounded-2xl border p-3 text-center ${linha.voce ? "border-[#0f7350]/40 bg-[#f1f8f4]" : "border-[#e0ebe4] bg-[#fbfdfc]"}`}><span className="mx-auto grid h-8 w-8 place-items-center rounded-full text-xs font-bold text-white" style={{ backgroundColor: medalha[linha.position - 1] }}>{linha.position}º</span><p className="mt-2 truncate text-sm font-semibold">{linha.nome}{linha.voce ? " (você)" : ""}</p><p className="text-xs text-muted-foreground">Bloco {linha.bloco} · {linha.pontos} pts · {formatarNumero(linha.pesoKg)} kg</p></li>)}</ol> : <p className="mt-4 rounded-2xl bg-[#f8fbf9] p-4 text-sm text-muted-foreground">Ninguém pontuou neste mês ainda.</p>}
        {!isAdmin && data && <p className="mt-3 text-xs text-muted-foreground">{data.minhaPosicao ? `Sua posição no mês: ${data.minhaPosicao}º de ${data.totalNoRanking}. Só você vê a sua posição.` : "Você ainda não pontuou neste mês."}</p>}
      </article>
      <article className="rounded-[24px] border border-[#dce8e0] bg-[linear-gradient(145deg,#0d5c43,#0b382b)] p-6 text-white shadow-[0_18px_40px_-24px_rgba(4,66,42,.65)]"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/12"><Sprout className="h-5 w-5" /></span><p className="mt-5 text-[11px] font-bold tracking-[0.14em] text-[#bfe7cf] uppercase">Próximo passo</p><h2 className="mt-2 text-xl font-bold tracking-[-0.04em]">{hasCompleted ? "Acompanhe o pódio do período." : isAdmin ? "Estruture a primeira coleta." : "Registre sua primeira reciclagem."}</h2><p className="mt-3 text-sm leading-6 text-[#d7ece0]">{hasCompleted ? (isAdmin ? "As coletas concluídas já geram pontos. Veja quem lidera o mês, defina os prêmios e registre a entrega aos três primeiros." : "Recicláveis registrados na estação de pesagem valem 1 ponto por kg completo. Veja o top 3 do mês e a sua posição no ranking.") : isAdmin ? "Defina tipo de resíduo, bloco, data e horário. Ao concluir, o EcoCondo atualiza os indicadores e a pontuação." : "Gere o código na página Coletas e use a estação de pesagem. Seus registros entram nos indicadores, e os recicláveis somam pontos."}</p><Button asChild variant="secondary" className="mt-6 h-10 rounded-xl border-0 bg-white px-4 text-sm font-semibold text-[#0b533a] hover:bg-[#e8f4ed]"><Link href={hasCompleted ? "/podio" : "/coletas"}>{hasCompleted ? "Ver pódio" : "Ir para coletas"} <ArrowRight className="ml-2 h-4 w-4" /></Link></Button></article>
    </section>

    <section className={`mt-5 ${cartao}`}><div className="flex items-center justify-between"><div><p className="text-base font-semibold tracking-[-0.025em]">Atividades recentes</p><p className="mt-1 text-sm text-muted-foreground">Últimas coletas registradas na sua área de acesso.</p></div><Link href="/coletas" className="text-sm font-semibold text-[#0f7350] hover:underline">Ver histórico</Link></div>{isLoading ? <span className="mt-5 block h-24 animate-pulse rounded-2xl bg-[#f3f7f4]" /> : data?.recent?.length ? <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{data.recent.map((record) => <article key={record.id} className="rounded-2xl border border-[#e1ebe5] bg-[#fbfdfc] p-4"><div className="flex items-center justify-between"><Badge className="border-0 bg-[#edf7f1] text-[10px] font-bold tracking-[.06em] text-[#0a7048] hover:bg-[#edf7f1]">{labels[record.tipoResiduo]}</Badge><span className="text-[11px] text-muted-foreground">{record.aprovacaoPesoStatus === "rejeitado" ? "Reprovada" : record.pendenteAprovacaoPeso ? "Em revisão" : statusLabels[record.status] ?? record.status}</span></div><p className="mt-4 text-sm font-semibold">Bloco {record.bloco}</p><p className="mt-1 text-xs text-muted-foreground">{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(record.agendadaPara)}</p></article>)}</div> : <p className="mt-5 rounded-2xl bg-[#f8fbf9] p-4 text-sm text-muted-foreground">As atividades recentes aparecerão aqui assim que as coletas forem registradas.</p>}</section>
  </div>;
}

function EmptyChart({ texto }: { texto: string }) {
  return <div className="mt-8 grid h-[200px] place-items-center rounded-2xl border border-dashed border-[#cfe1d7] bg-[#fbfdfc] px-6 text-center"><div><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#e8f4ed] text-[#0f7350]"><BarChart3 className="h-5 w-5" /></span><p className="mt-4 text-sm font-semibold">Os gráficos aparecerão aqui.</p><p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{texto}</p></div></div>;
}

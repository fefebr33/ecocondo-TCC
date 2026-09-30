import PageIntro from "@/components/PageIntro";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { formatarNumero } from "@/lib/utils";
import { AlertTriangle, CalendarClock, Coins, Download, FileSpreadsheet, FileText, Gift, Leaf, Medal, ShieldCheck, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { corDoTipo, estiloSituacao, rotuloResiduo, rotuloSituacao, TIPOS_RESIDUO, type SituacaoDescarte } from "@/lib/descarte";
import { toast } from "sonner";

const wasteOptions = ["todos", "reciclavel", "organico", "rejeito", "eletronico", "perigoso"] as const;
type WasteFilter = (typeof wasteOptions)[number];
const planilhas = [
  { value: "coletas" as const, label: "Descartes", descricao: "uma linha por tipo de cada descarte, com peso, situação e pontos" },
  { value: "pontos" as const, label: "Extrato de pontos", descricao: "todas as entradas e saídas de pontos" },
  { value: "resgates" as const, label: "Resgates de prêmios", descricao: "pedidos, status e pontos gastos" },
  { value: "auditoria" as const, label: "Auditoria", descricao: "quem fez o quê, quando, com valores e motivo" },
];
type Planilha = (typeof planilhas)[number]["value"];
// min-w-0: dentro do grid, o cartão não cresce junto com a tabela larga (ela rola por dentro, sem a página deslizar no celular).
const cartao = "min-w-0 rounded-2xl border border-[#e0ebe4] p-5";
const dica = { borderRadius: 14, border: "1px solid #dce8e0", fontSize: 12, background: "var(--card)", color: "var(--card-foreground)" };
const eixo = { fontSize: 11, fill: "#6b7e74" };
const coresSituacao: Record<SituacaoDescarte, string> = { aprovado: "#0f7350", pendente: "#d99a2b", reprovado: "#c2493c", auditoria: "#7a5bc4", cancelado: "#9aa9a1" };

export default function Reports() {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [bloco, setBloco] = useState("todos");
  const [csvWasteType, setCsvWasteType] = useState<WasteFilter>("todos");
  const [planilha, setPlanilha] = useState<Planilha>("coletas");
  const period = useMemo(() => ({ startDate: start ? new Date(`${start}T00:00:00`) : undefined, endDate: end ? new Date(`${end}T23:59:59`) : undefined, block: bloco === "todos" ? undefined : bloco }), [start, end, bloco]);
  const csvFilters = useMemo(() => ({ ...period, kind: planilha, block: planilha === "coletas" ? period.block : undefined, wasteType: planilha === "coletas" && csvWasteType !== "todos" ? csvWasteType : undefined }), [period, csvWasteType, planilha]);
  const { data, isLoading, error } = trpc.relatorios.visaoGeral.useQuery(period);
  const blocos = trpc.relatorios.blocos.useQuery();
  const cores = Object.fromEntries((trpc.guias.listar.useQuery().data ?? []).map((guia) => [guia.tipoResiduo, guia.corSaco]));
  const situacoes = data ? (Object.entries(data.porSituacao) as [SituacaoDescarte, number][]).filter(([, total]) => total > 0).map(([situacao, total]) => ({ situacao, nome: rotuloSituacao[situacao], total })) : [];
  const exportPdf = trpc.relatorios.exportarPdf.useMutation({ onSuccess: (file) => { const binary = atob(file.contentBase64); const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0)); const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.filename; anchor.click(); URL.revokeObjectURL(url); toast.success("Relatório PDF preparado para download."); }, onError: (issue) => toast.error(issue.message) });
  const exportCsv = trpc.relatorios.exportarCsv.useMutation({ onSuccess: (file) => { const url = URL.createObjectURL(new Blob([file.content], { type: "text/csv;charset=utf-8" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.filename; anchor.click(); URL.revokeObjectURL(url); toast.success("Planilha preparada para download. Ela abre direto no Excel."); }, onError: (issue) => toast.error(issue.message) });
  const annualReports = trpc.relatorios.anuais.useQuery();
  const cards = [
    { label: "Total descartado (aprovado)", value: data ? `${formatarNumero(data.totalKg)} kg` : "—", helper: data ? `${data.porSituacao.aprovado} descarte(s) aprovado(s)` : "", icon: FileText },
    { label: "Taxa de reciclagem", value: data?.recyclingRate === null || data?.recyclingRate === undefined ? "—" : `${formatarNumero(data.recyclingRate, 1)}%`, helper: "recicláveis sobre o total", icon: Leaf },
    { label: "Participação", value: data?.participationRate === null || data?.participationRate === undefined ? "—" : `${formatarNumero(data.participationRate, 1)}%`, helper: data ? `${data.participantsCount} de ${data.residentsCount} morador(es)` : "", icon: UsersRound },
  ];
  const planilhaAtual = planilhas.find((item) => item.value === planilha)!;
  return <div><PageIntro eyebrow="Análise ambiental" title="Relatórios" description="Desempenho ambiental, participação, pontos, prêmios e auditoria, com gráficos por bloco, por mês e por tipo. Escolha o período e o bloco." action={<Button onClick={() => exportPdf.mutate(period)} title={bloco === "todos" ? "PDF de todos os blocos" : `PDF só do bloco ${bloco}`} disabled={exportPdf.isPending} className="h-10 rounded-xl bg-[#0f7350] font-semibold text-white hover:bg-[#0a6243]"><Download className="mr-2 h-4 w-4" />{exportPdf.isPending ? "Gerando PDF..." : "Exportar PDF"}</Button>} />
    <section className="rounded-[24px] border border-[#dce8e0] bg-white p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.35)] sm:p-6">
      <div className="flex flex-col gap-4 border-b border-[#e6eee9] pb-5 md:flex-row md:items-end md:justify-between"><div><p className="text-base font-semibold">Período e bloco do relatório</p><p className="mt-1 text-sm text-muted-foreground">Filtram os indicadores, o PDF e a planilha de descartes. Sem datas, vale todo o histórico.</p></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><label className="col-span-2 grid gap-1 text-[11px] font-bold tracking-[.08em] text-muted-foreground uppercase sm:col-span-1">Bloco<Select value={bloco} onValueChange={setBloco}><SelectTrigger className="h-10 min-w-[140px] rounded-xl bg-[#fbfdfc] text-sm font-medium normal-case tracking-normal text-foreground"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todos">Todos os blocos</SelectItem>{(blocos.data ?? []).map((item) => <SelectItem key={item} value={item}>Bloco {item}</SelectItem>)}</SelectContent></Select></label><label className="grid gap-1 text-[11px] font-bold tracking-[.08em] text-muted-foreground uppercase">De<Input type="date" value={start} onChange={(event) => setStart(event.target.value)} className="h-10 rounded-xl bg-[#fbfdfc]" /></label><label className="grid gap-1 text-[11px] font-bold tracking-[.08em] text-muted-foreground uppercase">Até<Input type="date" value={end} onChange={(event) => setEnd(event.target.value)} className="h-10 rounded-xl bg-[#fbfdfc]" /></label></div></div>

      {error ? <p role="alert" className="py-12 text-center text-sm text-destructive">Não foi possível carregar o relatório: {error.message}</p> : <>
        <div className="mt-5 grid gap-4 md:grid-cols-3">{cards.map((card) => { const Icon = card.icon; return <article key={card.label} className="rounded-2xl border border-[#e0ebe4] bg-[#fbfdfc] p-5"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e8f4ed] text-[#0f7350]"><Icon className="h-5 w-5" /></span><p className="mt-5 text-sm text-muted-foreground">{card.label}</p><p className="mt-1 text-2xl font-bold tracking-[-.05em]">{isLoading ? "…" : card.value}</p><p className="text-xs text-muted-foreground">{card.helper}</p></article>; })}</div>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <article className={cartao}>
            <p className="flex items-center gap-2 font-semibold"><Coins className="h-4 w-4 text-[#7a4d0a]" />Pontos no período</p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div><dt className="text-xs text-muted-foreground">Distribuídos</dt><dd className="font-bold text-[#0a7048]">{isLoading ? "…" : `+${data?.pontos.distribuidos ?? 0}`}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Estornados</dt><dd className="font-bold text-[#b3382c]">{isLoading ? "…" : `-${data?.pontos.estornados ?? 0}`}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Gastos em resgates</dt><dd className="font-bold">{isLoading ? "…" : `-${data?.pontos.resgatados ?? 0}`}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Devolvidos</dt><dd className="font-bold">{isLoading ? "…" : `+${data?.pontos.devolvidos ?? 0}`}</dd></div>
            </dl>
          </article>
          <article className={cartao}>
            <p className="flex items-center gap-2 font-semibold"><Gift className="h-4 w-4 text-[#7a4d0a]" />Resgates de prêmios</p>
            <p className="mt-3 text-2xl font-bold tracking-[-.05em]">{isLoading ? "…" : data?.resgates.total ?? 0}</p>
            <p className="text-xs text-muted-foreground">{data ? `${data.resgates.entregues} entregue(s) · ${data.resgates.pendentes} pendente(s) · ${data.resgates.cancelados} cancelado(s)` : ""}</p>
            {data?.resgates.porRecompensa.length ? <ul className="mt-3 grid gap-1 text-xs">{data.resgates.porRecompensa.slice(0, 4).map((item) => <li key={item.titulo} className="flex justify-between gap-2"><span className="truncate">{item.titulo}</span><span className="shrink-0 text-muted-foreground">{item.quantidade}x · {item.pontos} pts</span></li>)}</ul> : null}
          </article>
          <article className={cartao}>
            <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4 text-[#b45522]" />Aprovação e auditoria</p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div><dt className="text-xs text-muted-foreground">Pendentes de aprovação</dt><dd className="font-bold">{isLoading ? "…" : data?.porSituacao.pendente ?? 0}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Ocorrências ambientais</dt><dd className="font-bold">{isLoading ? "…" : data?.environmentalIncidents ?? 0}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Descartes reprovados</dt><dd className="font-bold">{isLoading ? "…" : data?.porSituacao.reprovado ?? 0}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Em auditoria</dt><dd className="font-bold">{isLoading ? "…" : data?.porSituacao.auditoria ?? 0}</dd></div>
            </dl>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" />{data?.auditEvents ?? 0} registro(s) de auditoria no período</p>
          </article>
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
          <article className={cartao}>
            <h2 className="font-semibold">Comparação entre blocos</h2>
            <p className="mt-1 text-xs text-muted-foreground">Quilos aprovados e participação de cada bloco no período.{bloco !== "todos" ? ` Bloco ${bloco} em destaque.` : ""}</p>
            {data?.porBloco.length ? <><div className="mt-4 h-[240px]" role="img" aria-label={`Quilos por bloco: ${data.porBloco.map((linha) => `bloco ${linha.block} ${formatarNumero(linha.kilograms)} kg`).join(", ")}`}>
              <ResponsiveContainer width="100%" height="100%"><BarChart data={data.porBloco} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}><CartesianGrid stroke="#edf3ef" vertical={false} /><XAxis dataKey="block" tickFormatter={(valor) => `Bloco ${valor}`} axisLine={false} tickLine={false} tick={eixo} /><YAxis axisLine={false} tickLine={false} tick={eixo} /><Tooltip contentStyle={dica} formatter={(valor, nome) => [nome === "kilograms" ? `${formatarNumero(Number(valor))} kg` : `${formatarNumero(Number(valor))} kg`, nome === "kilograms" ? "Total aprovado" : "Recicláveis"]} labelFormatter={(valor) => `Bloco ${valor}`} /><Bar dataKey="kilograms" radius={[6, 6, 2, 2]}>{data.porBloco.map((linha) => <Cell key={linha.block} fill={bloco === "todos" || bloco === linha.block ? "#0f7350" : "#b9d8c5"} />)}</Bar><Bar dataKey="recyclableKg" radius={[6, 6, 2, 2]}>{data.porBloco.map((linha) => <Cell key={linha.block} fill={bloco === "todos" || bloco === linha.block ? "#2f8fd8" : "#bcd9ee"} />)}</Bar></BarChart></ResponsiveContainer>
            </div>
            <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[460px] text-left text-xs"><thead className="text-muted-foreground"><tr><th className="py-1.5 font-semibold">Bloco</th><th className="font-semibold">Aprovado</th><th className="font-semibold">Recicláveis</th><th className="font-semibold">Descartes</th><th className="font-semibold">Participação</th><th className="font-semibold">kg por morador</th></tr></thead><tbody className="divide-y divide-[#edf2ef]">{data.porBloco.map((linha) => <tr key={linha.block} className={bloco === linha.block ? "font-semibold text-[#0f7350]" : ""}><td className="py-1.5">Bloco {linha.block}</td><td>{formatarNumero(linha.kilograms)} kg</td><td>{formatarNumero(linha.recyclableKg)} kg</td><td>{linha.descartes}</td><td>{linha.participationRate === null ? "—" : `${formatarNumero(linha.participationRate, 1)}% (${linha.participantes}/${linha.moradores})`}</td><td>{linha.kgPorMorador === null ? "—" : formatarNumero(linha.kgPorMorador)}</td></tr>)}</tbody></table></div></> : <p className="mt-4 rounded-2xl bg-[#f6faf7] p-4 text-sm text-muted-foreground">{isLoading ? "Carregando..." : "Sem descartes no período."}</p>}
          </article>
          <article className={cartao}>
            <h2 className="font-semibold">Situação dos descartes</h2>
            <p className="mt-1 text-xs text-muted-foreground">Aprovados, pendentes, reprovados e em auditoria no período{bloco !== "todos" ? ` (bloco ${bloco})` : ""}.</p>
            {situacoes.length ? <div className="mt-2 h-[190px]" role="img" aria-label={`Situação dos descartes: ${situacoes.map((item) => `${item.nome} ${item.total}`).join(", ")}`}><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={situacoes} dataKey="total" nameKey="nome" innerRadius={48} outerRadius={78} paddingAngle={2}>{situacoes.map((item) => <Cell key={item.situacao} fill={coresSituacao[item.situacao]} aria-label={`${item.nome}: ${item.total}`} />)}</Pie><Tooltip contentStyle={dica} /></PieChart></ResponsiveContainer></div> : <p className="mt-4 text-sm text-muted-foreground">{isLoading ? "Carregando..." : "Sem descartes no período."}</p>}
            <ul className="mt-2 flex flex-wrap gap-1.5">{situacoes.map((item) => <li key={item.situacao}><Badge className={estiloSituacao[item.situacao]}>{item.nome}: {item.total}</Badge></li>)}</ul>
          </article>
        </div>

        <article className={`${cartao} mt-5`}>
          <h2 className="font-semibold">Quilos aprovados por mês e tipo</h2>
          <p className="mt-1 text-xs text-muted-foreground">Últimos 6 meses até o fim do período{bloco !== "todos" ? `, só o bloco ${bloco}` : ""}. As cores são as dos sacos.</p>
          {data?.porMes.some((linha) => Number(linha.descartes) > 0) ? <div className="mt-4 h-[260px]" role="img" aria-label={`Quilos por mês: ${data.porMes.map((linha) => `${linha.mes} ${TIPOS_RESIDUO.map((tipo) => `${rotuloResiduo[tipo]} ${linha[tipo]} kg`).join(", ")}`).join("; ")}`}>
            <ResponsiveContainer width="100%" height="100%"><BarChart data={data.porMes} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}><CartesianGrid stroke="#edf3ef" vertical={false} /><XAxis dataKey="mes" axisLine={false} tickLine={false} tick={eixo} /><YAxis axisLine={false} tickLine={false} tick={eixo} /><Tooltip contentStyle={dica} formatter={(valor, nome) => [`${formatarNumero(Number(valor))} kg`, rotuloResiduo[nome as keyof typeof rotuloResiduo] ?? nome]} /><Legend formatter={(nome) => rotuloResiduo[nome as keyof typeof rotuloResiduo] ?? nome} wrapperStyle={{ fontSize: 11 }} />{TIPOS_RESIDUO.map((tipo) => <Bar key={tipo} dataKey={tipo} stackId="kg" fill={corDoTipo(tipo, cores)} />)}</BarChart></ResponsiveContainer>
          </div> : <p className="mt-4 rounded-2xl bg-[#f6faf7] p-4 text-sm text-muted-foreground">{isLoading ? "Carregando..." : "Sem descartes aprovados nesses meses."}</p>}
        </article>

        <div className="mt-5 grid gap-5 lg:grid-cols-[.9fr_1.1fr]">
          <article className={cartao}><div className="flex items-center gap-2"><Medal className="h-5 w-5 text-[#b47b22]" /><h2 className="font-semibold">Ranking de engajamento</h2></div><p className="mt-1 text-xs text-muted-foreground">Pontos ganhos no período (não o saldo). Visível só para a administração.</p>{data?.ranking.length ? <ol className="mt-4 divide-y divide-[#edf2ef]">{data.ranking.slice(0, 5).map((resident) => <li key={resident.id} className="flex items-center justify-between py-3"><span className="flex items-center gap-3"><b className="grid h-7 w-7 place-items-center rounded-lg bg-[#edf7f1] text-xs text-[#0f7350]">{resident.position}</b><span><span className="block text-sm font-semibold">{resident.name}</span><span className="text-xs text-muted-foreground">Bloco {resident.block}</span></span></span><span className="text-right"><span className="block text-sm font-bold text-[#0f7350]">{resident.points} pts</span><span className="text-xs text-muted-foreground">{formatarNumero(resident.weightKg)} kg</span></span></li>)}</ol> : <p className="mt-5 text-sm leading-6 text-muted-foreground">O ranking aparece quando houver descartes aprovados no período.</p>}</article>
          <article className="rounded-2xl border border-[#e0ebe4] bg-[#f6faf7] p-5"><p className="text-[11px] font-bold tracking-[.12em] text-[#0f7350] uppercase">Metodologia dos indicadores</p><h2 className="mt-2 text-lg font-semibold tracking-[-.03em]">Leitura responsável dos dados</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">Só descartes aprovados pela administração contam; pendentes, reprovados e em auditoria ficam fora. A taxa de reciclagem relaciona o peso de recicláveis ao peso total aprovado. A estimativa de CO₂ evitado usa o fator de 0,75 kg de CO₂e por kg de reciclável, devendo ser tratada como apoio gerencial e ajustada conforme a metodologia local do condomínio.</p><div className="mt-5 flex flex-wrap gap-2"><Badge className="border-0 bg-[#e8f4ed] text-[#0a7048] hover:bg-[#e8f4ed]">{data?.porSituacao.aprovado ?? 0} descartes aprovados</Badge><Badge className="border-0 bg-[#e8f4ed] text-[#0a7048] hover:bg-[#e8f4ed]">{formatarNumero(data?.co2EstimateKg ?? 0, 1)} kg CO₂e estimados</Badge>{data?.pendingReviewCount ? <Badge className="border-0 bg-[#fff3df] text-[#7a4d0a] hover:bg-[#fff3df]">{data.pendingReviewCount} aguardando aprovação</Badge> : null}</div></article>
        </div>
      </>}
    </section>

    <section className="mt-6 rounded-[24px] border border-[#dce8e0] bg-white p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.35)] sm:p-6">
      <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e8f4ed] text-[#0f7350]"><FileSpreadsheet className="h-5 w-5" /></span><div><p className="font-semibold">Planilhas (CSV para Excel)</p><p className="text-sm text-muted-foreground">Mesmo período do relatório. O arquivo abre direto no Excel ou no Google Planilhas, com acentos e vírgula decimal.</p></div></div>
      <div className="mt-4 grid gap-3 md:grid-cols-[1.2fr_1fr_1fr_auto] md:items-end">
        <label className="grid gap-1 text-[11px] font-bold tracking-[.08em] text-muted-foreground uppercase">Planilha<Select value={planilha} onValueChange={(value) => setPlanilha(value as Planilha)}><SelectTrigger className="h-10 rounded-xl bg-white text-sm font-medium normal-case tracking-normal text-foreground"><SelectValue /></SelectTrigger><SelectContent>{planilhas.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></label>
        <p className="grid gap-1 text-[11px] font-bold tracking-[.08em] text-muted-foreground uppercase">Bloco<span className="flex h-10 items-center rounded-xl border border-[#dce8e0] bg-[#fbfdfc] px-3 text-sm font-medium normal-case tracking-normal text-foreground">{bloco === "todos" ? "Todos os blocos" : `Bloco ${bloco}`}</span></p>
        <label className="grid gap-1 text-[11px] font-bold tracking-[.08em] text-muted-foreground uppercase">Categoria<Select value={csvWasteType} disabled={planilha !== "coletas"} onValueChange={(value) => setCsvWasteType(value as WasteFilter)}><SelectTrigger className="h-10 rounded-xl bg-white text-sm font-medium normal-case tracking-normal text-foreground"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todos">Todas as categorias</SelectItem><SelectItem value="reciclavel">Reciclável</SelectItem><SelectItem value="organico">Orgânico</SelectItem><SelectItem value="rejeito">Rejeito</SelectItem><SelectItem value="eletronico">Eletrônico</SelectItem><SelectItem value="perigoso">Perigoso</SelectItem></SelectContent></Select></label>
        <Button variant="outline" onClick={() => exportCsv.mutate(csvFilters)} disabled={exportCsv.isPending} className="h-10 rounded-xl border-[#c9ddd0] bg-white font-semibold text-[#0d6747] hover:bg-[#edf7f1]"><FileSpreadsheet className="mr-2 h-4 w-4" />{exportCsv.isPending ? "Gerando..." : "Baixar planilha"}</Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{planilhaAtual.label}: {planilhaAtual.descricao}. O bloco é o escolhido no topo da página.{planilha !== "coletas" ? " Bloco e categoria valem só para a planilha de descartes." : ""}</p>
    </section>

    <section className="mt-6 rounded-[24px] border border-[#dce8e0] bg-white p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.35)] sm:p-6">
      <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e8f4ed] text-[#0f7350]"><CalendarClock className="h-5 w-5" /></span><div><p className="font-semibold">Relatório anual automático</p><p className="text-sm text-muted-foreground">Gerado e notificado automaticamente ao síndico todo mês de janeiro, consolidando o ano anterior.</p></div></div>
      <div className="mt-4 grid gap-2">
        {annualReports.data?.length ? annualReports.data.map((item) => (
          <a key={item.id} href={item.urlArquivo} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 rounded-2xl border border-[#e5eee8] bg-[#fbfdfc] px-4 py-3 text-sm hover:border-[#0f7350]">
            <span className="font-semibold">Relatório anual {item.ano}</span>
            <Badge className="border-0 bg-[#e8f4ed] text-[#0a7048] hover:bg-[#e8f4ed]"><Download className="mr-1.5 h-3.5 w-3.5" />Baixar PDF</Badge>
          </a>
        )) : <p className="rounded-2xl bg-[#f6faf7] p-5 text-sm leading-6 text-muted-foreground">O primeiro relatório anual será gerado automaticamente em janeiro, assim que houver dados do ano anterior.</p>}
      </div>
    </section>
  </div>;
}

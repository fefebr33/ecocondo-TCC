import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { History, Search, ShieldCheck, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import PageIntro from "@/components/PageIntro";

const entityLabels = { coleta: "Coleta", ocorrencia: "Ocorrência" } as const;

function formatDate(value: Date) {
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default function Audit() {
  const [entityType, setEntityType] = useState<"todas" | "coleta" | "ocorrencia">("todas");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const filters = useMemo(() => ({
    entityType: entityType === "todas" ? undefined : entityType,
    startDate: start ? new Date(`${start}T00:00:00`) : undefined,
    endDate: end ? new Date(`${end}T23:59:59`) : undefined,
    limit: 50,
  }), [entityType, start, end]);
  const { data, isLoading, error } = trpc.audit.list.useQuery(filters);

  return (
    <div>
      <PageIntro
        eyebrow="Governança operacional"
        title="Histórico de auditoria"
        description="Acompanhe quem criou ou alterou coletas e ocorrências. Os registros preservam o estado anterior e posterior das ações críticas."
        action={<span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#e7f4ed] text-[#0f7350]"><ShieldCheck className="h-5 w-5" /></span>}
      />
      <section className="rounded-[24px] border border-[#dce8e0] bg-white p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.35)] sm:p-6">
        <div className="flex flex-col gap-4 border-b border-[#e6eee9] pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-base font-semibold">Ações recentes</h2>
            <p className="mt-1 text-sm text-muted-foreground">São exibidos até cinquenta eventos do condomínio, em ordem decrescente.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-[11px] font-bold tracking-[.08em] text-muted-foreground uppercase">Entidade
              <Select value={entityType} onValueChange={(value) => setEntityType(value as "todas" | "coleta" | "ocorrencia")}><SelectTrigger className="h-10 min-w-[150px] rounded-xl bg-[#fbfdfc]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todas">Todas</SelectItem><SelectItem value="coleta">Coletas</SelectItem><SelectItem value="ocorrencia">Ocorrências</SelectItem></SelectContent></Select>
            </label>
            <label className="grid gap-1 text-[11px] font-bold tracking-[.08em] text-muted-foreground uppercase">De<Input type="date" value={start} onChange={(event) => setStart(event.target.value)} className="h-10 rounded-xl bg-[#fbfdfc]" /></label>
            <label className="grid gap-1 text-[11px] font-bold tracking-[.08em] text-muted-foreground uppercase">Até<Input type="date" value={end} onChange={(event) => setEnd(event.target.value)} className="h-10 rounded-xl bg-[#fbfdfc]" /></label>
          </div>
        </div>
        {error ? <p className="py-12 text-center text-sm text-destructive">{error.message}</p> : isLoading ? <p className="py-12 text-center text-sm text-muted-foreground">Carregando registros de auditoria...</p> : data?.length ? (
          <ol className="mt-5 space-y-3" aria-label="Registros de auditoria">
            {data.map((entry) => <li key={entry.id} className="rounded-2xl border border-[#e1ebe5] bg-[#fbfdfc] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="flex gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#e8f4ed] text-[#0f7350]"><History className="h-4 w-4" /></span><div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{entry.summary}</p><Badge className="border-0 bg-[#edf4ef] text-[10px] text-[#0d6647] hover:bg-[#edf4ef]">{entityLabels[entry.entityType]}</Badge></div><p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><UserRound className="h-3.5 w-3.5" />{entry.actorName} · {formatDate(entry.createdAt)}</p></div></div><span className="text-xs font-medium text-muted-foreground">#{entry.entityId}</span></div>
              {(entry.beforeState || entry.afterState) && <details className="mt-4 rounded-xl border border-[#e5eee8] bg-white px-3 py-2.5 text-xs"><summary className="flex cursor-pointer list-none items-center gap-2 font-semibold text-[#0f7350]"><Search className="h-3.5 w-3.5" />Ver estados registrados</summary><div className="mt-3 grid gap-3 lg:grid-cols-2"><pre className="overflow-auto rounded-lg bg-[#f6faf7] p-3 text-[11px] leading-5 text-foreground"><b>Antes</b>{"\n"}{JSON.stringify(entry.beforeState, null, 2) || "Sem estado anterior."}</pre><pre className="overflow-auto rounded-lg bg-[#f6faf7] p-3 text-[11px] leading-5 text-foreground"><b>Depois</b>{"\n"}{JSON.stringify(entry.afterState, null, 2) || "Sem estado posterior."}</pre></div></details>}
            </li>)}
          </ol>
        ) : <div className="py-14 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#edf7f1] text-[#0f7350]"><History className="h-5 w-5" /></span><p className="mt-4 font-semibold">Nenhuma ação encontrada</p><p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">Quando coletas ou ocorrências forem criadas e atualizadas, seus registros aparecerão aqui.</p></div>}
      </section>
    </div>
  );
}

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, History, Search, ShieldCheck, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import PageIntro from "@/components/PageIntro";

const entityLabels = { coleta: "Descarte", pontos: "Pontos (ajuste, zeragem, punição)", configuracao: "Configuração (regras, guia, avisos)", usuario: "Acesso / senha", ocorrencia: "Ocorrência", desconto_podio: "Desconto do pódio (antigo)", premio_podio: "Prêmio do pódio", estacao: "Estação de pesagem", resgate: "Resgate", recompensa: "Recompensa", pessoa: "Pessoa / perfil", morador: "Cadastro de morador", comunicado: "Comunicado" } as const;
/** Ações que pedem atenção de quem lê a auditoria (reprovação, peso suspeito). */
const acoesDeAlerta = new Set(["coleta_sinalizada_suspeita", "coleta_reprovada", "peso_suspeito_rejeitado", "auditoria_aberta", "punicao_aplicada", "pontos_zerados"]);
type EntityFilter = "todas" | keyof typeof entityLabels;

function formatDate(value: Date) {
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default function Audit() {
  const [entityType, setEntityType] = useState<EntityFilter>("todas");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const filters = useMemo(() => ({
    entityType: entityType === "todas" ? undefined : entityType,
    startDate: start ? new Date(`${start}T00:00:00`) : undefined,
    endDate: end ? new Date(`${end}T23:59:59`) : undefined,
    limit: 50,
  }), [entityType, start, end]);
  const { data, isLoading, error } = trpc.auditoria.listar.useQuery(filters);
  const exportar = trpc.relatorios.exportarCsv.useMutation({ onSuccess: (arquivo) => { const url = URL.createObjectURL(new Blob([arquivo.content], { type: "text/csv;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = arquivo.filename; link.click(); URL.revokeObjectURL(url); toast.success("Auditoria exportada em CSV (abre no Excel)."); }, onError: (issue) => toast.error(issue.message) });

  return (
    <div>
      <PageIntro
        eyebrow="Governança operacional"
        title="Histórico de auditoria"
        description="Cada operação crítica guarda quem fez, quando, o que fez, em qual registro, o valor anterior e o novo e o motivo informado: descartes (aprovações, reprovações, auditorias e punições), estação de pesagem, regras de cada tipo, ajustes e zeragem de pontos, resgates, catálogo de recompensas, prêmios do pódio, cadastros e perfis."
        action={<Button variant="outline" disabled={exportar.isPending} onClick={() => exportar.mutate({ kind: "auditoria", startDate: filters.startDate, endDate: filters.endDate })} className="h-10 rounded-xl border-[#c9ddd0] bg-white font-semibold text-[#0d6747]"><ShieldCheck className="mr-2 h-4 w-4" />{exportar.isPending ? "Gerando..." : "Exportar CSV"}</Button>}
      />
      <section className="rounded-[24px] border border-[#dce8e0] bg-white p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.35)] sm:p-6">
        <div className="flex flex-col gap-4 border-b border-[#e6eee9] pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-base font-semibold">Ações recentes</h2>
            <p className="mt-1 text-sm text-muted-foreground">São exibidos até cinquenta eventos do condomínio, em ordem decrescente.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-[11px] font-bold tracking-[.08em] text-muted-foreground uppercase">Entidade
              <Select value={entityType} onValueChange={(value) => setEntityType(value as EntityFilter)}><SelectTrigger className="h-10 min-w-[150px] rounded-xl bg-[#fbfdfc]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todas">Todas</SelectItem><SelectItem value="coleta">Descartes</SelectItem><SelectItem value="ocorrencia">Ocorrências</SelectItem><SelectItem value="estacao">Estações de pesagem</SelectItem><SelectItem value="premio_podio">Prêmios do pódio</SelectItem><SelectItem value="resgate">Resgates</SelectItem><SelectItem value="recompensa">Recompensas</SelectItem><SelectItem value="pessoa">Pessoas e perfis</SelectItem><SelectItem value="morador">Cadastro de moradores</SelectItem><SelectItem value="comunicado">Comunicados</SelectItem><SelectItem value="pontos">Pontos (ajustes e zeragem)</SelectItem><SelectItem value="configuracao">Configurações e regras</SelectItem><SelectItem value="usuario">Links de acesso</SelectItem><SelectItem value="desconto_podio">Descontos (antigos)</SelectItem></SelectContent></Select>
            </label>
            <label className="grid gap-1 text-[11px] font-bold tracking-[.08em] text-muted-foreground uppercase">De<Input type="date" value={start} onChange={(event) => setStart(event.target.value)} className="h-10 rounded-xl bg-[#fbfdfc]" /></label>
            <label className="grid gap-1 text-[11px] font-bold tracking-[.08em] text-muted-foreground uppercase">Até<Input type="date" value={end} onChange={(event) => setEnd(event.target.value)} className="h-10 rounded-xl bg-[#fbfdfc]" /></label>
          </div>
        </div>
        {error ? <p className="py-12 text-center text-sm text-destructive">{error.message}</p> : isLoading ? <p className="py-12 text-center text-sm text-muted-foreground">Carregando registros de auditoria...</p> : data?.length ? (
          <ol className="mt-5 space-y-3" aria-label="Registros de auditoria">
            {data.map((entry) => { const suspeita = acoesDeAlerta.has(entry.acao); return <li key={entry.id} className={`rounded-2xl border p-4 ${suspeita ? "border-[#f3c98a] bg-[#fff8ec]" : "border-[#e1ebe5] bg-[#fbfdfc]"}`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="flex gap-3"><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${suspeita ? "bg-[#fbe8c6] text-[#7a4d0a]" : "bg-[#e8f4ed] text-[#0f7350]"}`}>{suspeita ? <AlertTriangle className="h-4 w-4" /> : <History className="h-4 w-4" />}</span><div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{entry.resumo}</p><Badge className="border-0 bg-[#edf4ef] text-[10px] text-[#0d6647] hover:bg-[#edf4ef]">{entityLabels[entry.tipoEntidade]}</Badge>{entry.acao === "coleta_sinalizada_suspeita" && <Badge className="border-0 bg-[#fbe8c6] text-[10px] text-[#7a4d0a] hover:bg-[#fbe8c6]">Revisar: registro em conferência</Badge>}</div><p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"><UserRound className="h-3.5 w-3.5" />{entry.actorName} · {formatDate(entry.criadoEm)} · operação <code className="rounded bg-[#eef3f0] px-1">{entry.acao}</code></p>{entry.motivo && <p className="mt-1.5 text-xs"><b className="font-semibold">Motivo / observação:</b> {entry.motivo}</p>}</div></div><span className="text-xs font-medium text-muted-foreground">{entityLabels[entry.tipoEntidade]} #{entry.entidadeId}</span></div>
              {(entry.beforeState || entry.afterState) && <details className="mt-4 rounded-xl border border-[#e5eee8] bg-white px-3 py-2.5 text-xs"><summary className="flex cursor-pointer list-none items-center gap-2 font-semibold text-[#0f7350]"><Search className="h-3.5 w-3.5" />Ver valor anterior e novo</summary><div className="mt-3 grid gap-3 lg:grid-cols-2"><pre className="overflow-auto rounded-lg bg-[#f6faf7] p-3 text-[11px] leading-5 text-foreground"><b>Valor anterior</b>{"\n"}{JSON.stringify(entry.beforeState, null, 2) || "Sem estado anterior."}</pre><pre className="overflow-auto rounded-lg bg-[#f6faf7] p-3 text-[11px] leading-5 text-foreground"><b>Valor novo</b>{"\n"}{JSON.stringify(entry.afterState, null, 2) || "Sem estado posterior."}</pre></div></details>}
            </li>; })}
          </ol>
        ) : <div className="py-14 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#edf7f1] text-[#0f7350]"><History className="h-5 w-5" /></span><p className="mt-4 font-semibold">Nenhuma ação encontrada</p><p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">Quando descartes, ocorrências, estações de pesagem ou entregas de prêmios forem registradas ou alteradas, as ações aparecerão aqui.</p></div>}
      </section>
    </div>
  );
}

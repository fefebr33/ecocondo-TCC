import PageIntro from "@/components/PageIntro";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, CheckCircle2, ImagePlus, KeyRound, PlayCircle, Plus, Recycle, Repeat, RotateCcw, Scale, ScanLine, ShieldQuestion, Trash2, XCircle } from "lucide-react";
import { reduzirFoto } from "@/lib/imagem";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const wasteLabels = { reciclavel: "Reciclável", organico: "Orgânico", rejeito: "Rejeito", eletronico: "Eletrônico", perigoso: "Perigoso" } as const;
const statusLabels = { agendada: "Agendada", em_andamento: "Em andamento", concluida: "Concluída", cancelada: "Cancelada", ocorrencia: "Ocorrência" } as const;
type WasteType = keyof typeof wasteLabels;
type CollectionStatus = keyof typeof statusLabels;
const emptyForm = { wasteType: "reciclavel" as WasteType, block: "A", date: "", time: "09:00", notes: "" };
const emptyConcludeForm = { weightKg: "", imageDataUrl: "" };
const statusSuccess: Record<CollectionStatus, string> = { agendada: "Coleta reagendada.", em_andamento: "Coleta marcada como em andamento.", concluida: "Coleta concluída com sucesso.", cancelada: "Coleta cancelada.", ocorrencia: "Ocorrência registrada na coleta." };
const todayInput = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; };
const weekdayLabels = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const emptyRecurrenceForm = { block: "A", wasteType: "reciclavel" as WasteType, weekday: "2", time: "08:00" };

export default function Collections() {
  const utils = trpc.useUtils();
  const [filters, setFilters] = useState({ wasteType: "", block: "", status: "", startDate: "", endDate: "" });
  const queryInput = useMemo(() => ({ wasteType: filters.wasteType ? filters.wasteType as WasteType : undefined, block: filters.block || undefined, status: filters.status ? filters.status as CollectionStatus : undefined, startDate: filters.startDate ? new Date(`${filters.startDate}T00:00:00`) : undefined, endDate: filters.endDate ? new Date(`${filters.endDate}T23:59:59`) : undefined }), [filters]);
  const { data: records, isLoading, error } = trpc.coletas.listar.useQuery(queryInput);
  const profile = trpc.perfil.meuPerfil.useQuery();
  const isAdmin = profile.data?.role === "administrador";
  const isResident = profile.data?.role === "morador";
  const formRef = useRef<HTMLFormElement>(null);
  const createCollection = trpc.coletas.criar.useMutation({ onSuccess: () => { utils.coletas.listar.invalidate(); toast.success("Coleta agendada com sucesso."); setForm(emptyForm); setResidentCode(""); setResidentFound(null); setIsFormOpen(false); }, onError: (issue) => toast.error(issue.message) });
  const updateStatus = trpc.coletas.atualizarStatus.useMutation({ onSuccess: (result, variables) => { utils.coletas.listar.invalidate(); utils.coletas.listarPendentesAprovacao.invalidate(); toast.success(result.pendingApproval ? "Coleta concluída. Peso acima do padrão: pontos ficarão pendentes de aprovação." : statusSuccess[variables.status]); setConcludeTarget(null); setConcludeForm(emptyConcludeForm); }, onError: (issue) => toast.error(issue.message) });
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [concludeTarget, setConcludeTarget] = useState<number | null>(null);
  const [concludeForm, setConcludeForm] = useState(emptyConcludeForm);
  const [residentCode, setResidentCode] = useState("");
  const [residentFound, setResidentFound] = useState<{ id: number; nome: string; bloco: string; apartamento: string } | null>(null);
  const utilsForLookup = trpc.useUtils();
  const [lookingUp, setLookingUp] = useState(false);
  useEffect(() => { if (isFormOpen) formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [isFormOpen]);
  const pendingApprovals = trpc.coletas.listarPendentesAprovacao.useQuery(undefined, { enabled: isAdmin });
  const decideApproval = trpc.coletas.decidirAprovacaoPeso.useMutation({ onSuccess: () => { utils.coletas.listarPendentesAprovacao.invalidate(); utils.coletas.listar.invalidate(); toast.success("Decisão registrada."); }, onError: (issue) => toast.error(issue.message) });

  const recurrences = trpc.recorrencias.listar.useQuery(undefined, { enabled: isAdmin });
  const [isRecurrenceFormOpen, setIsRecurrenceFormOpen] = useState(false);
  const [recurrenceForm, setRecurrenceForm] = useState(emptyRecurrenceForm);
  const createRecurrence = trpc.recorrencias.criar.useMutation({ onSuccess: () => { utils.recorrencias.listar.invalidate(); toast.success("Regra de recorrência criada."); setRecurrenceForm(emptyRecurrenceForm); setIsRecurrenceFormOpen(false); }, onError: (issue) => toast.error(issue.message) });
  const toggleRecurrence = trpc.recorrencias.alternar.useMutation({ onSuccess: () => utils.recorrencias.listar.invalidate(), onError: (issue) => toast.error(issue.message) });
  const removeRecurrence = trpc.recorrencias.remover.useMutation({ onSuccess: () => { utils.recorrencias.listar.invalidate(); toast.success("Regra removida."); }, onError: (issue) => toast.error(issue.message) });
  function submitRecurrence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createRecurrence.mutate({ block: recurrenceForm.block, wasteType: recurrenceForm.wasteType, weekday: Number(recurrenceForm.weekday), time: recurrenceForm.time });
  }

  async function buscarPorCodigo() {
    if (!residentCode.trim()) return;
    setLookingUp(true);
    try {
      const morador = await utilsForLookup.moradores.porCodigo.fetch({ code: residentCode.trim() });
      setResidentFound(morador);
      setForm((current) => ({ ...current, block: morador.bloco }));
      toast.success(`Morador identificado: ${morador.nome} (Bloco ${morador.bloco} · ${morador.apartamento}).`);
    } catch (issue) {
      setResidentFound(null);
      toast.error(issue instanceof Error ? issue.message : "Código não encontrado.");
    } finally {
      setLookingUp(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!form.date) { toast.error("Informe a data da coleta."); return; } createCollection.mutate({ wasteType: form.wasteType, block: form.block, residentId: residentFound?.id, scheduledAt: new Date(`${form.date}T${form.time}:00`), notes: form.notes || null }); }
  function changeStatus(id: number, status: "em_andamento" | "cancelada" | "ocorrencia") {
    if (status === "cancelada" && !window.confirm("Cancelar esta coleta? Se ela já tiver gerado pontos, eles serão estornados.")) return;
    if (status === "ocorrencia") {
      const reason = window.prompt("Descreva a ocorrência (ex.: lixo misturado, acesso bloqueado):");
      if (reason === null) return;
      updateStatus.mutate({ id, status, notes: reason.trim() || null });
      return;
    }
    updateStatus.mutate({ id, status });
  }
  function removeRecurrenceRule(id: number) { if (window.confirm("Remover esta regra de recorrência? As coletas já geradas continuam no histórico.")) removeRecurrence.mutate({ id }); }
  function openConclude(id: number) { setConcludeTarget(id); setConcludeForm(emptyConcludeForm); }
  function onConcludeImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    reduzirFoto(file).then((imageDataUrl) => setConcludeForm((current) => ({ ...current, imageDataUrl })), (issue) => toast.error(issue instanceof Error ? issue.message : "Não foi possível usar a imagem."));
  }
  function submitConclude(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (concludeTarget === null) return;
    const kilograms = Number(concludeForm.weightKg.replace(",", "."));
    if (!Number.isFinite(kilograms) || kilograms < 0) { toast.error("Informe um peso válido."); return; }
    if (kilograms > 120) { toast.error("O peso máximo por coleta é 120 kg. Divida em coletas separadas se necessário."); return; }
    if (!concludeForm.imageDataUrl) { toast.error("Anexe uma foto da coleta para concluir."); return; }
    updateStatus.mutate({ id: concludeTarget, status: "concluida", weightGrams: Math.round(kilograms * 1000), imageDataUrl: concludeForm.imageDataUrl });
  }

  return <div>
    <PageIntro eyebrow="Operação de coleta" title="Coletas" description="Planeje e registre coletas com rastreabilidade por tipo de resíduo, bloco, período e status." action={<Button onClick={() => setIsFormOpen((open) => !open)} className="h-10 rounded-xl bg-[#0f7350] font-semibold text-white hover:bg-[#0a6243]"><Plus className="mr-2 h-4 w-4" />Nova coleta</Button>} />
    {isResident && <CodigoEstacao />}
    <section className="rounded-[24px] border border-[#dce8e0] bg-white p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.35)] sm:p-6">
      <div className="flex flex-col gap-4 border-b border-[#e6eee9] pb-5 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-base font-semibold tracking-[-.025em]">Histórico operacional</p><p className="mt-1 text-sm text-muted-foreground">Use os filtros para localizar registros e acompanhar o andamento das coletas.</p></div><Button variant="ghost" onClick={() => setFilters({ wasteType: "", block: "", status: "", startDate: "", endDate: "" })} className="h-9 rounded-xl text-sm text-muted-foreground hover:text-[#0f7350]"><RotateCcw className="mr-2 h-3.5 w-3.5" />Limpar filtros</Button></div>{isFormOpen && <form onSubmit={submit} ref={formRef} aria-label="Nova coleta" className="mt-5 grid scroll-mt-24 gap-3 rounded-2xl border border-[#cfe1d7] bg-[#f7fbf8] p-4 md:grid-cols-2">{isAdmin && <div className="grid gap-1.5 text-xs font-semibold md:col-span-2">Código do apartamento (QR)<div className="flex gap-2"><Input value={residentCode} onChange={(event) => { setResidentCode(event.target.value); setResidentFound(null); }} placeholder="Escaneie ou digite o código do morador" className="h-10 rounded-xl bg-white" /><Button type="button" variant="outline" disabled={lookingUp || !residentCode.trim()} onClick={buscarPorCodigo} className="h-10 shrink-0 rounded-xl border-[#cfe1d7] text-[#0f7350]"><ScanLine className="mr-1.5 h-4 w-4" />{lookingUp ? "Buscando..." : "Buscar"}</Button></div>{residentFound && <p className="font-normal text-[#0a7048]">Morador identificado: {residentFound.nome} · Bloco {residentFound.bloco} · {residentFound.apartamento}</p>}</div>}<label className="grid gap-1.5 text-xs font-semibold">Tipo de resíduo<select value={form.wasteType} onChange={(event) => setForm({ ...form, wasteType: event.target.value as WasteType })} className="h-10 rounded-xl border border-[#dce8e0] bg-white px-3 text-sm">{Object.entries(wasteLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="grid gap-1.5 text-xs font-semibold">Bloco{isResident ? <Input readOnly value={profile.data?.resident?.bloco ?? ""} aria-describedby="bloco-morador" className="h-10 rounded-xl bg-[#eef3f0]" /> : <Input required value={form.block} onChange={(event) => setForm({ ...form, block: event.target.value })} className="h-10 rounded-xl bg-white" />}{isResident && <span id="bloco-morador" className="font-normal text-muted-foreground">A coleta é registrada no bloco do seu cadastro.</span>}</label><label className="grid gap-1.5 text-xs font-semibold">Data<Input required type="date" min={todayInput()} value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} className="h-10 rounded-xl bg-white" /></label><label className="grid gap-1.5 text-xs font-semibold">Horário<Input required type="time" value={form.time} onChange={(event) => setForm({ ...form, time: event.target.value })} className="h-10 rounded-xl bg-white" /></label><label className="grid gap-1.5 text-xs font-semibold md:col-span-2">Observações<Input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Informações adicionais sobre a coleta" className="h-10 rounded-xl bg-white" /></label><div className="flex items-end gap-2 md:col-span-2"><Button disabled={createCollection.isPending} className="h-10 rounded-xl bg-[#0f7350] text-white hover:bg-[#0a6243]">{createCollection.isPending ? "Agendando..." : "Agendar coleta"}</Button><Button type="button" variant="ghost" onClick={() => setIsFormOpen(false)} className="h-10 rounded-xl">Cancelar</Button></div></form>}
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5"><label className="grid gap-1.5 text-[11px] font-bold tracking-[.08em] text-muted-foreground uppercase">Tipo<select value={filters.wasteType} onChange={(event) => setFilters({ ...filters, wasteType: event.target.value })} className="h-10 rounded-xl border border-[#dce8e0] bg-[#fbfdfc] px-3 text-sm font-medium outline-none focus:ring-2 focus:ring-[#0f7350]/30"><option value="">Todos</option>{Object.entries(wasteLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="grid gap-1.5 text-[11px] font-bold tracking-[.08em] text-muted-foreground uppercase">Bloco<Input value={filters.block} onChange={(event) => setFilters({ ...filters, block: event.target.value })} placeholder="Ex.: A" className="h-10 rounded-xl bg-[#fbfdfc]" /></label><label className="grid gap-1.5 text-[11px] font-bold tracking-[.08em] text-muted-foreground uppercase">Status<select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })} className="h-10 rounded-xl border border-[#dce8e0] bg-[#fbfdfc] px-3 text-sm font-medium outline-none focus:ring-2 focus:ring-[#0f7350]/30"><option value="">Todos</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="grid gap-1.5 text-[11px] font-bold tracking-[.08em] text-muted-foreground uppercase">De<Input type="date" value={filters.startDate} onChange={(event) => setFilters({ ...filters, startDate: event.target.value })} className="h-10 rounded-xl bg-[#fbfdfc]" /></label><label className="grid gap-1.5 text-[11px] font-bold tracking-[.08em] text-muted-foreground uppercase">Até<Input type="date" value={filters.endDate} onChange={(event) => setFilters({ ...filters, endDate: event.target.value })} className="h-10 rounded-xl bg-[#fbfdfc]" /></label></div>
      
      {error ? <p className="py-12 text-center text-sm text-destructive">{error.message}</p> : isLoading ? <p className="py-12 text-center text-sm text-muted-foreground">Carregando coletas...</p> : !records?.length ? <div className="grid min-h-64 place-items-center text-center"><div><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#e8f4ed] text-[#0f7350]"><Recycle className="h-5 w-5" /></span><p className="mt-4 text-sm font-semibold">Nenhuma coleta encontrada.</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Agende a primeira coleta ou ajuste os filtros para consultar o histórico.</p></div></div> : <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[980px] text-left"><thead><tr className="border-b border-[#e6eee9] text-[11px] font-bold tracking-[.08em] text-muted-foreground uppercase"><th className="px-2 py-4">Tipo / local</th><th className="px-2 py-4">Agendamento</th><th className="px-2 py-4">Morador</th><th className="px-2 py-4">Origem</th><th className="px-2 py-4">Peso</th><th className="px-2 py-4">Status</th><th className="px-2 py-4 text-right">Ação</th></tr></thead><tbody>{records.map((record) => <tr key={record.id} className="border-b border-[#edf2ef] last:border-0"><td className="px-2 py-4"><p className="text-sm font-semibold">{wasteLabels[record.tipoResiduo]}</p><p className="mt-0.5 text-xs text-muted-foreground">Bloco {record.bloco}</p></td><td className="px-2 py-4"><p className="text-sm">{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(record.agendadaPara)}</p></td><td className="px-2 py-4 text-sm text-muted-foreground">{record.residentName || "Sem morador vinculado"}</td><td className="px-2 py-4 text-sm text-muted-foreground">{record.origin}</td><td className="px-2 py-4 text-sm font-semibold text-[#0f7350]">{record.pesoGramas === null ? "—" : `${(record.pesoGramas / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} kg`}{record.urlFoto && <a href={record.urlFoto} target="_blank" rel="noreferrer" className="mt-0.5 block text-xs font-normal text-muted-foreground underline">Ver foto</a>}</td><td className="px-2 py-4"><Badge className={record.status === "concluida" ? "border-0 bg-[#e7f5ec] text-[#0a7048] hover:bg-[#e7f5ec]" : record.status === "ocorrencia" ? "border-0 bg-[#fff0e7] text-[#b45522] hover:bg-[#fff0e7]" : "border-0 bg-[#f0f4f2] text-muted-foreground hover:bg-[#f0f4f2]"}>{statusLabels[record.status]}</Badge></td><td className="px-2 py-4 text-right">{isAdmin && (record.status === "agendada" || record.status === "em_andamento") && <div className="flex flex-wrap justify-end gap-1.5">{record.status === "agendada" && <Button size="sm" variant="ghost" onClick={() => changeStatus(record.id, "em_andamento")} disabled={updateStatus.isPending} className="h-8 rounded-lg text-xs font-semibold text-[#0f7350] hover:bg-[#edf7f1]"><PlayCircle className="mr-1.5 h-3.5 w-3.5" />Iniciar</Button>}<Button size="sm" variant="outline" onClick={() => openConclude(record.id)} disabled={updateStatus.isPending} className="h-8 rounded-lg border-[#cfe1d7] text-xs font-semibold text-[#0f7350] hover:bg-[#edf7f1]"><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Concluir</Button><Button size="sm" variant="ghost" onClick={() => changeStatus(record.id, "ocorrencia")} disabled={updateStatus.isPending} className="h-8 rounded-lg text-xs font-semibold text-[#9a4a1c] hover:bg-[#fff0e7]"><AlertTriangle className="mr-1.5 h-3.5 w-3.5" />Ocorrência</Button><Button size="sm" variant="ghost" onClick={() => changeStatus(record.id, "cancelada")} disabled={updateStatus.isPending} className="h-8 rounded-lg text-xs font-semibold text-destructive hover:bg-[#fbeceb]"><XCircle className="mr-1.5 h-3.5 w-3.5" />Cancelar</Button></div>}</td></tr>)}</tbody></table></div>}
    </section>
    {isAdmin && (
      <section className="mt-5 rounded-[24px] border border-[#f3c98a] bg-[#fff8ec] p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.35)] sm:p-6">
        <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#fbe8c6] text-[#7a4d0a]"><ShieldQuestion className="h-5 w-5" /></span><div><p className="font-semibold">Registros aguardando aprovação</p><p className="text-sm text-muted-foreground">Registros da estação acima de 10 kg, fora do padrão do morador ou sorteados para conferência, e coletas manuais com peso suspeito. Confira a foto da balança antes de aprovar; quem registrou não pode aprovar o próprio lançamento.</p></div></div>
        <div className="mt-4 grid gap-3">
          {pendingApprovals.data?.length ? pendingApprovals.data.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#f3c98a] bg-white p-4">
              <div className="flex items-center gap-3"><AlertTriangle className="h-4 w-4 shrink-0 text-[#7a4d0a]" /><div><p className="text-sm font-semibold">{item.residentName || "Sem morador vinculado"} · Bloco {item.bloco}</p><p className="text-xs text-muted-foreground">{wasteLabels[item.tipoResiduo]} · {item.pesoGramas ? `${(item.pesoGramas / 1000).toLocaleString("pt-BR")} kg` : "—"} · {item.pontosCalculados} ponto(s) pendente(s) · {item.origin}</p>{item.observacoes && <p className="text-xs text-[#7a4d0a]">{item.observacoes}</p>}{item.urlFoto && <a href={item.urlFoto} target="_blank" rel="noreferrer" className="text-xs font-semibold text-[#0f7350] underline">Ver foto da balança</a>}</div></div>
              <div className="flex gap-2">
                <Button size="sm" disabled={decideApproval.isPending} onClick={() => decideApproval.mutate({ id: item.id, aprovar: true })} className="h-8 rounded-lg bg-[#0f7350] text-xs text-white hover:bg-[#0a6243]"><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Aprovar</Button>
                <Button size="sm" variant="outline" disabled={decideApproval.isPending} onClick={() => decideApproval.mutate({ id: item.id, aprovar: false })} className="h-8 rounded-lg border-[#e3b6b0] text-xs text-[#b3382c] hover:bg-[#fbeceb]"><XCircle className="mr-1.5 h-3.5 w-3.5" />Rejeitar</Button>
              </div>
            </div>
          )) : <p className="rounded-2xl bg-white p-5 text-sm leading-6 text-muted-foreground">Nenhum peso pendente de aprovação no momento.</p>}
        </div>
      </section>
    )}
    {isAdmin && (
      <section className="mt-5 rounded-[24px] border border-[#dce8e0] bg-white p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.35)] sm:p-6">
        <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e8f4ed] text-[#0f7350]"><Repeat className="h-5 w-5" /></span><div><p className="font-semibold">Coleta recorrente por bloco</p><p className="text-sm text-muted-foreground">Ex.: "toda terça, bloco B". As coletas do dia são geradas automaticamente, sem precisar agendar uma por uma.</p></div></div><Button variant="outline" onClick={() => setIsRecurrenceFormOpen((open) => !open)} className="h-9 shrink-0 rounded-xl border-[#cfe1d7] text-xs font-semibold text-[#0f7350]"><Plus className="mr-1.5 h-3.5 w-3.5" />Nova regra</Button></div>
        {isRecurrenceFormOpen && <form onSubmit={submitRecurrence} className="mt-4 grid gap-3 rounded-2xl bg-[#f5faf7] p-4 sm:grid-cols-4">
          <label className="grid gap-1.5 text-xs font-semibold">Bloco<Input required value={recurrenceForm.block} onChange={(event) => setRecurrenceForm({ ...recurrenceForm, block: event.target.value })} className="h-10 rounded-xl bg-white" /></label>
          <label className="grid gap-1.5 text-xs font-semibold">Tipo<select value={recurrenceForm.wasteType} onChange={(event) => setRecurrenceForm({ ...recurrenceForm, wasteType: event.target.value as WasteType })} className="h-10 rounded-xl border border-[#dce8e0] bg-white px-3 text-sm">{Object.entries(wasteLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label className="grid gap-1.5 text-xs font-semibold">Dia da semana<select value={recurrenceForm.weekday} onChange={(event) => setRecurrenceForm({ ...recurrenceForm, weekday: event.target.value })} className="h-10 rounded-xl border border-[#dce8e0] bg-white px-3 text-sm">{weekdayLabels.map((label, index) => <option key={label} value={index}>{label}</option>)}</select></label>
          <label className="grid gap-1.5 text-xs font-semibold">Horário<Input required type="time" value={recurrenceForm.time} onChange={(event) => setRecurrenceForm({ ...recurrenceForm, time: event.target.value })} className="h-10 rounded-xl bg-white" /></label>
          <div className="flex items-end gap-2 sm:col-span-4"><Button disabled={createRecurrence.isPending} className="h-10 rounded-xl bg-[#0f7350] text-white hover:bg-[#0a6243]">Criar regra</Button><Button type="button" variant="ghost" onClick={() => setIsRecurrenceFormOpen(false)} className="h-10 rounded-xl">Cancelar</Button></div>
        </form>}
        <div className="mt-4 grid gap-2">
          {recurrences.data?.length ? recurrences.data.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e5eee8] bg-[#fbfdfc] px-4 py-3 text-sm">
              <span><b className="font-semibold">Bloco {item.bloco}</b> · {wasteLabels[item.tipoResiduo]} · toda {weekdayLabels[item.diaSemana].toLowerCase()} às {item.horario}</span>
              <div className="flex items-center gap-2">
                <Badge className={`border-0 ${item.ativo ? "bg-[#e8f4ed] text-[#0a7048]" : "bg-[#f0f4f2] text-muted-foreground"} hover:bg-inherit`}>{item.ativo ? "Ativa" : "Pausada"}</Badge>
                <Button size="sm" variant="ghost" onClick={() => toggleRecurrence.mutate({ id: item.id, isActive: !item.ativo })} className="h-7 rounded-lg text-xs font-semibold text-[#0f7350] hover:bg-[#edf7f1]">{item.ativo ? "Pausar" : "Reativar"}</Button>
                <Button size="sm" variant="ghost" onClick={() => removeRecurrenceRule(item.id)} aria-label={`Remover regra do bloco ${item.bloco}`} className="h-7 rounded-lg text-xs font-semibold text-destructive hover:bg-[#fbeceb]"><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          )) : <p className="rounded-2xl bg-[#f6faf7] p-5 text-sm leading-6 text-muted-foreground">Nenhuma regra de recorrência criada ainda.</p>}
        </div>
      </section>
    )}
    <Dialog open={concludeTarget !== null} onOpenChange={(open) => { if (!open) { setConcludeTarget(null); setConcludeForm(emptyConcludeForm); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Concluir coleta</DialogTitle>
          <DialogDescription>Informe o peso coletado e anexe uma foto como comprovação. A foto é obrigatória para proteger o ranking contra lançamentos indevidos.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submitConclude} className="grid gap-3">
          <label className="grid gap-1.5 text-xs font-semibold">Peso coletado (kg)<Input required type="number" min="0" max="120" step="0.1" value={concludeForm.weightKg} onChange={(event) => setConcludeForm({ ...concludeForm, weightKg: event.target.value })} className="h-10 rounded-xl bg-white" /></label>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-[#b9d8c5] bg-[#f6faf7] px-3 py-3 text-sm text-[#0f7350]"><ImagePlus className="h-4 w-4" />{concludeForm.imageDataUrl ? "Foto pronta para envio" : "Anexar foto da coleta (obrigatório, até 4 MB)"}<input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={onConcludeImageChange} /></label>
          {concludeForm.imageDataUrl && <img src={concludeForm.imageDataUrl} alt="Pré-visualização da foto da coleta" className="max-h-40 w-full rounded-xl border border-[#e2ebe5] object-cover" />}
          <DialogFooter>
            <Button type="submit" disabled={updateStatus.isPending} className="h-10 rounded-xl bg-[#0f7350] text-white hover:bg-[#0a6243]">{updateStatus.isPending ? "Concluindo..." : "Confirmar conclusão"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </div>;
}

/** No celular do morador: gera o código de 6 números para se identificar no tablet da estação de pesagem. */
function CodigoEstacao() {
  const [codigo, setCodigo] = useState<{ code: string; expiresAt: Date } | null>(null);
  const [agora, setAgora] = useState(() => Date.now());
  const gerar = trpc.estacao.gerarCodigo.useMutation({ onSuccess: (dados) => setCodigo(dados), onError: (issue) => toast.error(issue.message) });
  useEffect(() => {
    if (!codigo) return;
    const relogio = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(relogio);
  }, [codigo]);
  const restante = codigo ? Math.max(0, Math.round((new Date(codigo.expiresAt).getTime() - agora) / 1000)) : 0;
  const valido = codigo !== null && restante > 0;
  return <section className="mb-5 rounded-[24px] border border-[#cfe1d7] bg-[#f7fbf8] p-5 sm:p-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#e8f4ed] text-[#0f7350]"><Scale className="h-5 w-5" /></span><div><p className="font-semibold">Registrar reciclagem na estação</p><p className="text-sm leading-6 text-muted-foreground">Leve o material até o tablet ao lado das lixeiras, gere o código aqui e digite no tablet. Depois é só pesar e fotografar o visor da balança.</p></div></div>
      <Button onClick={() => gerar.mutate()} disabled={gerar.isPending} className="h-10 shrink-0 rounded-xl bg-[#0f7350] font-semibold text-white hover:bg-[#0a6243]"><KeyRound className="mr-2 h-4 w-4" />{valido ? "Gerar outro código" : "Gerar código para a estação"}</Button>
    </div>
    {codigo && <div className="mt-4 rounded-2xl border border-[#cfe1d7] bg-white p-4 text-center" aria-live="polite">
      {valido ? <><p className="text-4xl font-bold tracking-[.3em] text-[#0f7350]">{codigo.code}</p><p className="mt-1 text-xs text-muted-foreground">Vale por mais {Math.floor(restante / 60)}:{String(restante % 60).padStart(2, "0")} e só pode ser usado uma vez.</p></> : <p className="text-sm text-muted-foreground">O código venceu. Gere outro quando estiver na estação.</p>}
    </div>}
  </section>;
}

import PageIntro from "@/components/PageIntro";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, Camera, ClipboardCheck, Flag, ImagePlus, Leaf, Target } from "lucide-react";
import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";

const wasteLabels: Record<string, string> = { reciclavel: "Reciclável", organico: "Orgânico", rejeito: "Rejeito", eletronico: "Eletrônico", perigoso: "Perigoso" };
type WasteType = "reciclavel" | "organico" | "rejeito" | "eletronico" | "perigoso";

function dateValue(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function formatDate(value: Date) {
  return new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

export default function Sustainability() {
  const profile = trpc.profile.me.useQuery();
  const utils = trpc.useUtils();
  const isAdmin = profile.data?.role === "administrador";
  const goals = trpc.goals.list.useQuery();
  const incidents = trpc.incidents.list.useQuery();
  const compliance = trpc.compliance.overview.useQuery(undefined, { enabled: isAdmin });
  const comparison = trpc.comparison.byBlock.useQuery(undefined, { enabled: isAdmin });
  const timeline = trpc.comparison.timeline.useQuery(undefined, { enabled: isAdmin });
  const [goal, setGoal] = useState({ block: "A", title: "Meta mensal de recicláveis", targetKg: "80", startDate: dateValue(), endDate: dateValue(30) });
  const [incident, setIncident] = useState<{ block: string; wasteType: WasteType; location: string; description: string; imageDataUrl: string }>({ block: "A", wasteType: "reciclavel", location: "Área de descarte", description: "", imageDataUrl: "" });
  const [resolution, setResolution] = useState<Record<number, string>>({});

  const refresh = () => {
    void utils.goals.list.invalidate();
    void utils.incidents.list.invalidate();
    void utils.compliance.overview.invalidate();
    void utils.comparison.byBlock.invalidate();
    void utils.comparison.timeline.invalidate();
  };
  const createGoal = trpc.goals.create.useMutation({ onSuccess: () => { toast.success("Meta criada para o bloco."); refresh(); setGoal((current) => ({ ...current, title: "Meta mensal de recicláveis" })); }, onError: (error) => toast.error(error.message) });
  const toggleGoal = trpc.goals.toggle.useMutation({ onSuccess: refresh, onError: (error) => toast.error(error.message) });
  const createIncident = trpc.incidents.create.useMutation({ onSuccess: () => { toast.success("Ocorrência registrada para acompanhamento."); refresh(); setIncident({ block: "A", wasteType: "reciclavel", location: "Área de descarte", description: "", imageDataUrl: "" }); }, onError: (error) => toast.error(error.message) });
  const updateIncident = trpc.incidents.updateStatus.useMutation({ onSuccess: () => { toast.success("Tratamento da ocorrência atualizado."); refresh(); }, onError: (error) => toast.error(error.message) });

  const complianceCards = useMemo(() => compliance.data ? [
    { label: "Acessos pendentes", value: compliance.data.pendingAccess, icon: ClipboardCheck, tone: "amber" },
    { label: "Moradores sem e-mail", value: compliance.data.residentsWithoutEmail, icon: AlertTriangle, tone: "orange" },
    { label: "Coletas em atraso", value: compliance.data.overdueCollections, icon: Flag, tone: "rose" },
    { label: "Ocorrências abertas", value: compliance.data.openIncidents, icon: Camera, tone: "green" },
  ] : [], [compliance.data]);

  const onGoalSubmit = (event: FormEvent) => {
    event.preventDefault();
    createGoal.mutate({ ...goal, targetKg: Number(goal.targetKg), startDate: new Date(`${goal.startDate}T00:00:00`), endDate: new Date(`${goal.endDate}T23:59:59`) });
  };
  const onImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { toast.error("Envie imagem PNG, JPEG ou WebP."); return; }
    if (file.size > 4 * 1024 * 1024) { toast.error("A imagem deve ter no máximo 4 MB."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
        setIncident((current) => ({ ...current, imageDataUrl: canvas.toDataURL("image/webp", 0.82) }));
      };
      image.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  };
  const onIncidentSubmit = (event: FormEvent) => { event.preventDefault(); createIncident.mutate({ ...incident, imageDataUrl: incident.imageDataUrl || null }); };

  return <div>
    <PageIntro eyebrow="Controle e melhoria" title="Gestão ambiental" description="Defina metas por bloco, registre descarte inadequado com evidência e acompanhe dados que precisam de ação." />
    {isAdmin && <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{complianceCards.map((card) => { const Icon = card.icon; return <article key={card.label} className="rounded-2xl border border-[#dce8e0] bg-white p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.35)]"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#eef7f1] text-[#0f7350]"><Icon className="h-5 w-5" /></span><p className="mt-4 text-sm text-muted-foreground">{card.label}</p><p className="mt-1 text-2xl font-bold tracking-[-.05em]">{card.value}</p></article>; })}</section>}
    <section className="mt-6 grid gap-6 xl:grid-cols-[1.15fr_.85fr]">
      <article className="rounded-[24px] border border-[#dce8e0] bg-white p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.35)] sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><p className="text-[11px] font-bold tracking-[.12em] text-[#0f7350] uppercase">Metas do condomínio</p><h2 className="mt-1 text-lg font-semibold">Acompanhamento por bloco</h2></div><Target className="h-5 w-5 text-[#0f7350]" /></div>
        {isAdmin && <form onSubmit={onGoalSubmit} className="mt-5 grid gap-3 rounded-2xl bg-[#f5faf7] p-4 md:grid-cols-2"><Input aria-label="Título da meta" value={goal.title} onChange={(event) => setGoal({ ...goal, title: event.target.value })} required /><Input aria-label="Bloco da meta" value={goal.block} onChange={(event) => setGoal({ ...goal, block: event.target.value })} required /><Input aria-label="Meta em quilogramas" type="number" min="1" value={goal.targetKg} onChange={(event) => setGoal({ ...goal, targetKg: event.target.value })} required /><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Input aria-label="Início da meta" type="date" value={goal.startDate} onChange={(event) => setGoal({ ...goal, startDate: event.target.value })} required /><Input aria-label="Fim da meta" type="date" value={goal.endDate} onChange={(event) => setGoal({ ...goal, endDate: event.target.value })} required /></div><Button type="submit" disabled={createGoal.isPending} className="rounded-xl bg-[#0f7350] text-white hover:bg-[#0a6243] md:col-span-2">Criar meta do bloco</Button></form>}
        <div className="mt-5 grid gap-3">{goals.data?.length ? goals.data.map((item) => <div key={item.id} className="rounded-2xl border border-[#e0ebe4] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold">{item.title}</p><p className="mt-1 text-sm text-muted-foreground">Bloco {item.block} · {formatDate(item.startDate)} a {formatDate(item.endDate)}</p></div><Badge className="border-0 bg-[#e8f4ed] text-[#0a7048] hover:bg-[#e8f4ed]">{item.collectedKg} / {item.targetKg} kg</Badge></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-[#e8efeb]"><div className="h-full rounded-full bg-[#0f7350] transition-all" style={{ width: `${item.progress}%` }} /></div><div className="mt-2 flex items-center justify-between text-xs text-muted-foreground"><span>{item.progress}% da meta</span>{isAdmin && <button onClick={() => toggleGoal.mutate({ id: item.id, isActive: !item.isActive })} className="font-semibold text-[#0f7350] hover:underline">{item.isActive ? "Pausar" : "Reativar"}</button>}</div></div>) : <p className="rounded-2xl bg-[#f6faf7] p-5 text-sm leading-6 text-muted-foreground">Ainda não há metas criadas. As metas ajudam a orientar a participação por bloco e são atualizadas com coletas concluídas.</p>}</div>
      </article>
      <article className="rounded-[24px] border border-[#dce8e0] bg-[#103f2e] p-5 text-white shadow-[0_16px_34px_-28px_rgba(4,66,42,.45)] sm:p-6"><Leaf className="h-6 w-6 text-[#91d7ae]" /><p className="mt-5 text-[11px] font-bold tracking-[.14em] text-[#a8dfbc] uppercase">Leitura dos dados</p><h2 className="mt-2 text-xl font-semibold tracking-[-.04em]">Conformidade antes do relatório.</h2><p className="mt-3 text-sm leading-6 text-[#c6e4d1]">O painel destaca cadastros incompletos, acessos aguardando login, coletas fora do prazo, ocorrências abertas e feedbacks sem resposta. Esses itens devem ser revisados antes de interpretar indicadores ambientais.</p>{isAdmin && <div className="mt-6 grid grid-cols-2 gap-3 text-sm"><span className="rounded-xl bg-white/10 p-3"><b className="block text-lg">{compliance.data?.completedWithoutWeight ?? 0}</b>coletas sem peso</span><span className="rounded-xl bg-white/10 p-3"><b className="block text-lg">{compliance.data?.pendingFeedback ?? 0}</b>feedbacks novos</span></div>}</article>
    </section>
    <section className="mt-6 grid gap-6 xl:grid-cols-[.9fr_1.1fr]">
      <article className="rounded-[24px] border border-[#dce8e0] bg-white p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.35)] sm:p-6"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#fff2e9] text-[#d45f2b]"><ImagePlus className="h-5 w-5" /></span><div><p className="font-semibold">Registrar ocorrência</p><p className="text-sm text-muted-foreground">Descreva um descarte inadequado e anexe evidência quando necessário.</p></div></div><form onSubmit={onIncidentSubmit} className="mt-5 grid gap-3"><div className="grid grid-cols-2 gap-3"><Input aria-label="Bloco da ocorrência" value={incident.block} onChange={(event) => setIncident({ ...incident, block: event.target.value })} required /><select aria-label="Categoria da ocorrência" value={incident.wasteType} onChange={(event) => setIncident({ ...incident, wasteType: event.target.value as WasteType })} className="h-10 rounded-xl border border-input bg-[#fbfdfc] px-3 text-sm">{Object.entries(wasteLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><Input aria-label="Local da ocorrência" value={incident.location} onChange={(event) => setIncident({ ...incident, location: event.target.value })} required /><Textarea aria-label="Descrição da ocorrência" value={incident.description} onChange={(event) => setIncident({ ...incident, description: event.target.value })} placeholder="Ex.: materiais orgânicos misturados a recicláveis no contêiner do bloco A." required /><label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-[#b9d8c5] bg-[#f6faf7] px-3 py-3 text-sm text-[#0f7350]"><ImagePlus className="h-4 w-4" />{incident.imageDataUrl ? "Imagem pronta para envio" : "Anexar foto (opcional, até 4 MB)"}<input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={onImageChange} /></label><Button type="submit" disabled={createIncident.isPending} className="rounded-xl bg-[#0f7350] text-white hover:bg-[#0a6243]">Registrar ocorrência</Button></form></article>
      <article className="rounded-[24px] border border-[#dce8e0] bg-white p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.35)] sm:p-6"><div className="flex items-center justify-between"><div><p className="font-semibold">Ocorrências registradas</p><p className="mt-1 text-sm text-muted-foreground">Acompanhamento de descarte inadequado e providências.</p></div><Badge variant="outline">{incidents.data?.length ?? 0}</Badge></div><div className="mt-5 grid gap-3">{incidents.data?.length ? incidents.data.map((item) => <div key={item.id} className="rounded-2xl border border-[#e4ece7] p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{item.location}</p><p className="mt-1 text-sm text-muted-foreground">Bloco {item.block} · {wasteLabels[item.wasteType]}</p></div><Badge className={`border-0 ${item.status === "resolvida" ? "bg-[#e8f4ed] text-[#0a7048]" : "bg-[#fff2e9] text-[#bf5627]"}`}>{item.status.replace("_", " ")}</Badge></div><p className="mt-3 text-sm leading-6 text-muted-foreground">{item.description}</p>{item.imageUrl && <img src={item.imageUrl} alt={`Evidência da ocorrência em ${item.location}`} className="mt-3 max-h-40 w-full rounded-xl border border-[#e2ebe5] object-cover" />}{isAdmin && item.status !== "resolvida" && <div className="mt-3 flex gap-2"><Input aria-label={`Providência para ocorrência ${item.id}`} value={resolution[item.id] ?? ""} onChange={(event) => setResolution({ ...resolution, [item.id]: event.target.value })} placeholder="Providência adotada" /><Button size="sm" onClick={() => updateIncident.mutate({ id: item.id, status: "resolvida", resolutionNote: resolution[item.id] || null })} disabled={updateIncident.isPending} className="rounded-xl bg-[#0f7350] text-white">Resolver</Button></div>}</div>) : <p className="rounded-2xl bg-[#f6faf7] p-5 text-sm leading-6 text-muted-foreground">Nenhuma ocorrência registrada neste momento.</p>}</div></article>
    </section>
    {isAdmin && <section className="mt-6 rounded-[24px] border border-[#dce8e0] bg-white p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.35)] sm:p-6"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e8f4ed] text-[#0f7350]"><ClipboardCheck className="h-5 w-5" /></span><div><h2 className="font-semibold">Comparativo entre blocos</h2><p className="text-sm text-muted-foreground">Use a comparação para orientar campanhas e metas, não para expor moradores individualmente.</p></div></div>{comparison.data?.length ? <><div className="mt-5 h-72 rounded-2xl bg-[#fbfdfc] p-3"><ResponsiveContainer width="100%" height="100%"><BarChart data={comparison.data.map((item) => ({ ...item, label: `Bloco ${item.block}` }))} margin={{ top: 12, right: 12, left: -14, bottom: 2 }}><CartesianGrid vertical={false} stroke="#e5eee8" /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#587064" }} /><YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#587064" }} unit=" kg" /><Tooltip cursor={{ fill: "#eef7f1" }} formatter={(value: number) => [`${value} kg`, ""]} contentStyle={{ borderRadius: 14, border: "1px solid #dce8e0", boxShadow: "0 12px 30px -18px rgba(4,66,42,.45)" }} /><Legend wrapperStyle={{ fontSize: 12 }} /><Bar dataKey="totalKg" name="Total coletado" fill="#75b98e" radius={[6, 6, 0, 0]} /><Bar dataKey="recyclableKg" name="Recicláveis" fill="#0f7350" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div>{timeline.data?.length ? <div className="mt-5 h-72 rounded-2xl bg-[#fbfdfc] p-3"><ResponsiveContainer width="100%" height="100%"><LineChart data={timeline.data.map((item) => ({ ...item, label: new Date(`${item.period}-01T12:00:00`).toLocaleDateString("pt-BR", { month: "short", year: "numeric" }) }))} margin={{ top: 12, right: 12, left: -14, bottom: 2 }}><CartesianGrid vertical={false} stroke="#e5eee8" /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#587064" }} /><YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#587064" }} unit=" kg" /><Tooltip formatter={(value: number) => [`${value} kg`, ""]} contentStyle={{ borderRadius: 14, border: "1px solid #dce8e0", boxShadow: "0 12px 30px -18px rgba(4,66,42,.45)" }} /><Legend wrapperStyle={{ fontSize: 12 }} />{comparison.data.map((item, index) => <Line key={item.block} type="monotone" dataKey={item.block} name={`Bloco ${item.block}`} stroke={["#0f7350", "#d49a33", "#4d83b7", "#bd5c53"][index % 4]} strokeWidth={3} dot={{ r: 4 }} />)}</LineChart></ResponsiveContainer></div> : null}<div className="mt-5 overflow-x-auto"><table className="w-full min-w-[580px] text-left text-sm"><thead className="border-b border-[#e5ede8] text-[11px] tracking-[.08em] text-muted-foreground uppercase"><tr><th className="pb-3 font-bold">Bloco</th><th className="pb-3 font-bold">Total</th><th className="pb-3 font-bold">Recicláveis</th><th className="pb-3 font-bold">Coletas</th><th className="pb-3 font-bold">Taxa</th></tr></thead><tbody>{comparison.data.map((row) => <tr key={row.block} className="border-b border-[#edf2ef]"><td className="py-4 font-semibold">Bloco {row.block}</td><td className="py-4">{row.totalKg} kg</td><td className="py-4">{row.recyclableKg} kg</td><td className="py-4">{row.collectionCount}</td><td className="py-4"><Badge className="border-0 bg-[#e8f4ed] text-[#0a7048] hover:bg-[#e8f4ed]">{row.recyclingRate ?? "—"}{row.recyclingRate !== null ? "%" : ""}</Badge></td></tr>)}</tbody></table></div></> : <p className="mt-5 rounded-2xl bg-[#f6faf7] p-5 text-center text-sm text-muted-foreground">Conclua coletas para gerar o comparativo e os gráficos por bloco.</p>}</section>}
  </div>;
}

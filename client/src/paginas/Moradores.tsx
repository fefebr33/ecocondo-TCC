import PageIntro from "@/components/PageIntro";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { BarChart3, Coins, Mail, Pencil, Plus, Search, UserRoundCheck, UserRoundX, UsersRound } from "lucide-react";
import { Link } from "wouter";
import { FormEvent, useMemo, useState } from "react";
import { toast } from "sonner";

const initialForm: { name: string; email: string; phone: string; block: string; apartment: string; status: "ativo" | "inativo" } = { name: "", email: "", phone: "", block: "A", apartment: "", status: "ativo" };

export default function Residents() {
  const utils = trpc.useUtils();
  const { data: residents, isLoading, error } = trpc.moradores.listar.useQuery();
  const createResident = trpc.pessoas.criar.useMutation({ onSuccess: () => { utils.moradores.listar.invalidate(); utils.pessoas.diretorio.invalidate(); toast.success("Morador cadastrado e acesso preparado."); setForm(initialForm); setIsFormOpen(false); }, onError: (issue) => toast.error(issue.message) });
  const updateResident = trpc.moradores.atualizar.useMutation({ onSuccess: () => { utils.moradores.listar.invalidate(); toast.success("Dados do morador atualizados."); setForm(initialForm); setEditingResidentId(null); setIsFormOpen(false); }, onError: (issue) => toast.error(issue.message) });
  const [query, setQuery] = useState("");
  const [blocoFiltro, setBlocoFiltro] = useState("");
  const [statusFiltro, setStatusFiltro] = useState("");
  const [ordem, setOrdem] = useState<"nome" | "pontos" | "unidade">("unidade");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [editingResidentId, setEditingResidentId] = useState<number | null>(null);
  const semAcento = (texto: string) => texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const blocos = useMemo(() => Array.from(new Set((residents ?? []).map((resident) => resident.bloco))).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true })), [residents]);
  const visibleResidents = useMemo(() => (residents ?? [])
    .filter((resident) => semAcento(`${resident.nome} ${resident.bloco} ${resident.apartamento} ${resident.email ?? ""} ${resident.telefone ?? ""}`).includes(semAcento(query)))
    .filter((resident) => !blocoFiltro || resident.bloco === blocoFiltro)
    .filter((resident) => !statusFiltro || resident.status === statusFiltro)
    .sort((a, b) => ordem === "pontos" ? b.pontos - a.pontos : ordem === "nome" ? a.nome.localeCompare(b.nome, "pt-BR") : `${a.bloco}-${a.apartamento}`.localeCompare(`${b.bloco}-${b.apartamento}`, "pt-BR", { numeric: true })), [residents, query, blocoFiltro, statusFiltro, ordem]);
  const [ajusteAlvo, setAjusteAlvo] = useState<{ id: number; nome: string; pontos: number } | null>(null);
  const [ajuste, setAjuste] = useState({ points: "", reason: "" });
  const ajustar = trpc.pontos.ajustar.useMutation({ onSuccess: (resultado) => { utils.moradores.listar.invalidate(); toast.success(`Pontos ajustados. Saldo atual: ${resultado.saldo}.`); setAjusteAlvo(null); setAjuste({ points: "", reason: "" }); }, onError: (issue) => toast.error(issue.message) });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = { ...form, email: form.email || null, phone: form.phone || null };
    if (editingResidentId) updateResident.mutate({ id: editingResidentId, ...payload });
    else {
      if (!form.email) { toast.error("Informe o e-mail para preparar o acesso do morador."); return; }
      createResident.mutate({ name: form.name, email: form.email, phone: form.phone || null, block: form.block, apartment: form.apartment, role: "morador" });
    }
  }

  return <div>
    <PageIntro eyebrow="Comunidade" title="Moradores" description="Mantenha o cadastro organizado por bloco e apartamento, com dados de contato e status de participação." action={<Button onClick={() => { setEditingResidentId(null); setForm(initialForm); setIsFormOpen(true); }} className="h-10 rounded-xl bg-[#0f7350] font-semibold text-white hover:bg-[#0a6243]"><Plus className="mr-2 h-4 w-4" />Novo morador</Button>} />
    <section className="rounded-[24px] border border-[#dce8e0] bg-white p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.35)] sm:p-6">
      <div className="flex flex-col gap-4 border-b border-[#e6eee9] pb-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-base font-semibold tracking-[-.025em]">Cadastro residencial</p><p className="mt-1 text-sm text-muted-foreground">{visibleResidents.length} de {residents?.length ?? 0} morador(es) com os filtros atuais.</p></div></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative sm:col-span-2 lg:col-span-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome, apartamento, e-mail ou telefone" aria-label="Buscar morador" className="h-10 rounded-xl border-[#dce8e0] bg-[#fbfdfc] pl-9" /></div>
        <select aria-label="Filtrar por bloco" value={blocoFiltro} onChange={(event) => setBlocoFiltro(event.target.value)} className="h-10 rounded-xl border border-[#dce8e0] bg-[#fbfdfc] px-3 text-sm"><option value="">Todos os blocos</option>{blocos.map((bloco) => <option key={bloco} value={bloco}>Bloco {bloco}</option>)}</select>
        <select aria-label="Filtrar por situação" value={statusFiltro} onChange={(event) => setStatusFiltro(event.target.value)} className="h-10 rounded-xl border border-[#dce8e0] bg-[#fbfdfc] px-3 text-sm"><option value="">Ativos e inativos</option><option value="ativo">Só ativos</option><option value="inativo">Só inativos</option></select>
        <select aria-label="Ordenar" value={ordem} onChange={(event) => setOrdem(event.target.value as typeof ordem)} className="h-10 rounded-xl border border-[#dce8e0] bg-[#fbfdfc] px-3 text-sm"><option value="unidade">Ordenar por bloco e apto</option><option value="nome">Ordenar por nome</option><option value="pontos">Ordenar por pontos</option></select>
      </div>
      {isFormOpen && <form onSubmit={submit} className="mt-5 grid gap-3 rounded-2xl border border-[#cfe1d7] bg-[#f7fbf8] p-4 sm:grid-cols-2"><label className="grid gap-1.5 text-xs font-semibold text-foreground sm:col-span-2">Nome completo<Input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="h-10 rounded-xl bg-white" /></label><label className="grid gap-1.5 text-xs font-semibold text-foreground">E-mail<Input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="h-10 rounded-xl bg-white" /></label><label className="grid gap-1.5 text-xs font-semibold text-foreground">Telefone<Input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className="h-10 rounded-xl bg-white" /></label><label className="grid gap-1.5 text-xs font-semibold text-foreground">Bloco<Input required value={form.block} onChange={(event) => setForm({ ...form, block: event.target.value })} className="h-10 rounded-xl bg-white" /></label><label className="grid gap-1.5 text-xs font-semibold text-foreground">Apartamento<Input required value={form.apartment} onChange={(event) => setForm({ ...form, apartment: event.target.value })} className="h-10 rounded-xl bg-white" /></label><div className="flex items-end gap-2 sm:col-span-2"><Button disabled={createResident.isPending || updateResident.isPending} className="h-10 rounded-xl bg-[#0f7350] text-white hover:bg-[#0a6243]">{createResident.isPending || updateResident.isPending ? "Salvando..." : editingResidentId ? "Salvar alterações" : "Cadastrar morador"}</Button><Button type="button" variant="ghost" onClick={() => { setIsFormOpen(false); setEditingResidentId(null); setForm(initialForm); }} className="h-10 rounded-xl">Cancelar</Button></div></form>}
      {error ? <p className="py-12 text-center text-sm text-destructive">{error.message}</p> : isLoading ? <p className="py-12 text-center text-sm text-muted-foreground">Carregando cadastro...</p> : visibleResidents.length === 0 ? <div className="grid min-h-60 place-items-center text-center"><div><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#e8f4ed] text-[#0f7350]"><UsersRound className="h-5 w-5" /></span><p className="mt-4 text-sm font-semibold">Nenhum morador encontrado.</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Adicione moradores ou ajuste os filtros.</p></div></div> : <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[830px] text-left"><thead><tr className="border-b border-[#e6eee9] text-[11px] font-bold tracking-[.08em] text-muted-foreground uppercase"><th className="px-2 py-4">Morador</th><th className="px-2 py-4">Unidade</th><th className="px-2 py-4">Contato</th><th className="px-2 py-4">Pontos</th><th className="px-2 py-4">Status</th><th className="px-2 py-4 text-right">Ações</th></tr></thead><tbody>{visibleResidents.map((resident) => <tr key={resident.id} className="border-b border-[#edf2ef] last:border-0"><td className="px-2 py-4"><p className="text-sm font-semibold">{resident.nome}</p><p className="mt-0.5 text-xs text-muted-foreground">Cadastro #{resident.id}</p></td><td className="px-2 py-4 text-sm">Bloco {resident.bloco} · {resident.apartamento}</td><td className="px-2 py-4 text-sm text-muted-foreground">{resident.email ? <span className="inline-flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />{resident.email}</span> : resident.telefone || "Não informado"}</td><td className="px-2 py-4 text-sm font-semibold text-[#0f7350]">{resident.pontos}</td><td className="px-2 py-4"><Badge className={resident.status === "ativo" ? "border-0 bg-[#e7f5ec] text-[#0a7048] hover:bg-[#e7f5ec]" : "border-0 bg-[#f2f1ef] text-muted-foreground hover:bg-[#f2f1ef]"}>{resident.status}</Badge></td><td className="px-2 py-4 text-right"><div className="flex justify-end gap-1"><Link href={`/moradores/painel?id=${resident.id}`} className="inline-flex h-8 items-center rounded-lg px-3 text-xs font-semibold text-[#0f7350] hover:bg-[#edf7f1]"><BarChart3 className="mr-1.5 h-3.5 w-3.5" />Painel</Link><Button size="sm" variant="ghost" onClick={() => setAjusteAlvo({ id: resident.id, nome: resident.nome, pontos: resident.pontos })} className="h-8 rounded-lg text-xs font-semibold text-[#0f7350] hover:bg-[#edf7f1]"><Coins className="mr-1.5 h-3.5 w-3.5" />Pontos</Button><Button size="sm" variant="ghost" onClick={() => { setEditingResidentId(resident.id); setForm({ name: resident.nome, email: resident.email || "", phone: resident.telefone || "", block: resident.bloco, apartment: resident.apartamento, status: resident.status }); setIsFormOpen(true); }} className="h-8 rounded-lg text-xs font-semibold text-[#0f7350] hover:bg-[#edf7f1]"><Pencil className="mr-1.5 h-3.5 w-3.5" />Editar</Button><Button size="sm" variant="ghost" disabled={updateResident.isPending} onClick={() => updateResident.mutate({ id: resident.id, status: resident.status === "ativo" ? "inativo" : "ativo" })} className="h-8 rounded-lg text-xs font-semibold text-[#0f7350] hover:bg-[#edf7f1]">{resident.status === "ativo" ? <><UserRoundX className="mr-1.5 h-3.5 w-3.5" />Inativar</> : <><UserRoundCheck className="mr-1.5 h-3.5 w-3.5" />Ativar</>}</Button></div></td></tr>)}</tbody></table></div>}
    </section>
    <Dialog open={ajusteAlvo !== null} onOpenChange={(open) => { if (!open) { setAjusteAlvo(null); setAjuste({ points: "", reason: "" }); } }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Ajustar pontos de {ajusteAlvo?.nome}</DialogTitle>
          <DialogDescription>Saldo atual: {ajusteAlvo?.pontos} ponto(s). Use número positivo para creditar e negativo para debitar. O ajuste entra no extrato do morador, que é avisado com o motivo.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => { event.preventDefault(); if (ajusteAlvo) ajustar.mutate({ residentId: ajusteAlvo.id, points: Number(ajuste.points), reason: ajuste.reason }); }} className="grid gap-3">
          <label className="grid gap-1.5 text-xs font-semibold">Pontos (ex.: 10 ou -5)<Input required type="number" step={1} value={ajuste.points} onChange={(event) => setAjuste({ ...ajuste, points: event.target.value })} className="h-10 rounded-xl" /></label>
          <label className="grid gap-1.5 text-xs font-semibold">Motivo<textarea required minLength={10} maxLength={500} value={ajuste.reason} onChange={(event) => setAjuste({ ...ajuste, reason: event.target.value })} placeholder="Ex.: bônus da campanha Mês sem plástico" className="min-h-20 rounded-xl border border-[#dce8e0] bg-white p-3 text-sm" /></label>
          <Button disabled={ajustar.isPending || !Number(ajuste.points) || ajuste.reason.trim().length < 10} className="h-10 rounded-xl bg-[#0f7350] text-white hover:bg-[#0a6243]">{ajustar.isPending ? "Salvando..." : "Salvar ajuste"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  </div>;
}

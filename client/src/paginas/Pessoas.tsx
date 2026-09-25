import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import PageIntro from "@/components/PageIntro";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Plus, UserRoundPlus, UsersRound } from "lucide-react";
import { FormEvent, useState } from "react";
import { toast } from "sonner";

type PersonRole = "administrador" | "coletor" | "morador";
const blank = { name: "", email: "", phone: "", role: "morador" as PersonRole, block: "A", apartment: "" };
const roleLabels: Record<PersonRole, string> = { administrador: "Administrador", coletor: "Coletor", morador: "Morador" };

export default function People() {
  const utils = trpc.useUtils();
  const directory = trpc.pessoas.diretorio.useQuery();
  const residents = trpc.moradores.listar.useQuery();
  const createPerson = trpc.pessoas.criar.useMutation({ onSuccess: () => { utils.pessoas.diretorio.invalidate(); utils.moradores.listar.invalidate(); toast.success("Pessoa cadastrada. O acesso será ativado no primeiro login com este e-mail."); setForm(blank); setOpen(false); }, onError: (issue) => toast.error(issue.message) });
  const setRole = trpc.pessoas.definirPapel.useMutation({ onSuccess: () => { utils.pessoas.diretorio.invalidate(); toast.success("Perfil atualizado."); }, onError: (issue) => toast.error(issue.message) });
  const { user } = useAuth();
  function changeRole(id: number, name: string, role: PersonRole) {
    const labels: Record<PersonRole, string> = { administrador: "Administrador", coletor: "Coletor", morador: "Morador" };
    if (window.confirm(`Alterar o perfil de ${name} para ${labels[role]}? As permissões passam a valer imediatamente.`)) setRole.mutate({ id, role });
  }
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const isResident = form.role === "morador";
  const residentsWithoutEmail = (residents.data ?? []).filter((resident) => !resident.email);
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); createPerson.mutate({ ...form, phone: form.phone || null, block: isResident ? form.block : null, apartment: isResident ? form.apartment : null }); }
  return <div>
    <PageIntro eyebrow="Administração" title="Pessoas e acessos" description="Cadastre moradores, coletores e administradores. O perfil definido será ativado quando a pessoa entrar com o mesmo e-mail." action={<Button onClick={() => { setForm(blank); setOpen(true); }} className="h-10 rounded-xl bg-[#0f7350] font-semibold text-white hover:bg-[#0a6243]"><Plus className="mr-2 h-4 w-4" />Cadastrar pessoa</Button>} />
    <section className="rounded-[24px] border border-[#dce8e0] bg-white p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.35)] sm:p-6">
      <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e8f4ed] text-[#0f7350]"><UserRoundPlus className="h-5 w-5" /></span><div><p className="font-semibold">Cadastro e vínculo de acesso</p><p className="text-sm text-muted-foreground">Moradores também são adicionados automaticamente à lista residencial.</p></div></div>
      {residentsWithoutEmail.length > 0 && <div className="mt-5 rounded-2xl border border-[#f3dca3] bg-[#fff9e8] p-4 text-sm text-[#7b5811]"><p className="font-semibold">{residentsWithoutEmail.length} morador(es) precisa(m) de e-mail para ter acesso.</p><p className="mt-1 text-xs leading-5">Edite o cadastro em Moradores e informe o e-mail. Assim, a pessoa aparecerá aqui para receber um perfil e será vinculada quando fizer o primeiro login.</p></div>}
      {open && <form onSubmit={submit} className="mt-5 grid gap-3 rounded-2xl border border-[#cfe1d7] bg-[#f7fbf8] p-4 sm:grid-cols-2"><label className="grid gap-1.5 text-xs font-semibold sm:col-span-2">Nome completo<Input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="h-10 rounded-xl bg-white" /></label><label className="grid gap-1.5 text-xs font-semibold">E-mail de acesso<Input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="h-10 rounded-xl bg-white" /></label><label className="grid gap-1.5 text-xs font-semibold">Telefone<Input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className="h-10 rounded-xl bg-white" /></label><label className="grid gap-1.5 text-xs font-semibold sm:col-span-2">Perfil<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as PersonRole })} className="h-10 rounded-xl border border-[#dce8e0] bg-white px-3 text-sm"><option value="morador">Morador</option><option value="coletor">Coletor</option><option value="administrador">Administrador</option></select></label>{isResident && <><label className="grid gap-1.5 text-xs font-semibold">Bloco<Input required value={form.block} onChange={(event) => setForm({ ...form, block: event.target.value })} className="h-10 rounded-xl bg-white" /></label><label className="grid gap-1.5 text-xs font-semibold">Apartamento<Input required value={form.apartment} onChange={(event) => setForm({ ...form, apartment: event.target.value })} className="h-10 rounded-xl bg-white" /></label></>}<div className="flex items-end gap-2 sm:col-span-2"><Button disabled={createPerson.isPending} className="h-10 rounded-xl bg-[#0f7350] text-white hover:bg-[#0a6243]">{createPerson.isPending ? "Cadastrando..." : "Salvar pessoa"}</Button><Button type="button" variant="ghost" onClick={() => setOpen(false)} className="h-10 rounded-xl">Cancelar</Button></div></form>}
      {!directory.data?.length ? <div className="grid min-h-56 place-items-center text-center"><div><UsersRound className="mx-auto h-6 w-6 text-[#0f7350]" /><p className="mt-3 text-sm font-semibold">Nenhuma pessoa cadastrada.</p><p className="mt-1 text-xs text-muted-foreground">Cadastre a primeira pessoa para organizar os acessos do condomínio.</p></div></div> : <div className="mt-5 divide-y divide-[#edf2ef]">{directory.data.map(({ pessoa, usuario, morador }) => <article key={pessoa.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold">{pessoa.nome}</p><p className="mt-0.5 text-xs text-muted-foreground">{pessoa.email}{morador ? ` · Bloco ${morador.bloco} · ${morador.apartamento}` : ""}</p></div><div className="flex flex-wrap items-center gap-2"><Badge className={pessoa.statusAcesso === "ativo" ? "border-0 bg-[#e7f5ec] text-[#0a7048]" : "border-0 bg-[#fff4dd] text-[#7a4d0a]"}>{pessoa.statusAcesso === "ativo" ? "Acesso ativo" : "Aguardando primeiro login"}</Badge><select aria-label={`Perfil de ${pessoa.nome}`} title={usuario?.id === user?.id ? "Você não pode alterar o seu próprio perfil" : undefined} value={pessoa.papel} onChange={(event) => changeRole(pessoa.id, pessoa.nome, event.target.value as PersonRole)} disabled={setRole.isPending || (usuario !== null && usuario?.id === user?.id)} className="h-9 rounded-lg border border-[#dce8e0] bg-white px-2 text-xs font-semibold"><option value="administrador">Administrador</option><option value="coletor">Coletor</option><option value="morador">Morador</option></select>{usuario && <span className="text-xs text-muted-foreground">Vinculado</span>}</div></article>)}</div>}
    </section>
  </div>;
}

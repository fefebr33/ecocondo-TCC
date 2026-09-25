import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Copy, Plus, RefreshCw, Scale } from "lucide-react";
import { FormEvent, useState } from "react";
import { toast } from "sonner";

const formatDate = (value: Date | null) => (value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "nunca");

/** Cadastro dos tablets (estações de pesagem) ao lado das lixeiras e do código de pareamento de cada um. */
export default function EstacoesPesagem() {
  const utils = trpc.useUtils();
  const estacoes = trpc.estacoes.listar.useQuery();
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState({ name: "", location: "" });
  const [pareamento, setPareamento] = useState<{ nome: string; token: string } | null>(null);
  const criar = trpc.estacoes.criar.useMutation({
    onSuccess: (dados, variaveis) => { utils.estacoes.listar.invalidate(); setPareamento({ nome: variaveis.name, token: dados.token }); setForm({ name: "", location: "" }); setAberto(false); },
    onError: (issue) => toast.error(issue.message),
  });
  const novoCodigo = trpc.estacoes.novoCodigo.useMutation({ onError: (issue) => toast.error(issue.message) });
  const alternar = trpc.estacoes.alternar.useMutation({ onSuccess: () => utils.estacoes.listar.invalidate(), onError: (issue) => toast.error(issue.message) });
  const link = pareamento ? `${window.location.origin}/estacao?codigo=${encodeURIComponent(pareamento.token)}` : "";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    criar.mutate(form);
  }
  function gerarNovoCodigo(id: number, nome: string) {
    if (!window.confirm(`Gerar um novo código para "${nome}"? O tablet atual para de funcionar até ser pareado de novo.`)) return;
    novoCodigo.mutate({ id }, { onSuccess: (dados) => setPareamento({ nome, token: dados.token }) });
  }
  function copiar(texto: string) {
    navigator.clipboard?.writeText(texto).then(() => toast.success("Copiado."), () => toast.error("Não foi possível copiar; selecione e copie o texto."));
  }

  return <section className="mt-5 rounded-[24px] border border-[#dce8e0] bg-white p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.35)] sm:p-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e8f4ed] text-[#0f7350]"><Scale className="h-5 w-5" /></span><div><p className="font-semibold">Estações de pesagem</p><p className="text-sm text-muted-foreground">Tablets com balança ao lado das lixeiras, onde o morador registra a própria reciclagem. Só tablets pareados aqui conseguem registrar.</p></div></div>
      <Button variant="outline" onClick={() => setAberto((valor) => !valor)} className="h-9 shrink-0 rounded-xl border-[#cfe1d7] text-xs font-semibold text-[#0f7350]"><Plus className="mr-1.5 h-3.5 w-3.5" />Nova estação</Button>
    </div>
    {aberto && <form onSubmit={submit} className="mt-4 grid gap-3 rounded-2xl bg-[#f5faf7] p-4 sm:grid-cols-2">
      <label className="grid gap-1.5 text-xs font-semibold">Nome<Input required minLength={3} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ex.: Lixeiras do térreo" className="h-10 rounded-xl bg-white" /></label>
      <label className="grid gap-1.5 text-xs font-semibold">Local<Input required minLength={3} value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Ex.: Garagem, ao lado do bloco A" className="h-10 rounded-xl bg-white" /></label>
      <div className="flex gap-2 sm:col-span-2"><Button disabled={criar.isPending} className="h-10 rounded-xl bg-[#0f7350] text-white hover:bg-[#0a6243]">Cadastrar estação</Button><Button type="button" variant="ghost" onClick={() => setAberto(false)} className="h-10 rounded-xl">Cancelar</Button></div>
    </form>}
    {pareamento && <div className="mt-4 rounded-2xl border border-[#f3c98a] bg-[#fff8ec] p-4 text-sm" role="status">
      <p className="font-semibold">Código de pareamento de "{pareamento.nome}"</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">Abra o link no tablet (ou digite o código na tela da estação). Anote agora: por segurança, o código não aparece de novo. Se perder, gere outro.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2"><code className="rounded-lg bg-white px-3 py-2 text-sm font-semibold">{pareamento.token}</code><Button size="sm" variant="outline" onClick={() => copiar(pareamento.token)} className="h-8 rounded-lg text-xs"><Copy className="mr-1.5 h-3.5 w-3.5" />Copiar código</Button><Button size="sm" variant="outline" onClick={() => copiar(link)} className="h-8 rounded-lg text-xs"><Copy className="mr-1.5 h-3.5 w-3.5" />Copiar link</Button><Button size="sm" variant="ghost" onClick={() => setPareamento(null)} className="h-8 rounded-lg text-xs">Fechar</Button></div>
    </div>}
    <div className="mt-4 grid gap-2">
      {estacoes.data?.length ? estacoes.data.map((estacao) => <div key={estacao.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e5eee8] bg-[#fbfdfc] px-4 py-3 text-sm">
        <span><b className="font-semibold">{estacao.nome}</b> · {estacao.local}<span className="block text-xs text-muted-foreground">Último registro: {formatDate(estacao.ultimoUsoEm)}</span></span>
        <span className="flex flex-wrap items-center gap-2">
          <Badge className={`border-0 ${estacao.ativo ? "bg-[#e8f4ed] text-[#0a7048]" : "bg-[#f0f4f2] text-muted-foreground"} hover:bg-inherit`}>{estacao.ativo ? "Ativa" : "Desativada"}</Badge>
          <Button size="sm" variant="ghost" onClick={() => gerarNovoCodigo(estacao.id, estacao.nome)} className="h-8 rounded-lg text-xs font-semibold text-[#0f7350]"><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Novo código</Button>
          <Button size="sm" variant="ghost" onClick={() => alternar.mutate({ id: estacao.id, active: !estacao.ativo })} className="h-8 rounded-lg text-xs font-semibold">{estacao.ativo ? "Desativar" : "Reativar"}</Button>
        </span>
      </div>) : <p className="rounded-2xl bg-[#f6faf7] p-5 text-sm leading-6 text-muted-foreground">Nenhuma estação cadastrada. Cadastre o tablet que fica ao lado das lixeiras para os moradores registrarem a reciclagem.</p>}
    </div>
  </section>;
}

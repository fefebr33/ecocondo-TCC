import PageIntro from "@/components/PageIntro";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, ArrowRight, Bell, Check, Coins, Gift, Megaphone, MessageSquarePlus, Recycle, Scale, ShieldAlert, UserRound } from "lucide-react";
import { destinoDaNotificacao } from "@shared/notificacoes";
import type { EcoRole } from "@shared/permissions";
import { FormEvent, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

type Categoria = { rotulo: string; icone: typeof Bell; cor: string };
const categorias: Record<string, Categoria> = {
  descarte: { rotulo: "Descarte", icone: Recycle, cor: "bg-[#e8f4ed] text-[#0f7350]" },
  estacao: { rotulo: "Estação", icone: Scale, cor: "bg-[#e8f4ed] text-[#0f7350]" },
  pontos: { rotulo: "Pontos", icone: Coins, cor: "bg-[#fff3df] text-[#7a4d0a]" },
  premio: { rotulo: "Prêmios", icone: Gift, cor: "bg-[#f3ecfb] text-[#6b3fa0]" },
  auditoria: { rotulo: "Auditoria", icone: ShieldAlert, cor: "bg-[#efe9fb] text-[#5b3aa6]" },
  alerta: { rotulo: "Atenção", icone: AlertTriangle, cor: "bg-[#fbeceb] text-[#b3382c]" },
  cadastro: { rotulo: "Cadastro", icone: UserRound, cor: "bg-[#e9f1fb] text-[#2863a5]" },
  comunicado: { rotulo: "Comunicado", icone: Megaphone, cor: "bg-[#e9f1fb] text-[#2863a5]" },
  sistema: { rotulo: "Sistema", icone: Bell, cor: "bg-[#f0f4f2] text-muted-foreground" },
};
const categoriaDoTipo: Record<string, keyof typeof categorias> = {
  solicitacao_criada: "descarte", coleta_agendada: "descarte", lembrete_coleta: "descarte", coleta_concluida: "descarte", nova_coleta: "descarte", descarte_aguardando_aprovacao: "descarte",
  codigo_estacao: "estacao", pesagem_registrada: "estacao",
  pontos_ganhos: "pontos", pontos_estornados: "pontos", pontos_pendentes: "pontos", revisao_administrativa: "pontos", pontos_zerados: "pontos", pontos_ajustados: "pontos",
  premio_resgatado: "premio", resgate_atualizado: "premio", resgate_recusado: "premio", novo_premio: "premio", premio_podio: "premio", novo_resgate: "premio", estoque_baixo: "premio", sem_estoque: "alerta",
  auditoria_aberta: "auditoria", auditoria_concluida: "auditoria",
  coleta_reprovada: "alerta", peso_suspeito: "alerta", aguardando_pesagem: "alerta", falha_operacional: "alerta",
  cadastro_alterado: "cadastro", novo_cadastro: "cadastro",
  comunicado: "comunicado", certificado_disponivel: "sistema", relatorio_anual: "sistema", sistema: "sistema",
};

export default function Notifications() {
  const utils = trpc.useUtils();
  const profile = trpc.perfil.meuPerfil.useQuery();
  const { data: items, isLoading } = trpc.notificacoes.listar.useQuery();
  const unread = trpc.notificacoes.contagemNaoLidas.useQuery();
  const refreshNotifications = () => { utils.notificacoes.listar.invalidate(); utils.notificacoes.contagemNaoLidas.invalidate(); };
  const markRead = trpc.notificacoes.marcarLida.useMutation({ onSuccess: refreshNotifications });
  const [, navigate] = useLocation();
  const [filtro, setFiltro] = useState<"todas" | "nao_lidas">("todas");
  const [aberta, setAberta] = useState<number | null>(null);
  const abrir = trpc.notificacoes.abrir.useMutation({ onSuccess: refreshNotifications, onError: (issue) => toast.error(issue.message) });
  const visiveis = (items ?? []).filter((item) => filtro === "todas" || !item.lidaEm);
  const papel = (profile.data?.role ?? "morador") as EcoRole;
  /** Tocar na notificação marca como lida e leva direto ao descarte, extrato ou resgate de que ela fala; comunicados só abrem o texto. */
  function abrirNotificacao(item: { id: number; tipo: string; coletaId: number | null; lidaEm: Date | null }) {
    if (!item.lidaEm) abrir.mutate({ id: item.id });
    const destino = destinoDaNotificacao(item, papel);
    if (destino) navigate(destino.href);
    else setAberta((atual) => (atual === item.id ? null : item.id));
  }
  const markAllRead = trpc.notificacoes.marcarTodasLidas.useMutation({ onSuccess: () => { refreshNotifications(); toast.success("Suas notificações foram marcadas como lidas."); } });
  const createCommunication = trpc.notificacoes.criarComunicado.useMutation({ onSuccess: () => { refreshNotifications(); toast.success("Comunicado publicado."); setTitle(""); setMessage(""); setIsFormOpen(false); }, onError: (issue) => toast.error(issue.message) });
  const [isFormOpen, setIsFormOpen] = useState(false); const [title, setTitle] = useState(""); const [message, setMessage] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); createCommunication.mutate({ title, message }); }
  const isAdmin = profile.data?.role === "administrador";
  const notificationAction = <div className="flex gap-2"><Button variant="outline" disabled={!unread.data?.count || markAllRead.isPending} onClick={() => markAllRead.mutate()} className="h-10 rounded-xl bg-white text-xs">Marcar minhas como lidas</Button>{isAdmin && <Button onClick={() => setIsFormOpen((open) => !open)} className="h-10 rounded-xl bg-[#0f7350] font-semibold text-white hover:bg-[#0a6243]"><MessageSquarePlus className="mr-2 h-4 w-4" />Novo comunicado</Button>}</div>;
  return <div><PageIntro eyebrow="Comunicação" title="Notificações" description={`${unread.data?.count ?? 0} notificação(ões) não lida(s) para você. Toque em uma notificação para ir direto ao que ela fala.`} action={notificationAction} /><section className="rounded-[24px] border border-[#dce8e0] bg-white p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.35)] sm:p-6">{isFormOpen && <form onSubmit={submit} className="mb-5 grid gap-3 rounded-2xl border border-[#cfe1d7] bg-[#f7fbf8] p-4"><label className="grid gap-1.5 text-xs font-semibold">Título<Input required value={title} onChange={(event) => setTitle(event.target.value)} className="h-10 rounded-xl bg-white" /></label><label className="grid gap-1.5 text-xs font-semibold">Mensagem<textarea required value={message} onChange={(event) => setMessage(event.target.value)} className="min-h-24 rounded-xl border border-[#dce8e0] bg-white p-3 text-sm outline-none focus:ring-2 focus:ring-[#0f7350]/30" /></label><div className="flex gap-2"><Button disabled={createCommunication.isPending} className="h-10 rounded-xl bg-[#0f7350] text-white hover:bg-[#0a6243]">Publicar comunicado</Button><Button type="button" variant="ghost" onClick={() => setIsFormOpen(false)} className="h-10 rounded-xl">Cancelar</Button></div></form>}<div className="mb-4 flex gap-2" role="group" aria-label="Filtrar notificações">{(["todas", "nao_lidas"] as const).map((opcao) => <Button key={opcao} size="sm" variant="ghost" aria-pressed={filtro === opcao} onClick={() => setFiltro(opcao)} className={`h-8 rounded-lg px-3 text-xs font-semibold ${filtro === opcao ? "bg-[#0f7350] text-white hover:bg-[#0a6243] hover:text-white" : "text-muted-foreground"}`}>{opcao === "todas" ? "Todas" : `Não lidas (${unread.data?.count ?? 0})`}</Button>)}</div>{isLoading ? <p className="py-12 text-center text-sm text-muted-foreground">Carregando notificações...</p> : !visiveis.length ? <div className="grid min-h-64 place-items-center text-center"><div><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#e8f4ed] text-[#0f7350]"><Bell className="h-5 w-5" /></span><p className="mt-4 text-sm font-semibold">Tudo em dia.</p><p className="mt-1 text-xs text-muted-foreground">{filtro === "nao_lidas" ? "Você já leu todas as notificações." : "As notificações operacionais e comunicados aparecerão aqui."}</p></div></div> : <ul className="divide-y divide-[#edf2ef]">{visiveis.map((item) => { const categoria = categorias[categoriaDoTipo[item.tipo] ?? "sistema"]; const Icone = categoria.icone; const destino = destinoDaNotificacao(item, papel); const expandida = aberta === item.id; return <li key={item.id} className={`flex gap-3 py-4 sm:gap-4 ${item.lidaEm && !expandida ? "opacity-65" : ""}`}><span className={`mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl ${categoria.cor}`}><Icone className="h-[18px] w-[18px]" /></span><div className="min-w-0 flex-1"><button type="button" onClick={() => abrirNotificacao(item)} aria-expanded={destino ? undefined : expandida} title={destino?.rotulo} className="w-full rounded-lg text-left hover:bg-[#f8fbf9]"><span className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2 text-sm font-semibold">{!item.lidaEm && <span className="h-2 w-2 rounded-full bg-[#0f7350]" aria-label="Não lida" />}{item.titulo}</span><span className="text-[11px] text-muted-foreground">{categoria.rotulo} · {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(item.criadoEm)}</span></span><span className={`mt-1 block text-sm leading-6 text-muted-foreground ${expandida || destino ? "" : "line-clamp-2"}`}>{item.mensagem}</span></button>{destino && <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-[#0f7350]">{destino.rotulo}<ArrowRight className="h-3 w-3" /></span>}</div>{!item.lidaEm && <Button size="icon" variant="ghost" onClick={() => markRead.mutate({ id: item.id })} className="h-8 w-8 shrink-0 rounded-lg text-[#0f7350] hover:bg-[#edf7f1]" aria-label="Marcar como lida"><Check className="h-4 w-4" /></Button>}</li>; })}</ul>}</section></div>;
}

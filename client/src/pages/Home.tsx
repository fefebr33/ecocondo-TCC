import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { Button } from "@/components/ui/button";
import { ArrowRight, BarChart3, Bell, Leaf, Recycle, ShieldCheck, UsersRound } from "lucide-react";
import { useEffect } from "react";
import { useLocation } from "wouter";

const benefits = [
  { icon: Recycle, title: "Operação organizada", description: "Planeje, registre e acompanhe as coletas em um único fluxo." },
  { icon: BarChart3, title: "Dados que orientam", description: "Transforme registros de coleta em indicadores e relatórios claros." },
  { icon: UsersRound, title: "Moradores engajados", description: "Use pontuação, ranking e comunicação para estimular participação." },
];

export default function Home() {
  const { isAuthenticated, loading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!loading && isAuthenticated) setLocation("/dashboard");
  }, [isAuthenticated, loading, setLocation]);

  return (
    <div className="min-h-screen overflow-hidden bg-[#f8faf8] text-foreground">
      <header className="mx-auto flex h-[76px] max-w-[1180px] items-center justify-between px-5 sm:px-8">
        <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-2xl bg-[linear-gradient(145deg,#0f7350,#0c4f3a)] text-white"><Leaf className="h-5 w-5" /></span><span><span className="block text-[15px] font-bold tracking-[-.03em]">EcoCondo</span><span className="block text-[10px] font-medium tracking-[.13em] text-muted-foreground uppercase">Gestão circular</span></span></div>
        <div className="flex items-center gap-3">
          {import.meta.env.DEV && <a href="/api/dev/login" className="text-xs font-semibold text-muted-foreground underline-offset-2 hover:underline">Entrar em modo demonstração</a>}
          <Button onClick={() => startLogin()} className="h-10 rounded-xl bg-[#0f7350] px-4 text-sm font-semibold text-white hover:bg-[#0a6243]">Acessar plataforma <ArrowRight className="ml-2 h-4 w-4" /></Button>
        </div>
      </header>
      <main>
        <section className="relative mx-auto max-w-[1180px] px-5 pb-20 pt-14 sm:px-8 sm:pb-28 sm:pt-20">
          <div className="pointer-events-none absolute right-[-220px] top-[-120px] h-[500px] w-[500px] rounded-full bg-[#ddefdf]/65 blur-3xl" />
          <div className="relative max-w-3xl"><p className="inline-flex items-center gap-2 rounded-full border border-[#cfe2d5] bg-white px-3 py-1.5 text-[11px] font-bold tracking-[.1em] text-[#0e6548] uppercase"><span className="h-1.5 w-1.5 rounded-full bg-[#52a66b]" />Sustentabilidade que vira rotina</p><h1 className="mt-7 text-4xl font-bold leading-[.98] tracking-[-.065em] sm:text-6xl lg:text-7xl">O condomínio em sintonia com um futuro <span className="text-[#0e724e]">mais circular.</span></h1><p className="mt-6 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">Uma plataforma para organizar a coleta seletiva, engajar moradores e registrar evidências de impacto ambiental com clareza.</p><div className="mt-9 flex flex-wrap gap-3"><Button onClick={() => startLogin()} className="h-12 rounded-xl bg-[#0f7350] px-5 font-semibold text-white hover:bg-[#0a6243]">Começar a gerir <ArrowRight className="ml-2 h-4 w-4" /></Button><a href="#recursos" className="inline-flex h-12 items-center rounded-xl px-4 text-sm font-semibold text-[#0e6548] hover:bg-[#eaf4ed]">Conhecer recursos</a></div></div>
          <div className="relative mt-14 grid gap-4 rounded-[28px] border border-[#dbe8e0] bg-white p-4 shadow-[0_30px_80px_-38px_rgba(5,67,44,.42)] sm:mt-20 sm:grid-cols-3 sm:p-5"><div className="rounded-2xl bg-[#f0f8f3] p-5 sm:col-span-2"><div className="flex items-center justify-between"><p className="text-sm font-semibold">Visão integrada da operação</p><BarChart3 className="h-5 w-5 text-[#0f7350]" /></div><div className="mt-10 flex h-24 items-end gap-3"><span className="h-[30%] flex-1 rounded-t-lg bg-[#bee2ca]" /><span className="h-[52%] flex-1 rounded-t-lg bg-[#8cc8a1]" /><span className="h-[41%] flex-1 rounded-t-lg bg-[#6bad81]" /><span className="h-[76%] flex-1 rounded-t-lg bg-[#0f7350]" /><span className="h-[61%] flex-1 rounded-t-lg bg-[#4c9d6c]" /></div><p className="mt-3 text-xs text-muted-foreground">Indicadores, coletas e participação em um só lugar.</p></div><div className="rounded-2xl bg-[#0d5c43] p-5 text-white"><span className="grid h-9 w-9 place-items-center rounded-xl bg-white/10"><Bell className="h-[18px] w-[18px]" /></span><p className="mt-5 text-base font-semibold leading-5">Comunicação que acompanha a rotina.</p><p className="mt-3 text-xs leading-5 text-[#cce5d6]">Notificações sobre coletas, status e comunicados importantes.</p></div></div>
        </section>
        <section id="recursos" className="border-y border-[#dce8e0] bg-white"><div className="mx-auto max-w-[1180px] px-5 py-18 sm:px-8 sm:py-22"><div className="max-w-xl"><p className="text-[11px] font-bold tracking-[.14em] text-[#0f7350] uppercase">Da coleta ao impacto</p><h2 className="mt-3 text-3xl font-bold tracking-[-.05em] sm:text-4xl">Feito para tornar o esforço coletivo visível.</h2></div><div className="mt-10 grid gap-4 md:grid-cols-3">{benefits.map((benefit) => { const Icon = benefit.icon; return <article key={benefit.title} className="rounded-[22px] border border-[#deebe3] bg-[#fbfdfb] p-6"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#e8f4ed] text-[#0f7350]"><Icon className="h-5 w-5" /></span><h3 className="mt-5 text-lg font-bold tracking-[-.03em]">{benefit.title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{benefit.description}</p></article>; })}</div></div></section>
        <section className="mx-auto max-w-[1180px] px-5 py-18 sm:px-8 sm:py-24"><div className="rounded-[28px] bg-[linear-gradient(135deg,#0d5c43,#0a3d2d)] px-6 py-10 text-white sm:px-10 sm:py-14"><ShieldCheck className="h-7 w-7 text-[#b9e2c7]" /><h2 className="mt-6 max-w-xl text-3xl font-bold tracking-[-.05em] sm:text-4xl">Informação organizada também é uma forma de cuidar do lugar onde se vive.</h2><p className="mt-4 max-w-2xl text-sm leading-6 text-[#cde4d6]">A plataforma combina controle operacional, transparência e educação ambiental, respeitando o acesso de cada perfil.</p><Button onClick={() => startLogin()} variant="secondary" className="mt-8 h-11 rounded-xl border-0 bg-white px-5 font-semibold text-[#0b533a] hover:bg-[#e8f4ed]">Acessar o EcoCondo <ArrowRight className="ml-2 h-4 w-4" /></Button></div></section>
      </main>
    </div>
  );
}

import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { canAccessRoute, type EcoRole as SharedEcoRole } from "@shared/permissions";
import {
  Bell,
  BookOpenCheck,
  CalendarDays,
  Camera,
  ChevronRight,
  ClipboardList,
  Gift,
  History,
  Leaf,
  LayoutDashboard,
  LogOut,
  Menu,
  Recycle,
  Settings,
  UsersRound,
  X,
} from "lucide-react";
import { ReactNode, useState } from "react";
import { Link, useLocation } from "wouter";

type EcoRole = SharedEcoRole;

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles: EcoRole[];
};

const navigation: NavItem[] = [
  { href: "/dashboard", label: "Visão geral", icon: LayoutDashboard, roles: ["administrador", "coletor", "morador"] },
  { href: "/coletas", label: "Coletas", icon: Recycle, roles: ["administrador", "coletor", "morador"] },
  { href: "/moradores", label: "Moradores", icon: UsersRound, roles: ["administrador"] },
  { href: "/pessoas", label: "Pessoas e acessos", icon: UsersRound, roles: ["administrador"] },
  { href: "/relatorios", label: "Relatórios", icon: ClipboardList, roles: ["administrador"] },
  { href: "/auditoria", label: "Auditoria", icon: History, roles: ["administrador"] },
  { href: "/engajamento", label: "Engajamento", icon: Gift, roles: ["administrador", "morador"] },
  { href: "/guia", label: "Guia de descarte", icon: BookOpenCheck, roles: ["administrador", "coletor", "morador"] },
  { href: "/notificacoes", label: "Notificações", icon: Bell, roles: ["administrador", "coletor", "morador"] },
  { href: "/ambiental", label: "Gestão ambiental", icon: Camera, roles: ["administrador", "coletor", "morador"] },
  { href: "/comunidade", label: "Calendário e campanhas", icon: CalendarDays, roles: ["administrador", "coletor", "morador"] },
  { href: "/configuracoes", label: "Configurações", icon: Settings, roles: ["administrador"] },
];

function resolveRole(role?: string): EcoRole {
  if (role === "admin") return "administrador";
  return "morador";
}

function formatRole(role: EcoRole) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function EcoBrand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/dashboard" className="flex items-center gap-3 group shrink-0">
      <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[linear-gradient(145deg,#0f7350,#0c4f3a)] text-white shadow-[0_12px_30px_-12px_rgba(15,115,80,.65)] transition-transform duration-200 group-hover:-translate-y-0.5">
        <Leaf aria-hidden="true" className="h-5 w-5" strokeWidth={2.25} />
      </span>
      {!compact && (
        <span className="leading-none">
          <span className="block text-[15px] font-bold tracking-[-0.03em] text-foreground">EcoCondo</span>
          <span className="mt-1 block text-[10px] font-medium tracking-[0.13em] text-muted-foreground uppercase">Gestão circular</span>
        </span>
      )}
    </Link>
  );
}

function Navigation({ role, onNavigate }: { role: EcoRole; onNavigate?: () => void }) {
  const [location] = useLocation();
  const visibleItems = navigation.filter((item) => item.roles.includes(role) && canAccessRoute(role, item.href));

  return (
    <nav aria-label="Navegação principal" className="flex flex-col gap-1">
      <p className="px-3 pb-2 pt-1 text-[10px] font-semibold tracking-[0.15em] text-muted-foreground uppercase">
        Área de trabalho
      </p>
      {visibleItems.map((item) => {
        const Icon = item.icon;
        const isActive = location === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`group flex min-h-11 items-center justify-between rounded-xl px-3 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 ${
              isActive
                ? "bg-[linear-gradient(90deg,rgba(15,115,80,.15),rgba(15,115,80,.06))] text-[#07563d] shadow-[inset_0_0_0_1px_rgba(15,115,80,.10)]"
                : "text-muted-foreground hover:bg-[#eef5f1] hover:text-foreground"
            }`}
          >
            <span className="flex items-center gap-3">
              <Icon className={`h-[17px] w-[17px] ${isActive ? "text-[#0f7350]" : "text-muted-foreground group-hover:text-[#0f7350]"}`} strokeWidth={isActive ? 2.35 : 1.9} />
              {item.label}
            </span>
            {isActive && <ChevronRight className="h-3.5 w-3.5 text-[#0f7350]" />}
          </Link>
        );
      })}
    </nav>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { loading, user, logout } = useAuth();
  const [isDrawerOpen, setDrawerOpen] = useState(false);
  const profileQuery = trpc.profile.me.useQuery(undefined, { enabled: Boolean(user) });
  const unreadNotifications = trpc.notifications.unreadCount.useQuery(undefined, { enabled: Boolean(user) });

  if (loading) {
    return <div className="min-h-screen bg-[#f6f8f6]" aria-busy="true" />;
  }

  if (!user) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#f5f8f5] px-5 py-10">
        <section className="w-full max-w-md rounded-[28px] border border-[#dbe8e0] bg-white p-8 text-center shadow-[0_24px_70px_-35px_rgba(9,68,47,.35)] sm:p-10">
          <div className="mx-auto mb-7 w-fit"><EcoBrand compact /></div>
          <Badge className="mb-4 border-0 bg-[#e8f5ed] px-3 py-1 text-[11px] font-semibold text-[#0a6947] hover:bg-[#e8f5ed]">ACESSO PROTEGIDO</Badge>
          <h1 className="text-2xl font-bold tracking-[-0.04em] text-foreground">Entre para gerir um condomínio mais circular.</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">Acesse o EcoCondo para acompanhar coletas, moradores, indicadores e comunicações da sua comunidade.</p>
          <Button onClick={() => startLogin()} className="mt-8 h-11 w-full rounded-xl bg-[#0f7350] font-semibold text-white hover:bg-[#0a6243]">Entrar na plataforma</Button>
        </section>
      </div>
    );
  }

  const role = (profileQuery.data?.role as EcoRole | undefined) ?? resolveRole(user.role);
  const initials = (user.name || "Usuário")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <div className="min-h-screen bg-[#f6f8f6] text-foreground">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[272px] flex-col border-r border-[#dce8e0] bg-white px-4 py-5 lg:flex">
        <EcoBrand />
        <div className="my-7 h-px bg-[#e8efeb]" />
        <Navigation role={role} />
        <div className="mt-auto rounded-2xl border border-[#dcebe2] bg-[linear-gradient(145deg,#f0f8f3,#fbfdfb)] p-3.5">
          <p className="text-xs font-semibold text-[#0c563d]">Dica de operação</p>
          <p className="mt-1.5 text-xs leading-5 text-muted-foreground">Atualize o status das coletas no mesmo dia para manter os indicadores consistentes.</p>
        </div>
      </aside>

      <header className="sticky top-0 z-30 h-[72px] border-b border-[#dce8e0]/90 bg-[#f6f8f6]/90 px-5 backdrop-blur-xl lg:ml-[272px] lg:px-9">
        <div className="mx-auto flex h-full max-w-[1600px] items-center justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="icon" className="-ml-2 rounded-xl text-muted-foreground lg:hidden" onClick={() => setDrawerOpen(true)} aria-label="Abrir menu">
              <Menu className="h-5 w-5" />
            </Button>
            <div className="hidden sm:block">
              <p className="text-xs font-medium text-muted-foreground">Condomínio</p>
              <p className="truncate text-sm font-semibold tracking-[-0.02em]">{profileQuery.data?.condominium.name || "Carregando condomínio"}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/notificacoes" aria-label={`Abrir notificações${unreadNotifications.data?.count ? `, ${unreadNotifications.data.count} não lidas` : ""}`} className="relative grid h-10 w-10 place-items-center rounded-xl border border-[#dfe9e3] bg-white text-muted-foreground transition-colors hover:bg-[#edf7f1] hover:text-[#0f7350] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70">
              <Bell className="h-[18px] w-[18px]" />
              {unreadNotifications.data?.count ? <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-[#e67948] px-1 text-[10px] font-bold text-white ring-2 ring-[#f6f8f6]">{unreadNotifications.data.count > 99 ? "99+" : unreadNotifications.data.count}</span> : null}
            </Link>
            <div className="hidden h-7 w-px bg-[#dce8e0] sm:block" />
            <div className="flex items-center gap-2.5">
              <Avatar className="h-9 w-9 border border-[#dce8e0] bg-[#e8f4ed]">
                <AvatarFallback className="bg-[#e8f4ed] text-xs font-bold text-[#0b6145]">{initials}</AvatarFallback>
              </Avatar>
              <div className="hidden min-w-0 sm:block">
                <p className="max-w-[155px] truncate text-sm font-semibold leading-4">{user.name || "Usuário EcoCondo"}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{formatRole(role)}</p>
              </div>
              <Button variant="ghost" size="icon" className="hidden h-8 w-8 rounded-lg text-muted-foreground hover:text-destructive sm:inline-flex" onClick={logout} aria-label="Sair da conta">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="px-5 py-7 lg:ml-[272px] lg:px-9 lg:py-9"><div className="mx-auto max-w-[1600px]">{children}</div></main>

      {isDrawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu principal">
          <button onClick={() => setDrawerOpen(false)} className="absolute inset-0 bg-[#062e20]/35 backdrop-blur-[2px]" aria-label="Fechar menu" />
          <aside className="relative flex h-full w-[286px] flex-col bg-white px-4 py-5 shadow-2xl">
            <div className="flex items-center justify-between"><EcoBrand /><Button variant="ghost" size="icon" className="rounded-xl" onClick={() => setDrawerOpen(false)} aria-label="Fechar menu"><X className="h-5 w-5" /></Button></div>
            <div className="my-7 h-px bg-[#e8efeb]" />
            <Navigation role={role} onNavigate={() => setDrawerOpen(false)} />
            <Button variant="ghost" className="mt-auto justify-start gap-3 rounded-xl px-3 text-muted-foreground hover:text-destructive" onClick={logout}><LogOut className="h-4 w-4" />Sair da conta</Button>
          </aside>
        </div>
      )}
    </div>
  );
}

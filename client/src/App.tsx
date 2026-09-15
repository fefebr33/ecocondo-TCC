import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import AppShell from "@/components/AppShell";
import { ThemeProvider } from "@/contexts/ThemeContext";
import Dashboard from "@/pages/Dashboard";
import Collections from "@/pages/Collections";
import DisposalGuide from "@/pages/DisposalGuide";
import Engagement from "@/pages/Engagement";
import Home from "@/pages/Home";
import Login from "@/pages/Login";
import ModulePlaceholder from "@/pages/ModulePlaceholder";
import NotFound from "@/pages/NotFound";
import Notifications from "@/pages/Notifications";
import People from "@/pages/People";
import Residents from "@/pages/Residents";
import Reports from "@/pages/Reports";
import Settings from "@/pages/Settings";
import Sustainability from "@/pages/Sustainability";
import Community from "@/pages/Community";
import Audit from "@/pages/Audit";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/entrar" component={Login} />
      <Route path="/dashboard"><ProtectedRoute><Dashboard /></ProtectedRoute></Route>
      <Route path="/coletas"><ProtectedRoute><Collections /></ProtectedRoute></Route>
      <Route path="/moradores"><ProtectedRoute><Residents /></ProtectedRoute></Route>
      <Route path="/pessoas"><ProtectedRoute><People /></ProtectedRoute></Route>
      <Route path="/relatorios"><ProtectedRoute><Reports /></ProtectedRoute></Route>
      <Route path="/auditoria"><ProtectedRoute><Audit /></ProtectedRoute></Route>
      <Route path="/engajamento"><ProtectedRoute><Engagement /></ProtectedRoute></Route>
      <Route path="/guia"><ProtectedRoute><DisposalGuide /></ProtectedRoute></Route>
      <Route path="/notificacoes"><ProtectedRoute><Notifications /></ProtectedRoute></Route>
      <Route path="/ambiental"><ProtectedRoute><Sustainability /></ProtectedRoute></Route>
      <Route path="/comunidade"><ProtectedRoute><Community /></ProtectedRoute></Route>
      <Route path="/configuracoes"><ProtectedRoute><Settings /></ProtectedRoute></Route>
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return <ErrorBoundary><ThemeProvider defaultTheme="light"><TooltipProvider><Toaster /><Router /></TooltipProvider></ThemeProvider></ErrorBoundary>;
}

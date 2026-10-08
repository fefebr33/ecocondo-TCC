import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import AppShell from "@/components/AppShell";
import { ThemeProvider } from "@/contexts/ThemeContext";
import Inicio from "@/paginas/Inicio";
import Entrar from "@/paginas/Entrar";
import NaoEncontrado from "@/paginas/NaoEncontrado";
import { Redirect, Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { lazy, Suspense } from "react";

// Cada tela é baixada só quando é aberta (o tablet da estação não precisa baixar relatórios, planilhas e painéis).
const Painel = lazy(() => import("@/paginas/Painel"));
const Descartes = lazy(() => import("@/paginas/Descartes"));
const Manual = lazy(() => import("@/paginas/Manual"));
const PainelMorador = lazy(() => import("@/paginas/PainelMorador"));
const DefinirSenha = lazy(() => import("@/paginas/DefinirSenha"));
const GuiaDescarte = lazy(() => import("@/paginas/GuiaDescarte"));
const Engajamento = lazy(() => import("@/paginas/Engajamento"));
const Podio = lazy(() => import("@/paginas/Podio"));
const EmDesenvolvimento = lazy(() => import("@/paginas/EmDesenvolvimento"));
const Notificacoes = lazy(() => import("@/paginas/Notificacoes"));
const Pessoas = lazy(() => import("@/paginas/Pessoas"));
const Moradores = lazy(() => import("@/paginas/Moradores"));
const Relatorios = lazy(() => import("@/paginas/Relatorios"));
const Configuracoes = lazy(() => import("@/paginas/Configuracoes"));
const Sustentabilidade = lazy(() => import("@/paginas/Sustentabilidade"));
const Comunidade = lazy(() => import("@/paginas/Comunidade"));
const Auditoria = lazy(() => import("@/paginas/Auditoria"));
const Estacao = lazy(() => import("@/paginas/Estacao"));
const Adesivos = lazy(() => import("@/paginas/Adesivos"));
const LeituraQr = lazy(() => import("@/paginas/LeituraQr"));

function CarregandoTela() {
  return (
    <p role="status" className="p-6 text-sm text-muted-foreground">
      Carregando...
    </p>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  // O menu fica na tela enquanto a página escolhida é baixada.
  return (
    <AppShell>
      <Suspense fallback={<CarregandoTela />}>{children}</Suspense>
    </AppShell>
  );
}

function Router() {
  return (
    <Suspense fallback={<CarregandoTela />}>
      <Switch>
        <Route path="/" component={Inicio} />
        <Route path="/entrar" component={Entrar} />
        <Route path="/estacao" component={Estacao} />
        <Route path="/dashboard">
          <ProtectedRoute>
            <Painel />
          </ProtectedRoute>
        </Route>
        <Route path="/definir-senha" component={DefinirSenha} />
        <Route path="/descartes">
          <ProtectedRoute>
            <Descartes />
          </ProtectedRoute>
        </Route>
        <Route path="/coletas">
          <Redirect to="/descartes" replace />
        </Route>
        <Route path="/adesivos">
          <ProtectedRoute>
            <Adesivos />
          </ProtectedRoute>
        </Route>
        <Route path="/leitura">
          <ProtectedRoute>
            <LeituraQr />
          </ProtectedRoute>
        </Route>
        <Route path="/manual">
          <ProtectedRoute>
            <Manual />
          </ProtectedRoute>
        </Route>
        <Route path="/moradores/painel">
          <ProtectedRoute>
            <PainelMorador />
          </ProtectedRoute>
        </Route>
        <Route path="/moradores">
          <ProtectedRoute>
            <Moradores />
          </ProtectedRoute>
        </Route>
        <Route path="/pessoas">
          <ProtectedRoute>
            <Pessoas />
          </ProtectedRoute>
        </Route>
        <Route path="/relatorios">
          <ProtectedRoute>
            <Relatorios />
          </ProtectedRoute>
        </Route>
        <Route path="/auditoria">
          <ProtectedRoute>
            <Auditoria />
          </ProtectedRoute>
        </Route>
        <Route path="/engajamento">
          <ProtectedRoute>
            <Engajamento />
          </ProtectedRoute>
        </Route>
        <Route path="/podio">
          <ProtectedRoute>
            <Podio />
          </ProtectedRoute>
        </Route>
        <Route path="/guia">
          <ProtectedRoute>
            <GuiaDescarte />
          </ProtectedRoute>
        </Route>
        <Route path="/notificacoes">
          <ProtectedRoute>
            <Notificacoes />
          </ProtectedRoute>
        </Route>
        <Route path="/ambiental">
          <ProtectedRoute>
            <Sustentabilidade />
          </ProtectedRoute>
        </Route>
        <Route path="/comunidade">
          <ProtectedRoute>
            <Comunidade />
          </ProtectedRoute>
        </Route>
        <Route path="/configuracoes">
          <ProtectedRoute>
            <Configuracoes />
          </ProtectedRoute>
        </Route>
        <Route path="/404" component={NaoEncontrado} />
        <Route component={NaoEncontrado} />
      </Switch>
    </Suspense>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

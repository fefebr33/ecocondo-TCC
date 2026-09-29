import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import AppShell from "@/components/AppShell";
import { ThemeProvider } from "@/contexts/ThemeContext";
import Painel from "@/paginas/Painel";
import Descartes from "@/paginas/Descartes";
import Manual from "@/paginas/Manual";
import PainelMorador from "@/paginas/PainelMorador";
import DefinirSenha from "@/paginas/DefinirSenha";
import GuiaDescarte from "@/paginas/GuiaDescarte";
import Engajamento from "@/paginas/Engajamento";
import Podio from "@/paginas/Podio";
import Inicio from "@/paginas/Inicio";
import Entrar from "@/paginas/Entrar";
import EmDesenvolvimento from "@/paginas/EmDesenvolvimento";
import NaoEncontrado from "@/paginas/NaoEncontrado";
import Notificacoes from "@/paginas/Notificacoes";
import Pessoas from "@/paginas/Pessoas";
import Moradores from "@/paginas/Moradores";
import Relatorios from "@/paginas/Relatorios";
import Configuracoes from "@/paginas/Configuracoes";
import Sustentabilidade from "@/paginas/Sustentabilidade";
import Comunidade from "@/paginas/Comunidade";
import Auditoria from "@/paginas/Auditoria";
import Estacao from "@/paginas/Estacao";
import { Redirect, Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Inicio} />
      <Route path="/entrar" component={Entrar} />
      <Route path="/estacao" component={Estacao} />
      <Route path="/dashboard"><ProtectedRoute><Painel /></ProtectedRoute></Route>
      <Route path="/definir-senha" component={DefinirSenha} />
      <Route path="/descartes"><ProtectedRoute><Descartes /></ProtectedRoute></Route>
      <Route path="/coletas"><Redirect to="/descartes" replace /></Route>
      <Route path="/manual"><ProtectedRoute><Manual /></ProtectedRoute></Route>
      <Route path="/moradores/painel"><ProtectedRoute><PainelMorador /></ProtectedRoute></Route>
      <Route path="/moradores"><ProtectedRoute><Moradores /></ProtectedRoute></Route>
      <Route path="/pessoas"><ProtectedRoute><Pessoas /></ProtectedRoute></Route>
      <Route path="/relatorios"><ProtectedRoute><Relatorios /></ProtectedRoute></Route>
      <Route path="/auditoria"><ProtectedRoute><Auditoria /></ProtectedRoute></Route>
      <Route path="/engajamento"><ProtectedRoute><Engajamento /></ProtectedRoute></Route>
      <Route path="/podio"><ProtectedRoute><Podio /></ProtectedRoute></Route>
      <Route path="/guia"><ProtectedRoute><GuiaDescarte /></ProtectedRoute></Route>
      <Route path="/notificacoes"><ProtectedRoute><Notificacoes /></ProtectedRoute></Route>
      <Route path="/ambiental"><ProtectedRoute><Sustentabilidade /></ProtectedRoute></Route>
      <Route path="/comunidade"><ProtectedRoute><Comunidade /></ProtectedRoute></Route>
      <Route path="/configuracoes"><ProtectedRoute><Configuracoes /></ProtectedRoute></Route>
      <Route path="/404" component={NaoEncontrado} />
      <Route component={NaoEncontrado} />
    </Switch>
  );
}

export default function App() {
  return <ErrorBoundary><ThemeProvider defaultTheme="light" switchable><TooltipProvider><Toaster /><Router /></TooltipProvider></ThemeProvider></ErrorBoundary>;
}

import BotaoTema from "@/components/BotaoTema";
import { Button } from "@/components/ui/button";
import { CampoSenha } from "@/components/ui/campo-senha";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import {
  ArrowRight,
  KeyRound,
  Leaf,
  LogIn,
  Scale,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { FormEvent, useState } from "react";
import { Link } from "wouter";

type RoleOption = {
  role: "administrador" | "morador";
  title: string;
  description: string;
  icon: typeof ShieldCheck;
};

const roles: RoleOption[] = [
  {
    role: "administrador",
    title: "Administrador",
    description:
      "Aprova descartes, gerencia moradores, relatórios, auditoria e configurações do condomínio.",
    icon: ShieldCheck,
  },
  {
    role: "morador",
    title: "Morador",
    description:
      "Registra os próprios descartes na estação de pesagem, acompanha o painel pessoal e resgata recompensas.",
    icon: UsersRound,
  },
];

function FormularioSenha() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [modo, setModo] = useState<"entrar" | "link">("entrar");
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const entrar = trpc.auth.entrarComSenha.useMutation({
    onSuccess: resultado => {
      window.location.href = resultado.manualLido ? "/dashboard" : "/manual";
    },
    onError: issue => setErro(issue.message),
  });
  const pedirLink = trpc.auth.solicitarLink.useMutation({
    onSuccess: () =>
      setAviso(
        "Se o e-mail estiver cadastrado, o síndico pode enviar o link para criar ou trocar a senha (em Pessoas e acessos). Fale com a administração."
      ),
    onError: issue => setErro(issue.message),
  });
  function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErro(null);
    setAviso(null);
    if (modo === "entrar") entrar.mutate({ email, senha });
    else pedirLink.mutate({ email });
  }
  return (
    <form
      onSubmit={enviar}
      className="mt-8 grid gap-3 rounded-[22px] border border-[#dbe8e0] bg-white p-5 shadow-[0_18px_50px_-30px_rgba(9,68,47,.35)] sm:p-6"
    >
      <p className="flex items-center gap-2 text-base font-bold tracking-[-.02em]">
        {modo === "entrar" ? (
          <>
            <LogIn className="h-5 w-5 text-[#0f7350]" />
            Entrar com e-mail e senha
          </>
        ) : (
          <>
            <KeyRound className="h-5 w-5 text-[#0f7350]" />
            Primeiro acesso ou senha esquecida
          </>
        )}
      </p>
      <label className="grid gap-1.5 text-xs font-semibold">
        E-mail
        <Input
          required
          type="email"
          autoComplete="email"
          value={email}
          onChange={event => setEmail(event.target.value)}
          className="h-11 rounded-xl"
        />
      </label>
      {modo === "entrar" && (
        <label className="grid gap-1.5 text-xs font-semibold">
          Senha
          <CampoSenha
            required
            autoComplete="current-password"
            value={senha}
            onChange={event => setSenha(event.target.value)}
            className="h-11 rounded-xl"
          />
        </label>
      )}
      {erro && (
        <p
          role="alert"
          className="rounded-xl bg-[#fbeceb] px-4 py-3 text-sm text-[#b3382c]"
        >
          {erro}
        </p>
      )}
      {aviso && (
        <p
          role="status"
          className="rounded-xl bg-[#eef7f1] px-4 py-3 text-sm text-[#0a5a3c]"
        >
          {aviso}
        </p>
      )}
      <Button
        disabled={entrar.isPending || pedirLink.isPending}
        className="h-11 rounded-xl bg-[#0f7350] font-semibold text-white hover:bg-[#0a6243]"
      >
        {modo === "entrar"
          ? entrar.isPending
            ? "Entrando..."
            : "Entrar"
          : pedirLink.isPending
            ? "Gerando..."
            : "Receber link para criar a senha"}
      </Button>
      <button
        type="button"
        onClick={() => {
          setModo(modo === "entrar" ? "link" : "entrar");
          setErro(null);
          setAviso(null);
        }}
        className="text-left text-sm font-semibold text-[#0f7350] hover:underline"
      >
        {modo === "entrar"
          ? "Primeiro acesso ou esqueci minha senha"
          : "Voltar para o login"}
      </button>
    </form>
  );
}

export default function Login() {
  const configuracao = trpc.auth.configuracao.useQuery();
  const demonstracao = configuracao.data?.demonstracao ?? false;
  return (
    <div className="min-h-screen bg-[#f8faf8] text-foreground">
      <header className="mx-auto flex h-[76px] max-w-[1180px] items-center justify-between px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[linear-gradient(145deg,#0f7350,#0c4f3a)] text-white">
            <Leaf className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-[15px] font-bold tracking-[-.03em]">
              EcoCondo
            </span>
            <span className="block text-[10px] font-medium tracking-[.13em] text-muted-foreground uppercase">
              Gestão circular
            </span>
          </span>
        </Link>
        <BotaoTema />
      </header>

      <main className="mx-auto max-w-[720px] px-5 pb-20 pt-6 sm:px-8">
        <h1 className="text-3xl font-bold tracking-[-.05em] sm:text-4xl">
          Entrar no EcoCondo
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
          Use o e-mail cadastrado pela administração do condomínio. No primeiro
          acesso, crie a sua senha pelo link.
        </p>
        <FormularioSenha />
        {demonstracao && (
          <>
            <p className="mt-10 inline-flex items-center gap-2 rounded-full border border-[#cfe2d5] bg-white px-3 py-1.5 text-[11px] font-bold tracking-[.1em] text-[#0e6548] uppercase">
              <span className="h-1.5 w-1.5 rounded-full bg-[#52a66b]" />
              Demonstração: entrar sem senha
            </p>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
              Para a apresentação, escolha um perfil. (Com senha:
              admin@ecocondo.local ou morador@ecocondo.local, senha
              ecocondo123.)
            </p>
            <div className="mt-9 grid gap-4">
              {roles.map(({ role, title, description, icon: Icon }) => (
                <a
                  key={role}
                  href={`/api/auth/entrar?role=${role}`}
                  className="group flex items-center gap-4 rounded-[22px] border border-[#dbe8e0] bg-white p-5 shadow-[0_18px_50px_-30px_rgba(9,68,47,.35)] transition-colors hover:border-[#0f7350]/40 hover:bg-[#f7fbf8]"
                >
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#e8f4ed] text-[#0f7350]">
                    <Icon className="h-6 w-6" />
                  </span>
                  <span className="flex-1">
                    <span className="block text-base font-bold tracking-[-.02em]">
                      {title}
                    </span>
                    <span className="mt-1 block text-sm leading-5 text-muted-foreground">
                      {description}
                    </span>
                  </span>
                  <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-[#0f7350]" />
                </a>
              ))}
            </div>
          </>
        )}

        <Link
          href="/estacao"
          className="mt-4 flex items-center gap-4 rounded-[22px] border border-dashed border-[#b9d8c5] bg-[#f7fbf8] p-5 transition-colors hover:border-[#0f7350]/50"
        >
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white text-[#0f7350]">
            <Scale className="h-6 w-6" />
          </span>
          <span className="flex-1">
            <span className="block text-base font-bold tracking-[-.02em]">
              Estação de pesagem (tablet)
            </span>
            <span className="mt-1 block text-sm leading-5 text-muted-foreground">
              Tela do tablet ao lado das lixeiras. Precisa do código de
              pareamento criado pelo administrador em Configurações.
            </span>
          </span>
          <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground" />
        </Link>
      </main>
    </div>
  );
}

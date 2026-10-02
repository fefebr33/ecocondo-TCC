import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { KeyRound, Leaf } from "lucide-react";
import { FormEvent, useState } from "react";
import { Link, useSearch } from "wouter";

/** Link de primeiro acesso ou de nova senha: a pessoa cria a senha e já entra. */
export default function DefinirSenha() {
  const token = new URLSearchParams(useSearch()).get("token") ?? "";
  const link = trpc.auth.lerLink.useQuery(
    { token },
    { enabled: token.length >= 20, retry: false }
  );
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const definir = trpc.auth.definirSenha.useMutation({
    onSuccess: resultado => {
      window.location.href = resultado.manualLido ? "/dashboard" : "/manual";
    },
    onError: issue => setErro(issue.message),
  });
  function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (senha !== confirmacao) {
      setErro("As duas senhas estão diferentes.");
      return;
    }
    setErro(null);
    definir.mutate({ token, senha });
  }
  const valido = link.data?.valido;
  return (
    <div className="grid min-h-screen place-items-center bg-[#f5f8f5] px-5 py-10">
      <section className="w-full max-w-md rounded-[28px] border border-[#dbe8e0] bg-white p-8 shadow-[0_24px_70px_-35px_rgba(9,68,47,.35)]">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[linear-gradient(145deg,#0f7350,#0c4f3a)] text-white">
          <Leaf className="h-5 w-5" />
        </span>
        {link.isLoading ? (
          <p className="mt-6 text-sm text-muted-foreground">
            Conferindo o link...
          </p>
        ) : !valido ? (
          <>
            <h1 className="mt-6 text-2xl font-bold tracking-[-.04em]">
              Link expirado ou já usado
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Peça um novo link na tela de login ("Primeiro acesso ou esqueci
              minha senha") ou para a administração do condomínio.
            </p>
            <Link
              href="/entrar"
              className="mt-6 inline-flex h-11 items-center rounded-xl bg-[#0f7350] px-5 text-sm font-semibold text-white"
            >
              Ir para o login
            </Link>
          </>
        ) : (
          <form onSubmit={enviar} className="mt-6 grid gap-3">
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-[-.04em]">
              <KeyRound className="h-6 w-6 text-[#0f7350]" />
              {link.data?.valido && link.data.tipo === "primeiro_acesso"
                ? "Crie sua senha"
                : "Crie uma nova senha"}
            </h1>
            <p className="text-sm text-muted-foreground">
              Para {link.data?.valido ? link.data.email : ""}. Use pelo menos 8
              caracteres, com letras e números.
            </p>
            <label className="grid gap-1.5 text-xs font-semibold">
              Nova senha
              <Input
                required
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={senha}
                onChange={event => setSenha(event.target.value)}
                className="h-11 rounded-xl"
              />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold">
              Repita a senha
              <Input
                required
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={confirmacao}
                onChange={event => setConfirmacao(event.target.value)}
                className="h-11 rounded-xl"
              />
            </label>
            {erro && (
              <p
                role="alert"
                className="rounded-xl bg-[#fbeceb] px-4 py-3 text-sm text-[#b3382c]"
              >
                {erro}
              </p>
            )}
            <Button
              disabled={definir.isPending}
              className="h-11 rounded-xl bg-[#0f7350] font-semibold text-white hover:bg-[#0a6243]"
            >
              {definir.isPending ? "Salvando..." : "Salvar senha e entrar"}
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}

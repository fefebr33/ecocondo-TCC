import PageIntro from "@/components/PageIntro";
import {
  manualAdministrador,
  manualEstacao,
  manualMorador,
  perguntasAdministrador,
  perguntasMorador,
  PerguntasFrequentes,
  SecoesManual,
} from "@/components/Manual";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

/** Manual do sistema e da estação. No primeiro acesso é obrigatório: a pessoa lê e marca "Li e entendi". */
export default function Manual() {
  const utils = trpc.useUtils();
  const [, navegar] = useLocation();
  const eu = trpc.auth.me.useQuery();
  const perfil = trpc.perfil.meuPerfil.useQuery();
  const guias = trpc.guias.listar.useQuery();
  const [marcado, setMarcado] = useState(false);
  const marcar = trpc.auth.marcarManualLido.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      toast.success("Pronto! O manual continua disponível no menu.");
      navegar("/dashboard");
    },
    onError: issue => toast.error(issue.message),
  });
  const ehAdmin = perfil.data?.role === "administrador";
  const primeiraVez = eu.data ? !eu.data.manualLido : false;
  const secoesSistema = ehAdmin ? manualAdministrador : manualMorador;
  const cores = Object.fromEntries(
    (guias.data ?? []).map(guia => [guia.tipoResiduo, guia.nomeCorSaco])
  );
  return (
    <div>
      <PageIntro
        eyebrow={primeiraVez ? "Primeiro acesso" : "Ajuda"}
        title="Manual do EcoCondo"
        description={
          primeiraVez
            ? "Antes de começar, leia como o sistema e a estação de pesagem funcionam. Ao terminar, marque que leu. Você pode voltar aqui quando quiser pelo menu."
            : "Como usar o sistema e a estação de pesagem. Consulte sempre que precisar."
        }
      />
      <nav
        aria-label="Sumário do manual"
        className="mb-5 rounded-[24px] border border-[#dce8e0] bg-white p-5 sm:p-6"
      >
        <p className="text-xs font-bold uppercase tracking-[.12em] text-muted-foreground">
          Neste manual
        </p>
        <ol className="mt-2 grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {secoesSistema.map((secao, indice) => (
            <li key={secao.titulo}>
              <a
                href={`#manual-${indice}`}
                className="font-medium text-[#0f7350] hover:underline"
              >
                {indice + 1}. {secao.titulo}
              </a>
            </li>
          ))}
          <li>
            <a
              href="#manual-estacao"
              className="font-medium text-[#0f7350] hover:underline"
            >
              {secoesSistema.length + 1}. Estação de pesagem (tablet)
            </a>
          </li>
          <li>
            <a
              href="#manual-perguntas"
              className="font-medium text-[#0f7350] hover:underline"
            >
              {secoesSistema.length + 2}. Perguntas frequentes
            </a>
          </li>
        </ol>
      </nav>
      <div className="grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
        <section className="rounded-[24px] border border-[#dce8e0] bg-white p-5 sm:p-6">
          <h2 className="text-lg font-bold tracking-[-.03em]">
            {ehAdmin ? "Sistema: administração" : "Sistema: morador"}
          </h2>
          <div className="mt-4 grid gap-4">
            {secoesSistema.map((secao, indice) => (
              <div
                key={secao.titulo}
                id={`manual-${indice}`}
                className="scroll-mt-24"
              >
                <SecoesManual secoes={[secao]} />
              </div>
            ))}
          </div>
        </section>
        <div className="grid content-start gap-6">
          <section
            id="manual-estacao"
            className="scroll-mt-24 rounded-[24px] border border-[#dce8e0] bg-white p-5 sm:p-6"
          >
            <h2 className="text-lg font-bold tracking-[-.03em]">
              Estação de pesagem (tablet)
            </h2>
            <div className="mt-4">
              <SecoesManual secoes={manualEstacao(cores)} />
            </div>
          </section>
          <section
            id="manual-perguntas"
            className="scroll-mt-24 rounded-[24px] border border-[#dce8e0] bg-white p-5 sm:p-6"
          >
            <h2 className="text-lg font-bold tracking-[-.03em]">
              Perguntas frequentes
            </h2>
            <div className="mt-4">
              <PerguntasFrequentes
                perguntas={ehAdmin ? perguntasAdministrador : perguntasMorador}
              />
            </div>
          </section>
        </div>
      </div>
      {primeiraVez ? (
        <section className="mt-6 flex flex-col gap-3 rounded-[24px] border border-[#cfe1d7] bg-[#f7fbf8] p-5 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={marcado}
              onChange={event => setMarcado(event.target.checked)}
              className="mt-1 h-4 w-4 accent-[#0f7350]"
            />
            <span>
              Li o manual e entendi como registrar e acompanhar os descartes.
            </span>
          </label>
          <Button
            disabled={!marcado || marcar.isPending}
            onClick={() => marcar.mutate()}
            className="h-11 rounded-xl bg-[#0f7350] px-6 font-semibold text-white hover:bg-[#0a6243]"
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            {marcar.isPending ? "Salvando..." : "Li e entendi"}
          </Button>
        </section>
      ) : eu.data?.manualLidoEm ? (
        <p className="mt-6 text-xs text-muted-foreground">
          Você marcou a leitura em{" "}
          {new Date(eu.data.manualLidoEm).toLocaleString("pt-BR")}.
        </p>
      ) : null}
    </div>
  );
}

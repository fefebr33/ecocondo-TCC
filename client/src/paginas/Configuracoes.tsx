import PageIntro from "@/components/PageIntro";
import EstacoesPesagem from "@/components/EstacoesPesagem";
import {
  ConfiguracaoAnaliseIa,
  MedidasAdministrativas,
} from "@/components/ConfiguracoesIa";
import {
  PreferenciasAvisos,
  RegrasDescarte,
  ZerarPontos,
} from "@/components/ConfiguracoesDescarte";
import { useAncora } from "@/hooks/useAncora";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { ShieldCheck } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";

export default function Settings() {
  const utils = trpc.useUtils();
  const condominium = trpc.condominio.atual.useQuery();
  const updateCondominium = trpc.condominio.atualizar.useMutation({
    onSuccess: () => {
      utils.condominio.atual.invalidate();
      utils.perfil.meuPerfil.invalidate();
      toast.success("Dados do condomínio atualizados.");
    },
    onError: issue => toast.error(issue.message),
  });
  useAncora(!condominium.isLoading);
  const [form, setForm] = useState({
    name: "",
    address: "",
    city: "",
    state: "",
    blockCount: 1,
  });
  useEffect(() => {
    if (condominium.data)
      setForm({
        name: condominium.data.nome,
        address: condominium.data.endereco || "",
        city: condominium.data.cidade || "",
        state: condominium.data.estado || "",
        blockCount: condominium.data.quantidadeBlocos,
      });
  }, [condominium.data]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateCondominium.mutate({
      ...form,
      address: form.address || null,
      city: form.city || null,
      state: form.state ? form.state.toUpperCase() : null,
    });
  }
  return (
    <div>
      <PageIntro
        eyebrow="Administração"
        title="Configurações"
        description="Dados do condomínio, regras de cada tipo de descarte, análise automática, medidas administrativas, avisos por perfil, ciclo de pontos e estações de pesagem. Pessoas e perfis de acesso ficam em Pessoas e acessos."
      />
      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-[24px] border border-[#dce8e0] bg-white p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.35)] sm:p-6">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e8f4ed] text-[#0f7350]">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div>
              <p className="font-semibold">Dados do condomínio</p>
              <p className="text-sm text-muted-foreground">
                Informações visíveis nos relatórios.
              </p>
            </div>
          </div>
          <form onSubmit={submit} className="mt-5 grid gap-3">
            <label className="grid gap-1.5 text-xs font-semibold">
              Nome
              <Input
                required
                value={form.name}
                onChange={event =>
                  setForm({ ...form, name: event.target.value })
                }
                className="h-10 rounded-xl bg-[#fbfdfc]"
              />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold">
              Endereço
              <Input
                value={form.address}
                onChange={event =>
                  setForm({ ...form, address: event.target.value })
                }
                className="h-10 rounded-xl bg-[#fbfdfc]"
              />
            </label>
            <div className="grid grid-cols-[1fr_70px] gap-3">
              <label className="grid gap-1.5 text-xs font-semibold">
                Cidade
                <Input
                  value={form.city}
                  onChange={event =>
                    setForm({ ...form, city: event.target.value })
                  }
                  className="h-10 rounded-xl bg-[#fbfdfc]"
                />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold">
                UF
                <Input
                  maxLength={2}
                  value={form.state}
                  onChange={event =>
                    setForm({ ...form, state: event.target.value })
                  }
                  className="h-10 rounded-xl bg-[#fbfdfc]"
                />
              </label>
            </div>
            <label className="grid gap-1.5 text-xs font-semibold">
              Quantidade de blocos
              <Input
                required
                type="number"
                min="1"
                max="99"
                value={form.blockCount}
                onChange={event =>
                  setForm({ ...form, blockCount: Number(event.target.value) })
                }
                className="h-10 rounded-xl bg-[#fbfdfc]"
              />
            </label>
            <Button
              disabled={updateCondominium.isPending}
              className="mt-2 h-10 rounded-xl bg-[#0f7350] text-white hover:bg-[#0a6243]"
            >
              Salvar configurações
            </Button>
          </form>
        </section>
        <div id="pontos" className="scroll-mt-24">
          <ZerarPontos />
        </div>
      </div>
      <div id="regras" className="mt-5 scroll-mt-24">
        <RegrasDescarte />
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <div id="ia" className="min-w-0 scroll-mt-24">
          <ConfiguracaoAnaliseIa />
        </div>
        <div id="medidas" className="min-w-0 scroll-mt-24">
          <MedidasAdministrativas />
        </div>
      </div>
      <div id="avisos" className="mt-5 scroll-mt-24">
        <PreferenciasAvisos />
      </div>
      <div id="estacoes" className="scroll-mt-24">
        <EstacoesPesagem />
      </div>
    </div>
  );
}

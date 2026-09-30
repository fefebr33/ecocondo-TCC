import PageIntro from "@/components/PageIntro";
import PainelPessoal from "@/components/PainelPessoal";
import { trpc } from "@/lib/trpc";
import { ArrowLeft } from "lucide-react";
import { Link, useLocation, useSearch } from "wouter";

/** O administrador abre o painel de qualquer morador (a partir de Moradores). */
export default function PainelMorador() {
  const busca = useSearch();
  const [, navegar] = useLocation();
  const residentId = Number(new URLSearchParams(busca).get("id")) || undefined;
  const moradores = trpc.moradores.listar.useQuery();
  const escolhido = moradores.data?.find(morador => morador.id === residentId);
  return (
    <div>
      <PageIntro
        eyebrow="Painel do morador"
        title={escolhido ? escolhido.nome : "Painel de um morador"}
        description={
          escolhido
            ? `Bloco ${escolhido.bloco} · Apto ${escolhido.apartamento}. O mesmo painel que o morador vê: quanto descartou, de que tipos, quando e a situação de cada descarte.`
            : "Escolha um morador para ver o painel dele."
        }
        action={
          <Link
            href="/moradores"
            className="inline-flex h-10 items-center rounded-xl border border-[#dce8e0] bg-white px-4 text-sm font-semibold text-[#0f7350]"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Moradores
          </Link>
        }
      />
      <label className="mb-5 grid max-w-sm gap-1.5 text-xs font-semibold">
        Morador
        <select
          value={residentId ?? ""}
          onChange={event =>
            navegar(`/moradores/painel?id=${event.target.value}`)
          }
          className="h-10 rounded-xl border border-[#dce8e0] bg-white px-3 text-sm"
        >
          <option value="" disabled>
            Escolha um morador
          </option>
          {moradores.data?.map(morador => (
            <option key={morador.id} value={morador.id}>
              {morador.nome} · Bloco {morador.bloco} · {morador.apartamento}
            </option>
          ))}
        </select>
      </label>
      {residentId ? <PainelPessoal residentId={residentId} /> : null}
    </div>
  );
}

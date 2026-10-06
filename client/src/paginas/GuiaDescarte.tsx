import PageIntro from "@/components/PageIntro";
import { corDeTextoSobre, rotuloResiduo } from "@/lib/descarte";
import { trpc } from "@/lib/trpc";
import { formatarNumero } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, ShoppingBag } from "lucide-react";
import { palavra } from "@shared/plural";

/** Guia de descarte: o que vai em cada tipo, a cor do saco (o condomínio fornece sacos coloridos) e os limites da estação. */
export default function DisposalGuide() {
  const { data: guias, isLoading } = trpc.guias.listar.useQuery();
  const regras = trpc.regrasDescarte.listar.useQuery();
  return (
    <div>
      <PageIntro
        eyebrow="Educação ambiental"
        title="Guia de descarte"
        description="O que vai em cada tipo e a cor do saco de cada um. Separe em casa, pegue os sacos coloridos na portaria e registre na estação de pesagem."
      />
      {!isLoading && guias && (
        <section
          aria-label="Cor do saco de cada tipo"
          className="mb-5 flex flex-wrap gap-2"
        >
          {guias.map(guia => (
            <a
              key={guia.tipoResiduo}
              href={`#guia-${guia.tipoResiduo}`}
              className="inline-flex items-center gap-2 rounded-full border border-[#dce8e0] bg-white px-3 py-1.5 text-sm font-semibold"
            >
              <span
                className="h-3.5 w-3.5 rounded-full border border-black/10"
                style={{ background: guia.corSaco }}
              />
              {rotuloResiduo[guia.tipoResiduo]}: saco{" "}
              {guia.nomeCorSaco.toLowerCase()}
            </a>
          ))}
        </section>
      )}
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando guia...</p>
        ) : (
          guias?.map(guia => {
            const regra = regras.data?.find(
              item => item.tipoResiduo === guia.tipoResiduo
            );
            return (
              <article
                key={guia.tipoResiduo}
                id={`guia-${guia.tipoResiduo}`}
                className="scroll-mt-24 overflow-hidden rounded-[24px] border border-[#dce8e0] bg-white shadow-[0_16px_34px_-28px_rgba(4,66,42,.32)]"
              >
                <div
                  className="flex items-center gap-3 px-5 py-4"
                  style={{
                    background: guia.corSaco,
                    color: corDeTextoSobre(guia.corSaco),
                  }}
                >
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-black/15">
                    <ShoppingBag className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold tracking-[-.03em]">
                      {guia.titulo}
                    </h2>
                    <p className="text-xs font-semibold">
                      Saco {guia.nomeCorSaco.toLowerCase()}
                    </p>
                  </div>
                </div>
                <div className="p-5">
                  <p className="text-sm leading-6 text-muted-foreground">
                    {guia.instrucoes}
                  </p>
                  <div className="mt-4 space-y-3">
                    <div className="rounded-xl bg-[#f1f8f3] p-3">
                      <p className="flex items-center gap-1.5 text-xs font-bold text-[#0b6647]">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Pode ir neste saco
                      </p>
                      <p className="mt-1 text-xs leading-5 text-[#426558]">
                        {guia.itensAceitos}
                      </p>
                    </div>
                    <div className="rounded-xl bg-[#fff5ed] p-3">
                      <p className="flex items-center gap-1.5 text-xs font-bold text-[#a95427]">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Não misture
                      </p>
                      <p className="mt-1 text-xs leading-5 text-[#80614f]">
                        {guia.itensRejeitados}
                      </p>
                    </div>
                  </div>
                  {regra && (
                    <p className="mt-4 text-xs text-muted-foreground">
                      Na estação: de{" "}
                      {formatarNumero(regra.pesoMinimoGramas / 1000)} a{" "}
                      {formatarNumero(regra.pesoMaximoGramas / 1000)} kg por
                      descarte ·{" "}
                      {regra.pontosPorKg > 0
                        ? `${formatarNumero(regra.pontosPorKg)} ${palavra(regra.pontosPorKg, "ponto", "pontos")} por kg aprovado`
                        : "não dá pontos, mas conta nos indicadores"}
                      .
                    </p>
                  )}
                </div>
              </article>
            );
          })
        )}
      </section>
    </div>
  );
}

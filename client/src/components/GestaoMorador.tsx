import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/rotas";
import { formatarDataHora } from "@/lib/descarte";
import {
  rotuloCategoriaOcorrencia,
  rotuloConclusaoOcorrencia,
  rotuloStatusCampanha,
  rotuloStatusOcorrencia,
  rotuloTipoPenalidade,
} from "@shared/rotulos";
import { Bot, Gavel, Megaphone, QrCode, ShieldAlert } from "lucide-react";
import { FormEvent, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { plural } from "@shared/plural";

const cartao =
  "rounded-[24px] border border-[#dce8e0] bg-white p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.35)] sm:p-6";
const rotuloStatusMedida: Record<string, string> = {
  ativa: "Vigente",
  encerrada: "Encerrada",
  revogada: "Revogada",
};

type Gestao = inferRouterOutputs<AppRouter>["dashboard"]["morador"]["gestao"];

/**
 * Parte de gestão do relatório do morador: medidas (ocorrência, ação, período e responsável), adesivos, campanhas,
 * ocorrências e o resultado da IA. O morador vê a dele; o administrador vê a de qualquer morador e pode aplicar medidas.
 */
export default function GestaoMorador({
  gestao,
  moradorId,
}: {
  gestao: Gestao;
  moradorId?: number;
}) {
  const [aplicando, setAplicando] = useState(false);
  return (
    <section className="mt-5 grid gap-5 xl:grid-cols-[1.4fr_1fr]">
      <article id="medidas" className={`${cartao} scroll-mt-24`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-base font-semibold">
            <Gavel className="h-5 w-5 text-[#b45522]" />
            Histórico de medidas
            {gestao.medidasVigentes > 0 && (
              <Badge className="border-0 bg-[#fbeceb] text-[#b3382c] hover:bg-[#fbeceb]">
                {plural(gestao.medidasVigentes, "vigente", "vigentes")}
              </Badge>
            )}
          </p>
          {moradorId && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAplicando(!aplicando)}
              className="rounded-xl"
            >
              Aplicar medida
            </Button>
          )}
        </div>
        {moradorId && aplicando && (
          <AplicarMedida moradorId={moradorId} onFeito={() => setAplicando(false)} />
        )}
        {gestao.medidas.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-[11px] tracking-[.06em] text-muted-foreground uppercase">
                <tr>
                  <th className="py-2 pr-3">Ocorrência</th>
                  <th className="py-2 pr-3">Medida</th>
                  <th className="py-2 pr-3">Período</th>
                  <th className="py-2 pr-3">Responsável</th>
                  <th className="py-2">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edf2ef]">
                {gestao.medidas.map(medida => (
                  <tr key={medida.id} className="align-top">
                    <td className="py-2 pr-3">
                      {medida.motivo}
                      {medida.coletaId && (
                        <Link href={`/descartes?id=${medida.coletaId}`} className="block text-xs underline">
                          Descarte nº {medida.coletaId}
                        </Link>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {medida.nome}
                      <span className="block text-xs text-muted-foreground">
                        {rotuloTipoPenalidade[medida.tipo]}
                        {medida.pontos ? ` · ${plural(medida.pontos, "pt", "pts")}` : ""}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      {medida.periodo ?? formatarDataHora(medida.inicioEm)}
                    </td>
                    <td className="py-2 pr-3 text-xs">{medida.aplicadaPor}</td>
                    <td className="py-2">
                      <Badge
                        className={`border-0 ${medida.vigente ? "bg-[#fbeceb] text-[#b3382c] hover:bg-[#fbeceb]" : "bg-[#eef3f0] text-[#4d6157] hover:bg-[#eef3f0]"}`}
                      >
                        {medida.vigente ? "Vigente" : rotuloStatusMedida[medida.status]}
                      </Badge>
                      {moradorId && medida.status === "ativa" && <RevogarMedida id={medida.id} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Nenhuma medida aplicada.</p>
        )}
      </article>

      <div className="grid gap-5">
        <article className={cartao}>
          <p className="flex items-center gap-2 text-base font-semibold">
            <Bot className="h-5 w-5 text-[#0f7350]" />
            Análise da IA nos descartes
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <Numero rotulo="Analisados" valor={gestao.ia.analisados} />
            <Numero rotulo="Aprovados pela IA" valor={gestao.ia.aprovadosIa} />
            <Numero rotulo="Foram para revisão" valor={gestao.ia.paraRevisao} />
            <Numero rotulo="Em auditoria" valor={gestao.ia.emAuditoria} />
          </dl>
        </article>
        <article className={cartao}>
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-base font-semibold">
              <QrCode className="h-5 w-5 text-[#0f7350]" />
              Adesivos
            </p>
            <Link href="/adesivos" className="text-sm font-semibold text-[#0f7350] hover:underline">
              Abrir
            </Link>
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
            <Numero rotulo="Disponíveis" valor={gestao.adesivos.disponiveis} />
            <Numero rotulo="Usados" valor={gestao.adesivos.utilizados} />
            <Numero rotulo="Cancelados" valor={gestao.adesivos.cancelados} />
          </dl>
        </article>
      </div>

      <article className={cartao}>
        <p className="flex items-center gap-2 text-base font-semibold">
          <Megaphone className="h-5 w-5 text-[#2863a5]" />
          Campanhas de que participa
        </p>
        {gestao.campanhas.length ? (
          <ul className="mt-3 divide-y divide-[#edf2ef] text-sm">
            {gestao.campanhas.map(campanha => (
              <li key={campanha.id} className="flex justify-between gap-2 py-2">
                <span>{campanha.titulo}</span>
                <span className="text-xs text-muted-foreground">
                  {rotuloStatusCampanha[campanha.status]}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Nenhuma campanha.</p>
        )}
      </article>

      <article className={cartao}>
        <p className="flex items-center gap-2 text-base font-semibold">
          <ShieldAlert className="h-5 w-5 text-[#b45522]" />
          Ocorrências
        </p>
        <p className="mt-3 text-xs font-semibold text-muted-foreground">
          Registradas {moradorId ? "pelo morador" : "por você"}
        </p>
        <ListaOcorrencias itens={gestao.ocorrenciasRegistradas} />
        {moradorId && (
          <>
            <p className="mt-3 text-xs font-semibold text-muted-foreground">
              Sobre descartes do morador (quem denunciou não aparece para ele)
            </p>
            <ListaOcorrencias itens={gestao.ocorrenciasEnvolvido} />
          </>
        )}
      </article>
    </section>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="rounded-xl bg-[#f6faf7] p-2.5">
      <dt className="text-[11px] text-muted-foreground">{rotulo}</dt>
      <dd className="text-lg font-semibold">{valor}</dd>
    </div>
  );
}

function ListaOcorrencias({
  itens,
}: {
  itens: Array<{
    id: number;
    categoria: keyof typeof rotuloCategoriaOcorrencia;
    status: keyof typeof rotuloStatusOcorrencia;
    conclusao: keyof typeof rotuloConclusaoOcorrencia | null;
    criadoEm: Date;
  }>;
}) {
  if (!itens.length) return <p className="text-sm text-muted-foreground">Nenhuma.</p>;
  return (
    <ul className="mt-1 grid gap-1 text-sm">
      {itens.map(item => (
        <li key={item.id} className="flex justify-between gap-2">
          <span>
            Nº {item.id} · {rotuloCategoriaOcorrencia[item.categoria]}
          </span>
          <span className="text-xs text-muted-foreground">
            {item.conclusao ? rotuloConclusaoOcorrencia[item.conclusao] : rotuloStatusOcorrencia[item.status]}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** O administrador escolhe uma das medidas pré-definidas e registra o motivo. */
function AplicarMedida({ moradorId, onFeito }: { moradorId: number; onFeito: () => void }) {
  const utils = trpc.useUtils();
  const modelos = trpc.penalidades.modelos.useQuery({ somenteAtivos: true });
  const [modeloId, setModeloId] = useState("");
  const [motivo, setMotivo] = useState("");
  const aplicar = trpc.penalidades.aplicar.useMutation({
    onSuccess: () => {
      toast.success("Medida aplicada. O morador foi notificado.");
      void utils.dashboard.morador.invalidate();
      onFeito();
    },
    onError: erro => toast.error(erro.message),
  });
  function enviar(event: FormEvent) {
    event.preventDefault();
    if (!modeloId) return toast.error("Escolha a medida.");
    aplicar.mutate({ moradorId, modeloId: Number(modeloId), motivo });
  }
  return (
    <form onSubmit={enviar} className="mt-3 grid gap-2 rounded-2xl bg-[#f6faf7] p-3 text-sm">
      <select
        value={modeloId}
        onChange={event => setModeloId(event.target.value)}
        className="h-10 rounded-xl border border-[#dce8e0] bg-white px-3"
      >
        <option value="">Escolha a medida</option>
        {modelos.data?.map(modelo => (
          <option key={modelo.id} value={modelo.id}>
            {modelo.nome}
          </option>
        ))}
      </select>
      <textarea
        value={motivo}
        onChange={event => setMotivo(event.target.value)}
        placeholder="Ocorrência que motivou a medida (mín. 10 caracteres)"
        className="min-h-20 rounded-xl border border-[#dce8e0] bg-white p-3"
      />
      <Button disabled={aplicar.isPending} className="w-fit rounded-xl bg-[#b45522] text-white hover:bg-[#9a461a]">
        Aplicar
      </Button>
    </form>
  );
}

function RevogarMedida({ id }: { id: number }) {
  const utils = trpc.useUtils();
  const revogar = trpc.penalidades.revogar.useMutation({
    onSuccess: () => {
      toast.success("Medida revogada.");
      void utils.dashboard.morador.invalidate();
    },
    onError: erro => toast.error(erro.message),
  });
  return (
    <button
      type="button"
      className="mt-1 block text-xs text-[#b3382c] underline"
      onClick={() => {
        const motivo = window.prompt("Por que revogar esta medida? (mín. 10 caracteres)");
        if (motivo) revogar.mutate({ id, motivo });
      }}
    >
      Revogar
    </button>
  );
}

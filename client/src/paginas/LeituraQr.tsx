import PageIntro from "@/components/PageIntro";
import LeitorQr, { cameraDisponivel } from "@/components/LeitorQr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import {
  estiloSituacao,
  formatarKg,
  rotuloSituacaoCurto,
} from "@/lib/descarte";
import { normalizarCodigoAdesivo } from "@shared/adesivos";
import { rotuloTipoPenalidade } from "@shared/rotulos";
import {
  AlertTriangle,
  Bot,
  FileWarning,
  QrCode,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { toast } from "sonner";

const formatarData = (valor: Date | string | null | undefined) =>
  valor
    ? new Date(valor).toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";
const rotuloResultadoIa = {
  aprovado_automatico: "Aprovado pela IA",
  pendente: "IA mandou para conferência",
  erro: "Análise indisponível",
} as const;

/**
 * Leitura do QR de um saco pela administração: localiza o dono do adesivo e o descarte em que foi usado.
 * Cada consulta fica registrada na auditoria (quem consultou, quando e para quê), em respeito à LGPD.
 */
export default function LeituraQr() {
  const busca = useSearch();
  const [codigo, setCodigo] = useState("");
  const [finalidade, setFinalidade] = useState("");
  const [lendo, setLendo] = useState(false);
  const consultar = trpc.adesivos.consultar.useMutation({
    onError: erro => toast.error(erro.message),
  });
  // Aberto pelo link gravado no próprio QR (/leitura?adesivo=EC-...): já preenche o código.
  useEffect(() => {
    const doLink = normalizarCodigoAdesivo(
      new URLSearchParams(busca).get("adesivo")
    );
    if (doLink) setCodigo(doLink);
  }, [busca]);
  function enviar(event?: FormEvent, valor = codigo) {
    event?.preventDefault();
    const normalizado = normalizarCodigoAdesivo(valor);
    if (!normalizado) {
      toast.error("Código inválido. Ele tem o formato EC-XXXX-XXXX.");
      return;
    }
    setCodigo(normalizado);
    consultar.mutate({
      codigo: normalizado,
      finalidade: finalidade || undefined,
    });
  }
  const dados = consultar.data;
  return (
    <div className="grid gap-6">
      <PageIntro
        eyebrow="Fiscalização"
        title="Ler QR de um saco"
        description="Leia o QR do adesivo com a câmera ou digite o código impresso. O sistema mostra de quem é o adesivo e o descarte em que foi usado. Cada consulta fica registrada na auditoria em seu nome."
      />
      <form
        onSubmit={enviar}
        className="grid gap-3 rounded-[24px] border border-[#dce8e0] bg-white p-5 sm:p-6"
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="grid gap-1 text-sm font-medium">
            Código do adesivo
            <Input
              value={codigo}
              onChange={event => setCodigo(event.target.value.toUpperCase())}
              placeholder="EC-XXXX-XXXX"
              className="h-12 rounded-xl font-mono text-lg tracking-[.06em]"
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Finalidade da consulta (opcional)
            <Input
              value={finalidade}
              maxLength={200}
              onChange={event => setFinalidade(event.target.value)}
              placeholder="Ex.: saco com resíduo misturado na lixeira"
              className="h-12 rounded-xl"
            />
          </label>
          <Button
            disabled={consultar.isPending}
            className="h-12 rounded-xl bg-[#0f7350] px-6 text-white hover:bg-[#0a6243]"
          >
            {consultar.isPending ? "Consultando..." : "Consultar"}
          </Button>
        </div>
        {cameraDisponivel() &&
          (lendo ? (
            <LeitorQr
              extrair={normalizarCodigoAdesivo}
              onLer={valor => {
                setLendo(false);
                enviar(undefined, valor);
              }}
              onCancelar={() => setLendo(false)}
            />
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => setLendo(true)}
              className="h-11 rounded-xl"
            >
              <QrCode className="mr-2 h-4 w-4" />
              Ler o QR com a câmera
            </Button>
          ))}
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Use os dados só para tratar o descarte. E-mail e telefone do morador
          não aparecem aqui.
        </p>
      </form>

      {dados && (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-[24px] border border-[#dce8e0] bg-white p-5 sm:p-6">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <UserRound className="h-4 w-4 text-[#0f7350]" />
              Dono do adesivo {dados.codigo}
            </h2>
            {dados.morador ? (
              <dl className="mt-3 grid gap-1.5 text-sm">
                <p className="text-lg font-semibold">{dados.morador.nome}</p>
                <p>
                  Bloco {dados.morador.bloco}, apartamento{" "}
                  {dados.morador.apartamento}
                  {dados.morador.status !== "ativo" ? " · inativo" : ""}
                </p>
                <p className="text-muted-foreground">
                  Adesivo{" "}
                  {dados.status === "utilizado"
                    ? `usado em ${formatarData(dados.utilizadoEm)}`
                    : dados.status === "cancelado"
                      ? "cancelado"
                      : "ainda não usado"}{" "}
                  · entregue em {formatarData(dados.entregueEm)}
                </p>
                <p className="text-muted-foreground">
                  Kit: {dados.morador.adesivos.disponivel} disponível(is),{" "}
                  {dados.morador.adesivos.utilizado} usado(s)
                </p>
                <Button asChild variant="outline" className="mt-2 w-fit rounded-xl">
                  <Link href={`/moradores/painel?id=${dados.morador.id}`}>
                    Abrir o relatório do morador
                  </Link>
                </Button>
              </dl>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                Morador removido do cadastro.
              </p>
            )}
            {dados.medidas.length > 0 && (
              <div className="mt-4">
                <p className="text-[11px] font-bold tracking-[.08em] text-muted-foreground uppercase">
                  Medidas recentes
                </p>
                <ul className="mt-1 grid gap-1 text-sm">
                  {dados.medidas.map(medida => (
                    <li key={medida.id}>
                      {medida.nome} ({rotuloTipoPenalidade[medida.tipo]}) ·{" "}
                      {medida.status}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
          <section className="rounded-[24px] border border-[#dce8e0] bg-white p-5 sm:p-6">
            <h2 className="text-base font-semibold">
              Descarte em que o adesivo foi usado
            </h2>
            {dados.descarte ? (
              <div className="mt-3 grid gap-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-lg font-semibold">
                    Nº {dados.descarte.id} · {dados.descarte.material}
                  </p>
                  <Badge className={estiloSituacao[dados.descarte.situacao]}>
                    {rotuloSituacaoCurto[dados.descarte.situacao]}
                  </Badge>
                </div>
                <p>
                  {formatarKg(dados.descarte.pesoGramas)} kg ·{" "}
                  {formatarData(dados.descarte.data)} · estação{" "}
                  {dados.descarte.estacao ?? "—"} ({dados.descarte.local ?? "—"})
                </p>
                {dados.descarte.ia && (
                  <p className="flex items-start gap-2 rounded-xl bg-[#f6faf7] p-3">
                    <Bot className="mt-0.5 h-4 w-4 shrink-0 text-[#0f7350]" />
                    <span>
                      {rotuloResultadoIa[dados.descarte.ia.resultado]} (
                      {dados.descarte.ia.confianca ?? 0}% de confiança)
                      {dados.descarte.ia.motivos.length
                        ? `: ${dados.descarte.ia.motivos.join(" ")}`
                        : ""}
                    </span>
                  </p>
                )}
                {dados.descarte.urlFoto && (
                  <img
                    src={dados.descarte.urlFoto}
                    alt="Foto do saco na balança"
                    className="max-h-56 rounded-xl border object-contain"
                  />
                )}
                <div className="mt-1 flex flex-wrap gap-2">
                  <Button asChild className="rounded-xl bg-[#0f7350] text-white hover:bg-[#0a6243]">
                    <Link href={`/descartes?id=${dados.descarte.id}`}>
                      Abrir o descarte (aprovar, reverter, auditoria)
                    </Link>
                  </Button>
                  <Button asChild variant="outline" className="rounded-xl">
                    <Link href="/ambiental#ocorrencias">
                      <FileWarning className="mr-1.5 h-4 w-4" />
                      Registrar ocorrência
                    </Link>
                  </Button>
                </div>
                {dados.ocorrencias.length > 0 && (
                  <p className="flex items-center gap-2 text-xs text-[#7a4d0a]">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {dados.ocorrencias.length} ocorrência(s) ligada(s) a este
                    descarte.
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                Este adesivo ainda não foi usado em nenhum descarte.
              </p>
            )}
            {dados.recentes.length > 0 && (
              <div className="mt-4">
                <p className="text-[11px] font-bold tracking-[.08em] text-muted-foreground uppercase">
                  Últimos descartes do morador
                </p>
                <ul className="mt-1 grid gap-1 text-sm">
                  {dados.recentes.map(registro => (
                    <li key={registro.id} className="flex justify-between gap-2">
                      <Link
                        href={`/descartes?id=${registro.id}`}
                        className="underline"
                      >
                        Nº {registro.id} · {registro.material} ·{" "}
                        {formatarKg(registro.pesoGramas)} kg
                      </Link>
                      <span className="text-muted-foreground">
                        {rotuloSituacaoCurto[registro.situacao]}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
          <p className="text-xs text-muted-foreground lg:col-span-2">
            {dados.aviso}
          </p>
        </div>
      )}
    </div>
  );
}

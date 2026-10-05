import PageIntro from "@/components/PageIntro";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import {
  corDoTipo,
  estiloSituacao,
  formatarDataHora,
  formatarKg,
  formatarPontos,
  rotuloResiduo,
  rotuloSituacao,
  rotuloSituacaoCurto,
  TIPOS_RESIDUO,
  type SituacaoDescarte,
  type TipoResiduo,
} from "@/lib/descarte";
import {
  AlertTriangle,
  CheckCheck,
  CheckCircle2,
  Eye,
  Gavel,
  KeyRound,
  Recycle,
  RotateCcw,
  Scale,
  Search,
  ShieldAlert,
  XCircle,
  Bot,
  Undo2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { toast } from "sonner";

type Filtros = {
  search: string;
  wasteType: string;
  block: string;
  situacao: string;
  startDate: string;
  endDate: string;
};
const filtrosVazios: Filtros = {
  search: "",
  wasteType: "",
  block: "",
  situacao: "",
  startDate: "",
  endDate: "",
};
type Alvo = {
  id: number;
  resumo: string;
  pontos: number;
  situacao: SituacaoDescarte;
};

export default function Descartes() {
  const utils = trpc.useUtils();
  const busca = useSearch();
  const [, navegar] = useLocation();
  const parametros = useMemo(() => new URLSearchParams(busca), [busca]);
  const [filtros, setFiltros] = useState<Filtros>(() => ({
    ...filtrosVazios,
    situacao: parametros.get("situacao") ?? "",
  }));
  const perfil = trpc.perfil.meuPerfil.useQuery();
  const ehAdmin = perfil.data?.role === "administrador";
  const ehMorador = perfil.data?.role === "morador";
  const cores = useCores();
  const entrada = useMemo(
    () => ({
      search: filtros.search || undefined,
      wasteType: (filtros.wasteType || undefined) as TipoResiduo | undefined,
      block: filtros.block || undefined,
      situacao: (filtros.situacao || undefined) as SituacaoDescarte | undefined,
      startDate: filtros.startDate
        ? new Date(`${filtros.startDate}T00:00:00`)
        : undefined,
      endDate: filtros.endDate
        ? new Date(`${filtros.endDate}T23:59:59`)
        : undefined,
    }),
    [filtros]
  );
  const {
    data: registros,
    isLoading,
    error,
  } = trpc.coletas.listar.useQuery(entrada);
  const blocos = trpc.relatorios.blocos.useQuery(undefined, {
    enabled: ehAdmin,
  });
  const pendentes = trpc.coletas.listarPendentesAprovacao.useQuery(undefined, {
    enabled: ehAdmin,
  });

  // Aberto por ?id= (ao tocar numa notificação) ou pelo botão "Ver" da tabela.
  const idDaUrl = Number(parametros.get("id")) || null;
  const [detalheId, setDetalheId] = useState<number | null>(idDaUrl);
  useEffect(() => {
    if (idDaUrl) setDetalheId(idDaUrl);
  }, [idDaUrl]);
  useEffect(() => {
    const situacao = parametros.get("situacao");
    if (situacao) setFiltros(atual => ({ ...atual, situacao }));
  }, [parametros]);
  function fecharDetalhe() {
    setDetalheId(null);
    if (idDaUrl) navegar("/descartes", { replace: true });
  }

  const [reprovar, setReprovar] = useState<Alvo | null>(null);
  const [auditar, setAuditar] = useState<Alvo | null>(null);
  const [concluir, setConcluir] = useState<Alvo | null>(null);
  const [reverter, setReverter] = useState<Alvo | null>(null);
  const atualizarTudo = () => {
    utils.coletas.listar.invalidate();
    utils.coletas.listarPendentesAprovacao.invalidate();
    utils.coletas.detalhe.invalidate();
    utils.notificacoes.contagemNaoLidas.invalidate();
  };
  const decidir = trpc.coletas.decidirAprovacaoPeso.useMutation({
    onSuccess: resultado => {
      atualizarTudo();
      toast.success(
        `Descarte aprovado; ${resultado.pointsAwarded} ponto(s) creditado(s).`
      );
    },
    onError: issue => toast.error(issue.message),
  });
  const aprovarLote = trpc.coletas.aprovarVarios.useMutation({
    onSuccess: resultado => {
      atualizarTudo();
      toast.success(
        `${resultado.aprovados} descarte(s) aprovado(s); ${resultado.pontos} ponto(s) creditado(s).${resultado.recusados.length ? ` ${resultado.recusados.length} não puderam ser aprovados.` : ""}`
      );
    },
    onError: issue => toast.error(issue.message),
  });

  const lotesPendentes = useMemo(() => {
    const grupos = new Map<string, NonNullable<typeof pendentes.data>>();
    for (const item of (pendentes.data ?? []).filter(
      registro => registro.situacao === "pendente"
    )) {
      const chave = item.lote ?? `id-${item.id}`;
      grupos.set(chave, [...(grupos.get(chave) ?? []), item]);
    }
    return Array.from(grupos.values());
  }, [pendentes.data]);
  const emAuditoria = (pendentes.data ?? []).filter(
    registro => registro.situacao === "auditoria"
  );
  const resumoDe = (item: {
    id: number;
    tipoResiduo: TipoResiduo;
    pesoGramas: number | null;
    residentName?: string | null;
  }) =>
    `${rotuloResiduo[item.tipoResiduo]} · ${formatarKg(item.pesoGramas)}${item.residentName ? ` · ${item.residentName}` : ""}`;

  const campo =
    "grid gap-1.5 text-[11px] font-bold tracking-[.08em] text-muted-foreground uppercase";
  const seletor =
    "h-10 rounded-xl border border-[#dce8e0] bg-[#fbfdfc] px-3 text-sm font-medium normal-case tracking-normal text-foreground outline-none focus:ring-2 focus:ring-[#0f7350]/30";

  return (
    <div>
      <PageIntro
        eyebrow="Estação de pesagem"
        title="Descartes"
        description={
          ehAdmin
            ? "Cada descarte é feito pelo morador na estação (tablet e balança ao lado das lixeiras). Confira a foto e o peso de cada tipo e aprove, reprove com motivo ou abra uma auditoria."
            : "Seus descartes feitos na estação. Os pontos entram depois que a administração confere a foto e o peso."
        }
      />
      {ehMorador && <CodigoEstacao />}

      {ehAdmin && (
        <section className="mb-5 rounded-[24px] border border-[#f3c98a] bg-[#fff8ec] p-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#fbe8c6] text-[#7a4d0a]">
                <Scale className="h-5 w-5" />
              </span>
              <div>
                <p className="font-semibold">
                  Aguardando aprovação (
                  {lotesPendentes.reduce((soma, lote) => soma + lote.length, 0)}
                  )
                </p>
                <p className="text-sm leading-6 text-muted-foreground">
                  Todo descarte passa por aqui. Veja a foto do visor de cada
                  tipo: aprovar libera os pontos pela regra do tipo; reprovar
                  pede um motivo, que vai para o morador; casos graves (suspeita
                  de fraude ou furto) vão para auditoria.
                </p>
              </div>
            </div>
          </div>
          <div className="mt-4 grid gap-3">
            {pendentes.isLoading ? (
              <p className="text-sm text-muted-foreground">Carregando...</p>
            ) : !lotesPendentes.length ? (
              <p className="rounded-2xl bg-white p-5 text-sm text-muted-foreground">
                Nenhum descarte esperando aprovação.
              </p>
            ) : (
              lotesPendentes.map(lote => {
                const primeiro = lote[0];
                return (
                  <article
                    key={primeiro.lote ?? primeiro.id}
                    className="rounded-2xl border border-[#f3c98a] bg-white p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">
                          {primeiro.residentName ?? "Sem morador"} · Bloco{" "}
                          {primeiro.bloco}
                          {primeiro.apartment
                            ? ` · Apto ${primeiro.apartment}`
                            : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatarDataHora(primeiro.concluidaEm)} ·{" "}
                          {primeiro.origin} · {lote.length} tipo(s) ·{" "}
                          {formatarPontos(
                            lote.reduce(
                              (soma, item) => soma + item.pontosCalculados,
                              0
                            )
                          )}{" "}
                          ponto(s) previstos
                        </p>
                      </div>
                      <Button
                        size="sm"
                        disabled={aprovarLote.isPending}
                        onClick={() =>
                          aprovarLote.mutate({ ids: lote.map(item => item.id) })
                        }
                        className="h-8 rounded-lg bg-[#0f7350] text-xs text-white hover:bg-[#0a6243]"
                      >
                        <CheckCheck className="mr-1.5 h-3.5 w-3.5" />
                        {lote.length > 1 ? "Aprovar todos" : "Aprovar"}
                      </Button>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {lote.map(item => (
                        <div
                          key={item.id}
                          className="rounded-xl border border-[#ece3d2] bg-[#fffdf8] p-3"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className="h-3 w-3 rounded-full border border-black/10"
                              style={{
                                background: corDoTipo(item.tipoResiduo, cores),
                              }}
                            />
                            <p className="text-sm font-semibold">
                              {rotuloResiduo[item.tipoResiduo]} ·{" "}
                              {formatarKg(item.pesoGramas)}
                            </p>
                            <span className="ml-auto text-xs text-muted-foreground">
                              nº {item.id}
                            </span>
                          </div>
                          {item.urlFoto ? (
                            <a
                              href={item.urlFoto}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <img
                                src={item.urlFoto}
                                alt={`Foto do visor: ${rotuloResiduo[item.tipoResiduo]}`}
                                className="mt-2 h-32 w-full rounded-lg border border-[#e2ebe5] object-cover"
                              />
                            </a>
                          ) : (
                            <p className="mt-2 grid h-20 place-items-center rounded-lg bg-[#f4f1ea] text-xs text-muted-foreground">
                              {item.pesagemSimulada
                                ? "Balança simulada (sem foto)"
                                : "Sem foto"}
                            </p>
                          )}
                          <p className="mt-2 text-xs text-muted-foreground">
                            {formatarPontos(item.pontosCalculados)} ponto(s)
                            previsto(s)
                          </p>
                          {item.observacoes && (
                            <p className="mt-1 flex gap-1 text-xs text-[#7a4d0a]">
                              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                              {item.observacoes}
                            </p>
                          )}
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={decidir.isPending}
                              onClick={() =>
                                decidir.mutate({ id: item.id, aprovar: true })
                              }
                              className="h-7 rounded-lg px-2 text-xs font-semibold text-[#0f7350] hover:bg-[#edf7f1]"
                            >
                              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                              Aprovar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setReprovar({
                                  id: item.id,
                                  resumo: resumoDe(item),
                                  pontos: item.pontosCalculados,
                                  situacao: "pendente",
                                })
                              }
                              className="h-7 rounded-lg px-2 text-xs font-semibold text-[#b3382c] hover:bg-[#fbeceb]"
                            >
                              <XCircle className="mr-1 h-3.5 w-3.5" />
                              Reprovar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setAuditar({
                                  id: item.id,
                                  resumo: resumoDe(item),
                                  pontos: item.pontosCalculados,
                                  situacao: "pendente",
                                })
                              }
                              className="h-7 rounded-lg px-2 text-xs font-semibold text-[#5b3aa6] hover:bg-[#efe9fb]"
                            >
                              <ShieldAlert className="mr-1 h-3.5 w-3.5" />
                              Auditoria
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>
      )}

      {ehAdmin && emAuditoria.length > 0 && (
        <section className="mb-5 rounded-[24px] border border-[#d8cdf1] bg-[#f8f5fe] p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#e9e1fa] text-[#5b3aa6]">
              <Gavel className="h-5 w-5" />
            </span>
            <div>
              <p className="font-semibold">
                Em auditoria ({emAuditoria.length})
              </p>
              <p className="text-sm leading-6 text-muted-foreground">
                O morador já foi avisado. Converse com ele e conclua: "regular"
                aprova o descarte; "irregular" reprova e pode aplicar uma
                punição em pontos.
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-2">
            {emAuditoria.map(item => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e3dbf5] bg-white p-4"
              >
                <div>
                  <p className="text-sm font-semibold">
                    {item.residentName ?? "Sem morador"} ·{" "}
                    {rotuloResiduo[item.tipoResiduo]} ·{" "}
                    {formatarKg(item.pesoGramas)} · nº {item.id}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Aberta em {formatarDataHora(item.auditoriaAbertaEm)} ·
                    Motivo: {item.motivoAuditoria}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDetalheId(item.id)}
                    className="h-8 rounded-lg text-xs"
                  >
                    <Eye className="mr-1.5 h-3.5 w-3.5" />
                    Ver
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      setConcluir({
                        id: item.id,
                        resumo: resumoDe(item),
                        pontos: item.pontosCalculados,
                        situacao: "auditoria",
                      })
                    }
                    className="h-8 rounded-lg bg-[#5b3aa6] text-xs text-white hover:bg-[#4a2f89]"
                  >
                    <Gavel className="mr-1.5 h-3.5 w-3.5" />
                    Concluir auditoria
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-[24px] border border-[#dce8e0] bg-white p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.35)] sm:p-6">
        <div className="flex flex-col gap-3 border-b border-[#e6eee9] pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-base font-semibold tracking-[-.025em]">
              Histórico de descartes
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {registros
                ? `${registros.length} descarte(s) com os filtros atuais.`
                : "Filtre por tipo, situação e período."}
            </p>
          </div>
          <Button
            variant="ghost"
            onClick={() => setFiltros(filtrosVazios)}
            className="h-9 rounded-xl text-sm text-muted-foreground hover:text-[#0f7350]"
          >
            <RotateCcw className="mr-2 h-3.5 w-3.5" />
            Limpar filtros
          </Button>
        </div>
        <div
          className={`mt-5 grid gap-3 md:grid-cols-3 ${ehAdmin ? "xl:grid-cols-7" : "xl:grid-cols-4"}`}
        >
          {ehAdmin && (
            <label className={`${campo} md:col-span-3 xl:col-span-2`}>
              Buscar morador
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  value={filtros.search}
                  onChange={event =>
                    setFiltros({ ...filtros, search: event.target.value })
                  }
                  placeholder="Nome, apartamento ou nº do descarte"
                  className="h-10 rounded-xl bg-[#fbfdfc] pl-9 normal-case tracking-normal"
                />
              </div>
            </label>
          )}
          {ehAdmin && (
            <label className={campo}>
              Bloco
              <select
                value={filtros.block}
                onChange={event =>
                  setFiltros({ ...filtros, block: event.target.value })
                }
                className={seletor}
              >
                <option value="">Todos</option>
                {blocos.data?.map(bloco => (
                  <option key={bloco} value={bloco}>
                    Bloco {bloco}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className={campo}>
            Tipo
            <select
              value={filtros.wasteType}
              onChange={event =>
                setFiltros({ ...filtros, wasteType: event.target.value })
              }
              className={seletor}
            >
              <option value="">Todos</option>
              {TIPOS_RESIDUO.map(tipo => (
                <option key={tipo} value={tipo}>
                  {rotuloResiduo[tipo]}
                </option>
              ))}
            </select>
          </label>
          <label className={campo}>
            Situação
            <select
              value={filtros.situacao}
              onChange={event =>
                setFiltros({ ...filtros, situacao: event.target.value })
              }
              className={seletor}
            >
              <option value="">Todas</option>
              {(Object.keys(rotuloSituacao) as SituacaoDescarte[]).map(
                situacao => (
                  <option key={situacao} value={situacao}>
                    {rotuloSituacaoCurto[situacao]}
                  </option>
                )
              )}
            </select>
          </label>
          <label className={campo}>
            De
            <Input
              type="date"
              value={filtros.startDate}
              onChange={event =>
                setFiltros({ ...filtros, startDate: event.target.value })
              }
              className="h-10 rounded-xl bg-[#fbfdfc]"
            />
          </label>
          <label className={campo}>
            Até
            <Input
              type="date"
              value={filtros.endDate}
              onChange={event =>
                setFiltros({ ...filtros, endDate: event.target.value })
              }
              className="h-10 rounded-xl bg-[#fbfdfc]"
            />
          </label>
        </div>
        {error ? (
          <p className="py-12 text-center text-sm text-destructive">
            {error.message}
          </p>
        ) : isLoading ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Carregando descartes...
          </p>
        ) : !registros?.length ? (
          <div className="grid min-h-64 place-items-center text-center">
            <div>
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#e8f4ed] text-[#0f7350]">
                <Recycle className="h-5 w-5" />
              </span>
              <p className="mt-4 text-sm font-semibold">
                Nenhum descarte encontrado.
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {ehMorador
                  ? "Gere o código acima e registre seu primeiro descarte na estação."
                  : "Ajuste os filtros para consultar o histórico."}
              </p>
            </div>
          </div>
        ) : (
          <>
            <ul className="mt-4 divide-y divide-[#edf2ef] md:hidden">
              {registros.map(registro => (
                <li key={registro.id}>
                  <button
                    type="button"
                    onClick={() => setDetalheId(registro.id)}
                    className="flex w-full items-start justify-between gap-3 py-3 text-left"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-sm font-semibold">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/10"
                          style={{
                            background: corDoTipo(registro.tipoResiduo, cores),
                          }}
                        />
                        {rotuloResiduo[registro.tipoResiduo]} ·{" "}
                        {formatarKg(registro.pesoGramas)}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {formatarDataHora(
                          registro.concluidaEm ?? registro.agendadaPara
                        )}{" "}
                        · nº {registro.id}
                        {ehAdmin && registro.residentName
                          ? ` · ${registro.residentName}`
                          : ""}
                      </span>
                      {registro.motivoDecisao &&
                        registro.situacao === "reprovado" && (
                          <span className="mt-1 block text-xs text-[#b3382c]">
                            Motivo: {registro.motivoDecisao}
                          </span>
                        )}
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <Badge className={estiloSituacao[registro.situacao]}>
                        {rotuloSituacaoCurto[registro.situacao]}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {registro.situacao === "aprovado"
                          ? `${registro.pontosConcedidos} pts`
                          : registro.situacao === "pendente" ||
                              registro.situacao === "auditoria"
                            ? `${formatarPontos(registro.pontosPrevistos)} previsto(s)`
                            : "0 pts"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-5 hidden overflow-x-auto md:block">
              <table className="w-full min-w-[860px] text-left">
                <thead>
                  <tr className="border-b border-[#e6eee9] text-[11px] font-bold tracking-[.08em] text-muted-foreground uppercase">
                    <th className="px-2 py-4">Descarte</th>
                    <th className="px-2 py-4">Data</th>
                    {ehAdmin && <th className="px-2 py-4">Morador</th>}
                    <th className="px-2 py-4">Peso</th>
                    <th className="px-2 py-4">Pontos</th>
                    <th className="px-2 py-4">Situação</th>
                    <th className="px-2 py-4 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {registros.map(registro => (
                    <tr
                      key={registro.id}
                      className="border-b border-[#edf2ef] last:border-0"
                    >
                      <td className="px-2 py-3.5">
                        <p className="flex items-center gap-2 text-sm font-semibold">
                          <span
                            className="h-2.5 w-2.5 rounded-full border border-black/10"
                            style={{
                              background: corDoTipo(
                                registro.tipoResiduo,
                                cores
                              ),
                            }}
                          />
                          {rotuloResiduo[registro.tipoResiduo]}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          nº {registro.id} · Bloco {registro.bloco} ·{" "}
                          {registro.origin}
                        </p>
                      </td>
                      <td className="px-2 py-3.5 text-sm">
                        {formatarDataHora(
                          registro.concluidaEm ?? registro.agendadaPara
                        )}
                      </td>
                      {ehAdmin && (
                        <td className="px-2 py-3.5 text-sm text-muted-foreground">
                          {registro.residentName
                            ? `${registro.residentName}${registro.apartment ? ` · ${registro.apartment}` : ""}`
                            : "—"}
                        </td>
                      )}
                      <td className="px-2 py-3.5 text-sm font-semibold text-[#0f7350]">
                        {formatarKg(registro.pesoGramas)}
                      </td>
                      <td className="px-2 py-3.5 text-sm">
                        {registro.situacao === "aprovado" ? (
                          `${registro.pontosConcedidos}`
                        ) : registro.situacao === "pendente" ||
                          registro.situacao === "auditoria" ? (
                          <span className="text-muted-foreground">
                            {formatarPontos(registro.pontosPrevistos)}{" "}
                            previsto(s)
                          </span>
                        ) : (
                          "0"
                        )}
                      </td>
                      <td className="px-2 py-3.5">
                        <Badge className={estiloSituacao[registro.situacao]}>
                          {rotuloSituacao[registro.situacao]}
                        </Badge>
                        {registro.motivoDecisao &&
                          registro.situacao === "reprovado" && (
                            <p className="mt-1 max-w-[220px] text-xs text-[#b3382c]">
                              Motivo: {registro.motivoDecisao}
                            </p>
                          )}
                      </td>
                      <td className="px-2 py-3.5 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDetalheId(registro.id)}
                          className="h-8 rounded-lg text-xs font-semibold text-[#0f7350] hover:bg-[#edf7f1]"
                        >
                          <Eye className="mr-1.5 h-3.5 w-3.5" />
                          Ver
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <DetalheDescarte
        id={detalheId}
        ehAdmin={ehAdmin}
        onClose={fecharDetalhe}
        onReprovar={setReprovar}
        onAuditar={setAuditar}
        onConcluir={setConcluir}
        onReverter={setReverter}
        onAprovar={id => decidir.mutate({ id, aprovar: true })}
      />
      <DialogoReprovar
        alvo={reprovar}
        onClose={() => setReprovar(null)}
        onDone={atualizarTudo}
      />
      <DialogoAuditoria
        alvo={auditar}
        onClose={() => setAuditar(null)}
        onDone={atualizarTudo}
      />
      <DialogoConcluirAuditoria
        alvo={concluir}
        onClose={() => setConcluir(null)}
        onDone={atualizarTudo}
      />
      <DialogoReverter
        alvo={reverter}
        onClose={() => setReverter(null)}
        onDone={atualizarTudo}
      />
    </div>
  );
}

/** Cor do saco de cada tipo definida pelo condomínio (ou a padrão). */
function useCores() {
  const guias = trpc.guias.listar.useQuery();
  return useMemo(
    () =>
      Object.fromEntries(
        (guias.data ?? []).map(guia => [guia.tipoResiduo, guia.corSaco])
      ) as Partial<Record<TipoResiduo, string>>,
    [guias.data]
  );
}

function DetalheDescarte({
  id,
  ehAdmin,
  onClose,
  onReprovar,
  onAuditar,
  onConcluir,
  onReverter,
  onAprovar,
}: {
  id: number | null;
  ehAdmin: boolean;
  onClose: () => void;
  onReprovar: (alvo: Alvo) => void;
  onAuditar: (alvo: Alvo) => void;
  onConcluir: (alvo: Alvo) => void;
  onReverter: (alvo: Alvo) => void;
  onAprovar: (id: number) => void;
}) {
  const detalhe = trpc.coletas.detalhe.useQuery(
    { id: id ?? 0 },
    { enabled: id !== null, retry: false }
  );
  const cores = useCores();
  const dados = detalhe.data;
  return (
    <Dialog
      open={id !== null}
      onOpenChange={aberto => {
        if (!aberto) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Descarte nº {id}</DialogTitle>
          <DialogDescription>
            {dados
              ? `${dados.morador ? `${dados.morador.nome} · Bloco ${dados.morador.bloco} · Apto ${dados.morador.apartamento} · ` : ""}${dados.itens.length > 1 ? `${dados.itens.length} tipos registrados juntos` : "1 tipo"}${dados.estacao ? ` · Estação ${dados.estacao.nome} (${dados.estacao.local})` : ""}`
              : detalhe.error
                ? detalhe.error.message
                : "Carregando..."}
          </DialogDescription>
        </DialogHeader>
        {dados && (
          <div className="grid gap-3">
            {dados.itens.map(item => {
              const alvo: Alvo = {
                id: item.id,
                resumo: `${rotuloResiduo[item.tipoResiduo]} · ${formatarKg(item.pesoGramas)}`,
                pontos:
                  item.situacao === "aprovado"
                    ? item.pontosConcedidos
                    : item.pontosPrevistos,
                situacao: item.situacao,
              };
              return (
                <div
                  key={item.id}
                  className={`rounded-2xl border p-4 ${item.id === id ? "border-[#0f7350]/50 bg-[#f4faf6]" : "border-[#e2ebe5]"}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-full border border-black/10"
                      style={{ background: corDoTipo(item.tipoResiduo, cores) }}
                    />
                    <p className="font-semibold">
                      {rotuloResiduo[item.tipoResiduo]} ·{" "}
                      {formatarKg(item.pesoGramas)}
                    </p>
                    <Badge className={estiloSituacao[item.situacao]}>
                      {rotuloSituacao[item.situacao]}
                    </Badge>
                    <span className="ml-auto text-xs text-muted-foreground">
                      nº {item.id} ·{" "}
                      {formatarDataHora(item.concluidaEm ?? item.agendadaPara)}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-[180px_1fr]">
                    {item.urlFoto ? (
                      <a href={item.urlFoto} target="_blank" rel="noreferrer">
                        <img
                          src={item.urlFoto}
                          alt="Foto do visor da balança"
                          className="h-36 w-full rounded-xl border border-[#e2ebe5] object-cover"
                        />
                      </a>
                    ) : (
                      <div className="grid h-36 place-items-center rounded-xl bg-[#f0f4f2] text-xs text-muted-foreground">
                        {item.pesagemSimulada ? "Balança simulada" : "Sem foto"}
                      </div>
                    )}
                    <div className="grid content-start gap-1 text-sm">
                      <p>
                        <b>Pontos:</b>{" "}
                        {item.situacao === "aprovado"
                          ? `${item.pontosConcedidos} creditado(s)`
                          : item.situacao === "pendente" ||
                              item.situacao === "auditoria"
                            ? `${formatarPontos(item.pontosPrevistos)} previsto(s), entram depois da aprovação`
                            : "nenhum"}
                      </p>
                      <p>
                        <b>Origem:</b> {item.origin}
                        {item.pesagemSimulada ? " (balança simulada)" : ""}
                      </p>
                      {item.observacoes && (
                        <p className="text-[#7a4d0a]">
                          <b>Observações:</b> {item.observacoes}
                        </p>
                      )}
                      {item.motivoAuditoria && (
                        <p className="text-[#5b3aa6]">
                          <b>Auditoria:</b> {item.motivoAuditoria}
                        </p>
                      )}
                      {item.motivoDecisao && (
                        <p
                          className={
                            item.situacao === "reprovado"
                              ? "text-[#b3382c]"
                              : "text-muted-foreground"
                          }
                        >
                          <b>Decisão:</b> {item.motivoDecisao}
                          {item.decididoPor ? ` (${item.decididoPor})` : ""}
                        </p>
                      )}
                      {item.adesivo && (
                        <p>
                          <b>Adesivo QR:</b>{" "}
                          <span className="font-mono">{item.adesivo}</span>
                        </p>
                      )}
                    </div>
                  </div>
                  {item.analiseIa && (
                    <div
                      className={`mt-3 rounded-xl p-3 text-sm ${item.analiseIa.resultado === "aprovado_automatico" ? "bg-[#edf7f1]" : "bg-[#fff8ec]"}`}
                    >
                      <p className="flex flex-wrap items-center gap-2 font-semibold">
                        <Bot className="h-4 w-4 text-[#0f7350]" />
                        Análise da IA:{" "}
                        {item.analiseIa.resultado === "aprovado_automatico"
                          ? "aprovado automaticamente"
                          : item.analiseIa.resultado === "erro"
                            ? "não foi possível analisar"
                            : "enviado para conferência"}
                        <span className="text-xs font-normal text-muted-foreground">
                          {item.analiseIa.modo === "claude"
                            ? `Claude (${item.analiseIa.modelo})`
                            : "modo demonstração"}{" "}
                          · confiança {item.analiseIa.confianca ?? 0}%
                        </span>
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Viu: {item.analiseIa.tipoIdentificado ? rotuloResiduo[item.analiseIa.tipoIdentificado] : "tipo não identificado"}
                        {" · "}saco {item.analiseIa.corSacoIdentificada ?? "?"} (esperado{" "}
                        {item.analiseIa.corSacoEsperada ?? "?"})
                        {" · "}visor{" "}
                        {item.analiseIa.pesoLidoGramas === null
                          ? "ilegível"
                          : formatarKg(item.analiseIa.pesoLidoGramas)}
                        {item.analiseIa.descricao ? ` · ${item.analiseIa.descricao}` : ""}
                      </p>
                      {item.analiseIa.motivos.length > 0 && (
                        <ul className="mt-1 list-disc pl-5 text-xs text-[#7a4d0a]">
                          {item.analiseIa.motivos.map(motivo => (
                            <li key={motivo}>{motivo}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  {(item.medidas.length > 0 || item.ocorrencias.length > 0) && (
                    <div className="mt-3 grid gap-1 text-xs">
                      {item.medidas.map(medida => (
                        <p key={`m${medida.id}`} className="text-[#b3382c]">
                          <b>Medida:</b> {medida.nome} ({medida.status})
                        </p>
                      ))}
                      {item.ocorrencias.map(ocorrencia => (
                        <p key={`o${ocorrencia.id}`} className="text-[#7a4d0a]">
                          <b>Ocorrência nº {ocorrencia.id}:</b>{" "}
                          {ocorrencia.status === "resolvida"
                            ? `concluída (${ocorrencia.conclusao ?? "sem conclusão"})`
                            : ocorrencia.status.replace("_", " ")}
                        </p>
                      ))}
                    </div>
                  )}
                  {item.historico.length > 0 && (
                    <details className="mt-3 rounded-xl border border-[#e5eee8] px-3 py-2 text-xs">
                      <summary className="cursor-pointer font-semibold text-[#0f7350]">
                        Histórico de alterações ({item.historico.length})
                      </summary>
                      <ol className="mt-2 grid gap-1.5">
                        {item.historico.map(evento => (
                          <li key={evento.id}>
                            <span className="text-muted-foreground">
                              {formatarDataHora(evento.criadoEm)} · {evento.autor}
                            </span>
                            <br />
                            {evento.resumo}
                            {evento.motivo ? ` Motivo: ${evento.motivo}` : ""}
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                  {ehAdmin && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {item.situacao === "pendente" && (
                        <Button
                          size="sm"
                          onClick={() => onAprovar(item.id)}
                          className="h-8 rounded-lg bg-[#0f7350] text-xs text-white hover:bg-[#0a6243]"
                        >
                          <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                          Aprovar
                        </Button>
                      )}
                      {(item.situacao === "pendente" ||
                        item.situacao === "aprovado") && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onReprovar(alvo)}
                          className="h-8 rounded-lg border-[#e3b6b0] text-xs text-[#b3382c]"
                        >
                          <XCircle className="mr-1.5 h-3.5 w-3.5" />
                          Reprovar
                        </Button>
                      )}
                      {(item.situacao === "pendente" ||
                        item.situacao === "aprovado") && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onAuditar(alvo)}
                          className="h-8 rounded-lg border-[#d8cdf1] text-xs text-[#5b3aa6]"
                        >
                          <ShieldAlert className="mr-1.5 h-3.5 w-3.5" />
                          Abrir auditoria
                        </Button>
                      )}
                      {item.situacao === "aprovado" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onReverter(alvo)}
                          className="h-8 rounded-lg border-[#f0dcb8] text-xs text-[#7a4d0a]"
                        >
                          <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                          Reverter aprovação
                        </Button>
                      )}
                      {item.situacao === "auditoria" && (
                        <Button
                          size="sm"
                          onClick={() => onConcluir(alvo)}
                          className="h-8 rounded-lg bg-[#5b3aa6] text-xs text-white hover:bg-[#4a2f89]"
                        >
                          <Gavel className="mr-1.5 h-3.5 w-3.5" />
                          Concluir auditoria
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DialogoReprovar({
  alvo,
  onClose,
  onDone,
}: {
  alvo: Alvo | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const reprovar = trpc.coletas.reprovar.useMutation({
    onSuccess: resultado => {
      onDone();
      onClose();
      setMotivo("");
      toast.success(
        resultado.pointsReversed
          ? `Descarte reprovado; ${resultado.pointsReversed} ponto(s) estornado(s).`
          : "Descarte reprovado. O morador recebeu o motivo."
      );
    },
    onError: issue => toast.error(issue.message),
  });
  return (
    <Dialog
      open={alvo !== null}
      onOpenChange={aberto => {
        if (!aberto) {
          onClose();
          setMotivo("");
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reprovar descarte nº {alvo?.id}</DialogTitle>
          <DialogDescription>
            {alvo?.resumo}.{" "}
            {alvo?.situacao === "aprovado"
              ? `Os ${formatarPontos(alvo.pontos)} ponto(s) já lançados serão estornados.`
              : "Os pontos previstos não serão creditados."}{" "}
            O morador recebe o motivo.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={event => {
            event.preventDefault();
            if (alvo) reprovar.mutate({ id: alvo.id, motivo });
          }}
          className="grid gap-3"
        >
          <label className="grid gap-1.5 text-xs font-semibold">
            Motivo (obrigatório)
            <textarea
              required
              minLength={5}
              maxLength={500}
              value={motivo}
              onChange={event => setMotivo(event.target.value)}
              placeholder="Ex.: a foto não mostra o visor; material misturado"
              className="min-h-24 rounded-xl border border-[#dce8e0] bg-white p-3 text-sm"
            />
          </label>
          <DialogFooter>
            <Button
              type="submit"
              disabled={reprovar.isPending || motivo.trim().length < 5}
              className="h-10 rounded-xl bg-[#b3382c] text-white hover:bg-[#962d23]"
            >
              {reprovar.isPending ? "Reprovando..." : "Reprovar descarte"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DialogoAuditoria({
  alvo,
  onClose,
  onDone,
}: {
  alvo: Alvo | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const abrir = trpc.coletas.abrirAuditoria.useMutation({
    onSuccess: () => {
      onDone();
      onClose();
      setMotivo("");
      toast.success("Auditoria aberta. O morador foi avisado.");
    },
    onError: issue => toast.error(issue.message),
  });
  return (
    <Dialog
      open={alvo !== null}
      onOpenChange={aberto => {
        if (!aberto) {
          onClose();
          setMotivo("");
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Abrir auditoria no descarte nº {alvo?.id}</DialogTitle>
          <DialogDescription>
            {alvo?.resumo}. Use para casos graves: suspeita de furto, peso
            forjado ou tentativa de burlar a estação. O morador recebe um aviso
            de que o descarte está em auditoria (pode ser só um mal-entendido) e
            os pontos ficam parados até o parecer.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={event => {
            event.preventDefault();
            if (alvo) abrir.mutate({ id: alvo.id, motivo });
          }}
          className="grid gap-3"
        >
          <label className="grid gap-1.5 text-xs font-semibold">
            O que pareceu suspeito (vai para o morador)
            <textarea
              required
              minLength={10}
              maxLength={800}
              value={motivo}
              onChange={event => setMotivo(event.target.value)}
              placeholder="Ex.: o mesmo saco aparece em duas fotos seguidas"
              className="min-h-24 rounded-xl border border-[#dce8e0] bg-white p-3 text-sm"
            />
          </label>
          <DialogFooter>
            <Button
              type="submit"
              disabled={abrir.isPending || motivo.trim().length < 10}
              className="h-10 rounded-xl bg-[#5b3aa6] text-white hover:bg-[#4a2f89]"
            >
              {abrir.isPending ? "Abrindo..." : "Abrir auditoria"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DialogoConcluirAuditoria({
  alvo,
  onClose,
  onDone,
}: {
  alvo: Alvo | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [resultado, setResultado] = useState<"regular" | "irregular">(
    "regular"
  );
  const [parecer, setParecer] = useState("");
  const [penalidade, setPenalidade] = useState("0");
  const [medidas, setMedidas] = useState<number[]>([]);
  const modelos = trpc.penalidades.modelos.useQuery(
    { somenteAtivos: true },
    { enabled: alvo !== null }
  );
  const limpar = () => {
    setResultado("regular");
    setParecer("");
    setPenalidade("0");
    setMedidas([]);
  };
  const concluir = trpc.coletas.concluirAuditoria.useMutation({
    onSuccess: resposta => {
      onDone();
      onClose();
      limpar();
      toast.success(
        resultado === "regular"
          ? "Auditoria concluída: descarte aprovado."
          : `Auditoria concluída: descarte reprovado${resposta.medidasAplicadas.length ? `; medidas: ${resposta.medidasAplicadas.join(", ")}` : ""}.`
      );
    },
    onError: issue => toast.error(issue.message),
  });
  const escolhidas = (modelos.data ?? []).filter(modelo =>
    medidas.includes(modelo.id)
  );
  const retirada = Number(penalidade) || 0;
  const pontosDasMedidas = escolhidas.reduce(
    (soma, modelo) =>
      soma + (modelo.tipo === "perda_pontos" ? modelo.pontos ?? 0 : 0),
    0
  );
  const consequencias =
    resultado === "regular"
      ? [
          "O descarte é aprovado e os pontos entram (ou continuam) no saldo.",
          "O morador recebe o parecer como notificação.",
        ]
      : [
          "O descarte é reprovado e os pontos dele saem do saldo.",
          pontosDasMedidas + retirada > 0
            ? `Mais ${pontosDasMedidas + retirada} ponto(s) retirados do saldo e da pontuação do pódio.`
            : null,
          ...escolhidas
            .filter(modelo => modelo.tipo !== "perda_pontos")
            .map(modelo => `Medida: ${modelo.nome}.`),
          "O morador recebe o parecer e as medidas como notificação.",
        ].filter((linha): linha is string => Boolean(linha));
  return (
    <Dialog
      open={alvo !== null}
      onOpenChange={aberto => {
        if (!aberto) {
          onClose();
          limpar();
        }
      }}
    >
      <DialogContent className="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="border-b border-[#e6eee9] px-5 py-4">
          <DialogTitle>Concluir auditoria nº {alvo?.id}</DialogTitle>
          <DialogDescription className="line-clamp-2">
            {alvo?.resumo}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={event => {
            event.preventDefault();
            if (alvo)
              concluir.mutate({
                id: alvo.id,
                resultado,
                parecer,
                penalidadePontos: resultado === "irregular" ? retirada : 0,
                medidas: resultado === "irregular" ? medidas : [],
              });
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-5 py-4">
            <fieldset className="grid gap-2">
              <legend className="mb-1.5 text-xs font-semibold">
                1. Resultado
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {(["regular", "irregular"] as const).map(opcao => (
                  <button
                    key={opcao}
                    type="button"
                    aria-pressed={resultado === opcao}
                    onClick={() => setResultado(opcao)}
                    className={`rounded-xl border px-3 py-2 text-left text-sm ${resultado === opcao ? (opcao === "regular" ? "border-[#0f7350] bg-[#edf7f1]" : "border-[#b3382c] bg-[#fbeceb]") : "border-[#dce8e0] bg-white"}`}
                  >
                    <b>{opcao === "regular" ? "Regular" : "Irregular"}</b>
                    <span className="block text-xs text-muted-foreground">
                      {opcao === "regular"
                        ? "Era um mal-entendido"
                        : "Fraude confirmada"}
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="grid gap-1.5 text-xs font-semibold">
              2. Parecer (vai para o morador)
              <textarea
                required
                minLength={10}
                maxLength={800}
                rows={3}
                value={parecer}
                onChange={event => setParecer(event.target.value)}
                placeholder={
                  resultado === "regular"
                    ? "Ex.: conferimos as fotos e o peso bate com o saco; não houve irregularidade."
                    : "Ex.: o mesmo saco aparece em duas pesagens seguidas, com 10 minutos de diferença."
                }
                className="rounded-xl border border-[#dce8e0] bg-white p-3 text-sm font-normal"
              />
              <span className="text-right font-normal text-muted-foreground">
                {parecer.trim().length < 10
                  ? `Faltam ${10 - parecer.trim().length} letra(s)`
                  : `${parecer.length}/800`}
              </span>
            </label>
            {resultado === "irregular" && (
              <fieldset className="grid gap-2 text-xs">
                <legend className="mb-1.5 font-semibold">
                  3. Medidas (opcional, pré-definidas em Configurações)
                </legend>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {(modelos.data ?? []).map(modelo => (
                    <label
                      key={modelo.id}
                      title={modelo.descricao ?? undefined}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 ${medidas.includes(modelo.id) ? "border-[#b3382c] bg-[#fdf6f5]" : "border-[#e6eee9] bg-white"}`}
                    >
                      <input
                        type="checkbox"
                        checked={medidas.includes(modelo.id)}
                        onChange={event =>
                          setMedidas(lista =>
                            event.target.checked
                              ? [...lista, modelo.id]
                              : lista.filter(item => item !== modelo.id)
                          )
                        }
                      />
                      <span className="leading-4">{modelo.nome}</span>
                    </label>
                  ))}
                </div>
                <label className="mt-1 flex flex-wrap items-center gap-2 font-semibold">
                  Retirar mais pontos (avulso):
                  <Input
                    type="number"
                    min={0}
                    max={1000}
                    value={penalidade}
                    onChange={event => setPenalidade(event.target.value)}
                    className="h-8 w-24 rounded-lg"
                  />
                </label>
              </fieldset>
            )}
            <div
              className={`rounded-xl border p-3 text-xs leading-5 ${resultado === "regular" ? "border-[#cfe1d7] bg-[#f7fbf8]" : "border-[#f0c9c4] bg-[#fdf6f5]"}`}
              aria-live="polite"
            >
              <b>O que vai acontecer</b>
              <ul className="mt-1 list-disc pl-4">
                {consequencias.map(linha => (
                  <li key={linha}>{linha}</li>
                ))}
              </ul>
            </div>
          </div>
          <DialogFooter className="border-t border-[#e6eee9] px-5 py-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                onClose();
                limpar();
              }}
              className="h-10 rounded-xl"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={concluir.isPending || parecer.trim().length < 10}
              className={`h-10 rounded-xl text-white ${resultado === "regular" ? "bg-[#0f7350] hover:bg-[#0a6243]" : "bg-[#b3382c] hover:bg-[#962e24]"}`}
            >
              {concluir.isPending
                ? "Concluindo..."
                : resultado === "regular"
                  ? "Concluir: aprovar descarte"
                  : "Concluir: reprovar descarte"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Reverte uma aprovação (da IA ou de um administrador): nova avaliação (pontos saem) ou auditoria. */
function DialogoReverter({
  alvo,
  onClose,
  onDone,
}: {
  alvo: Alvo | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [destino, setDestino] = useState<"nova_avaliacao" | "auditoria">(
    "nova_avaliacao"
  );
  const reverter = trpc.coletas.reverterAprovacao.useMutation({
    onSuccess: resultado => {
      onDone();
      onClose();
      setMotivo("");
      toast.success(
        resultado.destino === "auditoria"
          ? "Descarte enviado para auditoria."
          : `Aprovação revertida${resultado.pointsReversed ? `; ${resultado.pointsReversed} ponto(s) saíram do saldo` : ""}. O descarte voltou para a fila de aprovação.`
      );
    },
    onError: issue => toast.error(issue.message),
  });
  return (
    <Dialog
      open={alvo !== null}
      onOpenChange={aberto => {
        if (!aberto) {
          onClose();
          setMotivo("");
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reverter aprovação do nº {alvo?.id}</DialogTitle>
          <DialogDescription>
            {alvo?.resumo}. Use quando um problema aparecer depois da aprovação
            (por exemplo, uma denúncia). O morador é avisado.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={event => {
            event.preventDefault();
            if (alvo) reverter.mutate({ id: alvo.id, motivo, destino });
          }}
          className="grid gap-3"
        >
          <div className="grid grid-cols-2 gap-2">
            {(["nova_avaliacao", "auditoria"] as const).map(opcao => (
              <button
                key={opcao}
                type="button"
                onClick={() => setDestino(opcao)}
                className={`rounded-xl border p-3 text-left text-sm ${destino === opcao ? "border-[#7a4d0a] bg-[#fff8ec]" : "border-[#dce8e0] bg-white"}`}
              >
                <b>
                  {opcao === "nova_avaliacao" ? "Nova avaliação" : "Auditoria"}
                </b>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {opcao === "nova_avaliacao"
                    ? "Os pontos saem do saldo e o descarte volta para a fila."
                    : "Caso grave: apuração formal, com medidas se confirmado."}
                </span>
              </button>
            ))}
          </div>
          <label className="grid gap-1.5 text-xs font-semibold">
            Motivo (vai para o morador)
            <textarea
              required
              minLength={10}
              maxLength={800}
              value={motivo}
              onChange={event => setMotivo(event.target.value)}
              className="min-h-24 rounded-xl border border-[#dce8e0] bg-white p-3 text-sm"
            />
          </label>
          <DialogFooter>
            <Button
              type="submit"
              disabled={reverter.isPending || motivo.trim().length < 10}
              className="h-10 rounded-xl bg-[#7a4d0a] text-white hover:bg-[#633e08]"
            >
              {reverter.isPending ? "Revertendo..." : "Reverter aprovação"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** No celular do morador: gera o código de 6 números para se identificar no tablet da estação de pesagem. */
function CodigoEstacao() {
  const [codigo, setCodigo] = useState<{
    code: string;
    expiresAt: Date;
    qrDataUrl: string;
  } | null>(null);
  const [agora, setAgora] = useState(() => Date.now());
  const utils = trpc.useUtils();
  const gerar = trpc.estacao.gerarCodigo.useMutation({
    onSuccess: dados => {
      setCodigo(dados);
      utils.notificacoes.contagemNaoLidas.invalidate();
    },
    onError: issue => toast.error(issue.message),
  });
  useEffect(() => {
    if (!codigo) return;
    const relogio = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(relogio);
  }, [codigo]);
  const restante = codigo
    ? Math.max(
        0,
        Math.round((new Date(codigo.expiresAt).getTime() - agora) / 1000)
      )
    : 0;
  const valido = codigo !== null && restante > 0;
  return (
    <section className="mb-5 rounded-[24px] border border-[#cfe1d7] bg-[#f7fbf8] p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#e8f4ed] text-[#0f7350]">
            <Scale className="h-5 w-5" />
          </span>
          <div>
            <p className="font-semibold">Registrar descarte na estação</p>
            <p className="text-sm leading-6 text-muted-foreground">
              Leve os sacos (um ou vários tipos) até o tablet ao lado das
              lixeiras, gere o código aqui e digite no tablet. O tablet mostra
              cada passo: escolher os tipos, pesar cada saco e fotografar o
              visor.
            </p>
          </div>
        </div>
        <Button
          onClick={() => gerar.mutate()}
          disabled={gerar.isPending}
          className="h-10 shrink-0 rounded-xl bg-[#0f7350] font-semibold text-white hover:bg-[#0a6243]"
        >
          <KeyRound className="mr-2 h-4 w-4" />
          {valido ? "Gerar outro código" : "Gerar código para a estação"}
        </Button>
      </div>
      {codigo && (
        <div
          className="mt-4 rounded-2xl border border-[#cfe1d7] bg-white p-4 text-center"
          aria-live="polite"
        >
          {valido ? (
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center sm:gap-6">
              <img
                src={codigo.qrDataUrl}
                alt={`QR do código ${codigo.code}`}
                className="h-32 w-32 rounded-xl border border-[#e2ebe5]"
              />
              <div>
                <p className="text-4xl font-bold tracking-[.3em] text-[#0f7350]">
                  {codigo.code}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Digite no tablet ou mostre o QR ao leitor. Vale por mais{" "}
                  {Math.floor(restante / 60)}:
                  {String(restante % 60).padStart(2, "0")} e só pode ser usado
                  uma vez.
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              O código venceu. Gere outro quando estiver na estação.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

import PageIntro from "@/components/PageIntro";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { imprimirSoFolha } from "@/lib/impressao";
import { linkDoAdesivo, MAXIMO_ADESIVOS_POR_PEDIDO } from "@shared/adesivos";
import {
  CheckCircle2,
  PackageCheck,
  Printer,
  QrCode,
  ScanLine,
  Send,
  Tag,
  XCircle,
} from "lucide-react";
import QRCode from "qrcode";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "wouter";
import { toast } from "sonner";

const formatarData = (valor: Date | string | null | undefined) =>
  valor
    ? new Date(valor).toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";

const rotuloStatusPedido = {
  solicitado: "Aguardando",
  entregue: "Entregue",
  recusado: "Recusado",
} as const;
const estiloStatusPedido = {
  solicitado: "border-0 bg-[#fff3df] text-[#7a4d0a] hover:bg-[#fff3df]",
  entregue: "border-0 bg-[#e7f5ec] text-[#0a7048] hover:bg-[#e7f5ec]",
  recusado: "border-0 bg-[#fbeceb] text-[#b3382c] hover:bg-[#fbeceb]",
} as const;

/**
 * Adesivos com QR Code: o morador acompanha quantos tem e pede mais; a administração entrega (e imprime a folha),
 * recusa pedidos e cancela adesivos perdidos.
 */
export default function Adesivos() {
  const perfil = trpc.perfil.meuPerfil.useQuery();
  if (perfil.isLoading) return null;
  return perfil.data?.role === "administrador" ? (
    <AdesivosAdministracao />
  ) : (
    <MeusAdesivos />
  );
}

function Resumo({
  itens,
}: {
  itens: Array<{ rotulo: string; valor: number; destaque?: boolean }>;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {itens.map(item => (
        <div
          key={item.rotulo}
          className={`rounded-2xl border p-4 ${item.destaque ? "border-[#b9d8c5] bg-[#f1f9f4]" : "border-[#e1ebe5] bg-white"}`}
        >
          <p className="text-[11px] font-bold tracking-[.08em] text-muted-foreground uppercase">
            {item.rotulo}
          </p>
          <p className="mt-1 text-3xl font-bold tracking-[-.04em] text-[#0f7350]">
            {item.valor}
          </p>
        </div>
      ))}
    </div>
  );
}

function MeusAdesivos() {
  const utils = trpc.useUtils();
  const meus = trpc.adesivos.meus.useQuery();
  const [quantidade, setQuantidade] = useState("20");
  const [observacao, setObservacao] = useState("");
  const solicitar = trpc.adesivos.solicitar.useMutation({
    onSuccess: () => {
      toast.success("Pedido enviado. A administração foi avisada.");
      setObservacao("");
      void utils.adesivos.meus.invalidate();
    },
    onError: erro => toast.error(erro.message),
  });
  const dados = meus.data;
  function enviar(event: FormEvent) {
    event.preventDefault();
    solicitar.mutate({
      quantidade: Number(quantidade),
      observacao: observacao || undefined,
    });
  }
  return (
    <div className="grid gap-6 [&>*]:min-w-0">
      <PageIntro
        eyebrow="Identificação dos sacos"
        title="Meus adesivos"
        description="Cada saco que você leva à estação precisa de um adesivo com QR Code do seu kit. Cada adesivo vale para um saco só e passa a constar como usado assim que o descarte é registrado. O QR traz só um código, nunca o seu nome ou apartamento."
      />
      {dados && (
        <Resumo
          itens={[
            {
              rotulo: "Disponíveis",
              valor: dados.disponivel,
              destaque: true,
            },
            { rotulo: "Usados", valor: dados.utilizado },
            { rotulo: "Cancelados", valor: dados.cancelado },
          ]}
        />
      )}
      {dados && dados.disponivel <= 3 && (
        <p
          role="status"
          className="rounded-2xl bg-[#fff3df] px-4 py-3 text-sm text-[#7a4d0a]"
        >
          {dados.disponivel
            ? `Restam só ${dados.disponivel} adesivo(s). Peça mais para não ficar sem.`
            : "Seus adesivos acabaram. Sem adesivo não dá para registrar o descarte na estação."}
        </p>
      )}
      <section className="rounded-[24px] border border-[#dce8e0] bg-white p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Send className="h-4 w-4 text-[#0f7350]" />
          Pedir mais adesivos
        </h2>
        {dados?.pedidoAberto ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Você pediu {dados.pedidoAberto.quantidadeSolicitada} adesivo(s) em{" "}
            {formatarData(dados.pedidoAberto.criadoEm)}. A administração vai
            entregar e você recebe um aviso.
          </p>
        ) : (
          <form
            onSubmit={enviar}
            className="mt-4 grid gap-3 sm:grid-cols-[140px_1fr_auto] sm:items-end"
          >
            <label className="grid gap-1 text-sm font-medium">
              Quantidade
              <Input
                type="number"
                min={1}
                max={MAXIMO_ADESIVOS_POR_PEDIDO}
                value={quantidade}
                onChange={event => setQuantidade(event.target.value)}
                className="h-11 rounded-xl"
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Observação (opcional)
              <Input
                value={observacao}
                maxLength={300}
                onChange={event => setObservacao(event.target.value)}
                placeholder="Ex.: posso retirar na portaria"
                className="h-11 rounded-xl"
              />
            </label>
            <Button
              disabled={solicitar.isPending}
              className="h-11 rounded-xl bg-[#0f7350] text-white hover:bg-[#0a6243]"
            >
              {solicitar.isPending ? "Enviando..." : "Pedir"}
            </Button>
          </form>
        )}
      </section>
      <section className="rounded-[24px] border border-[#dce8e0] bg-white p-5 sm:p-6">
        <h2 className="text-base font-semibold">Pedidos e entregas</h2>
        {dados?.pedidos.length ? (
          <ul className="mt-3 divide-y divide-[#edf2ef] text-sm">
            {dados.pedidos.map(pedido => (
              <li
                key={pedido.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5"
              >
                <span>
                  Pedido nº {pedido.id} · {pedido.quantidadeSolicitada}{" "}
                  adesivo(s) · {formatarData(pedido.criadoEm)}
                  {pedido.observacao ? (
                    <span className="block text-xs text-muted-foreground">
                      {pedido.observacao}
                    </span>
                  ) : null}
                </span>
                <span className="flex items-center gap-2">
                  {pedido.status === "entregue" && (
                    <span className="text-xs text-muted-foreground">
                      {pedido.quantidadeEntregue} entregue(s) em{" "}
                      {formatarData(pedido.entregueEm)}
                    </span>
                  )}
                  <Badge className={estiloStatusPedido[pedido.status]}>
                    {rotuloStatusPedido[pedido.status]}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Nenhum pedido ainda.
          </p>
        )}
      </section>
      <section className="rounded-[24px] border border-[#dce8e0] bg-white p-5 sm:p-6">
        <h2 className="text-base font-semibold">Códigos dos meus adesivos</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Se o QR estiver amassado, o tablet aceita o código digitado.
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {dados?.adesivos.map(adesivo => (
            <li
              key={adesivo.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-[#e6eee9] px-3 py-2 text-sm"
            >
              <span className="font-mono tracking-[.06em]">
                {adesivo.codigo}
              </span>
              {adesivo.status === "utilizado" && adesivo.coletaId ? (
                <Link
                  href={`/descartes?id=${adesivo.coletaId}`}
                  className="text-xs font-semibold text-[#0f7350] underline"
                >
                  Usado no nº {adesivo.coletaId}
                </Link>
              ) : (
                <Badge
                  className={
                    adesivo.status === "disponivel"
                      ? estiloStatusPedido.entregue
                      : estiloStatusPedido.recusado
                  }
                >
                  {adesivo.status === "disponivel" ? "Disponível" : "Cancelado"}
                </Badge>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

type Folha = {
  pedidoId: number;
  morador: string;
  bloco: string;
  apartamento: string;
  codigos: string[];
};

function AdesivosAdministracao() {
  const utils = trpc.useUtils();
  const perfil = trpc.perfil.meuPerfil.useQuery();
  const pedidos = trpc.adesivos.pedidos.useQuery();
  const porMorador = trpc.adesivos.porMorador.useQuery();
  const [quantidades, setQuantidades] = useState<Record<number, string>>({});
  const [folha, setFolha] = useState<Folha | null>(null);
  const [cancelamento, setCancelamento] = useState({ codigo: "", motivo: "" });
  const [filtro, setFiltro] = useState("");
  const atualizar = () => {
    void utils.adesivos.pedidos.invalidate();
    void utils.adesivos.porMorador.invalidate();
  };
  const entregar = trpc.adesivos.entregar.useMutation({
    onSuccess: (resultado, variaveis) => {
      const morador = porMorador.data?.find(
        item => item.id === variaveis.moradorId
      );
      toast.success(
        `${resultado.codigos.length} adesivo(s) gerado(s). Imprima a folha e entregue ao morador.`
      );
      setFolha({
        pedidoId: resultado.pedidoId,
        morador: morador?.nome ?? "",
        bloco: morador?.bloco ?? "",
        apartamento: morador?.apartamento ?? "",
        codigos: resultado.codigos,
      });
      atualizar();
    },
    onError: erro => toast.error(erro.message),
  });
  const recusar = trpc.adesivos.recusar.useMutation({
    onSuccess: () => {
      toast.success("Pedido recusado; o morador foi avisado.");
      atualizar();
    },
    onError: erro => toast.error(erro.message),
  });
  const cancelar = trpc.adesivos.cancelar.useMutation({
    onSuccess: () => {
      toast.success("Adesivo cancelado: ele não vale mais na estação.");
      setCancelamento({ codigo: "", motivo: "" });
      atualizar();
    },
    onError: erro => toast.error(erro.message),
  });
  const reimprimir = trpc.useUtils().adesivos.folha;
  async function imprimirPedido(pedidoId: number) {
    const dados = await reimprimir.fetch({ pedidoId });
    setFolha({
      pedidoId,
      morador: dados.morador,
      bloco: dados.bloco,
      apartamento: dados.apartamento,
      codigos: dados.adesivos.map(adesivo => adesivo.codigo),
    });
  }
  const abertos = pedidos.data?.filter(pedido => pedido.status === "solicitado") ?? [];
  const historico = pedidos.data?.filter(pedido => pedido.status !== "solicitado") ?? [];
  const moradoresFiltrados = useMemo(
    () =>
      (porMorador.data ?? []).filter(morador =>
        `${morador.nome} ${morador.bloco} ${morador.apartamento}`
          .toLowerCase()
          .includes(filtro.toLowerCase())
      ),
    [porMorador.data, filtro]
  );
  return (
    <div className="grid gap-6 [&>*]:min-w-0">
      <PageIntro
        eyebrow="Identificação dos sacos"
        title="Adesivos QR"
        description="Entregue os kits de adesivos (um por saco, uso único), atenda os pedidos dos moradores e imprima as folhas. O QR e o número impresso não trazem dados pessoais: só quem tem permissão consulta o dono em Ler QR."
        action={
          <Button asChild variant="outline" className="h-10 rounded-xl">
            <Link href="/leitura">
              <ScanLine className="mr-2 h-4 w-4" />
              Ler QR de um saco
            </Link>
          </Button>
        }
      />
      <section className="rounded-[24px] border border-[#dce8e0] bg-white p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <PackageCheck className="h-4 w-4 text-[#0f7350]" />
          Pedidos aguardando ({abertos.length})
        </h2>
        {abertos.length ? (
          <ul className="mt-3 grid gap-3">
            {abertos.map(pedido => (
              <li
                key={pedido.id}
                className="grid gap-3 rounded-2xl border border-[#f0dcb8] bg-[#fffaf1] p-4 sm:grid-cols-[1fr_auto] sm:items-center"
              >
                <div className="text-sm">
                  <p className="font-semibold">
                    {pedido.morador} · bloco {pedido.bloco}, apto{" "}
                    {pedido.apartamento}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Pediu {pedido.quantidadeSolicitada} em{" "}
                    {formatarData(pedido.criadoEm)} · tem {pedido.disponiveis}{" "}
                    disponível(is)
                    {pedido.observacao ? ` · "${pedido.observacao}"` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={MAXIMO_ADESIVOS_POR_PEDIDO}
                    aria-label="Quantidade a entregar"
                    value={
                      quantidades[pedido.id] ??
                      String(pedido.quantidadeSolicitada)
                    }
                    onChange={event =>
                      setQuantidades(atual => ({
                        ...atual,
                        [pedido.id]: event.target.value,
                      }))
                    }
                    className="h-10 w-20 rounded-xl bg-white"
                  />
                  <Button
                    disabled={entregar.isPending}
                    onClick={() =>
                      entregar.mutate({
                        moradorId: pedido.moradorId,
                        pedidoId: pedido.id,
                        quantidade: Number(
                          quantidades[pedido.id] ?? pedido.quantidadeSolicitada
                        ),
                      })
                    }
                    className="h-10 rounded-xl bg-[#0f7350] text-white hover:bg-[#0a6243]"
                  >
                    <CheckCircle2 className="mr-1.5 h-4 w-4" />
                    Entregar
                  </Button>
                  <Button
                    variant="outline"
                    disabled={recusar.isPending}
                    onClick={() => {
                      const motivo = window.prompt(
                        "Motivo da recusa (vai para o morador):"
                      );
                      if (motivo && motivo.trim().length >= 5)
                        recusar.mutate({ pedidoId: pedido.id, motivo });
                    }}
                    className="h-10 rounded-xl"
                  >
                    <XCircle className="mr-1.5 h-4 w-4" />
                    Recusar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Nenhum pedido aguardando.
          </p>
        )}
      </section>
      {folha && (
        <FolhaAdesivos
          folha={folha}
          condominio={perfil.data?.condominium?.nome ?? "Condomínio"}
          onFechar={() => setFolha(null)}
        />
      )}
      <section className="rounded-[24px] border border-[#dce8e0] bg-white p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Tag className="h-4 w-4 text-[#0f7350]" />
              Adesivos por morador
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Entregue um kit direto (sem pedido), por exemplo na mudança.
            </p>
          </div>
          <Input
            value={filtro}
            onChange={event => setFiltro(event.target.value)}
            placeholder="Buscar por nome, bloco ou apto"
            className="h-10 rounded-xl sm:w-64"
          />
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-[11px] tracking-[.08em] text-muted-foreground uppercase">
                <th className="py-2">Morador</th>
                <th>Disponíveis</th>
                <th>Usados</th>
                <th>Cancelados</th>
                <th className="text-right">Entregar kit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf2ef]">
              {moradoresFiltrados.map(morador => (
                <tr key={morador.id}>
                  <td className="py-2.5">
                    {morador.nome}
                    <span className="block text-xs text-muted-foreground">
                      Bloco {morador.bloco}, apto {morador.apartamento}
                    </span>
                  </td>
                  <td
                    className={
                      morador.disponivel <= 3
                        ? "font-semibold text-[#b3382c]"
                        : ""
                    }
                  >
                    {morador.disponivel}
                  </td>
                  <td>{morador.utilizado}</td>
                  <td>{morador.cancelado}</td>
                  <td className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={entregar.isPending || morador.status !== "ativo"}
                      onClick={() =>
                        entregar.mutate({ moradorId: morador.id, quantidade: 20 })
                      }
                      className="rounded-lg"
                    >
                      +20
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-[24px] border border-[#dce8e0] bg-white p-5 sm:p-6">
          <h2 className="text-base font-semibold">Histórico de entregas</h2>
          <ul className="mt-3 divide-y divide-[#edf2ef] text-sm">
            {historico.slice(0, 30).map(pedido => (
              <li
                key={pedido.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5"
              >
                <span>
                  {pedido.morador} · bloco {pedido.bloco}
                  <span className="block text-xs text-muted-foreground">
                    Nº {pedido.id} ·{" "}
                    {pedido.status === "entregue"
                      ? `${pedido.quantidadeEntregue} entregue(s) em ${formatarData(pedido.entregueEm)}`
                      : `recusado: ${pedido.observacao ?? ""}`}
                  </span>
                </span>
                {pedido.status === "entregue" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void imprimirPedido(pedido.id)}
                  >
                    <Printer className="mr-1.5 h-4 w-4" />
                    Folha
                  </Button>
                )}
              </li>
            ))}
            {!historico.length && (
              <li className="py-2.5 text-muted-foreground">
                Nenhuma entrega ainda.
              </li>
            )}
          </ul>
        </div>
        <form
          onSubmit={event => {
            event.preventDefault();
            cancelar.mutate(cancelamento);
          }}
          className="grid content-start gap-3 rounded-[24px] border border-[#dce8e0] bg-white p-5 sm:p-6"
        >
          <h2 className="text-base font-semibold">
            Cancelar adesivo perdido ou danificado
          </h2>
          <Input
            required
            value={cancelamento.codigo}
            onChange={event =>
              setCancelamento(atual => ({
                ...atual,
                codigo: event.target.value.toUpperCase(),
              }))
            }
            placeholder="EC-XXXX-XXXX"
            className="h-11 rounded-xl font-mono"
          />
          <Input
            required
            minLength={5}
            value={cancelamento.motivo}
            onChange={event =>
              setCancelamento(atual => ({ ...atual, motivo: event.target.value }))
            }
            placeholder="Motivo (fica na auditoria)"
            className="h-11 rounded-xl"
          />
          <Button
            variant="outline"
            disabled={cancelar.isPending}
            className="h-11 rounded-xl"
          >
            Cancelar adesivo
          </Button>
        </form>
      </section>
    </div>
  );
}

/** Prévia e impressão da folha de adesivos (4 por linha, recortáveis). Cada adesivo tem só o QR e o código. */
function FolhaAdesivos({
  folha,
  condominio,
  onFechar,
}: {
  folha: Folha;
  condominio: string;
  onFechar: () => void;
}) {
  const [imagens, setImagens] = useState<Record<string, string>>({});
  useEffect(() => {
    let ativo = true;
    void Promise.all(
      folha.codigos.map(async codigo => [
        codigo,
        await QRCode.toDataURL(linkDoAdesivo(window.location.origin, codigo), {
          width: 240,
          margin: 1,
          color: { dark: "#0f563e", light: "#ffffff" },
        }),
      ])
    ).then(lista => {
      if (ativo) setImagens(Object.fromEntries(lista));
    });
    return () => {
      ativo = false;
    };
  }, [folha]);
  const adesivos = folha.codigos.map(codigo => (
    <div key={codigo} className="adesivo-qr">
      {imagens[codigo] && <img src={imagens[codigo]} alt="" />}
      <b>{codigo}</b>
      <span>EcoCondo</span>
    </div>
  ));
  return (
    <section className="rounded-[24px] border border-[#b9d8c5] bg-[#f6fbf8] p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <QrCode className="h-4 w-4 text-[#0f7350]" />
            Folha de adesivos · pedido nº {folha.pedidoId}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {folha.codigos.length} adesivo(s) para {folha.morador} (bloco{" "}
            {folha.bloco}, apto {folha.apartamento}). Os adesivos levam só o QR
            e o código.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={imprimirSoFolha}
            className="h-10 rounded-xl bg-[#0f7350] text-white hover:bg-[#0a6243]"
          >
            <Printer className="mr-2 h-4 w-4" />
            Imprimir
          </Button>
          <Button variant="ghost" onClick={onFechar} className="h-10 rounded-xl">
            Fechar
          </Button>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {folha.codigos.slice(0, 12).map(codigo => (
          <div
            key={codigo}
            className="rounded-xl border border-dashed border-[#9bb3a6] bg-white p-2 text-center"
          >
            {imagens[codigo] && (
              <img src={imagens[codigo]} alt={`QR do adesivo ${codigo}`} className="mx-auto w-full max-w-[90px]" />
            )}
            <p className="mt-1 font-mono text-[10px] tracking-[.04em]">
              {codigo}
            </p>
          </div>
        ))}
      </div>
      {folha.codigos.length > 12 && (
        <p className="mt-2 text-xs text-muted-foreground">
          E mais {folha.codigos.length - 12} na impressão.
        </p>
      )}
      {createPortal(
        <div className="so-impressao" aria-hidden="true">
          <div className="folha-adesivos">
            <p className="folha-adesivos-cabecalho">
              EcoCondo · {condominio} · pedido nº {folha.pedidoId} · entregar
              a: bloco {folha.bloco}, apto {folha.apartamento} (recorte os
              adesivos; esta linha não vai no saco)
            </p>
            <div className="folha-adesivos-grade">{adesivos}</div>
          </div>
        </div>,
        document.body
      )}
    </section>
  );
}

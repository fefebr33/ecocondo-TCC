import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/rotas";
import {
  rotuloCategoriaOcorrencia,
  rotuloTipoPenalidade,
} from "@shared/rotulos";
import { Bot, Gavel, Megaphone, QrCode, ShieldAlert, Siren } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Link } from "wouter";
import { plural } from "@shared/plural";

const cartao =
  "rounded-[24px] border border-[#dce8e0] bg-white p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.35)] sm:p-6";
const dica = {
  borderRadius: 14,
  border: "1px solid #dce8e0",
  fontSize: 12,
  background: "var(--card)",
  color: "var(--card-foreground)",
};
const coresCampanha = ["#0f7350", "#c99a2e", "#8a9a91", "#2863a5"];

type Gestao = NonNullable<inferRouterOutputs<AppRouter>["dashboard"]["resumo"]["gestao"]>;

/** Indicadores de gestão para o administrador: IA, auditorias, medidas, campanhas, adesivos, ocorrências e avisos. */
export default function IndicadoresGestao({ gestao }: { gestao: Gestao }) {
  const resultadoIa = [
    { nome: "Aprovados pela IA", valor: gestao.ia.aprovadasAutomaticamente, cor: "#0f7350" },
    { nome: "Para conferência", valor: gestao.ia.pendentes, cor: "#c99a2e" },
    { nome: "Análise indisponível", valor: gestao.ia.erros, cor: "#b3382c" },
  ].filter(item => item.valor > 0);
  const campanhas = [
    { nome: "Ativas", valor: gestao.campanhas.ativas },
    { nome: "Pausadas", valor: gestao.campanhas.pausadas },
    { nome: "Encerradas", valor: gestao.campanhas.encerradas },
    { nome: "Planejadas", valor: gestao.campanhas.planejadas },
  ];
  const medidas = Object.entries(gestao.penalidades.porTipo).map(([tipo, valor]) => ({
    valor: valor as number,
    nome: rotuloTipoPenalidade[tipo as keyof typeof rotuloTipoPenalidade] ?? tipo,
  }));
  const ocorrencias = Object.entries(gestao.ocorrencias.porCategoria).map(([categoria, valor]) => ({
    valor: valor as number,
    nome: rotuloCategoriaOcorrencia[categoria as keyof typeof rotuloCategoriaOcorrencia] ?? categoria,
  }));
  return (
    <section aria-label="Indicadores de gestão" className="mt-5 grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
      <article className={cartao}>
        <Titulo icone={Bot} texto="Análise automática (IA)" link="/configuracoes#ia" />
        <p className="mt-1 text-xs text-muted-foreground">
          {gestao.ia.modo === "claude" ? "IA ligada (Claude)" : "Modo simulação (sem chave da IA)"}
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <Numero rotulo="Análises" valor={gestao.ia.analises} />
          <Numero rotulo="Aprovação automática" valor={gestao.ia.taxaAprovacaoAutomatica === null ? "—" : `${gestao.ia.taxaAprovacaoAutomatica}%`} />
          <Numero rotulo="Confiança média" valor={gestao.ia.confiancaMedia === null ? "—" : `${gestao.ia.confiancaMedia}%`} />
        </div>
        {resultadoIa.length > 0 && (
          <div
            className="mt-3 h-40"
            role="img"
            aria-label={`Resultado da IA: ${resultadoIa.map(item => `${item.nome} ${item.valor}`).join(", ")}`}
          >
            <ResponsiveContainer>
              <PieChart>
                <Pie data={resultadoIa} dataKey="valor" nameKey="nome" innerRadius={38} outerRadius={64}>
                  {resultadoIa.map(item => (
                    <Cell key={item.nome} fill={item.cor} aria-label={`${item.nome}: ${item.valor}`} />
                  ))}
                </Pie>
                <Tooltip contentStyle={dica} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
        {gestao.ia.motivosComuns.length > 0 && (
          <ul className="mt-2 grid gap-1 text-xs text-muted-foreground">
            {gestao.ia.motivosComuns.map(item => (
              <li key={item.motivo} className="flex justify-between gap-2">
                <span className="truncate">{item.motivo}</span>
                <b>{item.quantidade}</b>
              </li>
            ))}
          </ul>
        )}
      </article>

      <article className={cartao}>
        <Titulo icone={Siren} texto="Auditoria e fiscalização" link="/descartes?situacao=auditoria" />
        <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <Numero rotulo="Em auditoria" valor={gestao.auditoria.emAndamento} />
          <Numero rotulo="Abertas" valor={gestao.auditoria.abertas} />
          <Numero rotulo="Regulares" valor={gestao.auditoria.concluidasRegulares} />
          <Numero rotulo="Reprovações" valor={gestao.auditoria.reprovacoes} />
          <Numero rotulo="Aprovações revertidas" valor={gestao.auditoria.aprovacoesRevertidas} />
          <Numero rotulo="Consultas de QR" valor={gestao.auditoria.consultasQr} />
        </div>
      </article>

      <article className={cartao}>
        <Titulo icone={Gavel} texto="Medidas administrativas" link="/configuracoes#medidas" />
        <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <Numero rotulo="Aplicadas" valor={gestao.penalidades.aplicadas} />
          <Numero rotulo="Vigentes" valor={gestao.penalidades.vigentes} />
          <Numero rotulo="Revogadas" valor={gestao.penalidades.revogadas} />
        </div>
        {medidas.length > 0 && <Barras dados={medidas} cor="#b45522" />}
      </article>

      <article className={cartao}>
        <Titulo icone={Megaphone} texto="Campanhas" link="/comunidade#campanhas" />
        <p className="mt-1 text-xs text-muted-foreground">
          {plural(gestao.campanhas.participacoes, "participação", "participações")}{" "}
          no total
        </p>
        <div className="mt-3 h-40">
          <ResponsiveContainer>
            <BarChart data={campanhas}>
              <CartesianGrid vertical={false} stroke="#edf2ef" />
              <XAxis dataKey="nome" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={24} />
              <Tooltip contentStyle={dica} />
              <Bar dataKey="valor" name="Campanhas" radius={[6, 6, 0, 0]}>
                {campanhas.map((item, indice) => (
                  <Cell key={item.nome} fill={coresCampanha[indice]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </article>

      <article className={cartao}>
        <Titulo icone={QrCode} texto="Adesivos QR" link="/adesivos" />
        <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <Numero rotulo="Entregues" valor={gestao.adesivos.entregues} />
          <Numero rotulo="Usados" valor={gestao.adesivos.utilizados} />
          <Numero rotulo="Com os moradores" valor={gestao.adesivos.disponiveis} />
          <Numero rotulo="Cancelados" valor={gestao.adesivos.cancelados} />
          <Numero rotulo="Pedidos abertos" valor={gestao.adesivos.pedidosAbertos} />
          <Numero rotulo="Avisos vistos" valor={gestao.avisos.taxaVisualizacao === null ? "—" : `${gestao.avisos.taxaVisualizacao}%`} />
        </div>
      </article>

      <article className={cartao}>
        <Titulo icone={ShieldAlert} texto="Ocorrências e denúncias" link="/ambiental#ocorrencias" />
        <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <Numero rotulo="Abertas" valor={gestao.ocorrencias.abertas} />
          <Numero rotulo="Procedentes" valor={gestao.ocorrencias.procedentes} />
          <Numero rotulo="Denúncias falsas" valor={gestao.ocorrencias.denunciasFalsas} />
        </div>
        {ocorrencias.length > 0 && <Barras dados={ocorrencias} cor="#2863a5" />}
      </article>
    </section>
  );
}

function Titulo({ icone: Icone, texto, link }: { icone: typeof Bot; texto: string; link: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <p className="flex items-center gap-2 text-base font-semibold">
        <Icone className="h-5 w-5 text-[#0f7350]" />
        {texto}
      </p>
      <Link href={link} className="text-xs font-semibold text-[#0f7350] hover:underline">
        Abrir
      </Link>
    </div>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: number | string }) {
  return (
    <div className="rounded-xl bg-[#f6faf7] p-2.5">
      <p className="text-[11px] leading-tight text-muted-foreground">{rotulo}</p>
      <p className="text-lg font-semibold">{valor}</p>
    </div>
  );
}

function Barras({ dados, cor }: { dados: Array<{ nome: string; valor: number }>; cor: string }) {
  return (
    <div className="mt-3 h-40">
      <ResponsiveContainer>
        <BarChart data={dados} layout="vertical" margin={{ left: 8 }}>
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="nome" width={120} tick={{ fontSize: 11 }} />
          <Tooltip contentStyle={dica} />
          <Bar dataKey="valor" name="Quantidade" fill={cor} radius={[0, 6, 6, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Avisos marcados como importantes ficam em destaque no painel até a pessoa marcar como lido. */
export function AvisosImportantes() {
  const utils = trpc.useUtils();
  const avisos = trpc.notificacoes.importantes.useQuery();
  const marcar = trpc.notificacoes.marcarLida.useMutation({
    onSuccess: () => {
      void utils.notificacoes.importantes.invalidate();
      void utils.notificacoes.invalidate();
    },
  });
  if (!avisos.data?.length) return null;
  return (
    <section aria-label="Avisos importantes" className="mb-5 grid gap-2">
      {avisos.data.map(aviso => (
        <article key={aviso.id} className="flex flex-wrap items-start justify-between gap-3 rounded-[20px] border border-[#b9d3ee] bg-[#eef5fc] p-4 text-sm">
          <span>
            <b className="flex items-center gap-2 text-[#1f4f84]">
              <Megaphone className="h-4 w-4" />
              {aviso.titulo}
            </b>
            <span className="mt-1 block whitespace-pre-line">{aviso.mensagem}</span>
          </span>
          <button
            type="button"
            onClick={() => marcar.mutate({ id: aviso.id })}
            className="rounded-lg border border-[#b9d3ee] bg-white px-3 py-1.5 text-xs font-semibold text-[#1f4f84]"
          >
            Li o aviso
          </button>
        </article>
      ))}
    </section>
  );
}

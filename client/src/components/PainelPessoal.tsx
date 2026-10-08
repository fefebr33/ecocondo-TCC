import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import {
  corDoTipo,
  estiloSituacao,
  formatarDataHora,
  rotuloResiduo,
  rotuloSituacao,
  TIPOS_RESIDUO,
} from "@/lib/descarte";
import { formatarNumero } from "@/lib/utils";
import {
  CalendarClock,
  Coins,
  Leaf,
  Recycle,
  Scale,
  TimerReset,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Link } from "wouter";
import GestaoMorador from "@/components/GestaoMorador";
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

/** Painel pessoal de descartes: quanto, de que tipos, quando e a situação de cada um. Sem `residentId`, é o do próprio morador. */
/**
 * Painel pessoal do morador. `compacto` (no painel do próprio morador, no celular principalmente) mostra primeiro os números
 * e os últimos descartes; os gráficos ficam recolhidos em "Ver gráficos do seu histórico".
 */
export default function PainelPessoal({
  residentId,
  compacto = false,
}: {
  residentId?: number;
  compacto?: boolean;
}) {
  const { data, isLoading, error } = trpc.dashboard.morador.useQuery(
    residentId ? { residentId } : undefined
  );
  const cores = Object.fromEntries(
    (trpc.guias.listar.useQuery().data ?? []).map(guia => [
      guia.tipoResiduo,
      guia.corSaco,
    ])
  );
  if (error)
    return (
      <p className={`${cartao} text-sm text-destructive`}>{error.message}</p>
    );
  if (isLoading || !data)
    return (
      <div
        aria-busy="true"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {[1, 2, 3, 4].map(item => (
          <span
            key={item}
            className="h-32 animate-pulse rounded-[22px] bg-[#edf3ef]"
          />
        ))}
      </div>
    );

  const pendentes = data.porSituacao.pendente + data.porSituacao.auditoria;
  const indicadores = [
    {
      rotulo: "Total descartado",
      valor: `${formatarNumero(data.totalKg)} kg`,
      ajuda: `${formatarNumero(data.recyclableKg)} kg de recicláveis (aprovados)`,
      icone: Scale,
    },
    {
      rotulo: "Descartes aprovados",
      valor: `${data.descartesAprovados}`,
      ajuda: data.ultimoDescarte
        ? `Último em ${formatarDataHora(data.ultimoDescarte)}`
        : "Nenhum ainda",
      icone: Recycle,
    },
    {
      rotulo: "Saldo de pontos",
      valor: `${data.morador.saldo}`,
      ajuda: `${data.pontosGanhos} ganhos em descartes aprovados${data.morador.fracaoGuardada > 0 ? `; mais ${formatarNumero(data.morador.fracaoGuardada)} guardado para o próximo ponto` : ""}`,
      icone: Coins,
    },
    {
      rotulo: "Aguardando decisão",
      valor: `${pendentes}`,
      ajuda: `${plural(data.porSituacao.pendente, "pendente", "pendentes")} · ${data.porSituacao.auditoria} em auditoria · ${plural(data.porSituacao.reprovado, "reprovado", "reprovados")}`,
      icone: TimerReset,
    },
  ];
  const porTipo = data.porTipo
    .filter(item => item.kilograms > 0)
    .map(item => ({
      nome: rotuloResiduo[item.wasteType],
      kg: item.kilograms,
      cor: corDoTipo(item.wasteType, cores),
    }));
  const temMeses = data.porMes.some(linha => Number(linha.descartes) > 0);

  const graficos = (
    <section className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
      <article className={cartao}>
        <p className="text-base font-semibold tracking-[-0.025em]">
          Quanto e quando
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Quilos aprovados por mês, separados por tipo (últimos 6 meses).
        </p>
        {temMeses ? (
          <div
            className="mt-4 h-[260px]"
            role="img"
            aria-label={`Quilos por mês: ${data.porMes.map(linha => `${linha.mes} ${TIPOS_RESIDUO.map(tipo => `${rotuloResiduo[tipo]} ${linha[tipo]} kg`).join(", ")}`).join("; ")}`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.porMes}
                margin={{ top: 8, right: 4, left: -20, bottom: 0 }}
              >
                <CartesianGrid stroke="#edf3ef" vertical={false} />
                <XAxis
                  dataKey="mes"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: "#6b7e74" }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: "#6b7e74" }}
                />
                <Tooltip
                  contentStyle={dica}
                  formatter={(valor, nome) => [
                    `${formatarNumero(Number(valor))} kg`,
                    rotuloResiduo[nome as keyof typeof rotuloResiduo] ?? nome,
                  ]}
                />
                <Legend
                  formatter={nome =>
                    rotuloResiduo[nome as keyof typeof rotuloResiduo] ?? nome
                  }
                  wrapperStyle={{ fontSize: 11 }}
                />
                {TIPOS_RESIDUO.map(tipo => (
                  <Bar
                    key={tipo}
                    dataKey={tipo}
                    stackId="kg"
                    fill={corDoTipo(tipo, cores)}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="mt-4 rounded-2xl bg-[#f8fbf9] p-4 text-sm text-muted-foreground">
            Os gráficos aparecem depois do primeiro descarte aprovado.
          </p>
        )}
      </article>
      <article className={cartao}>
        <p className="text-base font-semibold tracking-[-0.025em]">Que tipos</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Divisão do peso aprovado por tipo.
        </p>
        {porTipo.length ? (
          <div className="mt-2 h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={porTipo}
                  dataKey="kg"
                  nameKey="nome"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                >
                  {porTipo.map(item => (
                    <Cell
                      key={item.nome}
                      fill={item.cor}
                      aria-label={`${item.nome}: ${formatarNumero(item.kg)} kg`}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={dica}
                  formatter={(valor, nome) => [
                    `${formatarNumero(Number(valor))} kg`,
                    nome,
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            Sem descartes aprovados ainda.
          </p>
        )}
        <ul className="mt-2 grid gap-1.5 text-sm">
          {data.porTipo.map(item => (
            <li
              key={item.wasteType}
              className="flex items-center justify-between gap-2"
            >
              <span className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: corDoTipo(item.wasteType, cores) }}
                />
                {rotuloResiduo[item.wasteType]}
              </span>
              <span className="text-muted-foreground">
                {formatarNumero(item.kilograms)} kg ·{" "}
                {plural(item.descartes, "descarte", "descartes")} ·{" "}
                {plural(item.pontos, "pt", "pts")}
              </span>
            </li>
          ))}
        </ul>
      </article>
    </section>
  );
  const dias = (
    <article className={cartao}>
      <p className="flex items-center gap-2 text-base font-semibold tracking-[-0.025em]">
        <CalendarClock className="h-4 w-4 text-[#0f7350]" />
        Dias em que mais descarta
      </p>
      <div className="mt-4 h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data.porDiaSemana}
            margin={{ top: 4, right: 4, left: -28, bottom: 0 }}
          >
            <XAxis
              dataKey="dia"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "#6b7e74" }}
            />
            <YAxis
              allowDecimals={false}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "#6b7e74" }}
            />
            <Tooltip
              contentStyle={dica}
              formatter={valor => [valor, "Descartes"]}
            />
            <Bar dataKey="descartes" fill="#0f7350" radius={[6, 6, 2, 2]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-3 flex items-start gap-2 rounded-xl bg-[#f1f8f4] p-3 text-xs leading-5 text-[#0a5a3c]">
        <Leaf className="mt-0.5 h-4 w-4 shrink-0" />
        {data.equivalencias.co2EvitadoKg > 0
          ? `Seus recicláveis evitaram cerca de ${formatarNumero(data.equivalencias.co2EvitadoKg)} kg de CO2.`
          : "Recicláveis aprovados viram estimativa de CO2 evitado."}
        {data.primeiroDescarte
          ? ` Primeiro descarte: ${formatarDataHora(data.primeiroDescarte)}.`
          : ""}
      </p>
    </article>
  );
  const ultimos = (
    <article className={cartao}>
      <div className="flex items-center justify-between">
        <p className="text-base font-semibold tracking-[-0.025em]">
          Últimos descartes
        </p>
        <Link
          href="/descartes"
          className="text-sm font-semibold text-[#0f7350] hover:underline"
        >
          Ver todos
        </Link>
      </div>
      {data.recentes.length ? (
        <ul className="mt-3 divide-y divide-[#edf2ef]">
          {(compacto ? data.recentes.slice(0, 5) : data.recentes).map(item => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
            >
              <Link
                href={`/descartes?id=${item.id}`}
                className="flex items-center gap-2 font-medium hover:underline"
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: corDoTipo(item.wasteType, cores) }}
                />
                {rotuloResiduo[item.wasteType]} ·{" "}
                {item.pesoKg === null
                  ? "—"
                  : `${formatarNumero(item.pesoKg)} kg`}
              </Link>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                {formatarDataHora(item.data)}
                <Badge className={estiloSituacao[item.situacao]}>
                  {rotuloSituacao[item.situacao]}
                </Badge>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          Nenhum descarte ainda.
        </p>
      )}
    </article>
  );

  return (
    <div className="grid gap-5">
      <section
        aria-label="Resumo pessoal"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {indicadores.map(item => {
          const Icone = item.icone;
          return (
            <article
              key={item.rotulo}
              className="rounded-[22px] border border-[#dce8e0] bg-white p-5"
            >
              <div className="flex items-start justify-between">
                <p className="text-sm font-medium text-muted-foreground">
                  {item.rotulo}
                </p>
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#e5f6ec] text-[#0a7048]">
                  <Icone className="h-[18px] w-[18px]" />
                </span>
              </div>
              <p className="mt-5 text-[30px] font-bold tracking-[-0.05em]">
                {item.valor}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {item.ajuda}
              </p>
            </article>
          );
        })}
      </section>

      {compacto ? (
        <>
          {ultimos}
          <details className={`${cartao} group`}>
            <summary className="cursor-pointer list-none text-base font-semibold tracking-[-0.025em] text-[#0f7350]">
              Ver gráficos do seu histórico
              <span className="ml-2 text-xs font-normal text-muted-foreground group-open:hidden">
                (quanto, quando, que tipos e dias da semana)
              </span>
            </summary>
            <div className="mt-5 grid gap-5">
              {graficos}
              {dias}
            </div>
          </details>
        </>
      ) : (
        <>
          {graficos}
          <section className="grid gap-5 xl:grid-cols-[1fr_1.4fr]">
            {dias}
            {ultimos}
          </section>
        </>
      )}
      <GestaoMorador gestao={data.gestao} moradorId={residentId} />
    </div>
  );
}

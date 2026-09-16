import PageIntro from "@/components/PageIntro";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Medal, Percent, Trophy } from "lucide-react";
import { FormEvent, useState } from "react";
import { toast } from "sonner";

const periodos = [
  { value: "mensal" as const, label: "Mensal" },
  { value: "semestral" as const, label: "Semestral" },
  { value: "anual" as const, label: "Anual" },
];

const medalha = ["#c99a2e", "#9aa4ad", "#a5672f"];

export default function Podio() {
  const [periodo, setPeriodo] = useState<"mensal" | "semestral" | "anual">("mensal");
  const utils = trpc.useUtils();
  const profile = trpc.perfil.meuPerfil.useQuery();
  const { data, isLoading } = trpc.podio.ranking.useQuery({ periodo });
  const isAdmin = profile.data?.role === "administrador";
  const [descontos, setDescontos] = useState({ mensal: "", semestral: "", anual: "" });
  const configurar = trpc.podio.configurarDescontos.useMutation({
    onSuccess: () => { utils.podio.ranking.invalidate(); toast.success("Percentuais de desconto atualizados."); },
    onError: (issue) => toast.error(issue.message),
  });

  function submitDescontos(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    configurar.mutate({
      mensal: descontos.mensal === "" ? undefined : Number(descontos.mensal),
      semestral: descontos.semestral === "" ? undefined : Number(descontos.semestral),
      anual: descontos.anual === "" ? undefined : Number(descontos.anual),
    });
  }

  const top3 = data?.ranking.slice(0, 3) ?? [];
  const demais = data?.ranking.slice(3) ?? [];

  return (
    <div>
      <PageIntro
        eyebrow="Reconhecimento"
        title="Pódio de reciclagem"
        description="Os três moradores que mais reciclaram no período são destacados aqui. O desconto na taxa condominial é sugerido pelo sistema, mas a aplicação é sempre manual, feita pelo síndico."
        action={<div className="flex gap-2 rounded-xl border border-[#dce8e0] bg-white p-1">{periodos.map((item) => (
          <Button key={item.value} size="sm" variant="ghost" onClick={() => setPeriodo(item.value)} className={`h-8 rounded-lg px-3 text-xs font-semibold ${periodo === item.value ? "bg-[#0f7350] text-white hover:bg-[#0a6243] hover:text-white" : "text-muted-foreground"}`}>{item.label}</Button>
        ))}</div>}
      />

      <section className="rounded-[24px] border border-[#dce8e0] bg-white p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.35)] sm:p-6">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#fff3df] text-[#af7726]"><Trophy className="h-5 w-5" /></span>
          <div>
            <p className="font-semibold">Top 3 do período {periodos.find((item) => item.value === periodo)?.label.toLowerCase()}</p>
            <p className="text-sm text-muted-foreground">Pontuação acumulada por coletas recicláveis concluídas neste período.</p>
          </div>
        </div>

        {isLoading ? (
          <p className="mt-6 text-sm text-muted-foreground">Calculando ranking do período...</p>
        ) : top3.length === 0 ? (
          <p className="mt-6 text-sm leading-6 text-muted-foreground">Ainda não há coletas concluídas suficientes neste período para formar o pódio.</p>
        ) : (
          <>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {top3.map((linha, indice) => (
                <article key={linha.moradorId} className="rounded-2xl border border-[#e0ebe4] bg-[#fbfdfc] p-4 text-center">
                  <span className="mx-auto grid h-11 w-11 place-items-center rounded-full text-white" style={{ backgroundColor: medalha[indice] }}>
                    <Medal className="h-5 w-5" />
                  </span>
                  <p className="mt-3 text-xs font-bold uppercase tracking-[.08em] text-muted-foreground">{indice + 1}º lugar</p>
                  <p className="mt-1 text-sm font-semibold">{linha.nome}</p>
                  <p className="text-xs text-muted-foreground">Bloco {linha.bloco} · {linha.apartamento}</p>
                  <p className="mt-3 text-lg font-bold text-[#0f7350]">{linha.pontos} pts</p>
                  <p className="text-xs text-muted-foreground">{linha.pesoKg} kg reciclados</p>
                </article>
              ))}
            </div>

            <div className="mt-5 flex items-start gap-3 rounded-2xl border border-[#cfe1d7] bg-[#f7fbf8] p-4">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#e8f4ed] text-[#0f7350]"><Percent className="h-4 w-4" /></span>
              <div>
                <p className="text-sm font-semibold">Desconto sugerido: {data?.descontoSugeridoPercentual != null ? `${data.descontoSugeridoPercentual}%` : "não configurado"}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">O sistema apenas exibe o ranking e o percentual sugerido para os três primeiros colocados. A concessão do desconto na taxa condominial é sempre manual, feita pelo síndico junto à administração do condomínio.</p>
              </div>
            </div>

            {demais.length > 0 && (
              <ol className="mt-5 divide-y divide-[#edf2ef]">
                {demais.map((linha) => (
                  <li key={linha.moradorId} className="flex items-center justify-between py-3">
                    <span className="flex items-center gap-3">
                      <b className="grid h-8 w-8 place-items-center rounded-xl bg-[#f0f5f2] text-xs text-muted-foreground">{linha.position}</b>
                      <span><span className="block text-sm font-semibold">{linha.nome}</span><span className="text-xs text-muted-foreground">Bloco {linha.bloco} · {linha.apartamento}</span></span>
                    </span>
                    <span className="text-sm font-bold text-[#0f7350]">{linha.pontos} pts</span>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </section>

      {isAdmin && (
        <section className="mt-5 rounded-[24px] border border-[#dce8e0] bg-white p-5 shadow-[0_16px_34px_-28px_rgba(4,66,42,.35)] sm:p-6">
          <p className="font-semibold">Percentual de desconto sugerido por período</p>
          <p className="mt-1 text-sm text-muted-foreground">Defina quanto o sistema deve sugerir de desconto para os três primeiros colocados de cada período. Isto não aplica o desconto automaticamente — apenas orienta a decisão do síndico.</p>
          <form onSubmit={submitDescontos} className="mt-4 grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1.5 text-xs font-semibold">Mensal (%)<Input type="number" min="0" max="100" step="0.5" placeholder={data?.periodo === "mensal" ? String(data?.descontoSugeridoPercentual ?? "") : ""} value={descontos.mensal} onChange={(event) => setDescontos({ ...descontos, mensal: event.target.value })} className="h-10 rounded-xl bg-white" /></label>
            <label className="grid gap-1.5 text-xs font-semibold">Semestral (%)<Input type="number" min="0" max="100" step="0.5" placeholder={data?.periodo === "semestral" ? String(data?.descontoSugeridoPercentual ?? "") : ""} value={descontos.semestral} onChange={(event) => setDescontos({ ...descontos, semestral: event.target.value })} className="h-10 rounded-xl bg-white" /></label>
            <label className="grid gap-1.5 text-xs font-semibold">Anual (%)<Input type="number" min="0" max="100" step="0.5" placeholder={data?.periodo === "anual" ? String(data?.descontoSugeridoPercentual ?? "") : ""} value={descontos.anual} onChange={(event) => setDescontos({ ...descontos, anual: event.target.value })} className="h-10 rounded-xl bg-white" /></label>
            <div className="sm:col-span-3"><Button disabled={configurar.isPending} className="h-10 rounded-xl bg-[#0f7350] text-white hover:bg-[#0a6243]">Salvar percentuais sugeridos</Button></div>
          </form>
          {data?.ranking.some((linha) => linha.elegivelDesconto) && (
            <p className="mt-4 text-xs text-muted-foreground"><Badge className="mr-2 border-0 bg-[#edf7f1] text-[#0a7048] hover:bg-[#edf7f1]">Lembrete</Badge>Aplique o desconto manualmente na cobrança dos três primeiros colocados, conforme a política do condomínio.</p>
          )}
        </section>
      )}
    </div>
  );
}

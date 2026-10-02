import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { rotuloConclusaoOcorrencia } from "@shared/rotulos";
import { FormEvent, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";

type Conclusao = keyof typeof rotuloConclusaoOcorrencia;

/**
 * Tratamento de uma ocorrência pela administração: encaminhar o descarte denunciado (nova avaliação ou auditoria) e concluir
 * (procedente, improcedente ou denúncia falsa), com medidas para o morador envolvido ou para quem denunciou.
 */
export default function TratarOcorrencia({
  ocorrencia,
  onAlterado,
}: {
  ocorrencia: {
    id: number;
    status: string;
    coletaId: number | null;
    moradorEnvolvidoId: number | null;
    envolvido: { nome: string; bloco: string; apartamento: string } | null;
    relator: string | null;
    denunciasFalsasRelator: number;
  };
  onAlterado: () => void;
}) {
  const [conclusao, setConclusao] = useState<Conclusao>("procedente");
  const [nota, setNota] = useState("");
  const [medidas, setMedidas] = useState<number[]>([]);
  const [motivo, setMotivo] = useState("");
  const modelos = trpc.penalidades.modelos.useQuery({ somenteAtivos: true });
  const opcoes = {
    onError: (erro: { message: string }) => toast.error(erro.message),
  };
  const encaminhar = trpc.ocorrencias.encaminharDescarte.useMutation({
    ...opcoes,
    onSuccess: resultado => {
      toast.success(
        resultado.status === "em_auditoria"
          ? "Descarte enviado para auditoria."
          : "Descarte voltou para nova avaliação."
      );
      setMotivo("");
      onAlterado();
    },
  });
  const emAnalise = trpc.ocorrencias.atualizarStatus.useMutation({
    ...opcoes,
    onSuccess: () => {
      toast.success("Ocorrência marcada como em análise.");
      onAlterado();
    },
  });
  const concluir = trpc.ocorrencias.concluir.useMutation({
    ...opcoes,
    onSuccess: resultado => {
      toast.success(
        `Ocorrência concluída${resultado.medidasAplicadas.length ? `; medidas: ${resultado.medidasAplicadas.join(", ")}` : ""}.`
      );
      if (resultado.denunciasFalsasDoAutor >= 2)
        toast.warning(
          `Quem denunciou já tem ${resultado.denunciasFalsasDoAutor} denúncias falsas.`
        );
      setNota("");
      setMedidas([]);
      onAlterado();
    },
  });
  const paraEnvolvido = conclusao === "procedente" && Boolean(ocorrencia.moradorEnvolvidoId);
  const paraRelator = conclusao === "denuncia_falsa";
  function enviar(event: FormEvent) {
    event.preventDefault();
    concluir.mutate({
      id: ocorrencia.id,
      conclusao,
      nota,
      medidasEnvolvido: paraEnvolvido ? medidas : [],
      medidasRelator: paraRelator ? medidas : [],
    });
  }
  return (
    <div className="mt-3 grid gap-3 rounded-xl bg-[#f6faf7] p-3 text-sm">
      <p className="text-xs text-muted-foreground">
        Registrada por {ocorrencia.relator ?? "—"}
        {ocorrencia.denunciasFalsasRelator > 0
          ? ` · ${ocorrencia.denunciasFalsasRelator} denúncia(s) falsa(s) antes`
          : ""}
        {ocorrencia.envolvido
          ? ` · morador do descarte: ${ocorrencia.envolvido.nome} (bloco ${ocorrencia.envolvido.bloco}, apto ${ocorrencia.envolvido.apartamento}); não é mostrado a quem denunciou`
          : ""}
      </p>
      {ocorrencia.coletaId && (
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <Input
            value={motivo}
            onChange={event => setMotivo(event.target.value)}
            placeholder="Motivo para reavaliar o descarte (vai para o morador)"
            className="h-9 rounded-lg bg-white"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={motivo.trim().length < 10 || encaminhar.isPending}
            onClick={() =>
              encaminhar.mutate({ id: ocorrencia.id, destino: "nova_avaliacao", motivo })
            }
          >
            Nova avaliação
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={motivo.trim().length < 10 || encaminhar.isPending}
            onClick={() =>
              encaminhar.mutate({ id: ocorrencia.id, destino: "auditoria", motivo })
            }
            className="border-[#d8cdf1] text-[#5b3aa6]"
          >
            Auditoria
          </Button>
          <Link
            href={`/descartes?id=${ocorrencia.coletaId}`}
            className="text-xs font-semibold text-[#0f7350] underline sm:col-span-3"
          >
            Abrir o descarte nº {ocorrencia.coletaId}
          </Link>
        </div>
      )}
      <form onSubmit={enviar} className="grid gap-2">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(rotuloConclusaoOcorrencia) as Conclusao[]).map(opcao => (
            <button
              key={opcao}
              type="button"
              onClick={() => {
                setConclusao(opcao);
                setMedidas([]);
              }}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${conclusao === opcao ? "border-[#0f7350] bg-white text-[#0f7350]" : "border-[#dce8e0] text-muted-foreground"}`}
            >
              {rotuloConclusaoOcorrencia[opcao]}
            </button>
          ))}
          {ocorrencia.status === "aberta" && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={emAnalise.isPending}
              onClick={() => emAnalise.mutate({ id: ocorrencia.id, status: "em_analise" })}
            >
              Marcar em análise
            </Button>
          )}
        </div>
        {(paraEnvolvido || paraRelator) && (
          <fieldset className="grid gap-1 text-xs">
            <legend className="mb-1 font-semibold">
              Medidas para{" "}
              {paraRelator ? "quem fez a denúncia falsa" : "o morador do descarte"} (opcional)
            </legend>
            {modelos.data?.map(modelo => (
              <label key={modelo.id} className="flex items-center gap-2">
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
                {modelo.nome}
              </label>
            ))}
          </fieldset>
        )}
        <div className="flex gap-2">
          <Input
            required
            minLength={10}
            value={nota}
            onChange={event => setNota(event.target.value)}
            placeholder="Conclusão (vai para quem registrou)"
            className="h-9 rounded-lg bg-white"
          />
          <Button
            size="sm"
            disabled={concluir.isPending || nota.trim().length < 10}
            className="h-9 rounded-lg bg-[#0f7350] text-white"
          >
            Concluir
          </Button>
        </div>
      </form>
    </div>
  );
}

import { trpc } from "@/lib/trpc";
import { destinoDaNotificacao } from "@shared/notificacoes";
import type { EcoRole } from "@shared/permissions";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

/** De quanto em quanto tempo o sistema procura notificações novas para mostrar o aviso na tela. */
const INTERVALO_MS = 15_000;

/**
 * Pop-up de cada notificação nova (item 1 do PDF): aparece no canto da tela, com o botão que leva direto ao lugar certo
 * (o descarte, o extrato, o resgate), respeitando o que o perfil pode abrir.
 */
export default function AvisosNovos({ papel }: { papel: EcoRole }) {
  const utils = trpc.useUtils();
  const [, navegar] = useLocation();
  const [depoisDe, setDepoisDe] = useState<number | null>(null);
  const primeira = useRef(true);
  const novas = trpc.notificacoes.novas.useQuery({ afterId: depoisDe ?? 0 }, { refetchInterval: INTERVALO_MS, refetchIntervalInBackground: false });
  const abrir = trpc.notificacoes.abrir.useMutation({ onSuccess: () => { utils.notificacoes.contagemNaoLidas.invalidate(); utils.notificacoes.listar.invalidate(); } });

  useEffect(() => {
    const dados = novas.data;
    if (!dados) return;
    if (primeira.current) {
      // Ao entrar, um aviso só com o total de não lidas (não um pop-up para cada notificação antiga).
      primeira.current = false;
      const total = dados.itens.length;
      if (total) toast(total === 1 ? "Você tem 1 notificação não lida." : `Você tem ${total >= 5 ? "5 ou mais" : total} notificações não lidas.`, { action: { label: "Ver", onClick: () => navegar("/notificacoes") } });
    } else {
      for (const item of [...dados.itens].reverse()) {
        const destino = destinoDaNotificacao(item, papel);
        toast(item.titulo, {
          id: `notificacao-${item.id}`,
          description: item.mensagem.length > 160 ? `${item.mensagem.slice(0, 157)}...` : item.mensagem,
          duration: 10_000,
          action: { label: destino ? "Abrir" : "Ver", onClick: () => { abrir.mutate({ id: item.id }); navegar(destino?.href ?? "/notificacoes"); } },
        });
      }
      if (dados.itens.length) utils.notificacoes.contagemNaoLidas.invalidate();
    }
    if (dados.ultimaId !== depoisDe) setDepoisDe(dados.ultimaId);
  }, [novas.data]);

  return null;
}

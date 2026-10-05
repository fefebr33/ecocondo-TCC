import {
  CORES_PADRAO,
  rotuloResiduo,
  TIPOS_RESIDUO,
  type TipoResiduo,
} from "@/lib/descarte";
import type { ReactNode } from "react";

export type Secao = {
  titulo: string;
  /** Uma frase dizendo para que serve a parte do sistema. */
  resumo?: ReactNode;
  passos: ReactNode[];
  /** Exemplo concreto, com números, para a pessoa ver como fica na prática. */
  exemplo?: ReactNode;
  /** Dica ou cuidado importante. */
  dica?: ReactNode;
};

/** Passo a passo da estação de pesagem (aparece no tablet em "Como usar" e no manual do sistema). */
export function manualEstacao(
  cores?: Partial<Record<TipoResiduo, string>>
): Secao[] {
  const nomeCor = (tipo: TipoResiduo) =>
    (cores?.[tipo] ?? CORES_PADRAO[tipo].nome).toLowerCase();
  return [
    {
      titulo: "Antes de ir até as lixeiras",
      resumo: "Separe o lixo e gere o código no celular.",
      passos: [
        <>
          Separe o lixo em sacos pela cor:{" "}
          {TIPOS_RESIDUO.map((tipo, indice) => (
            <span key={tipo}>
              {indice ? ", " : ""}
              <b>{nomeCor(tipo)}</b> para {rotuloResiduo[tipo].toLowerCase()}
            </span>
          ))}
          . Os sacos coloridos ficam na portaria.
        </>,
        <>
          Cole um <b>adesivo QR</b> em cada saco (os adesivos ficam em{" "}
          <b>Adesivos QR</b>; cada um vale para um saco só). Quando estiverem
          acabando, peça mais pelo próprio sistema.
        </>,
        <>
          No aplicativo, abra <b>Descartes</b> e toque em{" "}
          <b>Gerar código para a estação</b>. O código tem 6 números, vale por 5
          minutos e serve uma vez só.
        </>,
      ],
      dica: (
        <>
          Gere o código só quando já estiver perto do tablet: se ele vencer, é
          só gerar outro.
        </>
      ),
    },
    {
      titulo: "No tablet",
      resumo: "Identifique-se, pese cada saco e fotografe o visor.",
      passos: [
        <>
          Digite o código (ou mostre o QR) e confira se o nome que aparece é o
          seu. Se não for, toque em <b>Não sou eu</b>.
        </>,
        <>
          Toque em todos os tipos que você trouxe. Dá para registrar vários
          tipos no mesmo descarte (até 5).
        </>,
        <>
          Para cada tipo, o tablet pede: coloque <b>só aquele saco</b> na
          balança, espere o número parar, informe o peso e leia o adesivo QR do
          saco.
        </>,
        <>
          Tire a foto do <b>visor da balança com o saco em cima</b>: números
          inteiros na foto, sem reflexo, sem dedo na frente. Se a foto sair
          escura ou tremida, o tablet avisa para tirar de novo.
        </>,
        <>
          Na tela de conferência, veja o peso e os pontos previstos de cada tipo
          e toque em <b>Confirmar</b>. Depois coloque cada saco na lixeira da
          mesma cor.
        </>,
      ],
      exemplo: (
        <>
          Você trouxe 2,40 kg de recicláveis (saco {nomeCor("reciclavel")}) e
          1,10 kg de orgânico. Escolha os dois tipos, pese um de cada vez e
          fotografe o visor com 2,40 e depois com 1,10. A conferência mostra os
          dois sacos, o total de 3,50 kg e os pontos previstos de cada um.
        </>
      ),
    },
    {
      titulo: "Depois do descarte",
      resumo: "A análise automática confere as fotos; o que tiver dúvida vai para a administração.",
      passos: [
        <>
          A <b>análise automática</b> confere cada foto (tipo, peso no visor e
          cor do saco). O que estiver certo é <b>aprovado na hora</b> e os
          pontos entram no saldo; o que tiver dúvida fica{" "}
          <b>pendente</b> para a administração conferir.
        </>,
        <>
          Se algo estiver errado, o descarte é <b>reprovado</b> e você recebe o
          motivo. Em caso grave (suspeita de fraude), ele vai para{" "}
          <b>auditoria</b>: você é avisado e pode explicar; se a irregularidade
          se confirmar, pode haver perda de pontos ou suspensão.
        </>,
        <>
          Cada tipo tem peso mínimo e máximo por descarte e uma regra de pontos.
          Rejeito não dá pontos, mas conta nos indicadores do condomínio.
        </>,
        <>
          Nenhum saco vale zero por ser leve: o descarte vale a fração exata
          (ex.: 0,95 ponto) e as frações se somam até virar ponto inteiro no seu
          saldo.
        </>,
        <>
          Com a <b>participação suspensa</b>, você pode descartar normalmente,
          mas os descartes desse período não valem pontos.
        </>,
      ],
      exemplo: (
        <>
          Um saco de 0,95 kg de recicláveis vale 0,95 ponto: o saldo não muda
          ainda, mas a fração fica guardada. No próximo descarte de 0,30 ponto,
          a soma passa de 1 e entra 1 ponto inteiro (sobram 0,25 guardados).
        </>
      ),
      dica: (
        <>
          Fora do modo demonstração, a estação pede 10 minutos entre um
          descarte e outro do mesmo morador e aceita até 4 por dia (40 kg no
          total). Isso evita pesar o mesmo saco várias vezes.
        </>
      ),
    },
  ];
}

export const manualMorador: Secao[] = [
  {
    titulo: "Visão geral (meu painel)",
    resumo: "O resumo de tudo o que você fez no programa.",
    passos: [
      <>
        Seu <b>painel pessoal</b> mostra quanto você descartou, de que tipos,
        em que dias, seus pontos, sua posição no pódio do mês e a situação de
        cada descarte (pendente, aprovado, reprovado ou em auditoria).
      </>,
      <>
        Em <b>Histórico de medidas</b> aparecem advertências, retiradas de pontos e
        suspensões que a administração aplicou, com o motivo e o período.
      </>,
    ],
  },
  {
    titulo: "Descartes e adesivos",
    resumo: "Onde gerar o código da estação e acompanhar cada saco.",
    passos: [
      <>
        Em <b>Descartes</b> você gera o código da estação e vê a lista de
        descartes. Toque em um para ver a foto, o peso, a decisão e o motivo.
      </>,
      <>
        Em <b>Adesivos QR</b> você vê quantos adesivos tem, pede mais
        (informando a quantidade) e acompanha a entrega. Se a administração
        cancelar um adesivo (perdido ou danificado), você recebe uma
        notificação.
      </>,
    ],
    dica: (
      <>
        Não use o mesmo adesivo em dois sacos: depois de usado, ele não vale
        mais na estação.
      </>
    ),
  },
  {
    titulo: "Pontos, extrato e prêmios",
    resumo: "Como os pontos entram, saem e viram recompensas.",
    passos: [
      <>
        Em <b>Engajamento</b> fica o <b>extrato</b>: cada entrada (descarte
        aprovado, devolução) e cada saída (estorno, resgate, medida) com data e
        motivo.
      </>,
      <>
        Troque pontos por recompensas do catálogo. O pedido passa por
        aprovação e entrega; se for cancelado, os pontos voltam.
      </>,
      <>
        A administração pode zerar os pontos de todos para começar um novo
        ciclo; isso aparece no seu extrato.
      </>,
    ],
    exemplo: (
      <>
        Saldo de 40 pontos e um vale-café de 25 pontos: depois do pedido o
        extrato mostra "Resgate de recompensa: -25" e o saldo fica em 15.
      </>
    ),
  },
  {
    titulo: "Pódio",
    resumo: "Os três primeiros do mês, do semestre e do ano ganham prêmios.",
    passos: [
      <>
        O pódio mostra só os <b>3 primeiros</b>; cada um vê apenas a própria
        posição. Os prêmios são cestas e brindes de datas comemorativas.
      </>,
      <>
        Marque <b>Não mostrar meu nome no pódio</b> para aparecer só como
        "Morador(a) do bloco X". Você continua concorrendo.
      </>,
      <>
        Retiradas de pontos por medida administrativa também descontam da sua
        pontuação do pódio.
      </>,
    ],
  },
  {
    titulo: "Suspensão da participação",
    resumo: "O que muda enquanto uma suspensão está valendo.",
    passos: [
      <>
        Você pode continuar levando o lixo à estação, mas os descartes{" "}
        <b>não valem pontos</b>.
      </>,
      <>
        Não dá para entrar em campanhas nem resgatar prêmios, e no pódio o seu
        nome fica cinza e oculto para os vizinhos (só você e a administração
        veem).
      </>,
      <>
        Quando o prazo termina ou a administração revoga, tudo volta ao normal
        e você recebe uma notificação.
      </>,
    ],
  },
  {
    titulo: "Campanhas, ocorrências e feedback",
    resumo: "Participe das campanhas e fale com a administração.",
    passos: [
      <>
        Em <b>Campanhas e feedback</b>, entre nas campanhas ativas (ex.: "Mês do
        eletrônico") e acompanhe o andamento e os resultados.
      </>,
      <>
        Em <b>Gestão ambiental</b>, registre ocorrências (lixo fora do lugar,
        lixeira quebrada) ou denúncias. Quem denunciou nunca é revelado.
      </>,
      <>Em <b>Campanhas e feedback</b>, envie também sua opinião com nota de 1 a 5; a resposta chega como notificação.</>,
    ],
    dica: (
      <>
        Denúncias falsas feitas de má-fé podem gerar medidas para quem
        denunciou.
      </>
    ),
  },
  {
    titulo: "Notificações",
    resumo: "Avisos do que aconteceu com os seus descartes, pontos e pedidos.",
    passos: [
      <>
        Toda notificação nova aparece na tela. Tocar nela leva direto ao
        descarte, ao extrato de pontos ou ao resgate de que ela fala.
      </>,
      <>
        Use a <b>lixeira</b> para excluir uma notificação, <b>Selecionar</b>{" "}
        para excluir várias ou <b>Excluir lidas</b> para limpar a lista. Elas
        somem só para você.
      </>,
    ],
  },
  {
    titulo: "Guia de descarte",
    passos: [
      <>
        O guia mostra o que vai em cada tipo, o que não vai e a cor do saco. Na
        dúvida, consulte antes de ir à estação.
      </>,
    ],
  },
];

export const manualAdministrador: Secao[] = [
  {
    titulo: "Painel e notificações",
    resumo: "O que precisa da sua atenção agora.",
    passos: [
      <>
        A <b>Visão geral</b> mostra os alertas (descartes pendentes, auditorias,
        resgates, estoque, pedidos de adesivos, estação bloqueada) com um botão
        que leva direto a cada um.
      </>,
      <>
        Você recebe notificações de descartes para avaliar, auditorias abertas,
        concluídas e paradas há mais de um dia, medidas aplicadas e encerradas,
        ajustes de pontos, participações em campanhas, novos pedidos e
        ocorrências.
      </>,
      <>
        Em <b>Notificações</b>, exclua as que já resolveu (uma, várias ou
        todas as lidas) e envie <b>avisos gerais</b> para todos, só moradores
        ou só administradores, vendo quem já visualizou.
      </>,
    ],
  },
  {
    titulo: "Aprovar descartes",
    resumo: "O que a análise automática não aprovou fica com você.",
    passos: [
      <>
        Em <b>Descartes</b>, confira a foto, o peso, o adesivo e o parecer da
        IA de cada saco. <b>Aprovar</b> libera os pontos pela regra do tipo;{" "}
        <b>Reprovar</b> pede um motivo, que vai para o morador.
      </>,
      <>
        Um descarte já aprovado (inclusive pela IA) pode ser{" "}
        <b>revertido</b>: volta para nova avaliação (os pontos saem) ou vai
        para auditoria.
      </>,
    ],
    exemplo: (
      <>
        A IA leu 1,20 kg no visor, mas o morador digitou 4,20 kg: o descarte
        fica pendente com o motivo "peso no visor diferente do informado".
        Reprove com o motivo "peso digitado não confere com o visor".
      </>
    ),
  },
  {
    titulo: "Auditoria",
    resumo: "Para casos graves: suspeita de furto, peso forjado ou tentativa de burlar a estação.",
    passos: [
      <>
        Abra a auditoria no descarte com o motivo (o morador é avisado e os
        pontos ficam parados). Todos os administradores recebem a tarefa.
      </>,
      <>
        Ao concluir, escolha <b>Regular</b> (aprova) ou <b>Irregular</b>{" "}
        (reprova), escreva o parecer e, se quiser, marque medidas e uma
        retirada avulsa de pontos. A janela mostra "O que vai acontecer" antes
        de confirmar.
      </>,
      <>
        Pontos retirados saem do <b>saldo</b> e também da{" "}
        <b>pontuação do pódio e do ranking</b>. Se a medida for revogada, os
        pontos voltam nos dois.
      </>,
      <>
        Auditoria parada há mais de um dia gera um lembrete diário até alguém
        dar o parecer.
      </>,
    ],
    exemplo: (
      <>
        O mesmo saco aparece em duas pesagens seguidas. Conclusão: Irregular,
        parecer "mesmo saco pesado duas vezes", medidas "Retirada de 30
        pontos" e "Suspensão da participação por 15 dias". O descarte é
        reprovado, saem 30 pontos do saldo e do pódio e a suspensão começa na
        hora.
      </>
    ),
  },
  {
    titulo: "Medidas administrativas e suspensão",
    resumo: "Advertência, retirada de pontos e suspensões configuráveis.",
    passos: [
      <>
        As medidas pré-definidas ficam em <b>Configurações &gt; Medidas
        administrativas</b> (nome, tipo, pontos e duração). Também dá para
        aplicar uma medida pelo painel do morador (Moradores) ou por uma ocorrência.
      </>,
      <>
        Com a <b>participação suspensa</b>, o morador continua descartando,
        mas sem pontos; não entra em campanhas, não resgata prêmios, não
        recebe prêmio do pódio e aparece em cinza no pódio, com o nome oculto
        para os vizinhos.
      </>,
      <>
        <b>Revogar</b> encerra a medida na hora e devolve os pontos retirados;
        o morador e os outros administradores são avisados.
      </>,
    ],
  },
  {
    titulo: "Histórico de auditoria",
    resumo: "Quem fez o quê, quando e por quê.",
    passos: [
      <>
        Cada operação importante fica registrada com o autor, a data, o
        motivo e o que mudou, escrito em palavras (ex.: "Situação: pendente →
        aprovado").
      </>,
      <>
        Filtre por assunto (descartes, medidas, adesivos, campanhas...) e por
        período, e exporte em CSV.
      </>,
    ],
  },
  {
    titulo: "Moradores, pessoas e adesivos",
    passos: [
      <>
        Em <b>Moradores</b>, filtre por bloco, nome ou apartamento e abra o{" "}
        <b>painel</b> de cada morador (descartes, pontos, histórico de
        medidas, campanhas, ocorrências). Ali também dá para aplicar ou
        revogar uma medida.
      </>,
      <>
        Em <b>Pessoas e acessos</b>, cadastre pessoas, defina o perfil
        (morador ou administrador), desative acessos e gere o link de primeiro
        acesso ou de nova senha.
      </>,
      <>
        Em <b>Adesivos QR</b>, entregue os kits pedidos, imprima a folha e
        cancele adesivos perdidos (o morador é avisado). Em <b>Ler QR de um saco</b>{" "}
        você vê de quem é um saco e fica registrada na auditoria.
      </>,
    ],
  },
  {
    titulo: "Configurações",
    passos: [
      <>
        Regras de cada tipo (peso mínimo, máximo e pontos por kg), cores dos
        sacos, análise automática (liga/desliga, confiança mínima, adesivo
        obrigatório) e medidas administrativas.
      </>,
      <>
        Em <b>Quem recebe cada aviso</b>, escolha o perfil e ligue ou desligue
        os avisos por assunto. Os obrigatórios sempre chegam.
      </>,
      <>
        Estações de pesagem: cadastre o tablet, gere o código de pareamento e
        ligue o <b>modo demonstração</b> para apresentações (sem balança, sem
        espera de 10 minutos e sem limite diário).
      </>,
      <>
        Para começar um novo ciclo, use <b>Zerar pontos de todos</b> (pede
        confirmação e motivo e fica no extrato e na auditoria).
      </>,
    ],
  },
  {
    titulo: "Relatórios",
    resumo: "Números para a gestão e a prestação de contas.",
    passos: [
      <>
        Escolha o período e o bloco: gráficos por bloco, por mês e por tipo,
        pontos, resgates, IA, auditoria, medidas, campanhas e adesivos.
      </>,
      <>
        <b>Exportar PDF</b> gera o relatório com cartões, gráficos e tabelas
        (o top 3 respeita a privacidade do pódio). <b>Baixar planilha
        (Excel)</b> traz uma aba por assunto: resumo, tipos, meses, blocos,
        ranking, descartes, extrato de pontos, resgates, medidas e gestão.
      </>,
      <>
        As planilhas CSV avulsas continuam disponíveis para quem prefere.
      </>,
    ],
    exemplo: (
      <>
        Prestação de contas do semestre: escolha 01/01 a 30/06, todos os
        blocos, e baixe o PDF para a assembleia e a planilha para a
        administradora.
      </>
    ),
  },
];

/** Perguntas frequentes de cada perfil (aparecem no fim do manual). */
export const perguntasMorador: Array<{ pergunta: string; resposta: ReactNode }> = [
  { pergunta: "Meu descarte ficou pendente. Fiz algo errado?", resposta: <>Não necessariamente: a análise automática manda para a administração quando a foto não está nítida ou algo não confere. Você recebe a decisão como notificação.</> },
  { pergunta: "Por que meus pontos diminuíram?", resposta: <>Veja o extrato em Engajamento: cada saída tem o motivo (estorno de descarte reprovado, resgate, medida administrativa ou zeragem do ciclo).</> },
  { pergunta: "O código da estação venceu. E agora?", resposta: <>Gere outro em Descartes. Cada código vale 5 minutos e uma vez só.</> },
  { pergunta: "Estou suspenso. Posso descartar?", resposta: <>Pode, normalmente. Só não ganha pontos, não entra em campanhas e não resgata prêmios até o fim da suspensão.</> },
];

export const perguntasAdministrador: Array<{ pergunta: string; resposta: ReactNode }> = [
  { pergunta: "Quando usar reprovação e quando usar auditoria?", resposta: <>Reprovação para erros simples (tipo errado, foto ruim). Auditoria para suspeita de fraude, quando precisa investigar e talvez aplicar medidas.</> },
  { pergunta: "Retirei pontos por engano. Como desfazer?", resposta: <>Em Moradores, abra o painel do morador e, em Histórico de medidas, toque em Revogar e informe o motivo. Os pontos voltam ao saldo e ao pódio.</> },
  { pergunta: "A banca vai testar a estação várias vezes seguidas.", resposta: <>Ligue o modo demonstração da estação em Configurações: não há espera entre descartes nem limite diário.</> },
  { pergunta: "Recebo notificações demais.", resposta: <>Em Configurações &gt; Quem recebe cada aviso, desligue os avisos opcionais do perfil Administradores. E use "Excluir lidas" em Notificações.</> },
];

export function SecoesManual({ secoes }: { secoes: Secao[] }) {
  return (
    <div className="grid gap-4">
      {secoes.map(secao => (
        <section
          key={secao.titulo}
          className="rounded-2xl border border-[#e2ebe5] bg-[#fbfdfc] p-4"
        >
          <h3 className="text-sm font-bold tracking-[-.01em]">
            {secao.titulo}
          </h3>
          {secao.resumo && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {secao.resumo}
            </p>
          )}
          <ol className="mt-2 grid list-decimal gap-1.5 pl-5 text-sm leading-6 text-muted-foreground">
            {secao.passos.map((passo, indice) => (
              <li key={indice}>{passo}</li>
            ))}
          </ol>
          {secao.exemplo && (
            <p className="mt-3 rounded-xl border border-[#cfe1d7] bg-[#f1f8f4] px-3 py-2 text-[13px] leading-6 text-[#24453a]">
              <b className="text-[#0f7350]">Exemplo: </b>
              {secao.exemplo}
            </p>
          )}
          {secao.dica && (
            <p className="mt-2 rounded-xl border border-[#f3dcb0] bg-[#fff8ec] px-3 py-2 text-[13px] leading-6 text-[#5c3d0a]">
              <b>Dica: </b>
              {secao.dica}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

/** Perguntas frequentes, abrindo uma de cada vez. */
export function PerguntasFrequentes({
  perguntas,
}: {
  perguntas: Array<{ pergunta: string; resposta: ReactNode }>;
}) {
  return (
    <div className="grid gap-2">
      {perguntas.map(item => (
        <details
          key={item.pergunta}
          className="rounded-xl border border-[#e2ebe5] bg-white px-4 py-3"
        >
          <summary className="cursor-pointer text-sm font-semibold">
            {item.pergunta}
          </summary>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {item.resposta}
          </p>
        </details>
      ))}
    </div>
  );
}

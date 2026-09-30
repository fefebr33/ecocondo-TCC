import { CORES_PADRAO, rotuloResiduo, TIPOS_RESIDUO, type TipoResiduo } from "@/lib/descarte";
import type { ReactNode } from "react";

type Secao = { titulo: string; passos: ReactNode[] };

/** Passo a passo da estação de pesagem (aparece no tablet em "Como usar" e no manual do sistema). */
export function manualEstacao(cores?: Partial<Record<TipoResiduo, string>>): Secao[] {
  const nomeCor = (tipo: TipoResiduo) => (cores?.[tipo] ?? CORES_PADRAO[tipo].nome).toLowerCase();
  return [
  {
    titulo: "Antes de ir até as lixeiras",
    passos: [
      <>Separe o lixo em sacos pela cor: {TIPOS_RESIDUO.map((tipo, indice) => <span key={tipo}>{indice ? ", " : ""}<b>{nomeCor(tipo)}</b> para {rotuloResiduo[tipo].toLowerCase()}</span>)}. Os sacos coloridos ficam na portaria.</>,
      <>No aplicativo, abra <b>Descartes</b> e toque em <b>Gerar código para a estação</b>. O código tem 6 números, vale por 5 minutos e serve uma vez só.</>,
    ],
  },
  {
    titulo: "No tablet",
    passos: [
      <>Digite o código (ou mostre o QR) e confira se o nome que aparece é o seu. Se não for, toque em <b>Não sou eu</b>.</>,
      <>Toque em todos os tipos que você trouxe. Dá para registrar vários tipos no mesmo descarte.</>,
      <>Para cada tipo, o tablet pede: coloque <b>só aquele saco</b> na balança, espere o número parar e informe o peso.</>,
      <>Tire a foto do <b>visor da balança com o saco em cima</b>: números inteiros na foto, sem reflexo, sem dedo na frente. Se a foto sair escura ou tremida, o tablet avisa para tirar de novo.</>,
      <>Na tela de conferência, veja o peso e os pontos previstos de cada tipo e toque em <b>Confirmar</b>. Depois coloque cada saco na lixeira da mesma cor.</>,
    ],
  },
  {
    titulo: "Depois do descarte",
    passos: [
      <>O descarte fica <b>pendente de aprovação</b>. A administração confere a foto e o peso; os pontos entram quando ela aprova.</>,
      <>Se algo estiver errado, o descarte é <b>reprovado</b> e você recebe o motivo. Em caso grave (suspeita de fraude), ele vai para <b>auditoria</b>: você é avisado e pode explicar; se a irregularidade se confirmar, pode haver perda de pontos.</>,
      <>Cada tipo tem peso mínimo e máximo por descarte e uma regra de pontos. Rejeito não dá pontos, mas conta nos indicadores do condomínio.</>,
      <>Nenhum saco vale zero por ser leve: o descarte vale a fração exata (ex.: 0,95 ponto) e as frações se somam até virar ponto inteiro no seu saldo.</>,
    ],
  },
  ];
}

export const manualMorador: Secao[] = [
  { titulo: "Visão geral", passos: [<>Seu <b>painel pessoal</b> mostra quanto você descartou, de que tipos, quando, seus pontos e a situação de cada descarte.</>] },
  { titulo: "Notificações", passos: [<>Toda notificação nova aparece na tela. Tocar nela leva direto ao descarte, ao extrato de pontos ou ao resgate de que ela fala.</>] },
  { titulo: "Engajamento e pódio", passos: [<>Troque pontos por recompensas do catálogo em <b>Engajamento</b>. O pódio mostra só os 3 primeiros; os prêmios são cestas e brindes de datas comemorativas.</>, <>A administração pode zerar os pontos de todos para começar um novo ciclo; isso aparece no seu extrato.</>] },
  { titulo: "Guia de descarte", passos: [<>O guia mostra o que vai em cada tipo e a cor do saco.</>] },
];

export const manualAdministrador: Secao[] = [
  { titulo: "Aprovar descartes", passos: [<>Em <b>Descartes</b>, confira a foto e o peso de cada tipo. <b>Aprovar</b> libera os pontos pela regra do tipo; <b>Reprovar</b> pede um motivo, que vai para o morador; <b>Auditoria</b> é para casos graves (furto, peso forjado).</>, <>Na auditoria, o parecer <b>regular</b> aprova o descarte; <b>irregular</b> reprova e pode aplicar punição em pontos.</>] },
  { titulo: "Moradores e painéis", passos: [<>Em <b>Moradores</b>, filtre por bloco, nome ou apartamento e abra o <b>painel</b> de cada morador.</>, <>Em <b>Pessoas e acessos</b>, gere o link de primeiro acesso (ou de nova senha) e envie para a pessoa.</>] },
  { titulo: "Configurações", passos: [<>Defina o peso mínimo, o máximo e os pontos por kg de cada tipo, a cor do saco de cada tipo, quais avisos cada perfil recebe e as estações de pesagem.</>, <>Para começar um novo ciclo, use <b>Zerar pontos de todos</b> (pede confirmação e motivo e fica no extrato e na auditoria).</>] },
  { titulo: "Relatórios", passos: [<>Escolha o período e o bloco: gráficos por bloco, por mês e por tipo, aprovações e reprovações. Exporte em PDF ou planilha.</>] },
];

export function SecoesManual({ secoes }: { secoes: Secao[] }) {
  return (
    <div className="grid gap-4">
      {secoes.map((secao) => (
        <section key={secao.titulo} className="rounded-2xl border border-[#e2ebe5] bg-[#fbfdfc] p-4">
          <h3 className="text-sm font-bold tracking-[-.01em]">{secao.titulo}</h3>
          <ol className="mt-2 grid list-decimal gap-1.5 pl-5 text-sm leading-6 text-muted-foreground">
            {secao.passos.map((passo, indice) => <li key={indice}>{passo}</li>)}
          </ol>
        </section>
      ))}
    </div>
  );
}

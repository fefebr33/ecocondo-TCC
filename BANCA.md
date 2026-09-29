# Roteiro da banca (10 minutos)

Demonstração do fluxo principal do EcoCondo: o morador gera o código, registra a reciclagem na estação de pesagem (balança simulada), ganha pontos e é notificado; a administração acompanha, reprova com motivo e tudo fica no extrato e na auditoria.

## Antes da apresentação

### 1. Onde rodar

| Opção | Quando usar | Observação |
|---|---|---|
| **Codespaces** (recomendado) | Qualquer computador com navegador | Endereço `https`: a câmera do celular consegue ler o QR. Deixe a porta 3000 como **Public** durante a banca (ver [NUVEM.md](NUVEM.md)). |
| **Notebook local** (`pnpm dev`) | Sem internet confiável | Morador, estação e administração em janelas do mesmo notebook. Para usar um tablet de verdade, ele precisa estar na mesma rede Wi‑Fi e abrir `http://IP-DO-NOTEBOOK:3000`; o firewall do Windows pode bloquear sem permissão de administrador. Sem `https`, a câmera não lê o QR: digite os 6 números. |
| **Render** (site público) | Mostrar no celular dos avaliadores | Ver [NUVEM.md](NUVEM.md). |

### 2. Dados de demonstração zerados

Rode, pouco antes da banca (com o `pnpm dev` parado):

```bash
pnpm db:seed --limpar
```

Isso recria o banco com seis meses de histórico, o top 3, um registro aguardando aprovação (Luísa, 26 kg), uma coleta atrasada, uma coleta reprovada com motivo, um prêmio com estoque baixo e a estação **"Lixeiras do térreo" já em modo demonstração**. No fim, o comando mostra:

- `Saldos de pontos conferidos com o extrato: tudo certo.`
- o link de pareamento da estação: `/estacao?codigo=...` (copie; ele muda a cada `--limpar`).

Depois rode `pnpm dev` de novo.

> Ensaiou antes? Rode o `--limpar` outra vez: a estação exige 10 minutos entre dois registros do mesmo morador e aceita no máximo 4 por dia.

### 3. Três janelas abertas

1. **Morador** (celular, ou uma janela anônima): página inicial › *Entrar* › **Morador** (Marina Moradora).
2. **Estação** (tablet, ou outra aba): abra o link de pareamento. Aparece a faixa laranja **MODO DEMONSTRAÇÃO · SIMULAÇÃO DE HARDWARE**.
3. **Administração** (janela normal, **não** a mesma do morador, porque o login fica no navegador): *Entrar* › **Administrador** (Ana Administradora).

Se perder o link da estação: Administração › *Configurações* › *Estações de pesagem* › **Novo código** (e **Ligar demonstração**, se estiver desligada).

## Roteiro

| Tempo | Quem | O que mostrar |
|---|---|---|
| 0:00–1:00 | Morador | **Painel**: saldo de pontos, top 3 do mês e a própria posição (só ele vê). Em **Coletas**, toque em **Gerar código para a estação**: aparecem os 6 números e o QR, válidos por 5 minutos e uma vez só. |
| 1:00–3:00 | Estação | Digite o código (ou leia o QR). Confirme o nome do morador, deixe **Reciclável**, toque em **2,50 kg** e em **Conferir registro**: a tela mostra estação, morador, material, peso com unidade, "balança simulada" e o resultado (2 pontos) **antes** de gravar. Toque em **Confirmar registro**: aparece a coleta nº, peso, status Concluída e +2 pontos. Opcional: **Novo registro** e digite o mesmo código, que é recusado. |
| 3:00–5:00 | Morador | Sino de **Notificações**: "Pesagem registrada", "Coleta concluída" e "+2 ponto(s)". Toque numa para abrir e marcar como lida. Em **Engajamento › Extrato de pontos**, a entrada de +2 com o saldo depois dela. |
| 5:00–7:00 | Administração | **Painel**: quadro "Precisa de atenção" (registro aguardando aprovação, coleta atrasada, resgates, estoque baixo), mês atual × anterior, taxa de conclusão, pontos movimentados e evolução de 6 meses. Em **Coletas**, a coleta nº (Bloco A) com "balança simulada" e o registro de 26 kg aguardando aprovação. Em **Auditoria**, o registro da estação. |
| 7:00–9:00 | Administração → Morador | Em **Coletas**, **Reprovar** a coleta nº com o motivo (ex.: "Saco com restos de comida; não conta como reciclável."). No morador: notificações "Coleta reprovada" (com o motivo) e "-2 ponto(s) estornado(s)"; no extrato, a linha de estorno. Na **Auditoria**, a reprovação com motivo, valor anterior e novo. |
| 9:00–10:00 | Os dois | **Pódio**: o morador vê só o top 3 e a própria posição; a administração vê todos e navega entre meses. **Engajamento**: catálogo com saldo, "Faltam X pts", estoque e confirmação do resgate. Segurança: o morador não acessa Relatórios nem Auditoria; o código da estação vale uma vez; pesos zero, negativos ou acima de 30 kg são barrados. |

## Se algo sair diferente

| Mensagem | O que fazer |
|---|---|
| "Aguarde 10 minutos entre um registro e outro" ou limite do dia | O morador já registrou há pouco (ensaio). Rode `pnpm db:seed --limpar` e pareie de novo. |
| "Código inválido ou vencido" | O código passou de 5 minutos ou já foi usado. Gere outro no morador. |
| Estação bloqueada por códigos errados | Após 8 códigos errados, a estação fica 15 minutos bloqueada. Espere ou reinicie o `pnpm dev` (o bloqueio fica na memória do servidor). |
| Registro foi para conferência | Peso acima de 10 kg ou fora do padrão do morador. Use 2,50 kg no roteiro. |
| Estação pede a foto | O modo demonstração está desligado. Administração › Configurações › Estações de pesagem › **Ligar demonstração**. |

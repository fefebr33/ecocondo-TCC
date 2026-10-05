# Roteiro da banca (10 minutos)

Demonstração do fluxo principal do EcoCondo: o morador gera o código, registra na estação (tablet com balança simulada) um descarte com um ou vários tipos, cada um com peso e foto do visor; o descarte fica **pendente de aprovação**; a administração confere a foto e o peso e aprova (os pontos entram pela regra do tipo), reprova com motivo ou abre auditoria. Cada notificação nova aparece na tela e leva direto ao descarte.

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

Isso recria o banco com seis meses de histórico aprovado, o top 3, dois descartes **aguardando aprovação** (Beatriz com reciclável + eletrônico; Luísa com 26 kg), um descarte **em auditoria** (Rafael), um reprovado com motivo, uma auditoria concluída com punição, um prêmio com estoque baixo e a estação **"Lixeiras do térreo" já em modo demonstração**. No fim, o comando mostra:

- `Saldos de pontos conferidos com o extrato: tudo certo.`
- o link de pareamento da estação: `/estacao?codigo=...` (copie; ele muda a cada `--limpar`).

Depois rode `pnpm dev` de novo.

> Ensaiou antes? Na estação em modo demonstração não há espera de 10 minutos nem limite de 4 descartes por dia: dá para registrar vários seguidos com o mesmo morador. Fora do modo demonstração, as duas regras continuam valendo.

### 3. Logins

Todos os usuários de demonstração têm a senha **`ecocondo123`**.

| Perfil | E-mail | Observação |
|---|---|---|
| Administração | `admin@ecocondo.local` (Ana Administradora) | Já leu o manual. |
| Morador | `morador@ecocondo.local` (Marina Moradora) | **Primeiro acesso**: o sistema abre o manual e só libera depois de "Li e entendi". |
| Outros moradores | `pedro@parquedasflores.com`, `beatriz@parquedasflores.com`… | Já leram o manual. |

Com o modo demonstração ligado, a tela de login também mostra os botões **Entrar como** (sem senha).

### 4. Três janelas abertas

1. **Morador** (celular, ou uma janela anônima): *Entrar* com `morador@ecocondo.local` / `ecocondo123`.
2. **Estação** (tablet, ou outra aba): abra o link de pareamento. Aparece a faixa laranja **MODO DEMONSTRAÇÃO · SIMULAÇÃO DE HARDWARE**.
3. **Administração** (janela normal, **não** a mesma do morador, porque o login fica no navegador): *Entrar* com `admin@ecocondo.local` / `ecocondo123`.

Se perder o link da estação: Administração › *Configurações* › *Estações de pesagem* › **Novo código** (e **Ligar demonstração**, se estiver desligada).

## Roteiro

| Tempo | Quem | O que mostrar |
|---|---|---|
| 0:00–1:30 | Morador | Primeiro acesso: o **manual** abre sozinho (estação + sistema); marque "Li e entendi". **Meu painel**: quanto descartou, de que tipos, quando (gráficos), saldo e o top 3. Em **Descartes**, toque em **Gerar código para a estação**: 6 números e QR, válidos por 5 minutos e uma vez só. |
| 1:30–3:30 | Estação | Digite o código. Confirme o nome, toque em **Reciclável** e **Eletrônico** (a cor de cada saco aparece no cartão). Para cada tipo, o tablet guia: saco na balança, peso (**2,50 kg** e **0,50 kg**) e foto do visor (opcional na demonstração; fora dela o tablet avisa se a foto sai escura ou tremida). Em **Conferir**, peso e pontos previstos de cada tipo; **Confirmar**: o descarte fica **pendente de aprovação**. Mostre o botão **Como usar** e o **modo escuro**. |
| 3:30–5:00 | Administração | Pop-up "Descarte aguardando aprovação" no canto da tela: **Abrir** leva direto ao descarte. Em **Descartes › Aguardando aprovação**, os tipos do descarte com foto e peso: **Aprovar** o reciclável e **Reprovar** o eletrônico com motivo (ex.: "Foto sem o visor da balança."). Mostre o descarte de 26 kg da Luísa (alerta de peso) e o do Rafael **Em auditoria** (**Concluir auditoria** › regular ou irregular com punição). |
| 5:00–6:30 | Morador | Pop-ups "Descarte aprovado" e "Descarte reprovado" (com o motivo). Tocar leva ao descarte. Em **Engajamento › Extrato**, os pontos do aprovado. |
| 6:30–8:30 | Administração | **Moradores**: filtro por bloco e busca; **Painel** de um morador. **Relatórios**: escolha o **bloco** e veja a comparação entre blocos, quilos por mês e tipo (cores dos sacos), situação dos descartes; exporte o PDF do bloco. **Configurações**: peso mínimo/máximo, pontos por kg e cor do saco de cada tipo; quem recebe cada aviso; **Zerar pontos de todos** (não execute na banca). |
| 8:30–10:00 | Os dois | **Guia de descarte** com a cor do saco de cada tipo; **Campanhas e QR do guia** › **Imprimir só o QR** (sai uma folha com o QR e as cores). **Pessoas e acessos** › **Link de primeiro acesso** (o morador cria a senha). Segurança: o morador não acessa Relatórios nem Auditoria; o código da estação vale uma vez; pesos fora do mínimo/máximo do tipo são barrados; senha errada 5 vezes bloqueia por 15 minutos. |

### Novidades: IA, adesivos QR e medidas (se sobrar tempo ou a banca perguntar)

- **Estação**: cada saco pede o código do adesivo (no modo demonstração já vem preenchido). Escolha o que a IA "vê": com **Tudo certo** o descarte é aprovado na hora; com **Saco de cor errada** ele fica pendente com o motivo.
- **Ler QR de um saco** (administração): digite o código de um adesivo usado (ex.: o do descarte do João em Descartes) e mostre o dono, o descarte e o resultado da IA; a consulta vai para a Auditoria.
- **Adesivos QR**: pedido da Luísa aguardando entrega; **Entregar** e **Folha** para imprimir.
- **Painel** do administrador: cartões de IA, auditoria, medidas, campanhas, adesivos e ocorrências. **Moradores › Painel** de um morador: histórico de medidas e **Aplicar medida**.
- **Gestão ambiental › Ocorrências**: a denúncia da Camila (com código de adesivo) já reverteu a aprovação da IA; a do Pedro foi concluída como denúncia falsa, com advertência.
- **Campanhas**: uma ativa, uma pausada e uma encerrada. **Notificações**: aviso importante com a contagem de quem viu.

## Se algo sair diferente

| Mensagem | O que fazer |
|---|---|
| "Aguarde 10 minutos entre um descarte e outro" ou limite do dia | A estação não está em modo demonstração. Ligue o modo demonstração em Configurações > Estações (ou rode `pnpm db:seed --limpar`, que já cria a estação nesse modo) e pareie de novo. |
| "Código inválido ou vencido" | O código passou de 5 minutos ou já foi usado. Gere outro no morador. |
| Estação pede para esperar | Depois de 5 códigos errados seguidos, o tablet pede uma espera antes da próxima tentativa (15 s, 30 s, 60 s, no máximo 2 min). Espere ou reinicie o `pnpm dev` (a contagem fica na memória do servidor). |
| "Muitas tentativas erradas" no login | 5 senhas erradas bloqueiam o e-mail por 15 minutos. Reinicie o `pnpm dev` ou gere o link de nova senha em **Pessoas e acessos** (entrando pelo outro perfil). |
| O morador cai no manual toda vez | Ele não marcou "Li e entendi". Marque a caixa e confirme. |
| Estação pede a foto | O modo demonstração está desligado. Administração › Configurações › Estações de pesagem › **Ligar demonstração**. |

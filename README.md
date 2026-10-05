# EcoCondo — Gestão circular para condomínios

Plataforma web para organizar os descartes e a reciclagem de condomínios: o morador registra cada descarte numa estação (tablet com balança ao lado das lixeiras), a administração confere e aprova, e o sistema cuida de pontos, engajamento, auditoria, relatórios por bloco e comunicação. O sistema é de descarte, não de agendamento de coletas.

## Arquitetura

Aplicação full-stack em um único processo: cliente React (Vite) servido pelo próprio backend em desenvolvimento, API Express com tRPC, e banco de dados MySQL 8 via Drizzle ORM (driver `mysql2`).

Banco de dados, tabelas, colunas e rotas da API estão em português. Nomes de bibliotecas, arquivos de configuração e sintaxe da linguagem (TypeScript/React) permanecem em inglês, como é padrão no ecossistema.

## Estrutura de pastas

```
client/src/
  paginas/      Uma tela por arquivo (Painel, Descartes, Estacao, Podio, Auditoria...), ligadas às rotas em App.tsx
  components/   Componentes reutilizáveis (AppShell é o layout com menu lateral) e components/ui (shadcn/ui)
  lib/          Cliente tRPC e utilitários
  tema-escuro.css  Cores do modo escuro, geradas por scripts/temaEscuro.ts (não edite à mão)

server/
  rotas.ts      Monta o roteador raiz da API (appRouter), a partir dos módulos abaixo
  rotas/        Um arquivo por área de negócio (nucleo, operacoes, indicadores, sustentabilidade, auditoria, podio)
  dominio/      Regras de negócio puras e testáveis sem banco de dados (regrasColeta, regrasPessoas, antifraude...)
  db/           Acesso ao banco: obtenção/criação de perfil de acesso (ecocondo.ts)
  _core/        Infraestrutura do servidor (autenticação, sessão, contexto tRPC, ambiente)

drizzle/schema.ts   Definição de todas as tabelas do banco MySQL (em português)
drizzle/*.sql       Migrações geradas a partir do schema (aplicadas por pnpm db:push e na subida do servidor)
shared/             Código compartilhado entre cliente e servidor (permissões, situação dos descartes, regras padrão de cada tipo, notificações)
```

Cada arquivo em `server/rotas/` expõe um grupo de rotas (ex.: `podio.ts` expõe `podio.ranking`, `podio.configurarPremios` e `podio.marcarPremioEntregue`). A lógica de negócio mais complexa fica isolada em `server/dominio/`, testada separadamente do banco de dados.

## Apresentação para a banca

O roteiro de 10 minutos (contas, estação em modo demonstração e o que mostrar em cada etapa) está em [BANCA.md](BANCA.md).

## Rodando na nuvem

Para programar pelo navegador de qualquer computador (GitHub Codespaces, já com MySQL e dados de demonstração) ou publicar o site num endereço público (Render + Aiven), veja [NUVEM.md](NUVEM.md).

## Rodando localmente

### 1. Pré-requisitos

- Node.js LTS
- pnpm (`npm install -g pnpm`)
- MySQL 8 rodando (veja abaixo como rodar no Windows **sem permissão de administrador**)

Sem arquivo `.env`, o sistema usa `mysql://root@127.0.0.1:3306/ecocondo` (MySQL local, usuário `root` sem senha). Para outro endereço, copie `.env.example` para `.env` e ajuste o `DATABASE_URL`.

#### MySQL no Windows sem administrador (versão ZIP, sem instalar)

1. Em <https://dev.mysql.com/downloads/mysql/>, escolha *Microsoft Windows* e baixe o **ZIP Archive** (não o instalador MSI). Na página seguinte, clique em *"No thanks, just start my download"*.
2. Extraia numa pasta sua, por exemplo `C:\Users\<você>\Claude\TCC\mysql` (a pasta deve conter `bin\mysqld.exe`).
3. Num terminal (PowerShell ou cmd), **uma única vez**, crie a pasta de dados com o `root` sem senha:

   ```bat
   cd C:\Users\<você>\Claude\TCC\mysql\bin
   mysqld --initialize-insecure --console
   ```

4. Sempre que for usar o sistema, deixe o MySQL aberto num terminal próprio:

   ```bat
   cd C:\Users\<você>\Claude\TCC\mysql\bin
   mysqld --console
   ```

   Ele fica escutando na porta 3306 até você fechar a janela (ou apertar Ctrl+C). Nada é instalado como serviço, por isso não pede administrador.

Se o `mysqld` reclamar de `VCRUNTIME140_1.dll` ou `MSVCP140.dll`, falta o *Visual C++ Redistributable* no Windows (a instalação dele pede administrador; peça ao responsável pelo computador) ou use a opção na nuvem abaixo.

#### Alternativa: MySQL gratuito na nuvem

Serviços como o [Aiven for MySQL](https://aiven.io/free-mysql-database) têm plano gratuito com MySQL 8 de verdade. Crie o serviço, baixe o certificado CA e monte o `.env`:

```env
DATABASE_URL=mysql://avnadmin:SENHA@HOST:PORTA/ecocondo
DATABASE_SSL=true
DATABASE_SSL_CA=./ca.pem
```

O nome do banco no fim do endereço (aqui `ecocondo`) é criado automaticamente.

### 2. Instalar e preparar o banco

```bash
pnpm install
pnpm db:push
```

Isso cria o banco `ecocondo` no MySQL (se ainda não existir) e todas as tabelas. O `pnpm dev` também faz isso sozinho ao subir.

Para apresentar o sistema com dados de exemplo (sete moradores, seis meses de descartes aprovados, descartes pendentes e em auditoria, pódio, certificados e resgates), rode:

```bash
pnpm db:seed
```

Os dados passam pelas mesmas rotas e regras do sistema. Para recomeçar do zero, rode `pnpm db:seed --limpar` (apaga e recria o banco `ecocondo`).

Para ver as tabelas, use qualquer cliente MySQL (MySQL Workbench, DBeaver, HeidiSQL) ou o `bin\mysql.exe -u root ecocondo` da pasta do ZIP.

### 3. Rodar

```bash
pnpm dev
```

Acesse [http://localhost:3000](http://localhost:3000) e clique em **"Acessar plataforma"**. Entre com e-mail e senha (dados de demonstração: `admin@ecocondo.local` ou `morador@ecocondo.local`, senha `ecocondo123`) ou, com o modo demonstração ligado, pelos botões **Entrar como**. No primeiro acesso, o manual abre sozinho e precisa ser lido.

### Estação de pesagem (tablet + balança)

Não existe perfil coletor nem agendamento: o próprio morador pesa e registra o descarte num tablet ao lado das lixeiras, e a administração não registra descartes.

1. O administrador cadastra o tablet em **Configurações > Estações de pesagem** e recebe um código de pareamento (mostrado uma única vez).
2. No tablet, abra `/estacao` e digite o código (ou abra o link de pareamento). O `pnpm db:seed` já cria uma estação e mostra o link no terminal.
3. O morador toca em **Gerar código para a estação** em **Descartes** no celular e digita os 6 números no tablet. O tablet guia o descarte: escolher um ou vários tipos (com a cor do saco de cada um), pesar cada saco, fotografar o visor (o tablet avisa se a foto sai escura ou tremida) e conferir antes de confirmar. O botão **Como usar** mostra o passo a passo a qualquer momento.

Cada saco leva um **adesivo QR** do morador (lido pela câmera do tablet ou digitado). A **análise automática (IA)** confere a foto de cada saco: tipo do resíduo, peso no visor e cor do saco. Se tudo bate com o que foi informado, a confiança passa do mínimo configurado e não há alerta antifraude, o descarte é **aprovado sozinho** (os pontos entram na hora). Qualquer divergência, dúvida ou falha da análise deixa o descarte **pendente**, com os motivos registrados, para um responsável avaliar. Em **Descartes**, a administração confere a foto, o peso e o resultado da IA e **aprova**, **reprova** com motivo ou abre **auditoria**; também pode **reverter uma aprovação** (inclusive a da IA) e mandar para nova avaliação ou auditoria. A auditoria termina como regular ou irregular, com as **medidas** escolhidas da lista do condomínio. O morador é avisado em cada passo.

Travas antifraude: só tablet pareado registra; código do morador de uso único, válido por 5 minutos, com espera crescente no tablet depois de 5 códigos errados seguidos (15 s até 2 min, sem travar o tablet para os outros moradores); o limite diário conta os dias pelo horário de Brasília e ignora descartes reprovados; foto obrigatória fora do modo demonstração; peso mínimo e máximo por tipo (definidos em **Configurações**); até 40 kg e 4 descartes por dia, com 10 minutos entre descartes (na estação em modo demonstração essas três regras ficam desligadas, para a banca registrar vários descartes seguidos); alertas para pesos acima de 10 kg ou muito acima do histórico do morador. Os limites gerais ficam em `server/dominio/estacaoPesagem.ts` e as regras padrão de cada tipo em `shared/descarte.ts`.

### Análise automática (IA)

A análise usa a API do Claude (`server/ia/analiseDescarte.ts`). Sem a variável `ANTHROPIC_API_KEY` (ou com `IA_SIMULACAO=1`), ela roda em **modo simulação**: na estação em modo demonstração, o administrador escolhe o que a IA "vê" (tudo certo, cor errada, outro tipo, peso diferente, foto ilegível). Em **Configurações > Análise automática** ficam a aprovação automática (liga/desliga), a confiança mínima e se o adesivo é obrigatório. Cada análise fica gravada (`analises_ia`) e aparece no detalhe do descarte. A balança não é ligada ao sistema: a IA lê o peso na foto do visor.

### Adesivos QR

Cada morador recebe um kit de adesivos (um por saco, uso único). O QR e o código impresso (`EC-XXXX-XXXX`) não trazem dados pessoais. Em **Adesivos QR**, o morador vê quantos tem, o histórico e pede mais; a administração atende os pedidos, entrega kits, imprime a folha de adesivos e cancela adesivos perdidos. O sistema marca o adesivo como usado no descarte e avisa quando o kit está acabando. Em **Ler QR de um saco** (só administração), a câmera ou o código digitado mostra o dono (nome, bloco e apartamento, sem e-mail ou telefone) e o descarte; cada consulta fica registrada na auditoria.

### Medidas, ocorrências e avisos

- **Medidas administrativas** (Configurações): retirada de pontos, suspensão das campanhas ou da participação por dias ou meses, advertência ou outra medida; o administrador escolhe na auditoria, na ocorrência ou no relatório do morador. O histórico mostra ocorrência, medida, período e responsável; suspensões terminam sozinhas e a revogação devolve os pontos.
- **Ocorrências e denúncias** (Gestão ambiental): o morador pode informar o número do descarte ou o código do adesivo; a administração é notificada, encaminha o descarte para nova avaliação ou auditoria e conclui como procedente, improcedente ou denúncia falsa, com medidas para quem errou. Denúncias falsas repetidas geram alerta. Quem denunciou nunca é revelado ao morador envolvido.
- **Campanhas**: editar, pausar (com data para voltar), retomar, encerrar e excluir, com indicadores e avisos de participação, alteração, fim próximo e encerramento.
- **Avisos gerais** (Notificações): para todos, só moradores ou só administradores, com assunto e marcação de importante; a administração vê quem visualizou cada aviso.

### Pontos

Cada tipo tem sua regra de pontos (pontos por kg aprovado; rejeito não dá pontos). O descarte vale a fração exata (0,99 kg de reciclável = 0,99 ponto) e as frações de cada morador se somam até virar ponto inteiro no saldo (`moradores.resto_pontos_milesimos`). O valor mostrado no tablet fica gravado no registro e é o que a aprovação credita, mesmo que a regra mude antes. A administração pode ajustar o saldo de um morador (**Moradores > Pontos**) e **zerar os pontos de todos** para começar um novo ciclo (**Configurações**); tudo aparece no extrato e na auditoria, e o pódio conta a partir do início do ciclo.

### Pódio e privacidade

Os moradores veem só os três primeiros colocados (nome e bloco) e a própria posição; ninguém abaixo do 3º lugar é exposto. O morador pode pedir para aparecer como "Morador(a) do bloco X". O administrador vê a lista completa e define o prêmio de cada posição (sem descontos na taxa condominial).

## Modo escuro

O botão de lua/sol no topo (e no tablet) alterna entre claro e escuro; a escolha fica guardada no aparelho. As telas usam cores fixas pensadas para o fundo claro, então `scripts/temaEscuro.ts` gera `client/src/tema-escuro.css` com a versão escura de cada cor. O arquivo é atualizado sozinho no `pnpm dev` e no `pnpm build`; à mão, `pnpm tema:escuro`.

## Validar

```bash
pnpm check
pnpm test
```

Os testes com banco real criam um banco temporário (`ecocondo_teste_...`) no mesmo MySQL do `DATABASE_URL` e o apagam ao final. Se o MySQL não estiver rodando, esses testes aparecem como ignorados; o CI do GitHub sobe um MySQL 8 e os executa sempre.

### Alterar o banco

Mude as tabelas em `drizzle/schema.ts`, rode `pnpm db:generate` para gerar a nova migração em `drizzle/` e depois `pnpm db:push` para aplicá-la.

## Login

Login com e-mail e senha (hash scrypt; 5 senhas erradas bloqueiam o e-mail por 15 minutos). O administrador gera em **Pessoas e acessos** o link de **primeiro acesso** (a pessoa cria a senha) ou de **nova senha**; o link vale uma vez, por 72 horas (primeiro acesso) ou 2 horas (recuperação). Sem servidor de e-mail no protótipo, "Esqueci minha senha" só registra o link no log do servidor: ele nunca aparece na tela (senão qualquer visitante trocaria a senha de qualquer pessoa). Quem entrega o link é o síndico.

A sessão dura 30 dias. **Sair** encerra a sessão daquele aparelho no servidor (o cookie copiado deixa de valer); **trocar a senha** encerra as sessões dos outros aparelhos. Em **Pessoas e acessos**, o síndico pode **desativar o acesso** de quem se mudou ou deixou a administração: a pessoa sai do sistema na hora, não entra mais e não registra descartes; o histórico fica.

Com o modo demonstração ligado, a tela de login também tem os botões **Entrar como** (rota `/api/auth/entrar?role=<perfil>`), sem senha, para a banca e testes.

### Variáveis de ambiente (opcionais, no arquivo `.env`)

| Variável | Para que serve |
| --- | --- |
| `JWT_SECRET` | Chave que assina as sessões. Em produção (`pnpm start`), sem ela o servidor gera uma chave aleatória a cada início e as sessões expiram ao reiniciar. |
| `LOGIN_DEMONSTRACAO=desativado` | Desliga os botões "Entrar como" (sem senha). Use num servidor público, porque com eles qualquer visitante entra como administrador. O login com e-mail e senha continua. |
| `DATABASE_URL` | Endereço do MySQL, no formato `mysql://usuario:senha@servidor:porta/banco` (padrão `mysql://root@127.0.0.1:3306/ecocondo`). |
| `DATABASE_SSL=true` | Usa conexão segura com o MySQL (necessário na maioria dos serviços na nuvem). |
| `ANTHROPIC_API_KEY` | Chave da API do Claude para a análise automática dos descartes. Sem ela, a análise roda em modo simulação. |
| `IA_SIMULACAO=1` | Força o modo simulação mesmo com a chave configurada. |
| `DATABASE_SSL_CA` | Caminho do certificado CA do provedor, quando ele fornece um (ex.: `./ca.pem`). |

## Arquivos enviados

Fotos do visor da balança, fotos de ocorrências, certificados e relatórios ficam no próprio MySQL (tabela `arquivos`) e são servidos em `/uploads/<chave>` só para quem está logado no mesmo condomínio. Assim nada se perde quando o servidor reinicia (no plano gratuito do Render, o disco é apagado a cada reinício). Arquivos antigos em `data/uploads/` continuam sendo servidos.

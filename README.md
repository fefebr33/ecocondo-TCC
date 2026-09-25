# EcoCondo — Gestão circular para condomínios

Plataforma web para organizar a coleta seletiva de condomínios: acompanhamento de coletas, moradores, engajamento, auditoria, relatórios e comunicação, com painel administrativo completo.

## Arquitetura

Aplicação full-stack em um único processo: cliente React (Vite) servido pelo próprio backend em desenvolvimento, API Express com tRPC, e banco de dados MySQL 8 via Drizzle ORM (driver `mysql2`).

Banco de dados, tabelas, colunas e rotas da API estão em português. Nomes de bibliotecas, arquivos de configuração e sintaxe da linguagem (TypeScript/React) permanecem em inglês, como é padrão no ecossistema.

## Estrutura de pastas

```
client/src/
  paginas/      Uma tela por arquivo (Painel, Coletas, Podio, Auditoria...), ligadas às rotas em App.tsx
  components/   Componentes reutilizáveis (AppShell é o layout com menu lateral) e components/ui (shadcn/ui)
  lib/          Cliente tRPC e utilitários

server/
  rotas.ts      Monta o roteador raiz da API (appRouter), a partir dos módulos abaixo
  rotas/        Um arquivo por área de negócio (nucleo, operacoes, indicadores, sustentabilidade, auditoria, podio)
  dominio/      Regras de negócio puras e testáveis sem banco de dados (regrasColeta, regrasPessoas, antifraude...)
  db/           Acesso ao banco: obtenção/criação de perfil de acesso (ecocondo.ts)
  _core/        Infraestrutura do servidor (autenticação, sessão, contexto tRPC, ambiente)

drizzle/schema.ts   Definição de todas as tabelas do banco MySQL (em português)
drizzle/*.sql       Migrações geradas a partir do schema (aplicadas por pnpm db:push e na subida do servidor)
shared/             Código compartilhado entre cliente e servidor (permissões, constantes)
```

Cada arquivo em `server/rotas/` expõe um grupo de rotas (ex.: `podio.ts` expõe `podio.ranking` e `podio.configurarDescontos`). A lógica de negócio mais complexa fica isolada em `server/dominio/`, testada separadamente do banco de dados.

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

Para apresentar o sistema com dados de exemplo (sete moradores, seis meses de coletas, pódio, certificados, resgates e um peso aguardando aprovação), rode:

```bash
pnpm db:seed
```

Os dados passam pelas mesmas rotas e regras do sistema. Para recomeçar do zero, rode `pnpm db:seed --limpar` (apaga e recria o banco `ecocondo`).

Para ver as tabelas, use qualquer cliente MySQL (MySQL Workbench, DBeaver, HeidiSQL) ou o `bin\mysql.exe -u root ecocondo` da pasta do ZIP.

### 3. Rodar

```bash
pnpm dev
```

Acesse [http://localhost:3000](http://localhost:3000). Clique em **"Acessar plataforma"** e escolha um perfil (Administrador, Coletor ou Morador) — o login local cria a conta de demonstração automaticamente, sem senha.

## Validar

```bash
pnpm check
pnpm test
```

Os testes com banco real criam um banco temporário (`ecocondo_teste_...`) no mesmo MySQL do `DATABASE_URL` e o apagam ao final. Se o MySQL não estiver rodando, esses testes aparecem como ignorados; o CI do GitHub sobe um MySQL 8 e os executa sempre.

### Alterar o banco

Mude as tabelas em `drizzle/schema.ts`, rode `pnpm db:generate` para gerar a nova migração em `drizzle/` e depois `pnpm db:push` para aplicá-la.

## Login

O login é totalmente local: a rota `/api/auth/entrar?role=<perfil>` cria/reaproveita uma conta de demonstração para o perfil escolhido e assina a sessão. Não depende de nenhum serviço externo.

### Variáveis de ambiente (opcionais, no arquivo `.env`)

| Variável | Para que serve |
| --- | --- |
| `JWT_SECRET` | Chave que assina as sessões. Em produção (`pnpm start`), sem ela o servidor gera uma chave aleatória a cada início e as sessões expiram ao reiniciar. |
| `LOGIN_DEMONSTRACAO=desativado` | Desliga o login de demonstração sem senha. Use num servidor público, porque com ele qualquer visitante entra como administrador. |
| `DATABASE_URL` | Endereço do MySQL, no formato `mysql://usuario:senha@servidor:porta/banco` (padrão `mysql://root@127.0.0.1:3306/ecocondo`). |
| `DATABASE_SSL=true` | Usa conexão segura com o MySQL (necessário na maioria dos serviços na nuvem). |
| `DATABASE_SSL_CA` | Caminho do certificado CA do provedor, quando ele fornece um (ex.: `./ca.pem`). |

## Arquivos enviados

Fotos anexadas a ocorrências (Gestão ambiental) são salvas em `data/uploads/` e servidas em `/uploads/<chave>`.

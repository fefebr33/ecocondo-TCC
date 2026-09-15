# EcoCondo — Gestão circular para condomínios

Plataforma web para organizar a coleta seletiva de condomínios: acompanhamento de coletas, moradores, engajamento, auditoria, relatórios e comunicação, com painel administrativo completo.

## Arquitetura

Aplicação full-stack em um único processo: cliente React (Vite) servido pelo próprio backend em desenvolvimento, API Express com tRPC, e banco de dados MySQL/MariaDB via Drizzle ORM.

## Rodando localmente

### 1. Pré-requisitos

- Node.js LTS
- pnpm (`npm install -g pnpm`)
- Um banco MySQL ou MariaDB disponível

### 2. Banco de dados

Escolha uma opção:

**Opção A — Docker** (se você tem Docker Desktop instalado):

```bash
docker run -d --name ecocondo-mysql \
  -e MYSQL_ROOT_PASSWORD=root \
  -e MYSQL_DATABASE=ecocondo \
  -e MYSQL_USER=ecocondo \
  -e MYSQL_PASSWORD=ecocondo \
  -p 3306:3306 mysql:8
```

**Opção B — MySQL/MariaDB instalado na máquina** (Windows: instalador do site do MySQL; Mac: `brew install mysql && brew services start mysql`):

```sql
CREATE DATABASE ecocondo;
CREATE USER 'ecocondo'@'localhost' IDENTIFIED BY 'ecocondo';
GRANT ALL PRIVILEGES ON ecocondo.* TO 'ecocondo'@'localhost';
```

### 3. Variáveis de ambiente

Crie um arquivo `.env` na raiz do projeto:

```env
DATABASE_URL=mysql://ecocondo:ecocondo@localhost:3306/ecocondo
PORT=3000
JWT_SECRET=chave-local-de-demonstracao-troque-em-producao
VITE_APP_ID=ecocondo-local
```

### 4. Instalar e preparar o banco

```bash
pnpm install
pnpm db:push
```

### 5. Rodar

```bash
pnpm dev
```

Acesse [http://localhost:3000](http://localhost:3000). Na tela inicial, use o link **"Entrar em modo demonstração"** (visível apenas em desenvolvimento) para entrar direto no painel como administrador, sem depender de um serviço de login externo.

## Validar

```bash
pnpm check
pnpm test
```

## Observação sobre login

Em produção, o login usa um servidor OAuth externo (`OAUTH_SERVER_URL`) que não faz parte deste repositório. O modo de demonstração local (`/api/dev/login`) existe apenas fora de produção e não é exposto em builds de produção.

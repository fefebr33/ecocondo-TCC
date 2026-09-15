# EcoCondo — Gestão circular para condomínios

Plataforma web para organizar a coleta seletiva de condomínios: acompanhamento de coletas, moradores, engajamento, auditoria, relatórios e comunicação, com painel administrativo completo.

## Arquitetura

Aplicação full-stack em um único processo: cliente React (Vite) servido pelo próprio backend em desenvolvimento, API Express com tRPC, e banco de dados SQLite local via Drizzle ORM (um arquivo, sem servidor externo).

## Rodando localmente

### 1. Pré-requisitos

- Node.js LTS
- pnpm (`npm install -g pnpm`)

Não é necessário instalar nenhum banco de dados nem configurar variáveis de ambiente — tudo já tem um valor padrão para uso local.

### 2. Instalar e preparar o banco

```bash
pnpm install
pnpm db:push
```

Isso cria o arquivo `data/ecocondo.db` com todas as tabelas.

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

## Login

O login é totalmente local: a rota `/api/auth/entrar?role=<perfil>` cria/reaproveita uma conta de demonstração para o perfil escolhido e assina a sessão. Não depende de nenhum serviço externo.

## Arquivos enviados

Fotos anexadas a ocorrências (Gestão ambiental) são salvas em `data/uploads/` e servidas em `/uploads/<chave>`.

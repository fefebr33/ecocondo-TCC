# EcoCondo — Gestão circular para condomínios

Plataforma web para organizar a coleta seletiva de condomínios: acompanhamento de coletas, moradores, engajamento, auditoria, relatórios e comunicação, com painel administrativo completo.

## Arquitetura

Aplicação full-stack em um único processo: cliente React (Vite) servido pelo próprio backend em desenvolvimento, API Express com tRPC, e banco de dados SQLite local via Drizzle ORM (um arquivo, sem servidor externo).

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

drizzle/schema.ts   Definição de todas as tabelas do banco (em português)
shared/             Código compartilhado entre cliente e servidor (permissões, constantes)
```

Cada arquivo em `server/rotas/` expõe um grupo de rotas (ex.: `podio.ts` expõe `podio.ranking` e `podio.configurarDescontos`). A lógica de negócio mais complexa fica isolada em `server/dominio/`, testada separadamente do banco de dados.

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

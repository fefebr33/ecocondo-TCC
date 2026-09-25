#!/usr/bin/env bash
# Roda uma vez, quando o Codespace é criado: instala o pnpm e as dependências e popula o MySQL com os dados de demonstração.
set -e
npm install -g pnpm@10.4.1
pnpm install --frozen-lockfile
for tentativa in $(seq 1 30); do
  if pnpm db:push; then break; fi
  echo "Aguardando o MySQL ficar pronto ($tentativa/30)..."
  sleep 2
done
pnpm db:seed

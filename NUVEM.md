# EcoCondo na nuvem

Dois usos, independentes:

1. **Desenvolver de qualquer computador** (escritório, casa): GitHub Codespaces. Abre um VS Code no navegador com Node, MySQL e os dados de demonstração prontos. Nada é instalado no computador.
2. **Deixar o site num endereço público** (para a banca, orientador, celular): Render (site) + Aiven (MySQL). Os dois têm plano gratuito.

## 1. Codespaces (desenvolver)

**Criar (uma vez):**

1. No GitHub, abra o repositório, escolha a branch `Desenvolvimento`, clique em **Code › Codespaces › Create codespace on Desenvolvimento**.
2. Espere a preparação (na primeira vez leva alguns minutos): ela instala as dependências, sobe o MySQL 8 e roda `pnpm db:seed`.
3. No fim, o `pnpm dev` abre sozinho num terminal e o navegador abre o sistema (aba **Ports**, porta 3000, se não abrir).

**Continuar em outro computador:** entre em <https://github.com/codespaces> com a mesma conta e abra o mesmo codespace. Ele guarda os arquivos, o banco e o que você não commitou. Basta o navegador.

**Cuidados:**

- Quando terminar, feche a aba. O codespace para sozinho depois de 30 minutos parado, mas você pode parar na hora em <https://github.com/codespaces> (menu **…** › *Stop codespace*).
- A conta gratuita do GitHub tem uma cota mensal de horas de Codespaces; parar o codespace economiza a cota.
- Um codespace parado há 30 dias é apagado. Faça commit e push do que importa (painel **Source Control** do VS Code).
- Se o `pnpm dev` não estiver rodando, abra um terminal (**Ctrl+`**) e rode `pnpm dev`. Para recomeçar os dados: `pnpm db:seed --limpar`.

## 2. Site público (Render + Aiven)

Pré-requisito: o `render.yaml` precisa estar na branch `Desenvolvimento` (ou seja, este PR mesclado).

### 2.1 Banco MySQL na Aiven

1. Crie a conta em <https://aiven.io/free-mysql-database>.
2. **Create service › MySQL › Free plan**, escolha uma região e crie. Espere o status ficar *Running*.
3. Na página do serviço (**Overview › Connection information**):
   - Copie o **Service URI**. Ele é parecido com `mysql://avnadmin:SENHA@mysql-xxxx.aivencloud.com:12345/defaultdb?ssl-mode=REQUIRED`.
     Troque o final `defaultdb?ssl-mode=REQUIRED` por `ecocondo`. Esse é o seu `DATABASE_URL` (o banco `ecocondo` é criado sozinho).
   - Clique em **CA certificate › Show** e copie o texto inteiro, de `-----BEGIN CERTIFICATE-----` até `-----END CERTIFICATE-----`. Esse é o seu `DATABASE_SSL_CA`.

Não cole a senha nem o certificado em chats, e-mails ou no repositório: só no painel do Render.

### 2.2 Site no Render

1. Crie a conta em <https://render.com> entrando **com o GitHub**.
2. **New › Blueprint**, escolha o repositório `ecocondo-TCC`. O Render lê o `render.yaml` e mostra o serviço `ecocondo`.
   - Se o repositório não aparecer, o Render precisa de acesso a ele. Como o repositório é da conta do Felipe, quem autoriza o app do Render é ele (ou use um fork na sua conta).
3. Ele pede duas variáveis: cole o `DATABASE_URL` e o `DATABASE_SSL_CA` da Aiven. Clique em **Apply**.
4. Na primeira publicação ele cria as tabelas e os dados de demonstração. O endereço fica no topo da página do serviço, algo como `https://ecocondo-xxxx.onrender.com`.

A cada push na branch `Desenvolvimento`, o Render publica a versão nova sozinho.

### Login de demonstração

O botão de entrar sem senha fica **ativado** (`LOGIN_DEMONSTRACAO=ativado`) para a apresentação. Como qualquer pessoa com o endereço pode entrar como administrador, fora da apresentação troque para `desativado` em **Environment** no painel do Render (ele reinicia sozinho).

### Limites do plano gratuito

- O site "dorme" após uns 15 minutos sem visitas; o primeiro acesso depois disso demora cerca de um minuto. Abra o site um pouco antes da apresentação.
- Fotos enviadas no site público ficam no disco do Render, que é apagado a cada nova publicação. Os dados do banco (Aiven) ficam.

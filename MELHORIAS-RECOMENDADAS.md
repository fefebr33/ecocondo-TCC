# Melhorias recomendadas para o EcoCondo

Este documento reúne sugestões de evolução do sistema. Os itens marcados com ✅ já foram implementados (ver `TCC_EcoCondo_Felipe_Rueda.docx`, Seção 5.25); os demais seguem como lista de referência para decidir prioridades depois, inclusive para a seção de "trabalhos futuros" do TCC.

## Já implementadas

- ✅ **Comprovação fotográfica da coleta.** Foto obrigatória ao concluir uma coleta, reaproveitando `server/storage.ts`.
- ✅ **Registro de aplicação do desconto.** Botão "marcar desconto como aplicado" no pódio, gravando data, percentual, observação e quem aplicou (`podio.marcarDescontoAplicado`).
- ✅ **Segunda aprovação para pesos muito altos.** Pesos sinalizados como suspeitos ficam com os pontos retidos até um segundo administrador aprovar ou rejeitar (`coletas.decidirAprovacaoPeso`).
- ✅ **Certificado trimestral de sustentabilidade em PDF**, por bloco, com equivalências ambientais (`certificados.gerarTrimestral`).
- ✅ **Meta pessoal do morador**, no mesmo padrão das metas por bloco (`metaPessoal.*`).
- ✅ **Métricas compartilháveis** (árvores poupadas, litros de água, CO2 evitado) no painel, na meta pessoal e nos certificados.
- ✅ **Relatório anual automático**, gerado e notificado a todos os administradores em janeiro (`scheduled/annualReport`).
- ✅ **Coleta recorrente por bloco** ("toda terça, bloco B"), gerada automaticamente (`scheduled/recurringCollections`).
- ✅ **QR code por apartamento**, escaneado ou digitado pelo administrador para identificar o morador num registro manual (`moradores.codigoQr`/`porCodigo`).
- ✅ **Estação de pesagem no lugar do coletor**: o morador registra a reciclagem num tablet com balança, com travas antifraude e revisão do administrador (`estacao.*`, `estacoes.*`).
- ✅ **Pódio só com o top 3 para os moradores** e **prêmios configuráveis** no lugar do desconto na taxa condominial (`podio.*`).

## Reciclagem, pódio e antifraude

- **Histórico de pódios encerrados.** Guardar um retrato do ranking ao final de cada mês/semestre/ano, em vez de recalcular sempre por data corrente. Evita que o pódio de um período passado mude se dados forem corrigidos depois, e permite mostrar "campeões anteriores".
- **Notificação por e-mail real.** O sistema de notificações hoje é só interno (dentro do app). Enviar e-mail (ou WhatsApp) nos eventos importantes — coleta concluída, pódio fechado, prêmio entregue — aumenta o engajamento sem depender do morador abrir o app.

## Segurança e confiabilidade

- **Rate limiting no login local.** A rota `/api/auth/entrar` não tem limite de tentativas; vale a pena adicionar um limite simples por IP para reduzir abuso, mesmo em ambiente local/demo.
- **Backup automático do banco MySQL.** Um job agendado com `mysqldump` (ou o backup automático do serviço na nuvem) evita perda de dados.
- **CI automatizado.** Rodar `pnpm check` e `pnpm test` automaticamente a cada push (GitHub Actions) evita que uma quebra chegue à branch principal sem ser notada.
- **Testes end-to-end automatizados.** Hoje a verificação de UI é manual; um conjunto pequeno de testes Playwright cobrindo login, criação de coleta e conclusão de coleta evitaria regressões visuais/funcionais silenciosas.
- **Paginação nas listagens.** `pessoas.diretorio`, `coletas.listar`, `auditoria.listar` (parcialmente) e `engajamento.ranking` carregam tudo de uma vez. Em um condomínio grande isso cresce rápido; vale paginar.

## Operação e escala

- **Multi-condomínio de verdade.** Hoje o sistema assume implicitamente um condomínio "padrão" por instância (primeira linha da tabela `condominios`). Se o objetivo for oferecer o EcoCondo como SaaS para vários condomínios ao mesmo tempo, é preciso um fluxo de criação/seleção de condomínio e isolar dados por assinante.
- **Balança ligada ao tablet.** Uma balança com saída USB ou Bluetooth lendo o peso direto no tablet eliminaria a digitação do peso, a principal brecha que sobra na estação de pesagem. Transformar a tela `/estacao` em PWA em modo quiosque também ajudaria bastante nesse uso.
- **Observabilidade.** Logs estruturados e um serviço de rastreamento de erros (ex. Sentry) ajudariam a identificar problemas em produção sem depender de relatos manuais dos usuários.

## Experiência de uso

- **Acessibilidade.** Revisar contraste de cores, navegação por teclado e leitores de tela nas telas mais usadas (coletas, pódio, pessoas).
- **Gráficos de evolução.** As páginas de relatórios e sustentabilidade mostram números e tabelas; gráficos de série temporal (peso reciclado por mês, evolução do pódio) tornariam mais fácil visualizar tendências.
- **Onboarding do síndico.** Um passo a passo guiado na primeira vez que um administrador acessa o sistema (cadastrar condomínio, convidar moradores, cadastrar a estação de pesagem, configurar prêmios do pódio) reduz a fricção inicial.

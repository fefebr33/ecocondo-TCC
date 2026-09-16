# Melhorias recomendadas para o EcoCondo

Este documento reúne sugestões de evolução do sistema. Nada aqui foi implementado — é uma lista de referência para decidir prioridades depois, inclusive para a seção de "trabalhos futuros" do TCC.

## Reciclagem, pódio e antifraude

- **Comprovação fotográfica da coleta.** Exigir uma foto anexada ao concluir uma coleta (já existe upload de foto para ocorrências em `server/storage.ts`; dá para reaproveitar). Reforça a credibilidade do peso lançado e complementa as proteções antifraude já implementadas.
- **Registro de aplicação do desconto.** Hoje o pódio só sugere o percentual; nada fica registrado quando o síndico efetivamente aplica o desconto na cobrança. Um botão simples "marcar desconto como aplicado" (gravando data, valor e quem aplicou) fecharia o ciclo de auditoria sem automatizar a parte financeira.
- **Histórico de pódios encerrados.** Guardar um retrato do ranking ao final de cada mês/semestre/ano, em vez de recalcular sempre por data corrente. Evita que o pódio de um período passado mude se dados forem corrigidos depois, e permite mostrar "campeões anteriores".
- **Segunda aprovação para pesos muito altos.** Hoje uma coleta sinalizada como suspeita (peso muito acima do histórico) só aparece na auditoria depois de já ter sido confirmada. Poderia exigir que, ao invés de bloquear ou só sinalizar, pesos acima de um limite fiquem pendentes de uma segunda confirmação por outro administrador antes de contar pontos.
- **Notificação por e-mail real.** O sistema de notificações hoje é só interno (dentro do app). Enviar e-mail (ou WhatsApp) nos eventos importantes — coleta concluída, pódio fechado, desconto sugerido — aumenta o engajamento sem depender do morador abrir o app.

## Segurança e confiabilidade

- **Rate limiting no login local.** A rota `/api/auth/entrar` não tem limite de tentativas; vale a pena adicionar um limite simples por IP para reduzir abuso, mesmo em ambiente local/demo.
- **Backup automático do banco SQLite.** Um job agendado que copia `data/ecocondo.db` periodicamente (ou usa `VACUUM INTO`) evita perda de dados por corrupção de arquivo.
- **CI automatizado.** Rodar `pnpm check` e `pnpm test` automaticamente a cada push (GitHub Actions) evita que uma quebra chegue à branch principal sem ser notada.
- **Testes end-to-end automatizados.** Hoje a verificação de UI é manual; um conjunto pequeno de testes Playwright cobrindo login, criação de coleta e conclusão de coleta evitaria regressões visuais/funcionais silenciosas.
- **Paginação nas listagens.** `pessoas.diretorio`, `coletas.listar`, `auditoria.listar` (parcialmente) e `engajamento.ranking` carregam tudo de uma vez. Em um condomínio grande isso cresce rápido; vale paginar.

## Operação e escala

- **Multi-condomínio de verdade.** Hoje o sistema assume implicitamente um condomínio "padrão" por instância (primeira linha da tabela `condominios`). Se o objetivo for oferecer o EcoCondo como SaaS para vários condomínios ao mesmo tempo, é preciso um fluxo de criação/seleção de condomínio e isolar dados por assinante.
- **App/PWA para coletores.** O papel de coletor é o que mais usa o sistema no dia a dia, muitas vezes em campo. Transformar o cliente em PWA instalável (ícone, funcionamento básico offline para registrar peso e sincronizar depois) ajudaria bastante nesse uso.
- **Observabilidade.** Logs estruturados e um serviço de rastreamento de erros (ex. Sentry) ajudariam a identificar problemas em produção sem depender de relatos manuais dos usuários.

## Experiência de uso

- **Acessibilidade.** Revisar contraste de cores, navegação por teclado e leitores de tela nas telas mais usadas (coletas, pódio, pessoas).
- **Gráficos de evolução.** As páginas de relatórios e sustentabilidade mostram números e tabelas; gráficos de série temporal (peso reciclado por mês, evolução do pódio) tornariam mais fácil visualizar tendências.
- **Onboarding do síndico.** Um passo a passo guiado na primeira vez que um administrador acessa o sistema (cadastrar condomínio, convidar moradores, configurar descontos do pódio) reduz a fricção inicial.

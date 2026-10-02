# Melhorias recomendadas para o EcoCondo

Este documento reúne sugestões de evolução do sistema. Os itens marcados com ✅ já foram implementados (ver `TCC_EcoCondo_Felipe_Rueda.docx`, Seção 5.25); os demais seguem como lista de referência para decidir prioridades depois, inclusive para a seção de "trabalhos futuros" do TCC.

## Já implementadas

- ✅ **Comprovação fotográfica da coleta.** Foto obrigatória ao concluir uma coleta, reaproveitando `server/storage.ts`.
- ✅ **Registro de aplicação do desconto.** Botão "marcar desconto como aplicado" no pódio, gravando data, percentual, observação e quem aplicou (`podio.marcarDescontoAplicado`). Substituído no PR #4 pelo registro de entrega dos prêmios do pódio ("Marcar prêmio como entregue", `podio.marcarPremioEntregue`).
- ✅ **Segunda aprovação para pesos muito altos.** Pesos sinalizados como suspeitos ficam com os pontos retidos até um segundo administrador aprovar ou rejeitar (`coletas.decidirAprovacaoPeso`).
- ✅ **Certificado trimestral de sustentabilidade em PDF**, por bloco, com equivalências ambientais (`certificados.gerarTrimestral`).
- ✅ **Meta pessoal do morador**, no mesmo padrão das metas por bloco (`metaPessoal.*`).
- ✅ **Métricas compartilháveis** (árvores poupadas, litros de água, CO2 evitado) no painel, na meta pessoal e nos certificados.
- ✅ **Relatório anual automático**, gerado e notificado a todos os administradores em janeiro (`scheduled/annualReport`).
- ~~Coleta recorrente por bloco e QR code por apartamento para registro manual~~: removidos na revisão da banca (setembro/2026). O sistema é de descarte, não de agendamento, e a administração não registra descartes.
- ✅ **Estação de pesagem no lugar do coletor**: o morador registra a reciclagem num tablet com balança, com travas antifraude e revisão do administrador (`estacao.*`, `estacoes.*`).
- ✅ **Pódio só com o top 3 para os moradores** e **prêmios configuráveis** no lugar do desconto na taxa condominial (`podio.*`).
- ✅ **Plano de melhorias da banca** (ver [BANCA.md](BANCA.md)):
  - **Extrato de pontos** (`movimentacoes_pontos`): cada entrada e saída com o saldo depois dela; a migração monta o extrato a partir do histórico e o painel avisa se algum saldo não fechar (`engajamento.extrato`).
  - **Reprovação com motivo** de coleta já concluída, com estorno dos pontos (`coletas.reprovar`); coleta concluída não é mais cancelada nem pesada de novo.
  - **Notificações** do morador e da administração em cada etapa (solicitação, código, pesagem, pontos, reprovação, estorno, resgate, estoque, cadastro, falha operacional), com abrir e marcar como lida.
  - **Auditoria com motivo**, valor anterior e novo em coletas, resgates, recompensas, cadastros, estação e comunicados, com exportação CSV.
  - **Modo demonstração da estação** (balança simulada): pesos rápidos, foto opcional, conferência antes de confirmar e QR do código.
  - **Painel** com mês atual × anterior, evolução de 6 meses, taxa de conclusão, pontos movimentados, top 3 e alertas; **relatórios** com pontos, resgates, reprovações e planilhas de coletas, pontos, resgates e auditoria.

- ✅ **Revisão da banca (setembro/2026)**, com as 24 anotações do orientador:
  - "Coleta" virou **descarte** em todas as telas; sem agendamento nem registro manual pelo administrador.
  - **Todo descarte pendente de aprovação**: o administrador confere a foto e o peso de cada tipo e aprova (pontos pela regra do tipo), reprova com motivo ou abre **auditoria** (furto, fraude), que termina regular ou irregular com punição em pontos (`coletas.aprovarVarios`, `coletas.abrirAuditoria`, `coletas.concluirAuditoria`).
  - **Estação guiada**: vários tipos no mesmo descarte, cor do saco de cada tipo, peso e foto por tipo, aviso de foto escura ou tremida, conferência e manual "Como usar".
  - **Regras por tipo**: peso mínimo e máximo e pontos por kg (`regrasDescarte.*`); **controle de pontos**: ajuste por morador e zerar todos para um novo ciclo (`pontos.*`).
  - **Login com e-mail e senha**, link de primeiro acesso e de recuperação, bloqueio após 5 senhas erradas (`auth.*`); **manual** do sistema e da estação, obrigatório no primeiro acesso.
  - **Pop-up** de cada notificação nova, que leva direto ao descarte, extrato ou resgate; **quem recebe cada aviso** por perfil (`preferenciasNotificacao.*`).
  - **Painel pessoal** do morador (quanto, que tipos, quando), também aberto pelo administrador para cada morador; **filtros** por bloco, nome, situação e período.
  - **Relatórios por bloco** com gráficos (comparação entre blocos, quilos por mês e tipo, situação dos descartes) e PDF do bloco.
  - **Guia com a cor do saco** de cada tipo; **QR do guia** menor e impresso sozinho; **modo escuro** no sistema e no tablet.

## Sugestões depois da revisão da banca

- **Envio real de e-mail** (SMTP ou serviço como Amazon SES/Resend) para o link de primeiro acesso, recuperação de senha e avisos importantes; hoje o link aparece na tela (modo demonstração) ou é enviado pelo síndico.
- **Aprovação em lote com amostragem**: em condomínios grandes, aprovar automaticamente descartes de moradores com bom histórico e mandar só uma amostra (e os alertas) para conferência.
- **Leitura automática do visor** na foto (OCR) para comparar com o peso digitado e já sinalizar divergências para a auditoria.
- **Relatório mensal por bloco enviado aos síndicos**, com o PDF anexado, e ranking entre blocos (sem expor moradores).
- **Contestação pelo morador**: um botão para responder a uma reprovação ou auditoria direto no sistema, com o histórico da conversa na própria auditoria.

## Reciclagem, pódio e antifraude

- **Histórico de pódios encerrados.** Guardar um retrato do ranking ao final de cada mês/semestre/ano, em vez de recalcular sempre por data corrente. Evita que o pódio de um período passado mude se dados forem corrigidos depois, e permite mostrar "campeões anteriores".
- **Notificação por e-mail real.** O sistema de notificações hoje é só interno (dentro do app, com pop-up). Enviar e-mail (ou WhatsApp) nos eventos importantes — descarte aprovado ou reprovado, pódio fechado, prêmio entregue — aumenta o engajamento sem depender do morador abrir o app.

## Segurança e confiabilidade

- **Limite de tentativas guardado no banco.** O login com senha já bloqueia um e-mail após 5 erros, mas o contador fica na memória do servidor (zera ao reiniciar e não vale entre várias instâncias); vale guardar no banco ou num Redis e limitar também por IP.
- **Backup automático do banco MySQL.** Um job agendado com `mysqldump` (ou o backup automático do serviço na nuvem) evita perda de dados.
- **CI automatizado.** Rodar `pnpm check` e `pnpm test` automaticamente a cada push (GitHub Actions) evita que uma quebra chegue à branch principal sem ser notada.
- **Testes end-to-end automatizados.** Hoje a verificação de UI é manual; um conjunto pequeno de testes Playwright cobrindo login, descarte na estação e aprovação evitaria regressões visuais/funcionais silenciosas.
- **Paginação nas listagens.** `pessoas.diretorio`, `coletas.listar`, `auditoria.listar` (parcialmente) e `engajamento.ranking` carregam tudo de uma vez. Em um condomínio grande isso cresce rápido; vale paginar.

## Operação e escala

- **Multi-condomínio de verdade.** Hoje o sistema assume implicitamente um condomínio "padrão" por instância (primeira linha da tabela `condominios`). Se o objetivo for oferecer o EcoCondo como SaaS para vários condomínios ao mesmo tempo, é preciso um fluxo de criação/seleção de condomínio e isolar dados por assinante.
- **Balança ligada ao tablet.** Uma balança com saída USB ou Bluetooth lendo o peso direto no tablet eliminaria a digitação do peso, a principal brecha que sobra na estação de pesagem. Transformar a tela `/estacao` em PWA em modo quiosque também ajudaria bastante nesse uso.
- **Observabilidade.** Logs estruturados e um serviço de rastreamento de erros (ex. Sentry) ajudariam a identificar problemas em produção sem depender de relatos manuais dos usuários.

## Experiência de uso

- **Acessibilidade.** Revisar contraste de cores, navegação por teclado e leitores de tela nas telas mais usadas (descartes, estação, pódio, pessoas).
- **Onboarding do síndico.** O manual já é obrigatório no primeiro acesso; um passo a passo guiado na primeira vez que um administrador acessa o sistema (cadastrar condomínio, convidar moradores, cadastrar a estação de pesagem, configurar prêmios do pódio) reduz a fricção inicial.

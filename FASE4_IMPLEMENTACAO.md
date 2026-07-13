# Fase 4 — Centro de Controle Operacional

## Diagnóstico anterior à implementação

O projeto já possuía autenticação por perfil, indicadores básicos, relatórios CSV, logs de auditoria, health check, reconciliação financeira, outbox do Google Sheets e timeline parcial. A auditoria encontrou as seguintes lacunas:

- indicadores executivos dispersos e sem uma visão única de receita, conversão, lotes, marketing e atletas;
- ausência de ciclo de vida operacional para alertas (aberto, reconhecido e resolvido);
- monitoramento sem visão consolidada dos serviços e do processo Node;
- timeline formada por blocos separados, sem normalização cronológica;
- ausência de atribuição UTM na inscrição;
- exportação limitada a CSV;
- planilha limitada a Inscrições, Pagamentos, Camisas e Check-in;
- consultas analíticas sem índices específicos.

As regras de confirmação financeira, idempotência, reconciliação e controle de capacidade foram preservadas.

## Arquitetura implementada

### Inteligência operacional centralizada

`server/operational-intelligence.ts` consolida os cálculos do Dashboard Executivo, agregações financeiras, conversão, ocupação dos lotes, marketing, perfil dos atletas, detecção de inconsistências e timeline de inscrição.

### Dashboard Executivo

Nova área protegida para Administrador e Financeiro com:

- receita bruta, líquida estimada, hoje, sete dias, evento e ticket médio;
- inscrições por status e conversão;
- checkouts criados, pagos e abandono;
- capacidade, confirmadas, reservas temporárias, disponíveis e ocupação por lote;
- níveis visuais normal, amarelo (80%), vermelho (95%) e bloqueado (100%);
- receita por dia, hora, lote, distância, cidade, sexo e acumulada;
- origens, campanhas, atletas, mapa de calor por cidade, idade e camisa;
- últimos pagamentos, confirmações e webhooks.

A receita líquida é estimada somente quando `PAYMENT_FEE_PERCENT` e/ou `PAYMENT_FEE_FIXED_CENTS` forem configuradas.

### Central de Alertas

Alertas persistentes, deduplicados e auditáveis para falhas de webhook, InfinitePay, Resend, API, Google Sheets, pagamentos órfãos ou duplicados, inscrições sem pagamento, pagamentos manuais, divergência de receita, checkout expirado e capacidade dos lotes. Cada alerta possui gravidade, origem, horário, responsável, status e resolução.

### Timeline

A ficha da inscrição passa a exibir uma timeline cronológica única com criação, checkout, PIX/webhooks, pagamento, confirmação, e-mail, Google Sheets, auditoria, entrega de kit e check-in, incluindo ator, origem e detalhes técnicos.

### Monitoramento

Nova área protegida com estados da API, banco/Supabase, InfinitePay, Resend, Google Sheets, webhook e Vercel, além de latências, memória, CPU, consultas e erros observados.

### Exportações

Relatórios filtrados por status, lote, distância, cidade, sexo, período e pagamento em CSV, Excel compatível e PDF multipágina.

### Google Sheets

A integração passa a manter as abas Inscrições, Financeiro, Lotes, Alertas, Check-in, Patrocínio, Emails enviados e Camisas. A fila continua sendo idempotente e não bloqueia o fluxo financeiro.

### Marketing

O formulário registra UTM source, medium, campaign, term e content, além de origem, referenciador e landing page. A primeira atribuição da sessão é preservada.

### Segurança e auditoria

Dashboard Executivo, Financeiro, Reconciliação, Alertas, Monitoramento, Auditoria e exportações financeiras exigem perfil Administrador ou Financeiro. Alterações em alertas registram usuário, perfil, sessão, IP, navegador, antes/depois e horário.

## Banco de dados

A migração `20260713_phase4_operational.sql` amplia de forma idempotente as projeções permitidas na outbox do Google Sheets e cria índices para status, datas, lotes, pagamentos, webhooks e auditoria. Nenhum registro financeiro ou de reconciliação é reclassificado.

## Evidências de validação

- `npm test`: 63 de 63 testes aprovados;
- `npm run lint`: TypeScript sem erros (`tsc --noEmit`);
- `npm run build`: build Vite de produção aprovado;
- migração `20260713_phase4_operational.sql`: aplicada com sucesso;
- verificação da Fase 2: 25 casos históricos continuam como `manual_review_required`, sem correção automática;
- capacidade validada: Lote 1 com 98 confirmadas e 2 disponíveis; nenhum lote excedido;
- rotas financeiras sem sessão retornam HTTP 401.

O projeto não possui ESLint configurado; o comando denominado `lint` executa a validação TypeScript. A validação visual automatizada por navegador não foi executada porque o controlador de navegador disponível na sessão não pôde ser carregado. O layout usa os breakpoints responsivos existentes e o build foi validado, mas a inspeção visual desktop/tablet/mobile deve integrar o smoke test do deploy.

## Operação e implantação

Antes do deploy, configurar as taxas do gateway quando a receita líquida real precisar ser exibida. A implantação em produção não faz parte desta alteração local e deve ser feita após a revisão funcional do painel com uma sessão de Administrador e de Financeiro.

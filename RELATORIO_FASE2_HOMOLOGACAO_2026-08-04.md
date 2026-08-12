# FUNPACE RUN — Relatório da Fase 2

Data: 2026-08-04  
Escopo: homologação isolada, correções P2 e preparação para Meta Test Events  
Branch local: `homolog/meta-consent-hardening`

## Resumo executivo

A implementação passou nas migrations, no E2E server-side de consentimento, na atribuição, no isolamento financeiro, na autenticação e execução do cron, e em toda a suíte local. As correções P2 foram aplicadas sem commit, push ou merge.

Dois testes de evidência não puderam ser fechados nesta execução:

1. não havia navegador integrado conectado, portanto Pixel/PageView, redirect visual e Purchase Browser não foram observados em um browser real;
2. não foi fornecido um novo `META_TEST_EVENT_CODE`, então não foi seguro criar deliberadamente eventos ausentes e permitir que o worker os enviasse à Meta. O reconciliador ficou validado por código/testes e o cron real executou em homologação sem candidatos.

Por isso, o veredito estrito desta rodada é **FASE 2 REPROVADA POR EVIDÊNCIA PENDENTE**, não por falha funcional encontrada.

## Ambiente validado

- Vercel project: `funpace-run-homolog` (`prj_V3x3W945LWmREFBuhOf493LpCq7B`).
- Supabase project ref: `tctbwjrdhpwxzwbcwcvy`.
- `APP_ENV=homologation`.
- `EXPECTED_DATABASE_PROJECT_REF=tctbwjrdhpwxzwbcwcvy`.
- Banco: Postgres saudável.
- Pagamentos externos, e-mail, Google Sheets e webhooks outbound: bloqueados por safeguard.
- Cron: habilitado exclusivamente no projeto de homologação.
- Nenhum projeto de produção de negócio foi alterado.

Health final: HTTP 200, `appEnvironment=homologation`, `databaseProjectRefConfigured=true`, `externalPaymentsAllowed=false`, `cronExecutionAllowed=true`.

## Migrations

Aplicadas somente no projeto de homologação:

- `20260803213000_phase1_meta_reliability.sql` como migration `20260804133004`;
- `20260803_phase1_meta_reliability.sql` como migration de paridade `20260804133022`.

Validação posterior:

- `run-registrations.meta_context`: `jsonb`, `NOT NULL`, default `{}`;
- constraint exige objeto JSON;
- outbox aceita estado `dead`;
- 7 inscrições e 10 eventos pré-existentes preservados após a aplicação;
- zero órfãos;
- zero `fbp`, `fbc` ou `fbclid` inventado em registros históricos;
- todos os 10 eventos históricos permaneceram `sent`.

## Consentimento

Inscrição sintética controlada: `17d927b5-45a3-4780-b08c-ee5d61fc2e10`.

### Sem consentimento

- inscrição criada como `pending_payment`;
- `completeRegistrationEventId=null`;
- zero evento Meta;
- zero checkout;
- `paymentProviderCalled=false`.

### Aceite

- endpoint de consentimento atualizou exatamente 1 inscrição;
- recuperação da inscrição não criou `CompleteRegistration` retroativo;
- banco registrou `marketing_consent=true`;
- `meta_context` continha apenas contexto autorizado: `fbp`, `fbc`, `fbclid`, IP, user-agent, source URL e timestamp;
- nenhum campo de PII cadastral foi incluído no contexto.

### Revogação

- endpoint atualizou exatamente 1 inscrição;
- banco passou para `marketing_consent=false`;
- `payload.meta.marketingConsent=false`;
- `meta_context={}`;
- zero evento Meta acionável;
- zero checkout e zero payment event.

### Falha/reload

Testes executáveis confirmaram:

- retry de erros de rede e 5xx com backoff limitado;
- falha persistente permanece explícita e para no máximo configurado;
- estado `syncing` é restaurado após reload;
- worker serializa a decisão final de consentimento antes do envio;
- revogação marca eventos não enviados como inelegíveis/dead e não altera eventos já enviados.

A observação do Pixel parando/inicializando em navegador real ficou pendente porque nenhum browser estava disponível na sessão.

## Parceiro e atribuição

Foi criado temporariamente o parceiro sintético `/p/phase2-teste`, usado no fluxo e depois inativado.

Evidências:

- sessão assinada do parceiro preservada até a inscrição;
- snapshot persistido com `partner_id`, nome, tipo e `partner_link=/p/phase2-teste`;
- cinco UTMs e `fbclid` são os únicos parâmetros de marketing propagáveis;
- parâmetro arbitrário é descartado;
- destino produzido pelos testes termina em `#register`;
- payload persistiu source/medium/campaign/fbclid e `firstTouch`/`lastTouch` coerentes.

Semântica P2:

- `firstTouch` é imutável em reload e navegação SPA;
- `lastTouch` só é substituído por uma nova entrada com parâmetro permitido;
- os campos legados espelham atomicamente `lastTouch`, sem mistura silenciosa.

## Meta context e Purchase

- `meta_context` pertence à inscrição, independentemente da outbox.
- A consulta do registro controlado confirmou contexto mesmo com zero eventos Meta associados.
- A recuperação de Purchase usa `registration.meta_context`, e não depende da existência prévia de CompleteRegistration ou InitiateCheckout; isto foi validado pelos testes de integração estrutural.
- Purchase Server exige inscrição e pagamento `paid`, `paid_at`, consentimento atual e consentimento anterior ao pagamento.
- Purchase Browser exige confirmação server-side, cookie assinado do mesmo navegador, janela de 24 horas e usa `purchase_{registrationId}`.
- Resposta de status usa `Cache-Control: private, no-store`.
- Pending, browser diferente, reload duplicado e janela expirada foram rejeitados nos testes.

Não foi criado Purchase sintético nem realizado pagamento externo.

## Reconciliador e outbox

Estado remoto final da outbox Meta:

- `sent`: 10;
- CompleteRegistration: 5;
- InitiateCheckout: 5;
- duplicidade por `event_id`: zero;
- eventos da inscrição sintética: zero.

Os testes confirmam:

- IDs determinísticos `complete_registration_{registrationId}` e `initiate_checkout_{registrationId}`;
- `ON CONFLICT`/unicidade autoritativa;
- segunda reconciliação idempotente;
- Purchase recupera contexto diretamente da inscrição.

O cron real executou o reconciliador, mas não havia candidatos elegíveis: recuperados 0/0/0, processados 0, enviados 0, falhas 0. Não foram fabricados candidatos com consentimento ativo porque isso permitiria envio com o código antigo de Test Events, expressamente proibido.

## Worker e cron

- declaração: `/api/cron/meta`, `*/5 * * * *`;
- sem Authorization: 401;
- bearer inválido: 401;
- secret correto: 200;
- valor do secret nunca foi exibido;
- execução autorizada inicial: `processed=0`, `sent=0`, `failed=0`, `cleanedContexts=2`;
- execuções naturais observadas às 14:40:42 e 14:45:42 UTC, uma por intervalo, HTTP 200;
- deployment: `dpl_AzDrWMaX3K1Y45r9mU3nQ9WB2uMv`;
- nenhum runtime error agrupado nas últimas 24 horas.

Os testes cobrem `pending -> processing -> sent`, retry, backoff, limite de tentativas, `dead`, `FOR UPDATE SKIP LOCKED`, concorrência e idempotência. A transição externa controlada até a Meta aguarda um novo Test Event Code.

## Correções P2

1. `META_TEST_EVENT_CODE` é ignorado explicitamente quando `APP_ENV=production`; homologação continua aceitando valor fornecido por variável, sem hardcode.
2. Atribuição formalizada em first-touch/last-touch, preservando compatibilidade dos relatórios.
3. Request de inscrição marcado como sensível nos diagnósticos do frontend.
4. `athleteEmail` redundante removido da metadata InfinitePay; o e-mail obrigatório permanece no objeto de cliente.
5. Bootstrap administrativo não imprime e-mail.
6. Política de retenção documentada em `docs/META_PHASE2_DATA_POLICY.md`; nenhum expurgo executado.
7. Rota dedicada `api/cron/meta.ts` adicionada para publicar corretamente o endpoint serverless.

## Testes e qualidade

- Fase 1: 156/156.
- Fase 2: 162/162, 0 falhas.
- Testes críticos selecionados: 49/49.
- TypeScript/lint: aprovado.
- Build Vite: aprovado.
- `git diff --check`: aprovado; somente avisos de normalização LF/CRLF.
- Varredura das linhas adicionadas: zero Meta token longo, JWT, private key, bearer literal ou Test Event Code hardcoded.
- Nenhum commit, push ou merge realizado.

## Limpeza da homologação

- inscrição sintética: expirada;
- pagamento sintético: expirado, sem checkout;
- payment events: zero;
- eventos Meta: zero;
- parceiro sintético: inativado;
- reservas temporárias finais: zero.

## Pendências

### Bloqueadores de evidência

1. Repetir cenários A/B/C e Purchase Browser com navegador integrado conectado, observando Pixel, PageView, network e deduplicação.
2. Fornecer um novo `META_TEST_EVENT_CODE` e executar candidatos controlados ausentes para comprovar no runtime: reconciliador -> outbox -> worker -> Meta Test Events, inclusive retry/dead por fault injection seguro.

### Melhorias não bloqueantes

- Automatizar um harness E2E com banco efêmero/mocks de Graph API para validar as transições remotas sem depender do Meta Events Manager.
- Transformar a recomendação de retenção em runbook aprovado antes de qualquer expurgo.

## Veredito

**FASE 2 REPROVADA POR EVIDÊNCIA PENDENTE**

Banco, migrations, API de consentimento, atribuição, outbox histórica e cron estão saudáveis em homologação. A reprovação estrita decorre exclusivamente da ausência de prova visual Browser e da proibição correta de reutilizar o código antigo do Meta Test Events; não foi encontrada regressão funcional, financeira ou de segurança.

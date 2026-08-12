# Ambiente de homologação

O projeto Vercel `funpace-run-homolog` é separado do projeto de produção e deve
usar exclusivamente o Supabase `funpace-run-homolog`.

## Proteções obrigatórias

- `APP_ENV=homologation`
- `EXPECTED_DATABASE_PROJECT_REF` deve identificar o Supabase de homologação.
- A API aborta a inicialização se `DATABASE_URL` não pertencer ao project ref
  esperado.
- Pagamentos, e-mail, Google Sheets, cron e webhooks externos são bloqueados por
  padrão.
- `META_CAPI_ENABLED=false` deve permanecer assim até os secrets Meta serem
  configurados e verificados.
- `DATABASE_AUTO_MIGRATE=false` impede migrations implícitas no runtime.

Ativar uma integração externa em homologação exige a flag geral e um segundo
opt-in específico de homologação. Não reutilize credenciais ou destinos de
produção.

### Estados financeiros suportados

| Estado | Criacao de checkout | Webhook / `payment_check` |
| --- | --- | --- |
| Normal | `PAYMENT_CREATION_ENABLED=true` | `PAYMENT_CONFIRMATION_ENABLED=true` |
| Novas vendas bloqueadas | `PAYMENT_CREATION_ENABLED=false` | `PAYMENT_CONFIRMATION_ENABLED=true` |
| Bloqueio financeiro emergencial | `PAYMENT_CREATION_ENABLED=false` | `PAYMENT_CONFIRMATION_ENABLED=false` |

Em homologacao, cada capacidade tambem exige o respectivo opt-in
`HOMOLOGATION_PAYMENT_*_ENABLED`. As flags dedicadas prevalecem sobre
`PAYMENTS_ENABLED` e `HOMOLOGATION_PAYMENTS_ENABLED`; as flags legadas sao
usadas somente quando a correspondente flag dedicada estiver ausente.

Nao habilite criacao com confirmacao desabilitada: isso produz uma cobranca que
nao pode ser confirmada enquanto o bloqueio emergencial estiver ativo.

## Inventário de variáveis

| Grupo | Variável | Classificação | Homologação |
| --- | --- | --- | --- |
| Ambiente | `APP_ENV` | server-side, compartilhável | `homologation` |
| Banco | `DATABASE_URL` | secret, precisa valor de homologação | Supabase homolog |
| Banco | `EXPECTED_DATABASE_PROJECT_REF` | server-side, precisa valor de homologação | project ref homolog |
| Banco | `DATABASE_PROVIDER` | server-side, compartilhável | `postgres` |
| Banco | `DATABASE_SSL` | server-side, compartilhável | `true` |
| Banco | `DATABASE_POOL_MAX` | server-side, compartilhável | limite conservador |
| Banco | `DATABASE_AUTO_MIGRATE` | server-side | `false` |
| URLs | `APP_URL` | pública, precisa valor de homologação | URL homolog |
| URLs | `API_PUBLIC_URL` | pública, precisa valor de homologação | URL homolog |
| URLs | `VITE_API_URL` | pública, precisa valor de homologação | URL homolog |
| URLs | `VITE_PUBLIC_SITE_URL` | pública, precisa valor de homologação | URL homolog |
| URLs | `ALLOWED_ORIGINS` | server-side, precisa valor de homologação | homolog e localhost |
| Meta | `VITE_META_PIXEL_ID` | pública, compartilhável | configurada |
| Meta | `VITE_META_PIXEL_REQUIRE_CONSENT` | pública, compartilhável | configurada |
| Meta | `META_CAPI_ENABLED` | server-side | `false` |
| Meta | `META_PIXEL_ID` | server-side, compartilhável | configurada |
| Meta | `META_CONVERSIONS_API_TOKEN` | secret | pendente |
| Meta | `META_GRAPH_API_VERSION` | server-side | pendente |
| Meta | `META_DATASET_QUALITY_TOKEN` | secret | pendente |
| Meta | `META_TEST_EVENT_CODE` | secret, homologação-específica | pendente |
| Meta | `META_CAPI_TIMEOUT_MS` | server-side, compartilhável | configurada |
| Meta | `META_CAPI_MAX_ATTEMPTS` | server-side, compartilhável | configurada |
| Pagamento | `PAYMENTS_ENABLED` | server-side | `false` |
| Pagamento | `HOMOLOGATION_PAYMENTS_ENABLED` | server-side | `false` |
| Pagamento | `PAYMENT_CREATION_ENABLED` | server-side, prevalece sobre a flag legada | `false` |
| Pagamento | `HOMOLOGATION_PAYMENT_CREATION_ENABLED` | server-side, opt-in de homologacao | `false` |
| Pagamento | `PAYMENT_CONFIRMATION_ENABLED` | server-side, webhooks e `payment_check` | `true` para cobrancas existentes |
| Pagamento | `HOMOLOGATION_PAYMENT_CONFIRMATION_ENABLED` | server-side, opt-in de homologacao | `true` para cobrancas existentes |
| Pagamento | `PAYMENT_PROVIDER` | produção-específica | ausente |
| Pagamento | `INFINITEPAY_HANDLE` | produção-específica | ausente |
| Pagamento | `INFINITIPAY_HANDLE` | legado, produção-específica | ausente |
| Pagamento | `INFINITEPAY_TIMEOUT_MS` | server-side, compartilhável | opcional |
| Pagamento | `PAYMENT_WEBHOOK_SECRET` | secret, produção-específica | ausente |
| Pagamento | `PENDING_PAYMENT_TTL_MINUTES` | server-side, compartilhável | opcional |
| E-mail | `EMAIL_ENABLED` | server-side | `false` |
| E-mail | `HOMOLOGATION_EMAIL_ALLOWLIST` | server-side | ausente enquanto desativado |
| E-mail | `EMAIL_PROVIDER` | produção-específica | ausente |
| E-mail | `RESEND_API_KEY` | secret, produção-específica | ausente |
| E-mail | `EMAIL_FROM` | produção-específica | ausente |
| E-mail | `EMAIL_REPLY_TO` | produção-específica | ausente |
| Sheets | `GOOGLE_SHEETS_ENABLED` | server-side | `false` |
| Sheets | `HOMOLOGATION_GOOGLE_SHEETS_ENABLED` | server-side | `false` |
| Sheets | `GOOGLE_SHEETS_SPREADSHEET_ID` | produção-específica | ausente |
| Sheets | `GOOGLE_SERVICE_ACCOUNT_EMAIL` | secret | ausente |
| Sheets | `GOOGLE_PRIVATE_KEY` | secret | ausente |
| Cron | `CRON_ENABLED` | server-side | `false` |
| Cron | `HOMOLOGATION_CRON_ENABLED` | server-side | `false` |
| Cron | `CRON_SECRET` | secret, produção-específica | ausente |
| Webhooks | `OUTBOUND_WEBHOOKS_ENABLED` | server-side | `false` |
| Webhooks | `HOMOLOGATION_OUTBOUND_WEBHOOKS_ENABLED` | server-side | `false` |
| Webhooks | `PARTNERSHIP_WEBHOOK_URL` | produção-específica | ausente |
| Admin | `ADMIN_SESSION_SECRET` | secret, precisa valor próprio | pendente |
| Admin | `PARTNER_SESSION_SECRET` | secret, precisa valor próprio | pendente |
| Admin | `ADMIN_API_KEY` | secret/legado | não usar valor padrão |

As variáveis `DIRECT_URL`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL`,
`POSTGRES_URL_NON_POOLING`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL` e
`VITE_SUPABASE_ANON_KEY` não são usadas pelo código atual e não devem ser
inventadas.

## Checkpoint manual

Antes do primeiro deploy, adicione `DATABASE_URL` do Supabase homologado ao
projeto Vercel homologado. Depois, configure no painel da Vercel a Production
Branch desse projeto como `homolog/meta-capi`.

Os secrets Meta devem ser adicionados apenas depois do primeiro smoke test:

- `META_CONVERSIONS_API_TOKEN`
- `META_GRAPH_API_VERSION`
- `META_DATASET_QUALITY_TOKEN`
- `META_TEST_EVENT_CODE`

Somente após validar presença e escopo altere `META_CAPI_ENABLED=true`.

## Executor canônico de migrations

O pipeline operacional canônico deste projeto usa somente os arquivos de
`server/migrations` por meio de `npm run db:migrate`. Os arquivos equivalentes
em `supabase/migrations` são espelhos para inspeção e compatibilidade com o
ecossistema Supabase; eles não devem ser aplicados novamente quando a migration
canônica já estiver registrada em `run-schema-migrations`.

O executor não carrega `.env` automaticamente e aplica exatamente uma migration
por execução. Antes de executá-lo, forneça as variáveis pelo mecanismo seguro do
ambiente e defina explicitamente:

- `APP_ENV` (`homologation` ou `production`);
- `EXPECTED_DATABASE_PROJECT_REF`;
- `DATABASE_URL` pertencente ao mesmo project ref;
- `MIGRATION_NAME`, contendo apenas o nome do arquivo em `server/migrations`.

Para o cupom desta fase, use somente:

`MIGRATION_NAME=20260810_add_registration_coupon_snapshot.sql`

Em homologação, o executor aceita exclusivamente o project ref
`tctbwjrdhpwxzwbcwcvy` e bloqueia explicitamente o project ref de produção
`jypmwutwexpxjlaqwjvb`. A validação ocorre antes da construção do cliente do
banco e é repetida, por consulta somente leitura, após a conexão. Se a identidade
do destino não puder ser provada, nenhuma tabela de controle ou DDL é executado.

# FunPace Run

Landing page oficial do FunPace Run 2026, criada para apresentar a corrida, comunicar a oferta de inscricao e preparar o fluxo de venda online.

Contato oficial: funpacerunclub@gmail.com
Instagram oficial: https://www.instagram.com/fun__pace/

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment example and fill production values when needed:

   ```bash
   cp .env.example .env.local
   ```

3. Run the app:

   ```bash
   npm run dev
   ```

4. In another terminal, run the local registration API:

   ```bash
   npm run api
   ```

The local API stores development data in `data/funpace-db.json` while `DATABASE_PROVIDER="json"`.
For Supabase/Postgres, run `server/supabase-schema.sql` in the Supabase SQL editor and set:

```bash
DATABASE_PROVIDER="supabase"
DATABASE_URL="postgresql://postgres.PROJECT_REF:SENHA@aws-0-REGION.pooler.supabase.com:6543/postgres"
DATABASE_SSL="true"
```

The table names are quoted and start with `run-`, for example `"run-registrations"`.

## Admin Panel

Open `/admin` in the app and use `ADMIN_API_KEY` from your environment. The local default is `change-me`; replace it before any shared environment.

The panel can list registrations, filter by status, lot and distance, show sales metrics, and export CSV.

## InfinitePay Checkout

Set these variables before enabling real sales:

```bash
PAYMENT_PROVIDER="infinitepay"
INFINITEPAY_HANDLE="sua-infinite-tag-sem-cifrao"
APP_URL="https://funpace.club"
API_PUBLIC_URL="https://funpace.club"
PAYMENT_WEBHOOK_SECRET="um-token-forte"
PENDING_PAYMENT_TTL_MINUTES="30"
```

The registration API sends `POST https://api.checkout.infinitepay.io/links` with `handle`, `items`, `order_nsu`, `redirect_url`, `webhook_url` and `customer`.

`order_nsu` is the local `registrationId`. InfinitePay returns the buyer to `/sucesso`, and the webhook should call:

```text
https://funpace.club/api/webhooks/payment?token=PAYMENT_WEBHOOK_SECRET
```

The webhook payload is matched by `order_nsu`; the API validates the amount and marks the registration as `paid` when InfinitePay sends `paid: true`.

Pending registrations expire after `PENDING_PAYMENT_TTL_MINUTES`. When a pending registration expires, its lot capacity is released and the registration/payment status becomes `expired`.

## Transactional Email

Automatic registration emails run only in the backend. No provider key is exposed to the front-end.

```bash
EMAIL_PROVIDER="resend"
RESEND_API_KEY="re_..."
EMAIL_FROM="FunPace Run <inscricoes@funpace.club>"
EMAIL_REPLY_TO="funpacerunclub@gmail.com"
NEXT_PUBLIC_SITE_URL="https://funpace.club"
```

Use `EMAIL_PROVIDER="console"` locally to log email attempts without sending. The API sends a single registration confirmation email only after the payment webhook or verified gateway return marks the registration as `paid`.

## Google Sheets operational copy

Google Sheets is an optional backend-only operational copy. Supabase remains the source of truth, and disabling or misconfiguring Sheets must not interrupt registrations or payments.

```bash
GOOGLE_SHEETS_ENABLED="false"
GOOGLE_SHEETS_SPREADSHEET_ID=""
GOOGLE_SERVICE_ACCOUNT_EMAIL=""
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n"
```

Enable the Google Sheets API in Google Cloud, create a dedicated Service Account, and share the spreadsheet with its e-mail as Editor. Store the private key only in backend environment variables. On Vercel, keep it on one line using escaped `\\n` line breaks. Never use a `VITE_` prefix or commit the Service Account JSON file.

Use the isolated migration and homologation checklist in `GOOGLE_SHEETS_SETUP.md`; do not rerun the complete seed schema on a populated production database.

## Local Backup

```bash
npm run backup:db
```

See `PRODUCAO.md` for the security, LGPD, backup and performance checklist.

## Production Readiness

See `PLANO.md` for the launch checklist, checkout requirements, database model, admin panel scope and security roadmap.

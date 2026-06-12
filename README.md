# FunPace Run

Landing page oficial do FunPace Run 2026, criada para apresentar a corrida, comunicar a oferta de inscricao e preparar o fluxo de venda online.

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

The local API stores development data in `data/funpace-db.json`. This file is a development persistence layer only; production should use a managed database such as Postgres.

## Admin Panel

Open `/admin` in the app and use `ADMIN_API_KEY` from your environment. The local default is `change-me`; replace it before any shared environment.

The panel can list registrations, filter by status, lot and distance, show sales metrics, and export CSV.

## InfinitePay Checkout

Set these variables before enabling real sales:

```bash
PAYMENT_PROVIDER="infinitepay"
INFINITEPAY_HANDLE="sua-infinite-tag-sem-cifrao"
APP_URL="https://funpace-run.vercel.app"
API_PUBLIC_URL="https://funpace-run.vercel.app"
PAYMENT_WEBHOOK_SECRET="um-token-forte"
```

The registration API sends `POST https://api.checkout.infinitepay.io/links` with `handle`, `items`, `order_nsu`, `redirect_url`, `webhook_url` and `customer`.

`order_nsu` is the local `registrationId`. InfinitePay returns the buyer to `/sucesso`, and the webhook should call:

```text
https://funpace-run.vercel.app/api/webhooks/payment?token=PAYMENT_WEBHOOK_SECRET
```

The webhook payload is matched by `order_nsu`; the API validates the amount and marks the registration as `paid` when InfinitePay sends `paid: true`.

## Local Backup

```bash
npm run backup:db
```

See `PRODUCAO.md` for the security, LGPD, backup and performance checklist.

## Production Readiness

See `PLANO.md` for the launch checklist, checkout requirements, database model, admin panel scope and security roadmap.

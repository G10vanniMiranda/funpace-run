import { existsSync, readFileSync } from 'node:fs';
import pg from 'pg';

function loadDotEnv(path = '.env') {
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadDotEnv();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL nao encontrada no ambiente nem no .env.');
}

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: (process.env.DATABASE_SSL || 'true') !== 'false'
    ? { rejectUnauthorized: false }
    : false,
});

const staleWhere = `
  registration.status = 'pending_payment'
  and (
    lot.status <> 'active'
    or registration.amount_cents <> lot.price_cents
    or payment.amount_cents <> lot.price_cents
  )
`;

await client.connect();

try {
  await client.query('begin');

  const before = await client.query(`
    select
      registration.lot_id,
      lot.name as lot_name,
      lot.status as lot_status,
      lot.price_cents as lot_price_cents,
      registration.amount_cents as registration_amount_cents,
      payment.amount_cents as payment_amount_cents,
      count(*)::int as total,
      count(payment.checkout_url)::int as with_checkout
    from "run-registrations" registration
    join "run-lots" lot on lot.id = registration.lot_id
    left join "run-payments" payment on payment.registration_id = registration.id
    where ${staleWhere}
    group by registration.lot_id, lot.name, lot.status, lot.price_cents, registration.amount_cents, payment.amount_cents
    order by registration.lot_id, registration.amount_cents
  `);

  const staleRegistrations = await client.query(`
    select registration.id, registration.lot_id
    from "run-registrations" registration
    join "run-lots" lot on lot.id = registration.lot_id
    left join "run-payments" payment on payment.registration_id = registration.id
    where ${staleWhere}
    for update of registration
  `);

  const staleByLot = staleRegistrations.rows.reduce((accumulator, row) => {
    accumulator[row.lot_id] = (accumulator[row.lot_id] || 0) + 1;
    return accumulator;
  }, {});

  const now = new Date().toISOString();
  const staleIds = staleRegistrations.rows.map((row) => row.id);

  if (staleIds.length > 0) {
    await client.query(`
      update "run-registrations"
      set status = 'expired',
          updated_at = $1,
          expires_at = coalesce(expires_at, $1)
      where id = any($2::text[])
    `, [now, staleIds]);

    await client.query(`
      update "run-payments"
      set status = 'expired',
          checkout_url = null,
          provider_payment_id = null,
          updated_at = $1,
          expires_at = coalesce(expires_at, $1)
      where registration_id = any($2::text[])
    `, [now, staleIds]);

    for (const [lotId, total] of Object.entries(staleByLot)) {
      await client.query(`
        update "run-lots"
        set sold_count = greatest(sold_count - $1::int, 0)
        where id = $2
      `, [total, lotId]);
    }
  }

  const activeLots = await client.query(`
    select id, name, price_cents, sold_count, status
    from "run-lots"
    order by order_index asc, starts_at asc
  `);

  await client.query('commit');

  console.log(JSON.stringify({
    stalePendingBefore: before.rows,
    expiredRegistrations: staleIds.length,
    releasedByLot: staleByLot,
    lots: activeLots.rows,
  }, null, 2));
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  throw error;
} finally {
  await client.end();
}

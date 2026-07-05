import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import pg from 'pg';

function loadEnvFile(path) {
  if (!existsSync(path)) {
    return;
  }

  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');

    if (separatorIndex < 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!value && process.env[key]) {
      continue;
    }

    process.env[key] = value;
  }
}

loadEnvFile('.env');
loadEnvFile('.env.local');
loadEnvFile('.vercel/.env.production.local');

const mode = process.argv[2] || 'dry-run';
const apply = mode === 'apply';
const statusesToRelease = ['pending_payment', 'payment_failed', 'expired'];
const paidMode = process.argv.includes('--include-paid');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL nao configurado.');
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: (process.env.DATABASE_SSL || 'true') !== 'false' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 5000,
  query_timeout: 15000,
});

const client = await pool.connect();

try {
  const before = await client.query(`
    select status, count(*)::int as count
    from "run-registrations"
    group by status
    order by status
  `);

  const releasable = await client.query(`
    select registration.id, registration.status, registration.lot_id, payment.id as payment_id, payment.status as payment_status
    from "run-registrations" registration
    left join "run-payments" payment on payment.registration_id = registration.id
    where registration.status = any($1)
       or ($2 = true and registration.status = 'paid')
    order by registration.created_at asc
  `, [statusesToRelease, paidMode]);

  if (!apply) {
    console.log(JSON.stringify({
      mode,
      before: before.rows,
      releasableCount: releasable.rowCount,
      includePaid: paidMode,
    }, null, 2));
    process.exit(0);
  }

  await client.query('begin');
  await client.query(`set local lock_timeout = '5s'`);

  const now = new Date().toISOString();
  const lockedReleasable = await client.query(`
    select registration.id, registration.status, registration.lot_id, payment.id as payment_id, payment.status as payment_status
    from "run-registrations" registration
    left join "run-payments" payment on payment.registration_id = registration.id
    where registration.status = any($1)
       or ($2 = true and registration.status = 'paid')
    order by registration.created_at asc
    for update of registration skip locked
  `, [statusesToRelease, paidMode]);

  const updated = lockedReleasable.rowCount > 0
    ? await client.query(`
      update "run-registrations"
      set status = 'cancelled',
          updated_at = $1,
          expires_at = coalesce(expires_at, $1)
      where id = any($2)
      returning id, status, lot_id
    `, [now, lockedReleasable.rows.map((row) => row.id)])
    : { rows: [], rowCount: 0 };

  if (updated.rowCount > 0) {
    await client.query(`
      update "run-payments"
      set status = 'cancelled',
          updated_at = $1,
          expires_at = coalesce(expires_at, $1)
      where registration_id = any($2)
    `, [now, updated.rows.map((row) => row.id)]);
  }

  const releasedByLot = new Map();

  for (const row of lockedReleasable.rows) {
    if (row.status === 'pending_payment' || (paidMode && row.status === 'paid')) {
      releasedByLot.set(row.lot_id, (releasedByLot.get(row.lot_id) || 0) + 1);
    }
  }

  for (const [lotId, count] of releasedByLot.entries()) {
    await client.query(`
      update "run-lots"
      set sold_count = greatest(sold_count - $1, 0),
          status = case when status = 'sold_out' then 'active' else status end
      where id = $2
    `, [count, lotId]);
  }

  const activeByLot = await client.query(`
    select lot_id, count(*)::int as total
    from "run-registrations"
    where status in ('pending_payment', 'paid')
    group by lot_id
  `);

  for (const row of activeByLot.rows) {
    await client.query(`
      update "run-lots"
      set sold_count = $1,
          status = case when $1 >= capacity then 'sold_out' else 'active' end
      where id = $2
    `, [row.total, row.lot_id]);
  }

  for (const row of lockedReleasable.rows) {
    await client.query(`
      insert into "run-audit-logs" (id, actor, action, entity_type, entity_id, payload, created_at)
      values ($1, $2, $3, $4, $5, $6, $7)
    `, [
      randomUUID(),
      'admin',
      'registration.cancelled_for_retry',
      'registration',
      row.id,
      {
        previousStatus: row.status,
        previousPaymentStatus: row.payment_status || null,
        paymentId: row.payment_id || null,
        reason: 'Bulk release requested to allow checkout retry after payment-flow incident.',
      },
      now,
    ]);
  }

  await client.query('commit');

  const after = await client.query(`
    select status, count(*)::int as count
    from "run-registrations"
    group by status
    order by status
  `);
  const lots = await client.query(`
    select id, sold_count, capacity, status
    from "run-lots"
    order by id
  `);

  console.log(JSON.stringify({
    mode,
    cancelledCount: updated.rowCount,
    includePaid: paidMode,
    before: before.rows,
    after: after.rows,
    lots: lots.rows,
  }, null, 2));
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}

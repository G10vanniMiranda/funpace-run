import { existsSync, readFileSync } from 'node:fs';
import pg from 'pg';

if (existsSync('.env')) for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!match || process.env[match[1]]) continue;
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  process.env[match[1]] = value;
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const lots = await client.query(`
    select lot.id, lot.name, lot.capacity as capacity_total, lot.sold_count as stored_confirmed,
      count(registration.id) filter (where registration.status = 'paid')::int as confirmed,
      count(registration.id) filter (where registration.status = 'pending_payment' and (registration.expires_at is null or registration.expires_at::timestamptz > now()))::int as temporary_reservations,
      greatest(lot.capacity - count(registration.id) filter (where registration.status = 'paid' or (registration.status = 'pending_payment' and (registration.expires_at is null or registration.expires_at::timestamptz > now())))::int, 0) as available
    from "run-lots" lot left join "run-registrations" registration on registration.lot_id = lot.id
    group by lot.id, lot.name, lot.capacity, lot.sold_count, lot.order_index order by lot.order_index
  `);
  const reconciliation = await client.query(`
    select resolution_status, count(*)::int total from "run-payment-reconciliations"
    group by resolution_status order by resolution_status
  `);
  const registrationStatuses = await client.query('select status, count(*)::int total from "run-registrations" group by status order by status');
  const lastRun = await client.query('select mode, checked_count, corrected_count, manual_review_count, error_count, started_at from "run-reconciliation-runs" order by started_at desc limit 1');
  console.log(JSON.stringify({ registrationStatuses: registrationStatuses.rows, lots: lots.rows, reconciliation: reconciliation.rows, lastRun: lastRun.rows[0] }, null, 2));
} finally { await client.end(); }

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
  const status = await client.query('select status, count(*)::int total from "run-registrations" group by status order by status');
  const candidates = await client.query(`
    select registration.id, registration.created_at, registration.paid_at,
           payment.gateway_transaction_id, payment.provider_payment_id, payment.gateway_status,
           payment.gateway_payload is not null as has_gateway_payload,
           coalesce((select string_agg(distinct event.event_type, ',') from "run-payment-events" event where event.payment_id = payment.id), '') as event_types,
           coalesce((select string_agg(distinct audit.action, ',') from "run-audit-logs" audit where audit.entity_id = registration.id), '') as audit_actions
    from "run-registrations" registration
    join "run-payments" payment on payment.registration_id = registration.id
    where registration.status = 'paid'
      and (payment.gateway_transaction_id is null or payment.gateway_transaction_id = '' or payment.gateway_transaction_id like 'manual%')
    order by registration.paid_at, registration.id
  `);
  console.log(JSON.stringify({ status: status.rows, candidates: candidates.rows }, null, 2));
} finally { await client.end(); }

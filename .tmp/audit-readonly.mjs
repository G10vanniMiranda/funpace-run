import { loadEnvFile } from 'node:process';
import pg from 'pg';
import { writeFileSync } from 'node:fs';

loadEnvFile('.env');
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: String(process.env.DATABASE_SSL).toLowerCase() === 'false' ? false : { rejectUnauthorized: false },
});
const client = await pool.connect();
const q = (text, values = []) => client.query(text, values).then((r) => r.rows);
const maskCpf = (value = '') => {
  const d = String(value).replace(/\D/g, '');
  return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : '***';
};

try {
  await client.query('begin read only');
  const registrations = await q(`
    select r.*, e.name event_name, d.name distance_name, l.name lot_name, l.price_cents lot_price_cents,
           p.id payment_id, p.provider, p.status payment_status, p.amount_cents payment_amount_cents,
           p.provider_payment_id, p.created_at payment_created_at, p.updated_at payment_updated_at,
           p.expires_at payment_expires_at, p.paid_at payment_paid_at, p.gateway_status,
           p.gateway_transaction_id, p.gateway_payload
    from "run-registrations" r
    left join "run-events" e on e.id=r.event_id
    left join "run-distances" d on d.id=r.distance_id
    left join "run-lots" l on l.id=r.lot_id
    left join "run-payments" p on p.registration_id=r.id
    order by r.created_at`);
  const events = await q(`select * from "run-payment-events" order by received_at`);
  const logs = await q(`select * from "run-audit-logs" order by created_at`);
  const lots = await q(`select * from "run-lots" order by event_id, order_index`);
  const distances = await q(`select * from "run-distances" order by event_id, distance_km`);
  const fk = await q(`select conname, conrelid::regclass::text table_name, pg_get_constraintdef(oid) definition from pg_constraint where contype='f' and conrelid::regclass::text like '%run-%' order by 2,1`);
  const invalidFk = await q(`
    select 'payment_registration' kind, count(*)::int total from "run-payments" p left join "run-registrations" r on r.id=p.registration_id where r.id is null
    union all select 'registration_event', count(*)::int from "run-registrations" r left join "run-events" e on e.id=r.event_id where e.id is null
    union all select 'registration_distance', count(*)::int from "run-registrations" r left join "run-distances" d on d.id=r.distance_id where d.id is null
    union all select 'registration_lot', count(*)::int from "run-registrations" r left join "run-lots" l on l.id=r.lot_id where l.id is null
    union all select 'payment_event_payment', count(*)::int from "run-payment-events" pe left join "run-payments" p on p.id=pe.payment_id where p.id is null`);

  const byStatus = Object.fromEntries((await q(`select status, count(*)::int total from "run-registrations" group by status order by status`)).map(x => [x.status, x.total]));
  const paymentByStatus = Object.fromEntries((await q(`select status, count(*)::int total from "run-payments" group by status order by status`)).map(x => [x.status, x.total]));
  const dup = await q(`
    select 'cpf_hash' kind, cpf_hash value, count(*)::int total, array_agg(id order by created_at) ids from "run-registrations" group by cpf_hash having count(*)>1
    union all select 'gateway_transaction_id', gateway_transaction_id, count(*)::int, array_agg(id order by created_at) from "run-payments" where gateway_transaction_id is not null group by gateway_transaction_id having count(*)>1
    union all select 'provider_payment_id', provider_payment_id, count(*)::int, array_agg(id order by created_at) from "run-payments" where provider_payment_id is not null group by provider_payment_id having count(*)>1`);
  const paymentsWithoutRegistration = (await q(`select count(*)::int total from "run-payments" p left join "run-registrations" r on r.id=p.registration_id where r.id is null`))[0].total;
  const registrationsWithoutPayment = (await q(`select count(*)::int total from "run-registrations" r left join "run-payments" p on p.registration_id=r.id where p.id is null`))[0].total;
  const nulls = await q(`select
    count(*) filter(where payload->>'fullName' is null or btrim(payload->>'fullName')='')::int full_name,
    count(*) filter(where payload->>'cpf' is null or btrim(payload->>'cpf')='')::int cpf,
    count(*) filter(where payload->>'email' is null or btrim(payload->>'email')='')::int email,
    count(*) filter(where payload->>'phone' is null or btrim(payload->>'phone')='')::int phone,
    count(*) filter(where payload->>'gender' is null or btrim(payload->>'gender')='')::int gender,
    count(*) filter(where payload->>'shirtSize' is null or btrim(payload->>'shirtSize')='')::int shirt,
    count(*) filter(where paid_at is null and status='paid')::int paid_without_paid_at,
    count(*) filter(where confirmed_at is null and status='paid')::int paid_without_confirmed_at
    from "run-registrations"`);
  const inconsistencies = await q(`select
    count(*) filter(where r.status <> p.status)::int status_mismatch,
    count(*) filter(where r.amount_cents <> p.amount_cents)::int amount_mismatch,
    count(*) filter(where r.status='paid' and p.status<>'paid')::int paid_registration_unpaid_payment,
    count(*) filter(where r.status<>'paid' and p.status='paid')::int unpaid_registration_paid_payment,
    count(*) filter(where r.status='expired' and (p.status='paid' or p.gateway_status ilike '%paid%'))::int expired_with_paid_payment,
    count(*) filter(where r.status='pending_payment' and (p.status='paid' or p.gateway_status ilike '%paid%'))::int pending_with_paid_payment,
    count(*) filter(where r.status='paid' and p.gateway_transaction_id is null)::int paid_without_transaction,
    count(*) filter(where r.status='paid' and p.gateway_payload is null)::int paid_without_gateway_payload
    from "run-registrations" r join "run-payments" p on p.registration_id=r.id`);

  const paid = registrations.filter(r => r.status === 'paid');
  const paidRows = paid.map((r) => {
    const webhookEvents = events.filter(e => e.payment_id === r.payment_id && e.event_type !== 'infinitepay.checkout_created');
    const emailLogs = logs.filter(l => l.entity_id === r.id && String(l.action).startsWith('email.confirmation.'));
    const attempted = emailLogs.filter(l => l.action === 'email.confirmation.attempted');
    const sent = emailLogs.filter(l => l.action === 'email.confirmation.sent');
    const failed = emailLogs.filter(l => l.action === 'email.confirmation.failed');
    return {
      registrationNumber: r.bib_number || r.id,
      fullName: r.payload?.fullName || '', cpf: maskCpf(r.payload?.cpf), email: r.payload?.email || '', whatsapp: r.payload?.phone || '',
      gender: r.payload?.gender || '', distance: r.distance_name || r.payload?.distance || '', lot: r.lot_name || r.lot_id,
      shirt: r.payload?.shirtSize || '', amountPaidCents: r.payment_amount_cents, paymentMethod: findMethod(r.gateway_payload) || r.gateway_status || null,
      registrationStatus: r.status, paymentStatus: r.payment_status, infinitePayTransactionId: r.gateway_transaction_id,
      createdAt: r.created_at, confirmedAt: r.confirmed_at, event: r.event_name || r.event_id, internalCode: r.id,
      webhookReceived: webhookEvents.length > 0, webhookAttemptsRecorded: webhookEvents.length,
      webhookFirstAt: webhookEvents[0]?.received_at || null, webhookLastAt: webhookEvents.at(-1)?.received_at || null,
      emailSent: Boolean(r.confirmation_email_sent_at), emailSentAt: r.confirmation_email_sent_at, emailProvider: r.confirmation_email_provider,
      emailId: r.confirmation_email_id, emailError: r.confirmation_email_error, emailAttemptsRecorded: attempted.length,
      emailSentLogs: sent.length, emailFailedLogs: failed.length,
    };
  });
  const groupSum = (key) => Object.values(paid.reduce((a,r) => { const k=key(r)||'Não informado'; a[k] ||= {count:0,revenueCents:0}; a[k].count++; a[k].revenueCents += Number(r.payment_amount_cents || 0); return a; },{}));
  const grouped = (key) => paid.reduce((a,r) => { const k=key(r)||'Não informado'; a[k] ||= {count:0,revenueCents:0}; a[k].count++; a[k].revenueCents += Number(r.payment_amount_cents || 0); return a; },{});
  const revenue = paid.reduce((s,r)=>s+Number(r.payment_amount_cents||0),0);
  const amounts = paid.map(r=>Number(r.payment_amount_cents||0)).sort((a,b)=>a-b);
  const adminFormula = {
    registrations: registrations.length,
    paid: paid.length,
    pending: registrations.filter(r=>r.status==='pending_payment').length,
    revenueCents: paid.reduce((s,r)=>s+Number(r.amount_cents||0),0),
  };
  const actualLotCounts = Object.fromEntries(lots.map(l => [l.id, registrations.filter(r=>r.lot_id===l.id && ['pending_payment','paid'].includes(r.status)).length]));
  const report = {
    auditedAt: new Date().toISOString(), summary: {total: registrations.length, byStatus, paymentByStatus, duplicates: dup.length, paymentsWithoutRegistration, registrationsWithoutPayment},
    nulls: nulls[0], inconsistencies: inconsistencies[0], duplicates: dup, foreignKeys: fk, invalidForeignKeys: invalidFk,
    lots: lots.map(l=>({id:l.id,name:l.name,priceCents:l.price_cents,capacity:l.capacity,storedSoldCount:l.sold_count,actualReservedCount:actualLotCounts[l.id],status:l.status})),
    distances: distances.map(d=>({id:d.id,name:d.name,capacity:d.capacity,status:d.status,total:registrations.filter(r=>r.distance_id===d.id).length,paid:paid.filter(r=>r.distance_id===d.id).length,pending:registrations.filter(r=>r.distance_id===d.id&&r.status==='pending_payment').length})),
    financial: {revenueCents:revenue,ticketAverageCents:paid.length?Math.round(revenue/paid.length):0,minCents:amounts[0]||0,maxCents:amounts.at(-1)||0,byLot:grouped(r=>r.lot_name||r.lot_id),byDistance:grouped(r=>r.distance_name||r.distance_id),byMethod:grouped(r=>findMethod(r.gateway_payload)||r.gateway_status)},
    adminFormula, paidRows,
  };
  writeFileSync('.tmp/audit-data.json', JSON.stringify(report,null,2));
  console.log(JSON.stringify({auditedAt:report.auditedAt,summary:report.summary,nulls:report.nulls,inconsistencies:report.inconsistencies,financial:report.financial,lots:report.lots,distances:report.distances,email:{sent:paidRows.filter(x=>x.emailSent).length,missing:paidRows.filter(x=>!x.emailSent).length,withErrors:paidRows.filter(x=>x.emailError).length,duplicateSentLogs:paidRows.filter(x=>x.emailSentLogs>1).length},webhooks:{received:paidRows.filter(x=>x.webhookReceived).length,missing:paidRows.filter(x=>!x.webhookReceived).length,multipleEvents:paidRows.filter(x=>x.webhookAttemptsRecorded>1).length}},null,2));
  await client.query('rollback');
} finally { client.release(); await pool.end(); }

function findMethod(value, depth=0) {
  if (!value || typeof value !== 'object' || depth > 4) return null;
  for (const key of ['payment_method','paymentMethod','method','payment_type','paymentType','capture_method']) if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
  for (const nested of Object.values(value)) { const found=findMethod(nested,depth+1); if(found) return found; }
  return null;
}

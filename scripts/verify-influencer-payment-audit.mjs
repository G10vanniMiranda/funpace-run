import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import pg from 'pg';

if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

assert.ok(process.env.DATABASE_URL, 'DATABASE_URL nao configurada.');
const { confirmPaymentInPostgres, cancelRegistrationInPostgres, expireTemporaryReservationsInPostgres, runPartnerConsistencyCheckInPostgres } = await import('../server/database.ts');
const database = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: (process.env.DATABASE_SSL || 'true') !== 'false' ? { rejectUnauthorized: false } : false });
const suffix = randomUUID().slice(0, 8);
const partnerId = randomUUID();
const registrationIds = [`i5-paid-${suffix}`, `i5-mismatch-${suffix}`, `i5-expired-${suffix}`];
const paymentIds = registrationIds.map(() => randomUUID());
const now = new Date();
let lotSnapshot;

await database.connect();
try {
  const source = readFileSync('server/index.ts', 'utf8');
  assert.match(source, /checkInfinitePayPayment[\s\S]*confirmPaymentInPostgres/);
  assert.match(source, /requireAdmin\(req, res, \['administrator', 'finance'\]\)/);

  const context = (await database.query(
    `select lot.id lot_id,lot.event_id,lot.sold_count,lot.status,distance.id distance_id,lot.price_cents
     from "run-lots" lot join "run-distances" distance on distance.event_id=lot.event_id
     where lot.status='active' order by lot.order_index,distance.id limit 1`,
  )).rows[0];
  assert.ok(context, 'Lote ativo para teste nao encontrado.');
  lotSnapshot = { id: context.lot_id, soldCount: context.sold_count, status: context.status };
  const originalPrice = Number(context.price_cents);
  const discountAmount = Math.round(originalPrice * 0.1);
  const finalPrice = originalPrice - discountAmount;
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 15 * 60_000).toISOString();

  await database.query(
    `insert into "run-partners" (id,name,slug,partner_type,discount_percentage,status,description,created_at,updated_at,deleted_at)
     values ($1,$2,$3,'influencer',10,'active',null,$4,$4,null)`,
    [partnerId, `I5 Influencer ${suffix}`, `i5-influencer-${suffix}`, createdAt],
  );

  for (let index = 0; index < registrationIds.length; index += 1) {
    const expired = index === 2;
    await database.query(
      `insert into "run-registrations" (id,event_id,distance_id,lot_id,cpf_hash,status,amount_cents,payload,created_at,updated_at,expires_at,partner_id,partner_name,partner_type,partner_link,partner_identified_at,discount_percentage,discount_amount,original_price,final_price)
       values ($1,$2,$3,$4,$5,'pending_payment',$6,$7,$8,$8,$9,$10,$11,'influencer',$12,$8,10,$13,$14,$6)`,
      [registrationIds[index], context.event_id, context.distance_id, context.lot_id, `i5-cpf-${suffix}-${index}`, finalPrice, { fullName: `Atleta I5 ${index}` }, createdAt, expired ? new Date(now.getTime() - 60_000).toISOString() : expiresAt, partnerId, `I5 Influencer ${suffix}`, `/p/i5-influencer-${suffix}`, discountAmount, originalPrice],
    );
    await database.query(
      `insert into "run-payments" (id,registration_id,provider,status,amount_cents,created_at,updated_at,expires_at)
       values ($1,$2,'infinitepay','pending_payment',$3,$4,$4,$5)`,
      [paymentIds[index], registrationIds[index], finalPrice, createdAt, expired ? new Date(now.getTime() - 60_000).toISOString() : expiresAt],
    );
    await database.query(
      `insert into "run-partner-audit-logs" (id,partner_id,action,registration_id,event_id,metadata,created_at)
       values ($1,$2,'registration.started',$3,$4,$5,$6)`,
      [randomUUID(), partnerId, registrationIds[index], context.event_id, { partnerType: 'influencer', partner_type: 'influencer', correlationId: `i5-correlation-${index}` }, createdAt],
    );
  }

  const confirmation = {
    registrationId: registrationIds[0], providerEventId: `i5-event-${suffix}`, providerPaymentId: `i5-slug-${suffix}`,
    providerTransactionId: `i5-transaction-${suffix}`, eventType: 'infinitepay.i5_verified', gatewayStatus: 'verified_paid',
    amountCents: finalPrice, payload: { test: true }, auditAction: 'payment.i5_verified',
  };
  const concurrent = await Promise.all([confirmPaymentInPostgres(confirmation), confirmPaymentInPostgres(confirmation)]);
  assert.equal(concurrent.filter((result) => result.duplicated).length, 1, 'Uma repeticao deve ser reconhecida como duplicada.');
  assert.equal(concurrent.filter((result) => !result.duplicated).length, 1, 'Somente uma confirmacao financeira deve ser efetivada.');

  const paid = (await database.query(
    `select r.status,r.partner_id,r.partner_name,r.partner_type,r.discount_percentage::float8,r.discount_amount,r.original_price,r.final_price,r.amount_cents,p.status payment_status,p.amount_cents payment_amount
     from "run-registrations" r join "run-payments" p on p.registration_id=r.id where r.id=$1`, [registrationIds[0]],
  )).rows[0];
  assert.equal(paid.status, 'paid');
  assert.equal(paid.payment_status, 'paid');
  assert.equal(paid.partner_type, 'influencer');
  assert.equal(paid.amount_cents, paid.final_price);
  assert.equal(paid.payment_amount, paid.final_price);
  assert.equal(paid.discount_percentage, 10);

  const approvedCount = Number((await database.query(`select count(*) count from "run-partner-audit-logs" where registration_id=$1 and action='payment.approved'`, [registrationIds[0]])).rows[0].count);
  const duplicateCount = Number((await database.query(`select count(*) count from "run-partner-audit-logs" where registration_id=$1 and action='payment.duplicate_ignored'`, [registrationIds[0]])).rows[0].count);
  assert.equal(approvedCount, 1);
  assert.equal(duplicateCount, 1);

  const mismatch = await confirmPaymentInPostgres({ ...confirmation, registrationId: registrationIds[1], providerEventId: `i5-mismatch-event-${suffix}`, providerPaymentId: `i5-mismatch-slug-${suffix}`, providerTransactionId: `i5-mismatch-transaction-${suffix}`, amountCents: finalPrice + 1 });
  assert.equal(mismatch.error, 'amount_mismatch');
  assert.equal((await database.query(`select status from "run-registrations" where id=$1`, [registrationIds[1]])).rows[0].status, 'pending_payment');
  assert.equal(Number((await database.query(`select count(*) count from "run-partner-audit-logs" where registration_id=$1 and action='payment.amount_mismatch'`, [registrationIds[1]])).rows[0].count), 1);

  assert.equal(await expireTemporaryReservationsInPostgres() >= 1, true);
  assert.equal((await database.query(`select status from "run-registrations" where id=$1`, [registrationIds[2]])).rows[0].status, 'expired');
  assert.equal(Number((await database.query(`select count(*) count from "run-partner-audit-logs" where registration_id=$1 and action='payment.expired'`, [registrationIds[2]])).rows[0].count), 1);

  const cancelled = await cancelRegistrationInPostgres({ registrationId: registrationIds[0], actor: 'i5-test', actorRole: 'administrator', reason: 'Validacao automatizada I5', sessionId: 'i5-session', ipAddress: null, userAgent: 'i5-verifier' });
  assert.equal(cancelled.status, 'cancelled');
  const cancelledSnapshot = (await database.query(`select partner_id,partner_name,partner_type,discount_percentage::float8,discount_amount,original_price,final_price from "run-registrations" where id=$1`, [registrationIds[0]])).rows[0];
  assert.equal(cancelledSnapshot.partner_id, partnerId);
  assert.equal(cancelledSnapshot.partner_type, 'influencer');
  assert.equal(cancelledSnapshot.final_price, finalPrice);

  await assert.rejects(database.query(`update "run-partner-audit-logs" set action='tampered' where registration_id=$1`, [registrationIds[0]]), /immutable/i);

  await database.query(`update "run-payments" set amount_cents=amount_cents+7 where id=$1`, [paymentIds[1]]);
  const consistency = await runPartnerConsistencyCheckInPostgres('system:i5-verifier');
  assert.ok(consistency.issues >= 1);
  const alert = (await database.query(`select title,payload from "run-operational-alerts" where dedupe_key=$1`, [`partner-consistency:payment_amount_mismatch:${registrationIds[1]}`])).rows[0];
  assert.match(alert.title, /influenciador/i);
  assert.equal(alert.payload.partnerType, 'influencer');
  await database.query(`update "run-payments" set amount_cents=$1 where id=$2`, [finalPrice, paymentIds[1]]);

  const typedAudits = await database.query(`select action,metadata from "run-partner-audit-logs" where registration_id=any($1::text[])`, [registrationIds]);
  for (const action of ['payment.approved', 'payment.duplicate_ignored', 'payment.amount_mismatch', 'payment.expired', 'registration.cancelled', 'consistency.issue_detected']) {
    assert.ok(typedAudits.rows.some((row) => row.action === action), `Auditoria I5 ausente: ${action}`);
  }
  assert.ok(typedAudits.rows.filter((row) => row.action.startsWith('payment.')).every((row) => row.metadata?.partner_type === 'influencer'));
  console.log('I5 verificada: pagamento persistido, concorrencia, idempotencia, divergencia, expiracao, cancelamento, auditoria imutavel e consistencia validos.');
} finally {
  await database.query(`alter table "run-partner-audit-logs" disable trigger "run-partner-audit-immutable"`).catch(() => undefined);
  await database.query(`delete from "run-partner-audit-logs" where registration_id=any($1::text[]) or partner_id=$2`, [registrationIds, partnerId]).catch(() => undefined);
  await database.query(`alter table "run-partner-audit-logs" enable trigger "run-partner-audit-immutable"`).catch(() => undefined);
  await database.query(`delete from "run-operational-alerts" where entity_id=any($1::text[]) or payload->>'partnerId'=$2`, [registrationIds, partnerId]).catch(() => undefined);
  await database.query(`delete from "run-payment-events" where payment_id=any($1::text[])`, [paymentIds]).catch(() => undefined);
  await database.query(`delete from "run-audit-logs" where entity_id=any($1::text[])`, [registrationIds]).catch(() => undefined);
  await database.query(`delete from "run-payments" where registration_id=any($1::text[])`, [registrationIds]).catch(() => undefined);
  await database.query(`delete from "run-registrations" where id=any($1::text[])`, [registrationIds]).catch(() => undefined);
  if (lotSnapshot) await database.query(`update "run-lots" set sold_count=$1,status=$2 where id=$3`, [lotSnapshot.soldCount, lotSnapshot.status, lotSnapshot.id]).catch(() => undefined);
  await database.query(`delete from "run-partners" where id=$1`, [partnerId]).catch(() => undefined);
  await database.end();
}

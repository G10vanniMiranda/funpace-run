import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
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
process.env.PAYMENT_PROVIDER = 'not_configured';
process.env.INFINITEPAY_HANDLE = '';
process.env.INFINITIPAY_HANDLE = '';
process.env.GOOGLE_SHEETS_ENABLED = 'false';

const [{ handleApiRequest }, { confirmPaymentInPostgres }] = await Promise.all([
  import('../server/index.ts'),
  import('../server/database.ts'),
]);
const database = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: (process.env.DATABASE_SSL || 'true') !== 'false' ? { rejectUnauthorized: false } : false,
});
const server = createServer(handleApiRequest);
const activePartnerId = randomUUID();
const inactivePartnerId = randomUUID();
const suffix = randomUUID().slice(0, 8);
const activeSlug = `phase3-active-${suffix}`;
const inactiveSlug = `phase3-inactive-${suffix}`;
const registrationIds = [];
const paymentIds = [];
let lotSnapshot = null;

function validCpf(seed) {
  const base = String(seed).replace(/\D/g, '').padEnd(9, '7').slice(0, 9).split('').map(Number);
  if (base.every((digit) => digit === base[0])) base[8] = (base[8] + 1) % 10;
  const digit = (values, factor) => { const rest = (values.reduce((sum, value, index) => sum + value * (factor - index), 0) * 10) % 11; return rest === 10 ? 0 : rest; };
  base.push(digit(base, 10)); base.push(digit(base, 11));
  return base.join('');
}

function athletePayload(cpf, email, malicious = {}) {
  return {
    fullName: 'Atleta Verificacao Fase Tres', email, cpf, phone: '69999990000', city: 'Porto Velho', state: 'RO', team: '',
    birthDate: '1990-01-01', gender: 'female', shirtSize: 'M', distance: '5K', emergencyContactName: '', emergencyContactPhone: '',
    termsAccepted: true, regulationAccepted: true, privacyAccepted: true,
    ...malicious,
  };
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
  });
  return { response, payload: await response.json().catch(() => null) };
}

await database.connect();
try {
  await database.query(
    `insert into "run-partners" (id, name, slug, discount_percentage, status) values
      ($1, 'Phase 3 Active', $2, 10, 'active'),
      ($3, 'Phase 3 Inactive', $4, 10, 'inactive')`,
    [activePartnerId, activeSlug, inactivePartnerId, inactiveSlug],
  );
  const lot = await database.query(`select id, sold_count, status from "run-lots" where status = 'active' order by order_index limit 1`);
  lotSnapshot = lot.rows[0] || null;

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const missing = await request(baseUrl, `/api/partners/resolve/missing-${suffix}`, { method: 'POST' });
  assert.equal(missing.response.status, 404);
  const inactive = await request(baseUrl, `/api/partners/resolve/${inactiveSlug}`, { method: 'POST' });
  assert.equal(inactive.response.status, 410);

  const activated = await request(baseUrl, `/api/partners/resolve/${activeSlug}`, { method: 'POST' });
  assert.equal(activated.response.status, 200, JSON.stringify(activated.payload));
  assert.equal(activated.payload.partner.discountPercentage, 10);
  const setCookie = activated.response.headers.get('set-cookie');
  assert.ok(setCookie?.includes('funpace_partner_session='));
  const cookie = setCookie.split(';')[0];

  const session = await request(baseUrl, '/api/partner-session', { headers: { Cookie: cookie } });
  assert.equal(session.payload.partner.partnerType, 'sports_advisory');
  assert.equal('id' in session.payload.partner, false);

  const malicious = { partnerId: inactivePartnerId, discountPercentage: 99, discountAmount: 999_999, originalPrice: 1, finalPrice: 1, amountCents: 1 };
  const created = await request(baseUrl, '/api/registrations', {
    method: 'POST', headers: { Cookie: cookie }, body: JSON.stringify(athletePayload(validCpf(`12345${suffix}`), `phase3-${suffix}@example.com`, malicious)),
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  registrationIds.push(created.payload.registrationId); paymentIds.push(created.payload.paymentId);
  assert.equal(created.payload.partner.partnerType, 'sports_advisory');
  assert.equal(created.payload.partner.finalPriceCents, created.payload.partner.originalPriceCents - created.payload.partner.discountAmountCents);

  const persisted = await database.query(
    `select r.partner_id, r.partner_name, r.partner_type, r.discount_percentage::float8, r.discount_amount, r.original_price, r.final_price, r.amount_cents,
            p.amount_cents as payment_amount
     from "run-registrations" r join "run-payments" p on p.registration_id = r.id where r.id = $1`,
    [created.payload.registrationId],
  );
  const row = persisted.rows[0];
  assert.equal(row.partner_id, activePartnerId);
  assert.equal(row.partner_name, 'Phase 3 Active');
  assert.equal(row.partner_type, 'sports_advisory');
  assert.equal(row.discount_percentage, 10);
  assert.equal(row.discount_amount, Math.round(row.original_price * 0.1));
  assert.equal(row.final_price, row.original_price - row.discount_amount);
  assert.equal(row.amount_cents, row.final_price);
  assert.equal(row.payment_amount, row.final_price);

  const repeated = await request(baseUrl, '/api/registrations', {
    method: 'POST', headers: { Cookie: cookie }, body: JSON.stringify(athletePayload(validCpf(`12345${suffix}`), `phase3-${suffix}@example.com`, malicious)),
  });
  assert.equal(repeated.response.status, 200);
  assert.equal(repeated.payload.partner.finalPriceCents, row.final_price);

  const mismatch = await confirmPaymentInPostgres({
    registrationId: created.payload.registrationId, providerEventId: `phase3-mismatch-${suffix}`, providerPaymentId: '', providerTransactionId: '',
    eventType: 'phase3.verify', gatewayStatus: 'paid', amountCents: row.final_price + 1, payload: {}, auditAction: 'phase3.verify',
  });
  assert.equal(mismatch.error, 'amount_mismatch');
  const confirmed = await confirmPaymentInPostgres({
    registrationId: created.payload.registrationId, providerEventId: `phase3-paid-${suffix}`, providerPaymentId: `payment-${suffix}`,
    providerTransactionId: `transaction-${suffix}`, eventType: 'phase3.verify', gatewayStatus: 'paid', amountCents: row.final_price,
    payload: { verified: true }, auditAction: 'phase3.verify',
  });
  assert.equal(confirmed.statusCode, 200);
  const afterWebhook = await database.query(`select status, partner_id, partner_type, discount_amount, original_price, final_price from "run-registrations" where id = $1`, [created.payload.registrationId]);
  assert.equal(afterWebhook.rows[0].status, 'paid');
  assert.equal(afterWebhook.rows[0].partner_id, activePartnerId);
  assert.equal(afterWebhook.rows[0].partner_type, 'sports_advisory');
  assert.equal(afterWebhook.rows[0].final_price, row.final_price);

  const plain = await request(baseUrl, '/api/registrations', {
    method: 'POST', body: JSON.stringify(athletePayload(validCpf(`98765${suffix}`), `phase3-plain-${suffix}@example.com`, malicious)),
  });
  assert.equal(plain.response.status, 201, JSON.stringify(plain.payload));
  registrationIds.push(plain.payload.registrationId); paymentIds.push(plain.payload.paymentId);
  assert.equal(plain.payload.partner, null);
  const plainRow = await database.query(`select partner_id, partner_type, discount_percentage::float8, discount_amount, original_price, final_price, amount_cents from "run-registrations" where id = $1`, [plain.payload.registrationId]);
  assert.equal(plainRow.rows[0].partner_id, null);
  assert.equal(plainRow.rows[0].partner_type, null);
  assert.equal(plainRow.rows[0].discount_percentage, 0);
  assert.equal(plainRow.rows[0].discount_amount, 0);
  assert.equal(plainRow.rows[0].original_price, plainRow.rows[0].final_price);
  assert.equal(plainRow.rows[0].final_price, plainRow.rows[0].amount_cents);

  console.log('Fase 3 verificada: links, sessao, desconto backend, persistencia, pagamento, webhook e fluxo sem parceiro validos.');
} finally {
  server.close();
  await database.query(`alter table "run-partner-audit-logs" disable trigger "run-partner-audit-immutable"`).catch(() => undefined);
  await database.query(`delete from "run-partner-audit-logs" where partner_id = any($1::uuid[]) or registration_id = any($2::text[])`, [[activePartnerId, inactivePartnerId], registrationIds]).catch(() => undefined);
  await database.query(`alter table "run-partner-audit-logs" enable trigger "run-partner-audit-immutable"`).catch(() => undefined);
  await database.query(`delete from "run-operational-alerts" where alert_type in ('invalid_partner_slug','inactive_partner_access') and payload->>'slug' like 'phase3-%'`).catch(() => undefined);
  if (paymentIds.length) await database.query(`delete from "run-payment-events" where payment_id = any($1::text[])`, [paymentIds]);
  if (registrationIds.length) {
    await database.query(`delete from "run-google-sheet-sync" where entity_id = any($1::text[])`, [registrationIds]);
    await database.query(`delete from "run-audit-logs" where entity_id = any($1::text[])`, [registrationIds]);
    await database.query(`delete from "run-payments" where registration_id = any($1::text[])`, [registrationIds]);
    await database.query(`delete from "run-registrations" where id = any($1::text[])`, [registrationIds]);
  }
  if (lotSnapshot) await database.query(`update "run-lots" set sold_count = $1, status = $2 where id = $3`, [lotSnapshot.sold_count, lotSnapshot.status, lotSnapshot.id]);
  await database.query(`delete from "run-partners" where id = any($1::uuid[])`, [[activePartnerId, inactivePartnerId]]);
  await database.end();
}

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
assert.ok(process.env.PARTNER_SESSION_SECRET || process.env.ADMIN_SESSION_SECRET, 'Secret de sessao nao configurado.');
process.env.PAYMENT_PROVIDER = 'infinitepay';
process.env.INFINITEPAY_HANDLE = 'i4-safe-test-handle';
process.env.INFINITIPAY_HANDLE = '';
process.env.GOOGLE_SHEETS_ENABLED = 'false';

const realFetch = globalThis.fetch;
const checkoutRequests = [];
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url === 'https://api.checkout.infinitepay.io/links') {
    const body = JSON.parse(String(init?.body || '{}'));
    checkoutRequests.push(body);
    return new Response(JSON.stringify({ url: `https://checkout.test/${body.order_nsu}`, slug: `i4-${body.order_nsu}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return realFetch(input, init);
};

const [{ handleApiRequest }, { calculatePartnerPricing }, { signPartnerSession }] = await Promise.all([
  import('../server/index.ts'),
  import('../server/partner-discount.ts'),
  import('../server/partner-session.ts'),
]);
const database = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: (process.env.DATABASE_SSL || 'true') !== 'false' ? { rejectUnauthorized: false } : false });
const server = createServer(handleApiRequest);
const suffix = randomUUID().slice(0, 8);
const advisoryId = randomUUID();
const influencerId = randomUUID();
const inactiveId = randomUUID();
const removedId = randomUUID();
const partnerIds = [advisoryId, influencerId, inactiveId, removedId];
const advisorySlug = `i4-advisory-${suffix}`;
const influencerSlug = `i4-influencer-${suffix}`;
const inactiveSlug = `i4-inactive-${suffix}`;
const removedSlug = `i4-removed-${suffix}`;
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

function athlete(cpf, email, malicious = {}) {
  return {
    fullName: 'Atleta Verificacao I4', email, cpf, phone: '69999990000', city: 'Porto Velho', state: 'RO', team: '',
    birthDate: '1990-01-01', gender: 'female', shirtSize: 'M', distance: '5K', emergencyContactName: '', emergencyContactPhone: '',
    termsAccepted: true, regulationAccepted: true, privacyAccepted: true, ...malicious,
  };
}

async function request(baseUrl, path, options = {}) {
  const response = await realFetch(`${baseUrl}${path}`, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
  return { response, payload: await response.json().catch(() => null) };
}

function cookieFrom(response) {
  const header = response.headers.get('set-cookie');
  assert.ok(header?.includes('funpace_partner_session='));
  return { header, cookie: header.split(';')[0], token: decodeURIComponent(header.split(';')[0].split('=').slice(1).join('=')) };
}

function decodeSession(token) {
  return JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
}

await database.connect();
try {
  const now = new Date().toISOString();
  await database.query(
    `insert into "run-partners" (id,name,slug,partner_type,discount_percentage,status,description,created_at,updated_at,deleted_at) values
     ($1,'I4 Advisory',$2,'sports_advisory',10,'active',null,$9,$9,null),
     ($3,'I4 Influencer',$4,'influencer',10,'active',null,$9,$9,null),
     ($5,'I4 Inactive',$6,'influencer',10,'inactive',null,$9,$9,null),
     ($7,'I4 Removed',$8,'influencer',10,'inactive',null,$9,$9,$9)`,
    [advisoryId, advisorySlug, influencerId, influencerSlug, inactiveId, inactiveSlug, removedId, removedSlug, now],
  );
  const lot = await database.query(`select id,sold_count,status from "run-lots" where status='active' order by order_index limit 1`);
  lotSnapshot = lot.rows[0] || null;
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const missing = await request(baseUrl, `/api/partners/resolve/i4-missing-${suffix}`, { method: 'POST' });
  assert.equal(missing.response.status, 404);
  assert.equal(missing.response.headers.get('set-cookie')?.includes('Max-Age=0'), true);
  const inactive = await request(baseUrl, `/api/partners/resolve/${inactiveSlug}`, { method: 'POST' });
  assert.equal(inactive.response.status, 410);
  const removed = await request(baseUrl, `/api/partners/resolve/${removedSlug}`, { method: 'POST' });
  assert.equal(removed.response.status, 410);

  assert.equal(calculatePartnerPricing(10_000, { id: influencerId, name: 'Invalid Zero', discountPercentage: 0, status: 'active', deletedAt: null }), null);
  assert.equal(calculatePartnerPricing(10_000, { id: influencerId, name: 'Invalid Full', discountPercentage: 100, status: 'active', deletedAt: null }), null);

  const advisoryResolution = await request(baseUrl, `/api/partners/resolve/${advisorySlug}`, { method: 'POST' });
  assert.equal(advisoryResolution.response.status, 200, JSON.stringify(advisoryResolution.payload));
  assert.equal(advisoryResolution.payload.partner.partnerType, 'sports_advisory');
  assert.equal(advisoryResolution.payload.partner.resolutionStatus, 'approved');
  assert.equal('id' in advisoryResolution.payload.partner, false, 'Resolver publico nao deve expor partner_id.');
  const advisoryCookie = cookieFrom(advisoryResolution.response);
  assert.ok(advisoryCookie.header.includes('HttpOnly'));
  assert.ok(advisoryCookie.header.includes('SameSite=Lax'));
  const advisorySessionPayload = decodeSession(advisoryCookie.token);
  assert.equal(advisorySessionPayload.partnerType, 'sports_advisory');
  assert.ok(advisorySessionPayload.correlationId);
  for (const forbidden of ['discountPercentage', 'discount_percentage', 'originalPrice', 'discountAmount', 'finalPrice', 'amountCents']) assert.equal(forbidden in advisorySessionPayload, false);

  const tampered = await request(baseUrl, '/api/partner-session', { headers: { Cookie: `${advisoryCookie.cookie}x` } });
  assert.equal(tampered.payload.partner, null);
  const sessionSecret = process.env.PARTNER_SESSION_SECRET || process.env.ADMIN_SESSION_SECRET;
  const expiredToken = signPartnerSession({ partnerId: advisoryId, slug: advisorySlug, partnerType: 'sports_advisory', issuedAt: Date.now() - 20_000, expiresAt: Date.now() - 10_000 }, sessionSecret);
  const expired = await request(baseUrl, '/api/partner-session', { headers: { Cookie: `funpace_partner_session=${encodeURIComponent(expiredToken)}` } });
  assert.equal(expired.payload.partner, null);
  const legacyToken = signPartnerSession({ partnerId: advisoryId, slug: advisorySlug, issuedAt: Date.now(), expiresAt: Date.now() + 60_000 }, sessionSecret);
  const legacy = await request(baseUrl, '/api/partner-session', { headers: { Cookie: `funpace_partner_session=${encodeURIComponent(legacyToken)}` } });
  assert.equal(legacy.payload.partner.partnerType, 'sports_advisory');

  const influencerResolution = await request(baseUrl, `/api/partners/resolve/${influencerSlug}`, { method: 'POST', headers: { Cookie: advisoryCookie.cookie } });
  assert.equal(influencerResolution.response.status, 200, JSON.stringify(influencerResolution.payload));
  assert.equal(influencerResolution.payload.partner.partnerType, 'influencer');
  const influencerCookie = cookieFrom(influencerResolution.response);
  const influencerSessionPayload = decodeSession(influencerCookie.token);
  assert.notEqual(influencerSessionPayload.correlationId, advisorySessionPayload.correlationId, 'Substituicao valida deve iniciar nova correlacao.');

  const revalidationToken = signPartnerSession({ partnerId: inactiveId, slug: inactiveSlug, partnerType: 'influencer', issuedAt: Date.now(), expiresAt: Date.now() + 60_000 }, sessionSecret);
  const revalidated = await request(baseUrl, '/api/partner-session', { headers: { Cookie: `funpace_partner_session=${encodeURIComponent(revalidationToken)}` } });
  assert.equal(revalidated.payload.partner, null, 'Sessao deve ser revalidada contra status atual do banco.');

  const malicious = { partnerId: advisoryId, partnerType: 'sports_advisory', discountPercentage: 99, discountAmount: 999999, originalPrice: 1, finalPrice: 1, amountCents: 1 };
  const mismatchedIdentityToken = signPartnerSession({ partnerId: influencerId, slug: advisorySlug, partnerType: 'influencer', issuedAt: Date.now(), expiresAt: Date.now() + 60_000 }, sessionSecret);
  const mismatchedIdentity = await request(baseUrl, '/api/registrations', {
    method: 'POST', headers: { Cookie: `funpace_partner_session=${encodeURIComponent(mismatchedIdentityToken)}` },
    body: JSON.stringify(athlete(validCpf(`1313${suffix}`), `i4-mismatch-${suffix}@example.com`, malicious)),
  });
  assert.equal(mismatchedIdentity.response.status, 201, JSON.stringify(mismatchedIdentity.payload));
  assert.equal(mismatchedIdentity.payload.partner, null, 'ID, slug e tipo da sessao devem coincidir com o banco.');
  registrationIds.push(mismatchedIdentity.payload.registrationId); paymentIds.push(mismatchedIdentity.payload.paymentId);

  const influencerCpf = validCpf(`1414${suffix}`);
  const influencerCreated = await request(baseUrl, '/api/registrations', {
    method: 'POST', headers: { Cookie: influencerCookie.cookie }, body: JSON.stringify(athlete(influencerCpf, `i4-influencer-${suffix}@example.com`, malicious)),
  });
  assert.equal(influencerCreated.response.status, 201, JSON.stringify(influencerCreated.payload));
  assert.equal(influencerCreated.payload.partner.partnerType, 'influencer');
  assert.equal('id' in influencerCreated.payload.partner, false);
  assert.equal(influencerCreated.payload.checkoutStatus, 'created');
  registrationIds.push(influencerCreated.payload.registrationId); paymentIds.push(influencerCreated.payload.paymentId);
  const influencerRow = (await database.query(
    `select r.partner_id,r.partner_name,r.partner_type,r.partner_link,r.partner_identified_at,r.discount_percentage::float8,r.discount_amount,r.original_price,r.final_price,r.amount_cents,p.amount_cents payment_amount
     from "run-registrations" r join "run-payments" p on p.registration_id=r.id where r.id=$1`,
    [influencerCreated.payload.registrationId],
  )).rows[0];
  assert.equal(influencerRow.partner_id, influencerId);
  assert.equal(influencerRow.partner_type, 'influencer');
  assert.equal(influencerRow.partner_link, `/p/${influencerSlug}`);
  assert.ok(influencerRow.partner_identified_at);
  assert.equal(influencerRow.discount_percentage, 10);
  assert.equal(influencerRow.discount_amount, Math.round(influencerRow.original_price * 0.1));
  assert.equal(influencerRow.final_price, influencerRow.original_price - influencerRow.discount_amount);
  assert.equal(influencerRow.amount_cents, influencerRow.final_price);
  assert.equal(influencerRow.payment_amount, influencerRow.final_price);
  assert.equal(checkoutRequests.at(-1).items[0].price, influencerRow.final_price, 'InfinitePay deve receber somente o total persistido pelo backend.');

  const blockedLink = await request(baseUrl, `/api/partners/resolve/${advisorySlug}`, { method: 'POST', headers: { Cookie: influencerCookie.cookie } });
  assert.equal(blockedLink.response.status, 409);
  assert.equal(blockedLink.response.headers.get('set-cookie'), null, 'Tentativa bloqueada deve preservar a sessao anterior.');

  const independentAdvisory = await request(baseUrl, `/api/partners/resolve/${advisorySlug}`, { method: 'POST' });
  const independentAdvisoryCookie = cookieFrom(independentAdvisory.response);
  await database.query(`update "run-partners" set discount_percentage=20,updated_at=$1 where id=$2`, [new Date().toISOString(), influencerId]);
  const checkoutCountBeforeRecovery = checkoutRequests.length;
  const recovered = await request(baseUrl, '/api/registrations', {
    method: 'POST', headers: { Cookie: independentAdvisoryCookie.cookie }, body: JSON.stringify(athlete(influencerCpf, `i4-influencer-${suffix}@example.com`, malicious)),
  });
  assert.equal(recovered.response.status, 200);
  assert.equal(recovered.payload.registrationId, influencerCreated.payload.registrationId);
  assert.equal(recovered.payload.partner.partnerType, 'influencer');
  assert.equal(recovered.payload.partner.finalPriceCents, influencerRow.final_price);
  assert.equal(checkoutRequests.length, checkoutCountBeforeRecovery, 'Recuperacao nao deve criar desconto ou checkout duplicado.');
  const snapshotAfterRecovery = (await database.query(`select partner_id,partner_type,discount_percentage::float8,discount_amount,original_price,final_price from "run-registrations" where id=$1`, [influencerCreated.payload.registrationId])).rows[0];
  assert.equal(snapshotAfterRecovery.partner_id, influencerId);
  assert.equal(snapshotAfterRecovery.partner_type, 'influencer');
  assert.equal(snapshotAfterRecovery.discount_percentage, 10, 'Recuperacao deve ignorar o percentual atual do parceiro.');
  assert.equal(snapshotAfterRecovery.final_price, influencerRow.final_price);

  const advisoryCpf = validCpf(`2424${suffix}`);
  const advisoryCreated = await request(baseUrl, '/api/registrations', { method: 'POST', headers: { Cookie: independentAdvisoryCookie.cookie }, body: JSON.stringify(athlete(advisoryCpf, `i4-advisory-${suffix}@example.com`)) });
  assert.equal(advisoryCreated.response.status, 201, JSON.stringify(advisoryCreated.payload));
  assert.equal(advisoryCreated.payload.partner.partnerType, 'sports_advisory');
  registrationIds.push(advisoryCreated.payload.registrationId); paymentIds.push(advisoryCreated.payload.paymentId);
  const advisoryRow = (await database.query(`select partner_type,discount_percentage::float8,discount_amount,original_price,final_price from "run-registrations" where id=$1`, [advisoryCreated.payload.registrationId])).rows[0];
  assert.equal(advisoryRow.partner_type, 'sports_advisory');
  assert.equal(advisoryRow.discount_percentage, influencerRow.discount_percentage);
  assert.equal(advisoryRow.discount_amount, Math.round(advisoryRow.original_price * 0.1));

  const plainCpf = validCpf(`3434${suffix}`);
  const plain = await request(baseUrl, '/api/registrations', { method: 'POST', body: JSON.stringify(athlete(plainCpf, `i4-plain-${suffix}@example.com`, malicious)) });
  assert.equal(plain.response.status, 201, JSON.stringify(plain.payload));
  assert.equal(plain.payload.partner, null);
  registrationIds.push(plain.payload.registrationId); paymentIds.push(plain.payload.paymentId);
  const plainRow = (await database.query(`select partner_id,partner_type,discount_percentage::float8,discount_amount,original_price,final_price,amount_cents from "run-registrations" where id=$1`, [plain.payload.registrationId])).rows[0];
  assert.equal(plainRow.partner_id, null);
  assert.equal(plainRow.partner_type, null);
  assert.equal(plainRow.discount_percentage, 0);
  assert.equal(plainRow.discount_amount, 0);
  assert.equal(plainRow.original_price, plainRow.final_price);

  const audit = await database.query(`select action,registration_id,metadata from "run-partner-audit-logs" where partner_id=any($1::uuid[]) order by created_at`, [partnerIds]);
  const actions = audit.rows.map((row) => row.action);
  for (const action of ['partner.link_accessed','partner.link_rejected','partner.resolution_approved','partner.session_created','partner.session_replaced','partner.session_replacement_blocked','registration.started','registration.recovered','discount.applied','partner.snapshot_persisted','consistency.issue_detected']) assert.ok(actions.includes(action), `Auditoria I4 ausente: ${action}`);
  assert.ok(audit.rows.filter((row) => !['partner.link_rejected'].includes(row.action)).some((row) => row.metadata?.partner_type === 'influencer'));

  console.log('I4 verificada: links, sessao, substituicao, revalidacao, snapshots, checkout, InfinitePay simulada e auditoria validos.');
} finally {
  server.close();
  globalThis.fetch = realFetch;
  await database.query(`alter table "run-partner-audit-logs" disable trigger "run-partner-audit-immutable"`).catch(() => undefined);
  await database.query(`delete from "run-partner-audit-logs" where partner_id=any($1::uuid[]) or registration_id=any($2::text[])`, [partnerIds, registrationIds]).catch(() => undefined);
  await database.query(`alter table "run-partner-audit-logs" enable trigger "run-partner-audit-immutable"`).catch(() => undefined);
  await database.query(`delete from "run-operational-alerts" where (entity_type='partner' and entity_id=any($1::text[])) or payload->>'slug' like 'i4-%'`, [partnerIds]).catch(() => undefined);
  if (paymentIds.length) await database.query(`delete from "run-payment-events" where payment_id=any($1::text[])`, [paymentIds]).catch(() => undefined);
  if (registrationIds.length) {
    await database.query(`delete from "run-google-sheet-sync" where entity_id=any($1::text[])`, [registrationIds]).catch(() => undefined);
    await database.query(`delete from "run-audit-logs" where entity_id=any($1::text[])`, [registrationIds]).catch(() => undefined);
    await database.query(`delete from "run-payments" where registration_id=any($1::text[])`, [registrationIds]).catch(() => undefined);
    await database.query(`delete from "run-registrations" where id=any($1::text[])`, [registrationIds]).catch(() => undefined);
  }
  if (lotSnapshot) await database.query(`update "run-lots" set sold_count=$1,status=$2 where id=$3`, [lotSnapshot.sold_count, lotSnapshot.status, lotSnapshot.id]).catch(() => undefined);
  await database.query(`delete from "run-partners" where id=any($1::uuid[])`, [partnerIds]).catch(() => undefined);
  await database.end();
}

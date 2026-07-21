import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
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
assert.ok(process.env.ADMIN_SESSION_SECRET, 'ADMIN_SESSION_SECRET nao configurada.');

const { handleApiRequest } = await import('../server/index.ts');
const database = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: (process.env.DATABASE_SSL || 'true') !== 'false' ? { rejectUnauthorized: false } : false,
});
const server = createServer(handleApiRequest);
const sessionId = randomUUID();
const actor = 'i3-influencer-admin-verifier@funpace.local';
const expiresAt = Date.now() + 10 * 60 * 1000;
const encodedPayload = Buffer.from(JSON.stringify({ id: sessionId, actor, role: 'administrator', expiresAt })).toString('base64url');
const signature = createHmac('sha256', process.env.ADMIN_SESSION_SECRET).update(encodedPayload).digest('base64url');
const cookie = `funpace_admin_session=${encodedPayload}.${signature}`;
const partnerIds = [];
const registrationIds = [];

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

await database.connect();
try {
  const now = new Date().toISOString();
  await database.query(
    `insert into "run-admin-sessions" (id,actor,role,created_at,expires_at,revoked_at,ip_address,user_agent)
     values ($1,$2,'administrator',$3,$4,null,'127.0.0.1','i3-verifier')`,
    [sessionId, actor, now, new Date(expiresAt).toISOString()],
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const headers = { Cookie: cookie };
  const suffix = randomUUID().slice(0, 8);
  const advisorySlug = `i3-advisory-${suffix}`;
  const influencerSlug = `i3-influencer-${suffix}`;

  const unauthorized = await request(baseUrl, '/api/admin/partners');
  assert.equal(unauthorized.response.status, 401);

  const advisoryCreated = await request(baseUrl, '/api/admin/partners', {
    method: 'POST', headers,
    body: JSON.stringify({ name: `I3 Advisory ${suffix}`, slug: advisorySlug, partnerType: 'sports_advisory', discountPercentage: 10, description: 'Advisory fixture', status: 'active' }),
  });
  assert.equal(advisoryCreated.response.status, 201, JSON.stringify(advisoryCreated.payload));
  const advisoryId = advisoryCreated.payload.partner.id;
  partnerIds.push(advisoryId);
  assert.equal(advisoryCreated.payload.partner.partnerType, 'sports_advisory');

  const influencerCreated = await request(baseUrl, '/api/admin/partners', {
    method: 'POST', headers,
    body: JSON.stringify({ name: `I3 Influencer ${suffix}`, slug: influencerSlug, partner_type: 'influencer', discountPercentage: 12.5, description: 'Influencer fixture', status: 'active' }),
  });
  assert.equal(influencerCreated.response.status, 201, JSON.stringify(influencerCreated.payload));
  const influencerId = influencerCreated.payload.partner.id;
  partnerIds.push(influencerId);
  assert.equal(influencerCreated.payload.partner.partnerType, 'influencer');

  const invalidType = await request(baseUrl, '/api/admin/partners', {
    method: 'POST', headers,
    body: JSON.stringify({ name: 'Invalid Ambassador', slug: `${influencerSlug}-invalid`, partnerType: 'ambassador', discountPercentage: 10, status: 'active' }),
  });
  assert.equal(invalidType.response.status, 422);

  const duplicateAcrossTypes = await request(baseUrl, '/api/admin/partners', {
    method: 'POST', headers,
    body: JSON.stringify({ name: 'Duplicate Global Slug', slug: advisorySlug, partnerType: 'influencer', discountPercentage: 10, status: 'active' }),
  });
  assert.equal(duplicateAcrossTypes.response.status, 409);

  const all = await request(baseUrl, `/api/admin/partners?name=I3&slug=${suffix}&page=1&pageSize=1`, { headers });
  assert.equal(all.response.status, 200);
  assert.equal(all.payload.partners.length, 1);
  assert.ok(all.payload.pagination.total >= 2);
  assert.equal(all.payload.pagination.pageSize, 1);

  const advisoryList = await request(baseUrl, `/api/admin/partners?partner_type=sports_advisory&slug=${suffix}`, { headers });
  assert.equal(advisoryList.response.status, 200);
  assert.ok(advisoryList.payload.partners.some((partner) => partner.id === advisoryId));
  assert.ok(advisoryList.payload.partners.every((partner) => partner.partnerType === 'sports_advisory'));

  const influencerList = await request(baseUrl, `/api/admin/partners?partnerType=influencer&name=${encodeURIComponent(`I3 Influencer ${suffix}`)}&status=active`, { headers });
  assert.equal(influencerList.response.status, 200);
  assert.deepEqual(influencerList.payload.partners.map((partner) => partner.id), [influencerId]);

  const influencerEdited = await request(baseUrl, `/api/admin/partners/${influencerId}`, {
    method: 'PUT', headers,
    body: JSON.stringify({ name: `I3 Influencer Edited ${suffix}`, slug: influencerSlug, partnerType: 'influencer', discountPercentage: 15, description: 'Edited influencer', status: 'active' }),
  });
  assert.equal(influencerEdited.response.status, 200, JSON.stringify(influencerEdited.payload));
  assert.equal(influencerEdited.payload.partner.discountPercentage, 15);

  const allowedTypeChange = await request(baseUrl, `/api/admin/partners/${advisoryId}`, {
    method: 'PUT', headers,
    body: JSON.stringify({ name: `I3 Advisory ${suffix}`, slug: advisorySlug, partnerType: 'influencer', discountPercentage: 10, description: 'No history', status: 'active' }),
  });
  assert.equal(allowedTypeChange.response.status, 200, JSON.stringify(allowedTypeChange.payload));
  assert.equal(allowedTypeChange.payload.partner.partnerType, 'influencer');

  const fixture = (await database.query(
    `select event.id event_id,distance.id distance_id,lot.id lot_id
     from "run-events" event join "run-distances" distance on distance.event_id=event.id
     join "run-lots" lot on lot.event_id=event.id limit 1`,
  )).rows[0];
  assert.ok(fixture, 'Evento, distancia e lote sao necessarios para o teste transacional.');
  const registrationId = `i3-${randomUUID()}`;
  registrationIds.push(registrationId);
  await database.query(
    `insert into "run-registrations"
     (id,event_id,distance_id,lot_id,cpf_hash,status,amount_cents,payload,created_at,updated_at,partner_id,partner_name,partner_type,partner_link,partner_identified_at,discount_percentage,discount_amount,original_price,final_price)
     values ($1,$2,$3,$4,$5,'cancelled',9000,$6,$7,$7,$8,$9,'influencer',$10,$7,10,1000,10000,9000)`,
    [registrationId, fixture.event_id, fixture.distance_id, fixture.lot_id, randomUUID(), { fullName: 'I3 Temporary Athlete' }, now, influencerId, `I3 Influencer Edited ${suffix}`, `/p/${influencerSlug}`],
  );

  const blockedTypeChange = await request(baseUrl, `/api/admin/partners/${influencerId}`, {
    method: 'PUT', headers,
    body: JSON.stringify({ name: `I3 Influencer Edited ${suffix}`, slug: influencerSlug, partnerType: 'sports_advisory', discountPercentage: 15, description: 'Must stay influencer', status: 'active' }),
  });
  assert.equal(blockedTypeChange.response.status, 409, JSON.stringify(blockedTypeChange.payload));
  assert.ok(blockedTypeChange.payload.history.registrations >= 1);
  const unchanged = await request(baseUrl, `/api/admin/partners/${influencerId}`, { headers });
  assert.equal(unchanged.payload.partner.partnerType, 'influencer');

  const inactivated = await request(baseUrl, `/api/admin/partners/${influencerId}/status`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'inactive' }) });
  assert.equal(inactivated.response.status, 200);
  assert.equal(inactivated.payload.partner.status, 'inactive');
  const activated = await request(baseUrl, `/api/admin/partners/${influencerId}/status`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'active' }) });
  assert.equal(activated.response.status, 200);

  const audit = await database.query(
    `select action,old_data,new_data,metadata from "run-partner-audit-logs" where partner_id=any($1::uuid[]) order by created_at`,
    [partnerIds],
  );
  const actions = audit.rows.map((row) => row.action);
  for (const action of ['partner.created', 'partner.updated', 'partner.type_changed', 'partner.type_change_blocked', 'partner.inactivated', 'partner.activated']) assert.ok(actions.includes(action), `Auditoria ausente: ${action}`);
  assert.ok(audit.rows.every((row) => row.metadata?.partnerType), 'Todo log administrativo deve identificar partnerType.');
  assert.ok(audit.rows.some((row) => row.action === 'partner.type_change_blocked' && row.metadata?.requestedPartnerType === 'sports_advisory'));

  await database.query(`delete from "run-registrations" where id=$1`, [registrationId]);
  registrationIds.length = 0;
  const removed = await request(baseUrl, `/api/admin/partners/${influencerId}`, { method: 'DELETE', headers });
  assert.equal(removed.response.status, 200);
  const afterDelete = await request(baseUrl, `/api/admin/partners/${influencerId}`, { headers });
  assert.equal(afterDelete.response.status, 404);
  const unavailableAfterDelete = await request(baseUrl, `/api/admin/partners/slug-availability?slug=${influencerSlug}`, { headers });
  assert.equal(unavailableAfterDelete.payload.available, false, 'Slug removido deve permanecer reservado globalmente.');

  console.log('I3 verificada: CRUD unificado, filtros, paginacao, slug global, protecao de tipo e auditoria validos.');
} finally {
  server.close();
  for (const registrationId of registrationIds) await database.query(`delete from "run-registrations" where id=$1`, [registrationId]).catch(() => undefined);
  if (partnerIds.length) {
    await database.query(`alter table "run-partner-audit-logs" disable trigger "run-partner-audit-immutable"`).catch(() => undefined);
    await database.query(`delete from "run-partner-audit-logs" where partner_id=any($1::uuid[])`, [partnerIds]).catch(() => undefined);
    await database.query(`alter table "run-partner-audit-logs" enable trigger "run-partner-audit-immutable"`).catch(() => undefined);
    await database.query(`delete from "run-audit-logs" where entity_type='partner' and entity_id=any($1::text[])`, [partnerIds]).catch(() => undefined);
    await database.query(`delete from "run-operational-alerts" where entity_type='partner' and entity_id=any($1::text[])`, [partnerIds]).catch(() => undefined);
    await database.query(`delete from "run-partners" where id=any($1::uuid[])`, [partnerIds]).catch(() => undefined);
  }
  await database.query(`delete from "run-admin-sessions" where id=$1`, [sessionId]).catch(() => undefined);
  await database.end();
}

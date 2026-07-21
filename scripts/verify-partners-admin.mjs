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
const actor = 'phase2-partners-verifier@funpace.local';
const expiresAt = Date.now() + 10 * 60 * 1000;
const sessionPayload = { id: sessionId, actor, role: 'administrator', expiresAt };
const encodedPayload = Buffer.from(JSON.stringify(sessionPayload)).toString('base64url');
const signature = createHmac('sha256', process.env.ADMIN_SESSION_SECRET).update(encodedPayload).digest('base64url');
const cookie = `funpace_admin_session=${encodedPayload}.${signature}`;
let partnerId = '';

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
    `insert into "run-admin-sessions" (id, actor, role, created_at, expires_at, revoked_at, ip_address, user_agent)
     values ($1, $2, 'administrator', $3, $4, null, '127.0.0.1', 'phase2-verifier')`,
    [sessionId, actor, now, new Date(expiresAt).toISOString()],
  );

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const unauthorized = await request(baseUrl, '/api/admin/partners');
  assert.equal(unauthorized.response.status, 401, 'A listagem deve exigir autenticacao.');

  const authHeaders = { Cookie: cookie };
  const suffix = randomUUID().slice(0, 8);
  const slug = `phase2-verification-${suffix}`;
  const created = await request(baseUrl, '/api/admin/partners', {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ name: 'Phase 2 Verification', slug, discountPercentage: 10, description: 'Temporary CRUD validation', status: 'active' }),
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  partnerId = created.payload.partner.id;
  assert.equal(created.payload.partner.partnerType, 'sports_advisory', 'Payload legado deve usar o tipo padrao.');

  const fetched = await request(baseUrl, `/api/admin/partners/${partnerId}`, { headers: authHeaders });
  assert.equal(fetched.response.status, 200);
  assert.equal(fetched.payload.partner.slug, slug);

  const unavailable = await request(baseUrl, `/api/admin/partners/slug-availability?slug=${slug}`, { headers: authHeaders });
  assert.deepEqual(unavailable.payload, { slug, available: false });

  const duplicate = await request(baseUrl, '/api/admin/partners', {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ name: 'Duplicate', slug, discountPercentage: 10, status: 'active' }),
  });
  assert.equal(duplicate.response.status, 409);

  const invalid = await request(baseUrl, '/api/admin/partners', {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ name: 'Invalid', slug: `${slug}-invalid`, discountPercentage: 0, status: 'active' }),
  });
  assert.equal(invalid.response.status, 422);

  const invalidFullDiscount = await request(baseUrl, '/api/admin/partners', {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ name: 'Invalid Full Discount', slug: `${slug}-full`, discountPercentage: 100, status: 'active' }),
  });
  assert.equal(invalidFullDiscount.response.status, 422);

  const invalidType = await request(baseUrl, '/api/admin/partners', {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ name: 'Invalid Type', slug: `${slug}-type`, partner_type: 'ambassador', discountPercentage: 10, status: 'active' }),
  });
  assert.equal(invalidType.response.status, 422);

  const typedUpdate = await request(baseUrl, `/api/admin/partners/${partnerId}`, {
    method: 'PUT', headers: authHeaders,
    body: JSON.stringify({ name: 'Phase 2 Influencer', slug, partner_type: 'influencer', discountPercentage: 10, description: 'Typed', status: 'active' }),
  });
  assert.equal(typedUpdate.response.status, 200, JSON.stringify(typedUpdate.payload));
  assert.equal(typedUpdate.payload.partner.partnerType, 'influencer');

  const updatedSlug = `${slug}-updated`;
  const updated = await request(baseUrl, `/api/admin/partners/${partnerId}`, {
    method: 'PUT', headers: authHeaders,
    body: JSON.stringify({ name: 'Phase 2 Updated', slug: updatedSlug, discountPercentage: 15, description: 'Updated', status: 'inactive' }),
  });
  assert.equal(updated.response.status, 200, JSON.stringify(updated.payload));
  assert.equal(updated.payload.partner.discountPercentage, 15);
  assert.equal(updated.payload.partner.partnerType, 'sports_advisory', 'Update legado deve permanecer compativel com o tipo padrao.');

  const activated = await request(baseUrl, `/api/admin/partners/${partnerId}/status`, {
    method: 'PATCH', headers: authHeaders, body: JSON.stringify({ status: 'active' }),
  });
  assert.equal(activated.response.status, 200);
  assert.equal(activated.payload.partner.status, 'active');

  const filtered = await request(baseUrl, `/api/admin/partners?name=updated&slug=${updatedSlug}&status=active`, { headers: authHeaders });
  assert.equal(filtered.response.status, 200);
  assert.equal(filtered.payload.partners.some((partner) => partner.id === partnerId), true);

  const removed = await request(baseUrl, `/api/admin/partners/${partnerId}`, { method: 'DELETE', headers: authHeaders });
  assert.equal(removed.response.status, 200);
  const afterDelete = await request(baseUrl, `/api/admin/partners/${partnerId}`, { headers: authHeaders });
  assert.equal(afterDelete.response.status, 404);

  console.log('Fase 2 verificada: autenticacao, CRUD, filtros, slug, status e soft delete validos.');
} finally {
  server.close();
  if (partnerId) {
    await database.query(`alter table "run-partner-audit-logs" disable trigger "run-partner-audit-immutable"`).catch(() => undefined);
    await database.query(`delete from "run-partner-audit-logs" where partner_id = $1`, [partnerId]).catch(() => undefined);
    await database.query(`alter table "run-partner-audit-logs" enable trigger "run-partner-audit-immutable"`).catch(() => undefined);
    await database.query(`delete from "run-audit-logs" where entity_type = 'partner' and entity_id = $1`, [partnerId]);
    await database.query(`delete from "run-partners" where id = $1`, [partnerId]);
  }
  await database.query(`delete from "run-admin-sessions" where id = $1`, [sessionId]);
  await database.query(`delete from "run-admin-sessions" where actor = 'phase2-visual-verifier@funpace.local'`);
  await database.query(`delete from "run-admin-users" where email = 'phase2-visual-verifier@funpace.local'`);
  await database.end();
}

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
const database = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: (process.env.DATABASE_SSL || 'true') !== 'false' ? { rejectUnauthorized: false } : false });
const server = createServer(handleApiRequest);
const runId = randomUUID().slice(0, 8);
const partnerA = randomUUID(); const partnerB = randomUUID(); const partnerC = randomUUID();
const sessionId = randomUUID(); const actor = `phase4-dashboard-${runId}@funpace.local`; const expiresAt = Date.now() + 15 * 60 * 1000;
const encoded = Buffer.from(JSON.stringify({ id: sessionId, actor, role: 'administrator', expiresAt })).toString('base64url');
const signature = createHmac('sha256', process.env.ADMIN_SESSION_SECRET).update(encoded).digest('base64url');
const authHeaders = { Cookie: `funpace_admin_session=${encoded}.${signature}` };
const city = `Phase4City-${runId}`;

async function request(baseUrl, path, headers = {}) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${path}`, { headers });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  return { response, payload, elapsedMs: Math.round(performance.now() - started) };
}

await database.connect();
try {
  const base = await database.query(`select e.id event_id, d.id distance_id, l.id lot_id from "run-events" e join "run-distances" d on d.event_id=e.id join "run-lots" l on l.event_id=e.id limit 1`);
  assert.ok(base.rows[0], 'Evento, distancia e lote sao necessarios para a verificacao.');
  const { event_id: eventId, distance_id: distanceId, lot_id: lotId } = base.rows[0];
  const now = new Date().toISOString();
  await database.query(`insert into "run-admin-sessions" (id,actor,role,created_at,expires_at,revoked_at,ip_address,user_agent) values ($1,$2,'administrator',$3,$4,null,'127.0.0.1','phase4-verifier')`, [sessionId, actor, now, new Date(expiresAt).toISOString()]);
  await database.query(`insert into "run-partners" (id,name,slug,discount_percentage,status,description,created_at,updated_at,deleted_at) values
    ($1,'Phase 4 Volume',$4,10,'active','Temporary dashboard validation',$7,$7,null),
    ($2,'Phase 4 Growth',$5,10,'active','Temporary dashboard validation',$7,$7,null),
    ($3,'Phase 4 Inactive',$6,10,'inactive','Temporary dashboard validation',$7,$7,null)`, [partnerA, partnerB, partnerC, `phase4-volume-${runId}`, `phase4-growth-${runId}`, `phase4-inactive-${runId}`, now]);
  await database.query(`insert into "run-registrations" (id,event_id,distance_id,lot_id,cpf_hash,status,amount_cents,payload,created_at,updated_at,partner_id,partner_name,partner_type,discount_percentage,discount_amount,original_price,final_price)
    select $1 || '-a-' || g, $2, $3, $4, $1 || '-cpf-a-' || g,
      case when g <= 200 then 'paid' else 'pending_payment' end, 10800,
      jsonb_build_object('fullName','Atleta Volume ' || g,'city',$5::text,'state','AM'),
      (case when g <= 100 then now() - (g || ' minutes')::interval else date_trunc('month',now()) - interval '15 days' - (g || ' minutes')::interval end)::text,
      now()::text,$6::uuid,'Phase 4 Volume','sports_advisory',10,1200,12000,10800 from generate_series(1,220) g`, [`phase4-${runId}`, eventId, distanceId, lotId, city, partnerA]);
  await database.query(`insert into "run-registrations" (id,event_id,distance_id,lot_id,cpf_hash,status,amount_cents,payload,created_at,updated_at,partner_id,partner_name,partner_type,discount_percentage,discount_amount,original_price,final_price)
    select $1 || '-b-' || g, $2, $3, $4, $1 || '-cpf-b-' || g, 'paid',10800,
      jsonb_build_object('fullName','Atleta Growth ' || g,'city',$5::text,'state','AM'),
      (now() - (g || ' minutes')::interval)::text,now()::text,$6::uuid,'Phase 4 Growth','sports_advisory',10,1200,12000,10800 from generate_series(1,30) g`, [`phase4-${runId}`, eventId, distanceId, lotId, city, partnerB]);

  const indexes = await database.query(`select indexname from pg_indexes where tablename='run-registrations' and indexname like 'run-registrations_partner_%'`);
  assert.ok(indexes.rows.length >= 4, 'Indices analiticos nao foram encontrados.');
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object'); const baseUrl = `http://127.0.0.1:${address.port}`;
  assert.equal((await request(baseUrl, '/api/admin/partner-dashboard')).response.status, 401, 'Dashboard deve exigir administrador.');
  const dashboard = await request(baseUrl, `/api/admin/partner-dashboard?city=${encodeURIComponent(city)}&pageSize=20`, authHeaders);
  assert.equal(dashboard.response.status, 200, JSON.stringify(dashboard.payload));
  assert.ok(dashboard.elapsedMs < 15_000, `Dashboard excedeu limite de desempenho: ${dashboard.elapsedMs}ms`);
  assert.equal(dashboard.payload.summary.totalRegistrations, 250);
  assert.equal(dashboard.payload.summary.paidRegistrations, 230);
  assert.equal(dashboard.payload.summary.grossRevenueCents, 2_760_000);
  assert.equal(dashboard.payload.summary.discountAmountCents, 276_000);
  assert.equal(dashboard.payload.summary.netRevenueCents, 2_484_000);
  assert.equal(dashboard.payload.summary.averageTicketCents, 10_800);
  assert.equal(dashboard.payload.summary.conversionRate, 92);
  assert.equal(dashboard.payload.ranking[0].partnerId, partnerA);
  assert.equal(dashboard.payload.ranking[0].registrations, 220);
  assert.equal(dashboard.payload.charts.comparison.reduce((sum, item) => sum + item.sharePercentage, 0), 100);
  assert.ok(dashboard.payload.charts.monthly.length >= 2);
  assert.ok(dashboard.payload.indicators.inactive.some((item) => item.partnerId === partnerC));
  assert.ok(dashboard.payload.indicators.withoutRegistrations.some((item) => item.partnerId === partnerC));
  assert.ok(dashboard.payload.indicators.fastestGrowing.some((item) => item.partnerId === partnerB));
  assert.ok(dashboard.payload.indicators.declining.some((item) => item.partnerId === partnerA));
  const paid = await request(baseUrl, `/api/admin/partner-dashboard?city=${encodeURIComponent(city)}&paymentStatus=paid`, authHeaders);
  assert.equal(paid.payload.summary.totalRegistrations, 230); assert.equal(paid.payload.summary.conversionRate, 100);
  const detail = await request(baseUrl, `/api/admin/partner-dashboard/${partnerA}?city=${encodeURIComponent(city)}&page=1&pageSize=25`, authHeaders);
  assert.equal(detail.response.status, 200, JSON.stringify(detail.payload)); assert.equal(detail.payload.pagination.total, 220); assert.equal(detail.payload.registrations.length, 25); assert.equal(detail.payload.metrics.netRevenueCents, 2_160_000);
  const secondPage = await request(baseUrl, `/api/admin/partner-dashboard/${partnerA}?city=${encodeURIComponent(city)}&page=9&pageSize=25`, authHeaders);
  assert.equal(secondPage.payload.registrations.length, 20);
  const csv = await request(baseUrl, `/api/admin/partner-dashboard/export?city=${encodeURIComponent(city)}&format=csv`, authHeaders);
  assert.equal(csv.response.status, 200); assert.ok(csv.payload.includes('Phase 4 Volume')); assert.equal(csv.payload.trim().split('\n').length, 251);
  const excel = await request(baseUrl, `/api/admin/partner-dashboard/export?partnerId=${partnerB}&format=excel`, authHeaders);
  assert.equal(excel.response.status, 200); assert.ok(excel.payload.includes('<Workbook')); assert.ok(excel.payload.includes('Phase 4 Growth'));
  const invalid = await request(baseUrl, '/api/admin/partner-dashboard?paymentStatus=invalid', authHeaders); assert.equal(invalid.response.status, 422);
  console.log(`Fase 4 verificada: 250 inscricoes, agregacoes, filtros, ranking, indicadores, paginacao e exportacoes (${dashboard.elapsedMs}ms).`);
} finally {
  server.close();
  await database.query(`delete from "run-registrations" where id like $1`, [`phase4-${runId}-%`]).catch(() => undefined);
  await database.query(`delete from "run-partners" where id = any($1::uuid[])`, [[partnerA, partnerB, partnerC]]).catch(() => undefined);
  await database.query(`delete from "run-admin-sessions" where id=$1`, [sessionId]).catch(() => undefined);
  await database.end();
}

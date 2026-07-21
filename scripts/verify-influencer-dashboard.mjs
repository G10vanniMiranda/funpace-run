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
const suffix = randomUUID().slice(0, 8);
const advisoryId = randomUUID();
const influencerId = randomUUID();
const emptyAdvisoryId = randomUUID();
const emptyInfluencerId = randomUUID();
const partnerIds = [advisoryId, influencerId, emptyAdvisoryId, emptyInfluencerId];
const sessionId = randomUUID();
const actor = `i6-dashboard-${suffix}@funpace.local`;
const expiresAt = Date.now() + 15 * 60_000;
const encoded = Buffer.from(JSON.stringify({ id: sessionId, actor, role: 'administrator', expiresAt })).toString('base64url');
const signature = createHmac('sha256', process.env.ADMIN_SESSION_SECRET).update(encoded).digest('base64url');
const authHeaders = { Cookie: `funpace_admin_session=${encoded}.${signature}` };
const city = `I6City-${suffix}`;
const registrationPrefix = `i6-${suffix}`;

async function request(baseUrl, path, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  return { response, payload };
}

await database.connect();
try {
  const base = (await database.query(`select e.id event_id,d.id distance_id,l.id lot_id from "run-events" e join "run-distances" d on d.event_id=e.id join "run-lots" l on l.event_id=e.id limit 1`)).rows[0];
  assert.ok(base, 'Evento, distancia e lote sao necessarios.');
  const now = new Date().toISOString();
  await database.query(`insert into "run-admin-sessions" (id,actor,role,created_at,expires_at,revoked_at,ip_address,user_agent) values ($1,$2,'administrator',$3,$4,null,'127.0.0.1','i6-verifier')`, [sessionId, actor, now, new Date(expiresAt).toISOString()]);
  await database.query(
    `insert into "run-partners" (id,name,slug,partner_type,discount_percentage,status,description,created_at,updated_at,deleted_at) values
     ($1,'I6 Assessoria',$5,'sports_advisory',10,'active',null,$9,$9,null),
     ($2,'I6 Influenciador',$6,'influencer',10,'active',null,$9,$9,null),
     ($3,'I6 Assessoria Vazia',$7,'sports_advisory',10,'inactive',null,$9,$9,null),
     ($4,'I6 Influenciador Vazio',$8,'influencer',10,'inactive',null,$9,$9,null)`,
    [advisoryId, influencerId, emptyAdvisoryId, emptyInfluencerId, `i6-advisory-${suffix}`, `i6-influencer-${suffix}`, `i6-empty-advisory-${suffix}`, `i6-empty-influencer-${suffix}`, now],
  );
  const insertRegistrations = async (partnerId, partnerName, partnerType, count, paidCount) => database.query(
    `insert into "run-registrations" (id,event_id,distance_id,lot_id,cpf_hash,status,amount_cents,payload,created_at,updated_at,partner_id,partner_name,partner_type,partner_link,partner_identified_at,discount_percentage,discount_amount,original_price,final_price)
     select $1 || '-' || g,$2,$3,$4,$1 || '-cpf-' || g,case when g<=$5 then 'paid' else 'pending_payment' end,10800,
       jsonb_build_object('fullName',$6 || ' Atleta ' || g,'city',$7::text,'state','AM'),
       (now()-(g || ' minutes')::interval)::text,now()::text,$8::uuid,$6,$9,'/p/' || $10,now()::text,10,1200,12000,10800
     from generate_series(1,$11) g`,
    [`${registrationPrefix}-${partnerType}`, base.event_id, base.distance_id, base.lot_id, paidCount, partnerName, city, partnerId, partnerType, partnerType === 'influencer' ? `i6-influencer-${suffix}` : `i6-advisory-${suffix}`, count],
  );
  await insertRegistrations(advisoryId, 'I6 Assessoria', 'sports_advisory', 12, 9);
  await insertRegistrations(influencerId, 'I6 Influenciador', 'influencer', 8, 7);
  for (const [partnerId, partnerType, registrations, paid] of [[advisoryId, 'sports_advisory', 12, 9], [influencerId, 'influencer', 8, 7]]) {
    for (const [action, amount] of [['partner.link_accessed', registrations], ['registration.started', registrations], ['payment.approved', paid]]) {
      await database.query(
        `insert into "run-partner-audit-logs" (id,partner_id,action,metadata,created_at)
         select gen_random_uuid(),$1::uuid,$2,jsonb_build_object('partnerType',$3::text,'partner_type',$3::text),now()::text from generate_series(1,$4::int)`,
        [partnerId, action, partnerType, amount],
      );
    }
  }

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const general = await request(baseUrl, `/api/admin/partner-dashboard?city=${encodeURIComponent(city)}&pageSize=100`, authHeaders);
  assert.equal(general.response.status, 200, JSON.stringify(general.payload));
  assert.equal(general.payload.summary.totalRegistrations, 20);
  assert.equal(general.payload.summary.paidRegistrations, 16);
  assert.equal(general.payload.breakdown.length, 2);
  assert.ok(general.payload.ranking.some((row) => row.partnerId === advisoryId && row.partnerType === 'sports_advisory'));
  assert.ok(general.payload.ranking.some((row) => row.partnerId === influencerId && row.partnerType === 'influencer'));

  const influencer = await request(baseUrl, `/api/admin/partner-dashboard?city=${encodeURIComponent(city)}&partnerType=influencer&pageSize=100`, authHeaders);
  assert.equal(influencer.response.status, 200, JSON.stringify(influencer.payload));
  assert.equal(influencer.payload.summary.totalRegistrations, 8);
  assert.equal(influencer.payload.summary.paidRegistrations, 7);
  assert.equal(influencer.payload.summary.sportsAdvisories, 0);
  assert.ok(influencer.payload.summary.influencers >= 2);
  assert.ok(influencer.payload.ranking.every((row) => row.partnerType === 'influencer'));
  assert.ok(influencer.payload.charts.comparison.every((row) => row.partnerType === 'influencer'));
  assert.ok(influencer.payload.options.partners.every((row) => row.partnerType === 'influencer'));
  assert.deepEqual(influencer.payload.breakdown.map((row) => row.partnerType), ['influencer']);
  assert.equal(influencer.payload.breakdown[0].participationPercentage, 100);
  assert.ok(influencer.payload.indicators.inactive.some((row) => row.partnerId === emptyInfluencerId));
  assert.ok(!influencer.payload.indicators.inactive.some((row) => row.partnerId === emptyAdvisoryId));

  const advisory = await request(baseUrl, `/api/admin/partner-dashboard?city=${encodeURIComponent(city)}&partner_type=sports_advisory&pageSize=100`, authHeaders);
  assert.equal(advisory.response.status, 200);
  assert.equal(advisory.payload.summary.totalRegistrations, 12);
  assert.ok(advisory.payload.ranking.every((row) => row.partnerType === 'sports_advisory'));
  assert.ok(advisory.payload.charts.comparison.every((row) => row.partnerType === 'sports_advisory'));

  const conflict = await request(baseUrl, '/api/admin/partner-dashboard?partnerType=influencer&partner_type=sports_advisory', authHeaders);
  assert.equal(conflict.response.status, 422);
  const invalid = await request(baseUrl, '/api/admin/partner-dashboard?partnerType=ambassador', authHeaders);
  assert.equal(invalid.response.status, 422);

  const csv = await request(baseUrl, `/api/admin/partner-dashboard/export?city=${encodeURIComponent(city)}&partnerType=influencer&format=csv`, authHeaders);
  assert.equal(csv.response.status, 200);
  assert.ok(csv.payload.includes('Tipo do parceiro'));
  assert.ok(csv.payload.includes('influencer'));
  assert.ok(!csv.payload.includes('sports_advisory'));
  assert.equal(csv.payload.trim().split('\n').length, 9);
  const excel = await request(baseUrl, `/api/admin/partner-dashboard/export?city=${encodeURIComponent(city)}&partner_type=sports_advisory&format=excel`, authHeaders);
  assert.equal(excel.response.status, 200);
  assert.ok(excel.payload.includes('<Workbook'));
  assert.ok(excel.payload.includes('sports_advisory'));
  assert.ok(!excel.payload.includes('influencer'));

  const monitoring = await request(baseUrl, '/api/admin/partner-monitoring?partnerType=influencer&pageSize=100', authHeaders);
  assert.equal(monitoring.response.status, 200);
  assert.ok(monitoring.payload.partners.every((row) => row.partnerType === 'influencer'));
  assert.ok(monitoring.payload.totals.accesses >= 8);
  const audit = await request(baseUrl, '/api/admin/partner-audit?partner_type=influencer&pageSize=100', authHeaders);
  assert.equal(audit.response.status, 200);
  assert.ok(audit.payload.logs.every((row) => row.metadata.partner_type === 'influencer'));

  await database.query('analyze "run-registrations"');
  await database.query('analyze "run-partners"');
  await database.query('set enable_seqscan=off');
  const registrationPlan = await database.query(`explain (analyze,buffers,format json) select count(*) from "run-registrations" where partner_id is not null and partner_type='influencer' and status='paid'`);
  const partnerPlan = await database.query(`explain (analyze,buffers,format json) select id from "run-partners" where deleted_at is null and partner_type='influencer' and status='active'`);
  const plans = JSON.stringify([registrationPlan.rows[0]['QUERY PLAN'], partnerPlan.rows[0]['QUERY PLAN']]);
  assert.match(plans, /run-registrations_partner_type_status_created_idx/);
  assert.match(plans, /run-partners_type_status_idx/);
  await database.query('set enable_seqscan=on');

  const migration = await database.query(`select 1 from "run-schema-migrations" where name='20260724_i6_partner_analytics.sql'`);
  assert.equal(migration.rowCount, 1);
  console.log('I6 verificada: dashboard unificado, filtros camel/snake, ranking, metricas, graficos, exportacoes, monitoramento e planos PostgreSQL validos.');
} finally {
  server.close();
  await database.query('set enable_seqscan=on').catch(() => undefined);
  await database.query(`alter table "run-partner-audit-logs" disable trigger "run-partner-audit-immutable"`).catch(() => undefined);
  await database.query(`delete from "run-partner-audit-logs" where partner_id=any($1::uuid[])`, [partnerIds]).catch(() => undefined);
  await database.query(`alter table "run-partner-audit-logs" enable trigger "run-partner-audit-immutable"`).catch(() => undefined);
  await database.query(`delete from "run-registrations" where id like $1`, [`${registrationPrefix}-%`]).catch(() => undefined);
  await database.query(`delete from "run-partners" where id=any($1::uuid[])`, [partnerIds]).catch(() => undefined);
  await database.query(`delete from "run-admin-sessions" where id=$1`, [sessionId]).catch(() => undefined);
  await database.end();
}

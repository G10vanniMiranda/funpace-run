import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { readPostgresDatabase } from '../server/database';
import { buildExecutiveDashboard } from '../server/operational-intelligence';
import { scopeDatabaseToEvent } from '../server/event-scope';

// ADMIN-002 Stage 5C — the executive dashboard / summary event filter is pushed
// into SQL: the read is scoped by event, not a global load + Node filter.

const db = readFileSync('server/database.ts', 'utf8');
const server = readFileSync('server/index.ts', 'utf8');

function block(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `${startNeedle} located`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  return source.slice(start, end >= 0 ? end : undefined);
}

test('the admin-dashboard read pushes the event filter into SQL, parameterised', () => {
  const read = block(db, 'export async function readPostgresDatabase', '\n  return {');
  // registrations / lots / distances: WHERE event_id = $1
  assert.match(read, /LEAN_REGISTRATION_SELECT\} where event_id = \$1`, eventScopedParams/);
  assert.match(read, /from \$\{table\.lots\} where event_id = \$1`, eventScopedParams/);
  assert.match(read, /from \$\{table\.distances\} where event_id = \$1`, eventScopedParams/);
  // payments / payment-events / check-ins / kit-deliveries: EXISTS chain to event_id = $1
  assert.match(read, /LEAN_PAYMENT_SELECT\} p where exists \(select 1 from \$\{table\.registrations\} r where r\.id = p\.registration_id and r\.event_id = \$1\)`, eventScopedParams/);
  assert.match(read, /LEAN_PAYMENT_EVENT_SELECT\} pe where exists \(select 1 from \$\{table\.payments\} p join \$\{table\.registrations\} r on r\.id = p\.registration_id where p\.id = pe\.payment_id and r\.event_id = \$1\)`, eventScopedParams/);
  assert.match(read, /from \$\{table\.checkIns\} ci where exists \(select 1 from \$\{table\.registrations\} r where r\.id = ci\.registration_id and r\.event_id = \$1\)`, eventScopedParams/);
  assert.match(read, /from \$\{table\.kitDeliveries\} kd where exists \(select 1 from \$\{table\.registrations\} r where r\.id = kd\.registration_id and r\.event_id = \$1\)`, eventScopedParams/);
  // resolution uses the ONE Stage 4B authority — never events[0] / latest / slug
  assert.match(read, /resolveEventScope\(\s*events\.rows\.map/);
  assert.ok(!/events\.rows\[0\]/.test(read));
  assert.ok(!/'funpace-run-2026'/.test(read));
  // event id reaches SQL only as a bound parameter
  assert.ok(!/where event_id = '\$\{/.test(read), 'no string interpolation of event id');
});

test('both dashboard endpoints thread eventId / eventSlug into the scoped read', () => {
  const exec = block(server, 'async function handleAdminExecutiveDashboard', '\nasync function ');
  const summary = block(server, 'async function handleAdminSummary', '\nasync function ');
  for (const handler of [exec, summary]) {
    assert.match(handler, /scope: 'admin-dashboard',\s*\n\s*eventId: url\.searchParams\.get\('eventId'\) \|\| undefined,/);
    assert.match(handler, /eventSlug: url\.searchParams\.get\('eventSlug'\) \|\| url\.searchParams\.get\('event'\) \|\| undefined,/);
  }
});

test('ADMIN-002 Stage 5C migration: one statement, CREATE INDEX CONCURRENTLY, (event_id, status), no others', () => {
  const files = readdirSync('server/migrations').filter((f) => f.endsWith('.sql'));
  const mig = files.find((f) => f.includes('registration_event_status_index'));
  assert.ok(mig, 'migration file present');
  const sql = readFileSync(`server/migrations/${mig}`, 'utf8');
  const statements = sql.split(';').map((s) => s.replace(/--.*$/gm, '').trim()).filter(Boolean);
  assert.equal(statements.length, 1, 'exactly one statement (lone simple query -> CONCURRENTLY allowed)');
  assert.match(statements[0], /create index concurrently if not exists "run-registrations_event_status_idx"/i);
  assert.match(statements[0], /on "run-registrations" \(event_id, status\)/i);
  assert.ok(!/\bbegin\b|\bcommit\b/i.test(sql), 'no transaction control');
});

// ---- SQL-level isolation + parity via a mock Queryable ----

type Raw = Record<string, unknown>;
const events: Raw[] = [
  { id: 'A', name: 'Event A', slug: 'a', status: 'published', date: '2026-09-20', start_time: '06:00', location_name: 'Arena', city: 'Porto Velho', state: 'RO' },
  { id: 'B', name: 'Event B', slug: 'b', status: 'published', date: '2026-10-20', start_time: '06:00', location_name: 'Arena', city: 'Manaus', state: 'AM' },
];
const registrations: Raw[] = [
  { id: 'ra1', event_id: 'A', distance_id: 'A-d', lot_id: 'A-l', cpf_hash: 'shared', status: 'paid', amount_cents: 10000, payload: { city: 'Porto Velho', gender: 'female', shirtSize: 'M', distance: '5K', birthDate: '1996-01-01' }, created_at: '2026-08-24T09:00:00.000Z', updated_at: '2026-08-24T09:00:00.000Z', expires_at: null, paid_at: '2026-08-24T12:00:00.000Z', confirmed_at: '2026-08-24T12:00:00.000Z', confirmation_email_sent_at: null, confirmation_email_error: null },
  { id: 'ra2', event_id: 'A', distance_id: 'A-d', lot_id: 'A-l', cpf_hash: 'only-a', status: 'expired', amount_cents: 10000, payload: { city: 'Porto Velho', gender: 'male', shirtSize: 'G', distance: '5K', birthDate: '1990-01-01' }, created_at: '2026-08-20T09:00:00.000Z', updated_at: '2026-08-20T09:00:00.000Z', expires_at: '2026-08-21T00:00:00.000Z', paid_at: null, confirmed_at: null, confirmation_email_sent_at: null, confirmation_email_error: null },
  { id: 'rb1', event_id: 'B', distance_id: 'B-d', lot_id: 'B-l', cpf_hash: 'shared', status: 'paid', amount_cents: 20000, payload: { city: 'Manaus', gender: 'female', shirtSize: 'GG', distance: '10K', birthDate: '1996-01-01' }, created_at: '2026-08-24T10:00:00.000Z', updated_at: '2026-08-24T10:00:00.000Z', expires_at: null, paid_at: '2026-08-24T13:00:00.000Z', confirmed_at: '2026-08-24T13:00:00.000Z', confirmation_email_sent_at: null, confirmation_email_error: null },
];
const payments: Raw[] = [
  { id: 'pa1', registration_id: 'ra1', provider: 'infinitepay', status: 'paid', amount_cents: 10000, provider_payment_id: 'x1', checkout_url: 'https://c/x1', created_at: '', updated_at: '2026-08-24T12:00:00.000Z', expires_at: null, paid_at: '2026-08-24T12:00:00.000Z', gateway_status: 'paid' },
  { id: 'pb1', registration_id: 'rb1', provider: 'infinitepay', status: 'paid', amount_cents: 20000, provider_payment_id: 'x2', checkout_url: 'https://c/x2', created_at: '', updated_at: '2026-08-24T13:00:00.000Z', expires_at: null, paid_at: '2026-08-24T13:00:00.000Z', gateway_status: 'paid' },
];
const paymentEvents: Raw[] = [
  { id: 'ea1', payment_id: 'pa1', provider_event_id: 'n1', event_type: 'infinitepay.checkout_created', received_at: '2026-08-24T11:00:00.000Z' },
  { id: 'eb1', payment_id: 'pb1', provider_event_id: 'n2', event_type: 'infinitepay.checkout_created', received_at: '2026-08-24T11:30:00.000Z' },
];
const lots: Raw[] = [
  { id: 'A-l', event_id: 'A', name: 'Lote A', price_cents: 10000, capacity: 100, sold_count: 0, status: 'active', starts_at: '', ends_at: '', order_index: 1, continues_after_capacity: false },
  { id: 'B-l', event_id: 'B', name: 'Lote B', price_cents: 20000, capacity: 100, sold_count: 0, status: 'active', starts_at: '', ends_at: '', order_index: 1, continues_after_capacity: false },
];
const distances: Raw[] = [
  { id: 'A-d', event_id: 'A', name: '5K', distance_km: 5, capacity: 100, status: 'active' },
  { id: 'B-d', event_id: 'B', name: '10K', distance_km: 10, capacity: 100, status: 'active' },
];
const checkIns: Raw[] = [{ id: 'ci-a', registration_id: 'ra1', status: 'checked_in', checked_in_at: '', checked_in_by: 'x', notes: null }, { id: 'ci-b', registration_id: 'rb1', status: 'checked_in', checked_in_at: '', checked_in_by: 'x', notes: null }];
const kitDeliveries: Raw[] = [{ id: 'k-a', registration_id: 'ra1', status: 'delivered', delivered_at: '', delivered_by: 'x', notes: null }, { id: 'k-b', registration_id: 'rb1', status: 'delivered', delivered_at: '', delivered_by: 'x', notes: null }];

const regEvent = (id: unknown) => registrations.find((r) => r.id === id)?.event_id;
const payEvent = (id: unknown) => regEvent(payments.find((p) => p.id === id)?.registration_id);

// `honourScope: false` makes the client ignore the pushed-down `where event_id = $1`
// and hand back every row — the "old" GLOBAL LOAD. The real client obviously
// honours the filter; this variant only exists so the parity oracle can compare
// "SQL filtered" against "loaded global, then Node-filtered" through one mapper.
function mockClient(honourScope = true) {
  const calls: Array<{ table: string; params: unknown[] }> = [];
  const client = {
    calls,
    async query(sql: string, params: unknown[] = []) {
      const s = sql.toLowerCase();
      const ev = params[0];
      const scoped = honourScope && /event_id = \$1/.test(s);
      const pick = <T extends {}>(all: T[], keep: (row: T) => boolean) => (scoped ? all.filter(keep) : all);
      // dispatch on the PRIMARY table (first `from "run-..."`), not a bare
      // substring — the EXISTS chains also mention "run-registrations".
      const primary = (s.match(/\bfrom "(run-[a-z-]+)"/) || [])[1];
      switch (primary) {
        case 'run-events': calls.push({ table: 'events', params }); return { rows: events };
        case 'run-registrations': calls.push({ table: 'registrations', params }); return { rows: pick(registrations, (r) => r.event_id === ev) };
        case 'run-payment-events': calls.push({ table: 'paymentEvents', params }); return { rows: pick(paymentEvents, (e) => payEvent(e.payment_id) === ev) };
        case 'run-payments': calls.push({ table: 'payments', params }); return { rows: pick(payments, (p) => regEvent(p.registration_id) === ev) };
        case 'run-lots': calls.push({ table: 'lots', params }); return { rows: pick(lots, (l) => l.event_id === ev) };
        case 'run-distances': calls.push({ table: 'distances', params }); return { rows: pick(distances, (d) => d.event_id === ev) };
        case 'run-check-ins': calls.push({ table: 'checkIns', params }); return { rows: pick(checkIns, (c) => regEvent(c.registration_id) === ev) };
        case 'run-kit-deliveries': calls.push({ table: 'kitDeliveries', params }); return { rows: pick(kitDeliveries, (k) => regEvent(k.registration_id) === ev) };
        default: calls.push({ table: `other:${primary ?? s.slice(0, 40)}`, params }); return { rows: [] };
      }
    },
  };
  return client;
}

test('§29/§30 the admin-dashboard read returns only the selected event (SQL-scoped), same cpf across events', async () => {
  const a = await readPostgresDatabase(mockClient() as never, 'admin-dashboard', { eventId: 'A' });
  assert.deepEqual(a.registrations.map((r) => r.id).sort(), ['ra1', 'ra2']);
  assert.deepEqual(a.payments.map((p) => p.id), ['pa1']);
  assert.deepEqual(a.paymentEvents.map((e) => e.id), ['ea1']);
  assert.deepEqual(a.lots.map((l) => l.id), ['A-l']);
  assert.deepEqual(a.distances.map((d) => d.id), ['A-d']);
  assert.deepEqual(a.checkIns.map((c) => c.id), ['ci-a']);
  assert.deepEqual(a.kitDeliveries.map((k) => k.id), ['k-a']);
  // same cpf_hash 'shared' also exists in Event B — must not leak into A
  assert.ok(!a.registrations.some((r) => r.id === 'rb1'));

  const b = await readPostgresDatabase(mockClient() as never, 'admin-dashboard', { eventId: 'B' });
  assert.deepEqual(b.registrations.map((r) => r.id), ['rb1']);
  assert.deepEqual(b.payments.map((p) => p.id), ['pb1']);
});

test('§40 the event id reaches SQL only as a bound parameter ($1), never interpolated', async () => {
  const client = mockClient();
  await readPostgresDatabase(client as never, 'admin-dashboard', { eventId: 'A' });
  for (const table of ['registrations', 'payments', 'paymentEvents', 'lots', 'distances', 'checkIns', 'kitDeliveries']) {
    const call = client.calls.find((c) => c.table === table);
    assert.ok(call, `${table} was queried`);
    assert.deepEqual(call.params, ['A'], `${table} filtered by bound param $1 = 'A'`);
  }
});

test('§34/§35 selecting 1 of many events materialises ~1 event of rows (multi-event fixture)', async () => {
  const many: Raw[] = Array.from({ length: 10 }, (_, i) => ({ id: `E${i}`, name: `E${i}`, slug: `e${i}`, status: 'published', date: '2026-09-20', start_time: '06:00', location_name: 'x', city: 'x', state: 'RO' }));
  const manyRegs: Raw[] = many.flatMap((e) => [0, 1, 2].map((n) => ({ id: `${e.id}-r${n}`, event_id: e.id, distance_id: null, lot_id: null, cpf_hash: `c${n}`, status: 'paid', amount_cents: 10000, payload: {}, created_at: '2026-08-24T09:00:00.000Z', updated_at: '2026-08-24T09:00:00.000Z', expires_at: null, paid_at: '2026-08-24T12:00:00.000Z', confirmed_at: '2026-08-24T12:00:00.000Z', confirmation_email_sent_at: null, confirmation_email_error: null })));
  const client = {
    async query(sql: string, params: unknown[] = []) {
      const s = sql.toLowerCase();
      if (s.includes('"run-events"')) return { rows: many };
      if (s.includes('"run-registrations"') && /event_id = \$1/.test(s)) return { rows: manyRegs.filter((r) => r.event_id === params[0]) };
      return { rows: [] };
    },
  };
  const db = await readPostgresDatabase(client as never, 'admin-dashboard', { eventSlug: 'e7' });
  assert.equal(db.registrations.length, 3, 'only the selected event\'s rows are loaded, not all 30');
  assert.ok(db.registrations.every((r) => r.eventId === 'E7'));
});

test('§31/§32 parity — SQL push-down == GLOBAL LOAD then scopeDatabaseToEvent (one mapper)', async () => {
  const NOW = new Date('2026-08-26T15:00:00.000Z');
  const norm = (d: ReturnType<typeof buildExecutiveDashboard>) => { const { generatedAt, ...rest } = d as Record<string, unknown>; void generatedAt; return rest; };

  for (const eventId of ['A', 'B']) {
    const sqlScoped = await readPostgresDatabase(mockClient(true) as never, 'admin-dashboard', { eventId });
    // honourScope:false === the pre-5C behaviour (global load), narrowed in Node afterwards
    const globalLoad = await readPostgresDatabase(mockClient(false) as never, 'admin-dashboard', { eventId });
    const nodeScoped = scopeDatabaseToEvent(globalLoad, eventId);

    assert.deepEqual(sqlScoped.registrations.map((r) => r.id).sort(), nodeScoped.registrations.map((r) => r.id).sort(), `${eventId}: same registrations`);
    assert.deepEqual(sqlScoped.payments.map((p) => p.id).sort(), nodeScoped.payments.map((p) => p.id).sort(), `${eventId}: same payments`);
    assert.deepEqual(
      norm(buildExecutiveDashboard(sqlScoped, NOW, { eventId })),
      norm(buildExecutiveDashboard(nodeScoped, NOW, { eventId })),
      `${eventId}: identical executive dashboard`,
    );
  }
});

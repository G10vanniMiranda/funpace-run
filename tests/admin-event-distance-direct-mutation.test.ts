import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// ADMIN-UX-RELIABILITY Wave 3A — STAGE 2: PATCH /api/admin/event-config and
// PATCH /api/admin/distances/:id must run as narrow, single-row PostgreSQL
// transactions (run-events + run-audit-logs / run-distances + run-audit-logs),
// NOT the generic full-database blob mechanism, mirroring the proven shape of
// updateLotConfigurationInPostgres (EVENT-OPS-001).
//
// Repo convention: no jsdom / no live PG in unit tests; the transactional
// behaviour is proven against real PostgreSQL in homolog separately, and the
// wiring / scope is locked here against source.

const serverIndex = readFileSync('server/index.ts', 'utf8');
const serverDatabase = readFileSync('server/database.ts', 'utf8');

function eventHandler(): string {
  const start = serverIndex.indexOf('async function handleAdminEventUpdate(');
  const end = serverIndex.indexOf('\nasync function handleAdminDistanceUpdate(');
  assert.ok(start >= 0 && end > start, 'handleAdminEventUpdate located');
  return serverIndex.slice(start, end);
}

function distanceHandler(): string {
  const start = serverIndex.indexOf('async function handleAdminDistanceUpdate(');
  const end = serverIndex.indexOf('\nasync function handleAdminLotUpdate(');
  assert.ok(start >= 0 && end > start, 'handleAdminDistanceUpdate located');
  return serverIndex.slice(start, end);
}

function eventMutation(): string {
  const start = serverDatabase.indexOf('export async function updateEventConfigurationInPostgres(');
  const end = serverDatabase.indexOf('export type DistanceConfigurationUpdateInput');
  assert.ok(start >= 0 && end > start, 'updateEventConfigurationInPostgres located');
  return serverDatabase.slice(start, end);
}

function distanceMutation(): string {
  const start = serverDatabase.indexOf('export type DistanceConfigurationUpdateInput');
  const end = serverDatabase.indexOf('export async function snapshot()');
  assert.ok(start >= 0 && end > start, 'updateDistanceConfigurationInPostgres located');
  return serverDatabase.slice(start, end);
}

// strip // and /* */ comments so assertions test executable code, not prose
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

test('performance regression guard: event/distance config no longer touches the full-database blob path', () => {
  const eh = code(eventHandler());
  assert.doesNotMatch(eh, /\btransaction\s*[<(]/, 'event handler does not call the generic transaction()');
  assert.doesNotMatch(eh, /readPostgresDatabase/, 'event handler does not read the whole database');
  assert.doesNotMatch(eh, /savePostgresDatabase/, 'event handler does not rewrite the whole database');
  assert.match(eh, /await updateEventConfigurationInPostgres\(\{/, 'event handler delegates to the narrow mutation');

  const dh = code(distanceHandler());
  assert.doesNotMatch(dh, /\btransaction\s*[<(]/, 'distance handler does not call the generic transaction()');
  assert.doesNotMatch(dh, /readPostgresDatabase/, 'distance handler does not read the whole database');
  assert.doesNotMatch(dh, /savePostgresDatabase/, 'distance handler does not rewrite the whole database');
  assert.match(dh, /await updateDistanceConfigurationInPostgres\(\{/, 'distance handler delegates to the narrow mutation');

  for (const fn of [code(eventMutation()), code(distanceMutation())]) {
    assert.doesNotMatch(fn, /readPostgresDatabase/, 'narrow mutation never reads the full database');
    assert.doesNotMatch(fn, /savePostgresDatabase/, 'narrow mutation never rewrites the full database');
    assert.doesNotMatch(fn, /hashtext\('funpace-run-write'\)/, 'narrow mutation does not take the global application write lock');
    assert.doesNotMatch(fn, /ensureConfiguredLots/, 'narrow mutation does not touch lot seeding');
  }
});

test('event mutation touches ONLY run-events (one row) and run-audit-logs (one row)', () => {
  const fn = eventMutation();
  const tableRefs = [...fn.matchAll(/\$\{table\.(\w+)\}/g)].map((m) => m[1]);
  const distinct = [...new Set(tableRefs)].sort();
  assert.deepEqual(distinct, ['auditLogs', 'events'], `unexpected tables touched: ${distinct.join(', ')}`);

  const updates = [...fn.matchAll(/update \$\{table\.events\}/g)];
  assert.equal(updates.length, 1, 'exactly one UPDATE run-events');
  assert.match(fn, /update \$\{table\.events\}[\s\S]*?where id = \$1\s*\n\s*returning /, 'UPDATE is scoped to where id = $1');

  const inserts = [...fn.matchAll(/insert into \$\{table\.(\w+)\}/g)].map((m) => m[1]);
  assert.deepEqual(inserts, ['auditLogs'], 'the only INSERT is the audit row');
  assert.match(fn, /'event\.updated', 'event', \$4/, 'audit action/entity are event.updated / event');
});

test('distance mutation touches ONLY run-distances (one row), run-registrations (read-only occupancy) and run-audit-logs (one row)', () => {
  const fn = distanceMutation();
  const tableRefs = [...fn.matchAll(/\$\{table\.(\w+)\}/g)].map((m) => m[1]);
  const distinct = [...new Set(tableRefs)].sort();
  assert.deepEqual(distinct, ['auditLogs', 'distances', 'registrations'], `unexpected tables touched: ${distinct.join(', ')}`);

  // registrations is read-only (occupancy count), never written
  assert.doesNotMatch(fn, /update \$\{table\.registrations\}/, 'registrations is never written');
  assert.doesNotMatch(fn, /insert into \$\{table\.registrations\}/, 'registrations is never written');
  assert.match(fn, /select count\(\*\)::int as n from \$\{table\.registrations\}/, 'occupancy is a scalar count, not a full scan into memory');

  const updates = [...fn.matchAll(/update \$\{table\.distances\}/g)];
  assert.equal(updates.length, 1, 'exactly one UPDATE run-distances');
  assert.match(fn, /update \$\{table\.distances\}[\s\S]*?where id = \$1\s*\n\s*returning /, 'UPDATE is scoped to where id = $1');

  const inserts = [...fn.matchAll(/insert into \$\{table\.(\w+)\}/g)].map((m) => m[1]);
  assert.deepEqual(inserts, ['auditLogs'], 'the only INSERT is the audit row');
  assert.match(fn, /'distance\.updated', 'distance', \$4/, 'audit action/entity are distance.updated / distance');
});

test('transaction envelope: begin, bounded timeouts, commit, rollback on every early return and on throw', () => {
  for (const fn of [eventMutation(), distanceMutation()]) {
    assert.match(fn, /await client\.query\('begin'\)/, 'opens a transaction');
    assert.match(fn, /set local lock_timeout = '5s'/, 'bounded lock wait (< 15s client timeout)');
    assert.match(fn, /set local statement_timeout = '10s'/, 'bounded statement time (< 15s client timeout)');
    assert.match(fn, /await client\.query\('commit'\)/, 'commits the successful path');
    const rollbacks = [...fn.matchAll(/await client\.query\('rollback'\)/g)].length;
    assert.ok(rollbacks >= 3, `expected a rollback on every early exit, found ${rollbacks}`);
    assert.match(fn, /catch \(error\) \{\s*await client\.query\('rollback'\)[\s\S]*?throw error;/, 'rollback + rethrow on unexpected error');
    assert.match(fn, /finally \{\s*client\.release\(\);/, 'always releases the client');
  }
});

test('audit atomicity: the audit INSERT is inside the same transaction as the UPDATE, before COMMIT', () => {
  const eventFn = eventMutation();
  const eUpdateAt = eventFn.search(/update \$\{table\.events\}\s*\n\s*set /);
  const eAuditAt = eventFn.indexOf('insert into ${table.auditLogs}');
  const eCommitAt = eventFn.indexOf("await client.query('commit')");
  assert.ok(eUpdateAt >= 0 && eAuditAt > eUpdateAt && eCommitAt > eAuditAt, 'event: order is UPDATE -> INSERT audit -> COMMIT');
  assert.equal(eventFn.slice(eUpdateAt, eAuditAt).includes("client.query('commit')"), false, 'no commit between event UPDATE and audit INSERT');

  const distanceFn = distanceMutation();
  const dUpdateAt = distanceFn.search(/update \$\{table\.distances\}\s*\n\s*set /);
  const dAuditAt = distanceFn.indexOf('insert into ${table.auditLogs}');
  const dCommitAt = distanceFn.indexOf("await client.query('commit')");
  assert.ok(dUpdateAt >= 0 && dAuditAt > dUpdateAt && dCommitAt > dAuditAt, 'distance: order is UPDATE -> INSERT audit -> COMMIT');
  assert.equal(distanceFn.slice(dUpdateAt, dAuditAt).includes("client.query('commit')"), false, 'no commit between distance UPDATE and audit INSERT');
});

test('no-op contract: unchanged event/distance config short-circuits BEFORE any write, zero audit, explicit *_UNCHANGED outcome', () => {
  const eventFn = eventMutation();
  const eNoOpAt = eventFn.indexOf("Object.keys(diffAfter).length === 0");
  const eUpdateAt = eventFn.search(/update \$\{table\.events\}\s*\n\s*set /);
  assert.ok(eNoOpAt >= 0 && eUpdateAt > eNoOpAt, 'event no-op check runs before the UPDATE');
  assert.match(eventFn, /outcome: 'EVENT_CONFIG_UNCHANGED'/, 'event exposes an explicit unchanged outcome');
  assert.match(eventFn, /outcome: 'EVENT_CONFIG_UPDATED'/, 'event exposes an explicit updated outcome');

  const distanceFn = distanceMutation();
  const dNoOpAt = distanceFn.indexOf('capacity === before.capacity && input.status === before.status');
  const dUpdateAt = distanceFn.search(/update \$\{table\.distances\}\s*\n\s*set /);
  assert.ok(dNoOpAt >= 0 && dUpdateAt > dNoOpAt, 'distance no-op check runs before the UPDATE');
  assert.match(distanceFn, /outcome: 'DISTANCE_CONFIG_UNCHANGED'/, 'distance exposes an explicit unchanged outcome');
  assert.match(distanceFn, /outcome: 'DISTANCE_CONFIG_UPDATED'/, 'distance exposes an explicit updated outcome');
});

test('partial-update contract: event diffs field-by-field, never blind-overwrites an untouched field', () => {
  const fn = eventMutation();
  // each allowed field is individually compared/skipped when it matches the
  // current row, and only genuinely changed fields enter diffBefore/diffAfter
  assert.match(fn, /if \(value === working\[field\]\) continue;/, 'unchanged fields are skipped, never re-written');
  assert.match(fn, /diffBefore\[field\] = working\[field\];/);
  assert.match(fn, /diffAfter\[field\] = value;/);
  // the audit payload records only the touched fields, not the whole row
  assert.match(fn, /before: diffBefore, after: diffAfter/, 'audit before/after is the diff, not the full row');
});

test('distance keeps its existing all-or-nothing contract: capacity and status are always both required together (no partial-field concept invented)', () => {
  const fn = distanceMutation();
  assert.match(fn, /capacity: number;/, 'capacity is a required (non-optional) input field');
  assert.match(fn, /status: string;/, 'status is a required (non-optional) input field');
});

test('INCIDENT-002 regression guard: event/distance config never references run-lots, run-payments or run-check-ins', () => {
  for (const fn of [eventMutation(), distanceMutation()]) {
    assert.doesNotMatch(fn, /\$\{table\.lots\}/, 'no lot table reference');
    assert.doesNotMatch(fn, /\$\{table\.payments\}/, 'no payment table reference');
    assert.doesNotMatch(fn, /\$\{table\.checkIns\}/, 'no check-in table reference');
    assert.doesNotMatch(fn, /\$\{table\.kitDeliveries\}/, 'no kit-delivery table reference');
  }
});

test('distance status 23514 (DB-layer check-constraint gap for sold_out) is mapped to the same 400 the app-layer validation already promises, never leaked raw', () => {
  const fn = distanceMutation();
  assert.match(fn, /function isDistanceStatusCheckViolation/, 'defensive classifier exists');
  assert.match(fn, /candidate\.code !== '23514'/, 'classifies on the Postgres CHECK-violation SQLSTATE');
  assert.match(fn, /'run-distances_status_check'/, 'scoped to the known constraint name');
  assert.match(
    fn,
    /if \(isDistanceStatusCheckViolation\(error\)\) \{[\s\S]*?statusCode: 400, payload: \{ message: 'Status de distancia invalido\.' \}/,
    '23514 maps to the same 400 message as the app-layer status validation',
  );
});

test('API contract preserved: administrator-only, reason gate, response shapes { event } / { distance }', () => {
  const eh = eventHandler();
  assert.match(eh, /requireAdmin\(req, res, \['administrator'\]\)/);
  assert.match(eh, /requireAdminDatabase\(res\)/);
  assert.match(eh, /reason\.length < 5/);
  assert.match(eh, /Informe um motivo com pelo menos 5 caracteres\./);
  assert.match(eh, /json\(res, result\.statusCode, result\.payload\)/);

  const dh = distanceHandler();
  assert.match(dh, /requireAdmin\(req, res, \['administrator'\]\)/);
  assert.match(dh, /requireAdminDatabase\(res\)/);
  assert.match(dh, /reason\.length < 5/);
  assert.match(dh, /Informe um motivo com pelo menos 5 caracteres\./);
  assert.match(dh, /json\(res, result\.statusCode, result\.payload\)/);

  const eventFn = eventMutation();
  assert.match(eventFn, /statusCode: 200, payload: \{ event: after, outcome: 'EVENT_CONFIG_UPDATED' \}/);
  assert.match(eventFn, /statusCode: 404, payload: \{ message: 'Evento nao encontrado\.' \}/);

  const distanceFn = distanceMutation();
  assert.match(distanceFn, /statusCode: 200, payload: \{ distance: after, outcome: 'DISTANCE_CONFIG_UPDATED' \}/);
  assert.match(distanceFn, /statusCode: 404, payload: \{ message: 'Distancia nao encontrada\.' \}/);
});

test('distance HTTP status codes are preserved exactly: 409 for capacity below occupancy, 400 for invalid status', () => {
  const fn = distanceMutation();
  assert.match(
    fn,
    /capacity < occupied\)[\s\S]*?statusCode: 409,[\s\S]*?A capacidade nao pode ser menor que \$\{occupied\} vagas ocupadas\./,
    'capacity-vs-occupied invariant is 409, exact message preserved',
  );
  assert.match(
    fn,
    /!\['active', 'inactive', 'sold_out'\]\.includes\(input\.status\)[\s\S]*?statusCode: 400,[\s\S]*?Status de distancia invalido\./,
    'invalid status is 400, exact message preserved',
  );
});

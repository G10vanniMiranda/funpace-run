import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// EVENT-OPS-001 — STAGE 2B: PATCH /api/admin/lots/:id must run as a narrow,
// single-row PostgreSQL transaction (run-lots + run-audit-logs), NOT the generic
// full-database blob mechanism.
//
// Production evidence (Stage 2A): the previous path was
//   requireAdmin -> transaction()
//     -> pg_advisory_xact_lock('funpace-run-write')   (global write lock)
//     -> readPostgresDatabase(scope='all')            (14 full-table SELECTs)
//     -> mutate in-memory database
//     -> savePostgresDatabase(full database)          (full-blob upsert)
//     -> commit
// which, under organic webhook traffic, blew past the 15s client timeout and
// the authorized lot-3 price PATCH timed out without committing.
//
// Repo convention: no jsdom / no live PG in unit tests; the transactional
// behaviour is proven against real PostgreSQL in homolog separately, and the
// wiring / scope is locked here against source.

const serverIndex = readFileSync('server/index.ts', 'utf8');
const serverDatabase = readFileSync('server/database.ts', 'utf8');

function lotHandler(): string {
  const start = serverIndex.indexOf('async function handleAdminLotUpdate(');
  const end = serverIndex.indexOf('\nasync function handleAdminSystemCheck(');
  assert.ok(start >= 0 && end > start, 'handleAdminLotUpdate located');
  return serverIndex.slice(start, end);
}

function directMutation(): string {
  const start = serverDatabase.indexOf('export async function updateLotConfigurationInPostgres(');
  // ADMIN-UX-RELIABILITY Wave 3A inserted its own narrow event/distance
  // primitives directly after this function (before `snapshot()`) — pin the
  // slice end to that wave-unique marker so it never grows to swallow them.
  const end = serverDatabase.indexOf('// ADMIN-UX-RELIABILITY Wave 3A');
  assert.ok(start >= 0 && end > start, 'updateLotConfigurationInPostgres located');
  return serverDatabase.slice(start, end);
}

// strip // and /* */ comments so assertions test executable code, not prose
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

test('performance regression guard: lot updates no longer touch the full-database blob path', () => {
  const handler = code(lotHandler());
  assert.doesNotMatch(handler, /\btransaction\s*[<(]/, 'handler does not call the generic transaction()');
  assert.doesNotMatch(handler, /readPostgresDatabase/, 'handler does not read the whole database');
  assert.doesNotMatch(handler, /savePostgresDatabase/, 'handler does not rewrite the whole database');
  assert.match(handler, /await updateLotConfigurationInPostgres\(\{/, 'handler delegates to the narrow mutation');

  const fn = code(directMutation());
  assert.doesNotMatch(fn, /readPostgresDatabase/, 'narrow mutation never reads the full database');
  assert.doesNotMatch(fn, /savePostgresDatabase/, 'narrow mutation never rewrites the full database');
  assert.doesNotMatch(
    fn,
    /hashtext\('funpace-run-write'\)/,
    'narrow mutation does not take the global application write lock',
  );
});

test('the narrow mutation touches ONLY run-lots (one row) and run-audit-logs (one row)', () => {
  const fn = directMutation();

  // every table reference in the function body
  const tableRefs = [...fn.matchAll(/\$\{table\.(\w+)\}/g)].map((m) => m[1]);
  const distinct = [...new Set(tableRefs)].sort();
  assert.deepEqual(distinct, ['auditLogs', 'lots'], `unexpected tables touched: ${distinct.join(', ')}`);

  // exactly one UPDATE and it targets a single row by primary key
  const updates = [...fn.matchAll(/update \$\{table\.lots\}/g)];
  assert.equal(updates.length, 1, 'exactly one UPDATE run-lots');
  assert.match(fn, /update \$\{table\.lots\}[\s\S]*?where id = \$1\s*\n\s*returning /, 'UPDATE is scoped to where id = $1');

  // exactly one INSERT and it is the lot.updated audit row
  const inserts = [...fn.matchAll(/insert into \$\{table\.(\w+)\}/g)].map((m) => m[1]);
  assert.deepEqual(inserts, ['auditLogs'], 'the only INSERT is the audit row');
  assert.match(fn, /'lot\.updated', 'lot', \$4/, 'audit action/entity are lot.updated / lot');
});

test('transaction envelope: begin, bounded timeouts, commit, rollback on every early return and on throw', () => {
  const fn = directMutation();
  assert.match(fn, /await client\.query\('begin'\)/, 'opens a transaction');
  assert.match(fn, /set local lock_timeout = '5s'/, 'bounded lock wait (< 15s client timeout)');
  assert.match(fn, /set local statement_timeout = '10s'/, 'bounded statement time (< 15s client timeout)');
  assert.match(fn, /await client\.query\('commit'\)/, 'commits the successful path');

  // one rollback per validation early-return, plus the catch, plus the 404
  const rollbacks = [...fn.matchAll(/await client\.query\('rollback'\)/g)].length;
  assert.ok(rollbacks >= 6, `expected a rollback on every early exit, found ${rollbacks}`);
  assert.match(fn, /catch \(error\) \{\s*await client\.query\('rollback'\)[\s\S]*?throw error;/, 'rollback + rethrow on unexpected error');
  assert.match(fn, /finally \{\s*client\.release\(\);/, 'always releases the client');
});

test('audit atomicity: the audit INSERT is inside the same transaction as the UPDATE, before COMMIT', () => {
  const fn = directMutation();
  const updateAt = fn.search(/update \$\{table\.lots\}\s*\n\s*set /);
  const auditAt = fn.indexOf('insert into ${table.auditLogs}');
  const commitAt = fn.indexOf("await client.query('commit')");
  assert.ok(updateAt >= 0 && auditAt > updateAt && commitAt > auditAt, 'order is UPDATE -> INSERT audit -> COMMIT');
  // no COMMIT between the UPDATE and the audit INSERT
  assert.equal(fn.slice(updateAt, auditAt).includes("client.query('commit')"), false, 'no commit between lot UPDATE and audit INSERT');
});

test('one-active-lot invariant: checked only when activating, event-scoped, before the write', () => {
  const fn = directMutation();
  const guardAt = fn.indexOf("if (input.status === 'active')");
  const updateAt = fn.search(/update \$\{table\.lots\}\s*\n\s*set /);
  assert.ok(guardAt >= 0 && updateAt > guardAt, 'active-lot guard runs before the UPDATE');
  assert.match(
    fn,
    /where event_id = \$1 and id <> \$2 and status = 'active'/,
    'guard is scoped to sibling lots of the same event',
  );
  assert.match(fn, /pg_advisory_xact_lock\(hashtext\(\$1::text\)\)/, 'event-scoped advisory lock serialises concurrent lot-config mutations');
  assert.match(fn, /funpace-run-lot-config:\$\{targetRow\.event_id\}/, 'advisory lock key is per-event');
});

test('API contract preserved: administrator-only, reason gate, response shape { lot }', () => {
  const handler = lotHandler();
  assert.match(handler, /requireAdmin\(req, res, \['administrator'\]\)/);
  assert.match(handler, /requireAdminDatabase\(res\)/);
  assert.match(handler, /reason\.length < 5/);
  assert.match(handler, /Informe um motivo com pelo menos 5 caracteres\./);
  assert.match(handler, /json\(res, result\.statusCode, result\.payload\)/);

  const fn = directMutation();
  assert.match(fn, /return \{ statusCode: 200, payload: \{ lot: after \} \}/, 'success payload is { lot }');
  assert.match(fn, /statusCode: 404, payload: \{ message: 'Lote nao encontrado\.' \}/);
});

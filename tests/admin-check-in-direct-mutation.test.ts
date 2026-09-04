import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// ADMIN-UX-RELIABILITY Wave 2B — POST /api/admin/registrations/:id/check-in and
// the undo-check-in branch of POST .../undo-check-in must run as narrow,
// single-row PostgreSQL transactions (run-check-ins one row + run-audit-logs one
// row), NOT the generic full-database blob mechanism.
//
// Previous path: requireAdmin -> transaction()  [persist:true, scope='all']
//   -> pg_advisory_xact_lock('funpace-run-write')
//   -> readPostgresDatabase(scope='all')   (17-table read)
//   -> mutate one array in memory
//   -> savePostgresDatabase(full database)  (17-table upsert, NO DELETE)
//   -> commit
// The legacy undo-check-in therefore appended a 'registration.undo-check-in'
// audit row while LEAVING the run-check-ins side row in place — an intentional
// bugfix here (savePostgresDatabase is upsert-only; no DELETE for run-check-ins
// exists anywhere in the legacy path).
//
// Repo convention: no jsdom / no live PG in unit tests; the transactional +
// concurrency + physical-DELETE behaviour is proven against real PostgreSQL in
// homolog separately.

const serverIndex = readFileSync('server/index.ts', 'utf8');
const serverDatabase = readFileSync('server/database.ts', 'utf8');

function checkInHandler(): string {
  const a = serverIndex.indexOf('async function handleAdminCheckIn(');
  const b = serverIndex.indexOf('\nasync function handleAdminKitDelivery(');
  assert.ok(a >= 0 && b > a, 'handleAdminCheckIn located');
  return serverIndex.slice(a, b);
}
function undoBranch(): string {
  const a = serverIndex.indexOf('async function handleAdminRegistrationMaintenance(');
  const b = serverIndex.indexOf('\n// PARTICIPANT-OPS-001 CASE A / Stage A2 — deliberate, single-shot recovery');
  assert.ok(a >= 0 && b > a, 'handleAdminRegistrationMaintenance located');
  return serverIndex.slice(a, b);
}
function checkInPrimitive(): string {
  const a = serverDatabase.indexOf('export async function checkInRegistrationInPostgres(');
  const b = serverDatabase.indexOf('export type RegistrationCheckInUndoInput', a);
  assert.ok(a >= 0 && b > a, 'checkInRegistrationInPostgres located');
  return serverDatabase.slice(a, b);
}
function undoPrimitive(): string {
  const a = serverDatabase.indexOf('export async function undoRegistrationCheckInInPostgres(');
  // stop before the ADMIN-UX-RELIABILITY Wave 2C kit primitives that follow
  const b = serverDatabase.indexOf('ADMIN-UX-RELIABILITY Wave 2C', a);
  assert.ok(a >= 0 && b > a, 'undoRegistrationCheckInInPostgres located');
  return serverDatabase.slice(a, b);
}
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

// ---------------------------------------------------------------------------
// §11 / §33 — the FULL_BLOB writer is gone from the check-in operation
// ---------------------------------------------------------------------------
test('§11: handleAdminCheckIn no longer reaches transaction()/savePostgresDatabase/global lock/auto-migrate', () => {
  const h = code(checkInHandler());
  assert.doesNotMatch(h, /\btransaction\s*</, 'no generic mutating transaction<...>()');
  assert.doesNotMatch(h, /savePostgresDatabase/);
  assert.doesNotMatch(h, /pg_advisory_xact_lock|funpace-run-write/);
  assert.doesNotMatch(h, /ensureConfiguredLots|ensurePostgresReady/);
  assert.match(h, /await checkInRegistrationInPostgres\(\{/, 'delegates to the narrow primitive');
  const tx = [...h.matchAll(/transaction\(/g)].length;
  assert.equal(tx, 1, 'exactly one transaction() call remains — the response refresh');
  assert.match(h, /transaction\(\(current\) => current, \{ persist: false, scope: 'admin-registrations' \}\)/);
});

test('§18: the undo-check-in branch delegates; the shared generic transaction() stays for undo-kit + cancel JSON fallback', () => {
  const m = code(undoBranch());
  assert.match(m, /if \(action === 'undo-check-in' && usesPostgresDatabase\(\)\) \{/, 'a dedicated Postgres branch for undo-check-in');
  assert.match(m, /await undoRegistrationCheckInInPostgres\(\{/, 'undo-check-in delegates to the narrow primitive');
  // the generic transaction() line is STILL there (undo-kit + cancel JSON fallback)
  assert.match(m, /const result = await transaction<\{ statusCode: number; payload: unknown \}>\(\(database\) => \{/);
  // …and undo-kit is untouched inside it
  assert.match(m, /action === 'undo-kit'[\s\S]*?database\.kitDeliveries = database\.kitDeliveries\.filter/);
});

test('§11: neither primitive reaches the generic full-blob path', () => {
  for (const [name, fn] of [['check-in', code(checkInPrimitive())], ['undo', code(undoPrimitive())]] as const) {
    assert.doesNotMatch(fn, /readPostgresDatabase|savePostgresDatabase/, `${name}: no full-dataset read/write`);
    assert.doesNotMatch(fn, /\btransaction\s*[<(]/, `${name}: no delegation back to transaction()`);
    assert.doesNotMatch(fn, /ensurePostgresReady|ensureConfiguredLots|assertRuntimeAutoMigrateAllowed/, `${name}: no auto-migrate trigger`);
    assert.doesNotMatch(fn, /pg_advisory_xact_lock/, `${name}: no advisory lock — different registrations run fully in parallel`);
  }
});

// ---------------------------------------------------------------------------
// §8 / cross-wave lock order
// ---------------------------------------------------------------------------
test('§8: both primitives take run-registrations FOR UPDATE OF r as the FIRST statement', () => {
  for (const [name, fn] of [['check-in', checkInPrimitive()], ['undo', undoPrimitive()]] as const) {
    const lockAt = fn.search(/select r\.id[\s\S]*?from \$\{table\.registrations\} r where r\.id = \$1 for update of r/);
    const checkInsAt = fn.indexOf('${table.checkIns}');
    const kitAt = fn.indexOf('${table.kitDeliveries}');
    assert.ok(lockAt >= 0, `${name}: registration FOR UPDATE OF r present`);
    assert.ok(checkInsAt < 0 || lockAt < checkInsAt, `${name}: registration lock precedes any run-check-ins access`);
    assert.ok(kitAt < 0 || lockAt < kitAt, `${name}: registration lock precedes any run-kit-deliveries access`);
  }
  // undo order is registrations -> check-ins -> kit-deliveries
  const u = undoPrimitive();
  assert.ok(
    u.indexOf('${table.registrations}') < u.indexOf('${table.checkIns}')
    && u.indexOf('${table.checkIns}') < u.indexOf('${table.kitDeliveries}'),
    'undo reads registrations, then run-check-ins, then run-kit-deliveries (cross-wave lock order)',
  );
});

// ---------------------------------------------------------------------------
// §9 — CHECK-IN write set
// ---------------------------------------------------------------------------
test('§9: successful CHECK_IN writes ONLY run-check-ins (1 INSERT) + run-audit-logs (1 INSERT)', () => {
  const fn = checkInPrimitive();
  const tables = [...new Set([...fn.matchAll(/\$\{table\.(\w+)\}/g)].map((m) => m[1]))].sort();
  assert.deepEqual(tables, ['auditLogs', 'checkIns', 'registrations'], `tables: ${tables.join(',')}`);
  const ciInserts = [...fn.matchAll(/insert into \$\{table\.checkIns\}/g)].length;
  assert.equal(ciInserts, 1, 'exactly one INSERT run-check-ins');
  assert.match(fn, /insert into \$\{table\.checkIns\} \(id, registration_id, status, checked_in_at, checked_in_by, notes\)\s*\n\s*values \(\$1, \$2, 'checked_in', \$3, \$4, \$5\)/);
  assert.doesNotMatch(fn, /update \$\{table\.checkIns\}|delete from \$\{table\.checkIns\}/, 'CHECK_IN never updates/deletes run-check-ins');
  assert.doesNotMatch(fn, /\$\{table\.registrations\} set|update \$\{table\.registrations\}/, 'no registration whole-row rewrite');
  const inserts = [...fn.matchAll(/insert into \$\{table\.(\w+)\}/g)].map((m) => m[1]);
  assert.deepEqual(inserts, ['checkIns', 'auditLogs'], 'INSERT order: run-check-ins then the audit row');
});

// ---------------------------------------------------------------------------
// §10 / §32 — UNDO write set + the physical DELETE the legacy path never did
// ---------------------------------------------------------------------------
test('§10/§32: successful UNDO does ONE physical DELETE run-check-ins + ONE audit INSERT; no other writes', () => {
  const fn = undoPrimitive();
  const tables = [...new Set([...fn.matchAll(/\$\{table\.(\w+)\}/g)].map((m) => m[1]))].sort();
  assert.deepEqual(tables, ['auditLogs', 'checkIns', 'kitDeliveries', 'registrations'], `tables: ${tables.join(',')}`);
  assert.match(fn, /delete from \$\{table\.checkIns\} where registration_id = \$1 returning id/, 'physical DELETE on run-check-ins by registration_id');
  assert.match(fn, /if \(deleted\.rowCount !== 1\)/, 'requires exactly the expected target deletion before auditing');
  // run-kit-deliveries is READ-ONLY here (PG-2 guard) — no write against it
  assert.doesNotMatch(fn, /insert into \$\{table\.kitDeliveries\}|update \$\{table\.kitDeliveries\}|delete from \$\{table\.kitDeliveries\}/, 'kit deliveries are read-only in Wave 2B');
  const inserts = [...fn.matchAll(/insert into \$\{table\.(\w+)\}/g)].map((m) => m[1]);
  assert.deepEqual(inserts, ['auditLogs'], 'the only INSERT is the audit row');
  // DELETE -> audit INSERT -> COMMIT, no COMMIT between (§31 atomicity)
  const delAt = fn.search(/delete from \$\{table\.checkIns\}/);
  const auditAt = fn.indexOf('insert into ${table.auditLogs}');
  const commitAt = fn.indexOf("await client.query('commit')");
  assert.ok(delAt >= 0 && auditAt > delAt && commitAt > auditAt, 'order DELETE -> audit INSERT -> COMMIT');
  assert.equal(fn.slice(delAt, auditAt).includes("client.query('commit')"), false, 'no COMMIT between DELETE and the audit INSERT');
});

// ---------------------------------------------------------------------------
// §7 — PG-2 server invariant
// ---------------------------------------------------------------------------
test('§7: an active kit delivery blocks the undo — read under the held registration lock, no DELETE, no audit', () => {
  const fn = undoPrimitive();
  assert.match(fn, /select id, delivered_at, delivered_by from \$\{table\.kitDeliveries\} where registration_id = \$1/, 'PG-2 guard reads run-kit-deliveries');
  assert.match(fn, /if \(kit\.rows\[0\]\) \{\s*\n\s*await client\.query\('rollback'\);\s*\n\s*return \{\s*\n\s*status: 'kit_delivery_blocks_undo'/, 'kit present -> rollback -> kit_delivery_blocks_undo');
  // the kit read is AFTER the run-registrations FOR UPDATE and AFTER the check-in read
  const lockAt = fn.search(/for update of r/);
  const ciReadAt = fn.search(/select id, checked_in_at, checked_in_by from \$\{table\.checkIns\}/);
  const kitReadAt = fn.search(/select id, delivered_at, delivered_by from \$\{table\.kitDeliveries\}/);
  assert.ok(lockAt < ciReadAt && ciReadAt < kitReadAt, 'lock -> check-in read -> kit guard read');
  // the guard sits BEFORE the DELETE
  assert.ok(kitReadAt < fn.search(/delete from \$\{table\.checkIns\}/), 'PG-2 guard precedes the DELETE');
});

// ---------------------------------------------------------------------------
// §12 / §13 — idempotency: no audit on a semantic no-op or a blocked undo
// ---------------------------------------------------------------------------
test('§12: CHECK_IN when already checked in -> rollback, { already_checked_in }, no INSERT, no audit', () => {
  const fn = checkInPrimitive();
  assert.match(fn, /if \(existing\.rows\[0\]\) \{\s*\n\s*\/\/[\s\S]*?await client\.query\('rollback'\);\s*\n\s*return \{\s*\n\s*status: 'already_checked_in'/);
  const existAt = fn.indexOf('if (existing.rows[0])');
  const insertAt = fn.search(/insert into \$\{table\.checkIns\}/);
  assert.ok(existAt >= 0 && insertAt > existAt, 'the already-checked-in short-circuit precedes the INSERT');
});
test('§13: UNDO when not checked in -> rollback, { already_not_checked_in }, no DELETE, no audit', () => {
  const fn = undoPrimitive();
  assert.match(fn, /if \(!checkIn\.rows\[0\]\) \{\s*\n\s*\/\/[\s\S]*?await client\.query\('rollback'\);\s*\n\s*return \{ status: 'already_not_checked_in' \};/);
  const noopAt = fn.indexOf('if (!checkIn.rows[0])');
  const delAt = fn.search(/delete from \$\{table\.checkIns\}/);
  assert.ok(noopAt >= 0 && delAt > noopAt, 'the no-op short-circuit precedes the DELETE');
});

// ---------------------------------------------------------------------------
// §5 / §6 — transaction envelope
// ---------------------------------------------------------------------------
test('§5/§6: begin, bounded timeouts, commit, rollback on every early return and on throw', () => {
  for (const [name, fn] of [['check-in', checkInPrimitive()], ['undo', undoPrimitive()]] as const) {
    assert.match(fn, /await client\.query\('begin'\)/, `${name}: opens a transaction`);
    assert.match(fn, /set local lock_timeout = '5s'/, `${name}: bounded lock wait`);
    assert.match(fn, /set local statement_timeout = '10s'/, `${name}: bounded statement time`);
    assert.match(fn, /await client\.query\('commit'\)/, `${name}: commits`);
    const rollbacks = [...fn.matchAll(/client\.query\('rollback'\)/g)].length;
    assert.ok(rollbacks >= 3, `${name}: rollback on every early exit + catch (found ${rollbacks})`);
    assert.match(fn, /catch \(error\) \{\s*await client\.query\('rollback'\)[\s\S]*?throw error;/, `${name}: rollback + rethrow`);
    assert.match(fn, /finally \{\s*client\.release\(\);/, `${name}: always releases the client`);
  }
});

// ---------------------------------------------------------------------------
// §15 — audit taxonomy preserved verbatim
// ---------------------------------------------------------------------------
test('§15: audit names are the historical registration.check_in / registration.undo-check-in, unchanged', () => {
  assert.match(checkInPrimitive(), /'registration\.check_in', 'registration', \$4/);
  assert.match(checkInPrimitive(), /JSON\.stringify\(\{ notes: input\.notes \}\)/, 'check-in audit payload = { notes }');
  assert.match(undoPrimitive(), /'registration\.undo-check-in', 'registration', \$4/);
  assert.match(undoPrimitive(), /JSON\.stringify\(\{ reason: input\.reason \}\)/, 'undo audit payload = { reason }');
});

// ---------------------------------------------------------------------------
// §14 — eligibility preserved exactly (paid only, no new policy)
// ---------------------------------------------------------------------------
test('§14: CHECK_IN eligibility is the faithful port — paid registrations only, nothing else', () => {
  const fn = code(checkInPrimitive());
  assert.match(fn, /if \(targetRow\.status !== 'paid'\) \{[\s\S]*?return \{ status: 'not_eligible', message: 'Check-in permitido apenas para inscricoes pagas\.' \}/);
  assert.doesNotMatch(fn, /bib_number|event_status|lot_status|cancelled|refunded/, 'no bib / event / lot / status policy introduced');
});

// ---------------------------------------------------------------------------
// §2 — nothing outside check-in changed
// ---------------------------------------------------------------------------
test('§2: no email / payment / lot / kit-write / bib side effects in the check-in path', () => {
  const h = code(checkInHandler()) + code(undoBranch());
  const fns = code(checkInPrimitive()) + code(undoPrimitive());
  for (const bad of [/processRegistrationEmail/, /run-email-outbox/, /confirmPaymentInPostgres/, /sold_count/, /setRegistrationBibInPostgres/, /releaseRegistrationCapacity/]) {
    assert.doesNotMatch(fns, bad, `primitive: no ${bad}`);
  }
  // undo-kit legacy behaviour is untouched in the shared handler
  assert.match(code(undoBranch()), /canUndoKit\(database\.kitDeliveries\.some/, 'undo-kit legacy branch intact');
});

// ---------------------------------------------------------------------------
// §31 — the check-in UNIQUE index is the concurrency backstop, unchanged
// ---------------------------------------------------------------------------
test('§31: the one-check-in-per-registration UNIQUE index is unchanged and is the 23505 backstop', () => {
  assert.match(serverDatabase, /create unique index if not exists "run-check-ins_registration_id_idx" on \$\{table\.checkIns\}\(registration_id\)/, 'UNIQUE(registration_id) index intact — no migration');
  assert.match(serverDatabase, /function isCheckInRegistrationUniqueViolation\(error: unknown\)/, '23505 classifier exists');
  assert.match(serverDatabase, /candidate\.code !== '23505'/);
  assert.match(serverDatabase, /candidate\.constraint === 'run-check-ins_registration_id_idx'/);
  assert.match(checkInPrimitive(), /isCheckInRegistrationUniqueViolation\(error\)[\s\S]*?status: 'already_checked_in'/, '23505 -> ALREADY_CHECKED_IN');
});

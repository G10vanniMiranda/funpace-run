import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// ADMIN-UX-RELIABILITY Wave 2C — POST /api/admin/registrations/:id/kit and the
// undo-kit branch of POST .../undo-kit must run as narrow, single-row
// PostgreSQL transactions (run-kit-deliveries one row + run-audit-logs one row,
// the audit row ONLY when the kit state actually changes), NOT the generic
// full-database blob mechanism.
//
// Previous path: requireAdmin -> transaction()  [persist:true, scope='all']
//   -> pg_advisory_xact_lock('funpace-run-write')
//   -> readPostgresDatabase(scope='all')   (17-table read)
//   -> mutate one array in memory
//   -> savePostgresDatabase(full database)  (17-table upsert, NO DELETE)
//   -> commit
// The legacy undo-kit therefore appended a 'registration.undo-kit' audit row
// while LEAVING the run-kit-deliveries side row in place — an intentional bugfix
// here (savePostgresDatabase is upsert-only; no DELETE for run-kit-deliveries
// exists anywhere in the legacy path).
//
// PG-1 (Human Product Gate, APPROVED): KIT_DELIVER requires an active check-in.
//
// Repo convention: no jsdom / no live PG in unit tests; the transactional +
// concurrency + physical-DELETE + PG-1 behaviour is proven against real
// PostgreSQL in homolog separately.

const serverIndex = readFileSync('server/index.ts', 'utf8');
const serverDatabase = readFileSync('server/database.ts', 'utf8');

function kitHandler(): string {
  const a = serverIndex.indexOf('async function handleAdminKitDelivery(');
  const b = serverIndex.indexOf('\nasync function handleAdminRegistrationMaintenance(');
  assert.ok(a >= 0 && b > a, 'handleAdminKitDelivery located');
  return serverIndex.slice(a, b);
}
function maintenanceHandler(): string {
  const a = serverIndex.indexOf('async function handleAdminRegistrationMaintenance(');
  const b = serverIndex.indexOf('\n// PARTICIPANT-OPS-001 CASE A / Stage A2 — deliberate, single-shot recovery');
  assert.ok(a >= 0 && b > a, 'handleAdminRegistrationMaintenance located');
  return serverIndex.slice(a, b);
}
function deliverPrimitive(): string {
  const a = serverDatabase.indexOf('export async function deliverRegistrationKitInPostgres(');
  const b = serverDatabase.indexOf('export type RegistrationKitDeliveryUndoInput', a);
  assert.ok(a >= 0 && b > a, 'deliverRegistrationKitInPostgres located');
  return serverDatabase.slice(a, b);
}
function undoKitPrimitive(): string {
  const a = serverDatabase.indexOf('export async function undoRegistrationKitDeliveryInPostgres(');
  const b = serverDatabase.indexOf('ADMIN-UX-HOTFIX-003', a);
  assert.ok(a >= 0 && b > a, 'undoRegistrationKitDeliveryInPostgres located');
  return serverDatabase.slice(a, b);
}
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

// ---------------------------------------------------------------------------
// §12 / §20 — the FULL_BLOB writer is gone from the kit operation
// ---------------------------------------------------------------------------
test('§12: handleAdminKitDelivery no longer reaches transaction()/savePostgresDatabase/global lock/auto-migrate', () => {
  const h = code(kitHandler());
  assert.doesNotMatch(h, /\btransaction\s*</, 'no generic mutating transaction<...>()');
  assert.doesNotMatch(h, /savePostgresDatabase/);
  assert.doesNotMatch(h, /pg_advisory_xact_lock|funpace-run-write/);
  assert.doesNotMatch(h, /ensureConfiguredLots|ensurePostgresReady/);
  assert.match(h, /await deliverRegistrationKitInPostgres\(\{/, 'delegates to the narrow primitive');
  const tx = [...h.matchAll(/transaction\(/g)].length;
  assert.equal(tx, 1, 'exactly one transaction() call remains — the response refresh');
  assert.match(h, /transaction\(\(current\) => current, \{ persist: false, scope: 'admin-registrations' \}\)/);
});

test('§19: the undo-kit branch delegates; the shared generic transaction() stays for the cancel JSON fallback', () => {
  const m = code(maintenanceHandler());
  assert.match(m, /if \(action === 'undo-kit' && usesPostgresDatabase\(\)\) \{/, 'a dedicated Postgres branch for undo-kit');
  assert.match(m, /await undoRegistrationKitDeliveryInPostgres\(\{/, 'undo-kit delegates to the narrow primitive');
  // the Wave 2B undo-check-in branch is untouched
  assert.match(m, /if \(action === 'undo-check-in' && usesPostgresDatabase\(\)\) \{[\s\S]*?await undoRegistrationCheckInInPostgres\(\{/);
  // cancel's own narrow Postgres branch is untouched
  assert.match(m, /if \(action === 'cancel' && usesPostgresDatabase\(\)\) \{[\s\S]*?cancelRegistrationInPostgres/);
  // the generic transaction() line is STILL there (cancel JSON fallback)
  assert.match(m, /const result = await transaction<\{ statusCode: number; payload: unknown \}>\(\(database\) => \{/);
  // …and its cancel branch still references payment cancellation (untouched)
  assert.match(m, /action === 'cancel'[\s\S]*?releaseRegistrationCapacity\(database, registration\)/);
});

test('§12: neither primitive reaches the generic full-blob path', () => {
  for (const [name, fn] of [['deliver', code(deliverPrimitive())], ['undo-kit', code(undoKitPrimitive())]] as const) {
    assert.doesNotMatch(fn, /readPostgresDatabase|savePostgresDatabase/, `${name}: no full-dataset read/write`);
    assert.doesNotMatch(fn, /\btransaction\s*[<(]/, `${name}: no delegation back to transaction()`);
    assert.doesNotMatch(fn, /ensurePostgresReady|ensureConfiguredLots|assertRuntimeAutoMigrateAllowed/, `${name}: no auto-migrate trigger`);
    assert.doesNotMatch(fn, /pg_advisory_xact_lock/, `${name}: no advisory lock — different registrations run fully in parallel`);
  }
});

// ---------------------------------------------------------------------------
// §8 — cross-wave lock order
// ---------------------------------------------------------------------------
test('§8: both primitives take run-registrations FOR UPDATE OF r as the FIRST statement', () => {
  for (const [name, fn] of [['deliver', deliverPrimitive()], ['undo-kit', undoKitPrimitive()]] as const) {
    const lockAt = fn.search(/from \$\{table\.registrations\} r where r\.id = \$1 for update of r/);
    const checkInsAt = fn.indexOf('${table.checkIns}');
    const kitAt = fn.indexOf('${table.kitDeliveries}');
    assert.ok(lockAt >= 0, `${name}: registration FOR UPDATE OF r present`);
    assert.ok(checkInsAt < 0 || lockAt < checkInsAt, `${name}: registration lock precedes any run-check-ins access`);
    assert.ok(kitAt < 0 || lockAt < kitAt, `${name}: registration lock precedes any run-kit-deliveries access`);
  }
  // deliver order is registrations -> check-ins (PG-1) -> kit-deliveries
  const d = deliverPrimitive();
  assert.ok(
    d.indexOf('${table.registrations}') < d.indexOf('${table.checkIns}')
    && d.indexOf('${table.checkIns}') < d.indexOf('${table.kitDeliveries}'),
    'deliver reads registrations, then run-check-ins (PG-1), then run-kit-deliveries',
  );
  // undo-kit does NOT touch run-check-ins (no cross-table guard)
  assert.doesNotMatch(undoKitPrimitive(), /\$\{table\.checkIns\}/, 'undo-kit never references run-check-ins');
});

// ---------------------------------------------------------------------------
// §6 — PG-1 server rule
// ---------------------------------------------------------------------------
test('§6: KIT_DELIVER requires an active check-in — read under the held lock, no INSERT, no audit', () => {
  const fn = deliverPrimitive();
  assert.match(fn, /select id from \$\{table\.checkIns\} where registration_id = \$1/, 'PG-1 guard reads run-check-ins');
  assert.match(fn, /if \(!checkIn\.rows\[0\]\) \{\s*\n\s*await client\.query\('rollback'\);\s*\n\s*return \{ status: 'check_in_required' \};/, 'no check-in -> rollback -> check_in_required');
  // the check-in read is AFTER the run-registrations FOR UPDATE and BEFORE the kit read + INSERT
  const lockAt = fn.search(/for update of r/);
  const ciReadAt = fn.search(/select id from \$\{table\.checkIns\}/);
  const kitReadAt = fn.search(/select id, delivered_at, delivered_by from \$\{table\.kitDeliveries\}/);
  const insertAt = fn.search(/insert into \$\{table\.kitDeliveries\}/);
  assert.ok(lockAt < ciReadAt && ciReadAt < kitReadAt && kitReadAt < insertAt, 'lock -> PG-1 read -> kit read -> INSERT');
  // handler maps it to 409 CHECK_IN_REQUIRED_FOR_KIT_DELIVERY
  assert.match(kitHandler(), /if \(outcome\.status === 'check_in_required'\) \{/);
  assert.match(kitHandler(), /message: 'O kit só pode ser entregue após o check-in\.', code: 'CHECK_IN_REQUIRED_FOR_KIT_DELIVERY'/);
});

// ---------------------------------------------------------------------------
// §10 — KIT_DELIVER write set
// ---------------------------------------------------------------------------
test('§10: successful KIT_DELIVER writes ONLY run-kit-deliveries (1 INSERT) + run-audit-logs (1 INSERT)', () => {
  const fn = deliverPrimitive();
  const tables = [...new Set([...fn.matchAll(/\$\{table\.(\w+)\}/g)].map((m) => m[1]))].sort();
  assert.deepEqual(tables, ['auditLogs', 'checkIns', 'kitDeliveries', 'registrations'], `tables: ${tables.join(',')}`);
  const kdInserts = [...fn.matchAll(/insert into \$\{table\.kitDeliveries\}/g)].length;
  assert.equal(kdInserts, 1, 'exactly one INSERT run-kit-deliveries');
  assert.match(fn, /insert into \$\{table\.kitDeliveries\} \(id, registration_id, status, delivered_at, delivered_by, notes\)\s*\n\s*values \(\$1, \$2, 'delivered', \$3, \$4, \$5\)/);
  assert.doesNotMatch(fn, /update \$\{table\.kitDeliveries\}|delete from \$\{table\.kitDeliveries\}/, 'KIT_DELIVER never updates/deletes run-kit-deliveries');
  assert.doesNotMatch(fn, /insert into \$\{table\.checkIns\}|update \$\{table\.checkIns\}|delete from \$\{table\.checkIns\}/, 'run-check-ins is read-only in the PG-1 guard');
  assert.doesNotMatch(fn, /update \$\{table\.registrations\}/, 'no registration whole-row rewrite');
  const inserts = [...fn.matchAll(/insert into \$\{table\.(\w+)\}/g)].map((m) => m[1]);
  assert.deepEqual(inserts, ['kitDeliveries', 'auditLogs'], 'INSERT order: run-kit-deliveries then the audit row');
});

// ---------------------------------------------------------------------------
// §11 / §15 — UNDO-KIT write set + the physical DELETE the legacy path never did
// ---------------------------------------------------------------------------
test('§11/§15: successful UNDO_KIT does ONE physical DELETE run-kit-deliveries + ONE audit INSERT; no other writes', () => {
  const fn = undoKitPrimitive();
  const tables = [...new Set([...fn.matchAll(/\$\{table\.(\w+)\}/g)].map((m) => m[1]))].sort();
  assert.deepEqual(tables, ['auditLogs', 'kitDeliveries', 'registrations'], `tables: ${tables.join(',')}`);
  assert.match(fn, /delete from \$\{table\.kitDeliveries\} where registration_id = \$1 returning id/, 'physical DELETE on run-kit-deliveries by registration_id');
  assert.match(fn, /if \(deleted\.rowCount !== 1\)/, 'requires exactly the expected target deletion before auditing');
  const inserts = [...fn.matchAll(/insert into \$\{table\.(\w+)\}/g)].map((m) => m[1]);
  assert.deepEqual(inserts, ['auditLogs'], 'the only INSERT is the audit row');
  // DELETE -> audit INSERT -> COMMIT, no COMMIT between (§36 atomicity)
  const delAt = fn.search(/delete from \$\{table\.kitDeliveries\}/);
  const auditAt = fn.indexOf('insert into ${table.auditLogs}');
  const commitAt = fn.indexOf("await client.query('commit')");
  assert.ok(delAt >= 0 && auditAt > delAt && commitAt > auditAt, 'order DELETE -> audit INSERT -> COMMIT');
  assert.equal(fn.slice(delAt, auditAt).includes("client.query('commit')"), false, 'no COMMIT between DELETE and the audit INSERT');
});

// ---------------------------------------------------------------------------
// §13 / §14 — idempotency: no audit on a semantic no-op
// ---------------------------------------------------------------------------
test('§13: KIT_DELIVER when already delivered -> rollback, { already_delivered }, no INSERT, no audit', () => {
  const fn = deliverPrimitive();
  assert.match(fn, /if \(existing\.rows\[0\]\) \{\s*\n\s*\/\/[\s\S]*?await client\.query\('rollback'\);\s*\n\s*return \{\s*\n\s*status: 'already_delivered'/);
  const existAt = fn.indexOf('if (existing.rows[0])');
  const insertAt = fn.search(/insert into \$\{table\.kitDeliveries\}/);
  assert.ok(existAt >= 0 && insertAt > existAt, 'the already-delivered short-circuit precedes the INSERT');
});
test('§14: UNDO_KIT when not delivered -> rollback, { already_not_delivered }, no DELETE, no audit', () => {
  const fn = undoKitPrimitive();
  assert.match(fn, /if \(!kit\.rows\[0\]\) \{\s*\n\s*\/\/[\s\S]*?await client\.query\('rollback'\);\s*\n\s*return \{ status: 'already_not_delivered' \};/);
  const noopAt = fn.indexOf('if (!kit.rows[0])');
  const delAt = fn.search(/delete from \$\{table\.kitDeliveries\}/);
  assert.ok(noopAt >= 0 && delAt > noopAt, 'the no-op short-circuit precedes the DELETE');
});

// ---------------------------------------------------------------------------
// §5 / §7 — transaction envelope
// ---------------------------------------------------------------------------
test('§5/§7: begin, bounded timeouts, commit, rollback on every early return and on throw', () => {
  for (const [name, fn] of [['deliver', deliverPrimitive()], ['undo-kit', undoKitPrimitive()]] as const) {
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
// §17 — audit taxonomy preserved verbatim
// ---------------------------------------------------------------------------
test('§17: audit names are the historical registration.kit_delivered / registration.undo-kit, unchanged', () => {
  assert.match(deliverPrimitive(), /'registration\.kit_delivered', 'registration', \$4/);
  assert.match(deliverPrimitive(), /JSON\.stringify\(\{ notes: input\.notes \}\)/, 'deliver audit payload = { notes }');
  assert.match(undoKitPrimitive(), /'registration\.undo-kit', 'registration', \$4/);
  assert.match(undoKitPrimitive(), /JSON\.stringify\(\{ reason: input\.reason \}\)/, 'undo-kit audit payload = { reason }');
});

// ---------------------------------------------------------------------------
// §16 — eligibility preserved exactly (paid only + PG-1, no other new policy)
// ---------------------------------------------------------------------------
test('§16: KIT_DELIVER eligibility is the faithful port + PG-1 — paid + checked-in, nothing else', () => {
  const fn = code(deliverPrimitive());
  assert.match(fn, /if \(targetRow\.status !== 'paid'\) \{[\s\S]*?return \{ status: 'not_eligible', message: 'Entrega de kit permitida apenas para inscricoes pagas\.' \}/);
  assert.doesNotMatch(fn, /bib_number|event_status|lot_status|cancelled|refunded/, 'no bib / event / lot / status policy introduced');
});

// ---------------------------------------------------------------------------
// §2 — nothing outside kit changed
// ---------------------------------------------------------------------------
test('§2: no email / payment / lot / check-in-write / bib side effects in the kit path', () => {
  const h = code(kitHandler()) + code(maintenanceHandler());
  const fns = code(deliverPrimitive()) + code(undoKitPrimitive());
  for (const bad of [/processRegistrationEmail/, /run-email-outbox/, /confirmPaymentInPostgres/, /sold_count/, /setRegistrationBibInPostgres/, /releaseRegistrationCapacity/]) {
    assert.doesNotMatch(fns, bad, `primitive: no ${bad}`);
  }
  // Wave 2B check-in narrow branch is untouched in the shared handler
  assert.match(code(maintenanceHandler()), /await undoRegistrationCheckInInPostgres\(\{/, 'undo-check-in narrow branch intact');
});

// ---------------------------------------------------------------------------
// §21 — the kit UNIQUE index is the concurrency backstop, unchanged
// ---------------------------------------------------------------------------
test('§21: the one-kit-per-registration UNIQUE index is unchanged and is the 23505 backstop', () => {
  assert.match(serverDatabase, /create unique index if not exists "run-kit-deliveries_registration_id_idx" on \$\{table\.kitDeliveries\}\(registration_id\)/, 'UNIQUE(registration_id) index intact — no migration');
  assert.match(serverDatabase, /function isKitDeliveryRegistrationUniqueViolation\(error: unknown\)/, '23505 classifier exists');
  assert.match(serverDatabase, /candidate\.code !== '23505'/);
  assert.match(serverDatabase, /candidate\.constraint === 'run-kit-deliveries_registration_id_idx'/);
  assert.match(deliverPrimitive(), /isKitDeliveryRegistrationUniqueViolation\(error\)[\s\S]*?status: 'already_delivered'/, '23505 -> KIT_ALREADY_DELIVERED');
});

// ---------------------------------------------------------------------------
// §9 — PG-1 + PG-2 joint invariant is server-enforced in both directions
// ---------------------------------------------------------------------------
test('§9: PG-1 (deliver requires check-in) and PG-2 (kit blocks undo-check-in) are both server-side', () => {
  // PG-1 forward guard lives in deliverRegistrationKitInPostgres
  assert.match(deliverPrimitive(), /return \{ status: 'check_in_required' \}/);
  // PG-2 reverse guard is still live in undoRegistrationCheckInInPostgres (Wave 2B, untouched)
  const undoCheckIn = serverDatabase.slice(
    serverDatabase.indexOf('export async function undoRegistrationCheckInInPostgres('),
    serverDatabase.indexOf('ADMIN-UX-RELIABILITY Wave 2C'),
  );
  assert.match(undoCheckIn, /status: 'kit_delivery_blocks_undo'/, 'PG-2 guard intact');
});

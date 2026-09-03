import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// ADMIN-UX-RELIABILITY Wave 2A — POST /api/admin/registrations/:id/bib-number
// must run as a narrow, single-row PostgreSQL transaction (run-registrations one
// row + run-audit-logs one row, and the audit row ONLY when the bib changes),
// NOT the generic full-database blob mechanism.
//
// Previous path: requireAdmin -> transaction()  [persist:true, scope='all']
//   -> pg_advisory_xact_lock('funpace-run-write')      (global write lock)
//   -> readPostgresDatabase(scope='all')               (16-table read)
//   -> mutate one field in memory
//   -> savePostgresDatabase(full database)             (16-table blob upsert)
//   -> commit
// i.e. the EVENT-OPS-001 / ADMIN-UX-HOTFIX-003 defect class, for a one-column
// update guarded by an event-scoped partial UNIQUE index.
//
// Repo convention: no jsdom / no live PG in unit tests; the transactional +
// concurrency behaviour is proven against real PostgreSQL in homolog separately
// (tests are the wiring / scope / contract lock against source).

const serverIndex = readFileSync('server/index.ts', 'utf8');
const serverDatabase = readFileSync('server/database.ts', 'utf8');

function bibHandler(): string {
  const start = serverIndex.indexOf('async function handleAdminBibNumber(');
  const end = serverIndex.indexOf('\nasync function handleAdminRegistrations(');
  assert.ok(start >= 0 && end > start, 'handleAdminBibNumber located');
  return serverIndex.slice(start, end);
}

function bibPrimitive(): string {
  const start = serverDatabase.indexOf('export type RegistrationBibUpdateInput = {');
  // stop before the ADMIN-UX-RELIABILITY Wave 2B check-in primitives that follow
  const end = serverDatabase.indexOf('ADMIN-UX-RELIABILITY Wave 2B', start);
  assert.ok(start >= 0 && end > start, 'setRegistrationBibInPostgres block located');
  return serverDatabase.slice(start, end);
}

// strip // and /* */ comments so assertions test executable code, not prose
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

// ---------------------------------------------------------------------------
// §34 — the FULL_BLOB writer is gone from the bib operation
// ---------------------------------------------------------------------------
test('§34: the bib handler no longer reaches transaction()/savePostgresDatabase/global lock/auto-migrate', () => {
  const handler = code(bibHandler());
  assert.doesNotMatch(handler, /\btransaction\s*</, 'no generic mutating transaction<...>()');
  assert.doesNotMatch(handler, /savePostgresDatabase/, 'never rewrites the whole database');
  assert.doesNotMatch(handler, /pg_advisory_xact_lock|funpace-run-write/, 'never takes the global write lock');
  assert.doesNotMatch(handler, /ensureConfiguredLots|ensurePostgresReady/, 'no runtime auto-migrate side effect');
  assert.match(handler, /await setRegistrationBibInPostgres\(\{/, 'delegates to the narrow primitive');
  // the ONLY transaction() left is the read-only, unlocked scoped refresh
  const txCalls = [...handler.matchAll(/transaction\(/g)].length;
  assert.equal(txCalls, 1, 'exactly one transaction() call remains — the response refresh');
  assert.match(
    handler,
    /transaction\(\(current\) => current, \{ persist: false, scope: 'admin-registrations' \}\)/,
    'response refresh is persist:false (no advisory lock, not scope=all)',
  );
});

test('§34: the narrow primitive itself never reads/writes the full blob, never auto-migrates', () => {
  const fn = code(bibPrimitive());
  assert.doesNotMatch(fn, /readPostgresDatabase/, 'never reads the full database');
  assert.doesNotMatch(fn, /savePostgresDatabase/, 'never rewrites the full database');
  assert.doesNotMatch(fn, /\btransaction\s*[<(]/, 'does not delegate back to the generic transaction()');
  assert.doesNotMatch(fn, /ensurePostgresReady|ensureConfiguredLots|assertRuntimeAutoMigrateAllowed/, 'no auto-migrate trigger (matches cancelRegistrationInPostgres)');
  assert.doesNotMatch(fn, /pg_advisory_xact_lock/, 'takes NO advisory lock at all — different registrations run fully in parallel');
});

// ---------------------------------------------------------------------------
// §6 — exact write set: run-registrations (≤1 row) + run-audit-logs (≤1 row)
// ---------------------------------------------------------------------------
test('§6: write set is run-registrations (one row) + run-audit-logs (one row) — nothing else', () => {
  const fn = bibPrimitive();
  const tableRefs = [...fn.matchAll(/\$\{table\.(\w+)\}/g)].map((m) => m[1]);
  const distinct = [...new Set(tableRefs)].sort();
  assert.deepEqual(distinct, ['auditLogs', 'events', 'lots', 'registrations'],
    `unexpected tables referenced: ${distinct.join(', ')}`);

  // events + lots are READ-ONLY joins for status; only registrations is written
  assert.doesNotMatch(fn, /update \$\{table\.events\}|insert into \$\{table\.events\}|delete from \$\{table\.events\}/, 'events is read-only');
  assert.doesNotMatch(fn, /update \$\{table\.lots\}|insert into \$\{table\.lots\}|delete from \$\{table\.lots\}/, 'lots is read-only');

  const regUpdates = [...fn.matchAll(/update \$\{table\.registrations\}/g)];
  assert.equal(regUpdates.length, 1, 'exactly one UPDATE run-registrations');
  assert.match(fn, /update \$\{table\.registrations\} set bib_number = \$2, updated_at = \$3 where id = \$1/,
    'UPDATE writes only bib_number + updated_at, scoped to where id = $1');

  const inserts = [...fn.matchAll(/insert into \$\{table\.(\w+)\}/g)].map((m) => m[1]);
  assert.deepEqual(inserts, ['auditLogs'], 'the only INSERT is the audit row');
});

test('§8: bib representation/semantics preserved — no new numbering policy, no silent 0151→151', () => {
  const fn = code(bibPrimitive());
  // the primitive stores exactly what the handler normalised; it never lpad/parseInt/Number()s the bib
  assert.doesNotMatch(fn, /lpad\(|parseInt\(|Number\(nextBibNumber\)|replace\(\/\\D/, 'no re-numbering / zero-stripping of the bib inside the primitive');
  assert.match(fn, /\$\{table\.registrations\} set bib_number = \$2/, 'stores the value verbatim as $2');
  // the handler is the single normalisation point and is unchanged
  const handler = bibHandler();
  assert.match(handler, /compactText\(body\?\.bibNumber, 20\)\.toUpperCase\(\)/, 'handler normalisation unchanged');
  assert.match(handler, /\/\^\[A-Z0-9-\]\{1,20\}\$\/\.test\(bibNumber\)/, 'handler shape check unchanged');
});

// ---------------------------------------------------------------------------
// §7 — the event-scoped partial UNIQUE index is the FINAL authority; 23505 map
// ---------------------------------------------------------------------------
test('§7/§13: SQLSTATE 23505 from the bib index maps to the semantic conflict outcome (no SQL leak)', () => {
  const fn = bibPrimitive();
  assert.match(fn, /function isBibNumberUniqueViolation\(error: unknown\)/, 'a dedicated 23505 classifier exists');
  assert.match(fn, /candidate\.code !== '23505'/, 'keys on SQLSTATE 23505');
  assert.match(fn, /candidate\.constraint === 'run-registrations_event_bib_idx'/, 'and on the bib index name');
  // the UPDATE is wrapped and a unique violation becomes { status: 'conflict' }, not a thrown SQL error
  assert.match(fn, /try \{[\s\S]*?update \$\{table\.registrations\} set bib_number[\s\S]*?\} catch \(error\) \{[\s\S]*?isBibNumberUniqueViolation\(error\)[\s\S]*?return \{ status: 'conflict'/,
    'the UPDATE catch maps 23505 -> conflict (rollback first)');
  assert.doesNotMatch(code(fn), /throw new Error\([^)]*23505|res.*error\.detail|error\.detail/, 'no raw SQL error / detail is surfaced');
});

test('§7: the application pre-check improves the message but is NOT the concurrency authority', () => {
  const fn = bibPrimitive();
  // pre-check exists (fast path / friendly message)…
  assert.match(fn, /select 1 from \$\{table\.registrations\}\s*\n?\s*where event_id = \$1 and bib_number = \$2 and id <> \$3/, 'pre-check select present');
  // …AND the DB-level 23505 catch also exists — both, not either
  assert.match(fn, /isBibNumberUniqueViolation\(error\)/, 'DB-level unique catch also present');
});

// ---------------------------------------------------------------------------
// §5 — required transaction envelope
// ---------------------------------------------------------------------------
test('§5: begin, bounded lock_timeout/statement_timeout, commit, rollback on every early return and on throw', () => {
  const fn = bibPrimitive();
  assert.match(fn, /await client\.query\('begin'\)/, 'opens a transaction');
  assert.match(fn, /set local lock_timeout = '5s'/, 'bounded lock wait (< 15s client timeout)');
  assert.match(fn, /set local statement_timeout = '10s'/, 'bounded statement time (< 15s client timeout)');
  assert.match(fn, /await client\.query\('commit'\)/, 'commits the successful path');

  // rollback on: not_found, no-op (unchanged), guard failure, and the catch
  const rollbacks = [...fn.matchAll(/client\.query\('rollback'\)/g)].length;
  assert.ok(rollbacks >= 4, `expected a rollback on every early exit + the catch, found ${rollbacks}`);
  assert.match(fn, /catch \(error\) \{\s*await client\.query\('rollback'\)[\s\S]*?throw error;/, 'rollback + rethrow on unexpected error');
  assert.match(fn, /finally \{\s*client\.release\(\);/, 'always releases the client');
});

test('§5: FOR UPDATE locks exactly the target registration row (not the joined event/lot rows)', () => {
  const fn = bibPrimitive();
  assert.match(fn, /from \$\{table\.registrations\} r\s*\n\s*join \$\{table\.events\} e on e\.id = r\.event_id\s*\n\s*left join \$\{table\.lots\} l on l\.id = r\.lot_id\s*\n\s*where r\.id = \$1\s*\n\s*for update of r/,
    'single locking SELECT: joins events+lots read-only, FOR UPDATE OF r only');
});

// ---------------------------------------------------------------------------
// §9 — idempotent no-op: same value → no UPDATE, no audit row, 200 BIB_UNCHANGED
// ---------------------------------------------------------------------------
test('§9: canonical bib already == requested → rollback with { status: "unchanged" }, before any write', () => {
  const fn = bibPrimitive();
  assert.match(fn, /if \(previous === nextBibNumber\) \{\s*await client\.query\('rollback'\);\s*return \{ status: 'unchanged', bibNumber: nextBibNumber \};/,
    'no-op returns unchanged and rolls back — no UPDATE, no audit row');
  const noopAt = fn.indexOf('if (previous === nextBibNumber)');
  const updateAt = fn.search(/update \$\{table\.registrations\} set bib_number/);
  const auditAt = fn.indexOf('insert into ${table.auditLogs}');
  assert.ok(noopAt >= 0 && updateAt > noopAt && auditAt > noopAt, 'no-op check precedes both the UPDATE and the audit INSERT');
});

// ---------------------------------------------------------------------------
// §10 — success audit: name + payload shape unchanged, inside the same tx
// ---------------------------------------------------------------------------
test('§10: bib change appends exactly one "registration.bib_assigned" audit row with { reason, previous, bibNumber }', () => {
  const fn = bibPrimitive();
  assert.match(fn, /'registration\.bib_assigned', 'registration', \$4/, 'historical audit name/entity unchanged');
  assert.match(fn, /JSON\.stringify\(\{ reason: input\.reason, previous, bibNumber: nextBibNumber \}\)/, 'payload keys are the historical { reason, previous, bibNumber } — not renamed');
  // actor / role / target / timestamp travel in the dedicated columns
  assert.match(fn, /\(id, actor, actor_role, action, entity_type, entity_id, payload, session_id, ip_address, user_agent, created_at\)/, 'actor/role/target/timestamp columns present');
  assert.match(fn, /input\.audit\.actor,\s*\n\s*input\.audit\.actorRole,/, 'actor + role from the caller');
  // atomic: UPDATE -> audit INSERT -> COMMIT, no commit in between
  const updateAt = fn.search(/update \$\{table\.registrations\} set bib_number/);
  const auditAt = fn.indexOf('insert into ${table.auditLogs}');
  const commitAt = fn.indexOf("await client.query('commit')");
  assert.ok(updateAt >= 0 && auditAt > updateAt && commitAt > auditAt, 'order is UPDATE -> INSERT audit -> COMMIT');
  assert.equal(fn.slice(updateAt, auditAt).includes("client.query('commit')"), false, 'no COMMIT between the bib UPDATE and the audit INSERT (§15 rollback atomicity)');
});

// ---------------------------------------------------------------------------
// §16 — handler delegation + outcome mapping
// ---------------------------------------------------------------------------
test('§16/§17: handler maps primitive results to the machine outcome contract', () => {
  const handler = bibHandler();
  assert.match(handler, /if \(outcome\.status === 'not_found'\) \{ json\(res, 404,/, 'not_found -> 404');
  assert.match(handler, /if \(outcome\.status === 'not_eligible'\) \{ json\(res, 409, \{ message: outcome\.message, code: 'NOT_ELIGIBLE' \}\)/, 'not_eligible -> 409 NOT_ELIGIBLE');
  assert.match(handler, /if \(outcome\.status === 'conflict'\) \{[\s\S]*?json\(res, 409, \{ message: 'Este número de peito já está vinculado a outra inscrição\.', code: 'BIB_CONFLICT' \}\)/, 'conflict -> 409 BIB_CONFLICT with the §11 message');
  assert.match(handler, /outcome: 'BIB_UNCHANGED' as const, message: `O número de peito já estava definido como \$\{bibNumber\}\.`/, 'unchanged -> 200 BIB_UNCHANGED (§24 wording)');
  assert.match(handler, /outcome: 'BIB_UPDATED' as const, message: `Número de peito atualizado para \$\{bibNumber\}\.`/, 'ok -> 200 BIB_UPDATED (§23 wording)');
  assert.match(handler, /withRegistrationView\(payload, adminSession\.role as RegistrationViewRole\)/, '200 payload is role-serialised');
});

test('§11: the conflict message never names the other participant', () => {
  const handler = code(bibHandler());
  const fn = code(bibPrimitive());
  // no place builds a message with someone else's name/email/id
  assert.doesNotMatch(handler + fn, /já está com|pertence a|vinculado a .*\$\{|other\.fullName|takenBy|conflictRegistration/i, 'conflict is generic — no PII of the current owner');
});

// ---------------------------------------------------------------------------
// §18 — RBAC unchanged
// ---------------------------------------------------------------------------
test('§18: RBAC preserved — administrator + operation only, server-enforced, no finance, no IAM change', () => {
  const handler = bibHandler();
  assert.match(handler, /requireAdmin\(req, res, \['administrator', 'operation'\]\)/, 'administrator + operation only');
  assert.match(handler, /requireAdminDatabase\(res\)/, 'Postgres-mode gate (503 otherwise) — no JSON fallback');
  assert.match(handler, /requireJson\(req, res\)/);
  assert.match(handler, /ensureRegistrationEventScope\(res, url, registrationId\)/, 'event scoping preserved');
  assert.doesNotMatch(handler, /'finance'/, 'finance is NOT granted bib access');
});

// ---------------------------------------------------------------------------
// §2 — nothing outside bib changed
// ---------------------------------------------------------------------------
test('§2: no email / payment / lot / check-in / kit side effects anywhere in the bib path', () => {
  const handler = code(bibHandler());
  const fn = code(bibPrimitive());
  for (const forbidden of [/processRegistrationEmail/, /run-email-outbox/, /run-email-deliveries/, /confirmPaymentInPostgres/, /sold_count/, /run-check-ins/, /run-kit-deliveries/, /updateLotConfiguration/, /releaseRegistrationCapacity/]) {
    assert.doesNotMatch(handler, forbidden, `handler: no ${forbidden}`);
    assert.doesNotMatch(fn, forbidden, `primitive: no ${forbidden}`);
  }
});

test('§8: the database bib UNIQUE authority is untouched (still the event-scoped partial index)', () => {
  assert.match(
    serverDatabase,
    /create unique index if not exists "run-registrations_event_bib_idx" on \$\{table\.registrations\}\(event_id, bib_number\) where bib_number is not null/,
    'the partial UNIQUE(event_id, bib_number) index is unchanged — no new/duplicate uniqueness authority',
  );
});

// ---------------------------------------------------------------------------
// §31 — the old generic persistence path is not reachable for this operation
// ---------------------------------------------------------------------------
test('§31: routing unchanged, and the handler has no in-memory database mutation left', () => {
  assert.match(serverIndex, /handleAdminBibNumber\(/, 'handler still wired');
  const handler = code(bibHandler());
  assert.doesNotMatch(handler, /database\.registrations\.find|database\.auditLogs\.push|registration\.bibNumber =/, 'no in-memory blob mutation remains in the handler');
});

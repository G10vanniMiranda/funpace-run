import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// ADMIN-UX-RELIABILITY Wave 4A Stage 2B — POST /api/admin/partnerships/:id/status
// must run as a narrow, single-row PostgreSQL transaction (run-partnership-leads
// one row + run-audit-logs one row, and the audit row ONLY when the status
// changes), NOT the generic full-database blob mechanism.
//
// Previous path: requireAdmin(['administrator']) -> transaction()  [persist:true, scope='all']
//   -> pg_advisory_xact_lock('funpace-run-write')      (global write lock)
//   -> readPostgresDatabase(scope='all')               (16-table read)
//   -> mutate lead.status in memory
//   -> savePostgresDatabase(full database)             (16-table blob upsert)
//   -> commit
//
// Repo convention: no jsdom / no live PG in unit tests; transactional +
// concurrency behaviour is proven against real PostgreSQL in homolog separately.

const serverIndex = readFileSync('server/index.ts', 'utf8');
const serverDatabase = readFileSync('server/database.ts', 'utf8');

function handlerBlock(): string {
  const a = serverIndex.indexOf('async function handleAdminPartnershipStatus(');
  const b = serverIndex.indexOf('\n// ADMIN-003 Stage 1 - CSV Formula Injection hardening.', a);
  assert.ok(a >= 0 && b > a, 'handleAdminPartnershipStatus located');
  return serverIndex.slice(a, b);
}

function primitiveBlock(): string {
  const a = serverDatabase.indexOf('export type PartnershipStatusUpdateInput = {');
  // stop before the Wave 4B Stage 2 lead-create primitive inserted right after
  // updatePartnershipStatusInPostgres.
  const b = serverDatabase.indexOf('ADMIN-UX-RELIABILITY Wave 4B Stage 2 — narrow PostgreSQL persistence', a);
  assert.ok(a >= 0 && b > a, 'updatePartnershipStatusInPostgres block located');
  return serverDatabase.slice(a, b);
}

const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

// ---------------------------------------------------------------------------
// the FULL_BLOB writer is gone from the partnership-status operation
// ---------------------------------------------------------------------------
test('the handler no longer reaches transaction()/savePostgresDatabase/global lock/auto-migrate', () => {
  const h = code(handlerBlock());
  assert.doesNotMatch(h, /\btransaction\s*</, 'no generic mutating transaction<...>()');
  assert.doesNotMatch(h, /savePostgresDatabase/, 'never rewrites the whole database');
  assert.doesNotMatch(h, /pg_advisory_xact_lock|funpace-run-write/, 'never takes the global write lock');
  assert.doesNotMatch(h, /ensureConfiguredLots|ensurePostgresReady/, 'no runtime auto-migrate side effect');
  assert.doesNotMatch(h, /database\.partnershipLeads\.find|database\.auditLogs\.push|createAuditLog\(/, 'no in-memory blob mutation left in the handler');
  assert.match(h, /await updatePartnershipStatusInPostgres\(\{/, 'delegates to the narrow primitive');
  assert.equal([...h.matchAll(/transaction\(/g)].length, 0, 'zero transaction() calls remain in the handler');
});

test('the narrow primitive never reads/writes the full blob, never auto-migrates, takes NO advisory lock', () => {
  const fn = code(primitiveBlock());
  assert.doesNotMatch(fn, /readPostgresDatabase/, 'never reads the full database');
  assert.doesNotMatch(fn, /savePostgresDatabase/, 'never rewrites the full database');
  assert.doesNotMatch(fn, /\btransaction\s*[<(]/, 'does not delegate back to the generic transaction()');
  assert.doesNotMatch(fn, /ensurePostgresReady|ensureConfiguredLots|assertRuntimeAutoMigrateAllowed/, 'no auto-migrate trigger');
  assert.doesNotMatch(fn, /pg_advisory_xact_lock/, 'takes NO advisory lock — different leads run fully in parallel');
});

// ---------------------------------------------------------------------------
// exact write set: run-partnership-leads (<=1 row) + run-audit-logs (<=1 row)
// ---------------------------------------------------------------------------
test('write set is run-partnership-leads (one row) + run-audit-logs (one row) — nothing else', () => {
  const fn = primitiveBlock();
  const tableRefs = [...fn.matchAll(/\$\{table\.(\w+)\}/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(tableRefs)].sort(), ['auditLogs', 'partnershipLeads'],
    `unexpected tables referenced: ${[...new Set(tableRefs)].join(', ')}`);

  const updates = [...fn.matchAll(/update \$\{table\.partnershipLeads\}/g)];
  assert.equal(updates.length, 1, 'exactly one UPDATE run-partnership-leads');
  assert.match(fn, /update \$\{table\.partnershipLeads\} set status = \$2, updated_at = \$3 where id = \$1/,
    'UPDATE writes only status + updated_at, scoped to where id = $1');

  const inserts = [...fn.matchAll(/insert into \$\{table\.(\w+)\}/g)].map((m) => m[1]);
  assert.deepEqual(inserts, ['auditLogs'], 'the only INSERT is the audit row');

  // no financial / attribution / other-table column ever named
  for (const forbidden of ['registrations', 'payments', 'run-lots', 'sold_count', 'coupon', 'partner_id', 'discount', 'run-email', 'company_name = ', 'contact_name = ', 'corporate_email = ']) {
    assert.ok(!fn.includes(`${forbidden}`) || forbidden === 'partner_id', `primitive must not touch ${forbidden}`);
  }
  // the UPDATE statement specifically only sets status + updated_at
  const updateStmt = fn.slice(fn.indexOf('update ${table.partnershipLeads}'), fn.indexOf('insert into ${table.auditLogs}'));
  assert.ok(!/company_name|contact_name|contact_role|corporate_email|involvement_message|source/.test(updateStmt.replace(/returning[\s\S]*/, '')),
    'UPDATE SET clause changes only status + updated_at (RETURNING may list all columns for the response)');
});

// ---------------------------------------------------------------------------
// required transaction envelope
// ---------------------------------------------------------------------------
test('begin, bounded lock_timeout/statement_timeout, commit, rollback on every early return and on throw', () => {
  const fn = primitiveBlock();
  assert.match(fn, /await client\.query\('begin'\)/);
  assert.match(fn, /set local lock_timeout = '5s'/);
  assert.match(fn, /set local statement_timeout = '10s'/);
  assert.match(fn, /await client\.query\('commit'\)/);
  const rollbacks = [...fn.matchAll(/client\.query\('rollback'\)/g)].length;
  assert.ok(rollbacks >= 3, `expected a rollback on not_found + no-op + the catch, found ${rollbacks}`);
  assert.match(fn, /catch \(error\) \{\s*await client\.query\('rollback'\)\.catch\(\(\) => undefined\);\s*throw error;/);
  assert.match(fn, /finally \{\s*client\.release\(\);/);
});

test('FOR UPDATE locks exactly the target partnership-lead row', () => {
  const fn = primitiveBlock();
  assert.match(fn, /from \$\{table\.partnershipLeads\} where id = \$1 for update/,
    'single locking SELECT: FOR UPDATE on the one lead row');
});

// ---------------------------------------------------------------------------
// idempotent no-op: same status -> no UPDATE, no audit row, "unchanged"
// ---------------------------------------------------------------------------
test('authoritative status already == requested -> rollback with { status: "unchanged" }, before any write', () => {
  const fn = primitiveBlock();
  assert.match(fn, /if \(previousStatus === input\.nextStatus\) \{\s*await client\.query\('rollback'\);\s*return \{ status: 'unchanged', lead: mapPartnershipLeadRow\(targetRow\) \};/,
    'no-op returns unchanged and rolls back — no UPDATE, no audit row');
  const noopAt = fn.indexOf('if (previousStatus === input.nextStatus)');
  const updateAt = fn.search(/update \$\{table\.partnershipLeads\} set status/);
  const auditAt = fn.indexOf('insert into ${table.auditLogs}');
  assert.ok(noopAt >= 0 && updateAt > noopAt && auditAt > noopAt, 'no-op check precedes both the UPDATE and the audit INSERT');
});

test('not found -> rollback with { status: "not_found" }, before any write', () => {
  const fn = primitiveBlock();
  assert.match(fn, /if \(!targetRow\) \{\s*await client\.query\('rollback'\);\s*return \{ status: 'not_found' \};/);
});

// ---------------------------------------------------------------------------
// audit contract: name preserved, previousStatus added, one row, same tx
// ---------------------------------------------------------------------------
test('a real transition appends exactly one "partnership.status_updated" audit row with { status, previousStatus }', () => {
  const fn = primitiveBlock();
  assert.match(fn, /'partnership\.status_updated', 'partnership', \$4/, 'historical audit action / entity unchanged');
  assert.match(fn, /JSON\.stringify\(\{ status: input\.nextStatus, previousStatus \}\)/,
    'payload keeps the historical `status` key and ADDS `previousStatus` (Stage 1 §K gap; strictly additive)');
  assert.match(fn, /\(id, actor, actor_role, action, entity_type, entity_id, payload, session_id, ip_address, user_agent, created_at\)/,
    'actor / role / target / session / ip / ua / timestamp columns present');
  assert.match(fn, /input\.audit\.actor,\s*\n\s*input\.audit\.actorRole,/, 'actor + role travel from the caller');
  // atomic: UPDATE -> audit INSERT -> COMMIT, no commit between
  const updateAt = fn.search(/update \$\{table\.partnershipLeads\} set status/);
  const auditAt = fn.indexOf('insert into ${table.auditLogs}');
  const commitAt = fn.indexOf("await client.query('commit')");
  assert.ok(updateAt >= 0 && auditAt > updateAt && commitAt > auditAt, 'order is UPDATE -> INSERT audit -> COMMIT');
  assert.equal(fn.slice(updateAt, auditAt).includes("client.query('commit')"), false, 'no COMMIT between the UPDATE and the audit INSERT');
});

test('no audit row is written for a no-op (the unchanged branch returns before the INSERT)', () => {
  const fn = primitiveBlock();
  const noopReturnAt = fn.indexOf("return { status: 'unchanged'");
  const auditAt = fn.indexOf('insert into ${table.auditLogs}');
  assert.ok(noopReturnAt >= 0 && noopReturnAt < auditAt, 'the unchanged return precedes the only audit INSERT');
});

// ---------------------------------------------------------------------------
// handler delegation + outcome mapping + response contract
// ---------------------------------------------------------------------------
test('handler maps primitive results to the preserved HTTP contract', () => {
  const h = handlerBlock();
  assert.match(h, /const outcome = await updatePartnershipStatusInPostgres\(\{\s*\n\s*partnershipId,\s*\n\s*nextStatus,\s*\n\s*audit: \{/);
  assert.match(h, /if \(outcome\.status === 'not_found'\) \{\s*json\(res, 404, \{ message: 'Proposta de parceria nao encontrada\.' \}\);/, 'not_found -> 404 (unchanged wording)');
  assert.match(h, /json\(res, 200, \{ partnership: toAdminPartnershipLead\(outcome\.lead\) \}\);/, 'updated AND unchanged -> 200 { partnership } (unchanged shape)');
  assert.match(h, /if \(outcome\.status === 'updated'\) \{\s*const task = await queuePartnershipGoogleSheetSync\(partnershipId\);\s*\n\s*if \(task\) await processGoogleSheetSync\(task\.id\);/,
    'the Sheet re-sync fires only on a real transition');
  assert.doesNotMatch(h, /queuePartnershipGoogleSheetSync\(partnershipId\)[\s\S]*if \(outcome\.status === 'unchanged'\)/, 'no re-sync path for unchanged');
});

test('the audit actorRole is passed explicitly (administrator) — parity with the previous createAuditLog fallback', () => {
  const h = handlerBlock();
  assert.match(h, /audit: \{\s*\n\s*actor: adminSession\.actor,\s*\n\s*actorRole: adminSession\.role,\s*\n\s*sessionId: adminSession\.id,\s*\n\s*ipAddress: getClientIp\(req\),\s*\n\s*userAgent: getUserAgent\(req\),\s*\n\s*createdAt: new Date\(\)\.toISOString\(\),/);
});

// ---------------------------------------------------------------------------
// no email / payment / lot / registration side effects anywhere in the path
// ---------------------------------------------------------------------------
test('no email / payment / lot / registration / other-partnership side effects in the whole partnership-status path', () => {
  const h = code(handlerBlock());
  const fn = code(primitiveBlock());
  for (const forbidden of [/processRegistrationEmail/, /run-email-outbox/, /run-email-deliveries/, /confirmPaymentInPostgres/, /\bsold_count\b/, /update \$\{table\.lots\}/, /update \$\{table\.payments\}/, /update \$\{table\.registrations\}/, /releaseRegistrationCapacity/, /partnershipLeads.*where id <> \$1/] ) {
    assert.doesNotMatch(h, forbidden, `handler: no ${forbidden}`);
    assert.doesNotMatch(fn, forbidden, `primitive: no ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// routing unchanged
// ---------------------------------------------------------------------------
test('routing: POST /api/admin/partnerships/:id/status is still wired to handleAdminPartnershipStatus', () => {
  assert.match(serverIndex, /const adminPartnershipAction = url\.pathname\.match\(\/\^\\\/api\\\/admin\\\/partnerships\\\/\(\[\^\/\]\+\)\\\/status\$\/\);/);
  assert.match(serverIndex, /if \(req\.method === 'POST' && adminPartnershipAction\) \{\s*\n?\s*await handleAdminPartnershipStatus\(req, res, decodeURIComponent\(adminPartnershipAction\[1\]\)\);/);
});

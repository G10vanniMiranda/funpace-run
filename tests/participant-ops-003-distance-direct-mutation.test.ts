import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// PARTICIPANT-OPS-003 Stage 2 — POST /api/admin/registrations/:id/distance must
// run as a narrow, single-row PostgreSQL transaction (run-registrations one row
// + run-audit-logs one row, and the audit row ONLY when the distance changes),
// NEVER the generic full-database blob mechanism.
//
// Repo convention: no jsdom / no live PG in unit tests; the transactional +
// concurrency behaviour is proven against real PostgreSQL in homolog separately
// (.tmp/p3-distance-homolog-proof.mts). These tests lock the wiring / scope /
// contract against source.

const serverIndex = readFileSync('server/index.ts', 'utf8');
const serverDatabase = readFileSync('server/database.ts', 'utf8');

function distanceHandler(): string {
  const start = serverIndex.indexOf('async function handleAdminRegistrationDistance(');
  const end = serverIndex.indexOf('\nasync function handleAdminRegistrations(');
  assert.ok(start >= 0 && end > start, 'handleAdminRegistrationDistance located');
  return serverIndex.slice(start, end);
}

function distancePrimitive(): string {
  const start = serverDatabase.indexOf('export type RegistrationDistanceCorrectionInput = {');
  const end = serverDatabase.indexOf('ADMIN-UX-RELIABILITY Wave 2B', start);
  assert.ok(start >= 0 && end > start, 'correctRegistrationDistanceInPostgres block located');
  return serverDatabase.slice(start, end);
}

// strip // and /* */ comments so assertions test executable code, not prose
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

// ---------------------------------------------------------------------------
// narrow-primitive containment — no FULL_BLOB writer anywhere in the path
// ---------------------------------------------------------------------------
test('the distance handler never reaches transaction<...>()/savePostgresDatabase/global lock/auto-migrate', () => {
  const handler = code(distanceHandler());
  assert.doesNotMatch(handler, /\btransaction\s*</, 'no generic mutating transaction<...>()');
  assert.doesNotMatch(handler, /savePostgresDatabase/, 'never rewrites the whole database');
  assert.doesNotMatch(handler, /pg_advisory_xact_lock|funpace-run-write/, 'never takes the global write lock');
  assert.doesNotMatch(handler, /ensureConfiguredLots|ensurePostgresReady/, 'no runtime auto-migrate side effect');
  assert.match(handler, /await correctRegistrationDistanceInPostgres\(\{/, 'delegates to the narrow primitive');
  const txCalls = [...handler.matchAll(/transaction\(/g)].length;
  assert.equal(txCalls, 1, 'exactly one transaction() call remains — the response refresh');
  assert.match(handler, /transaction\(\(current\) => current, \{ persist: false, scope: 'admin-registrations' \}\)/, 'response refresh is persist:false, not scope=all');
});

test('the narrow primitive never reads/writes the full blob, never auto-migrates, takes NO advisory lock', () => {
  const fn = code(distancePrimitive());
  assert.doesNotMatch(fn, /readPostgresDatabase/, 'never reads the full database');
  assert.doesNotMatch(fn, /savePostgresDatabase/, 'never rewrites the full database');
  assert.doesNotMatch(fn, /\btransaction\s*[<(]/, 'does not delegate back to the generic transaction()');
  assert.doesNotMatch(fn, /ensurePostgresReady|ensureConfiguredLots|assertRuntimeAutoMigrateAllowed/, 'no auto-migrate trigger');
  assert.doesNotMatch(fn, /pg_advisory_xact_lock/, 'takes NO advisory lock — different registrations run fully in parallel');
});

// ---------------------------------------------------------------------------
// exact write set: run-registrations (≤1 row) + run-audit-logs (≤1 row)
// ---------------------------------------------------------------------------
test('write set is run-registrations (one row) + run-audit-logs (one row) — distances is a read-only validation', () => {
  const fn = distancePrimitive();
  const tableRefs = [...fn.matchAll(/\$\{table\.(\w+)\}/g)].map((m) => m[1]);
  const distinct = [...new Set(tableRefs)].sort();
  assert.deepEqual(distinct, ['auditLogs', 'checkIns', 'distances', 'kitDeliveries', 'registrations'],
    `unexpected tables referenced: ${distinct.join(', ')}`);

  // distances / check-ins / kit-deliveries are READ-ONLY (existence + validation)
  for (const t of ['distances', 'checkIns', 'kitDeliveries']) {
    assert.doesNotMatch(fn, new RegExp(`update \\$\\{table\\.${t}\\}|insert into \\$\\{table\\.${t}\\}|delete from \\$\\{table\\.${t}\\}`), `${t} is read-only`);
  }

  const regUpdates = [...fn.matchAll(/update \$\{table\.registrations\}/g)];
  assert.equal(regUpdates.length, 1, 'exactly one UPDATE run-registrations');
  assert.match(fn, /set distance_id = \$2,\s*\n\s*payload = jsonb_set\(coalesce\(payload, '\{\}'::jsonb\), '\{distance\}', to_jsonb\(\$3::text\)\),\s*\n\s*updated_at = \$4\s*\n\s*where id = \$1/,
    'UPDATE writes only distance_id + payload.distance mirror + updated_at, scoped to where id = $1');

  const inserts = [...fn.matchAll(/insert into \$\{table\.(\w+)\}/g)].map((m) => m[1]);
  assert.deepEqual(inserts, ['auditLogs'], 'the only INSERT is the audit row');

  // financial / lot / bib / payment columns are never named in the UPDATE
  const updateStmt = fn.slice(fn.indexOf('update ${table.registrations}'), fn.indexOf('insert into ${table.auditLogs}'));
  for (const forbidden of ['amount_cents', 'original_price', 'final_price', 'discount_', 'partner_', 'coupon_', 'lot_id', 'bib_number', 'paid_at', 'status =']) {
    assert.ok(!updateStmt.includes(forbidden), `UPDATE must not touch ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// canonical distance_id <-> payload.distance kept consistent in ONE statement
// ---------------------------------------------------------------------------
test('distance_id and the payload.distance mirror are written in the SAME UPDATE (no split-brain window)', () => {
  const fn = distancePrimitive();
  assert.match(fn, /update \$\{table\.registrations\}\s*\n\s*set distance_id = \$2,\s*\n\s*payload = jsonb_set\([\s\S]*?'\{distance\}'[\s\S]*?\),\s*\n\s*updated_at = \$4/,
    'one UPDATE sets both distance_id and payload.distance');
  // $3 (the payload mirror value) is the canonical target distance label
  assert.match(fn, /const distanceLabel = String\(distanceRow\.name\);/, 'the mirror value is the target distance row name');
  assert.match(fn, /\[input\.registrationId, input\.targetDistanceId, distanceLabel, input\.audit\.createdAt\]/, 'UPDATE params: id, targetDistanceId, distanceLabel, createdAt');
});

// ---------------------------------------------------------------------------
// required transaction envelope
// ---------------------------------------------------------------------------
test('begin, bounded lock_timeout/statement_timeout, commit, rollback on every early return and on throw', () => {
  const fn = distancePrimitive();
  assert.match(fn, /await client\.query\('begin'\)/, 'opens a transaction');
  assert.match(fn, /set local lock_timeout = '5s'/, 'bounded lock wait');
  assert.match(fn, /set local statement_timeout = '10s'/, 'bounded statement time');
  assert.match(fn, /await client\.query\('commit'\)/, 'commits the successful path');
  const rollbacks = [...fn.matchAll(/client\.query\('rollback'\)/g)].length;
  assert.ok(rollbacks >= 7, `expected a rollback on every early exit + the catch, found ${rollbacks}`);
  assert.match(fn, /catch \(error\) \{\s*await client\.query\('rollback'\)\.catch\(\(\) => undefined\);\s*throw error;/, 'rollback + rethrow on unexpected error');
  assert.match(fn, /finally \{\s*client\.release\(\);/, 'always releases the client');
});

test('FOR UPDATE locks exactly the target registration row (the distances join is read-only)', () => {
  const fn = distancePrimitive();
  assert.match(fn, /from \$\{table\.registrations\} r\s*\n\s*left join \$\{table\.distances\} current on current\.id = r\.distance_id\s*\n\s*where r\.id = \$1\s*\n\s*for update of r/,
    'single locking SELECT: joins distances read-only, FOR UPDATE OF r only');
});

// ---------------------------------------------------------------------------
// idempotent no-op: same distance → no UPDATE, no audit row, unchanged
// ---------------------------------------------------------------------------
test('canonical distance already == target → rollback with { status: "unchanged" }, before any write / eligibility check', () => {
  const fn = distancePrimitive();
  assert.match(fn, /if \(currentDistanceId === input\.targetDistanceId\) \{\s*await client\.query\('rollback'\);\s*return \{ status: 'unchanged', distanceId: currentDistanceId \};/,
    'no-op returns unchanged and rolls back — no UPDATE, no audit row');
  const noopAt = fn.indexOf('if (currentDistanceId === input.targetDistanceId)');
  const paidCheckAt = fn.indexOf("String(targetRow.status) !== 'paid'");
  const updateAt = fn.search(/update \$\{table\.registrations\}/);
  const auditAt = fn.indexOf('insert into ${table.auditLogs}');
  assert.ok(noopAt >= 0 && paidCheckAt > noopAt && updateAt > noopAt && auditAt > noopAt, 'no-op check precedes the paid check, the UPDATE and the audit INSERT');
});

// ---------------------------------------------------------------------------
// eligibility + target validation, all inside the transaction
// ---------------------------------------------------------------------------
test('in-transaction re-checks: paid status, check-in/kit guard, target exists / same event / active', () => {
  const fn = distancePrimitive();
  assert.match(fn, /if \(String\(targetRow\.status\) !== 'paid'\) \{\s*await client\.query\('rollback'\);\s*return \{\s*status: 'not_eligible',/, 'paid re-check → not_eligible');
  assert.match(fn, /exists\(select 1 from \$\{table\.checkIns\} where registration_id = \$1\) as checked_in,\s*\n\s*exists\(select 1 from \$\{table\.kitDeliveries\} where registration_id = \$1\) as kit_delivered/, 'check-in / kit existence guard');
  assert.match(fn, /operationalResult\.rows\[0\]\?\.checked_in \|\| operationalResult\.rows\[0\]\?\.kit_delivered/, 'checked-in or kitted → blocked');
  assert.match(fn, /select id, event_id, name, status from \$\{table\.distances\} where id = \$1/, 'target distance read');
  assert.match(fn, /if \(!distanceRow\) \{\s*await client\.query\('rollback'\);\s*return \{ status: 'target_not_found' \};/, 'unknown target → target_not_found');
  assert.match(fn, /if \(String\(distanceRow\.event_id\) !== String\(targetRow\.event_id\)\) \{[\s\S]*?status: 'target_not_available',[\s\S]*?outro evento/, 'cross-event target → target_not_available');
  assert.match(fn, /if \(String\(distanceRow\.status\) !== 'active'\) \{[\s\S]*?status: 'target_not_available',[\s\S]*?nao esta ativa/, 'inactive target → target_not_available');
});

// ---------------------------------------------------------------------------
// success audit: dedicated event name + before/after payload, same tx
// ---------------------------------------------------------------------------
test('distance change appends exactly one "registration.distance_corrected" audit row with { reason, before, after }', () => {
  const fn = distancePrimitive();
  assert.match(fn, /'registration\.distance_corrected', 'registration', \$4/, 'dedicated audit action, entity_type registration');
  assert.match(fn, /before: \{ distanceId: currentDistanceId, distance: previousDistanceLabel \},/, 'before = { distanceId, distance }');
  assert.match(fn, /after: \{ distanceId: input\.targetDistanceId, distance: distanceLabel \},/, 'after = { distanceId, distance }');
  assert.match(fn, /\(id, actor, actor_role, action, entity_type, entity_id, payload, session_id, ip_address, user_agent, created_at\)/, 'actor/role/target/timestamp columns present');
  // atomic: UPDATE -> audit INSERT -> COMMIT, no commit between
  const updateAt = fn.search(/update \$\{table\.registrations\}/);
  const auditAt = fn.indexOf('insert into ${table.auditLogs}');
  const commitAt = fn.indexOf("await client.query('commit')");
  assert.ok(updateAt >= 0 && auditAt > updateAt && commitAt > auditAt, 'order is UPDATE -> INSERT audit -> COMMIT');
  assert.equal(fn.slice(updateAt, auditAt).includes("client.query('commit')"), false, 'no COMMIT between the UPDATE and the audit INSERT');
});

// ---------------------------------------------------------------------------
// handler delegation + outcome mapping
// ---------------------------------------------------------------------------
test('handler maps primitive results to the machine outcome contract', () => {
  const handler = distanceHandler();
  assert.match(handler, /if \(outcome\.status === 'not_found'\) \{ json\(res, 404,/, 'not_found -> 404');
  assert.match(handler, /if \(outcome\.status === 'target_not_found'\) \{ json\(res, 404, \{ message: '[^']+', code: 'TARGET_DISTANCE_NOT_FOUND' \}\)/, 'target_not_found -> 404 TARGET_DISTANCE_NOT_FOUND');
  assert.match(handler, /if \(outcome\.status === 'target_not_available'\) \{ json\(res, 409, \{ message: outcome\.message, code: 'TARGET_DISTANCE_NOT_AVAILABLE' \}\)/, 'target_not_available -> 409');
  assert.match(handler, /if \(outcome\.status === 'not_eligible'\) \{ json\(res, 409, \{ message: outcome\.message, code: 'NOT_ELIGIBLE' \}\)/, 'not_eligible -> 409 NOT_ELIGIBLE');
  assert.match(handler, /outcome: 'DISTANCE_UNCHANGED' as const/, 'unchanged -> 200 DISTANCE_UNCHANGED');
  assert.match(handler, /outcome: 'DISTANCE_UPDATED' as const/, 'ok -> 200 DISTANCE_UPDATED');
  assert.match(handler, /withRegistrationView\(payload, adminSession\.role as RegistrationViewRole\)/, '200 payload is role-serialised');
});

// ---------------------------------------------------------------------------
// no email / payment / lot / check-in / kit / bib side effects
// ---------------------------------------------------------------------------
test('no email / payment / lot / sold_count / bib / check-in / kit mutation anywhere in the distance path', () => {
  const handler = code(distanceHandler());
  const fn = code(distancePrimitive());
  for (const forbidden of [/processRegistrationEmail/, /run-email-outbox/, /update .*run-email-deliveries/, /confirmPaymentInPostgres/, /sold_count/, /update \$\{table\.lots\}/, /update \$\{table\.payments\}/, /bib_number =/, /insert into \$\{table\.checkIns\}/, /insert into \$\{table\.kitDeliveries\}/, /releaseRegistrationCapacity/, /synchronizeLotProjections/, /queuePartnershipGoogleSheetSync/]) {
    assert.doesNotMatch(handler, forbidden, `handler: no ${forbidden}`);
    assert.doesNotMatch(fn, forbidden, `primitive: no ${forbidden}`);
  }
});

test('routing: POST /api/admin/registrations/:id/distance is wired to the dedicated handler (not profile-edit PATCH)', () => {
  assert.match(serverIndex, /const adminRegistrationDistance = url\.pathname\.match\(\/\^\\\/api\\\/admin\\\/registrations\\\/\(\[\^\/\]\+\)\\\/distance\$\/\);/, 'distance route matcher present');
  assert.match(serverIndex, /if \(req\.method === 'POST' && adminRegistrationDistance\) \{ await handleAdminRegistrationDistance\(req, res, decodeURIComponent\(adminRegistrationDistance\[1\]\), url\); return; \}/, 'POST routes to handleAdminRegistrationDistance');
  // profile-edit allow-list still does NOT contain distance
  assert.match(serverIndex, /const allowedFields = \['fullName', 'email', 'phone', 'birthDate', 'gender', 'shirtSize', 'emergencyContactName', 'emergencyContactPhone', 'city', 'state', 'team'\] as const;/, 'profile-edit allow-list unchanged — still no distance');
});

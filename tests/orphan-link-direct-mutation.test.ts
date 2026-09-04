import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// ADMIN-UX-RELIABILITY Wave 3C — STAGE 2: the Admin orphan-payment-link
// action (POST /api/admin/payment-events/:eventId/link) must run as a
// narrow, single-row PostgreSQL transaction (run-payment-events +
// run-payments + run-audit-logs), NEVER touching run-registrations.status,
// paid_at, or run-lots — Stage 1 forensic: this is evidence association,
// not payment confirmation. The already-narrow financial primitives
// (confirmPaymentInPostgres, applyNonPaidPaymentWebhookInPostgres) must be
// untouched.
//
// Repo convention: no jsdom / no live PG in unit tests; the transactional
// behaviour is proven against real PostgreSQL in homolog separately, and the
// wiring / scope is locked here against source.

const serverIndex = readFileSync('server/index.ts', 'utf8');
const serverDatabase = readFileSync('server/database.ts', 'utf8');

function orphanLinkHandler(): string {
  const start = serverIndex.indexOf('async function handleAdminOrphanLink(');
  const end = serverIndex.indexOf('\nasync function handleAdminPaymentReconcile(');
  assert.ok(start >= 0 && end > start, 'handleAdminOrphanLink located');
  return serverIndex.slice(start, end);
}

function orphanLinkMutation(): string {
  const start = serverDatabase.indexOf('function isGatewayTransactionUniqueViolation(');
  const end = serverDatabase.indexOf('export async function markPaymentCreationFailedInPostgres(');
  assert.ok(start >= 0 && end > start, 'linkOrphanPaymentInPostgres located');
  return serverDatabase.slice(start, end);
}

function confirmPaymentMutation(): string {
  const start = serverDatabase.indexOf('export async function confirmPaymentInPostgres(');
  const end = serverDatabase.indexOf(
    '// Payment confirmation is monotonic: a stale/non-paid event can never',
  );
  assert.ok(start >= 0 && end > start, 'confirmPaymentInPostgres located');
  return serverDatabase.slice(start, end);
}

function nonPaidWebhookMutation(): string {
  const start = serverDatabase.indexOf('export async function applyNonPaidPaymentWebhookInPostgres(');
  const end = serverDatabase.indexOf('// ADMIN-UX-RELIABILITY Wave 3C');
  assert.ok(start >= 0 && end > start, 'applyNonPaidPaymentWebhookInPostgres located');
  return serverDatabase.slice(start, end);
}

// strip // and /* */ comments so assertions test executable code, not prose
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

test('performance regression guard: orphan-link no longer touches the full-database blob path', () => {
  const handler = code(orphanLinkHandler());
  assert.doesNotMatch(handler, /\btransaction\s*[<(]/, 'handler does not call the generic transaction()');
  assert.doesNotMatch(handler, /readPostgresDatabase/, 'handler does not read the whole database');
  assert.doesNotMatch(handler, /savePostgresDatabase/, 'handler does not rewrite the whole database');
  assert.match(handler, /await linkOrphanPaymentInPostgres\(\{/, 'handler delegates to the narrow mutation');

  const fn = code(orphanLinkMutation());
  assert.doesNotMatch(fn, /readPostgresDatabase/, 'narrow mutation never reads the full database');
  assert.doesNotMatch(fn, /savePostgresDatabase/, 'narrow mutation never rewrites the full database');
  assert.doesNotMatch(fn, /hashtext\('funpace-run-write'\)/, 'narrow mutation does not take the global application write lock');
  assert.doesNotMatch(fn, /ensureConfiguredLots/, 'narrow mutation does not touch lot seeding');
  assert.doesNotMatch(fn, /ensurePostgresReady/, 'narrow mutation omits ensurePostgresReady, matching the sibling financial primitives');
});

test('THE headline domain invariant: orphan-link performs ZERO registration.status / paid_at / run-lots writes (Stage 1: evidence association, not confirmation)', () => {
  const fn = code(orphanLinkMutation());
  assert.doesNotMatch(fn, /update \$\{table\.registrations\}/, 'no UPDATE run-registrations anywhere — status/paid_at can never change');
  assert.doesNotMatch(fn, /update \$\{table\.lots\}/, 'no UPDATE run-lots anywhere');
  assert.doesNotMatch(fn, /insert into \$\{table\.lots\}/, 'no INSERT run-lots anywhere');
  assert.doesNotMatch(fn, /sold_count/, 'sold_count is never referenced');
  assert.doesNotMatch(fn, /confirmPaymentInPostgres/, 'never composes with the paid-confirmation primitive');
  assert.doesNotMatch(fn, /checkInfinitePayPayment/, 'never calls the real provider verification');
  assert.doesNotMatch(fn, /enqueueConfirmationEmailInPostgres/, 'never enqueues a confirmation email');
});

test('the narrow mutation touches ONLY run-payment-events, run-payments, run-registrations (read-only), run-audit-logs', () => {
  const fn = orphanLinkMutation();
  const tableRefs = [...fn.matchAll(/\$\{table\.(\w+)\}/g)].map((m) => m[1]);
  const distinct = [...new Set(tableRefs)].sort();
  assert.deepEqual(distinct, ['auditLogs', 'paymentEvents', 'payments', 'registrations'], `unexpected tables touched: ${distinct.join(', ')}`);

  const updates = [...fn.matchAll(/update \$\{table\.(\w+)\}/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(updates)].sort(), ['paymentEvents', 'payments'], 'only payment_events and payments are ever UPDATEd');
  const inserts = [...fn.matchAll(/insert into \$\{table\.(\w+)\}/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(inserts)].sort(), ['auditLogs'], 'the only INSERT is the audit row');
});

test('lock order is IDENTICAL to confirmPaymentInPostgres and applyNonPaidPaymentWebhookInPostgres (derived, not invented), target row group locked before the event row', () => {
  const fn = code(orphanLinkMutation());
  const confirmFn = confirmPaymentMutation();
  const nonPaidFn = nonPaidWebhookMutation();
  for (const source of [fn, confirmFn, nonPaidFn]) {
    const regLotAt = source.indexOf("pg_advisory_xact_lock(hashtext('funpace-run-registration-lot'))");
    const paymentConfirmAt = source.indexOf("pg_advisory_xact_lock(hashtext('funpace-run-payment-confirmation'))");
    assert.ok(regLotAt >= 0 && paymentConfirmAt > regLotAt, 'funpace-run-registration-lot is acquired before funpace-run-payment-confirmation');
  }
  // target registration+payment row group locked BEFORE the orphan event row —
  // a fixed order applied on every call (not derived from the input IDs),
  // which is what makes concurrent calls deadlock-free.
  const targetLockAt = fn.search(/for update of registration, payment/);
  const eventSelectAt = fn.indexOf('from ${table.paymentEvents} where id = $1');
  assert.ok(targetLockAt >= 0 && eventSelectAt > targetLockAt, 'target registration+payment locked before the orphan event row');
  assert.doesNotMatch(fn, /funpace-run-write/, 'no dependency on the unrelated global write lock');
});

test('transaction envelope: begin, bounded timeouts, commit, rollback on every early return and on throw', () => {
  const fn = orphanLinkMutation();
  assert.match(fn, /await client\.query\('begin'\)/, 'opens a transaction');
  assert.match(fn, /set local lock_timeout = '5s'/, 'bounded lock wait');
  assert.match(fn, /set local statement_timeout = '10s'/, 'bounded statement time');
  assert.match(fn, /await client\.query\('commit'\)/, 'commits the successful path');
  const rollbacks = [...fn.matchAll(/await client\.query\('rollback'\)/g)].length;
  assert.ok(rollbacks >= 4, `expected a rollback on every early exit, found ${rollbacks}`);
  assert.match(fn, /catch \(error\) \{\s*await client\.query\('rollback'\)[\s\S]*?throw error;/, 'rollback + rethrow on unexpected error');
  assert.match(fn, /finally \{\s*client\.release\(\);/, 'always releases the client');
});

test('idempotency: relinking the SAME orphan to the SAME target is a read-only no-op; linking to a DIFFERENT target after it is already linked is a real conflict', () => {
  const fn = orphanLinkMutation();
  assert.match(fn, /if \(eventRow\.event_type !== 'infinitepay\.orphan'\)/, 'a non-orphan event_type short-circuits before any write');
  assert.match(fn, /if \(eventRow\.payment_id === targetRow\.payment_id\)/, 'same-target check distinguishes no-op from conflict');
  assert.match(fn, /outcome: 'ORPHAN_ALREADY_LINKED_HERE'/, 'same-target repeat is a distinct, informational, zero-write outcome');
  assert.match(fn, /outcome: 'ORPHAN_ALREADY_CLAIMED'/, 'different-target repeat is a distinct conflict outcome');
  // both branches rollback before returning — no write from either
  const alreadyLinkedBlock = fn.slice(fn.indexOf("event_type !== 'infinitepay.orphan'"), fn.indexOf('const normalized ='));
  assert.doesNotMatch(alreadyLinkedBlock, /update \$\{table\.(payments|paymentEvents)\}/, 'zero writes on the already-linked / already-claimed path');
});

test('gateway_transaction_id unique-constraint violation is classified, never a raw 500', () => {
  const fn = orphanLinkMutation();
  assert.match(fn, /function isGatewayTransactionUniqueViolation/, 'defensive classifier exists');
  assert.match(fn, /candidate\.code !== '23505'/, 'classifies on the Postgres unique-violation SQLSTATE');
  assert.match(fn, /'run-payments_gateway_transaction_idx'/, 'scoped to the known constraint name (Stage 1 finding)');
  assert.match(
    fn,
    /if \(isGatewayTransactionUniqueViolation\(error\)\) \{[\s\S]*?statusCode: 409,[\s\S]*?outcome: 'GATEWAY_CONFLICT'/,
    '23505 maps to an explicit 409 GATEWAY_CONFLICT, not a raw Postgres error',
  );
});

test('amount-mismatch guard is preserved verbatim (SAFE per Stage 1 §M)', () => {
  const fn = orphanLinkMutation();
  assert.match(fn, /normalized\.amountCents !== null && normalized\.amountCents !== Number\(targetRow\.amount_cents\)/);
  assert.match(fn, /statusCode: 409, payload: \{ message: 'O valor do evento diverge da inscricao informada\.' \}, outcome: 'AMOUNT_MISMATCH'/);
});

test('audit is narrow: exactly one insert for a genuine link, before/after gateway snapshot, no raw payload/PII leakage, exact action name preserved', () => {
  const fn = orphanLinkMutation();
  assert.match(fn, /'payment\.orphan_linked'/, 'existing audit action name preserved verbatim');
  const inserts = [...fn.matchAll(/insert into \$\{table\.auditLogs\}/g)];
  assert.equal(inserts.length, 1, 'exactly one audit INSERT site in the whole function');
  assert.match(fn, /const before = \{ gatewayStatus: targetRow\.gateway_status, gatewayTransactionId: targetRow\.gateway_transaction_id \};/, 'before snapshot recorded');
  assert.match(fn, /after: \{ gatewayStatus, gatewayTransactionId \}/, 'after snapshot recorded');
  assert.doesNotMatch(fn, /payload: JSON\.stringify\(\{[\s\S]{0,400}gateway_payload/, 'raw gateway_payload is never embedded in the audit payload');
});

test('reuses normalizePaymentWebhook verbatim — no reimplementation of provider-field parsing', () => {
  const fn = orphanLinkMutation();
  assert.match(fn, /const normalized = normalizePaymentWebhook\(eventRow\.payload\);/);
  assert.doesNotMatch(fn, /findFirstValue\(/, 'does not reimplement the field-extraction helper inline');
  assert.match(serverDatabase, /export function normalizePaymentWebhook\(rawEvent: unknown\)/, 'the pure function itself lives once, in database.ts');
  assert.match(serverIndex, /export \{ findFirstValue, toStringValue, normalizePaymentWebhook, toPaymentProviderStatus \};/, 're-exported under the same names so every existing caller/test is unaffected');
});

test('paid-path non-regression: confirmPaymentInPostgres and applyNonPaidPaymentWebhookInPostgres are never called or duplicated by the orphan-link primitive itself', () => {
  const fn = code(orphanLinkMutation());
  assert.doesNotMatch(fn, /applyNonPaidPaymentWebhookInPostgres/);
  assert.doesNotMatch(fn, /resolvePaymentTransition/, 'no monotonic-floor logic needed — orphan-link never writes registration.status');
});

test('API/handler contract: RBAC unchanged, reason gate unchanged, response uses the {message, code} / {ok, outcome} conventions', () => {
  const handler = orphanLinkHandler();
  assert.match(handler, /requireAdmin\(req, res, \['administrator', 'finance'\]\)/, 'RBAC unchanged');
  assert.match(handler, /reason\.length < 5/, 'reason >= 5 enforced in the handler');
  assert.match(handler, /code: 'ORPHAN_ALREADY_CLAIMED'/);
  assert.match(handler, /code: 'AMOUNT_MISMATCH'/);
  assert.match(handler, /code: 'GATEWAY_CONFLICT'/);
  assert.match(handler, /json\(res, 200, \{ ok: true, outcome: result\.outcome \}\)/, 'success response carries the outcome discriminator');
});

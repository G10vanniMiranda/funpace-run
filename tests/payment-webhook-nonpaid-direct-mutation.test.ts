import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// ADMIN-UX-RELIABILITY Wave 3B — STAGE 2: POST /api/webhooks/payment's
// non-paid branch (registration-not-found/orphan, stale-checkout,
// amount-mismatch, duplicate, and the actual non-paid state transition) must
// run as a narrow, single-row PostgreSQL transaction
// (run-registrations + run-payments + run-payment-events + run-audit-logs),
// NEVER touching run-lots, NOT the generic full-database blob mechanism.
// The already-narrow paid path (confirmPaymentInPostgres) must be untouched.
//
// Repo convention: no jsdom / no live PG in unit tests; the transactional
// behaviour is proven against real PostgreSQL in homolog separately, and the
// wiring / scope is locked here against source.

const serverIndex = readFileSync('server/index.ts', 'utf8');
const serverDatabase = readFileSync('server/database.ts', 'utf8');

function webhookHandler(): string {
  const start = serverIndex.indexOf('async function handlePaymentWebhook(');
  const end = serverIndex.indexOf('\nasync function handleGetRegistration(');
  assert.ok(start >= 0 && end > start, 'handlePaymentWebhook located');
  return serverIndex.slice(start, end);
}

function nonPaidMutation(): string {
  const start = serverDatabase.indexOf('export async function applyNonPaidPaymentWebhookInPostgres(');
  // ADMIN-UX-RELIABILITY Wave 3C inserted its own moved normalization helpers
  // and the linkOrphanPaymentInPostgres primitive directly after this
  // function (before markPaymentCreationFailedInPostgres) — pin the slice end
  // to that wave-unique marker so it never grows to swallow them.
  const end = serverDatabase.indexOf('// ADMIN-UX-RELIABILITY Wave 3C');
  assert.ok(start >= 0 && end > start, 'applyNonPaidPaymentWebhookInPostgres located');
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

// strip // and /* */ comments so assertions test executable code, not prose
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

test('performance regression guard: the non-paid webhook path no longer touches the full-database blob path', () => {
  const handler = code(webhookHandler());
  assert.doesNotMatch(handler, /\btransaction\s*[<(]/, 'handler does not call the generic transaction()');
  assert.doesNotMatch(handler, /readPostgresDatabase/, 'handler does not read the whole database');
  assert.doesNotMatch(handler, /savePostgresDatabase/, 'handler does not rewrite the whole database');
  assert.doesNotMatch(handler, /synchronizeLotProjections/, 'handler no longer recomputes/rewrites every lot');
  assert.doesNotMatch(handler, /expirePendingPayments/, 'handler no longer runs the whole-table pending-expiry sweep');
  assert.match(handler, /await applyNonPaidPaymentWebhookInPostgres\(\{/, 'handler delegates to the narrow mutation');

  const fn = code(nonPaidMutation());
  assert.doesNotMatch(fn, /readPostgresDatabase/, 'narrow mutation never reads the full database');
  assert.doesNotMatch(fn, /savePostgresDatabase/, 'narrow mutation never rewrites the full database');
  assert.doesNotMatch(fn, /hashtext\('funpace-run-write'\)/, 'narrow mutation does not take the global application write lock');
  assert.doesNotMatch(fn, /synchronizeLotProjections/, 'narrow mutation never recomputes lot projections');
});

test('THE headline regression: the narrow mutation performs ZERO writes to run-lots (static + shape proof)', () => {
  const fn = nonPaidMutation();
  assert.doesNotMatch(fn, /update \$\{table\.lots\}/, 'no UPDATE run-lots anywhere in the function');
  assert.doesNotMatch(fn, /insert into \$\{table\.lots\}/, 'no INSERT run-lots anywhere in the function');
  assert.doesNotMatch(fn, /delete from \$\{table\.lots\}/, 'no DELETE run-lots anywhere in the function');
  // lot is read-only (joined for the stale_checkout comparison) and is
  // explicitly excluded from the FOR UPDATE row-lock clause, exactly
  // mirroring how confirmPaymentInPostgres already reads-but-never-locks lot.
  assert.match(fn, /left join \$\{table\.lots\} lot on lot\.id = registration\.lot_id/, 'lot is read via a plain read-only LEFT JOIN');
  assert.match(fn, /for update of registration, payment/, 'FOR UPDATE explicitly excludes lot — never row-locked, let alone written');
});

test('the narrow mutation touches ONLY run-registrations, run-payments, run-payment-events, run-audit-logs', () => {
  const fn = nonPaidMutation();
  const tableRefs = [...fn.matchAll(/\$\{table\.(\w+)\}/g)].map((m) => m[1]);
  const distinct = [...new Set(tableRefs)].sort();
  assert.deepEqual(distinct, ['auditLogs', 'lots', 'paymentEvents', 'payments', 'registrations'], `unexpected tables touched: ${distinct.join(', ')}`);

  const updates = [...fn.matchAll(/update \$\{table\.(\w+)\}/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(updates)].sort(), ['payments', 'registrations'], 'only registrations and payments are ever UPDATEd');
  const inserts = [...fn.matchAll(/insert into \$\{table\.(\w+)\}/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(inserts)].sort(), ['auditLogs', 'paymentEvents'], 'only payment_events and audit_logs are ever INSERTed');
});

test('lock order is IDENTICAL to confirmPaymentInPostgres (derived, not invented)', () => {
  const fn = nonPaidMutation();
  const confirmFn = confirmPaymentMutation();
  for (const source of [fn, confirmFn]) {
    const regLotAt = source.indexOf("pg_advisory_xact_lock(hashtext('funpace-run-registration-lot'))");
    const paymentConfirmAt = source.indexOf("pg_advisory_xact_lock(hashtext('funpace-run-payment-confirmation'))");
    assert.ok(regLotAt >= 0 && paymentConfirmAt > regLotAt, 'funpace-run-registration-lot is acquired before funpace-run-payment-confirmation');
  }
  assert.doesNotMatch(fn, /funpace-run-write/, 'no dependency on the unrelated global write lock');
});

test('transaction envelope: begin, bounded timeouts, commit, rollback on every early return and on throw', () => {
  const fn = nonPaidMutation();
  assert.match(fn, /await client\.query\('begin'\)/, 'opens a transaction');
  assert.match(fn, /set local lock_timeout = '5s'/, 'bounded lock wait');
  assert.match(fn, /set local statement_timeout = '15s'/, 'bounded statement time (matches confirmPaymentInPostgres)');
  assert.match(fn, /await client\.query\('commit'\)/, 'commits the successful path');
  const commits = (fn.match(/await client\.query\('commit'\)/g) || []).length;
  assert.ok(commits >= 5, `expected a commit on every terminal branch (orphan/stale/mismatch/duplicate/applied), found ${commits}`);
  assert.match(fn, /catch \(error\) \{\s*await client\.query\('rollback'\)[\s\S]*?throw error;/, 'rollback + rethrow on unexpected error');
  assert.match(fn, /finally \{\s*client\.release\(\);/, 'always releases the client');
});

test('reuses resolvePaymentTransition verbatim — no reimplementation, single monotonic floor', () => {
  const fn = nonPaidMutation();
  assert.match(fn, /const nextStatus = resolvePaymentTransition\(previousStatus, input\.nextStatus\);/);
  assert.doesNotMatch(fn, /current === 'paid' && incoming !== 'paid'/, 'the transition rule is not duplicated inline');
  // the pure function itself lives once, in database.ts, and is re-exported
  // (not redefined) from index.ts so every existing caller/test is unaffected.
  assert.match(serverDatabase, /export function resolvePaymentTransition\(current: RegistrationStatus, incoming: RegistrationStatus\): RegistrationStatus \{\s*\n\s*return current === 'paid' && incoming !== 'paid' \? 'paid' : incoming;/);
  assert.match(serverIndex, /export \{ resolvePaymentTransition \} from '\.\/database\.js';/);
  assert.doesNotMatch(
    code(serverIndex),
    /function resolvePaymentTransition\(current/,
    'index.ts no longer defines its own copy',
  );
});

test('orphan (registration-not-found) preserves the exact run-payment-events row shape the Admin orphan-link feature depends on', () => {
  const fn = nonPaidMutation();
  assert.match(fn, /values \(\$1, '', \$2, 'infinitepay\.orphan', \$3, \$4\)/, 'empty paymentId, literal eventType infinitepay.orphan');
  assert.match(fn, /on conflict \(provider_event_id\) do nothing\s*\n\s*returning id/, 'idempotent on provider_event_id, same dedupe key as the legacy path');
  assert.match(fn, /'payment\.orphan_received'/, 'audit action name unchanged');
  assert.match(fn, /if \(inserted\.rowCount\)/, 'audit is written only when the event was genuinely new — matches the legacy dedupe-together behaviour');
});

test('stale_checkout and amount_mismatch preserve exact status codes, messages, and gateway-field write set', () => {
  const fn = nonPaidMutation();
  assert.match(fn, /previousStatus !== 'paid'[\s\S]*?statusCode: 409/, 'stale_checkout only evaluated when not already paid, exact 409');
  assert.match(fn, /Checkout expirado por mudanca de lote\./, 'exact stale_checkout message preserved');
  assert.match(fn, /gateway_status = 'stale_checkout'/, 'exact literal gateway_status preserved');
  assert.match(fn, /Valor do pagamento divergente\./, 'exact amount_mismatch message preserved');
  assert.match(fn, /statusCode: 400, payload: \{ message: 'Valor do pagamento divergente\.' \}, outcome: 'AMOUNT_MISMATCH'/);
  // amount_mismatch is NOT guarded by previousStatus !== 'paid' — the legacy
  // code rejects a mismatched amount unconditionally, even for an
  // already-paid registration. Preserving this exactly (not weakening it).
  const mismatchAt = fn.indexOf('AMOUNT_MISMATCH');
  const staleGuardAt = fn.indexOf("previousStatus !== 'paid'");
  assert.ok(staleGuardAt >= 0 && staleGuardAt < mismatchAt, 'the previousStatus!==\'paid\' guard belongs to stale_checkout only, not amount_mismatch');
});

test('duplicate providerEventId short-circuits with ZERO writes', () => {
  const fn = nonPaidMutation();
  const dupAt = fn.indexOf('isDuplicatedEvent');
  const commitAt = fn.indexOf("await client.query('commit')", dupAt);
  const updateAfterDup = fn.slice(dupAt, fn.indexOf("outcome: 'DUPLICATE_EVENT'"));
  assert.doesNotMatch(updateAfterDup, /update \$\{table\.(registrations|payments)\}/, 'no registration/payment write between the duplicate check and its return');
  assert.ok(commitAt > dupAt, 'duplicate path still commits (releases the transaction cleanly)');
});

test('the genuine-transition write set matches the legacy field-by-field port exactly, including the preserved provider-identity-overwrite characteristic (§12/§Z, not fixed here)', () => {
  const fn = nonPaidMutation();
  assert.match(
    fn,
    /update \$\{table\.registrations\} set status = \$1, updated_at = \$2 where id = \$3/,
    'registration: only status + updated_at, no other field',
  );
  assert.doesNotMatch(fn, /expires_at\s*=.*where id = \$7/, 'registration.expires_at is never written by this primitive (paid-only field)');
  assert.match(fn, /provider_payment_id = coalesce\(nullif\(\$1, ''\), nullif\(\$2, ''\), provider_payment_id\)/, 'provider identity CAN be overwritten by an unverified non-paid claim — preserved exactly, not hardened');
  assert.doesNotMatch(fn, /set.*paid_at\s*=/, 'paid_at is never assigned by this primitive (omission, not a no-op assignment, is the strongest guarantee against §J.6)');
  assert.doesNotMatch(fn, /\.expires_at\s*=\s*\$/, 'payments.expires_at is never assigned by this primitive');
});

test('outcome labels distinguish ALREADY_PAID from NON_PAID_APPLIED without changing what is written (observability only)', () => {
  const fn = nonPaidMutation();
  assert.match(fn, /outcome: previousStatus === 'paid' \? 'ALREADY_PAID' : 'NON_PAID_APPLIED'/, 'both outcomes share the exact same preceding write statements');
});

test('API/handler contract: paid claims never reach this primitive; the paid branch (confirmPaymentInPostgres) is untouched', () => {
  const handler = webhookHandler();
  assert.match(handler, /if \(usesPostgresDatabase\(\) && normalizedEvent\.nextStatus === 'paid'\)/, 'paid routing guard unchanged');
  assert.match(handler, /const result = await confirmPaymentInPostgres\(\{/, 'paid branch still delegates to the untouched narrow primitive');
  assert.match(handler, /nextStatus: normalizedEvent\.nextStatus as Exclude<RegistrationStatus, 'paid'>/, 'the type system encodes the non-paid guarantee at the call site');
});

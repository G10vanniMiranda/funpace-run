import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// EMAIL-OPS-003 Stage 2 §11/§12/§13/§18/§19/§21/§22/§24 — ingestion contract.
// The Postgres transaction and the endpoint are asserted against source (the
// repo convention for DB-transaction invariants); pure logic is unit-tested in
// tests/email-provider-lifecycle.test.ts and tests/resend-webhook-auth.test.ts.
// Real PostgreSQL behaviour is EMAIL-OPS-003 Stage 3.

const databaseSource = readFileSync('server/database.ts', 'utf8');
const indexSource = readFileSync('server/index.ts', 'utf8');
const forwarder = readFileSync('api/webhooks/resend.ts', 'utf8');

function fn(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `${startNeedle} located`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  return source.slice(start, end >= 0 ? end : undefined);
}

// strip // line comments and /* */ block comments so assertions test code, not prose
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const ingest = () => code(fn(databaseSource, 'export async function ingestResendWebhookEventInPostgres(', '\nexport async function enqueueGoogleSheetSync('));
const handler = () => code(fn(indexSource, 'async function handleResendWebhook(', '\nasync function handlePaymentWebhook('));

// ---- §13 narrow transaction -------------------------------------------------

test('§13 ingestion is a NARROW transaction: no full-DB read/write, no global write lock', () => {
  const body = ingest();
  assert.doesNotMatch(body, /readPostgresDatabase/);
  assert.doesNotMatch(body, /savePostgresDatabase/);
  assert.doesNotMatch(body, /funpace-run-write/);
  assert.doesNotMatch(body, /transaction\s*[<(]/); // not the generic blob transaction()
  assert.match(body, /await client\.query\('begin'\)/);
  assert.match(body, /set local lock_timeout = '5s'/);
  assert.match(body, /set local statement_timeout = '10s'/);
  assert.match(body, /await client\.query\('commit'\)/);
});

test('§13 touches ONLY run-email-provider-events (insert) and run-email-deliveries (select+update)', () => {
  const body = ingest();
  const tables = [...new Set([...body.matchAll(/\$\{table\.(\w+)\}/g)].map((m) => m[1]))].sort();
  assert.deepEqual(tables, ['emailDeliveries', 'emailProviderEvents']);
  assert.equal((body.match(/insert into \$\{table\.emailProviderEvents\}/g) || []).length, 1, 'one append-only event insert');
  assert.equal((body.match(/update \$\{table\.emailDeliveries\}/g) || []).length, 1, 'at most one single-row lifecycle update');
  assert.match(body, /update \$\{table\.emailDeliveries\}\s*\n\s*set provider_lifecycle = \$2, provider_lifecycle_at = \$3, provider_lifecycle_reason = \$4\s*\n\s*where id = \$1/);
});

// ---- §12 idempotency ------------------------------------------------------

test('§12 webhook idempotency is DB-enforced on svix_id (ON CONFLICT DO NOTHING), duplicate is a no-op', () => {
  const body = ingest();
  assert.match(body, /on conflict \(svix_id\) do nothing\s*\n\s*returning id/);
  assert.match(body, /if \(inserted\.rowCount === 0\) \{\s*\n\s*await client\.query\('commit'\);\s*\n\s*return \{ outcome: 'duplicate'/);
});

// ---- §11 correlation ----------------------------------------------------

test('§11 correlation is by provider_message_id (= data.email_id), NEVER by recipient email', () => {
  const body = ingest();
  assert.match(body, /where provider = 'resend' and provider_message_id = \$1/);
  assert.doesNotMatch(body, /recipient_email\s*=|where[^;]*email\s*=\s*\$/i);
  // an unknown message id is retained uncorrelated, no participant guessed
  assert.match(body, /if \(!deliveryId\) \{\s*\n\s*await client\.query\('commit'\);\s*\n\s*return \{ outcome: 'uncorrelated', deliveryId: null, registrationId: null/);
});

// ---- §14/§15 derivation is re-folded from history (order-independent) ----

test('§14 lifecycle is re-derived from the FULL provider-event history via the pure fold', () => {
  const body = ingest();
  assert.match(body, /from \$\{table\.emailProviderEvents\}\s*\n\s*where delivery_id = \$1\s*\n\s*order by provider_created_at asc, id asc/);
  assert.match(body, /deriveLifecycleFromEvents\(/);
  assert.match(body, /for update/); // the target delivery row is locked before the lifecycle write
  assert.match(body, /const changed = derived\.lifecycle !== previousLifecycle;/);
  assert.match(body, /if \(changed\) \{/);
});

// ---- §22 atomicity -----------------------------------------------------

test('§22 atomicity: rollback + rethrow on any failure; client always released', () => {
  const body = ingest();
  assert.match(body, /catch \(error\) \{\s*\n\s*await client\.query\('rollback'\)[\s\S]*?throw error;/);
  assert.match(body, /finally \{\s*\n\s*client\.release\(\);/);
  // the correlated-event path: insert -> (lock) -> update -> commit, with the
  // lifecycle update and the final commit adjacent (no rollback between them).
  const insertAt = body.indexOf('insert into ${table.emailProviderEvents}');
  const updateAt = body.indexOf('update ${table.emailDeliveries}');
  const finalCommitAt = body.lastIndexOf("await client.query('commit')");
  assert.ok(insertAt >= 0 && updateAt > insertAt && finalCommitAt > updateAt, 'insert -> update -> commit');
  assert.equal(body.slice(updateAt, finalCommitAt).includes("client.query('rollback')"), false, 'no rollback between the lifecycle update and commit');
  // the early-exit commits (duplicate / uncorrelated) each return immediately
  assert.match(body, /return \{ outcome: 'duplicate'[\s\S]*?\};/);
  assert.match(body, /return \{ outcome: 'uncorrelated'[\s\S]*?\};/);
});

// ---- §7/§8 endpoint: verify RAW body BEFORE parse, return fast, send nothing

test('§7/§8 handler reads RAW body and verifies the signature BEFORE parsing the payload', () => {
  const body = handler();
  const rawAt = body.indexOf('const rawBody = await readBody(req)');
  const verifyAt = body.indexOf('verifyResendWebhookSignature(');
  const parseAt = body.indexOf('parseJsonBody');
  assert.ok(rawAt >= 0 && verifyAt > rawAt, 'raw body read, then verify');
  assert.ok(parseAt > verifyAt, 'parse only AFTER a successful verify');
  assert.match(body, /verifyResendWebhookSignature\(\{ rawBody, headers, secret: resendWebhookSecret \}\)/);
  assert.doesNotMatch(body.slice(0, verifyAt), /JSON\.parse|parseJsonBody/);
});

test('§8 fail-closed: missing secret -> 503, missing headers -> 401, bad signature/replay -> 401, zero mutation', () => {
  const body = handler();
  assert.match(body, /reason === 'missing_secret'[\s\S]*?json\(res, 503/);
  assert.match(body, /reason === 'missing_headers'[\s\S]*?json\(res, 401, \{ message: 'Assinatura ausente\.' \}\)/);
  assert.match(body, /json\(res, 401, \{ message: 'Assinatura invalida\.' \}\)/);
  // ingestion is only reached after a passing verification (it appears after the
  // `if (!verification.ok)` block returns)
  const rejectBlockEnd = body.indexOf('const receivedAt = new Date().toISOString();');
  assert.ok(body.indexOf('ingestResendWebhookEventInPostgres(') > rejectBlockEnd);
  assert.doesNotMatch(body.slice(0, rejectBlockEnd), /ingestResendWebhookEventInPostgres/);
});

test('§8 secret / raw payload are never logged', () => {
  const body = handler();
  // no console.* call references the secret value or the raw body
  for (const consoleCall of body.match(/console\.\w+\([\s\S]*?\)\)/g) || []) {
    assert.doesNotMatch(consoleCall, /\bresendWebhookSecret\b|\brawBody\b/, `console call must not carry the secret or raw body: ${consoleCall.slice(0, 80)}`);
  }
  assert.doesNotMatch(body, /console\.\w+\([\s\S]*?whsec_/);
  // only a digest of the body is persisted
  assert.match(body, /digestWebhookBody\(rawBody\)/);
});

test('§10 a verified but unmodelled event is safe-acked (200), never crashes or 5xx', () => {
  const body = handler();
  assert.match(body, /if \(normalized\.kind === 'ignored'\) \{[\s\S]*?json\(res, 200, \{ ok: true, ignored: normalized\.reason \}\)/);
});

test('§22 a DB hiccup returns non-2xx so Resend retries; no partial state', () => {
  const body = handler();
  assert.match(body, /catch \(error\) \{[\s\S]*?resend_webhook_ingestion_failed[\s\S]*?json\(res, 503/);
});

test('§23 alerts: participant-specific for bounce/complaint/suppressed, system anomaly for unknown id; none for sent/delivered/duplicate', () => {
  const body = handler();
  assert.match(body, /outcome === 'uncorrelated'[\s\S]*?dedupeKey: `resend-webhook:unknown:\$\{normalized\.emailId\}`[\s\S]*?alertType: 'email_lifecycle_unknown_message'/);
  assert.match(body, /isParticipantActionLifecycle\(result\.lifecycle/);
  assert.match(body, /email_lifecycle_bounce[\s\S]*?email_lifecycle_complaint[\s\S]*?email_lifecycle_suppressed/);
  assert.match(body, /dedupeKey: `\$\{route\.alertType\}:\$\{result\.registrationId\}`/);
  // signature-failure alerts are hourly-deduped, not per-request
  assert.match(body, /dedupeKey: `resend-webhook:signature:\$\{new Date\(\)\.toISOString\(\)\.slice\(0, 13\)\}`/);
  // no alert on the happy paths
  assert.doesNotMatch(body, /recordOperationalAlert[^;]*(delivered|'sent')/);
});

// ---- §24 payment / EVENT-OPS isolation --------------------------------

test('§24 handler never sends email and never touches payment confirmation / outbox / lots / pricing', () => {
  const body = handler();
  for (const forbidden of [
    'sendRegistrationConfirmationEmail', 'processRegistrationEmail', 'processPaymentConfirmationEmail',
    'confirmPaymentInPostgres', 'enqueueConfirmationEmail', 'run-lots', 'priceCents', 'updateLotConfiguration',
  ]) {
    assert.doesNotMatch(body, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `handler must not reference ${forbidden}`);
  }
});

test('§24 the ingestion function is likewise scoped — no email send, no payment/lot writes', () => {
  const body = ingest();
  for (const forbidden of ['sendRegistration', 'confirmPayment', 'run-lots', 'run-payments', 'run-email-outbox', 'priceCents']) {
    assert.doesNotMatch(body, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `ingestion must not reference ${forbidden}`);
  }
});

// ---- routing / forwarder -------------------------------------------------

test('POST /api/webhooks/resend is routed, and the Vercel function is a thin forwarder', () => {
  assert.match(indexSource, /req\.method === 'POST' && url\.pathname === '\/api\/webhooks\/resend'/);
  assert.match(indexSource, /await handleResendWebhook\(req, res\)/);
  const forwarderCode = code(forwarder);
  assert.match(forwarderCode, /return handleApiRequest\(req, res\)/);
  assert.doesNotMatch(forwarderCode, /verify|svix|secret|ingest|pg\.|\.query\(/i);
  assert.match(forwarderCode, /export const runtime = 'nodejs'/);
});

test('the endpoint is Postgres-only (JSON-mode returns 503, not a crash)', () => {
  const body = handler();
  assert.match(body, /if \(!usesPostgresDatabase\(\)\) \{\s*\n\s*json\(res, 503/);
});

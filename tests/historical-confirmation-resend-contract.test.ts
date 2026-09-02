import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// PARTICIPANT-OPS-001 CASE B / Stage B2 — structural guards on the
// same-recipient historical-confirmation resend endpoint. Repo convention: no
// live PG in unit tests; send / idempotency / provider-folding semantics are
// proven against real PostgreSQL in the homolog .mts proof.

const idx = readFileSync('server/index.ts', 'utf8');
const db = readFileSync('server/database.ts', 'utf8');
const pure = readFileSync('server/historical-confirmation-resend.ts', 'utf8');
const recovery = readFileSync('server/confirmation-recovery.ts', 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function slice(src: string, startNeedle: string, endNeedle: string): string {
  const a = src.indexOf(startNeedle);
  const b = src.indexOf(endNeedle, a + startNeedle.length);
  assert.ok(a >= 0 && b > a, `located ${startNeedle}`);
  return src.slice(a, b);
}

const handler = strip(slice(idx, 'async function handleAdminResendHistoricalConfirmation(', '\nasync function handleAdminRegistrationUpdate('));
const snapshotFn = strip(slice(db, 'export async function loadHistoricalConfirmationResendSnapshotInPostgres(', '\nfunction mapIntegrationEvent('));

// ---- T/U/V — RBAC: administrator only -------------------------------------
test('T/U/V: handler requires an authenticated admin session with role administrator only', () => {
  assert.match(handler, /requireAdmin\(req,\s*res,\s*\[\s*'administrator'\s*\]\)/);
  assert.doesNotMatch(handler, /requireAdmin\([^)]*'finance'/);
  assert.doesNotMatch(handler, /requireAdmin\([^)]*'operation'/);
  assert.match(handler, /requireAdminDatabase\(res\)/);
});

// ---- R — client-supplied recipient forbidden --------------------------
test('R: the handler never reads a destination address from the request body', () => {
  assert.match(handler, /parseJsonBody<\{\s*reason\?:\s*string\s*\}>/);
  for (const forbidden of [/body\.email/, /body\.to\b/, /body\.recipient/, /body\.destination/, /body\.address/, /body\.providerMessageId/]) {
    assert.doesNotMatch(handler, forbidden, `must not read ${forbidden}`);
  }
  // reason is MANDATORY for this operation
  assert.match(handler, /reason\.length < 10/);
  assert.match(handler, /operator_reason_required/);
});

// ---- S — client-supplied force forbidden; semantic context only -------
test('S: the send is driven by a server-derived contextKey, never force=true', () => {
  assert.match(handler, /processRegistrationEmail\(registrationId,\s*\{\s*contextKey\s*\}\)/);
  assert.doesNotMatch(handler, /force:\s*true/);
  assert.match(handler, /assessment\.resendContextKey/);
});

// ---- W — narrow audit only; no generic transaction ------------------
test('W: handler audits exclusively via appendAuditLogInPostgres and never opens a transaction()', () => {
  assert.doesNotMatch(handler, /\btransaction\s*[<(]/);
  assert.doesNotMatch(handler, /savePostgresDatabase|readPostgresDatabase/);
  const actions = [...new Set([...handler.matchAll(/action:\s*'([^']+)'/g)].map((m) => m[1]))].sort();
  assert.deepEqual(actions, [
    'email.confirmation.historical_resend.accepted',
    'email.confirmation.historical_resend.failed',
    'email.confirmation.historical_resend.requested',
    'email.confirmation.historical_resend.skipped',
  ]);
  assert.ok((handler.match(/appendAuditLogInPostgres\(/g) || []).length >= 4);
});

// ---- §13 — bounded outcome enum on every terminal branch -----------
test('handler responds with a bounded outcome enum + distinct HTTP families', () => {
  const outcomes = [...handler.matchAll(/outcome:\s*'([A-Z_]+)'/g)].map((m) => m[1]);
  const allowed = new Set(['RESEND_ACCEPTED', 'ALREADY_RESENT', 'RESEND_IN_PROGRESS', 'NOT_ELIGIBLE', 'PROVIDER_FAILURE', 'REVIEW_REQUIRED']);
  assert.ok(outcomes.length > 0);
  for (const o of outcomes) assert.ok(allowed.has(o), `unexpected ${o}`);
  assert.match(handler, /json\(res,\s*assessment\.httpStatus/);
  assert.match(handler, /json\(res,\s*200,\s*\{\s*outcome:\s*'RESEND_ACCEPTED'/);
  assert.match(handler, /json\(res,\s*502,/);
  assert.match(handler, /json\(res,\s*503,/);
});

// ---- §7/§8 — a declined claim is re-assessed, never re-sent --------
test('a null claim is re-classified to ALREADY_RESENT / RESEND_IN_PROGRESS, not re-sent', () => {
  const nullBranch = handler.slice(handler.indexOf('if (result === null)'), handler.indexOf('if (result.ok)'));
  assert.match(nullBranch, /loadHistoricalConfirmationResendSnapshotInPostgres/);
  assert.doesNotMatch(nullBranch, /processRegistrationEmail/);
});

// ---- §1 — distinct canonical nested route -------------------------
test('the router exposes POST /api/admin/registrations/:id/resend-historical-confirmation, distinct from recover-confirmation-email', () => {
  assert.match(idx, /const adminRegistrationHistoricalResend = url\.pathname\.match\(\/\^\\\/api\\\/admin\\\/registrations\\\/\(\[\^\/\]\+\)\\\/resend-historical-confirmation\$\/\)/);
  assert.match(idx, /req\.method === 'POST' && adminRegistrationHistoricalResend/);
  assert.match(idx, /handleAdminResendHistoricalConfirmation\(req, res, decodeURIComponent\(adminRegistrationHistoricalResend\[1\]\), url\)/);
});

// ---- §2/§4 — snapshot reader is narrow + folds provider events ----
test('loadHistoricalConfirmationResendSnapshotInPostgres is narrow SELECTs, no lock / no auto-migrate', () => {
  assert.doesNotMatch(snapshotFn, /ensurePostgresReady/);
  assert.doesNotMatch(snapshotFn, /savePostgresDatabase|readPostgresDatabase/);
  assert.doesNotMatch(snapshotFn, /pg_advisory_xact_lock|funpace-run-write/);
  assert.doesNotMatch(snapshotFn, /\btransaction\s*[<(]/);
  assert.doesNotMatch(snapshotFn, /\bbegin\b|for update/);
  assert.equal((snapshotFn.match(/insert into|update |delete from/gi) || []).length, 0, 'read-only');
  const tables = [...new Set([...snapshotFn.matchAll(/\$\{table\.(\w+)\}/g)].map((m) => m[1]))].sort();
  assert.deepEqual(tables, ['confirmationEmailOutbox', 'emailDeliveries', 'emailProviderEvents', 'registrations']);
  assert.match(snapshotFn, /deriveLifecycleFromEvents/, 'provider events folded to a single lifecycle');
  assert.match(snapshotFn, /classifyConfirmationDeliveryProvenance/);
});

// ---- §Y — Case A confirmation-recovery is UNCHANGED --------------
test('Y: confirmation-recovery.ts and its handler are byte-identical to origin/main (no eligibility change)', () => {
  // the recovery module must not mention the new operation at all
  assert.doesNotMatch(recovery, /historical-confirmation-resend|assessHistoricalConfirmationResend|HISTORICAL_APP_ASSERTED/);
  // the recovery handler still demands a DIFFERENT historical recipient
  const recoveryHandler = strip(slice(idx, 'async function handleAdminRecoverConfirmationEmail(', '\nasync function handleAdminResendHistoricalConfirmation('));
  assert.match(recoveryHandler, /assessConfirmationRecovery/);
  assert.doesNotMatch(recoveryHandler, /assessHistoricalConfirmationResend/);
  // the recovery pure module still enforces historicalToOther
  assert.match(recovery, /historicalToOther/);
  assert.match(recovery, /historical_recipient_unverifiable/);
});

// ---- §X — no new generic full-blob writer -----------------------
test('X: generic full-blob transaction() writer count has NOT increased', () => {
  function countFullBlobWriters(src: string): number {
    const lines = src.split('\n');
    let n = 0;
    for (let i = 0; i < lines.length; i++) {
      if (!/\btransaction\s*[<(]/.test(lines[i])) continue;
      if (/function transaction|serializeGoogleSheetJsonMutation/.test(lines[i])) continue;
      if (/^\s*(\*|\/\/)/.test(lines[i])) continue;
      if (/persist:\s*false/.test(lines.slice(i, i + 26).join('\n'))) continue;
      n += 1;
    }
    return n;
  }
  // baseline frozen at PROD-SAFETY-001 Stage 2 and unchanged by Case A (#40).
  assert.ok(countFullBlobWriters(idx) <= 22, `server/index.ts full-blob writers = ${countFullBlobWriters(idx)}, baseline 22`);
  assert.ok(countFullBlobWriters(db) <= 2, `server/database.ts full-blob writers = ${countFullBlobWriters(db)}, baseline 2`);
});

// ---- §2 — the endpoint is not a generic email primitive -------
test('the pure module has no I/O and derives the recipient only from the registration', () => {
  for (const forbidden of [/from '\.\/database\.js'/, /from 'pg'/, /from 'node:http'/, /requirePool|new Pool|globalThis\.fetch|process\.env/]) {
    assert.doesNotMatch(pure, forbidden);
  }
  assert.match(pure, /HISTORICAL_CONFIRMATION_RESEND_CONTEXT_PREFIX = 'historical-confirmation-resend'/);
  assert.match(pure, /\$\{HISTORICAL_CONFIRMATION_RESEND_CONTEXT_PREFIX\}:\$\{registrationId\}:\$\{canonicalRecipientHash\}/);
  assert.match(pure, /hashEmailRecipient\(canonicalEmail\)/);
  assert.doesNotMatch(handler, /hashEmailRecipient\(/, 'the handler does not hash a caller-supplied value');
});

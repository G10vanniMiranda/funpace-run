import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// PARTICIPANT-OPS-001 CASE A / Stage A2 — structural guards on the recovery
// endpoint. Repo convention: no live PG in unit tests; the send/idempotency
// semantics are proven against real PostgreSQL in the homolog .mts proof.

const idx = readFileSync('server/index.ts', 'utf8');
const db = readFileSync('server/database.ts', 'utf8');
const pure = readFileSync('server/confirmation-recovery.ts', 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function slice(src: string, startNeedle: string, endNeedle: string): string {
  const a = src.indexOf(startNeedle);
  const b = src.indexOf(endNeedle, a + startNeedle.length);
  assert.ok(a >= 0 && b > a, `located ${startNeedle}`);
  return src.slice(a, b);
}

// end-needles pinned to the FUNCTION THAT IMMEDIATELY FOLLOWS the Case A code —
// re-pinned when PARTICIPANT-OPS-001 Case B (#B2) added a sibling handler /
// snapshot reader directly after these. The slices, assertions and intent are
// unchanged; only the boundary moved so each test stays scoped to Case A alone.
const handler = strip(slice(idx, 'async function handleAdminRecoverConfirmationEmail(', '\nasync function handleAdminResendHistoricalConfirmation('));
const snapshotFn = strip(slice(db, 'export async function loadConfirmationRecoverySnapshotInPostgres(', '\nexport async function loadHistoricalConfirmationResendSnapshotInPostgres('));

// --- Section 3 — RBAC: administrator only ------------------------------------
test('handler requires an authenticated admin session with role administrator only', () => {
  assert.match(handler, /requireAdmin\(req,\s*res,\s*\[\s*'administrator'\s*\]\)/, 'administrator-only');
  assert.doesNotMatch(handler, /requireAdmin\([^)]*'finance'/, 'finance is not granted recovery');
  assert.doesNotMatch(handler, /requireAdmin\([^)]*'operation'/, 'operation is not granted recovery');
  assert.match(handler, /requireAdminDatabase\(res\)/);
});

// --- Section 6 — the destination email is never client-supplied --------------
test('handler never reads a destination address from the request body', () => {
  // the only field parsed off the body is `reason`
  assert.match(handler, /parseJsonBody<\{\s*reason\?:\s*string\s*\}>/);
  for (const forbidden of [/body\.email/, /body\.to\b/, /body\.recipient/, /body\.destination/, /body\.address/]) {
    assert.doesNotMatch(handler, forbidden, `must not read ${forbidden} from the client`);
  }
});

// --- Section 7 — reuse the pipeline via a semantic context, not raw force ----
test('handler drives the send through a server-derived contextKey, never force=true', () => {
  assert.match(handler, /processRegistrationEmail\(registrationId,\s*\{\s*contextKey\s*\}\)/);
  assert.doesNotMatch(handler, /force:\s*true/, 'no raw force flag is passed');
  assert.match(handler, /assessment\.recoveryContextKey/, 'contextKey comes from the server-side assessment');
});

// --- Section 9 — narrow audit only, never the full-blob transaction() --------
test('handler audits exclusively through appendAuditLogInPostgres and never opens a transaction()', () => {
  assert.doesNotMatch(handler, /\btransaction\s*[<(]/, 'no generic full-blob transaction() in the recovery handler');
  assert.doesNotMatch(handler, /savePostgresDatabase|readPostgresDatabase/, 'no full-dataset read/write');
  const actions = [...handler.matchAll(/action:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(actions)].sort(),
    ['email.confirmation.recovery.accepted', 'email.confirmation.recovery.failed', 'email.confirmation.recovery.requested', 'email.confirmation.recovery.skipped'],
    'exactly the four recovery audit actions',
  );
  const appendCalls = (handler.match(/appendAuditLogInPostgres\(/g) || []).length;
  assert.ok(appendCalls >= 4, `every branch appends a narrow audit row (${appendCalls})`);
});

// --- Section 10 — every terminal branch returns a machine-readable outcome ---
test('handler responds with a bounded outcome enum on every path', () => {
  const outcomes = [...handler.matchAll(/outcome:\s*'([A-Z_]+)'/g)].map((m) => m[1]);
  const allowed = new Set(['RECOVERY_ACCEPTED', 'ALREADY_RECOVERED', 'RECOVERY_IN_PROGRESS', 'NOT_ELIGIBLE', 'PROVIDER_FAILURE']);
  assert.ok(outcomes.length > 0);
  for (const o of outcomes) assert.ok(allowed.has(o), `unexpected outcome ${o}`);
  // distinct HTTP families are used: 2xx success/idempotent, 4xx validation/conflict, 5xx provider
  assert.match(handler, /json\(res,\s*assessment\.httpStatus/, 'validation/conflict uses the assessment status');
  assert.match(handler, /json\(res,\s*200,\s*\{\s*outcome:\s*'RECOVERY_ACCEPTED'/);
  assert.match(handler, /json\(res,\s*502,/);
  assert.match(handler, /json\(res,\s*503,/);
});

// --- Section 14 — a null claim is re-classified, never retried into a send ---
test('a declined claim is re-assessed to ALREADY_RECOVERED / RECOVERY_IN_PROGRESS, not re-sent', () => {
  const nullBranch = handler.slice(handler.indexOf('if (result === null)'), handler.indexOf('if (result.ok)'));
  assert.match(nullBranch, /loadConfirmationRecoverySnapshotInPostgres/, 're-reads authoritative state');
  assert.doesNotMatch(nullBranch, /processRegistrationEmail/, 'never re-invokes the sender');
});

// --- Section 2 — canonical nested Admin route -------------------------------
test('the router exposes POST /api/admin/registrations/:id/recover-confirmation-email', () => {
  assert.match(idx, /const adminRegistrationRecoverEmail = url\.pathname\.match\(\/\^\\\/api\\\/admin\\\/registrations\\\/\(\[\^\/\]\+\)\\\/recover-confirmation-email\$\/\)/);
  assert.match(idx, /req\.method === 'POST' && adminRegistrationRecoverEmail/);
  assert.match(idx, /handleAdminRecoverConfirmationEmail\(req, res, decodeURIComponent\(adminRegistrationRecoverEmail\[1\]\), url\)/);
});

// --- Section 4 — the snapshot reader is narrow -----------------------------
test('loadConfirmationRecoverySnapshotInPostgres is three narrow SELECTs, no lock / no auto-migrate', () => {
  assert.doesNotMatch(snapshotFn, /ensurePostgresReady/, 'no runtime auto-migrate trigger');
  assert.doesNotMatch(snapshotFn, /savePostgresDatabase|readPostgresDatabase/, 'no full-dataset read/write');
  assert.doesNotMatch(snapshotFn, /pg_advisory_xact_lock|funpace-run-write/, 'no global advisory lock');
  assert.doesNotMatch(snapshotFn, /\btransaction\s*[<(]/, 'no generic transaction()');
  assert.doesNotMatch(snapshotFn, /\bbegin\b|for update/, 'read-only, no row locks');
  const selects = (snapshotFn.match(/select /gi) || []).length;
  const writes = (snapshotFn.match(/insert into|update |delete from/gi) || []).length;
  assert.equal(writes, 0, 'the snapshot reader performs no writes');
  assert.ok(selects >= 3 && selects <= 4, `narrow read set (${selects} SELECTs)`);
  const tables = [...new Set([...snapshotFn.matchAll(/\$\{table\.(\w+)\}/g)].map((m) => m[1]))].sort();
  assert.deepEqual(tables, ['confirmationEmailOutbox', 'emailDeliveries', 'registrations']);
});

// --- Section 5 / 6 — the decision layer is pure ---------------------------
test('confirmation-recovery.ts has no I/O and no framework/database imports', () => {
  for (const forbidden of [/from '\.\/database\.js'/, /from 'pg'/, /from 'node:http'/, /requirePool|new Pool|globalThis\.fetch|process\.env/]) {
    assert.doesNotMatch(pure, forbidden, `pure module must not reference ${forbidden}`);
  }
  // it imports only the deterministic hashing / idempotency helpers
  assert.match(pure, /from '\.\/email-delivery-history\.js'/);
});

test('the recovery context key is namespaced and derived only from id + recipient hash', () => {
  assert.match(pure, /CONFIRMATION_RECOVERY_CONTEXT_PREFIX = 'confirmation-recovery'/);
  assert.match(pure, /\$\{CONFIRMATION_RECOVERY_CONTEXT_PREFIX\}:\$\{registrationId\}:\$\{canonicalRecipientHash\}/);
  // the endpoint cannot become a generic email primitive: the recipient hash is
  // always taken from the registration's own canonical email, never a parameter.
  assert.match(pure, /hashEmailRecipient\(canonicalEmail\)/);
  assert.doesNotMatch(handler, /hashEmailRecipient\(/, 'the handler does not hash a caller-supplied value');
});

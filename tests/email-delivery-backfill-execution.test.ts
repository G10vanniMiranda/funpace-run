import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildApprovedBackfillPlan,
  buildBackfillRollbackStatement,
  buildHistoricalDeliveryInsertRows,
  buildHistoricalDeliveryInsertStatement,
  computePlanFingerprint,
  deriveBackfillBatchId,
  evaluateRecoverableCandidate,
  precheckProviderCollisions,
  sanitizePlan,
} from '../server/email-delivery-backfill-execution.js';

// --- synthetic builders --------------------------------------------------------
const T_SNAP = '2026-07-01T09:59:00.000Z';
const T_DONE = '2026-07-01T10:00:05.000Z';

function acceptable(id: string, email = `hist-${id}@synthetic.test`, pmid = `pm-${id}`) {
  return {
    registrationId: id,
    summary: {
      registrationId: id, currentRecipientEmail: `now-${id}@synthetic.test`,
      provider: 'resend', providerMessageId: pmid, sentAt: T_DONE, lastAttemptAt: null, error: null,
    },
    audits: [
      { action: 'email.confirmation.skipped', createdAt: T_SNAP, payload: { email } },
      { action: 'email.confirmation.sent', createdAt: T_DONE, payload: { providerMessageId: pmid, provider: 'resend' } },
    ],
  };
}
function unresolved(id: string) {
  return {
    registrationId: id,
    summary: { registrationId: id, currentRecipientEmail: `x-${id}@synthetic.test`, provider: 'resend', providerMessageId: `pm-${id}`, sentAt: T_DONE, lastAttemptAt: null, error: null },
    audits: [{ action: 'email.confirmation.sent', createdAt: T_DONE, payload: { providerMessageId: `pm-${id}`, provider: 'resend' } }],
  };
}
function ambiguous(id: string) {
  return {
    registrationId: id,
    summary: { registrationId: id, currentRecipientEmail: `x-${id}@synthetic.test`, provider: 'resend', providerMessageId: `pm-${id}`, sentAt: T_DONE, lastAttemptAt: null, error: null },
    audits: [
      { action: 'email.confirmation.skipped', createdAt: '2026-07-01T09:58:00.000Z', payload: { email: `a-${id}@synthetic.test` } },
      { action: 'email.pending.skipped', createdAt: T_SNAP, payload: { email: `b-${id}@synthetic.test` } },
      { action: 'email.confirmation.sent', createdAt: T_DONE, payload: { providerMessageId: `pm-${id}`, provider: 'resend' } },
    ],
  };
}

test('a RECOVERABLE candidate with a single coherent snapshot is RECOVERABLE_ACCEPTABLE / eligible', () => {
  const c = acceptable('r1');
  const e = evaluateRecoverableCandidate(c.summary, c.audits, []);
  assert.equal(e.subClass, 'RECOVERABLE_ACCEPTABLE');
  assert.equal(e.action, 'ELIGIBLE_FOR_HUMAN_APPROVAL');
  assert.equal(e.status, 'sent');
  assert.equal(e.distinctRecipientHashes, 1);
  assert.equal(e.identityChangeInWindow, false);
  assert.equal(e.providerMessageInHistory, 'none');
});

test('an attempt audit makes it PROVEN, so the RECOVERABLE plan excludes it as non-recoverable', () => {
  const c = acceptable('r2');
  c.audits.unshift({ action: 'email.confirmation.attempted', createdAt: '2026-07-01T09:58:30.000Z', payload: { email: 'hist-r2@synthetic.test' } });
  const plan = buildApprovedBackfillPlan({ candidates: [c], existing: [] });
  assert.equal(plan.eligible.length, 0);
  assert.equal(plan.excluded.notRecoverable, 1);
});

test('plan keeps only eligible acceptable candidates and excludes the rest', () => {
  const plan = buildApprovedBackfillPlan({
    candidates: [acceptable('a'), acceptable('b'), acceptable('c'), unresolved('u'), ambiguous('m')],
    existing: [],
  });
  assert.equal(plan.eligible.length, 3);
  assert.equal(plan.excluded.notRecoverable, 2); // UNRESOLVED + AMBIGUOUS both fail the RECOVERABLE gate
  assert.equal(plan.cohort, 'recoverable_acceptable');
  for (const row of plan.eligible) {
    assert.equal(row.status, 'sent');
    assert.match(row.recipientHash, /^[0-9a-f]{64}$/);
  }
});

test('an existing idempotency key or provider identity yields NO plan row for that candidate', () => {
  const c = acceptable('dup');
  const seed = buildApprovedBackfillPlan({ candidates: [c], existing: [] }).eligible[0];
  const plan = buildApprovedBackfillPlan({
    candidates: [c],
    existing: [{ registrationId: 'dup', recipientHash: seed.recipientHash, provider: 'resend', providerMessageId: 'pm-dup', idempotencyKey: seed.idempotencyKey }],
  });
  assert.equal(plan.eligible.length, 0);
  assert.equal(plan.excluded.alreadyHasHistory, 1);
});

test('a provider message id already on an INCOMPATIBLE identity excludes the candidate', () => {
  const c = acceptable('coll');
  const plan = buildApprovedBackfillPlan({
    candidates: [c],
    existing: [{ registrationId: 'someone-else', recipientHash: 'f'.repeat(64), provider: 'resend', providerMessageId: 'pm-coll', idempotencyKey: 'x'.repeat(64) }],
  });
  assert.equal(plan.eligible.length, 0);
  assert.equal(plan.excluded.providerCollision, 1);
});

test('plan fingerprint is deterministic and order-independent', () => {
  const a = buildApprovedBackfillPlan({ candidates: [acceptable('x'), acceptable('y'), acceptable('z')], existing: [] });
  const b = buildApprovedBackfillPlan({ candidates: [acceptable('z'), acceptable('x'), acceptable('y')], existing: [] });
  assert.equal(a.planFingerprint, b.planFingerprint);
  assert.match(a.planFingerprint, /^[0-9a-f]{64}$/);
});

test('plan fingerprint changes when cohort membership changes (drift is detectable)', () => {
  const a = buildApprovedBackfillPlan({ candidates: [acceptable('x'), acceptable('y')], existing: [] });
  const b = buildApprovedBackfillPlan({ candidates: [acceptable('x'), acceptable('y'), acceptable('w')], existing: [] });
  assert.notEqual(a.planFingerprint, b.planFingerprint);
});

test('insert statement is append-only, parameterised and self-describing', () => {
  const plan = buildApprovedBackfillPlan({ candidates: [acceptable('s1'), acceptable('s2')], existing: [] });
  const batchId = deriveBackfillBatchId(plan.planFingerprint, '2026-09-01T00:00:00.000Z');
  assert.match(batchId, /^email-history-recoverable_acceptable-20260901-[0-9a-f]{12}$/);
  const rows = buildHistoricalDeliveryInsertRows(plan.eligible, batchId, '2026-09-01T12:00:00.000Z');
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.status, 'sent');
    assert.equal(row.attempt_count, 1);
    assert.equal(row.failed_at, null);
    assert.equal(row.error, null);
    assert.equal(row.id, `historical:${row.idempotency_key}`);
    assert.equal(row.attempted_at, T_SNAP);         // historical, not NOW()
    assert.equal(row.sent_at, T_DONE);              // historical, not NOW()
    assert.equal(row.created_at, T_DONE);
    assert.equal(row.metadata.backfillCohort, 'recoverable_acceptable');
    assert.equal(row.metadata.historical, true);
    assert.equal(row.metadata.recipientSource, 'historical_snapshot');
    assert.equal(row.metadata.recordedAt, '2026-09-01T12:00:00.000Z');
  }
  const stmt = buildHistoricalDeliveryInsertStatement(rows);
  assert.equal(stmt.text.includes('on conflict (idempotency_key) do nothing'), true);
  assert.equal(stmt.text.includes('returning id'), true);
  assert.equal(stmt.text.toLowerCase().includes('update '), false);
  assert.equal(stmt.text.toLowerCase().includes('delete '), false);
  assert.equal(stmt.params.length, 1);
  assert.equal(stmt.expectedInserts, 2);
});

test('rollback statement is narrow: batch + cohort + historical + explicit key list', () => {
  const keys = ['a'.repeat(64), 'b'.repeat(64)];
  const rb = buildBackfillRollbackStatement({ batchId: 'email-history-recoverable_acceptable-20260901-abcdef012345', idempotencyKeys: keys });
  assert.equal(rb.text.includes("metadata->>'backfillBatchId' = $1"), true);
  assert.equal(rb.text.includes("metadata->>'backfillCohort' = 'recoverable_acceptable'"), true);
  assert.equal(rb.text.includes("metadata->>'historical' = 'true'"), true);
  assert.equal(rb.text.includes('idempotency_key = any($2::text[])'), true);
  assert.equal(rb.expectedDeletes, 2);
  assert.throws(() => buildBackfillRollbackStatement({ batchId: 'b', idempotencyKeys: [] }));
  assert.throws(() => buildBackfillRollbackStatement({ batchId: 'b', idempotencyKeys: ['not-a-sha'] }));
});

test('provider collision precheck passes for compatible identity, fails for foreign identity', () => {
  const plan = buildApprovedBackfillPlan({ candidates: [acceptable('pc')], existing: [] });
  assert.equal(precheckProviderCollisions(plan.eligible, []).ok, true);
  const foreign = [{ registrationId: 'other', recipientHash: '0'.repeat(64), provider: 'resend', providerMessageId: 'pm-pc', idempotencyKey: 'z'.repeat(64) }];
  assert.equal(precheckProviderCollisions(plan.eligible, foreign).ok, false);
});

test('sanitized plan carries no PII: no email, no raw registration id, no raw provider message id', () => {
  const plan = buildApprovedBackfillPlan({ candidates: [acceptable('leak', 'secret@synthetic.test', 'pm-secret')], existing: [] });
  const s = JSON.stringify(sanitizePlan(plan));
  assert.equal(s.includes('secret@synthetic.test'), false);
  assert.equal(s.includes('pm-secret'), false);
  assert.equal(s.includes('"leak"'), false);
  assert.equal(sanitizePlan(plan).rows[0].action, 'PLANNED_INSERT_ON_APPROVAL');
});

test('the apply CLI refuses to write without every gate (exit 2, no DB touched)', () => {
  const script = fileURLToPath(new URL('../scripts/apply-email-delivery-backfill.mjs', import.meta.url));
  const run = (args: string[]) => {
    try {
      execFileSync(process.execPath, ['--import', 'tsx', script, ...args], {
        encoding: 'utf8', stdio: 'pipe',
        env: { ...process.env, DATABASE_URL: '', DATABASE_PROVIDER: '', EMAIL_HISTORY_BACKFILL_ENVIRONMENT: '' },
      });
      return { code: 0, stderr: '' };
    } catch (error) {
      return { code: (error as { status?: number }).status ?? 1, stderr: String((error as { stderr?: string }).stderr ?? '') };
    }
  };
  let r = run(['--apply']);
  assert.equal(r.code, 2); assert.match(r.stderr, /approved-plan/i);
  r = run(['--apply', '--approved-plan', 'f'.repeat(64)]);
  assert.equal(r.code, 2); assert.match(r.stderr, /confirm/i);
  r = run(['--apply', '--approved-plan', 'f'.repeat(64), '--confirm', 'APPLY_APPROVED_EMAIL_HISTORY_BACKFILL']);
  assert.equal(r.code, 2); assert.match(r.stderr, /EMAIL_HISTORY_BACKFILL_ENVIRONMENT/);
});

test('neither the apply CLI nor the executor module imports a sender / provider / outbox', () => {
  const importLines = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
    .split(/\r?\n/)
    .filter((line) => /^\s*(import\b|.*\brequire\(|.*\bawait import\()/.test(line))
    .join('\n');
  const forbidden = /server\/email\.(ts|js)|['"]resend['"]|nodemailer|['"]smtp|recover-confirmation-emails|resend-registration-email|email-outbox|google-sheets\.(ts|js)|server\/index\.(ts|js)/i;
  assert.equal(forbidden.test(importLines('../scripts/apply-email-delivery-backfill.mjs')), false);
  assert.equal(forbidden.test(importLines('../server/email-delivery-backfill-execution.ts')), false);
});

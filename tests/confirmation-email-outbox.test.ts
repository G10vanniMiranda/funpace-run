import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONFIRMATION_EMAIL_OUTBOX_MAX_ATTEMPTS,
  applyOutboxResolutionInMemory,
  classifyConfirmationSenderResult,
  enqueueConfirmationEmailInMemory,
  isConfirmationEmailOutboxExhausted,
  markConfirmationEmailOutboxProcessingInMemory,
  nextConfirmationEmailAttemptAt,
  planConfirmationEmailBackoffMs,
  reclaimStaleConfirmationEmailOutboxInMemory,
  resolveOutboxTask,
  selectDueConfirmationEmailOutboxInMemory,
  type ConfirmationEmailOutboxRecord,
} from '../server/confirmation-email-outbox';

let seq = 0;
const nextId = () => `outbox-${(seq += 1)}`;
const at = (minutes: number) => new Date(Date.UTC(2026, 8, 1, 12, 0, 0) + minutes * 60_000).toISOString();

test('back-off is exponential and capped', () => {
  assert.equal(planConfirmationEmailBackoffMs(1), 5 * 60_000);
  assert.equal(planConfirmationEmailBackoffMs(2), 10 * 60_000);
  assert.equal(planConfirmationEmailBackoffMs(3), 20 * 60_000);
  assert.equal(planConfirmationEmailBackoffMs(10), 6 * 60 * 60_000); // capped at 6h
  assert.equal(nextConfirmationEmailAttemptAt(1, at(0)), at(5));
});

test('exhaustion boundary matches the configured max', () => {
  assert.equal(isConfirmationEmailOutboxExhausted(CONFIRMATION_EMAIL_OUTBOX_MAX_ATTEMPTS - 1), false);
  assert.equal(isConfirmationEmailOutboxExhausted(CONFIRMATION_EMAIL_OUTBOX_MAX_ATTEMPTS), true);
});

test('resolveOutboxTask: sent / already-satisfied complete without retry', () => {
  assert.deepEqual(resolveOutboxTask({ attempts: 0 }, { kind: 'sent' }, at(0)), { action: 'complete' });
  assert.deepEqual(resolveOutboxTask({ attempts: 3 }, { kind: 'already-satisfied' }, at(0)), { action: 'complete' });
});

test('resolveOutboxTask: a config skip is terminal but never alerts', () => {
  const resolution = resolveOutboxTask({ attempts: 0 }, { kind: 'skipped', reason: 'provider disabled' }, at(0));
  assert.equal(resolution.action, 'fail');
  assert.equal(resolution.alert, false);
  assert.match(resolution.lastError, /^skipped: provider disabled/);
});

test('resolveOutboxTask: transient failure retries with back-off until the max, then fails + alerts', () => {
  let task: Pick<ConfirmationEmailOutboxRecord, 'attempts'> = { attempts: 0 };
  for (let i = 1; i < CONFIRMATION_EMAIL_OUTBOX_MAX_ATTEMPTS; i += 1) {
    const resolution = resolveOutboxTask(task, { kind: 'transient-failure', error: 'boom' }, at(0));
    assert.equal(resolution.action, 'retry', `attempt ${i} retries`);
    if (resolution.action === 'retry') {
      assert.equal(resolution.attempts, i);
      assert.equal(resolution.nextAttemptAt, nextConfirmationEmailAttemptAt(i, at(0)));
      task = { attempts: resolution.attempts };
    }
  }
  const terminal = resolveOutboxTask(task, { kind: 'transient-failure', error: 'boom' }, at(0));
  assert.equal(terminal.action, 'fail');
  assert.equal(terminal.attempts, CONFIRMATION_EMAIL_OUTBOX_MAX_ATTEMPTS);
  if (terminal.action === 'fail') assert.equal(terminal.alert, true);
});

test('classifyConfirmationSenderResult covers every sender branch', () => {
  const noDurable = { hasSentDelivery: false, legacySentAt: null };
  assert.deepEqual(
    classifyConfirmationSenderResult({ ok: true, providerMessageId: 're_123' }, noDurable),
    { kind: 'sent' },
  );
  // ok but no message id -> transient (never counts as sent)
  assert.deepEqual(
    classifyConfirmationSenderResult({ ok: true, providerMessageId: null }, noDurable),
    { kind: 'transient-failure', error: 'Email provider did not return a message id.' },
  );
  // failed send
  assert.deepEqual(
    classifyConfirmationSenderResult({ ok: false, error: 'HTTP 500' }, noDurable),
    { kind: 'transient-failure', error: 'HTTP 500' },
  );
  // config skip
  assert.deepEqual(
    classifyConfirmationSenderResult({ ok: false, skipped: true, error: 'Email provider not configured.' }, noDurable),
    { kind: 'skipped', reason: 'Email provider not configured.' },
  );
  // null claim + no durable success -> retry
  assert.equal(classifyConfirmationSenderResult(null, noDurable).kind, 'transient-failure');
  // null claim BUT a durable success exists -> already satisfied, no provider call implied
  assert.deepEqual(
    classifyConfirmationSenderResult(null, { hasSentDelivery: true, legacySentAt: null }),
    { kind: 'already-satisfied' },
  );
  assert.deepEqual(
    classifyConfirmationSenderResult({ ok: false, error: 'x' }, { hasSentDelivery: false, legacySentAt: at(0) }),
    { kind: 'already-satisfied' },
  );
});

test('enqueue is idempotent per (registration, email_type) — a duplicate webhook adds nothing', () => {
  const list: ConfirmationEmailOutboxRecord[] = [];
  const first = enqueueConfirmationEmailInMemory(list, { registrationId: 'reg-1', source: 'payment_webhook' }, at(0), nextId);
  const second = enqueueConfirmationEmailInMemory(list, { registrationId: 'reg-1', source: 'payment_webhook' }, at(1), nextId);
  assert.equal(first.outcome, 'created');
  assert.equal(second.outcome, 'exists');
  assert.equal(list.length, 1);
  assert.equal(list[0].status, 'pending');
  assert.equal(list[0].attempts, 0);
});

test('SHARED_EMAIL_POLICY: two paid registrations sharing one address get two obligations', () => {
  const list: ConfirmationEmailOutboxRecord[] = [];
  enqueueConfirmationEmailInMemory(list, { registrationId: 'reg-A', eventId: 'evt-1' }, at(0), nextId);
  enqueueConfirmationEmailInMemory(list, { registrationId: 'reg-B', eventId: 'evt-1' }, at(0), nextId);
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((row) => row.registrationId).sort(), ['reg-A', 'reg-B']);
});

test('selectDue honours next_attempt_at and orders oldest-first', () => {
  const list: ConfirmationEmailOutboxRecord[] = [];
  enqueueConfirmationEmailInMemory(list, { registrationId: 'reg-late' }, at(0), nextId);
  enqueueConfirmationEmailInMemory(list, { registrationId: 'reg-early' }, at(0), nextId);
  // push reg-late's next attempt into the future
  list[0].nextAttemptAt = at(30);
  list[1].nextAttemptAt = at(1);
  const due = selectDueConfirmationEmailOutboxInMemory(list, at(10), 25);
  assert.deepEqual(due.map((row) => row.registrationId), ['reg-early']);
  const dueLater = selectDueConfirmationEmailOutboxInMemory(list, at(40), 25);
  assert.deepEqual(dueLater.map((row) => row.registrationId), ['reg-early', 'reg-late']);
});

test('a claimed (processing) task is not re-selected — no double take by a second worker', () => {
  const list: ConfirmationEmailOutboxRecord[] = [];
  enqueueConfirmationEmailInMemory(list, { registrationId: 'reg-1' }, at(0), nextId);
  const [claimed] = selectDueConfirmationEmailOutboxInMemory(list, at(1), 25);
  markConfirmationEmailOutboxProcessingInMemory(claimed, at(1), 'worker-a');
  assert.deepEqual(selectDueConfirmationEmailOutboxInMemory(list, at(1), 25), []);
});

test('stale processing tasks are reclaimed to pending; fresh ones are left alone', () => {
  const list: ConfirmationEmailOutboxRecord[] = [];
  enqueueConfirmationEmailInMemory(list, { registrationId: 'reg-stale' }, at(0), nextId);
  enqueueConfirmationEmailInMemory(list, { registrationId: 'reg-fresh' }, at(0), nextId);
  markConfirmationEmailOutboxProcessingInMemory(list[0], at(0), 'crashed-worker');
  markConfirmationEmailOutboxProcessingInMemory(list[1], at(20), 'live-worker');
  const reclaimed = reclaimStaleConfirmationEmailOutboxInMemory(list, at(25));
  assert.equal(reclaimed, 1);
  assert.equal(list[0].status, 'pending');
  assert.equal(list[0].lockedBy, null);
  assert.equal(list[1].status, 'processing');
});

test('applyOutboxResolutionInMemory drives the full lifecycle', () => {
  const list: ConfirmationEmailOutboxRecord[] = [];
  enqueueConfirmationEmailInMemory(list, { registrationId: 'reg-1' }, at(0), nextId);
  const row = list[0];

  markConfirmationEmailOutboxProcessingInMemory(row, at(1), 'w');
  applyOutboxResolutionInMemory(row, { action: 'retry', attempts: 1, nextAttemptAt: at(6), lastError: 'boom' }, at(1));
  assert.equal(row.status, 'pending');
  assert.equal(row.attempts, 1);
  assert.equal(row.nextAttemptAt, at(6));
  assert.equal(row.lockedAt, null);

  markConfirmationEmailOutboxProcessingInMemory(row, at(6), 'w');
  applyOutboxResolutionInMemory(row, { action: 'complete' }, at(6));
  assert.equal(row.status, 'completed');
  assert.equal(row.processedAt, at(6));

  const failRow = enqueueConfirmationEmailInMemory(list, { registrationId: 'reg-2' }, at(0), nextId).record;
  applyOutboxResolutionInMemory(failRow, { action: 'fail', attempts: 6, lastError: 'dead', alert: true }, at(9));
  assert.equal(failRow.status, 'failed');
  assert.equal(failRow.processedAt, at(9));
  assert.equal(failRow.lastError, 'dead');
});

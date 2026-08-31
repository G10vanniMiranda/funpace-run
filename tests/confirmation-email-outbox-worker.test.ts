import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONFIRMATION_EMAIL_OUTBOX_MAX_ATTEMPTS,
  applyOutboxResolutionInMemory,
  classifyConfirmationSenderResult,
  enqueueConfirmationEmailInMemory,
  markConfirmationEmailOutboxProcessingInMemory,
  reclaimStaleConfirmationEmailOutboxInMemory,
  resolveOutboxTask,
  selectDueConfirmationEmailOutboxInMemory,
  type ConfirmationEmailOutboxRecord,
} from '../server/confirmation-email-outbox';

// A faithful in-memory replica of processConfirmationEmailOutbox() in
// server/index.ts: reclaim stale -> claim due -> for each: run sender, probe
// durable state, classify, resolve, apply. Lets the whole drain be exercised
// deterministically with a mocked provider and NO real email / DB.

type SenderResult =
  | { ok: true; providerMessageId: string }
  | { ok: true; providerMessageId: null }
  | { ok: false; error: string }
  | { ok: false; skipped: true; error: string }
  | null;

type Sender = (registrationId: string) => Promise<SenderResult> | SenderResult;
type DurableProbe = (registrationId: string) => { hasSentDelivery: boolean; legacySentAt: string | null };

async function simulateDrain(
  list: ConfirmationEmailOutboxRecord[],
  now: string,
  sender: Sender,
  durableProbe: DurableProbe = () => ({ hasSentDelivery: false, legacySentAt: null }),
  options: { batchSize?: number; runId?: string } = {},
) {
  const summary = { reclaimed: 0, claimed: 0, completed: 0, rescheduled: 0, failed: 0, alerted: 0, deferred: 0 };
  summary.reclaimed = reclaimStaleConfirmationEmailOutboxInMemory(list, now);
  const due = selectDueConfirmationEmailOutboxInMemory(list, now, options.batchSize ?? 25);
  for (const task of due) markConfirmationEmailOutboxProcessingInMemory(task, now, options.runId ?? 'worker');
  summary.claimed = due.length;

  for (const task of due) {
    let senderResult: SenderResult;
    try {
      senderResult = await sender(task.registrationId);
    } catch (error) {
      senderResult = { ok: false, error: error instanceof Error ? error.message : 'boom' };
    }
    const durable = senderResult && senderResult.ok && senderResult.providerMessageId
      ? { hasSentDelivery: false, legacySentAt: null }
      : durableProbe(task.registrationId);
    const signal = classifyConfirmationSenderResult(senderResult, durable);
    const resolution = resolveOutboxTask(task, signal, now);
    applyOutboxResolutionInMemory(task, resolution, now);
    if (resolution.action === 'complete') summary.completed += 1;
    else if (resolution.action === 'retry') summary.rescheduled += 1;
    else {
      summary.failed += 1;
      if (resolution.alert) summary.alerted += 1;
    }
  }
  return summary;
}

let seq = 0;
const nextId = () => `outbox-${(seq += 1)}`;
const at = (m: number) => new Date(Date.UTC(2026, 8, 1, 12, 0, 0) + m * 60_000).toISOString();

test('worker recovers a pending task: one send, task completed', async () => {
  const list: ConfirmationEmailOutboxRecord[] = [];
  enqueueConfirmationEmailInMemory(list, { registrationId: 'reg-1' }, at(0), nextId);
  let calls = 0;
  const summary = await simulateDrain(list, at(1), () => {
    calls += 1;
    return { ok: true, providerMessageId: 're_ok' };
  });
  assert.equal(calls, 1);
  assert.deepEqual(summary, { reclaimed: 0, claimed: 1, completed: 1, rescheduled: 0, failed: 0, alerted: 0, deferred: 0 });
  assert.equal(list[0].status, 'completed');
});

test('worker: registration already has a durable confirmation -> completed WITHOUT a provider request', async () => {
  const list: ConfirmationEmailOutboxRecord[] = [];
  enqueueConfirmationEmailInMemory(list, { registrationId: 'reg-1' }, at(0), nextId);
  let providerCalls = 0;
  const summary = await simulateDrain(
    list,
    at(1),
    () => {
      providerCalls += 1;
      return null; // claim declined (already_sent)
    },
    () => ({ hasSentDelivery: true, legacySentAt: null }),
  );
  assert.equal(summary.completed, 1);
  assert.equal(list[0].status, 'completed');
  // the sender was invoked once, but it made no provider request (returned null);
  // the durable probe is what resolved it.
  assert.equal(providerCalls, 1);
});

test('worker: provider 401 then 5xx then timeout all retry with growing back-off', async () => {
  for (const failure of ['HTTP 401 unauthorized', 'HTTP 503', 'The operation was aborted due to timeout']) {
    const list: ConfirmationEmailOutboxRecord[] = [];
    enqueueConfirmationEmailInMemory(list, { registrationId: `reg-${failure}` }, at(0), nextId);
    const summary = await simulateDrain(list, at(1), () => ({ ok: false, error: failure }));
    assert.equal(summary.rescheduled, 1, failure);
    assert.equal(list[0].status, 'pending');
    assert.equal(list[0].attempts, 1);
    assert.ok(new Date(list[0].nextAttemptAt).getTime() > new Date(at(1)).getTime(), failure);
  }
});

test('worker: bounded retries end in a terminal failure that raises exactly one alert', async () => {
  const list: ConfirmationEmailOutboxRecord[] = [];
  enqueueConfirmationEmailInMemory(list, { registrationId: 'reg-dead' }, at(0), nextId);
  let drains = 0;
  let alerts = 0;
  // drain repeatedly, always failing, fast-forwarding the clock past each back-off
  for (let i = 0; i < CONFIRMATION_EMAIL_OUTBOX_MAX_ATTEMPTS + 2 && list[0].status !== 'failed'; i += 1) {
    const now = at(1 + i * 24 * 60); // +1 day between drains: always past the cap
    const summary = await simulateDrain(list, now, () => ({ ok: false, error: 'permanent' }));
    drains += 1;
    alerts += summary.alerted;
  }
  assert.equal(list[0].status, 'failed');
  assert.equal(list[0].attempts, CONFIRMATION_EMAIL_OUTBOX_MAX_ATTEMPTS);
  assert.equal(alerts, 1);
  assert.equal(drains, CONFIRMATION_EMAIL_OUTBOX_MAX_ATTEMPTS);
});

test('worker: a config skip fails the task terminally with NO alert', async () => {
  const list: ConfirmationEmailOutboxRecord[] = [];
  enqueueConfirmationEmailInMemory(list, { registrationId: 'reg-skip' }, at(0), nextId);
  const summary = await simulateDrain(list, at(1), () => ({ ok: false, skipped: true, error: 'Email provider not configured.' }));
  assert.equal(summary.failed, 1);
  assert.equal(summary.alerted, 0);
  assert.equal(list[0].status, 'failed');
  assert.match(String(list[0].lastError), /^skipped:/);
});

test('worker: a thrown sender error is caught and retried, not propagated', async () => {
  const list: ConfirmationEmailOutboxRecord[] = [];
  enqueueConfirmationEmailInMemory(list, { registrationId: 'reg-throw' }, at(0), nextId);
  const summary = await simulateDrain(list, at(1), () => { throw new Error('pool exhausted'); });
  assert.equal(summary.rescheduled, 1);
  assert.equal(list[0].status, 'pending');
  assert.equal(list[0].attempts, 1);
  assert.match(String(list[0].lastError), /pool exhausted/);
});

test('worker: crashed processing task is reclaimed on the next drain and then completes', async () => {
  const list: ConfirmationEmailOutboxRecord[] = [];
  enqueueConfirmationEmailInMemory(list, { registrationId: 'reg-1' }, at(0), nextId);
  markConfirmationEmailOutboxProcessingInMemory(list[0], at(0), 'crashed'); // never resolved
  const summary = await simulateDrain(list, at(30), () => ({ ok: true, providerMessageId: 're_ok' }));
  assert.equal(summary.reclaimed, 1);
  assert.equal(summary.completed, 1);
  assert.equal(list[0].status, 'completed');
});

test('two concurrent workers over disjoint slices never double-send', async () => {
  const list: ConfirmationEmailOutboxRecord[] = [];
  for (let i = 0; i < 6; i += 1) enqueueConfirmationEmailInMemory(list, { registrationId: `reg-${i}` }, at(0), nextId);
  const sends = new Map<string, number>();
  const sender: Sender = (id) => {
    sends.set(id, (sends.get(id) || 0) + 1);
    return { ok: true, providerMessageId: `re_${id}` };
  };
  // worker A claims a bounded batch first; worker B then claims what is left.
  const a = await simulateDrain(list, at(1), sender, undefined, { batchSize: 4, runId: 'A' });
  const b = await simulateDrain(list, at(1), sender, undefined, { batchSize: 25, runId: 'B' });
  assert.equal(a.claimed + b.claimed, 6);
  assert.equal([...sends.values()].every((n) => n === 1), true);
  assert.equal(list.every((row) => row.status === 'completed'), true);
});

test('re-draining after completion is a no-op (duplicate worker execution)', async () => {
  const list: ConfirmationEmailOutboxRecord[] = [];
  enqueueConfirmationEmailInMemory(list, { registrationId: 'reg-1' }, at(0), nextId);
  let sends = 0;
  const sender: Sender = () => { sends += 1; return { ok: true, providerMessageId: 're_ok' }; };
  await simulateDrain(list, at(1), sender);
  const second = await simulateDrain(list, at(2), sender);
  assert.equal(sends, 1);
  assert.deepEqual(second, { reclaimed: 0, claimed: 0, completed: 0, rescheduled: 0, failed: 0, alerted: 0, deferred: 0 });
});

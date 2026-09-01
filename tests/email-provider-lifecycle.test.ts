import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyBounceReason,
  deriveLifecycleFromEvents,
  digestWebhookBody,
  isParticipantActionLifecycle,
  maskEmailLike,
  normalizeResendWebhookEvent,
  RESEND_LIFECYCLE_EVENT_TYPES,
  sanitizeReasonDetail,
} from '../server/email-provider-lifecycle';

// EMAIL-OPS-003 Stage 2 §10/§14/§15/§16 — pure provider-lifecycle logic.

const T = (min: number) => `2026-09-01T00:${String(min).padStart(2, '0')}:00.000Z`;
const ev = (eventType: string, min: number) => ({ eventType, providerCreatedAt: T(min) });
const lc = (events: Array<{ eventType: string; providerCreatedAt: string }>) => deriveLifecycleFromEvents(events).lifecycle;

// ---- normalization -------------------------------------------------------

test('normalizeResendWebhookEvent maps each recognised event to a lifecycle', () => {
  for (const type of RESEND_LIFECYCLE_EVENT_TYPES) {
    const out = normalizeResendWebhookEvent({ type, data: { email_id: 'e1', created_at: T(0) } });
    assert.equal(out.kind, 'lifecycle', type);
  }
});

test('unrecognised (but possibly valid) event type is IGNORED, never crashes', () => {
  for (const type of ['email.opened', 'email.clicked', 'email.scheduled', 'contact.created', 'totally.made.up', '']) {
    const out = normalizeResendWebhookEvent({ type, data: { email_id: 'e1' } });
    assert.equal(out.kind, 'ignored');
    if (out.kind === 'ignored') assert.equal(out.reason, 'unrecognized_type');
  }
});

test('missing data.email_id -> ignored (missing_email_id), no correlation guess', () => {
  const out = normalizeResendWebhookEvent({ type: 'email.delivered', data: { created_at: T(0) } });
  assert.equal(out.kind, 'ignored');
  if (out.kind === 'ignored') assert.equal(out.reason, 'missing_email_id');
});

test('providerCreatedAt falls back data.created_at -> root.created_at -> epoch', () => {
  assert.equal(
    (normalizeResendWebhookEvent({ type: 'email.sent', created_at: T(5), data: { email_id: 'e' } }) as { providerCreatedAt: string }).providerCreatedAt,
    T(5),
  );
  assert.equal(
    (normalizeResendWebhookEvent({ type: 'email.sent', data: { email_id: 'e' } }) as { providerCreatedAt: string }).providerCreatedAt,
    new Date(0).toISOString(),
  );
});

test('reason_detail is masked (no raw email) and truncated to 500', () => {
  const long = 'x'.repeat(900);
  const out = normalizeResendWebhookEvent({
    type: 'email.bounced',
    data: { email_id: 'e', created_at: T(1), bounce: { message: `mailbox for victim@example.com is full ${long}` } },
  });
  assert.equal(out.kind, 'lifecycle');
  if (out.kind === 'lifecycle') {
    assert.ok(out.reasonDetail && out.reasonDetail.length <= 500);
    assert.doesNotMatch(out.reasonDetail || '', /victim@example\.com/);
    assert.match(out.reasonDetail || '', /\[email\]/);
  }
});

test('maskEmailLike / sanitizeReasonDetail helpers', () => {
  assert.equal(maskEmailLike('to a@b.co and c.d@e.f.gov ok'), 'to [email] and [email] ok');
  assert.equal(sanitizeReasonDetail(null), null);
  assert.equal(sanitizeReasonDetail(''), null);
  assert.equal(sanitizeReasonDetail('  multi   space\n\ttrim  '), 'multi space trim');
});

test('classifyBounceReason is conservative: unknown unless clearly permanent/transient', () => {
  assert.equal(classifyBounceReason({ message: 'The recipient does not exist' }).category, 'hard');
  assert.equal(classifyBounceReason({ type: 'Permanent', message: 'blocked' }).category, 'hard');
  assert.equal(classifyBounceReason({ message: 'mailbox full, try again later' }).category, 'soft');
  assert.equal(classifyBounceReason({ type: 'Transient' }).category, 'soft');
  assert.equal(classifyBounceReason({ message: 'delivery failed' }).category, 'unknown');
  assert.equal(classifyBounceReason(null).category, 'unknown');
});

test('email.failed / email.suppressed do not invent fields; missing reason -> null detail', () => {
  const failed = normalizeResendWebhookEvent({ type: 'email.failed', data: { email_id: 'e', created_at: T(1) } });
  assert.equal(failed.kind, 'lifecycle');
  if (failed.kind === 'lifecycle') { assert.equal(failed.lifecycle, 'failed'); assert.equal(failed.reasonDetail, null); assert.equal(failed.reasonCategory, 'failed'); }
  const failedWithReason = normalizeResendWebhookEvent({ type: 'email.failed', data: { email_id: 'e', created_at: T(1), failed: { reason: 'domain not verified' } } });
  if (failedWithReason.kind === 'lifecycle') assert.equal(failedWithReason.reasonDetail, 'domain not verified');
});

test('digestWebhookBody is a stable sha256 hex, not the body', () => {
  const d = digestWebhookBody('{"a":1}');
  assert.match(d, /^[0-9a-f]{64}$/);
  assert.equal(d, digestWebhookBody('{"a":1}'));
  assert.notEqual(d, digestWebhookBody('{"a":2}'));
});

// ---- state machine: determinism, out-of-order, contradictions -----------

test('happy path: sent -> delivered', () => {
  assert.equal(lc([ev('email.sent', 0), ev('email.delivered', 1)]), 'delivered');
});

test('delayed -> delivered resolves to delivered; delayed -> bounced resolves to bounced', () => {
  assert.equal(lc([ev('email.sent', 0), ev('email.delivery_delayed', 1), ev('email.delivered', 2)]), 'delivered');
  assert.equal(lc([ev('email.sent', 0), ev('email.delivery_delayed', 1), ev('email.bounced', 2)]), 'bounced');
});

test('delivered then complained -> complained (complaint always supersedes delivered)', () => {
  assert.equal(lc([ev('email.delivered', 1), ev('email.complained', 5)]), 'complained');
});

test('complaint is absorbing: nothing after it changes the state', () => {
  assert.equal(lc([ev('email.complained', 5), ev('email.delivered', 6), ev('email.bounced', 7)]), 'complained');
});

test('ORDER-INDEPENDENCE: derivation is a pure function of the event SET', () => {
  const set = [ev('email.sent', 0), ev('email.delivery_delayed', 1), ev('email.bounced', 2), ev('email.delivered', 3)];
  const forward = deriveLifecycleFromEvents(set);
  const reversed = deriveLifecycleFromEvents([...set].reverse());
  const shuffled = deriveLifecycleFromEvents([set[2], set[0], set[3], set[1]]);
  assert.deepEqual(forward, reversed);
  assert.deepEqual(forward, shuffled);
});

test('out-of-order arrival: a late `delivered` with an EARLIER timestamp does NOT un-bounce', () => {
  // bounce really happened at minute 2; a delivered webhook (minute 1) arrives later
  assert.equal(lc([ev('email.bounced', 2), ev('email.delivered', 1)]), 'bounced');
  assert.equal(lc([ev('email.delivered', 1), ev('email.bounced', 2)]), 'bounced');
});

test('§15 two contradictory TERMINAL FAILURES: same result regardless of arrival order', () => {
  // bounced@2, failed@3 -> the first (earlier) failure label wins, both orders
  assert.equal(lc([ev('email.bounced', 2), ev('email.failed', 3)]), 'bounced');
  assert.equal(lc([ev('email.failed', 3), ev('email.bounced', 2)]), 'bounced');
  // failed@2, bounced@3 -> failed wins, both orders
  assert.equal(lc([ev('email.failed', 2), ev('email.bounced', 3)]), 'failed');
  assert.equal(lc([ev('email.bounced', 3), ev('email.failed', 2)]), 'failed');
});

test('§15 two terminal failures at the SAME timestamp: fixed severity order breaks the tie deterministically', () => {
  const same = '2026-09-01T00:02:00.000Z';
  const a = deriveLifecycleFromEvents([
    { eventType: 'email.failed', providerCreatedAt: same },
    { eventType: 'email.suppressed', providerCreatedAt: same },
  ]);
  const b = deriveLifecycleFromEvents([
    { eventType: 'email.suppressed', providerCreatedAt: same },
    { eventType: 'email.failed', providerCreatedAt: same },
  ]);
  assert.deepEqual(a, b);
  assert.equal(a.lifecycle, 'suppressed'); // suppressed > bounced > failed
});

test('a terminal failure is sticky: a later `delivered` never recovers it (protects wrong-email correction)', () => {
  assert.equal(lc([ev('email.bounced', 1), ev('email.delivered', 9)]), 'bounced');
  assert.equal(lc([ev('email.failed', 1), ev('email.sent', 9), ev('email.delivery_delayed', 10)]), 'failed');
});

test('a strictly-later failure DOES supersede a delivered (honours the newer provider statement)', () => {
  assert.equal(lc([ev('email.delivered', 1), ev('email.bounced', 5)]), 'bounced');
});

test('progress ranking: sent then delivery_delayed advances; a later plain sent does not regress', () => {
  assert.equal(lc([ev('email.sent', 0), ev('email.delivery_delayed', 5)]), 'delivery_delayed');
  assert.equal(lc([ev('email.delivery_delayed', 0), ev('email.sent', 5)]), 'delivery_delayed');
});

test('duplicate events are a no-op for the derived state', () => {
  const one = deriveLifecycleFromEvents([ev('email.delivered', 1)]);
  const dup = deriveLifecycleFromEvents([ev('email.delivered', 1), ev('email.delivered', 1), ev('email.delivered', 1)]);
  assert.deepEqual(one, dup);
});

test('unknown / unmappable events in history are skipped, not fatal', () => {
  assert.equal(lc([ev('email.opened', 0), ev('email.sent', 1), ev('email.clicked', 2), ev('email.delivered', 3)]), 'delivered');
  assert.equal(deriveLifecycleFromEvents([ev('email.opened', 0)]).lifecycle, null);
});

test('empty history -> null lifecycle (conceptually "accepted only")', () => {
  assert.deepEqual(deriveLifecycleFromEvents([]), { lifecycle: null, lifecycleAt: null });
});

test('isParticipantActionLifecycle: bounce/complaint/suppressed need an operator, delivered/sent do not', () => {
  for (const l of ['bounced', 'complained', 'suppressed'] as const) assert.equal(isParticipantActionLifecycle(l), true);
  for (const l of ['sent', 'delivery_delayed', 'delivered'] as const) assert.equal(isParticipantActionLifecycle(l), false);
});

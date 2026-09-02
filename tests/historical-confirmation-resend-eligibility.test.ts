import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessHistoricalConfirmationResend,
  buildHistoricalConfirmationResendContextKey,
  classifyConfirmationDeliveryProvenance,
  isPlausibleRecipientEmail,
  type HistoricalConfirmationResendSnapshot,
  type HistoricalResendDeliverySnapshot,
} from '../server/historical-confirmation-resend.js';
import { buildEmailDeliveryIdempotencyKey, hashEmailRecipient } from '../server/email-delivery-history.js';

// PARTICIPANT-OPS-001 CASE B / Stage B2 — pure eligibility decision tests.
// No live PostgreSQL: real DB semantics (row locks, single-send, provider-event
// folding) are proven separately in the homolog .mts proof. Fixtures are
// derived deterministically from synthetic addresses — no participant data.

const REG = '11111111-2222-3333-4444-555555555555';
const CANON = 'participant@synthetic.example';           // canonical, UNCHANGED
const OTHER = 'someone-else@synthetic.example';
const CANON_HASH = hashEmailRecipient(CANON);
const OTHER_HASH = hashEmailRecipient(OTHER);
const NOW = Date.parse('2026-09-02T12:00:00.000Z');

const resendContextKey = buildHistoricalConfirmationResendContextKey(REG, CANON_HASH);
const resendIdemKey = buildEmailDeliveryIdempotencyKey({ registrationId: REG, kind: 'confirmation', recipientEmail: CANON, contextKey: resendContextKey });

// a RELEASE-05-style backfill row to the canonical recipient
function backfill(overrides: Partial<HistoricalResendDeliverySnapshot> = {}): HistoricalResendDeliverySnapshot {
  return {
    deliveryId: `historical:${resendIdemKey.slice(0, 20)}`,
    recipientHash: CANON_HASH,
    status: 'sent',
    idempotencyKey: buildEmailDeliveryIdempotencyKey({ registrationId: REG, kind: 'confirmation', recipientEmail: CANON }),
    contextKey: 'legacy:reconstructed-message-id',
    attemptedAt: '2026-08-09T07:17:15.174Z',
    provenance: 'HISTORICAL_APP_ASSERTED',
    providerLifecycle: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<HistoricalConfirmationResendSnapshot> = {}): HistoricalConfirmationResendSnapshot {
  return {
    registrationId: REG,
    registration: { status: 'paid', canonicalEmail: CANON, legacyConfirmationSentAt: '2026-08-09T07:17:15.748Z' },
    confirmationDeliveries: [backfill()],
    outboxObligationStatus: null,
    ...overrides,
  };
}

// ---- A — the eligible Case B shape ------------------------------------------
test('A: paid + backfill-only delivery to the (unchanged) canonical recipient + zero provider lifecycle => ELIGIBLE', () => {
  const r = assessHistoricalConfirmationResend(snapshot(), NOW);
  assert.equal(r.verdict, 'ELIGIBLE');
  assert.equal(r.outcome, null);
  assert.equal(r.reason, 'eligible');
  assert.equal(r.canonicalRecipientHash, CANON_HASH);
  assert.equal(r.resendContextKey, resendContextKey);
  assert.equal(r.resendIdempotencyKey, resendIdemKey);
});

// ---- B — historical recipient differs => NOT_ELIGIBLE (Case A owns this) ---
test('B: the backfill delivery went to a DIFFERENT recipient => NOT_ELIGIBLE / historical_recipient_differs', () => {
  const r = assessHistoricalConfirmationResend(snapshot({
    confirmationDeliveries: [backfill({ recipientHash: OTHER_HASH })],
  }), NOW);
  assert.equal(r.verdict, 'NOT_ELIGIBLE');
  assert.equal(r.reason, 'historical_recipient_differs');
});

// ---- C — zero delivery rows => NOT_ELIGIBLE (narrow: not zero-delivery) ----
test('C: no confirmation delivery rows at all => NOT_ELIGIBLE / no_historical_delivery', () => {
  const r = assessHistoricalConfirmationResend(snapshot({ confirmationDeliveries: [] }), NOW);
  assert.equal(r.verdict, 'NOT_ELIGIBLE');
  assert.equal(r.reason, 'no_historical_delivery');
});

test('C2: only a LIVE (non-backfill) delivery, no backfill row => NOT_ELIGIBLE', () => {
  const r = assessHistoricalConfirmationResend(snapshot({
    confirmationDeliveries: [backfill({ provenance: 'LIVE_PROVIDER_CORRELATED', recipientHash: OTHER_HASH, contextKey: `participant:${OTHER_HASH}`, deliveryId: 'live-1' })],
  }), NOW);
  assert.equal(r.verdict, 'NOT_ELIGIBLE');
  assert.equal(r.reason, 'no_historical_delivery');
});

// ---- D — a real/live delivery to the canonical recipient => already served -
test('D: a LIVE sent confirmation delivery to the canonical recipient => NOT_ELIGIBLE / live_delivery_already_exists', () => {
  const r = assessHistoricalConfirmationResend(snapshot({
    confirmationDeliveries: [
      backfill(),
      backfill({ deliveryId: 'live-1', provenance: 'LIVE_PROVIDER_CORRELATED', contextKey: `participant:${CANON_HASH}`, idempotencyKey: 'live-idem' }),
    ],
  }), NOW);
  assert.equal(r.verdict, 'NOT_ELIGIBLE');
  assert.equal(r.reason, 'live_delivery_already_exists');
  assert.equal(r.httpStatus, 200);
});

// ---- E — provider DELIVERED => BLOCK -------------------------------------
test('E: a correlated email.delivered on any canonical-recipient delivery => NOT_ELIGIBLE / provider_delivered (BLOCK)', () => {
  const r = assessHistoricalConfirmationResend(snapshot({
    confirmationDeliveries: [backfill({ providerLifecycle: 'delivered' })],
  }), NOW);
  assert.equal(r.verdict, 'NOT_ELIGIBLE');
  assert.equal(r.reason, 'provider_delivered');
  assert.equal(r.httpStatus, 200);
});

// ---- F/G/H/I — terminal-negative provider lifecycle => REVIEW_REQUIRED ---
for (const lifecycle of ['bounced', 'complained', 'suppressed', 'failed'] as const) {
  test(`${lifecycle.toUpperCase()}: correlated provider ${lifecycle} => REVIEW_REQUIRED / provider_terminal_negative`, () => {
    const r = assessHistoricalConfirmationResend(snapshot({
      confirmationDeliveries: [backfill({ providerLifecycle: lifecycle })],
    }), NOW);
    assert.equal(r.verdict, 'REVIEW_REQUIRED');
    assert.equal(r.outcome, 'REVIEW_REQUIRED');
    assert.equal(r.reason, 'provider_terminal_negative');
    assert.equal(r.httpStatus, 409);
  });
}

test('sent-only / delivery_delayed correlated lifecycle => REVIEW_REQUIRED / ambiguous_provider_state (fail-closed)', () => {
  for (const lifecycle of ['sent', 'delivery_delayed'] as const) {
    const r = assessHistoricalConfirmationResend(snapshot({
      confirmationDeliveries: [backfill({ providerLifecycle: lifecycle })],
    }), NOW);
    assert.equal(r.verdict, 'REVIEW_REQUIRED', lifecycle);
    assert.equal(r.reason, 'ambiguous_provider_state', lifecycle);
  }
});

// ---- J — repeat: the resend row is already sent => ALREADY_RESENT -------
test('J: the resend idempotency row is already sent => ALREADY_RESENT (200)', () => {
  const r = assessHistoricalConfirmationResend(snapshot({
    confirmationDeliveries: [
      backfill(),
      backfill({ deliveryId: 'resend-1', idempotencyKey: resendIdemKey, contextKey: resendContextKey, status: 'sent' }),
    ],
  }), NOW);
  assert.equal(r.verdict, 'ALREADY_RESENT');
  assert.equal(r.outcome, 'ALREADY_RESENT');
  assert.equal(r.httpStatus, 200);
});

// ---- K — a resend attempt is in flight => RESEND_IN_PROGRESS -----------
test('K: the resend idempotency row is attempting within the cooldown => RESEND_IN_PROGRESS (409)', () => {
  const r = assessHistoricalConfirmationResend(snapshot({
    confirmationDeliveries: [
      backfill(),
      backfill({ deliveryId: 'resend-1', idempotencyKey: resendIdemKey, contextKey: resendContextKey, status: 'attempting', attemptedAt: new Date(NOW - 30_000).toISOString() }),
    ],
  }), NOW);
  assert.equal(r.verdict, 'RESEND_IN_PROGRESS');
  assert.equal(r.reason, 'resend_attempt_in_flight');
});

test('K2: a stale attempting resend row (older than the cooldown) does NOT block', () => {
  const r = assessHistoricalConfirmationResend(snapshot({
    confirmationDeliveries: [
      backfill(),
      backfill({ deliveryId: 'resend-1', idempotencyKey: resendIdemKey, contextKey: resendContextKey, status: 'attempting', attemptedAt: new Date(NOW - 20 * 60_000).toISOString() }),
    ],
  }), NOW);
  assert.equal(r.verdict, 'ELIGIBLE');
});

test('a pending durable outbox obligation => RESEND_IN_PROGRESS / outbox_obligation_active', () => {
  const r = assessHistoricalConfirmationResend(snapshot({ outboxObligationStatus: 'processing' }), NOW);
  assert.equal(r.verdict, 'RESEND_IN_PROGRESS');
  assert.equal(r.reason, 'outbox_obligation_active');
});

// ---- P — unpaid => NOT_ELIGIBLE --------------------------------------
test('P: registration not paid => NOT_ELIGIBLE / registration_not_paid', () => {
  for (const status of ['pending', 'expired', 'cancelled', 'refunded']) {
    const r = assessHistoricalConfirmationResend(snapshot({
      registration: { status, canonicalEmail: CANON, legacyConfirmationSentAt: '2026-08-09T07:17:15.748Z' },
    }), NOW);
    assert.equal(r.verdict, 'NOT_ELIGIBLE', status);
    assert.equal(r.reason, 'registration_not_paid', status);
  }
});

test('no registration row => NOT_ELIGIBLE (404)', () => {
  const r = assessHistoricalConfirmationResend(snapshot({ registration: null, confirmationDeliveries: [] }), NOW);
  assert.equal(r.verdict, 'NOT_ELIGIBLE');
  assert.equal(r.httpStatus, 404);
  assert.equal(r.reason, 'no_registration');
});

// ---- Q — missing / invalid canonical email => NOT_ELIGIBLE ----------
test('Q: canonical email missing or malformed => NOT_ELIGIBLE / canonical_email_missing (422)', () => {
  for (const canonicalEmail of [null, '', '   ', 'not-an-email', 'a@@b.example', 'x@localhost']) {
    const r = assessHistoricalConfirmationResend(snapshot({
      registration: { status: 'paid', canonicalEmail, legacyConfirmationSentAt: '2026-08-09T07:17:15.748Z' },
    }), NOW);
    assert.equal(r.verdict, 'NOT_ELIGIBLE', JSON.stringify(canonicalEmail));
    assert.equal(r.reason, 'canonical_email_missing', JSON.stringify(canonicalEmail));
  }
});

test('isPlausibleRecipientEmail accepts ordinary and rejects broken', () => {
  assert.equal(isPlausibleRecipientEmail('a.b+tag@gmail.com'), true);
  assert.equal(isPlausibleRecipientEmail('  Mixed.Case@Example.COM '), true);
  assert.equal(isPlausibleRecipientEmail('x@y'), false);
  assert.equal(isPlausibleRecipientEmail(undefined), false);
});

// ---- O — shared-email isolation by registration + context ----------
test('O: two registrations sharing the canonical email get distinct resend identity', () => {
  const other = '99999999-8888-7777-6666-555555555555';
  const keyA = buildHistoricalConfirmationResendContextKey(REG, CANON_HASH);
  const keyB = buildHistoricalConfirmationResendContextKey(other, CANON_HASH);
  assert.notEqual(keyA, keyB);
  assert.notEqual(
    buildEmailDeliveryIdempotencyKey({ registrationId: REG, kind: 'confirmation', recipientEmail: CANON, contextKey: keyA }),
    buildEmailDeliveryIdempotencyKey({ registrationId: other, kind: 'confirmation', recipientEmail: CANON, contextKey: keyB }),
  );
});

// ---- M — the resend key never collides with the historical / recovery key -
test('M: the resend idempotency + context keys never collide with the backfill row or the confirmation-recovery namespace', () => {
  const historicalKey = buildEmailDeliveryIdempotencyKey({ registrationId: REG, kind: 'confirmation', recipientEmail: CANON });
  assert.notEqual(resendIdemKey, historicalKey);
  assert.match(resendContextKey, /^historical-confirmation-resend:/);
  assert.doesNotMatch(resendContextKey, /^confirmation-recovery:/);
  assert.ok(resendContextKey.length <= 160);
});

// ---- Y — Case A confirmation-recovery logic is not imported/called --------
test('Y: the module never imports from or calls confirmation-recovery', async () => {
  const src = (await import('node:fs')).readFileSync('server/historical-confirmation-resend.ts', 'utf8');
  assert.doesNotMatch(src, /from '\.\/confirmation-recovery/);
  assert.doesNotMatch(src, /\bassessConfirmationRecovery\b/);
  assert.doesNotMatch(src, /\bbuildConfirmationRecoveryContextKey\b/);
});

// ---- provenance classifier --------------------------------------------
test('classifyConfirmationDeliveryProvenance detects RELEASE-05 backfill markers', () => {
  assert.equal(classifyConfirmationDeliveryProvenance({ id: 'historical:abc', contextKey: null, metadata: {} }), 'HISTORICAL_APP_ASSERTED');
  assert.equal(classifyConfirmationDeliveryProvenance({ id: 'uuid', contextKey: 'legacy:x', metadata: {} }), 'HISTORICAL_APP_ASSERTED');
  assert.equal(classifyConfirmationDeliveryProvenance({ id: 'uuid', contextKey: null, metadata: { backfill: true } }), 'HISTORICAL_APP_ASSERTED');
  assert.equal(classifyConfirmationDeliveryProvenance({ id: 'uuid', contextKey: null, metadata: { historical: true } }), 'HISTORICAL_APP_ASSERTED');
  assert.equal(classifyConfirmationDeliveryProvenance({ id: 'uuid', contextKey: `participant:${CANON_HASH}`, metadata: { source: 'registration_confirmation' } }), 'LIVE_PROVIDER_CORRELATED');
});

// ---- §16 — Case B synthetic regression fixture ----------------------
test('16: a fixture semantically equivalent to Case B is ELIGIBLE', () => {
  // derive the historical idempotency key the way RELEASE-05 would have
  const historicalIdem = buildEmailDeliveryIdempotencyKey({ registrationId: REG, kind: 'confirmation', recipientEmail: CANON });
  const caseBLike = snapshot({
    registration: { status: 'paid', canonicalEmail: CANON, legacyConfirmationSentAt: '2026-08-09T07:17:15.748Z' },
    confirmationDeliveries: [{
      deliveryId: `historical:${historicalIdem}`,
      recipientHash: CANON_HASH,
      status: 'sent',
      idempotencyKey: historicalIdem,
      contextKey: 'legacy:reconstructed-app-asserted-id',
      attemptedAt: '2026-08-09T07:17:15.174Z',
      provenance: 'HISTORICAL_APP_ASSERTED',
      providerLifecycle: null,
    }],
    outboxObligationStatus: null,
  });
  const r = assessHistoricalConfirmationResend(caseBLike, NOW);
  assert.equal(r.verdict, 'ELIGIBLE');
});

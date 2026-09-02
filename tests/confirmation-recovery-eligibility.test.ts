import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessConfirmationRecovery,
  buildConfirmationRecoveryContextKey,
  isPlausibleRecipientEmail,
  type ConfirmationRecoverySnapshot,
  type ConfirmationRecoveryDeliverySnapshot,
} from '../server/confirmation-recovery.js';
import {
  buildEmailDeliveryIdempotencyKey,
  hashEmailRecipient,
} from '../server/email-delivery-history.js';

// PARTICIPANT-OPS-001 CASE A / Stage A2 — pure eligibility decision tests.
// No live PostgreSQL: real DB semantics (row locks, single-send under
// concurrency) are proven separately in the homolog .mts proof. Fixtures are
// derived deterministically from synthetic addresses — no participant data.

const REGISTRATION_ID = '11111111-2222-3333-4444-555555555555';
const OLD_EMAIL = 'old-typo@synthetic.example';      // where the first confirmation went
const NEW_EMAIL = 'corrected@synthetic.example';     // current canonical address
const OLD_HASH = hashEmailRecipient(OLD_EMAIL);
const NEW_HASH = hashEmailRecipient(NEW_EMAIL);
const NOW = Date.parse('2026-09-02T12:00:00.000Z');

const recoveryContextKey = buildConfirmationRecoveryContextKey(REGISTRATION_ID, NEW_HASH);
const recoveryIdempotencyKey = buildEmailDeliveryIdempotencyKey({
  registrationId: REGISTRATION_ID,
  kind: 'confirmation',
  recipientEmail: NEW_EMAIL,
  contextKey: recoveryContextKey,
});

function delivery(overrides: Partial<ConfirmationRecoveryDeliverySnapshot>): ConfirmationRecoveryDeliverySnapshot {
  return {
    recipientHash: OLD_HASH,
    status: 'sent',
    idempotencyKey: buildEmailDeliveryIdempotencyKey({
      registrationId: REGISTRATION_ID,
      kind: 'confirmation',
      recipientEmail: OLD_EMAIL,
    }),
    contextKey: `participant:${OLD_HASH}`,
    attemptedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function snapshot(overrides: Partial<ConfirmationRecoverySnapshot> = {}): ConfirmationRecoverySnapshot {
  return {
    registrationId: REGISTRATION_ID,
    registration: {
      status: 'paid',
      canonicalEmail: NEW_EMAIL,
      legacyConfirmationSentAt: '2026-08-01T00:00:05.000Z',
    },
    confirmationDeliveries: [delivery({})],
    outboxObligationStatus: null,
    ...overrides,
  };
}

// --- Test A — the eligible Case A shape -----------------------------------------
test('A: paid + historical delivery to a different recipient + canonical unserved => ELIGIBLE', () => {
  const result = assessConfirmationRecovery(snapshot(), NOW);
  assert.equal(result.verdict, 'ELIGIBLE');
  assert.equal(result.outcome, null);
  assert.equal(result.reason, 'eligible');
  assert.equal(result.canonicalRecipientHash, NEW_HASH);
  assert.equal(result.recoveryContextKey, recoveryContextKey);
  assert.equal(result.recoveryIdempotencyKey, recoveryIdempotencyKey);
});

// --- Test D — a delivery already exists for the recovery => ALREADY_RECOVERED ---
test('D: the recovery idempotency row is already sent => ALREADY_RECOVERED (200)', () => {
  const result = assessConfirmationRecovery(snapshot({
    confirmationDeliveries: [
      delivery({}),
      delivery({ recipientHash: NEW_HASH, idempotencyKey: recoveryIdempotencyKey, contextKey: recoveryContextKey, status: 'sent' }),
    ],
  }), NOW);
  assert.equal(result.verdict, 'ALREADY_RECOVERED');
  assert.equal(result.outcome, 'ALREADY_RECOVERED');
  assert.equal(result.httpStatus, 200);
});

test('D2: canonical recipient already has ANY sent confirmation (different context) => ALREADY_RECOVERED', () => {
  const result = assessConfirmationRecovery(snapshot({
    confirmationDeliveries: [
      delivery({}),
      delivery({ recipientHash: NEW_HASH, idempotencyKey: 'some-other-key', contextKey: `participant:${NEW_HASH}`, status: 'sent' }),
    ],
  }), NOW);
  assert.equal(result.verdict, 'ALREADY_RECOVERED');
  assert.equal(result.reason, 'canonical_recipient_already_delivered');
});

// --- Test E — a recovery attempt is in flight => RECOVERY_IN_PROGRESS ----------
test('E: recovery idempotency row is attempting within the cooldown => RECOVERY_IN_PROGRESS (409)', () => {
  const result = assessConfirmationRecovery(snapshot({
    confirmationDeliveries: [
      delivery({}),
      delivery({
        recipientHash: NEW_HASH,
        idempotencyKey: recoveryIdempotencyKey,
        contextKey: recoveryContextKey,
        status: 'attempting',
        attemptedAt: new Date(NOW - 30_000).toISOString(),
      }),
    ],
  }), NOW);
  assert.equal(result.verdict, 'RECOVERY_IN_PROGRESS');
  assert.equal(result.httpStatus, 409);
  assert.equal(result.reason, 'recovery_attempt_in_flight');
});

test('E2: a stale attempting row (older than the cooldown) does NOT block recovery', () => {
  const result = assessConfirmationRecovery(snapshot({
    confirmationDeliveries: [
      delivery({}),
      delivery({
        recipientHash: NEW_HASH,
        idempotencyKey: recoveryIdempotencyKey,
        contextKey: recoveryContextKey,
        status: 'attempting',
        attemptedAt: new Date(NOW - 20 * 60_000).toISOString(),
      }),
    ],
  }), NOW);
  assert.equal(result.verdict, 'ELIGIBLE');
});

test('E3: a pending durable outbox obligation => RECOVERY_IN_PROGRESS', () => {
  const result = assessConfirmationRecovery(snapshot({ outboxObligationStatus: 'pending' }), NOW);
  assert.equal(result.verdict, 'RECOVERY_IN_PROGRESS');
  assert.equal(result.reason, 'outbox_obligation_active');
});

// --- Test F — unpaid registration => NOT_ELIGIBLE -----------------------------
test('F: registration is not paid => NOT_ELIGIBLE (409)', () => {
  for (const status of ['pending', 'awaiting_payment', 'cancelled', 'refunded']) {
    const result = assessConfirmationRecovery(snapshot({
      registration: { status, canonicalEmail: NEW_EMAIL, legacyConfirmationSentAt: '2026-08-01T00:00:05.000Z' },
    }), NOW);
    assert.equal(result.verdict, 'NOT_ELIGIBLE', status);
    assert.equal(result.httpStatus, 409);
    assert.equal(result.reason, 'not_paid');
  }
});

test('F2: no registration row => NOT_ELIGIBLE (404)', () => {
  const result = assessConfirmationRecovery(snapshot({ registration: null, confirmationDeliveries: [] }), NOW);
  assert.equal(result.verdict, 'NOT_ELIGIBLE');
  assert.equal(result.httpStatus, 404);
  assert.equal(result.reason, 'no_registration');
});

// --- Test G — missing / invalid canonical email => NOT_ELIGIBLE ---------------
test('G: canonical email missing or malformed => NOT_ELIGIBLE (422)', () => {
  for (const canonicalEmail of [null, '', '   ', 'not-an-email', 'two@@at.example', 'spaces in@it.example', 'no-domain@localhost']) {
    const result = assessConfirmationRecovery(snapshot({
      registration: { status: 'paid', canonicalEmail, legacyConfirmationSentAt: '2026-08-01T00:00:05.000Z' },
    }), NOW);
    assert.equal(result.verdict, 'NOT_ELIGIBLE', JSON.stringify(canonicalEmail));
    assert.equal(result.reason, 'missing_canonical_email', JSON.stringify(canonicalEmail));
  }
});

test('isPlausibleRecipientEmail accepts ordinary addresses and rejects broken ones', () => {
  assert.equal(isPlausibleRecipientEmail('a.b+tag@gmail.com'), true);
  assert.equal(isPlausibleRecipientEmail('  Mixed.Case@Example.COM '), true);
  assert.equal(isPlausibleRecipientEmail('x@y'), false);
  assert.equal(isPlausibleRecipientEmail('@example.com'), false);
  assert.equal(isPlausibleRecipientEmail(undefined), false);
});

// --- No historical confirmation => this is a first send, not a recovery -------
test('no legacy summary and no sent delivery => NOT_ELIGIBLE (no_historical_confirmation)', () => {
  const result = assessConfirmationRecovery(snapshot({
    registration: { status: 'paid', canonicalEmail: NEW_EMAIL, legacyConfirmationSentAt: null },
    confirmationDeliveries: [],
  }), NOW);
  assert.equal(result.verdict, 'NOT_ELIGIBLE');
  assert.equal(result.reason, 'no_historical_confirmation');
});

// --- Historical recipient not verifiable (legacy summary only, no row) -------
test('legacy summary present but no delivery row => NOT_ELIGIBLE (historical_recipient_unverifiable)', () => {
  const result = assessConfirmationRecovery(snapshot({
    confirmationDeliveries: [],
  }), NOW);
  assert.equal(result.verdict, 'NOT_ELIGIBLE');
  assert.equal(result.reason, 'historical_recipient_unverifiable');
});

// --- Shared-email isolation: identity is (registration_id + context), not email
test('M: two registrations sharing the OLD email get distinct recovery identity', () => {
  const otherRegistrationId = '99999999-8888-7777-6666-555555555555';
  const keyA = buildConfirmationRecoveryContextKey(REGISTRATION_ID, NEW_HASH);
  const keyB = buildConfirmationRecoveryContextKey(otherRegistrationId, NEW_HASH);
  assert.notEqual(keyA, keyB, 'context key is namespaced by registration_id');

  // Even with an identical historical delivery to the shared OLD address, the
  // recovery idempotency key differs because registration_id participates.
  const idemA = buildEmailDeliveryIdempotencyKey({ registrationId: REGISTRATION_ID, kind: 'confirmation', recipientEmail: NEW_EMAIL, contextKey: keyA });
  const idemB = buildEmailDeliveryIdempotencyKey({ registrationId: otherRegistrationId, kind: 'confirmation', recipientEmail: NEW_EMAIL, contextKey: keyB });
  assert.notEqual(idemA, idemB);
});

// --- Historical delivery preservation: the recovery never reuses the old key --
test('H: the recovery idempotency key never collides with the historical delivery key', () => {
  const historicalKey = buildEmailDeliveryIdempotencyKey({
    registrationId: REGISTRATION_ID,
    kind: 'confirmation',
    recipientEmail: OLD_EMAIL,
  });
  assert.notEqual(recoveryIdempotencyKey, historicalKey);
  // and it is stable across repeated derivation (idempotent request => same row)
  assert.equal(
    recoveryIdempotencyKey,
    buildEmailDeliveryIdempotencyKey({ registrationId: REGISTRATION_ID, kind: 'confirmation', recipientEmail: NEW_EMAIL, contextKey: recoveryContextKey }),
  );
});

test('recovery context key stays within the 160-char delivery context cap', () => {
  assert.ok(recoveryContextKey.length <= 160, `${recoveryContextKey.length} <= 160`);
  assert.match(recoveryContextKey, /^confirmation-recovery:[0-9a-f-]{36}:[0-9a-f]{64}$/);
});

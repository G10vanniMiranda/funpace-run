// PARTICIPANT-OPS-001 CASE A / Stage A2 — production-safe confirmation-email
// recovery. This module is the AUTHORITATIVE, framework-free decision layer for
// whether a single confirmation email may be deliberately re-issued for ONE
// registration whose canonical contact address changed AFTER the original
// confirmation was delivered to a now-incorrect recipient.
//
// Design constraints (from the Stage A2 brief):
//   * The client never decides whether "forcing" is allowed. There is no
//     force=true on the wire. The recovery is expressed as a semantic context
//     key that the server derives from the registration's own canonical data.
//   * Correlation for safety is (registration_id + recovery context + recipient
//     hash), never a bare email string. Two people sharing an email address are
//     isolated by registration_id + context.
//   * The historical delivery row is append-only evidence. Recovery always
//     creates an INDEPENDENT delivery attempt under a distinct idempotency key,
//     so nothing about the old row is rewritten.
//
// The pure assessment here decides eligibility and the machine-readable outcome;
// the final atomic authority is still claimRegistrationEmailInPostgres, whose
// row locks collapse concurrent recoveries to a single provider send.

import {
  EMAIL_DELIVERY_COOLDOWN_MS,
  buildEmailDeliveryIdempotencyKey,
  hashEmailRecipient,
  normalizeRecipientEmail,
} from './email-delivery-history.js';

export const CONFIRMATION_RECOVERY_CONTEXT_PREFIX = 'confirmation-recovery';

// Machine-readable outcomes returned by the recovery endpoint. There is no
// ambiguous generic "success" — every terminal state is one of these.
export type ConfirmationRecoveryOutcome =
  | 'RECOVERY_ACCEPTED'
  | 'ALREADY_RECOVERED'
  | 'RECOVERY_IN_PROGRESS'
  | 'NOT_ELIGIBLE'
  | 'PROVIDER_FAILURE';

// Internal assessment verdict (pre-send). ELIGIBLE is the only state that leads
// to a provider send; the others map straight onto a terminal outcome.
export type ConfirmationRecoveryVerdict =
  | 'ELIGIBLE'
  | 'ALREADY_RECOVERED'
  | 'RECOVERY_IN_PROGRESS'
  | 'NOT_ELIGIBLE';

export type ConfirmationRecoveryDeliverySnapshot = {
  recipientHash: string;
  status: 'attempting' | 'sent' | 'failed';
  idempotencyKey: string;
  contextKey: string | null;
  attemptedAt: string | null;
};

export type ConfirmationRecoverySnapshot = {
  registrationId: string;
  // null => no registration row at all.
  registration: {
    status: string;
    canonicalEmail: string | null;
    legacyConfirmationSentAt: string | null;
  } | null;
  confirmationDeliveries: ConfirmationRecoveryDeliverySnapshot[];
  // status of the durable confirmation-email obligation, if any occupies the
  // (registration_id, 'confirmation') slot in run-email-outbox.
  outboxObligationStatus: string | null;
};

export type ConfirmationRecoveryAssessment = {
  verdict: ConfirmationRecoveryVerdict;
  // machine outcome to report when verdict !== 'ELIGIBLE'
  outcome: ConfirmationRecoveryOutcome | null;
  httpStatus: number;
  reason: string;
  // present once the registration + canonical email are known
  canonicalRecipientHash: string | null;
  recoveryContextKey: string | null;
  recoveryIdempotencyKey: string | null;
};

// A conservative RFC-5321-ish check: exactly one @, non-empty local part, a dot
// in the domain, no whitespace. Enough to reject the empty / obviously-broken
// canonical address without pretending to be a full validator.
export function isPlausibleRecipientEmail(value: string | null | undefined): boolean {
  const normalized = normalizeRecipientEmail(String(value || ''));
  if (!normalized || /\s/.test(normalized)) return false;
  const at = normalized.indexOf('@');
  if (at <= 0 || at !== normalized.lastIndexOf('@')) return false;
  const domain = normalized.slice(at + 1);
  return domain.length >= 3 && domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.');
}

// The semantic recovery context. Deterministic in (registrationId, canonical
// recipient hash) so a repeat request resolves to the same idempotency row and
// cannot trigger a second send. Bounded well under the 160-char context cap
// (prefix 21 + ':' + uuid 36 + ':' + sha256 64 = 123).
export function buildConfirmationRecoveryContextKey(registrationId: string, canonicalRecipientHash: string): string {
  return `${CONFIRMATION_RECOVERY_CONTEXT_PREFIX}:${registrationId}:${canonicalRecipientHash}`;
}

export function isConfirmationRecoveryContextKey(contextKey: string | null | undefined): boolean {
  return typeof contextKey === 'string' && contextKey.startsWith(`${CONFIRMATION_RECOVERY_CONTEXT_PREFIX}:`);
}

function recentAttempt(attemptedAt: string | null, now: number): boolean {
  if (!attemptedAt) return false;
  const started = new Date(attemptedAt).getTime();
  return Number.isFinite(started) && now - started < EMAIL_DELIVERY_COOLDOWN_MS;
}

// Pure eligibility decision. No I/O. `now` is injectable for deterministic tests.
export function assessConfirmationRecovery(
  snapshot: ConfirmationRecoverySnapshot,
  now: number = Date.now(),
): ConfirmationRecoveryAssessment {
  const base = {
    canonicalRecipientHash: null as string | null,
    recoveryContextKey: null as string | null,
    recoveryIdempotencyKey: null as string | null,
  };

  const registration = snapshot.registration;
  if (!registration) {
    return { verdict: 'NOT_ELIGIBLE', outcome: 'NOT_ELIGIBLE', httpStatus: 404, reason: 'no_registration', ...base };
  }
  if (registration.status !== 'paid') {
    return { verdict: 'NOT_ELIGIBLE', outcome: 'NOT_ELIGIBLE', httpStatus: 409, reason: 'not_paid', ...base };
  }
  if (!isPlausibleRecipientEmail(registration.canonicalEmail)) {
    return { verdict: 'NOT_ELIGIBLE', outcome: 'NOT_ELIGIBLE', httpStatus: 422, reason: 'missing_canonical_email', ...base };
  }

  const canonicalEmail = normalizeRecipientEmail(String(registration.canonicalEmail));
  const canonicalRecipientHash = hashEmailRecipient(canonicalEmail);
  const recoveryContextKey = buildConfirmationRecoveryContextKey(snapshot.registrationId, canonicalRecipientHash);
  const recoveryIdempotencyKey = buildEmailDeliveryIdempotencyKey({
    registrationId: snapshot.registrationId,
    kind: 'confirmation',
    recipientEmail: canonicalEmail,
    contextKey: recoveryContextKey,
  });
  const ctx = { canonicalRecipientHash, recoveryContextKey, recoveryIdempotencyKey };

  const sentDeliveries = snapshot.confirmationDeliveries.filter((d) => d.status === 'sent');
  const hasHistoricalConfirmation = Boolean(registration.legacyConfirmationSentAt) || sentDeliveries.length > 0;
  if (!hasHistoricalConfirmation) {
    // Nothing was ever confirmed — this is a first send, not a recovery. The
    // operator should use the ordinary "Enviar email" action.
    return { verdict: 'NOT_ELIGIBLE', outcome: 'NOT_ELIGIBLE', httpStatus: 409, reason: 'no_historical_confirmation', ...ctx };
  }

  // The recovery's own idempotency row.
  const recoveryDelivery = snapshot.confirmationDeliveries.find((d) => d.idempotencyKey === recoveryIdempotencyKey);
  if (recoveryDelivery?.status === 'sent') {
    return { verdict: 'ALREADY_RECOVERED', outcome: 'ALREADY_RECOVERED', httpStatus: 200, reason: 'recovery_already_sent', ...ctx };
  }
  if (recoveryDelivery?.status === 'attempting' && recentAttempt(recoveryDelivery.attemptedAt, now)) {
    return { verdict: 'RECOVERY_IN_PROGRESS', outcome: 'RECOVERY_IN_PROGRESS', httpStatus: 409, reason: 'recovery_attempt_in_flight', ...ctx };
  }

  // The canonical recipient must not have been served (or be mid-attempt) by ANY
  // confirmation delivery — not just this recovery context.
  const canonicalDeliveries = snapshot.confirmationDeliveries.filter((d) => d.recipientHash === canonicalRecipientHash);
  if (canonicalDeliveries.some((d) => d.status === 'sent')) {
    return { verdict: 'ALREADY_RECOVERED', outcome: 'ALREADY_RECOVERED', httpStatus: 200, reason: 'canonical_recipient_already_delivered', ...ctx };
  }
  if (canonicalDeliveries.some((d) => d.status === 'attempting' && recentAttempt(d.attemptedAt, now))) {
    return { verdict: 'RECOVERY_IN_PROGRESS', outcome: 'RECOVERY_IN_PROGRESS', httpStatus: 409, reason: 'canonical_recipient_attempt_in_flight', ...ctx };
  }

  // A durable obligation already in flight would race a manual recovery.
  if (snapshot.outboxObligationStatus === 'pending' || snapshot.outboxObligationStatus === 'processing') {
    return { verdict: 'RECOVERY_IN_PROGRESS', outcome: 'RECOVERY_IN_PROGRESS', httpStatus: 409, reason: 'outbox_obligation_active', ...ctx };
  }

  // The historical confirmation must be provably addressed to a DIFFERENT
  // recipient than the current canonical one — otherwise there is nothing to
  // recover from. A legacy-only summary with no delivery row cannot prove the
  // historical recipient, so it is not eligible for this controlled path.
  const historicalToOther = sentDeliveries.some((d) => d.recipientHash !== canonicalRecipientHash);
  if (!historicalToOther) {
    return { verdict: 'NOT_ELIGIBLE', outcome: 'NOT_ELIGIBLE', httpStatus: 409, reason: 'historical_recipient_unverifiable', ...ctx };
  }

  return { verdict: 'ELIGIBLE', outcome: null, httpStatus: 200, reason: 'eligible', ...ctx };
}

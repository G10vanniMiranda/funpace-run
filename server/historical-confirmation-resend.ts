// PARTICIPANT-OPS-001 CASE B / Stage B2 — SAME-RECIPIENT historical-confirmation
// resend. This is a DIFFERENT domain operation from confirmation-recovery.ts:
//
//   confirmation-recovery  — the canonical participant email CHANGED; the
//                            historical confirmation belongs to a DIFFERENT
//                            recipient. (Case A.)
//
//   historical-confirmation-resend (here) — the canonical email is UNCHANGED;
//     the only confirmation-delivery evidence for that canonical recipient is a
//     RELEASE-05 backfill reconstruction (app-asserted "Resend returned an id",
//     never independently correlated to a provider `delivered` event); the
//     participant reports non-receipt. (Case B.)
//
// This module is the AUTHORITATIVE, framework-free decision layer. It is
// deliberately NARROW: it supports ONLY the state proven in Case B and MUST NOT
// weaken any confirmation-recovery invariant.
//
// Fail-closed rules:
//   * eligibility is NOT "status === 'sent'" — a RELEASE-05 reconstructed row is
//     `sent` too. Provenance is classified explicitly.
//   * a reconstructed provider_message_id from an old app audit is NOT
//     independent provider evidence.
//   * any real correlated provider lifecycle blocks or forces review:
//       delivered                         -> BLOCK  (provider_delivered)
//       bounced/complained/suppressed/failed -> REVIEW_REQUIRED (provider_terminal_negative)
//       sent/delivery_delayed only        -> REVIEW_REQUIRED (ambiguous_provider_state)
//   * "no delivery evidence at all" (zero rows) is OUT OF SCOPE for this policy.

import {
  EMAIL_DELIVERY_COOLDOWN_MS,
  buildEmailDeliveryIdempotencyKey,
  hashEmailRecipient,
  normalizeRecipientEmail,
} from './email-delivery-history.js';
import type { ProviderLifecycle } from './email-provider-lifecycle.js';

export const HISTORICAL_CONFIRMATION_RESEND_CONTEXT_PREFIX = 'historical-confirmation-resend';

// Machine-readable outcomes. No ambiguous generic "success".
export type HistoricalConfirmationResendOutcome =
  | 'RESEND_ACCEPTED'
  | 'ALREADY_RESENT'
  | 'RESEND_IN_PROGRESS'
  | 'NOT_ELIGIBLE'
  | 'PROVIDER_FAILURE'
  | 'REVIEW_REQUIRED';

export type HistoricalConfirmationResendVerdict =
  | 'ELIGIBLE'
  | 'ALREADY_RESENT'
  | 'RESEND_IN_PROGRESS'
  | 'NOT_ELIGIBLE'
  | 'REVIEW_REQUIRED';

// How a confirmation-delivery row's existence is evidenced.
export type ConfirmationDeliveryProvenance =
  | 'LIVE_PROVIDER_CORRELATED' // a real claim/complete cycle (EMAIL-OPS-002)
  | 'HISTORICAL_APP_ASSERTED'; // a RELEASE-05 backfill reconstruction

export type HistoricalResendDeliverySnapshot = {
  deliveryId: string;
  recipientHash: string;
  status: 'attempting' | 'sent' | 'failed';
  idempotencyKey: string;
  contextKey: string | null;
  attemptedAt: string | null;
  provenance: ConfirmationDeliveryProvenance;
  // folded from run-email-provider-events for THIS delivery; null = no events.
  providerLifecycle: ProviderLifecycle | null;
};

export type HistoricalConfirmationResendSnapshot = {
  registrationId: string;
  registration: {
    status: string;
    canonicalEmail: string | null;
    legacyConfirmationSentAt: string | null;
  } | null;
  confirmationDeliveries: HistoricalResendDeliverySnapshot[];
  outboxObligationStatus: string | null;
};

export type HistoricalConfirmationResendAssessment = {
  verdict: HistoricalConfirmationResendVerdict;
  outcome: HistoricalConfirmationResendOutcome | null;
  httpStatus: number;
  reason: string;
  canonicalRecipientHash: string | null;
  resendContextKey: string | null;
  resendIdempotencyKey: string | null;
};

// Same conservative check confirmation-recovery uses.
export function isPlausibleRecipientEmail(value: string | null | undefined): boolean {
  const normalized = normalizeRecipientEmail(String(value || ''));
  if (!normalized || /\s/.test(normalized)) return false;
  const at = normalized.indexOf('@');
  if (at <= 0 || at !== normalized.lastIndexOf('@')) return false;
  const domain = normalized.slice(at + 1);
  return domain.length >= 3 && domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.');
}

// A SEPARATE deterministic namespace — never reuse `confirmation-recovery:`.
// prefix 30 + ':' + uuid 36 + ':' + sha256 64 = 132, well under the 160 cap.
export function buildHistoricalConfirmationResendContextKey(registrationId: string, canonicalRecipientHash: string): string {
  return `${HISTORICAL_CONFIRMATION_RESEND_CONTEXT_PREFIX}:${registrationId}:${canonicalRecipientHash}`;
}

export function isHistoricalConfirmationResendContextKey(contextKey: string | null | undefined): boolean {
  return typeof contextKey === 'string' && contextKey.startsWith(`${HISTORICAL_CONFIRMATION_RESEND_CONTEXT_PREFIX}:`);
}

// Classify a raw run-email-deliveries row by canonical fields/metadata. A row is
// HISTORICAL_APP_ASSERTED iff any RELEASE-05 backfill marker is present:
//   * id convention `historical:<idempotencyKey>`
//   * metadata.backfill === true  OR  metadata.historical === true
//   * context_key `legacy:<...>`  (buildLegacyEmailDeliveryCandidate)
export function classifyConfirmationDeliveryProvenance(row: {
  id: string;
  contextKey: string | null;
  metadata: unknown;
}): ConfirmationDeliveryProvenance {
  const meta = (row.metadata && typeof row.metadata === 'object') ? row.metadata as Record<string, unknown> : {};
  const idIsHistorical = typeof row.id === 'string' && row.id.startsWith('historical:');
  const ctxIsLegacy = typeof row.contextKey === 'string' && row.contextKey.startsWith('legacy:');
  const metaBackfill = meta.backfill === true || meta.historical === true;
  return (idIsHistorical || ctxIsLegacy || metaBackfill) ? 'HISTORICAL_APP_ASSERTED' : 'LIVE_PROVIDER_CORRELATED';
}

function recentAttempt(attemptedAt: string | null, now: number): boolean {
  if (!attemptedAt) return false;
  const started = new Date(attemptedAt).getTime();
  return Number.isFinite(started) && now - started < EMAIL_DELIVERY_COOLDOWN_MS;
}

// Pure eligibility decision. No I/O. `now` injectable for deterministic tests.
export function assessHistoricalConfirmationResend(
  snapshot: HistoricalConfirmationResendSnapshot,
  now: number = Date.now(),
): HistoricalConfirmationResendAssessment {
  const base = { canonicalRecipientHash: null as string | null, resendContextKey: null as string | null, resendIdempotencyKey: null as string | null };

  const registration = snapshot.registration;
  if (!registration) {
    return { verdict: 'NOT_ELIGIBLE', outcome: 'NOT_ELIGIBLE', httpStatus: 404, reason: 'no_registration', ...base };
  }
  if (registration.status !== 'paid') {
    return { verdict: 'NOT_ELIGIBLE', outcome: 'NOT_ELIGIBLE', httpStatus: 409, reason: 'registration_not_paid', ...base };
  }
  if (!isPlausibleRecipientEmail(registration.canonicalEmail)) {
    return { verdict: 'NOT_ELIGIBLE', outcome: 'NOT_ELIGIBLE', httpStatus: 422, reason: 'canonical_email_missing', ...base };
  }

  const canonicalEmail = normalizeRecipientEmail(String(registration.canonicalEmail));
  const canonicalRecipientHash = hashEmailRecipient(canonicalEmail);
  const resendContextKey = buildHistoricalConfirmationResendContextKey(snapshot.registrationId, canonicalRecipientHash);
  const resendIdempotencyKey = buildEmailDeliveryIdempotencyKey({
    registrationId: snapshot.registrationId,
    kind: 'confirmation',
    recipientEmail: canonicalEmail,
    contextKey: resendContextKey,
  });
  const ctx = { canonicalRecipientHash, resendContextKey, resendIdempotencyKey };

  const deliveries = snapshot.confirmationDeliveries;

  // §2 — this version is NARROW: "no delivery evidence at all" is out of scope.
  if (deliveries.length === 0) {
    return { verdict: 'NOT_ELIGIBLE', outcome: 'NOT_ELIGIBLE', httpStatus: 409, reason: 'no_historical_delivery', ...ctx };
  }

  // The resend's own idempotency row.
  const resendRow = deliveries.find((d) => d.idempotencyKey === resendIdempotencyKey);
  if (resendRow?.status === 'sent') {
    return { verdict: 'ALREADY_RESENT', outcome: 'ALREADY_RESENT', httpStatus: 200, reason: 'resend_already_sent', ...ctx };
  }
  if (resendRow?.status === 'attempting' && recentAttempt(resendRow.attemptedAt, now)) {
    return { verdict: 'RESEND_IN_PROGRESS', outcome: 'RESEND_IN_PROGRESS', httpStatus: 409, reason: 'resend_attempt_in_flight', ...ctx };
  }

  const canonicalDeliveries = deliveries.filter((d) => d.recipientHash === canonicalRecipientHash);
  const canonicalLifecycles = canonicalDeliveries
    .map((d) => d.providerLifecycle)
    .filter((l): l is ProviderLifecycle => Boolean(l));

  // §4 — a real correlated `delivered` proves the participant was served. BLOCK.
  if (canonicalLifecycles.includes('delivered')) {
    return { verdict: 'NOT_ELIGIBLE', outcome: 'NOT_ELIGIBLE', httpStatus: 200, reason: 'provider_delivered', ...ctx };
  }

  // §D — a LIVE (non-backfill) sent confirmation delivery to the canonical
  // recipient means the ordinary pipeline already served this address.
  if (canonicalDeliveries.some((d) => d.provenance === 'LIVE_PROVIDER_CORRELATED' && d.status === 'sent')) {
    return { verdict: 'NOT_ELIGIBLE', outcome: 'NOT_ELIGIBLE', httpStatus: 200, reason: 'live_delivery_already_exists', ...ctx };
  }

  // There must be a HISTORICAL/backfill confirmation delivery to work from.
  const backfillDeliveries = deliveries.filter((d) => d.provenance === 'HISTORICAL_APP_ASSERTED');
  if (backfillDeliveries.length === 0) {
    return { verdict: 'NOT_ELIGIBLE', outcome: 'NOT_ELIGIBLE', httpStatus: 409, reason: 'no_historical_delivery', ...ctx };
  }

  // §5 — SAME-RECIPIENT operation: the backfill recipient must equal the current
  // canonical recipient. If it differs, this is an address correction — the
  // caller must use confirmation-recovery instead.
  if (!backfillDeliveries.some((d) => d.recipientHash === canonicalRecipientHash)) {
    return { verdict: 'NOT_ELIGIBLE', outcome: 'NOT_ELIGIBLE', httpStatus: 409, reason: 'historical_recipient_differs', ...ctx };
  }

  // §4 — terminal-negative / ambiguous correlated lifecycle => human review,
  // never an automatic resend. Fail-closed.
  if (canonicalLifecycles.some((l) => l === 'bounced' || l === 'complained' || l === 'suppressed' || l === 'failed')) {
    return { verdict: 'REVIEW_REQUIRED', outcome: 'REVIEW_REQUIRED', httpStatus: 409, reason: 'provider_terminal_negative', ...ctx };
  }
  if (canonicalLifecycles.some((l) => l === 'sent' || l === 'delivery_delayed')) {
    return { verdict: 'REVIEW_REQUIRED', outcome: 'REVIEW_REQUIRED', httpStatus: 409, reason: 'ambiguous_provider_state', ...ctx };
  }

  // A durable obligation already in flight would race a manual resend.
  if (snapshot.outboxObligationStatus === 'pending' || snapshot.outboxObligationStatus === 'processing') {
    return { verdict: 'RESEND_IN_PROGRESS', outcome: 'RESEND_IN_PROGRESS', httpStatus: 409, reason: 'outbox_obligation_active', ...ctx };
  }

  return { verdict: 'ELIGIBLE', outcome: null, httpStatus: 200, reason: 'eligible', ...ctx };
}

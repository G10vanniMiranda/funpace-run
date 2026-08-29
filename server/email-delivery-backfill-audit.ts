import { createHash } from 'node:crypto';

import {
  buildEmailDeliveryIdempotencyKey,
  buildLegacyEmailDeliveryCandidate,
  normalizeRecipientEmail,
  type LegacyEmailAudit,
  type LegacyEmailSummary,
} from './email-delivery-history.js';

// ---------------------------------------------------------------------------
// RELEASE-05 Stage 1A — read-only historical email backfill classifier.
//
// Pure functions only. This module MUST NOT be able to write:
//  - no INSERT / UPDATE / DELETE, no SQL builders that mutate,
//  - no import of the email sender, provider, cron, webhook or any outbox,
//  - no hard-coded production snapshot, no real registration identifiers.
//
// It answers, per legacy-email registration that has no append-only history:
//   1. how strong is the historical evidence  (EvidenceClass)
//   2. when did the send happen relative to the history rollout  (GapClass)
//   3. does its provider message id already live on another delivery  (CollisionClass)
//   4. what, if anything, a future executor could safely do  (PlanAction)
// ---------------------------------------------------------------------------

export type EvidenceClass = 'PROVEN' | 'RECOVERABLE' | 'AMBIGUOUS' | 'UNRESOLVED';

export type GapClass =
  | 'PRE_HISTORY_EXPECTED_BACKFILL'
  | 'POST_HISTORY_LIVE_FLOW_GAP'
  | 'MIGRATION_WINDOW'
  | 'AMBIGUOUS_TIMELINE'
  | 'UNKNOWN';

export type CollisionClass =
  | 'NONE'
  | 'SAME_EVENT_DIFFERENT_CONTEXT'
  | 'TRANSFER_IDENTITY_CHANGE'
  | 'LEGACY_CONTEXT_DRIFT'
  | 'DUPLICATE_HISTORY'
  | 'DATA_INCONSISTENCY'
  | 'UNKNOWN';

export type PlanAction =
  | 'NO_ACTION'
  | 'PLANNED_INSERT_HIGH_CONFIDENCE'
  | 'HUMAN_REVIEW_RECOMMENDED'
  | 'DO_NOT_BACKFILL_AUTOMATICALLY'
  | 'DO_NOT_BACKFILL'
  | 'HOLD_FOR_ROOT_CAUSE'
  | 'REVIEW_REQUIRED';

const RECOVERABLE_SNAPSHOT_ACTIONS = new Set([
  'email.confirmation.skipped',
  'email.pending.skipped',
  'registration.created_paid_manually',
]);

const IDENTITY_CHANGE_ACTIONS = ['registration.updated'];
const IDENTITY_CHANGE_SUBSTRING = 'participant_transfer';

function isIdentityChange(action: string) {
  return IDENTITY_CHANGE_ACTIONS.includes(action) || action.includes(IDENTITY_CHANGE_SUBSTRING);
}

function completionOf(audits: LegacyEmailAudit[]) {
  return audits
    .filter((item) => ['email.confirmation.sent', 'email.confirmation.failed'].includes(item.action))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
}

function completedAtOf(summary: LegacyEmailSummary, audits: LegacyEmailAudit[]) {
  const completion = completionOf(audits);
  const fallback = [summary.sentAt, summary.lastAttemptAt]
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => b.localeCompare(a))[0];
  return completion?.createdAt || fallback || null;
}

export type HistoricalEmailEvidence = {
  evidenceClass: EvidenceClass;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  recipientSource: 'attempt_audit' | 'completion_audit' | 'historical_snapshot' | 'none';
  hasProviderMessageId: boolean;
  reason: string;
};

/**
 * Classify how safely the historical confirmation email can be reconstructed
 * from persisted evidence. The current registration email is never accepted as
 * proof of the historical recipient.
 */
export function classifyHistoricalEmailEvidence(
  summary: LegacyEmailSummary,
  audits: LegacyEmailAudit[],
): HistoricalEmailEvidence {
  // 1. PROVEN: an attempt or matching completion audit carries the recipient.
  const proven = buildLegacyEmailDeliveryCandidate(summary, audits);
  if (proven && ['audit', 'completion_audit'].includes(String(proven.metadata.recipientSource))) {
    return {
      evidenceClass: 'PROVEN',
      confidence: 'HIGH',
      recipientSource: proven.metadata.recipientSource === 'audit' ? 'attempt_audit' : 'completion_audit',
      hasProviderMessageId: Boolean(proven.providerMessageId),
      reason: 'recipient carried by an email.confirmation audit event',
    };
  }

  const completedAt = completedAtOf(summary, audits);
  if (!completedAt) {
    return {
      evidenceClass: 'UNRESOLVED', confidence: 'LOW', recipientSource: 'none',
      hasProviderMessageId: Boolean(summary.providerMessageId),
      reason: 'no completion timestamp could be established',
    };
  }

  // 2. RECOVERABLE: a single trustworthy recipient snapshot before completion,
  //    with no identity change between the snapshot and the completion.
  const snapshots = audits
    .filter((item) => RECOVERABLE_SNAPSHOT_ACTIONS.has(item.action) && item.createdAt <= completedAt)
    .flatMap((item) => {
      const payload = (item.payload && typeof item.payload === 'object') ? item.payload as Record<string, unknown> : {};
      const email = typeof payload.email === 'string' ? normalizeRecipientEmail(payload.email) : '';
      return email ? [{ email, createdAt: item.createdAt }] : [];
    });
  const distinctRecipients = [...new Set(snapshots.map((item) => item.email))];

  if (distinctRecipients.length > 1) {
    return {
      evidenceClass: 'AMBIGUOUS', confidence: 'LOW', recipientSource: 'none',
      hasProviderMessageId: Boolean(summary.providerMessageId),
      reason: 'conflicting historical recipient snapshots',
    };
  }
  if (distinctRecipients.length === 0) {
    return {
      evidenceClass: 'UNRESOLVED', confidence: 'LOW', recipientSource: 'none',
      hasProviderMessageId: Boolean(summary.providerMessageId),
      reason: 'legacy summary only; no recoverable recipient evidence',
    };
  }

  const latestSnapshot = [...snapshots].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const identityChanged = audits.some((item) => (
    item.createdAt >= latestSnapshot.createdAt
    && item.createdAt <= completedAt
    && isIdentityChange(item.action)
  ));
  if (identityChanged) {
    return {
      evidenceClass: 'AMBIGUOUS', confidence: 'LOW', recipientSource: 'none',
      hasProviderMessageId: Boolean(summary.providerMessageId),
      reason: 'participant identity changed between the recipient snapshot and completion',
    };
  }

  const recoverable = buildLegacyEmailDeliveryCandidate(summary, [
    ...audits,
    { action: 'email.confirmation.attempted', createdAt: latestSnapshot.createdAt, payload: { email: latestSnapshot.email } },
  ]);
  if (!recoverable) {
    return {
      evidenceClass: 'UNRESOLVED', confidence: 'LOW', recipientSource: 'none',
      hasProviderMessageId: Boolean(summary.providerMessageId),
      reason: 'recipient snapshot present but candidate could not be built',
    };
  }
  return {
    evidenceClass: 'RECOVERABLE', confidence: 'MEDIUM', recipientSource: 'historical_snapshot',
    hasProviderMessageId: Boolean(recoverable.providerMessageId),
    reason: 'single trustworthy recipient snapshot before completion',
  };
}

export type EmailHistoryGapInput = {
  /** ISO. Completion time of the historical send (audit or legacy summary). */
  completedAt: string | null;
  /** ISO. When the append-only history first started recording live deliveries. */
  historyRolloutAt: string;
  /** ISO. Half-width of the deployment/uncertainty window, e.g. 24h. */
  migrationWindowMs?: number;
};

export function classifyEmailHistoryGap(input: EmailHistoryGapInput): GapClass {
  if (!input.completedAt) return 'AMBIGUOUS_TIMELINE';
  const completed = new Date(input.completedAt).getTime();
  const rollout = new Date(input.historyRolloutAt).getTime();
  if (Number.isNaN(completed) || Number.isNaN(rollout)) return 'UNKNOWN';
  const window = input.migrationWindowMs ?? 24 * 60 * 60 * 1000;
  if (completed < rollout - window) return 'PRE_HISTORY_EXPECTED_BACKFILL';
  if (completed > rollout + window) return 'POST_HISTORY_LIVE_FLOW_GAP';
  return 'MIGRATION_WINDOW';
}

export type ProviderCollisionInput = {
  candidateRegistrationId: string;
  candidateRecipientHash: string;
  candidateContextKey: string;
  candidateIdempotencyKey: string;
  /** Existing deliveries that share this candidate's provider + provider_message_id. */
  existingSameProviderMessage: Array<{
    registrationId: string;
    recipientHash: string;
    contextKey: string;
    idempotencyKey: string;
  }>;
};

export function classifyProviderMessageCollision(input: ProviderCollisionInput): CollisionClass {
  const others = input.existingSameProviderMessage.filter(
    (row) => row.idempotencyKey !== input.candidateIdempotencyKey,
  );
  if (others.length === 0) return 'NONE';
  if (others.length > 1) return 'DATA_INCONSISTENCY';
  const [other] = others;
  if (other.registrationId !== input.candidateRegistrationId) {
    return other.recipientHash === input.candidateRecipientHash
      ? 'TRANSFER_IDENTITY_CHANGE'
      : 'DATA_INCONSISTENCY';
  }
  if (other.recipientHash !== input.candidateRecipientHash) return 'TRANSFER_IDENTITY_CHANGE';
  if (other.contextKey !== input.candidateContextKey) return 'LEGACY_CONTEXT_DRIFT';
  return 'SAME_EVENT_DIFFERENT_CONTEXT';
}

/**
 * True when an append-only delivery already records THIS registration's THIS
 * recipient with THIS provider message id — i.e. the confirmation is already in
 * history, and the only difference is a reconstructed `legacy:` context key vs
 * the live-flow `participant:` context key. Such a candidate must never count as
 * missing history and must never be a planned insert.
 */
export function hasHistoryByProviderMessageIdentity(input: {
  candidateRegistrationId: string;
  candidateRecipientHash: string;
  candidateProvider: string;
  candidateProviderMessageId: string | null;
  existing: Array<{ registrationId: string; recipientHash: string; provider: string; providerMessageId: string | null }>;
}) {
  if (!input.candidateProviderMessageId) return false;
  return input.existing.some((row) => (
    row.registrationId === input.candidateRegistrationId
    && row.recipientHash === input.candidateRecipientHash
    && row.provider === input.candidateProvider
    && row.providerMessageId === input.candidateProviderMessageId
  ));
}

export type PlanInput = {
  evidenceClass: EvidenceClass;
  gapClass: GapClass;
  collisionClass: CollisionClass;
  hasExistingIdempotency: boolean;
  hasExistingDeliveryForRegistration: boolean;
};

/**
 * Model only. Returns the *action a future, separately-authorised executor
 * could take* — never SQL, never a write. Stage 1A cannot insert.
 */
export function planHistoricalEmailBackfill(input: PlanInput): PlanAction {
  if (input.hasExistingIdempotency) return 'NO_ACTION';
  if (input.collisionClass !== 'NONE') return 'REVIEW_REQUIRED';
  if (input.evidenceClass === 'UNRESOLVED') return 'DO_NOT_BACKFILL';
  if (input.evidenceClass === 'AMBIGUOUS') return 'DO_NOT_BACKFILL_AUTOMATICALLY';
  if (input.gapClass === 'POST_HISTORY_LIVE_FLOW_GAP') return 'HOLD_FOR_ROOT_CAUSE';
  if (input.gapClass === 'AMBIGUOUS_TIMELINE' || input.gapClass === 'UNKNOWN') return 'HUMAN_REVIEW_RECOMMENDED';
  if (input.evidenceClass === 'RECOVERABLE') return 'HUMAN_REVIEW_RECOMMENDED';
  // PROVEN + (PRE_HISTORY_EXPECTED_BACKFILL | MIGRATION_WINDOW) + no collision.
  return input.gapClass === 'PRE_HISTORY_EXPECTED_BACKFILL'
    ? 'PLANNED_INSERT_HIGH_CONFIDENCE'
    : 'HUMAN_REVIEW_RECOMMENDED';
}

// --- safe fingerprints ----------------------------------------------------

export function fingerprint(value: string, length = 12) {
  return createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, length);
}

export type SafeCandidateSummary = {
  candidateFingerprint: string;
  evidenceClass: EvidenceClass;
  confidence: HistoricalEmailEvidence['confidence'];
  recipientSource: HistoricalEmailEvidence['recipientSource'];
  gapClass: GapClass;
  collisionClass: CollisionClass;
  planAction: PlanAction;
  hasProviderMessageId: boolean;
  completedAt: string | null;
};

export function buildSafeHistoricalEmailCandidateSummary(input: {
  registrationId: string;
  summary: LegacyEmailSummary;
  audits: LegacyEmailAudit[];
  historyRolloutAt: string;
  migrationWindowMs?: number;
  hasExistingIdempotency: boolean;
  hasExistingDeliveryForRegistration: boolean;
  collisionClass: CollisionClass;
}): SafeCandidateSummary {
  const evidence = classifyHistoricalEmailEvidence(input.summary, input.audits);
  const completedAt = completedAtOf(input.summary, input.audits);
  const gapClass = classifyEmailHistoryGap({
    completedAt,
    historyRolloutAt: input.historyRolloutAt,
    migrationWindowMs: input.migrationWindowMs,
  });
  const planAction = planHistoricalEmailBackfill({
    evidenceClass: evidence.evidenceClass,
    gapClass,
    collisionClass: input.collisionClass,
    hasExistingIdempotency: input.hasExistingIdempotency,
    hasExistingDeliveryForRegistration: input.hasExistingDeliveryForRegistration,
  });
  return {
    candidateFingerprint: fingerprint(input.registrationId),
    evidenceClass: evidence.evidenceClass,
    confidence: evidence.confidence,
    recipientSource: evidence.recipientSource,
    gapClass,
    collisionClass: input.collisionClass,
    planAction,
    hasProviderMessageId: evidence.hasProviderMessageId,
    completedAt,
  };
}

export type EmailBackfillAuditReport = {
  schemaVersion: 1;
  totals: {
    registrations: number;
    legacyEmailState: number;
    alreadyHasHistory: number;
    alreadyHasHistoryViaProviderMessage: number;
    noHistory: number;
    deliveryRows: number;
  };
  evidence: Record<EvidenceClass, number>;
  gap: Record<GapClass, number>;
  collision: Record<CollisionClass, number>;
  plan: Record<PlanAction, number>;
  historyRolloutAt: string;
  classificationFingerprint: string;
};

export function buildEmailBackfillAuditReport(input: {
  registrationsTotal: number;
  legacyEmailState: number;
  alreadyHasHistory: number;
  alreadyHasHistoryViaProviderMessage: number;
  deliveryRows: number;
  historyRolloutAt: string;
  candidates: SafeCandidateSummary[];
}): EmailBackfillAuditReport {
  const tally = <T extends string>(keys: readonly T[], pick: (c: SafeCandidateSummary) => T) => {
    const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<T, number>;
    for (const c of input.candidates) out[pick(c)] += 1;
    return out;
  };
  const evidence = tally(['PROVEN', 'RECOVERABLE', 'AMBIGUOUS', 'UNRESOLVED'] as const, (c) => c.evidenceClass);
  const gap = tally(['PRE_HISTORY_EXPECTED_BACKFILL', 'POST_HISTORY_LIVE_FLOW_GAP', 'MIGRATION_WINDOW', 'AMBIGUOUS_TIMELINE', 'UNKNOWN'] as const, (c) => c.gapClass);
  const collision = tally(['NONE', 'SAME_EVENT_DIFFERENT_CONTEXT', 'TRANSFER_IDENTITY_CHANGE', 'LEGACY_CONTEXT_DRIFT', 'DUPLICATE_HISTORY', 'DATA_INCONSISTENCY', 'UNKNOWN'] as const, (c) => c.collisionClass);
  const plan = tally(['NO_ACTION', 'PLANNED_INSERT_HIGH_CONFIDENCE', 'HUMAN_REVIEW_RECOMMENDED', 'DO_NOT_BACKFILL_AUTOMATICALLY', 'DO_NOT_BACKFILL', 'HOLD_FOR_ROOT_CAUSE', 'REVIEW_REQUIRED'] as const, (c) => c.planAction);

  const stableDigestInput = input.candidates
    .map((c) => [c.candidateFingerprint, c.evidenceClass, c.gapClass, c.collisionClass, c.planAction].join(':'))
    .sort()
    .join('|');

  return {
    schemaVersion: 1,
    totals: {
      registrations: input.registrationsTotal,
      legacyEmailState: input.legacyEmailState,
      alreadyHasHistory: input.alreadyHasHistory,
      alreadyHasHistoryViaProviderMessage: input.alreadyHasHistoryViaProviderMessage,
      noHistory: input.candidates.length,
      deliveryRows: input.deliveryRows,
    },
    evidence,
    gap,
    collision,
    plan,
    historyRolloutAt: input.historyRolloutAt,
    classificationFingerprint: fingerprint(stableDigestInput, 32),
  };
}

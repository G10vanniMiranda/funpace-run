import { createHash } from 'node:crypto';

import {
  buildEmailDeliveryIdempotencyKey,
  buildLegacyEmailDeliveryCandidate,
  hashEmailRecipient,
  normalizeRecipientEmail,
  type LegacyEmailAudit,
  type LegacyEmailSummary,
} from './email-delivery-history.js';
import {
  classifyHistoricalEmailEvidence,
  fingerprint,
} from './email-delivery-backfill-audit.js';

// ---------------------------------------------------------------------------
// RELEASE-05 Stage 2A — guarded historical email backfill executor foundation.
//
// Pure model + statement builders. This module holds NO database client, opens
// NO transaction and sends NOTHING. It never imports the email sender, the
// provider, an outbox or a recovery script. The apply CLI is a separate,
// gated surface and is not invoked against production in this stage.
// ---------------------------------------------------------------------------

export const BACKFILL_COHORT = 'recoverable_acceptable' as const;
export const BACKFILL_EVIDENCE_VERSION = 'stage2a-v1' as const;
export const EMAIL_HISTORY_BACKFILL_APPLY_CONFIRMATION = 'APPLY_APPROVED_EMAIL_HISTORY_BACKFILL' as const;
export const EMAIL_HISTORY_BACKFILL_ENV_GATE = 'production' as const;

export type RecoverableSubClass =
  | 'RECOVERABLE_STRONG'
  | 'RECOVERABLE_ACCEPTABLE'
  | 'RECOVERABLE_WEAK'
  | 'RECOVERABLE_CONFLICT';

export type BackfillEligibilityAction =
  | 'ELIGIBLE_FOR_HUMAN_APPROVAL'
  | 'NEEDS_MANUAL_REVIEW'
  | 'DO_NOT_BACKFILL';

const SNAPSHOT_ACTIONS = new Set([
  'email.confirmation.skipped',
  'email.pending.skipped',
  'registration.created_paid_manually',
]);

function isIdentityChange(action: string) {
  return action === 'registration.updated' || action.includes('participant_transfer');
}

export type ExistingDeliveryRef = {
  registrationId: string;
  recipientHash: string;
  provider: string;
  providerMessageId: string | null;
  idempotencyKey: string;
};

export type RecoverableEvaluation = {
  subClass: RecoverableSubClass;
  action: BackfillEligibilityAction;
  status: 'sent' | 'failed' | 'unknown';
  recipientHash: string | null;
  recipientSource: 'historical_snapshot';
  providerPresent: boolean;
  providerMessagePresent: boolean;
  historicalTimestampsPresent: boolean;
  timestampsCoherent: boolean;
  distinctRecipientHashes: number;
  identityChangeInWindow: boolean;
  snapshotBeforeCompletion: boolean | null;
  providerMessageInHistory: 'none' | 'same_identity_context_only' | 'conflicting_identity';
  attemptedAt: string | null;
  completedAt: string | null;
  reason: string;
};

/**
 * Sub-classify a candidate the Stage 1A classifier already labelled
 * `RECOVERABLE`. Only `RECOVERABLE_ACCEPTABLE` (with an
 * `ELIGIBLE_FOR_HUMAN_APPROVAL` action) may ever reach the plan. The current
 * registration email is never used.
 */
export function evaluateRecoverableCandidate(
  summary: LegacyEmailSummary,
  audits: LegacyEmailAudit[],
  existing: ExistingDeliveryRef[],
): RecoverableEvaluation {
  const completion = audits
    .filter((item) => ['email.confirmation.sent', 'email.confirmation.failed'].includes(item.action))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
  const completedAt = completion?.createdAt
    || [summary.sentAt, summary.lastAttemptAt].filter(Boolean).sort().slice(-1)[0] as string | undefined
    || null;

  const snapshots = audits
    .filter((item) => SNAPSHOT_ACTIONS.has(item.action))
    .flatMap((item) => {
      const payload = (item.payload && typeof item.payload === 'object') ? item.payload as Record<string, unknown> : {};
      const email = typeof payload.email === 'string' ? normalizeRecipientEmail(payload.email) : '';
      return email ? [{ hash: hashEmailRecipient(email), at: item.createdAt }] : [];
    });
  const beforeCompletion = completedAt ? snapshots.filter((s) => s.at <= completedAt) : snapshots;
  const distinctRecipientHashes = new Set(beforeCompletion.map((s) => s.hash)).size;
  const latestSnapshot = [...beforeCompletion].sort((a, b) => b.at.localeCompare(a.at))[0] || null;
  const snapshotAfterCompletion = completedAt ? snapshots.some((s) => s.at > completedAt) : false;
  const identityChangeInWindow = latestSnapshot && completedAt
    ? audits.some((item) => item.createdAt >= latestSnapshot.at && item.createdAt <= completedAt && isIdentityChange(item.action))
    : audits.some((item) => isIdentityChange(item.action));

  const recoverableCandidate = buildLegacyEmailDeliveryCandidate(summary, latestSnapshot
    ? [...audits, { action: 'email.confirmation.attempted', createdAt: latestSnapshot.at, payload: {} }]
    : audits);

  const status: RecoverableEvaluation['status'] = completion
    ? (completion.action === 'email.confirmation.sent' ? 'sent' : 'failed')
    : (summary.error && summary.lastAttemptAt && (!summary.sentAt || summary.lastAttemptAt >= summary.sentAt) ? 'failed'
      : summary.sentAt ? 'sent' : 'unknown');

  let providerMessageInHistory: RecoverableEvaluation['providerMessageInHistory'] = 'none';
  if (recoverableCandidate?.providerMessageId) {
    const others = existing.filter((row) => (
      row.provider === recoverableCandidate.provider
      && row.providerMessageId === recoverableCandidate.providerMessageId
    ));
    if (others.length > 0) {
      const compatible = others.every((row) => (
        row.registrationId === summary.registrationId
        && (!latestSnapshot || row.recipientHash === latestSnapshot.hash)
      ));
      providerMessageInHistory = compatible ? 'same_identity_context_only' : 'conflicting_identity';
    }
  }

  const attemptedAt = latestSnapshot?.at || summary.lastAttemptAt || completedAt || null;
  const historicalTimestampsPresent = Boolean(attemptedAt && completedAt);
  const timestampsCoherent = Boolean(attemptedAt && completedAt && attemptedAt <= completedAt);
  const hasAttemptAudit = audits.some((item) => item.action === 'email.confirmation.attempted');
  const providerPresent = Boolean(recoverableCandidate?.provider && recoverableCandidate.provider !== 'unknown');
  const providerMessagePresent = Boolean(recoverableCandidate?.providerMessageId);

  let subClass: RecoverableSubClass;
  let reason: string;
  if (identityChangeInWindow || distinctRecipientHashes > 1 || snapshotAfterCompletion
    || providerMessageInHistory === 'conflicting_identity'
    || (attemptedAt && completedAt && attemptedAt > completedAt)) {
    subClass = 'RECOVERABLE_CONFLICT';
    reason = 'identity change, conflicting snapshot, impossible timestamp or provider-message conflict';
  } else if (!latestSnapshot || !completedAt || !recoverableCandidate) {
    subClass = 'RECOVERABLE_WEAK';
    reason = 'snapshot present but evidence too incomplete to authorise without judgement';
  } else if (status !== 'sent' || !providerMessagePresent || !timestampsCoherent || distinctRecipientHashes !== 1) {
    subClass = 'RECOVERABLE_WEAK';
    reason = 'missing a primary signal (sent status, provider message id, coherent timestamps, single recipient)';
  } else if (hasAttemptAudit) {
    subClass = 'RECOVERABLE_STRONG';
    reason = 'single recipient snapshot, provider identity, coherent timestamps and an attempt audit';
  } else {
    subClass = 'RECOVERABLE_ACCEPTABLE';
    reason = 'single coherent recipient snapshot with provider identity; only the attempt audit is absent';
  }

  const action: BackfillEligibilityAction = subClass === 'RECOVERABLE_CONFLICT'
    ? 'DO_NOT_BACKFILL'
    : subClass === 'RECOVERABLE_WEAK'
      ? 'NEEDS_MANUAL_REVIEW'
      : 'ELIGIBLE_FOR_HUMAN_APPROVAL';

  return {
    subClass,
    action,
    status,
    recipientHash: latestSnapshot ? latestSnapshot.hash : null,
    recipientSource: 'historical_snapshot',
    providerPresent,
    providerMessagePresent,
    historicalTimestampsPresent,
    timestampsCoherent,
    distinctRecipientHashes,
    identityChangeInWindow: Boolean(identityChangeInWindow),
    snapshotBeforeCompletion: latestSnapshot && completedAt ? latestSnapshot.at <= completedAt : null,
    providerMessageInHistory,
    attemptedAt,
    completedAt,
    reason,
  };
}

export type BackfillPlanCandidateInput = {
  registrationId: string;
  summary: LegacyEmailSummary;
  audits: LegacyEmailAudit[];
};

export type EligibleBackfillCandidate = {
  candidateFingerprint: string;
  idempotencyKey: string;
  idempotencyFingerprint: string;
  registrationId: string;
  recipientEmail: string;
  recipientHash: string;
  contextKey: string;
  provider: string;
  providerMessageId: string;
  status: 'sent';
  attemptedAt: string;
  completedAt: string;
};

export type BackfillPlan = {
  cohort: typeof BACKFILL_COHORT;
  evidenceVersion: typeof BACKFILL_EVIDENCE_VERSION;
  eligible: EligibleBackfillCandidate[];
  excluded: {
    notRecoverable: number;
    recoverableStrong: number;
    recoverableWeak: number;
    recoverableConflict: number;
    alreadyHasHistory: number;
    providerCollision: number;
  };
  candidateSetFingerprint: string;
  planFingerprint: string;
};

function stableSort<T>(items: T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => key(a).localeCompare(key(b)));
}

/**
 * Build the append-only plan from already-loaded state. Pure. Only
 * `RECOVERABLE_ACCEPTABLE` + `ELIGIBLE_FOR_HUMAN_APPROVAL` candidates that have
 * no existing history and no provider-message collision are eligible.
 */
export function buildApprovedBackfillPlan(input: {
  candidates: BackfillPlanCandidateInput[];
  existing: ExistingDeliveryRef[];
}): BackfillPlan {
  const existingKeys = new Set(input.existing.map((row) => row.idempotencyKey));
  const existingRegRecPm = new Set(input.existing.map(
    (row) => `${row.registrationId}|${row.recipientHash}|${row.provider}|${row.providerMessageId}`,
  ));

  const excluded = {
    notRecoverable: 0,
    recoverableStrong: 0,
    recoverableWeak: 0,
    recoverableConflict: 0,
    alreadyHasHistory: 0,
    providerCollision: 0,
  };
  const eligible: EligibleBackfillCandidate[] = [];

  for (const candidate of input.candidates) {
    const baseCandidate = buildLegacyEmailDeliveryCandidate(candidate.summary, candidate.audits);
    const baseKey = baseCandidate ? buildEmailDeliveryIdempotencyKey(baseCandidate) : null;
    if (baseKey && existingKeys.has(baseKey)) { excluded.alreadyHasHistory += 1; continue; }
    if (baseCandidate?.providerMessageId && existingRegRecPm.has(
      `${candidate.registrationId}|${hashEmailRecipient(baseCandidate.recipientEmail)}|${baseCandidate.provider}|${baseCandidate.providerMessageId}`,
    )) { excluded.alreadyHasHistory += 1; continue; }

    const evidence = classifyHistoricalEmailEvidence(candidate.summary, candidate.audits);
    if (evidence.evidenceClass !== 'RECOVERABLE') { excluded.notRecoverable += 1; continue; }

    const evaluation = evaluateRecoverableCandidate(candidate.summary, candidate.audits, input.existing);
    if (evaluation.providerMessageInHistory === 'conflicting_identity') { excluded.providerCollision += 1; continue; }
    if (evaluation.subClass === 'RECOVERABLE_STRONG') { excluded.recoverableStrong += 1; continue; }
    if (evaluation.subClass === 'RECOVERABLE_WEAK') { excluded.recoverableWeak += 1; continue; }
    if (evaluation.subClass === 'RECOVERABLE_CONFLICT') { excluded.recoverableConflict += 1; continue; }
    if (evaluation.action !== 'ELIGIBLE_FOR_HUMAN_APPROVAL') { excluded.recoverableWeak += 1; continue; }

    const reconstructed = buildLegacyEmailDeliveryCandidate(candidate.summary, [
      ...candidate.audits,
      { action: 'email.confirmation.attempted', createdAt: evaluation.attemptedAt as string, payload: {} },
    ]);
    if (!reconstructed || !reconstructed.providerMessageId || evaluation.status !== 'sent'
      || !evaluation.completedAt || !evaluation.attemptedAt) {
      excluded.recoverableWeak += 1;
      continue;
    }
    const idempotencyKey = buildEmailDeliveryIdempotencyKey(reconstructed);
    if (existingKeys.has(idempotencyKey)) { excluded.alreadyHasHistory += 1; continue; }

    eligible.push({
      candidateFingerprint: fingerprint(candidate.registrationId),
      idempotencyKey,
      idempotencyFingerprint: fingerprint(idempotencyKey, 16),
      registrationId: candidate.registrationId,
      recipientEmail: reconstructed.recipientEmail,
      recipientHash: reconstructed.recipientHash,
      contextKey: reconstructed.contextKey,
      provider: reconstructed.provider,
      providerMessageId: reconstructed.providerMessageId,
      status: 'sent',
      attemptedAt: evaluation.attemptedAt,
      completedAt: evaluation.completedAt,
    });
  }

  const orderedEligible = stableSort(eligible, (item) => item.idempotencyKey);
  const candidateSetFingerprint = fingerprint(
    orderedEligible.map((item) => item.idempotencyFingerprint).join(':'),
    32,
  );
  const planFingerprint = computePlanFingerprint(orderedEligible);

  return {
    cohort: BACKFILL_COHORT,
    evidenceVersion: BACKFILL_EVIDENCE_VERSION,
    eligible: orderedEligible,
    excluded,
    candidateSetFingerprint,
    planFingerprint,
  };
}

/**
 * Deterministic fingerprint of the sanitized plan: no snapshot timestamp, no
 * PII, no raw identifiers. Two runs over the same eligible set produce the same
 * value; any change in membership, status, provider presence or historical
 * timestamps changes it.
 */
export function computePlanFingerprint(eligible: EligibleBackfillCandidate[]): string {
  const material = stableSort(eligible, (item) => item.idempotencyKey)
    .map((item) => [
      item.idempotencyFingerprint,
      item.status,
      item.provider ? 'p1' : 'p0',
      item.providerMessageId ? 'm1' : 'm0',
      item.attemptedAt ? 't1' : 't0',
      item.completedAt ? 'c1' : 'c0',
    ].join(':'))
    .join('|');
  return createHash('sha256').update(`email-history-backfill-plan-v1|${BACKFILL_COHORT}|${material}`).digest('hex');
}

export function deriveBackfillBatchId(planFingerprint: string, dateIso: string): string {
  const day = dateIso.slice(0, 10).replace(/-/g, '');
  return `email-history-${BACKFILL_COHORT}-${day}-${planFingerprint.slice(0, 12)}`;
}

export type HistoricalDeliveryInsertRow = {
  id: string;
  registration_id: string;
  kind: 'confirmation';
  recipient_email: string;
  recipient_hash: string;
  context_key: string;
  idempotency_key: string;
  provider: string;
  provider_message_id: string;
  status: 'sent';
  attempt_count: 1;
  attempted_at: string;
  sent_at: string;
  failed_at: null;
  error: null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

/**
 * Build the exact append-only rows. Historical timestamps are preserved
 * (`attempted_at` from the recipient snapshot, `sent_at`/`created_at` from the
 * completion) — never `NOW()`. Operational time lives only in
 * `metadata.recordedAt`.
 */
export function buildHistoricalDeliveryInsertRows(
  eligible: EligibleBackfillCandidate[],
  batchId: string,
  recordedAt: string,
): HistoricalDeliveryInsertRow[] {
  return stableSort(eligible, (item) => item.idempotencyKey).map((item) => ({
    id: `historical:${item.idempotencyKey}`,
    registration_id: item.registrationId,
    kind: 'confirmation',
    recipient_email: item.recipientEmail,
    recipient_hash: item.recipientHash,
    context_key: item.contextKey,
    idempotency_key: item.idempotencyKey,
    provider: item.provider,
    provider_message_id: item.providerMessageId,
    status: 'sent',
    attempt_count: 1,
    attempted_at: item.attemptedAt,
    sent_at: item.completedAt,
    failed_at: null,
    error: null,
    metadata: {
      historical: true,
      backfill: true,
      backfillBatchId: batchId,
      backfillCohort: BACKFILL_COHORT,
      recipientSource: 'historical_snapshot',
      evidenceVersion: BACKFILL_EVIDENCE_VERSION,
      recordedAt,
    },
    created_at: item.completedAt,
    updated_at: item.completedAt,
  }));
}

/**
 * The parameterised INSERT statement. Returns SQL text + a single JSON param;
 * it does NOT execute anything. `ON CONFLICT (idempotency_key) DO NOTHING` +
 * `RETURNING id` so the caller can prove how many rows were actually inserted.
 */
export function buildHistoricalDeliveryInsertStatement(rows: HistoricalDeliveryInsertRow[]): {
  text: string;
  params: [string];
  expectedInserts: number;
} {
  const text = `insert into public."run-email-deliveries"
  (id, registration_id, kind, recipient_email, recipient_hash, context_key, idempotency_key,
   provider, provider_message_id, status, attempt_count, attempted_at, sent_at, failed_at,
   error, metadata, created_at, updated_at)
select item.id, item.registration_id, item.kind, item.recipient_email, item.recipient_hash,
       item.context_key, item.idempotency_key, item.provider, item.provider_message_id, item.status,
       item.attempt_count, item.attempted_at, item.sent_at, item.failed_at, item.error,
       item.metadata, item.created_at, item.updated_at
from jsonb_to_recordset($1::jsonb) as item(
  id text, registration_id text, kind text, recipient_email text, recipient_hash text,
  context_key text, idempotency_key text, provider text, provider_message_id text, status text,
  attempt_count integer, attempted_at text, sent_at text, failed_at text, error text,
  metadata jsonb, created_at text, updated_at text
)
on conflict (idempotency_key) do nothing
returning id`;
  return { text, params: [JSON.stringify(rows)], expectedInserts: rows.length };
}

/**
 * Narrow rollback predicate — design only, never executed here. Deletes only
 * rows that positively belong to this exact batch AND whose idempotency key is
 * in the provided list. A DELETE still needs a separate emergency gate.
 */
export function buildBackfillRollbackStatement(input: {
  batchId: string;
  idempotencyKeys: string[];
}): { text: string; params: [string, string[]]; expectedDeletes: number } {
  const keys = [...new Set(input.idempotencyKeys)];
  if (keys.length === 0 || keys.some((key) => !/^[0-9a-f]{64}$/.test(key))) {
    throw new Error('Rollback requires a non-empty list of SHA-256 idempotency keys.');
  }
  const text = `delete from public."run-email-deliveries"
where idempotency_key = any($2::text[])
  and metadata->>'backfillBatchId' = $1
  and metadata->>'backfillCohort' = '${BACKFILL_COHORT}'
  and metadata->>'historical' = 'true'
  and metadata->>'backfill' = 'true'
returning id`;
  return { text, params: [input.batchId, keys], expectedDeletes: keys.length };
}

export type ProviderCollisionCheck = {
  ok: boolean;
  conflicts: string[];
};

/** Re-check provider identity against loaded history right before any insert. */
export function precheckProviderCollisions(
  eligible: EligibleBackfillCandidate[],
  existing: ExistingDeliveryRef[],
): ProviderCollisionCheck {
  const conflicts: string[] = [];
  for (const candidate of eligible) {
    const clashes = existing.filter((row) => (
      row.provider === candidate.provider
      && row.providerMessageId === candidate.providerMessageId
      && !(row.registrationId === candidate.registrationId && row.recipientHash === candidate.recipientHash)
    ));
    if (clashes.length > 0) conflicts.push(candidate.candidateFingerprint);
  }
  return { ok: conflicts.length === 0, conflicts };
}

export type SanitizedPlanRow = {
  candidateFingerprint: string;
  status: 'sent';
  recipientSource: 'historical_snapshot';
  providerPresent: boolean;
  providerMessagePresent: boolean;
  historicalTimestampPresent: boolean;
  idempotencyFingerprint: string;
  action: 'PLANNED_INSERT_ON_APPROVAL';
};

export function sanitizePlan(plan: BackfillPlan): {
  cohort: string;
  evidenceVersion: string;
  eligibleCount: number;
  excluded: BackfillPlan['excluded'];
  candidateSetFingerprint: string;
  planFingerprint: string;
  rows: SanitizedPlanRow[];
} {
  return {
    cohort: plan.cohort,
    evidenceVersion: plan.evidenceVersion,
    eligibleCount: plan.eligible.length,
    excluded: plan.excluded,
    candidateSetFingerprint: plan.candidateSetFingerprint,
    planFingerprint: plan.planFingerprint,
    rows: plan.eligible.map((item) => ({
      candidateFingerprint: item.candidateFingerprint,
      status: 'sent',
      recipientSource: 'historical_snapshot',
      providerPresent: Boolean(item.provider && item.provider !== 'unknown'),
      providerMessagePresent: Boolean(item.providerMessageId),
      historicalTimestampPresent: Boolean(item.attemptedAt && item.completedAt),
      idempotencyFingerprint: item.idempotencyFingerprint,
      action: 'PLANNED_INSERT_ON_APPROVAL',
    })),
  };
}

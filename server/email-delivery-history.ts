import { createHash, randomUUID } from 'node:crypto';

export type EmailDeliveryKind = 'confirmation';
export type EmailDeliveryStatus = 'attempting' | 'sent' | 'failed';

export type EmailDeliveryRecord = {
  id: string;
  registrationId: string;
  kind: EmailDeliveryKind;
  recipientEmail: string;
  recipientHash: string;
  contextKey: string;
  idempotencyKey: string;
  provider: string;
  providerMessageId: string | null;
  status: EmailDeliveryStatus;
  attemptCount: number;
  attemptedAt: string;
  sentAt: string | null;
  failedAt: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type EmailDeliveryResult = {
  ok: boolean;
  provider: string;
  providerMessageId?: string;
  error?: string;
};

export function buildLegacyEmailSummaryPatch(
  result: EmailDeliveryResult,
  completedAt: string,
) {
  return {
    confirmationEmailSentAt: result.ok ? completedAt : null,
    confirmationEmailProvider: result.provider,
    confirmationEmailId: result.ok ? result.providerMessageId || null : null,
    confirmationEmailError: result.ok ? null : result.error || 'Email send failed',
  };
}

export type EmailDeliveryClaim =
  | { outcome: 'claimed'; delivery: EmailDeliveryRecord; created: boolean }
  | { outcome: 'already_sent'; delivery: EmailDeliveryRecord }
  | { outcome: 'in_progress'; delivery: EmailDeliveryRecord };

export const EMAIL_DELIVERY_COOLDOWN_MS = 5 * 60_000;

export function canClaimEmailDeliveryAfterLegacySummary(input: {
  legacySentAt?: string | null;
  force?: boolean;
  contextKey?: string | null;
  existingDelivery?: boolean;
}) {
  return Boolean(input.existingDelivery)
    || !input.legacySentAt
    || Boolean(input.force)
    || Boolean(String(input.contextKey || '').trim());
}

export function isLatestEmailDelivery(
  deliveries: ReadonlyArray<{ id: string; attemptedAt: string; createdAt: string }>,
  deliveryId: string,
) {
  const latest = [...deliveries].sort((a, b) => (
    b.attemptedAt.localeCompare(a.attemptedAt)
    || b.createdAt.localeCompare(a.createdAt)
    || b.id.localeCompare(a.id)
  ))[0];
  return !latest || latest.id === deliveryId;
}

export type EmailDeliveryOutboxRecord = {
  id: string;
  entityType: string;
  entityId: string;
  sheetName: string;
  operation: 'upsert' | 'replace';
  status: 'pending' | 'processing' | 'synchronized' | 'failed';
  rowNumber: number | null;
  attempts: number;
  lastAttemptAt: string | null;
  synchronizedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export function upsertEmailDeliveryOutboxInMemory(
  tasks: EmailDeliveryOutboxRecord[],
  deliveryId: string,
  now = new Date().toISOString(),
) {
  const existing = tasks.find((item) => (
    item.entityType === 'email_delivery'
    && item.entityId === deliveryId
    && item.sheetName === 'emails'
  ));
  if (existing) {
    const wasProcessing = existing.status === 'processing';
    existing.status = 'pending';
    existing.operation = 'upsert';
    existing.synchronizedAt = null;
    existing.lastError = wasProcessing ? 'TRANSIENT: requeued while a previous attempt was processing' : null;
    existing.updatedAt = now;
    return existing;
  }
  const created: EmailDeliveryOutboxRecord = {
    id: randomUUID(),
    entityType: 'email_delivery',
    entityId: deliveryId,
    sheetName: 'emails',
    operation: 'upsert',
    status: 'pending',
    rowNumber: null,
    attempts: 0,
    lastAttemptAt: null,
    synchronizedAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
  tasks.push(created);
  return created;
}

export function normalizeRecipientEmail(value: string) {
  return value.trim().toLowerCase();
}

export function hashEmailRecipient(value: string) {
  return createHash('sha256').update(normalizeRecipientEmail(value)).digest('hex');
}

function hashValue(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function resolveEmailDeliveryContextKey(recipientEmail: string, explicitContext?: string | null) {
  const normalizedContext = String(explicitContext || '').trim();
  if (normalizedContext) return normalizedContext.slice(0, 160);
  return `participant:${hashEmailRecipient(recipientEmail)}`;
}

export function buildEmailDeliveryIdempotencyKey(input: {
  registrationId: string;
  kind: EmailDeliveryKind;
  recipientEmail: string;
  contextKey?: string | null;
}) {
  const recipientHash = hashEmailRecipient(input.recipientEmail);
  const contextKey = resolveEmailDeliveryContextKey(input.recipientEmail, input.contextKey);
  return hashValue(['funpace-email-delivery-v1', input.registrationId, input.kind, recipientHash, contextKey].join(':'));
}

export function claimEmailDeliveryInMemory(
  deliveries: EmailDeliveryRecord[],
  input: {
    registrationId: string;
    kind: EmailDeliveryKind;
    recipientEmail: string;
    provider: string;
    contextKey?: string | null;
    metadata?: Record<string, unknown>;
  },
  now = new Date().toISOString(),
): EmailDeliveryClaim {
  const recipientEmail = normalizeRecipientEmail(input.recipientEmail);
  const recipientHash = hashEmailRecipient(recipientEmail);
  const contextKey = resolveEmailDeliveryContextKey(recipientEmail, input.contextKey);
  const idempotencyKey = buildEmailDeliveryIdempotencyKey({ ...input, recipientEmail, contextKey });
  const existing = deliveries.find((item) => item.idempotencyKey === idempotencyKey);

  if (existing?.status === 'sent') return { outcome: 'already_sent', delivery: existing };
  if (existing?.status === 'attempting'
    && new Date(now).getTime() - new Date(existing.attemptedAt).getTime() < EMAIL_DELIVERY_COOLDOWN_MS) {
    return { outcome: 'in_progress', delivery: existing };
  }
  if (existing) {
    existing.status = 'attempting';
    existing.provider = input.provider;
    existing.attemptCount += 1;
    existing.attemptedAt = now;
    existing.failedAt = null;
    existing.error = null;
    existing.updatedAt = now;
    existing.metadata = { ...existing.metadata, ...(input.metadata || {}) };
    return { outcome: 'claimed', delivery: existing, created: false };
  }

  const delivery: EmailDeliveryRecord = {
    id: randomUUID(),
    registrationId: input.registrationId,
    kind: input.kind,
    recipientEmail,
    recipientHash,
    contextKey,
    idempotencyKey,
    provider: input.provider,
    providerMessageId: null,
    status: 'attempting',
    attemptCount: 1,
    attemptedAt: now,
    sentAt: null,
    failedAt: null,
    error: null,
    metadata: { ...(input.metadata || {}) },
    createdAt: now,
    updatedAt: now,
  };
  deliveries.push(delivery);
  return { outcome: 'claimed', delivery, created: true };
}

export function completeEmailDeliveryInMemory(
  delivery: EmailDeliveryRecord,
  result: EmailDeliveryResult,
  now = new Date().toISOString(),
) {
  delivery.provider = result.provider;
  delivery.updatedAt = now;
  if (result.ok) {
    delivery.status = 'sent';
    delivery.providerMessageId = result.providerMessageId || null;
    delivery.sentAt = now;
    delivery.failedAt = null;
    delivery.error = null;
  } else {
    delivery.status = 'failed';
    delivery.failedAt = now;
    delivery.error = result.error || 'Email send failed';
  }
  return delivery;
}

export type LegacyEmailSummary = {
  registrationId: string;
  currentRecipientEmail: string;
  provider: string | null;
  providerMessageId: string | null;
  sentAt: string | null;
  lastAttemptAt: string | null;
  error: string | null;
};

export type LegacyEmailAudit = {
  action: string;
  createdAt: string;
  payload: unknown;
};

export function buildLegacyEmailDeliveryCandidate(summary: LegacyEmailSummary, audits: LegacyEmailAudit[]) {
  const completion = audits
    .filter((item) => ['email.confirmation.sent', 'email.confirmation.failed'].includes(item.action))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const fallbackCompletedAt = [summary.sentAt, summary.lastAttemptAt]
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => b.localeCompare(a))[0];
  const completedAt = completion?.createdAt || fallbackCompletedAt;
  if (!completedAt) return null;
  const completionPayload = completion?.payload && typeof completion.payload === 'object'
    ? completion.payload as Record<string, unknown>
    : {};
  const status: EmailDeliveryStatus = completion
    ? completion.action === 'email.confirmation.sent' ? 'sent' : 'failed'
    : summary.error && summary.lastAttemptAt
      && (!summary.sentAt || summary.lastAttemptAt.localeCompare(summary.sentAt) >= 0)
      ? 'failed'
      : summary.sentAt ? 'sent' : 'failed';
  const attempted = audits
    .filter((item) => item.action === 'email.confirmation.attempted' && new Date(item.createdAt) <= new Date(completedAt))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const attemptedPayload = attempted?.payload && typeof attempted.payload === 'object'
    ? attempted.payload as Record<string, unknown>
    : {};
  const auditedRecipient = typeof attemptedPayload.email === 'string' ? attemptedPayload.email : '';
  const recipientEmail = normalizeRecipientEmail(auditedRecipient || summary.currentRecipientEmail);
  const providerMessageId = status === 'sent'
    ? typeof completionPayload.providerMessageId === 'string'
      ? completionPayload.providerMessageId
      : summary.providerMessageId
    : null;
  const error = status === 'failed'
    ? typeof completionPayload.error === 'string'
      ? completionPayload.error
      : summary.error || 'Email send failed'
    : null;
  if (!recipientEmail || (status === 'sent' && !providerMessageId)) return null;
  return {
    registrationId: summary.registrationId,
    kind: 'confirmation' as const,
    recipientEmail,
    recipientHash: hashEmailRecipient(recipientEmail),
    contextKey: `legacy:${providerMessageId || completedAt}`,
    provider: typeof completionPayload.provider === 'string' ? completionPayload.provider : summary.provider || 'unknown',
    providerMessageId,
    status,
    attemptedAt: attempted?.createdAt || summary.lastAttemptAt || completedAt,
    sentAt: status === 'sent' ? completedAt : null,
    failedAt: status === 'failed' ? completedAt : null,
    error,
    metadata: {
      backfill: true,
      recipientSource: auditedRecipient ? 'audit' : 'registration_fallback',
    },
  };
}

export type EmailDeliveryBackfillCandidateSummary = {
  idempotencyKey: string;
  provider: string;
  providerMessageId: string | null;
  metadata: { recipientSource?: unknown };
};

export type ExistingEmailDeliverySummary = {
  idempotencyKey: string;
  provider: string;
  providerMessageId: string | null;
};

export function summarizeEmailDeliveryBackfill(
  candidates: EmailDeliveryBackfillCandidateSummary[],
  existing: ExistingEmailDeliverySummary[],
  sourceCount = candidates.length,
) {
  const duplicateValues = (values: string[]) => values.length - new Set(values).size;
  const providerKey = (item: { provider: string; providerMessageId: string | null }) => (
    item.providerMessageId ? `${item.provider}:${item.providerMessageId}` : null
  );
  const candidateProviderKeys = candidates.map(providerKey).filter((value): value is string => Boolean(value));
  const existingProviderKeys = new Set(existing.map(providerKey).filter((value): value is string => Boolean(value)));
  const existingIdempotencyKeys = new Set(existing.map((item) => item.idempotencyKey));

  const summary = {
    candidates: candidates.length,
    recipientFromAudit: candidates.filter((item) => item.metadata.recipientSource === 'audit').length,
    recipientFallback: candidates.filter((item) => item.metadata.recipientSource === 'registration_fallback').length,
    candidateIdempotency: duplicateValues(candidates.map((item) => item.idempotencyKey)),
    candidateProviderMessage: duplicateValues(candidateProviderKeys),
    existingIdempotency: candidates.filter((item) => existingIdempotencyKeys.has(item.idempotencyKey)).length,
    existingProviderMessage: candidateProviderKeys.filter((item) => existingProviderKeys.has(item)).length,
    ambiguous: Math.max(0, sourceCount - candidates.length),
  };
  const reviewRequired = summary.recipientFallback > 0
    || summary.candidateIdempotency > 0
    || summary.candidateProviderMessage > 0
    || summary.existingIdempotency > 0
    || summary.existingProviderMessage > 0
    || summary.ambiguous > 0;
  return {
    ...summary,
    verdict: reviewRequired ? 'REVIEW REQUIRED' as const : 'PASS' as const,
  };
}

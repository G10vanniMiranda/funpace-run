// EMAIL-OPS-002 — dedicated durable confirmation-email outbox.
//
// This is a SEPARATE bounded context from run-google-sheet-sync. It owns exactly
// one fact: "a legitimately paid registration is OWED a confirmation email".
// Google Sheets synchronisation and transactional email delivery do not share a
// persistence model here — only, at the edges, a 5-minute scheduler tick.
//
// The obligation is enqueued inside the SAME transaction that makes a
// registration/payment paid (see enqueueConfirmationEmailInPostgres in
// server/database.ts). run-email-deliveries remains the send-idempotency ledger;
// the Resend Idempotency-Key remains the provider-level defence. This module is
// the durable obligation layer that guarantees the payment -> email invariant:
//
//   COMMIT(PAID)  =>  COMMIT(CONFIRMATION_EMAIL_OUTBOX)
//
// Pure logic + in-memory helpers only. No I/O. Postgres wiring lives in
// server/database.ts; the worker loop lives in server/index.ts.

export type ConfirmationEmailType = 'confirmation';

export type ConfirmationEmailOutboxStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type ConfirmationEmailOutboxRecord = {
  id: string;
  registrationId: string;
  eventId: string | null;
  emailType: ConfirmationEmailType;
  status: ConfirmationEmailOutboxStatus;
  attempts: number;
  nextAttemptAt: string;
  lockedAt: string | null;
  lockedBy: string | null;
  lastError: string | null;
  source: string | null;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
};

export type ConfirmationEmailObligationInput = {
  registrationId: string;
  eventId?: string | null;
  emailType?: ConfirmationEmailType;
  source?: string | null;
};

// Bounded retry policy. Six attempts across an exponential 5m -> 6h back-off
// window: a common transient failure recovers on the first 5-minute drain; a
// hard failure terminates in well under a day and raises one alert.
export const CONFIRMATION_EMAIL_OUTBOX_MAX_ATTEMPTS = 6;
export const CONFIRMATION_EMAIL_OUTBOX_BASE_BACKOFF_MS = 5 * 60_000;
export const CONFIRMATION_EMAIL_OUTBOX_MAX_BACKOFF_MS = 6 * 60 * 60_000;
// A task left 'processing' longer than the lease is treated as a crashed worker
// and returned to 'pending'. Must comfortably exceed a single drain's runtime.
export const CONFIRMATION_EMAIL_OUTBOX_LEASE_MS = 10 * 60_000;
// Bounded per-drain so one serverless invocation cannot exceed its wall clock:
// batch 10, and the worker also stops claiming/processing past a time budget,
// releasing any untouched task back to 'pending' (see server/index.ts).
export const CONFIRMATION_EMAIL_OUTBOX_BATCH_SIZE = 10;
export const CONFIRMATION_EMAIL_OUTBOX_DRAIN_BUDGET_MS = 45_000;

export function planConfirmationEmailBackoffMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  const raw = CONFIRMATION_EMAIL_OUTBOX_BASE_BACKOFF_MS * 2 ** exponent;
  return Math.min(raw, CONFIRMATION_EMAIL_OUTBOX_MAX_BACKOFF_MS);
}

export function nextConfirmationEmailAttemptAt(attempts: number, fromISO: string): string {
  return new Date(new Date(fromISO).getTime() + planConfirmationEmailBackoffMs(attempts)).toISOString();
}

export function isConfirmationEmailOutboxExhausted(
  attempts: number,
  maxAttempts: number = CONFIRMATION_EMAIL_OUTBOX_MAX_ATTEMPTS,
): boolean {
  return attempts >= maxAttempts;
}

// ---------------------------------------------------------------------------
// Worker result interpretation
// ---------------------------------------------------------------------------
// The worker calls the canonical sender (processRegistrationEmail) and then, for
// an ambiguous null, probes the durable ledger. Every branch maps to exactly one
// of these signals.

export type OutboxSendSignal =
  // Provider accepted the message (id present) on this attempt.
  | { kind: 'sent' }
  // A durable confirmation already exists (append-only 'sent' row or legacy
  // summary). The obligation is satisfied without another provider request.
  | { kind: 'already-satisfied' }
  // An environment / configuration gate refused the send (provider disabled,
  // recipient not on an allow-list). Terminal, but NOT an incident -> no alert.
  | { kind: 'skipped'; reason: string }
  // The send was attempted and failed, or the claim was declined for a
  // transient reason (attempt cooldown). Retry with back-off.
  | { kind: 'transient-failure'; error: string };

export type OutboxTaskResolution =
  | { action: 'complete' }
  | { action: 'retry'; attempts: number; nextAttemptAt: string; lastError: string }
  | { action: 'fail'; attempts: number; lastError: string; alert: boolean };

export function resolveOutboxTask(
  task: Pick<ConfirmationEmailOutboxRecord, 'attempts'>,
  signal: OutboxSendSignal,
  nowISO: string,
  maxAttempts: number = CONFIRMATION_EMAIL_OUTBOX_MAX_ATTEMPTS,
): OutboxTaskResolution {
  if (signal.kind === 'sent' || signal.kind === 'already-satisfied') {
    return { action: 'complete' };
  }
  if (signal.kind === 'skipped') {
    return { action: 'fail', attempts: task.attempts, lastError: `skipped: ${signal.reason}`, alert: false };
  }
  const attempts = task.attempts + 1;
  if (isConfirmationEmailOutboxExhausted(attempts, maxAttempts)) {
    return { action: 'fail', attempts, lastError: signal.error, alert: true };
  }
  return {
    action: 'retry',
    attempts,
    nextAttemptAt: nextConfirmationEmailAttemptAt(attempts, nowISO),
    lastError: signal.error,
  };
}

// Map the sender's return value (plus a durable-state probe) to a signal. Keeps
// the "did an email already happen?" decision in one audited place.
export function classifyConfirmationSenderResult(
  senderResult: { ok?: boolean; skipped?: boolean; error?: string | null; providerMessageId?: string | null } | null,
  durable: { hasSentDelivery: boolean; legacySentAt: string | null },
): OutboxSendSignal {
  if (senderResult && senderResult.ok && senderResult.providerMessageId) {
    return { kind: 'sent' };
  }
  if (durable.hasSentDelivery || (durable.legacySentAt && durable.legacySentAt.trim())) {
    return { kind: 'already-satisfied' };
  }
  if (senderResult && senderResult.skipped) {
    return { kind: 'skipped', reason: (senderResult.error || 'delivery not allowed in this environment').trim() };
  }
  if (senderResult && senderResult.ok && !senderResult.providerMessageId) {
    return { kind: 'transient-failure', error: 'Email provider did not return a message id.' };
  }
  if (senderResult && senderResult.error) {
    return { kind: 'transient-failure', error: senderResult.error };
  }
  // null: the claim was declined and no durable success exists yet (attempt
  // cooldown, or a race). Retry; the back-off outlasts the 5-minute cooldown.
  return { kind: 'transient-failure', error: 'Confirmation email claim was declined without a durable outcome.' };
}

// ---------------------------------------------------------------------------
// In-memory helpers (tests + the non-Postgres transaction() substrate)
// ---------------------------------------------------------------------------

export function enqueueConfirmationEmailInMemory(
  list: ConfirmationEmailOutboxRecord[],
  input: ConfirmationEmailObligationInput,
  nowISO: string,
  makeId: () => string,
): { outcome: 'created' | 'exists'; record: ConfirmationEmailOutboxRecord } {
  const emailType: ConfirmationEmailType = input.emailType || 'confirmation';
  const existing = list.find(
    (row) => row.registrationId === input.registrationId && row.emailType === emailType,
  );
  if (existing) return { outcome: 'exists', record: existing };
  const record: ConfirmationEmailOutboxRecord = {
    id: makeId(),
    registrationId: input.registrationId,
    eventId: input.eventId ?? null,
    emailType,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: nowISO,
    lockedAt: null,
    lockedBy: null,
    lastError: null,
    source: input.source ?? null,
    createdAt: nowISO,
    updatedAt: nowISO,
    processedAt: null,
  };
  list.push(record);
  return { outcome: 'created', record };
}

export function reclaimStaleConfirmationEmailOutboxInMemory(
  list: ConfirmationEmailOutboxRecord[],
  nowISO: string,
  leaseMs: number = CONFIRMATION_EMAIL_OUTBOX_LEASE_MS,
): number {
  const nowMs = new Date(nowISO).getTime();
  let reclaimed = 0;
  for (const row of list) {
    if (row.status !== 'processing' || !row.lockedAt) continue;
    if (nowMs - new Date(row.lockedAt).getTime() < leaseMs) continue;
    row.status = 'pending';
    row.lockedAt = null;
    row.lockedBy = null;
    row.nextAttemptAt = nowISO;
    row.updatedAt = nowISO;
    reclaimed += 1;
  }
  return reclaimed;
}

export function selectDueConfirmationEmailOutboxInMemory(
  list: ConfirmationEmailOutboxRecord[],
  nowISO: string,
  limit: number = CONFIRMATION_EMAIL_OUTBOX_BATCH_SIZE,
): ConfirmationEmailOutboxRecord[] {
  const nowMs = new Date(nowISO).getTime();
  return list
    .filter((row) => row.status === 'pending' && new Date(row.nextAttemptAt).getTime() <= nowMs)
    .sort((a, b) => {
      if (a.nextAttemptAt !== b.nextAttemptAt) return a.nextAttemptAt < b.nextAttemptAt ? -1 : 1;
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, Math.max(0, limit));
}

export function markConfirmationEmailOutboxProcessingInMemory(
  row: ConfirmationEmailOutboxRecord,
  nowISO: string,
  lockedBy: string,
): void {
  row.status = 'processing';
  row.lockedAt = nowISO;
  row.lockedBy = lockedBy;
  row.updatedAt = nowISO;
}

export function applyOutboxResolutionInMemory(
  row: ConfirmationEmailOutboxRecord,
  resolution: OutboxTaskResolution,
  nowISO: string,
): void {
  if (resolution.action === 'complete') {
    row.status = 'completed';
    row.lockedAt = null;
    row.lockedBy = null;
    row.processedAt = nowISO;
    row.updatedAt = nowISO;
    return;
  }
  if (resolution.action === 'retry') {
    row.status = 'pending';
    row.attempts = resolution.attempts;
    row.nextAttemptAt = resolution.nextAttemptAt;
    row.lockedAt = null;
    row.lockedBy = null;
    row.lastError = resolution.lastError;
    row.updatedAt = nowISO;
    return;
  }
  row.status = 'failed';
  row.attempts = resolution.attempts;
  row.lockedAt = null;
  row.lockedBy = null;
  row.lastError = resolution.lastError;
  row.processedAt = nowISO;
  row.updatedAt = nowISO;
}

import { createHash } from 'node:crypto';

// EMAIL-OPS-003 Stage 2 - provider delivery lifecycle: pure, deterministic
// domain logic. NO I/O. The Postgres ingestion wiring lives in
// server/database.ts; the endpoint in server/index.ts.
//
// This layer is SEPARATE from:
//   - run-email-outbox.status  (the "a paid registration is owed an email"
//     operational obligation), and
//   - run-email-deliveries.status = attempting|sent|failed  (the SEND
//     ACCEPTANCE ledger: "Resend accepted POST /emails and returned an id").
//
// "provider_lifecycle" answers a different question: what did Resend tell us
// happened to the message AFTER acceptance. `null` means "no provider event yet
// - at most our own acceptance ledger's 'sent'".

// ---------------------------------------------------------------------------
// Recognized event types (OFFICIAL RESEND CONTRACT, EMAIL-OPS-003 Stage 1).
// Re-confirm against the live portal in Stage 3; unknown-but-verified events
// must be tolerated, never crash ingestion.
// ---------------------------------------------------------------------------
export const RESEND_LIFECYCLE_EVENT_TYPES = [
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.complained',
  'email.failed',
  'email.suppressed',
] as const;
export type ResendLifecycleEventType = (typeof RESEND_LIFECYCLE_EVENT_TYPES)[number];

export type ProviderLifecycle =
  | 'sent'
  | 'delivery_delayed'
  | 'delivered'
  | 'bounced'
  | 'complained'
  | 'failed'
  | 'suppressed';

export type ReasonCategory =
  | 'accepted'
  | 'delivered'
  | 'delayed'
  | 'hard'
  | 'soft'
  | 'complaint'
  | 'failed'
  | 'suppressed'
  | 'unknown';

const EVENT_TO_LIFECYCLE: Record<ResendLifecycleEventType, ProviderLifecycle> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delivery_delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.failed': 'failed',
  'email.suppressed': 'suppressed',
};

// Deterministic tiebreak for events that share a provider timestamp: a later
// stage in the natural progression sorts later.
const EVENT_ORDER: Record<ResendLifecycleEventType, number> = {
  'email.sent': 1,
  'email.delivery_delayed': 2,
  'email.delivered': 3,
  'email.failed': 4,
  'email.bounced': 5,
  'email.suppressed': 6,
  'email.complained': 7,
};

type Terminality = 'progress' | 'success' | 'failure' | 'complaint';
const TERMINALITY: Record<ProviderLifecycle, Terminality> = {
  sent: 'progress',
  delivery_delayed: 'progress',
  delivered: 'success',
  bounced: 'failure',
  failed: 'failure',
  suppressed: 'failure',
  complained: 'complaint',
};
const PROGRESS_RANK: Record<'sent' | 'delivery_delayed', number> = { sent: 1, delivery_delayed: 2 };
// Fixed severity order among terminal failures, applied ONLY to break a tie when
// two failure events carry the same provider timestamp.
const FAILURE_SEVERITY: Record<'failed' | 'bounced' | 'suppressed', number> = { failed: 1, bounced: 2, suppressed: 3 };

export function candidateLifecycleForEvent(eventType: string): ProviderLifecycle | null {
  return (EVENT_TO_LIFECYCLE as Record<string, ProviderLifecycle | undefined>)[eventType] ?? null;
}

export function isRecognizedLifecycleEvent(eventType: string): eventType is ResendLifecycleEventType {
  return (RESEND_LIFECYCLE_EVENT_TYPES as readonly string[]).includes(eventType);
}

export function reasonCategoryForLifecycle(lifecycle: ProviderLifecycle, bounceHint?: ReasonCategory | null): ReasonCategory {
  switch (lifecycle) {
    case 'sent': return 'accepted';
    case 'delivery_delayed': return 'delayed';
    case 'delivered': return 'delivered';
    case 'complained': return 'complaint';
    case 'failed': return 'failed';
    case 'suppressed': return 'suppressed';
    case 'bounced': return bounceHint === 'hard' || bounceHint === 'soft' ? bounceHint : 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Deterministic lifecycle derivation.
//
// The derived state is a PURE FUNCTION OF THE SET of provider events seen for a
// delivery - never of their arrival order. Ingestion re-folds from the full
// stored history each time, sorted by (provider_created_at, EVENT_ORDER), so a
// duplicate, an out-of-order delivery, or a delayed event all converge to the
// same answer.
// ---------------------------------------------------------------------------
export type LifecycleEventInput = { eventType: string; providerCreatedAt: string };

function step(acc: ProviderLifecycle | null, next: ProviderLifecycle, accAt: string | null, nextAt: string): ProviderLifecycle {
  // complaint is absorbing - the strongest statement about the recipient.
  if (acc === 'complained') return acc;
  if (next === 'complained') return 'complained';

  if (acc === null) return next;

  const accT = TERMINALITY[acc];
  const nextT = TERMINALITY[next];

  if (accT === 'failure') {
    // A terminal failure is sticky (only `complained`, handled above, escalates
    // it). This deliberately protects the wrong-email correction flow: a bounce
    // must persist until a human corrects the address and an explicit resend
    // creates a NEW provider_message_id with its own fresh lifecycle.
    if (nextT === 'failure') {
      // input is time-sorted, so `next` is same-or-later; keep the first
      // failure's label, unless the timestamps are equal - then a fixed
      // severity order keeps the result order-independent.
      if (nextAt === accAt) {
        return FAILURE_SEVERITY[next as 'failed' | 'bounced' | 'suppressed']
          > FAILURE_SEVERITY[acc as 'failed' | 'bounced' | 'suppressed']
          ? next
          : acc;
      }
      return acc;
    }
    return acc;
  }

  if (accT === 'success') {
    // delivered: a strictly later failure supersedes; nothing weaker does.
    if (nextT === 'failure' && nextAt > (accAt ?? '')) return next;
    return acc;
  }

  // acc is progress (sent | delivery_delayed)
  if (nextT !== 'progress') return next; // any terminal outcome wins over in-progress
  const a = PROGRESS_RANK[acc as 'sent' | 'delivery_delayed'];
  const b = PROGRESS_RANK[next as 'sent' | 'delivery_delayed'];
  return b > a ? next : acc;
}

export function deriveLifecycleFromEvents(events: LifecycleEventInput[]): {
  lifecycle: ProviderLifecycle | null;
  lifecycleAt: string | null;
} {
  const mapped = events
    .map((event) => ({
      lifecycle: candidateLifecycleForEvent(event.eventType),
      at: String(event.providerCreatedAt || ''),
      order: EVENT_ORDER[event.eventType as ResendLifecycleEventType] ?? 99,
    }))
    .filter((entry): entry is { lifecycle: ProviderLifecycle; at: string; order: number } => entry.lifecycle !== null)
    .sort((a, b) => (a.at !== b.at ? (a.at < b.at ? -1 : 1) : a.order - b.order));

  let lifecycle: ProviderLifecycle | null = null;
  let lifecycleAt: string | null = null;
  for (const entry of mapped) {
    const nextLifecycle = step(lifecycle, entry.lifecycle, lifecycleAt, entry.at);
    if (nextLifecycle !== lifecycle) {
      lifecycle = nextLifecycle;
      lifecycleAt = entry.at;
    } else if (lifecycle !== null && lifecycleAt === null) {
      lifecycleAt = entry.at;
    }
  }
  return { lifecycle, lifecycleAt };
}

// ---------------------------------------------------------------------------
// Defensive event normalization (EMAIL-OPS-003 Stage 1 section 16 / Stage 2
// section 16). DO NOT invent Resend payload fields. Persist only what the
// currently verified official contract guarantees: type, data.email_id,
// data.created_at, and a free-text bounce message when present. bounce.type /
// bounce.subType and the email.failed reason path are pinned in Stage 3 against
// a real signed fixture.
// ---------------------------------------------------------------------------
const EMAIL_LIKE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// eslint-disable-next-line no-control-regex
// control characters (C0 range plus DEL) collapsed to a space
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]+', 'g');

export function maskEmailLike(value: string): string {
  return value.replace(EMAIL_LIKE, '[email]');
}

export function sanitizeReasonDetail(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'string' ? value : (() => {
    try { return JSON.stringify(value); } catch { return String(value); }
  })();
  const cleaned = maskEmailLike(text).replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.slice(0, 500);
}

// Conservative bounce classification. Anything not clearly permanent/transient
// from the guaranteed free-text stays 'unknown' - an operator reviews it. We
// never burn a contact by guessing 'hard'.
export function classifyBounceReason(bounce: { type?: unknown; subType?: unknown; message?: unknown } | null | undefined): {
  category: 'hard' | 'soft' | 'unknown';
  detail: string | null;
} {
  const detail = sanitizeReasonDetail(bounce?.message ?? bounce ?? null);
  const type = typeof bounce?.type === 'string' ? bounce.type.toLowerCase() : '';
  const subType = typeof bounce?.subType === 'string' ? bounce.subType.toLowerCase() : '';
  const haystack = `${type} ${subType} ${(detail || '').toLowerCase()}`;

  if (/\bpermanent\b|\bhard\b|does not exist|no such user|user unknown|invalid recipient|mailbox unavailable|domain not found/.test(haystack)) {
    return { category: 'hard', detail };
  }
  if (/\btransient\b|\bsoft\b|temporary|mailbox full|quota|try again|rate limit|greylist/.test(haystack)) {
    return { category: 'soft', detail };
  }
  return { category: 'unknown', detail };
}

export type NormalizedProviderEvent =
  | {
      kind: 'lifecycle';
      eventType: ResendLifecycleEventType;
      emailId: string;
      providerCreatedAt: string;
      lifecycle: ProviderLifecycle;
      reasonCategory: ReasonCategory;
      reasonDetail: string | null;
    }
  | { kind: 'ignored'; eventType: string; reason: 'unrecognized_type' | 'missing_email_id' };

export function normalizeResendWebhookEvent(payload: unknown): NormalizedProviderEvent {
  const root = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const eventType = typeof root.type === 'string' ? root.type : '';
  const data = (root.data && typeof root.data === 'object' ? root.data : {}) as Record<string, unknown>;

  if (!isRecognizedLifecycleEvent(eventType)) {
    return { kind: 'ignored', eventType: eventType || 'unknown', reason: 'unrecognized_type' };
  }

  const emailId = typeof data.email_id === 'string' ? data.email_id.trim() : '';
  if (!emailId) {
    return { kind: 'ignored', eventType, reason: 'missing_email_id' };
  }

  const providerCreatedAt = typeof data.created_at === 'string' && data.created_at.trim()
    ? data.created_at.trim()
    : typeof root.created_at === 'string' && root.created_at.trim()
      ? root.created_at.trim()
      : new Date(0).toISOString();

  const lifecycle = EVENT_TO_LIFECYCLE[eventType];

  let reasonCategory: ReasonCategory = reasonCategoryForLifecycle(lifecycle);
  let reasonDetail: string | null = null;

  if (eventType === 'email.bounced') {
    const bounce = (data.bounce && typeof data.bounce === 'object' ? data.bounce : null) as
      | { type?: unknown; subType?: unknown; message?: unknown }
      | null;
    const classified = classifyBounceReason(bounce);
    reasonCategory = classified.category; // 'hard' | 'soft' | 'unknown'
    reasonDetail = classified.detail;
  } else if (eventType === 'email.failed') {
    const failed = (data.failed && typeof data.failed === 'object' ? data.failed : null) as { reason?: unknown } | null;
    reasonDetail = sanitizeReasonDetail(failed?.reason ?? (data as { reason?: unknown }).reason ?? null);
  } else if (eventType === 'email.suppressed') {
    reasonDetail = sanitizeReasonDetail((data as { reason?: unknown }).reason ?? null);
  }

  return { kind: 'lifecycle', eventType, emailId, providerCreatedAt, lifecycle, reasonCategory, reasonDetail };
}

export function digestWebhookBody(rawBody: string): string {
  return createHash('sha256').update(rawBody, 'utf8').digest('hex');
}

// Alert routing (EMAIL-OPS-003 Stage 2 section 23). Participant-specific vs
// system anomaly - nothing for normal sent/delivered, nothing per duplicate
// retry.
export function isParticipantActionLifecycle(lifecycle: ProviderLifecycle): boolean {
  return lifecycle === 'bounced' || lifecycle === 'complained' || lifecycle === 'suppressed';
}

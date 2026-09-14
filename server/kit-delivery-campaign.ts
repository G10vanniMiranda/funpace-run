// KIT-DELIVERY-EMAIL-001 — batch orchestration. NOT wired to any HTTP route
// or cron in this stage (local candidate only, per the brief). Dependency-
// injected so it's fully unit-testable without touching Postgres or Resend —
// mirrors the existing dependency-injection pattern already used by
// processGoogleSheetSyncBacklog / queueConfirmedPaymentGoogleSheetSync.
import {
  claimEventCampaignEmailInPostgres,
  completeEventCampaignEmailInPostgres,
  type EventCampaignAudienceEntry,
} from './database.js';
import {
  sendKitDeliveryEmail,
  KIT_DELIVERY_CAMPAIGN_KEY,
} from './kit-delivery-email.js';

// --- batch strategy ---------------------------------------------------------
/** Recipients claimed+sent per invocation of runKitDeliveryCampaignBatch. */
export const KIT_DELIVERY_BATCH_SIZE = 25;
/**
 * Strictly sequential (1) — Resend has no documented burst tolerance worth
 * racing against for an operational campaign, and sequential sends keep the
 * per-recipient audit trail trivially ordered and the batch trivially
 * resumable (the next invocation just re-reads the audience: anyone already
 * `sent` is excluded, anyone `failed` is retried, anyone still eligible is
 * attempted — no cursor/offset state to persist).
 */
export const KIT_DELIVERY_CONCURRENCY = 1;
/**
 * STOP CONDITION for a systemic failure: N consecutive non-skip failures
 * (provider rejections / transient errors, NOT idempotent skips) abort the
 * rest of THIS batch run without touching further recipients — an
 * unconfigured provider or a Resend outage should not burn through the whole
 * audience one row at a time. A subsequent batch run retries every `failed`
 * row (see the claim primitive's "latest wins" rule) once the underlying
 * issue is fixed.
 */
export const KIT_DELIVERY_MAX_CONSECUTIVE_FAILURES = 5;
/**
 * Requires EXPLICIT operational execution — never true automatically. This
 * module exposes no cron/route wiring at all in this stage; the constant only
 * documents the intent for whoever eventually wires an entrypoint.
 */
export const KIT_DELIVERY_REQUIRES_EXPLICIT_EXECUTION = true;

export type KitDeliveryRowOutcome =
  | { registrationId: string; outcome: 'sent'; providerMessageId?: string; deliveryId: string }
  | { registrationId: string; outcome: 'failed'; reason: string; deliveryId?: string }
  | { registrationId: string; outcome: 'skipped'; reason: 'already_sent' | 'in_progress' | 'not_eligible' | 'not_found' };

export type KitDeliveryBatchOutcome = {
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
  stoppedEarly: boolean;
  stopReason: string | null;
  rows: KitDeliveryRowOutcome[];
};

export type KitDeliverySendResult = { ok: boolean; provider: string; providerMessageId?: string; skipped?: boolean; error?: string };

export async function runKitDeliveryCampaignBatch(input: {
  /** the slice of the audience to process THIS invocation — caller owns pagination/batching. */
  recipients: EventCampaignAudienceEntry[];
  audit: { actor: string; actorRole: string | null; sessionId: string | null; ipAddress: string | null; userAgent: string | null };
  maxConsecutiveFailures?: number;
  dependencies?: {
    claim?: typeof claimEventCampaignEmailInPostgres;
    complete?: typeof completeEventCampaignEmailInPostgres;
    send?: (recipient: { registrationId: string; fullName: string; email: string; deliveryKey: string }) => Promise<KitDeliverySendResult>;
    now?: () => string;
  };
}): Promise<KitDeliveryBatchOutcome> {
  const claim = input.dependencies?.claim || claimEventCampaignEmailInPostgres;
  const complete = input.dependencies?.complete || completeEventCampaignEmailInPostgres;
  const send = input.dependencies?.send || sendKitDeliveryEmail;
  const now = input.dependencies?.now || (() => new Date().toISOString());
  const maxConsecutiveFailures = input.maxConsecutiveFailures ?? KIT_DELIVERY_MAX_CONSECUTIVE_FAILURES;

  const rows: KitDeliveryRowOutcome[] = [];
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let consecutiveFailures = 0;
  let stoppedEarly = false;
  let stopReason: string | null = null;

  for (const recipient of input.recipients) {
    if (stoppedEarly) break;

    const auditBase = {
      actor: input.audit.actor, actorRole: input.audit.actorRole,
      sessionId: input.audit.sessionId, ipAddress: input.audit.ipAddress, userAgent: input.audit.userAgent,
    };

    let claimResult;
    try {
      claimResult = await claim({
        registrationId: recipient.registrationId,
        campaignKey: KIT_DELIVERY_CAMPAIGN_KEY,
        provider: 'resend',
        audit: { ...auditBase, createdAt: now() },
      });
    } catch (error) {
      // A claim-transaction failure (DB hiccup) is a single-row failure —
      // it never aborts the rest of the batch, only counts toward the
      // systemic-failure stop condition below.
      failed += 1;
      consecutiveFailures += 1;
      rows.push({ registrationId: recipient.registrationId, outcome: 'failed', reason: error instanceof Error ? error.message.slice(0, 200) : 'claim_failed' });
      if (consecutiveFailures >= maxConsecutiveFailures) { stoppedEarly = true; stopReason = 'max_consecutive_failures'; }
      continue;
    }

    if (claimResult.status !== 'ok') {
      skipped += 1;
      consecutiveFailures = 0; // an idempotent skip is not a systemic failure signal
      const reason: 'already_sent' | 'in_progress' | 'not_eligible' | 'not_found' =
        claimResult.status === 'not_eligible' ? 'not_eligible' : claimResult.status;
      rows.push({ registrationId: recipient.registrationId, outcome: 'skipped', reason });
      continue;
    }

    const { deliveryId } = claimResult;
    let result: KitDeliverySendResult;
    try {
      result = await send({
        registrationId: recipient.registrationId, fullName: claimResult.fullName,
        email: claimResult.recipientEmail, deliveryKey: claimResult.deliveryKey,
      });
    } catch (error) {
      result = { ok: false, provider: 'unknown', error: error instanceof Error ? error.message.slice(0, 200) : 'send_threw' };
    }

    await complete(deliveryId, result, auditBase);

    if (result.ok) {
      sent += 1;
      consecutiveFailures = 0;
      rows.push({ registrationId: recipient.registrationId, outcome: 'sent', providerMessageId: result.providerMessageId, deliveryId });
    } else {
      failed += 1;
      consecutiveFailures += 1;
      rows.push({ registrationId: recipient.registrationId, outcome: 'failed', reason: result.error || 'send_failed', deliveryId });
      if (consecutiveFailures >= maxConsecutiveFailures) { stoppedEarly = true; stopReason = 'max_consecutive_failures'; }
    }
  }

  return { attempted: rows.length, sent, failed, skipped, stoppedEarly, stopReason, rows };
}

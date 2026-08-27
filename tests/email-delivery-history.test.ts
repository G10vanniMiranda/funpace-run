import assert from 'node:assert/strict';
import test from 'node:test';
import type { Database, GoogleSheetSyncRecord } from '../server/database.js';
import {
  buildLegacyEmailSummaryPatch,
  buildEmailDeliveryIdempotencyKey,
  canClaimEmailDeliveryAfterLegacySummary,
  isLatestEmailDelivery,
  summarizeEmailDeliveryBackfill,
  upsertEmailDeliveryOutboxInMemory,
  buildLegacyEmailDeliveryCandidate,
  claimEmailDeliveryInMemory,
  completeEmailDeliveryInMemory,
  hashEmailRecipient,
  type EmailDeliveryRecord,
} from '../server/email-delivery-history.js';
import {
  buildEmailDeliverySheetRow,
  executeGoogleSheetSyncTask,
  GOOGLE_SHEET_HEADERS,
  LEGACY_EMAIL_SHEET_HEADERS,
  type GoogleSheetsClient,
} from '../server/google-sheets.js';

const REGISTRATION_ID = 'registration-transfer';
const FIRST_EMAIL = 'geane@example.com';
const SECOND_EMAIL = 'recipient-two@example.com';
const NOW = '2026-08-25T12:00:00.000Z';

test('explicit stable context bypasses only the legacy sent-summary guard', () => {
  assert.equal(canClaimEmailDeliveryAfterLegacySummary({
    legacySentAt: '2026-08-20T12:02:00.000Z',
    force: false,
    contextKey: 'participant-transfer',
  }), true);
  assert.equal(canClaimEmailDeliveryAfterLegacySummary({
    legacySentAt: '2026-08-20T12:02:00.000Z',
    force: false,
    contextKey: null,
  }), false);
  assert.equal(canClaimEmailDeliveryAfterLegacySummary({
    legacySentAt: '2026-08-20T12:02:00.000Z',
    force: false,
    contextKey: null,
    existingDelivery: true,
  }), true);
});

test('latest delivery ordering prevents older and same-millisecond completions from replacing its summary', () => {
  const attempts = [
    { id: 'delivery-a', attemptedAt: NOW, createdAt: NOW },
    { id: 'delivery-b', attemptedAt: NOW, createdAt: NOW },
  ];
  assert.equal(isLatestEmailDelivery(attempts, 'delivery-a'), false);
  assert.equal(isLatestEmailDelivery(attempts, 'delivery-b'), true);
});

test('delivery completion creates one idempotent in-memory outbox task', () => {
  const tasks: Parameters<typeof upsertEmailDeliveryOutboxInMemory>[0] = [];
  const first = upsertEmailDeliveryOutboxInMemory(tasks, 'delivery-1', NOW);
  const replay = upsertEmailDeliveryOutboxInMemory(tasks, 'delivery-1', '2026-08-25T12:05:00.000Z');

  assert.equal(tasks.length, 1);
  assert.equal(replay.id, first.id);
  assert.equal(replay.entityType, 'email_delivery');
  assert.equal(replay.entityId, 'delivery-1');
  assert.equal(replay.sheetName, 'emails');
  assert.equal(replay.status, 'pending');
});

test('latest failed delivery summary clears fields from an earlier successful delivery', () => {
  const patch = buildLegacyEmailSummaryPatch({
    ok: false,
    provider: 'resend',
    error: 'latest delivery failed',
  }, '2026-08-25T13:02:00.000Z');

  assert.deepEqual(patch, {
    confirmationEmailSentAt: null,
    confirmationEmailProvider: 'resend',
    confirmationEmailId: null,
    confirmationEmailError: 'latest delivery failed',
  });
});

function task(deliveryId: string): GoogleSheetSyncRecord {
  return {
    id: `task-${deliveryId}`,
    entityType: 'email_delivery',
    entityId: deliveryId,
    sheetName: 'emails',
    operation: 'upsert',
    status: 'processing',
    rowNumber: null,
    attempts: 1,
    lastAttemptAt: NOW,
    synchronizedAt: null,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function database(deliveries: EmailDeliveryRecord[]): Database {
  return {
    events: [], distances: [], lots: [], registrations: [], payments: [], paymentEvents: [],
    emailDeliveries: deliveries, googleSheetSyncs: [], checkIns: [], kitDeliveries: [], auditLogs: [],
    adminSessions: [], adminUsers: [], partnershipLeads: [], partners: [],
  };
}

test('creates one delivery and blocks a duplicate claim during cooldown', () => {
  const deliveries: EmailDeliveryRecord[] = [];
  const first = claimEmailDeliveryInMemory(deliveries, {
    registrationId: REGISTRATION_ID, kind: 'confirmation', recipientEmail: FIRST_EMAIL, provider: 'resend',
  }, NOW);
  const duplicate = claimEmailDeliveryInMemory(deliveries, {
    registrationId: REGISTRATION_ID, kind: 'confirmation', recipientEmail: FIRST_EMAIL.toUpperCase(), provider: 'resend',
  }, '2026-08-25T12:01:00.000Z');

  assert.equal(first.outcome, 'claimed');
  assert.equal(duplicate.outcome, 'in_progress');
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].recipientHash, hashEmailRecipient(FIRST_EMAIL));
});

test('marks a successful delivery sent and prevents duplicate send', () => {
  const deliveries: EmailDeliveryRecord[] = [];
  const claim = claimEmailDeliveryInMemory(deliveries, {
    registrationId: REGISTRATION_ID, kind: 'confirmation', recipientEmail: FIRST_EMAIL, provider: 'resend',
  }, NOW);
  assert.equal(claim.outcome, 'claimed');
  if (claim.outcome !== 'claimed') return;
  completeEmailDeliveryInMemory(claim.delivery, { ok: true, provider: 'resend', providerMessageId: 'message-first' }, '2026-08-25T12:02:00.000Z');
  const duplicate = claimEmailDeliveryInMemory(deliveries, {
    registrationId: REGISTRATION_ID, kind: 'confirmation', recipientEmail: FIRST_EMAIL, provider: 'resend',
  }, '2026-08-25T12:10:00.000Z');

  assert.equal(duplicate.outcome, 'already_sent');
  assert.equal(deliveries[0].status, 'sent');
  assert.equal(deliveries[0].providerMessageId, 'message-first');
});

test('retries a failed delivery with the same delivery and idempotency identities', () => {
  const deliveries: EmailDeliveryRecord[] = [];
  const first = claimEmailDeliveryInMemory(deliveries, {
    registrationId: REGISTRATION_ID, kind: 'confirmation', recipientEmail: FIRST_EMAIL, provider: 'resend',
  }, NOW);
  assert.equal(first.outcome, 'claimed');
  if (first.outcome !== 'claimed') return;
  const originalId = first.delivery.id;
  const originalKey = first.delivery.idempotencyKey;
  completeEmailDeliveryInMemory(first.delivery, { ok: false, provider: 'resend', error: 'temporary failure' }, '2026-08-25T12:02:00.000Z');
  const retry = claimEmailDeliveryInMemory(deliveries, {
    registrationId: REGISTRATION_ID, kind: 'confirmation', recipientEmail: FIRST_EMAIL, provider: 'resend',
  }, '2026-08-25T12:03:00.000Z');

  assert.equal(retry.outcome, 'claimed');
  if (retry.outcome !== 'claimed') return;
  assert.equal(retry.created, false);
  assert.equal(retry.delivery.id, originalId);
  assert.equal(retry.delivery.idempotencyKey, originalKey);
  assert.equal(retry.delivery.attemptCount, 2);
});

test('synthetic second-recipient sentinel preserves the first delivery and creates a distinct second delivery', () => {
  const deliveries: EmailDeliveryRecord[] = [];
  const historical = claimEmailDeliveryInMemory(deliveries, {
    registrationId: REGISTRATION_ID, kind: 'confirmation', recipientEmail: FIRST_EMAIL, provider: 'resend',
  }, NOW);
  assert.equal(historical.outcome, 'claimed');
  if (historical.outcome !== 'claimed') return;
  completeEmailDeliveryInMemory(historical.delivery, { ok: true, provider: 'resend', providerMessageId: 'message-geane' }, '2026-08-25T12:02:00.000Z');

  const current = claimEmailDeliveryInMemory(deliveries, {
    registrationId: REGISTRATION_ID, kind: 'confirmation', recipientEmail: SECOND_EMAIL, provider: 'resend',
  }, '2026-08-25T13:00:00.000Z');
  assert.equal(current.outcome, 'claimed');
  if (current.outcome !== 'claimed') return;
  completeEmailDeliveryInMemory(current.delivery, { ok: true, provider: 'resend', providerMessageId: 'message-recipient-two' }, '2026-08-25T13:02:00.000Z');

  assert.equal(deliveries.length, 2);
  assert.notEqual(deliveries[0].id, deliveries[1].id);
  assert.notEqual(deliveries[0].idempotencyKey, deliveries[1].idempotencyKey);
  assert.equal(deliveries[0].recipientEmail, FIRST_EMAIL);
  assert.equal(deliveries[0].providerMessageId, 'message-geane');
  assert.equal(deliveries[1].recipientEmail, SECOND_EMAIL);
  assert.equal(deliveries[1].providerMessageId, 'message-recipient-two');
});

test('explicit context permits a later legitimate communication while keeping accidental retries stable', () => {
  const first = buildEmailDeliveryIdempotencyKey({ registrationId: REGISTRATION_ID, kind: 'confirmation', recipientEmail: SECOND_EMAIL });
  const duplicate = buildEmailDeliveryIdempotencyKey({ registrationId: REGISTRATION_ID, kind: 'confirmation', recipientEmail: SECOND_EMAIL.toUpperCase() });
  const laterContext = buildEmailDeliveryIdempotencyKey({ registrationId: REGISTRATION_ID, kind: 'confirmation', recipientEmail: SECOND_EMAIL, contextKey: 'participant-transfer-v2' });
  assert.equal(first, duplicate);
  assert.notEqual(first, laterContext);
});

test('legacy backfill prefers the audited historical recipient over the current registration recipient', () => {
  const candidate = buildLegacyEmailDeliveryCandidate({
    registrationId: REGISTRATION_ID,
    currentRecipientEmail: SECOND_EMAIL,
    provider: 'resend',
    providerMessageId: 'message-geane',
    sentAt: '2026-08-20T12:02:00.000Z',
    lastAttemptAt: '2026-08-20T12:00:00.000Z',
    error: null,
  }, [{ action: 'email.confirmation.attempted', createdAt: '2026-08-20T12:00:00.000Z', payload: { email: FIRST_EMAIL } }]);

  assert.ok(candidate);
  assert.equal(candidate.recipientEmail, FIRST_EMAIL);
  assert.equal(candidate.metadata.recipientSource, 'audit');
  assert.equal(candidate.providerMessageId, 'message-geane');
});

test('legacy backfill uses the latest failed audit instead of a stale successful summary', () => {
  const candidate = buildLegacyEmailDeliveryCandidate({
    registrationId: REGISTRATION_ID,
    currentRecipientEmail: SECOND_EMAIL,
    provider: 'resend',
    providerMessageId: 'message-first',
    sentAt: '2026-08-20T12:02:00.000Z',
    lastAttemptAt: '2026-08-25T13:00:00.000Z',
    error: 'latest delivery failed',
  }, [
    { action: 'email.confirmation.attempted', createdAt: '2026-08-20T12:00:00.000Z', payload: { email: FIRST_EMAIL } },
    { action: 'email.confirmation.sent', createdAt: '2026-08-20T12:02:00.000Z', payload: { provider: 'resend', providerMessageId: 'message-first' } },
    { action: 'email.confirmation.attempted', createdAt: '2026-08-25T13:00:00.000Z', payload: { email: SECOND_EMAIL } },
    { action: 'email.confirmation.failed', createdAt: '2026-08-25T13:02:00.000Z', payload: { provider: 'resend', error: 'latest delivery failed' } },
  ]);

  assert.ok(candidate);
  assert.equal(candidate.status, 'failed');
  assert.equal(candidate.recipientEmail, SECOND_EMAIL);
  assert.equal(candidate.providerMessageId, null);
  assert.equal(candidate.sentAt, null);
  assert.equal(candidate.failedAt, '2026-08-25T13:02:00.000Z');
  assert.equal(candidate.error, 'latest delivery failed');
});

test('backfill summary counts candidates, duplicate keys and existing-delivery collisions', () => {
  const summary = summarizeEmailDeliveryBackfill([
    {
      idempotencyKey: 'key-a',
      provider: 'resend',
      providerMessageId: 'message-a',
      metadata: { recipientSource: 'audit' },
    },
    {
      idempotencyKey: 'key-a',
      provider: 'resend',
      providerMessageId: 'message-a',
      metadata: { recipientSource: 'registration_fallback' },
    },
    {
      idempotencyKey: 'key-b',
      provider: 'resend',
      providerMessageId: 'message-b',
      metadata: { recipientSource: 'registration_fallback' },
    },
  ], [{
    idempotencyKey: 'key-b',
    provider: 'resend',
    providerMessageId: 'message-b',
  }], 4);

  assert.deepEqual(summary, {
    candidates: 3,
    recipientFromAudit: 1,
    recipientFallback: 2,
    candidateIdempotency: 1,
    candidateProviderMessage: 1,
    existingIdempotency: 1,
    existingProviderMessage: 1,
    ambiguous: 1,
    verdict: 'REVIEW REQUIRED',
  });
});

test('builds an eight-column delivery row keyed by delivery id', () => {
  const deliveries: EmailDeliveryRecord[] = [];
  const claim = claimEmailDeliveryInMemory(deliveries, {
    registrationId: REGISTRATION_ID, kind: 'confirmation', recipientEmail: SECOND_EMAIL, provider: 'resend',
  }, NOW);
  assert.equal(claim.outcome, 'claimed');
  if (claim.outcome !== 'claimed') return;
  completeEmailDeliveryInMemory(claim.delivery, { ok: true, provider: 'resend', providerMessageId: 'message-new' }, '2026-08-25T12:02:00.000Z');
  const row = buildEmailDeliverySheetRow(claim.delivery);
  assert.equal(row.length, 8);
  assert.equal(row[1], REGISTRATION_ID);
  assert.equal(row[2], SECOND_EMAIL);
  assert.equal(row[7], claim.delivery.id);
});

test('syncs distinct deliveries as distinct sheet keys without overwriting history', async () => {
  const deliveries: EmailDeliveryRecord[] = [];
  for (const [recipientEmail, messageId] of [[FIRST_EMAIL, 'message-first'], [SECOND_EMAIL, 'message-second']] as const) {
    const claim = claimEmailDeliveryInMemory(deliveries, {
      registrationId: REGISTRATION_ID, kind: 'confirmation', recipientEmail, provider: 'resend',
    }, NOW);
    assert.equal(claim.outcome, 'claimed');
    if (claim.outcome === 'claimed') completeEmailDeliveryInMemory(claim.delivery, { ok: true, provider: 'resend', providerMessageId: messageId }, NOW);
  }
  const keys: string[] = [];
  const client = {
    getValues: async () => ({ values: [GOOGLE_SHEET_HEADERS.emails] }),
    upsertRow: async (_sheet: string, _row: unknown, keyColumn: number, key: string) => {
      assert.equal(keyColumn, 7);
      keys.push(key);
      return { action: 'created' as const, rowNumber: keys.length + 1 };
    },
  } as unknown as GoogleSheetsClient;

  await executeGoogleSheetSyncTask(task(deliveries[0].id), database(deliveries), client);
  await executeGoogleSheetSyncTask(task(deliveries[1].id), database(deliveries), client);
  assert.deepEqual(keys, deliveries.map((item) => item.id));
  assert.equal(new Set(keys).size, 2);
});

test('refuses delivery sync while the real sheet still has the legacy header', async () => {
  const deliveries: EmailDeliveryRecord[] = [];
  const claim = claimEmailDeliveryInMemory(deliveries, {
    registrationId: REGISTRATION_ID, kind: 'confirmation', recipientEmail: SECOND_EMAIL, provider: 'resend',
  }, NOW);
  assert.equal(claim.outcome, 'claimed');
  if (claim.outcome !== 'claimed') return;
  const client = {
    getValues: async () => ({ values: [LEGACY_EMAIL_SHEET_HEADERS] }),
    upsertRow: async () => assert.fail('legacy header must block before write'),
  } as unknown as GoogleSheetsClient;
  await assert.rejects(
    executeGoogleSheetSyncTask(task(claim.delivery.id), database(deliveries), client),
    /sheet migration is required/i,
  );
});

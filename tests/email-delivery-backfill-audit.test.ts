import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildEmailBackfillAuditReport,
  buildSafeHistoricalEmailCandidateSummary,
  classifyEmailHistoryGap,
  classifyHistoricalEmailEvidence,
  classifyProviderMessageCollision,
  planHistoricalEmailBackfill,
} from '../server/email-delivery-backfill-audit.js';

const ROLLOUT = '2026-08-25T12:00:00.000Z';
const provenAudits = (email: string, providerMessageId: string) => [
  { action: 'email.confirmation.attempted', createdAt: '2026-07-01T10:00:00.000Z', payload: { email } },
  { action: 'email.confirmation.sent', createdAt: '2026-07-01T10:00:05.000Z', payload: { providerMessageId, provider: 'resend' } },
];
const summaryOf = (over: Partial<Parameters<typeof classifyHistoricalEmailEvidence>[0]> = {}) => ({
  registrationId: 'reg-synthetic-1',
  currentRecipientEmail: 'current@synthetic.test',
  provider: 'resend',
  providerMessageId: 'pm-synthetic-1',
  sentAt: '2026-07-01T10:00:05.000Z',
  lastAttemptAt: '2026-07-01T10:00:00.000Z',
  error: null,
  ...over,
});

test('PROVEN: recipient carried by an attempt audit, never the current registration email', () => {
  const e = classifyHistoricalEmailEvidence(summaryOf(), provenAudits('historical@synthetic.test', 'pm-synthetic-1'));
  assert.equal(e.evidenceClass, 'PROVEN');
  assert.equal(e.recipientSource, 'attempt_audit');
  assert.equal(e.hasProviderMessageId, true);
});

test('registration_fallback alone is never PROVEN or RECOVERABLE', () => {
  const e = classifyHistoricalEmailEvidence(summaryOf(), []); // no audits at all
  assert.ok(['UNRESOLVED', 'AMBIGUOUS'].includes(e.evidenceClass));
  assert.notEqual(e.recipientSource, 'attempt_audit');
});

test('RECOVERABLE: single trustworthy recipient snapshot before completion', () => {
  const e = classifyHistoricalEmailEvidence(summaryOf(), [
    { action: 'email.confirmation.skipped', createdAt: '2026-07-01T09:59:00.000Z', payload: { email: 'snap@synthetic.test' } },
  ]);
  assert.equal(e.evidenceClass, 'RECOVERABLE');
  assert.equal(e.recipientSource, 'historical_snapshot');
  assert.equal(e.confidence, 'MEDIUM');
});

test('AMBIGUOUS: conflicting recipient snapshots', () => {
  const e = classifyHistoricalEmailEvidence(summaryOf(), [
    { action: 'email.pending.skipped', createdAt: '2026-07-01T09:58:00.000Z', payload: { email: 'a@synthetic.test' } },
    { action: 'email.confirmation.skipped', createdAt: '2026-07-01T09:59:00.000Z', payload: { email: 'b@synthetic.test' } },
  ]);
  assert.equal(e.evidenceClass, 'AMBIGUOUS');
});

test('AMBIGUOUS: identity change between the snapshot and completion', () => {
  const e = classifyHistoricalEmailEvidence(summaryOf(), [
    { action: 'email.confirmation.skipped', createdAt: '2026-07-01T09:00:00.000Z', payload: { email: 'snap@synthetic.test' } },
    { action: 'registration.updated', createdAt: '2026-07-01T09:30:00.000Z', payload: {} },
  ]);
  assert.equal(e.evidenceClass, 'AMBIGUOUS');
});

test('UNRESOLVED: legacy summary only, no recoverable recipient', () => {
  const e = classifyHistoricalEmailEvidence(
    summaryOf({ providerMessageId: null, currentRecipientEmail: 'current@synthetic.test' }),
    [],
  );
  assert.equal(e.evidenceClass, 'UNRESOLVED');
  assert.equal(e.recipientSource, 'none');
});

test('gap classification is relative to the history rollout, with a migration window', () => {
  assert.equal(classifyEmailHistoryGap({ completedAt: '2026-07-01T00:00:00.000Z', historyRolloutAt: ROLLOUT }), 'PRE_HISTORY_EXPECTED_BACKFILL');
  assert.equal(classifyEmailHistoryGap({ completedAt: '2026-09-01T00:00:00.000Z', historyRolloutAt: ROLLOUT }), 'POST_HISTORY_LIVE_FLOW_GAP');
  assert.equal(classifyEmailHistoryGap({ completedAt: '2026-08-25T13:00:00.000Z', historyRolloutAt: ROLLOUT }), 'MIGRATION_WINDOW');
  assert.equal(classifyEmailHistoryGap({ completedAt: null, historyRolloutAt: ROLLOUT }), 'AMBIGUOUS_TIMELINE');
});

test('provider-message collision classes', () => {
  const base = {
    candidateRegistrationId: 'reg-1', candidateRecipientHash: 'h1', candidateContextKey: 'ctx-a', candidateIdempotencyKey: 'ik-1',
  };
  assert.equal(classifyProviderMessageCollision({ ...base, existingSameProviderMessage: [] }), 'NONE');
  assert.equal(classifyProviderMessageCollision({ ...base, existingSameProviderMessage: [
    { registrationId: 'reg-1', recipientHash: 'h1', contextKey: 'ctx-b', idempotencyKey: 'ik-2' },
  ] }), 'LEGACY_CONTEXT_DRIFT');
  assert.equal(classifyProviderMessageCollision({ ...base, existingSameProviderMessage: [
    { registrationId: 'reg-2', recipientHash: 'h1', contextKey: 'ctx-a', idempotencyKey: 'ik-3' },
  ] }), 'TRANSFER_IDENTITY_CHANGE');
  assert.equal(classifyProviderMessageCollision({ ...base, existingSameProviderMessage: [
    { registrationId: 'reg-2', recipientHash: 'hX', contextKey: 'ctx-z', idempotencyKey: 'ik-4' },
    { registrationId: 'reg-3', recipientHash: 'hY', contextKey: 'ctx-y', idempotencyKey: 'ik-5' },
  ] }), 'DATA_INCONSISTENCY');
});

test('plan: only PROVEN + PRE_HISTORY + no-collision is a high-confidence planned insert', () => {
  const p = (over: Partial<Parameters<typeof planHistoricalEmailBackfill>[0]>) => planHistoricalEmailBackfill({
    evidenceClass: 'PROVEN', gapClass: 'PRE_HISTORY_EXPECTED_BACKFILL', collisionClass: 'NONE',
    hasExistingIdempotency: false, hasExistingDeliveryForRegistration: false, ...over,
  });
  assert.equal(p({}), 'PLANNED_INSERT_HIGH_CONFIDENCE');
  assert.equal(p({ hasExistingIdempotency: true }), 'NO_ACTION');
  assert.equal(p({ collisionClass: 'LEGACY_CONTEXT_DRIFT' }), 'REVIEW_REQUIRED');
  assert.equal(p({ gapClass: 'POST_HISTORY_LIVE_FLOW_GAP' }), 'HOLD_FOR_ROOT_CAUSE');
  assert.equal(p({ evidenceClass: 'RECOVERABLE' }), 'HUMAN_REVIEW_RECOMMENDED');
  assert.equal(p({ evidenceClass: 'AMBIGUOUS' }), 'DO_NOT_BACKFILL_AUTOMATICALLY');
  assert.equal(p({ evidenceClass: 'UNRESOLVED' }), 'DO_NOT_BACKFILL');
  assert.equal(p({ gapClass: 'MIGRATION_WINDOW' }), 'HUMAN_REVIEW_RECOMMENDED');
});

test('safe candidate summary carries only fingerprints and classes, no PII', () => {
  const s = buildSafeHistoricalEmailCandidateSummary({
    registrationId: 'reg-synthetic-9',
    summary: summaryOf({ registrationId: 'reg-synthetic-9' }),
    audits: provenAudits('historical@synthetic.test', 'pm-synthetic-1'),
    historyRolloutAt: ROLLOUT,
    hasExistingIdempotency: false,
    hasExistingDeliveryForRegistration: false,
    collisionClass: 'NONE',
  });
  assert.equal(s.candidateFingerprint.length, 12);
  assert.equal(s.evidenceClass, 'PROVEN');
  assert.equal(s.gapClass, 'PRE_HISTORY_EXPECTED_BACKFILL');
  assert.equal(s.planAction, 'PLANNED_INSERT_HIGH_CONFIDENCE');
  const serialized = JSON.stringify(s);
  assert.equal(serialized.includes('historical@synthetic.test'), false);
  assert.equal(serialized.includes('reg-synthetic-9'), false);
});

test('report tallies are deterministic and fingerprinted without timestamps', () => {
  const candidates = [
    buildSafeHistoricalEmailCandidateSummary({
      registrationId: 'r1', summary: summaryOf({ registrationId: 'r1' }),
      audits: provenAudits('h1@synthetic.test', 'pm1'),
      historyRolloutAt: ROLLOUT, hasExistingIdempotency: false, hasExistingDeliveryForRegistration: false, collisionClass: 'NONE',
    }),
    buildSafeHistoricalEmailCandidateSummary({
      registrationId: 'r2', summary: summaryOf({ registrationId: 'r2', providerMessageId: null }),
      audits: [],
      historyRolloutAt: ROLLOUT, hasExistingIdempotency: false, hasExistingDeliveryForRegistration: false, collisionClass: 'NONE',
    }),
  ];
  const a = buildEmailBackfillAuditReport({ registrationsTotal: 100, legacyEmailState: 40, alreadyHasHistory: 38, alreadyHasHistoryViaProviderMessage: 0, deliveryRows: 38, historyRolloutAt: ROLLOUT, candidates });
  const b = buildEmailBackfillAuditReport({ registrationsTotal: 100, legacyEmailState: 40, alreadyHasHistory: 38, alreadyHasHistoryViaProviderMessage: 0, deliveryRows: 38, historyRolloutAt: ROLLOUT, candidates: [...candidates].reverse() });
  assert.equal(a.classificationFingerprint, b.classificationFingerprint);
  assert.equal(a.evidence.PROVEN, 1);
  assert.equal(a.totals.noHistory, 2);
});

test('CLI refuses mutation-like flags and runs a fixture read-only', () => {
  const script = fileURLToPath(new URL('../scripts/audit-email-delivery-backfill.mjs', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'email-audit-'));
  const fixture = join(dir, 'fx.json');
  writeFileSync(fixture, JSON.stringify({
    registrationsTotal: 3,
    historyRolloutAt: ROLLOUT,
    registrations: [
      { id: 'r-proven', currentRecipientEmail: 'now@synthetic.test', provider: 'resend', providerMessageId: 'pm-a', sentAt: '2026-07-01T10:00:05.000Z', lastAttemptAt: '2026-07-01T10:00:00.000Z', error: null },
      { id: 'r-unresolved', currentRecipientEmail: 'now2@synthetic.test', provider: 'resend', providerMessageId: null, sentAt: '2026-07-02T10:00:00.000Z', lastAttemptAt: null, error: null },
    ],
    audits: [
      { registrationId: 'r-proven', action: 'email.confirmation.attempted', createdAt: '2026-07-01T10:00:00.000Z', payload: { email: 'hist@synthetic.test' } },
      { registrationId: 'r-proven', action: 'email.confirmation.sent', createdAt: '2026-07-01T10:00:05.000Z', payload: { providerMessageId: 'pm-a', provider: 'resend' } },
    ],
    existingDeliveries: [],
  }));

  const out = execFileSync(process.execPath, ['--import', 'tsx', script, '--fixture', fixture, '--json'], { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  assert.equal(parsed.writes, 0);
  assert.equal(parsed.report.evidence.PROVEN, 1);
  assert.equal(parsed.report.plan.PLANNED_INSERT_HIGH_CONFIDENCE, 1);
  assert.equal(parsed.report.plan.DO_NOT_BACKFILL, 1);
  assert.equal(out.includes('hist@synthetic.test'), false);

  assert.throws(() => execFileSync(process.execPath, ['--import', 'tsx', script, '--fixture', fixture, '--apply'], { encoding: 'utf8', stdio: 'pipe' }));
});

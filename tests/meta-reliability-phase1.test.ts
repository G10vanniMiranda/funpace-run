import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateMetaReconciliationContext } from '../server/meta-conversions-api';
import {
  getEligibleMetaReconciliationContext,
  getMetaReconciliationEventId,
} from '../server/meta-events';

const validContext = {
  captured_at: '2026-08-06T12:00:00.000Z',
  event_source_url: 'https://funpace.club/inscricao?ignored=yes',
};

test('reconciliation rejects empty, insufficient and revoked Meta contexts', () => {
  const eventAt = '2026-08-06T12:01:00.000Z';
  assert.equal(validateMetaReconciliationContext({}, eventAt), null);
  assert.equal(validateMetaReconciliationContext({ captured_at: validContext.captured_at }, eventAt), null);
  assert.equal(validateMetaReconciliationContext({ event_source_url: validContext.event_source_url }, eventAt), null);
  assert.equal(validateMetaReconciliationContext({ ...validContext, captured_at: 'invalid' }, eventAt), null);
  assert.equal(validateMetaReconciliationContext({ ...validContext, event_source_url: 'https://attacker.invalid/' }, eventAt), null);
  // Revocation persists an empty object, so it is covered by the same fail-closed gate.
  assert.equal(validateMetaReconciliationContext({}, eventAt), null);
});

test('reconciliation accepts legitimate context without inventing optional Meta identifiers', () => {
  assert.deepEqual(
    validateMetaReconciliationContext(validContext, '2026-08-06T12:01:00.000Z'),
    { capturedAt: validContext.captured_at, eventSourceUrl: 'https://funpace.club/inscricao' },
  );
  assert.equal('fbp' in validContext, false);
  assert.equal('fbc' in validContext, false);
});

test('reconciliation rejects context captured implausibly after the event', () => {
  assert.equal(validateMetaReconciliationContext(validContext, '2026-08-06T11:50:00.000Z'), null);
});

test('all reconciled event types share the fail-closed context gate and deterministic deduplication ID', () => {
  const registrationId = 'registration-controlled';
  const eventAt = '2026-08-06T12:01:00.000Z';
  const names = ['CompleteRegistration', 'InitiateCheckout', 'Purchase'] as const;
  const expectedIds = [
    'complete_registration_registration-controlled',
    'initiate_checkout_registration-controlled',
    'purchase_registration-controlled',
  ];

  for (const [index, eventName] of names.entries()) {
    assert.equal(getEligibleMetaReconciliationContext(true, {}, eventAt), null, `${eventName}: empty`);
    assert.equal(
      getEligibleMetaReconciliationContext(true, { captured_at: validContext.captured_at }, eventAt),
      null,
      `${eventName}: insufficient`,
    );
    assert.equal(getEligibleMetaReconciliationContext(false, validContext, eventAt), null, `${eventName}: consent false`);
    assert.equal(getEligibleMetaReconciliationContext(false, {}, eventAt), null, `${eventName}: revoked`);
    assert.ok(getEligibleMetaReconciliationContext(true, validContext, eventAt), `${eventName}: valid`);
    assert.equal(getMetaReconciliationEventId(eventName, registrationId), expectedIds[index]);
    assert.equal(
      getMetaReconciliationEventId(eventName, registrationId),
      getMetaReconciliationEventId(eventName, registrationId),
      `${eventName}: repeat is idempotent`,
    );
  }
});

test('registration owns durable Meta context independently from the outbox', () => {
  const database = readFileSync('server/database.ts', 'utf8');
  const snapshotStart = database.indexOf('export async function getMetaRegistrationSnapshotInPostgres');
  const snapshotEnd = database.indexOf('export async function listPaidRegistrationsMissingMetaPurchaseInPostgres', snapshotStart);
  const snapshot = database.slice(snapshotStart, snapshotEnd);
  assert.match(snapshot, /registration\.meta_context/);
  assert.doesNotMatch(snapshot, /client_context <> '\{\}'::jsonb/);
  assert.match(snapshot, /clientContext: \(row\.meta_context \|\| \{\}\)/);
});

test('lifecycle reconciler uses deterministic IDs and authoritative uniqueness', () => {
  const database = readFileSync('server/database.ts', 'utf8');
  const events = readFileSync('server/meta-events.ts', 'utf8');
  assert.match(database, /event_id='complete_registration_' \|\| registration\.id/);
  assert.match(database, /event_id='initiate_checkout_' \|\| registration\.id/);
  assert.match(database, /on conflict \(provider,event_name,event_id\) do nothing/);
  assert.match(events, /listRegistrationsMissingMetaLifecycleEventsInPostgres/);
  assert.equal((database.match(/and \$\{META_RECONCILIATION_CONTEXT_SQL\}/g) || []).length, 3);
  assert.match(events, /getEligibleMetaReconciliationContext\([\s\S]*snapshot\.clientContext,[\s\S]*missing\.eventAt/);
  assert.match(events, /getEligibleMetaReconciliationContext\([\s\S]*snapshot\.clientContext,[\s\S]*snapshot\.paidAt/);
});

test('worker has safe concurrent claiming, retry and a terminal dead-letter state', () => {
  const database = readFileSync('server/database.ts', 'utf8');
  const events = readFileSync('server/meta-events.ts', 'utf8');
  const vercel = readFileSync('vercel.json', 'utf8');
  assert.match(database, /for update(?: of integration)? skip locked/);
  assert.match(database, /input\.retryAt \? 'failed' : 'dead'/);
  assert.match(events, /RETRY_DELAYS_SECONDS = \[60, 5 \* 60, 30 \* 60, 2 \* 60 \* 60, 6 \* 60 \* 60\]/);
  assert.match(vercel, /"path": "\/api\/cron\/meta"[\s\S]*"schedule": "\*\/5 \* \* \* \*"/);
  assert.match(readFileSync('api/cron/meta.ts', 'utf8'), /handleApiRequest/);
});

test('revocation clears durable marketing context and dead-letters unsent events', () => {
  const database = readFileSync('server/database.ts', 'utf8');
  const start = database.indexOf('export async function updateMetaMarketingConsentInPostgres');
  const end = database.indexOf('export async function cleanupMetaClientContextInPostgres', start);
  const revoke = database.slice(start, end);
  assert.match(revoke, /meta_context=case when \$1 then meta_context else '\{\}'::jsonb end/);
  assert.match(revoke, /set status='dead'/);
  assert.doesNotMatch(revoke, /status in \([^)]*sent/);
});

test('new migration is additive and accepts historical rows without invented identifiers', () => {
  const migration = readFileSync('supabase/migrations/20260803213000_phase1_meta_reliability.sql', 'utf8');
  assert.match(migration, /add column if not exists meta_context jsonb not null default '\{\}'::jsonb/);
  assert.match(migration, /'dead'/);
  assert.doesNotMatch(migration, /fbp|fbc|fbclid/i);
  assert.doesNotMatch(migration, /delete from|drop column/i);
});

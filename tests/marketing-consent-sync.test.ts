import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MARKETING_CONSENT_SYNC_VERSION,
  readMarketingConsentSyncRecord,
  runMarketingConsentSync,
  type MarketingConsentSyncRecord,
} from '../src/lib/marketingConsentSync';

const initial = (): MarketingConsentSyncRecord => ({
  version: MARKETING_CONSENT_SYNC_VERSION,
  target: false,
  consentUpdatedAt: '2026-08-03T10:00:00.000Z',
  status: 'pending',
  attempt: 0,
  updatedAt: '2026-08-03T10:00:00.000Z',
});

test('revocation retries network and 500-like failures with bounded backoff', async () => {
  const persisted: MarketingConsentSyncRecord[] = [];
  const sleeps: number[] = [];
  let calls = 0;
  const result = await runMarketingConsentSync(initial(), {
    transport: async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('network_error');
      if (calls === 2) throw new Error('HTTP 503');
    },
    persist: (record) => persisted.push(record),
    sleep: async (milliseconds) => { sleeps.push(milliseconds); },
    now: () => '2026-08-03T10:00:01.000Z',
    delays: [0, 1_000, 5_000],
  });
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [1_000, 5_000]);
  assert.equal(result.status, 'synced');
  assert.ok(persisted.some((record) => record.status === 'pending' && record.lastError === 'HTTP 503'));
});

test('persistent failure remains explicit and stops after the configured attempts', async () => {
  let calls = 0;
  const result = await runMarketingConsentSync(initial(), {
    transport: async () => { calls += 1; throw new Error('HTTP 500'); },
    persist: () => undefined,
    sleep: async () => undefined,
    delays: [0, 1, 2, 3],
  });
  assert.equal(calls, 4);
  assert.equal(result.status, 'error');
  assert.equal(result.lastError, 'HTTP 500');
});

test('a persisted syncing record can be restored after reload', () => {
  const record = { ...initial(), status: 'syncing' as const, attempt: 2 };
  const targetStorage = { getItem: () => JSON.stringify(record), setItem: () => undefined };
  assert.deepEqual(readMarketingConsentSyncRecord(targetStorage), record);
});

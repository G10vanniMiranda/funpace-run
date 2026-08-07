import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'funpace-sheets-outbox-'));
process.env.DATABASE_PROVIDER = 'json';
process.env.DATABASE_FILE = join(temporaryDirectory, 'database.json');

const {
  claimGoogleSheetSync,
  completeGoogleSheetSync,
  enqueueGoogleSheetSync,
  failGoogleSheetSync,
  GOOGLE_SHEET_SYNC_DEFERRED_REQUEUE,
  GOOGLE_SHEET_SYNC_MAX_ATTEMPTS,
  listClaimableGoogleSheetSyncs,
  snapshot,
  transaction,
} = await import('../server/database.js');

after(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

test('outbox enqueues, claims and completes a sync item', async () => {
  const queued = await enqueueGoogleSheetSync({
    entityType: 'registration',
    entityId: 'registration-1',
    sheetName: 'registrations',
    operation: 'upsert',
  });
  assert.equal(queued.status, 'pending');
  assert.equal(queued.attempts, 0);

  const claimed = await claimGoogleSheetSync(queued.id);
  assert.equal(claimed?.status, 'processing');
  assert.equal(claimed?.attempts, 1);
  assert.equal(await claimGoogleSheetSync(queued.id), null);

  await completeGoogleSheetSync(queued.id, 12);
  const completed = (await snapshot()).googleSheetSyncs.find((item) => item.id === queued.id);
  assert.equal(completed?.status, 'synchronized');
  assert.equal(completed?.rowNumber, 12);
  assert.ok(completed?.synchronizedAt);
});

test('reenqueue preserves row hint and a failed attempt remains retryable', async () => {
  const requeued = await enqueueGoogleSheetSync({
    entityType: 'registration',
    entityId: 'registration-1',
    sheetName: 'registrations',
    operation: 'upsert',
  });
  assert.equal(requeued.status, 'pending');
  assert.equal(requeued.rowNumber, 12);

  const claimed = await claimGoogleSheetSync(requeued.id);
  assert.equal(claimed?.attempts, 2);
  await failGoogleSheetSync(requeued.id, new Error('temporary failure'));

  const failed = (await snapshot()).googleSheetSyncs.find((item) => item.id === requeued.id);
  assert.equal(failed?.status, 'failed');
  assert.equal(failed?.lastError, 'TRANSIENT: temporary failure');
  assert.equal((await claimGoogleSheetSync(requeued.id))?.status, 'processing');
});

test('recovers a processing item only after its lease expires', async () => {
  const queued = await enqueueGoogleSheetSync({ entityType: 'registration', entityId: 'stale-processing', sheetName: 'registrations', operation: 'upsert' });
  await claimGoogleSheetSync(queued.id);
  await transaction((database) => {
    const item = database.googleSheetSyncs.find((candidate) => candidate.id === queued.id)!;
    item.lastAttemptAt = '2026-01-01T00:00:00.000Z';
    item.updatedAt = item.lastAttemptAt;
  });
  assert.ok((await listClaimableGoogleSheetSyncs(50)).some((item) => item.id === queued.id));
  const recovered = await claimGoogleSheetSync(queued.id);
  assert.equal(recovered?.status, 'processing');
  assert.equal(recovered?.attempts, 2);
});

test('concurrent claims allow only one worker', async () => {
  const queued = await enqueueGoogleSheetSync({ entityType: 'registration', entityId: 'concurrent-claim', sheetName: 'registrations', operation: 'upsert' });
  const claimed = await Promise.all([claimGoogleSheetSync(queued.id), claimGoogleSheetSync(queued.id)]);
  assert.equal(claimed.filter(Boolean).length, 1);
});

test('reenqueue during processing is deferred and completion cannot erase it', async () => {
  const queued = await enqueueGoogleSheetSync({ entityType: 'registration', entityId: 'deferred-requeue', sheetName: 'registrations', operation: 'upsert' });
  await claimGoogleSheetSync(queued.id);
  const deferred = await enqueueGoogleSheetSync({ entityType: 'registration', entityId: 'deferred-requeue', sheetName: 'registrations', operation: 'upsert' });
  assert.equal(deferred.status, 'pending');
  assert.equal(deferred.lastError, GOOGLE_SHEET_SYNC_DEFERRED_REQUEUE);
  assert.equal(await claimGoogleSheetSync(queued.id), null);
  await completeGoogleSheetSync(queued.id, 99);
  const preserved = (await snapshot()).googleSheetSyncs.find((item) => item.id === queued.id)!;
  assert.equal(preserved.status, 'pending');
  assert.notEqual(preserved.rowNumber, 99);
});

test('permanent and exhausted failures are excluded from automatic replay', async () => {
  const permanent = await enqueueGoogleSheetSync({ entityType: 'registration', entityId: 'permanent-failure', sheetName: 'registrations', operation: 'upsert' });
  await claimGoogleSheetSync(permanent.id);
  const error = Object.assign(new Error('unexpected header'), { retryable: false });
  await failGoogleSheetSync(permanent.id, error);

  const exhausted = await enqueueGoogleSheetSync({ entityType: 'registration', entityId: 'exhausted-failure', sheetName: 'registrations', operation: 'upsert' });
  await claimGoogleSheetSync(exhausted.id);
  await failGoogleSheetSync(exhausted.id, new Error('temporary outage'));
  await transaction((database) => {
    const item = database.googleSheetSyncs.find((candidate) => candidate.id === exhausted.id)!;
    item.attempts = GOOGLE_SHEET_SYNC_MAX_ATTEMPTS;
    item.lastAttemptAt = '2026-01-01T00:00:00.000Z';
  });

  const claimable = await listClaimableGoogleSheetSyncs(50);
  assert.equal(claimable.some((item) => item.id === permanent.id), false);
  assert.equal(claimable.some((item) => item.id === exhausted.id), false);
});

test('an already synchronized event is not claimable', async () => {
  const queued = await enqueueGoogleSheetSync({ entityType: 'registration', entityId: 'already-synchronized', sheetName: 'registrations', operation: 'upsert' });
  await claimGoogleSheetSync(queued.id);
  await completeGoogleSheetSync(queued.id, 33);
  assert.equal(await claimGoogleSheetSync(queued.id), null);
  assert.equal((await listClaimableGoogleSheetSyncs(50)).some((item) => item.id === queued.id), false);
});

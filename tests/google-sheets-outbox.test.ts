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
  snapshot,
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
  assert.equal(failed?.lastError, 'temporary failure');
  assert.equal((await claimGoogleSheetSync(requeued.id))?.status, 'processing');
});

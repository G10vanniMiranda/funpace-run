import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'funpace-remarketing-outbox-'));
process.env.DATABASE_PROVIDER = 'json';
process.env.DATABASE_FILE = join(temporaryDirectory, 'database.json');

const databaseModule = await import('../server/database.js');
const sheetsModule = await import('../server/google-sheets.js');
const remarketingModule = await import('../server/remarketing.js');
const { claimGoogleSheetSync, completeGoogleSheetSync, enqueueGoogleSheetSync, snapshot, transaction } = databaseModule;
const { getGoogleSheetsConfig, processGoogleSheetSync } = sheetsModule;

after(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

const config = (id: string) => getGoogleSheetsConfig({
  GOOGLE_SHEETS_ENABLED: 'true',
  GOOGLE_SHEETS_REMARKETING_ENABLED: 'true',
  GOOGLE_SHEETS_SPREADSHEET_ID: id,
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@test.iam.gserviceaccount.com',
  GOOGLE_PRIVATE_KEY: 'unused-with-mock-client',
});

async function seedPerson(id: string) {
  await transaction((database) => {
    const now = '2026-08-01T00:00:00.000Z';
    database.registrations.push({
      id, eventId: 'funpace-run-2026', distanceId: 'distance-5k', lotId: 'lot-1', cpfHash: `cpf-${id}`,
      status: 'pending_payment', amountCents: 10000, createdAt: now, updatedAt: now,
      payload: { fullName: `Pessoa ${id}`, email: `${id}@mail.test.br`, cpf: '12345678901', phone: '69999999999', city: 'Porto Velho', state: 'RO', team: '', birthDate: '1990-01-01', gender: 'female', shirtSize: 'M', distance: '5K', emergencyContactName: 'Contato', emergencyContactPhone: '69988888888', termsAccepted: true, regulationAccepted: true, privacyAccepted: true },
    });
    database.payments.push({ id: `payment-${id}`, registrationId: id, provider: 'infinitepay', status: 'pending_payment', amountCents: 10000, providerPaymentId: `invoice-${id}`, checkoutUrl: `https://checkout.test/${id}`, createdAt: now, updatedAt: now, expiresAt: '2026-08-02T00:00:00.000Z' });
  });
  const db = await snapshot();
  return remarketingModule.buildRemarketingProjections(db, new Date('2026-08-07T00:00:00.000Z')).find((item) => item.registrationIds.includes(id))!;
}

function client(upsert: (...args: any[]) => Promise<any>) {
  return {
    ensureSpreadsheetStructure: async () => ({ createdSheets: [] }),
    getValues: async () => ({}), updateValues: async () => ({}), appendValues: async () => ({}), clearValues: async () => undefined,
    upsertRow: upsert, replaceRows: async () => ({ rowCount: 0 }),
  };
}

test('complete remarketing outbox sequence is synchronized and replay creates zero duplicates', async () => {
  const projection = await seedPerson('sequence');
  const queued = await enqueueGoogleSheetSync({ entityType: 'remarketing', entityId: projection.personKey, sheetName: 'remarketing', operation: 'upsert' });
  let writes = 0;
  const mockClient = client(async () => { writes += 1; return { action: writes === 1 ? 'created' : 'updated', rowNumber: 9 }; });
  const first = await processGoogleSheetSync(queued.id, { config: config('sequence-1'), client: mockClient as any });
  assert.equal(first.status, 'synchronized');
  const replay = await enqueueGoogleSheetSync({ entityType: 'remarketing', entityId: projection.personKey, sheetName: 'remarketing', operation: 'upsert' });
  const second = await processGoogleSheetSync(replay.id, { config: config('sequence-1'), client: mockClient as any });
  const records = (await snapshot()).googleSheetSyncs.filter((item) => item.entityType === 'remarketing' && item.entityId === projection.personKey);
  assert.equal(second.status, 'synchronized'); assert.equal(records.length, 1); assert.equal(records[0].rowNumber, 9); assert.equal(writes, 2);
});

test('timeout and transient failure retry the same row without duplicate outbox records', async () => {
  const projection = await seedPerson('timeout');
  const queued = await enqueueGoogleSheetSync({ entityType: 'remarketing', entityId: projection.personKey, sheetName: 'remarketing', operation: 'upsert' });
  let attempts = 0;
  const mockClient = client(async () => {
    attempts += 1;
    if (attempts === 1) throw new DOMException('timed out', 'TimeoutError');
    return { action: 'updated', rowNumber: 11 };
  });
  assert.equal((await processGoogleSheetSync(queued.id, { config: config('timeout-1'), client: mockClient as any })).status, 'failed');
  assert.equal((await processGoogleSheetSync(queued.id, { config: config('timeout-1'), client: mockClient as any })).status, 'synchronized');
  const records = (await snapshot()).googleSheetSyncs.filter((item) => item.entityId === projection.personKey);
  assert.equal(records.length, 1); assert.equal(records[0].attempts, 2); assert.equal(records[0].rowNumber, 11);
});

test('permanent error remains failed and is classified as non-retryable', async () => {
  const projection = await seedPerson('permanent');
  const queued = await enqueueGoogleSheetSync({ entityType: 'remarketing', entityId: projection.personKey, sheetName: 'remarketing', operation: 'upsert' });
  const mockClient = client(async () => { throw new Error('Cabeçalho inesperado na aba Remarketing.'); });
  const result = await processGoogleSheetSync(queued.id, { config: config('permanent-1'), client: mockClient as any });
  const stored = (await snapshot()).googleSheetSyncs.find((item) => item.id === queued.id)!;
  assert.equal(result.status, 'failed'); assert.equal(result.retryable, false); assert.match(stored.lastError || '', /^PERMANENT:/);
});

test('interrupted worker lease is recovered once and concurrent claims have one winner', async () => {
  const projection = await seedPerson('lease');
  const queued = await enqueueGoogleSheetSync({ entityType: 'remarketing', entityId: projection.personKey, sheetName: 'remarketing', operation: 'upsert' });
  await claimGoogleSheetSync(queued.id);
  await transaction((database) => {
    const task = database.googleSheetSyncs.find((item) => item.id === queued.id)!;
    task.lastAttemptAt = '2026-01-01T00:00:00.000Z'; task.updatedAt = task.lastAttemptAt;
  });
  const claims = await Promise.all([claimGoogleSheetSync(queued.id), claimGoogleSheetSync(queued.id)]);
  assert.equal(claims.filter(Boolean).length, 1);
  await completeGoogleSheetSync(queued.id, 13);
  assert.equal((await snapshot()).googleSheetSyncs.find((item) => item.id === queued.id)?.status, 'synchronized');
});

test('concurrent cron enqueue for the same person creates one outbox record', async () => {
  const projection = await seedPerson('concurrent-cron');
  const inputs = { entityType: 'remarketing' as const, entityId: projection.personKey, sheetName: 'remarketing' as const, operation: 'upsert' as const };
  const results = await Promise.all([enqueueGoogleSheetSync(inputs), enqueueGoogleSheetSync(inputs)]);
  const records = (await snapshot()).googleSheetSyncs.filter((item) => item.entityId === projection.personKey);
  assert.equal(results[0].id, results[1].id); assert.equal(records.length, 1);
});

test('confirmed payment after first sheet projection updates the same row to PAID', async () => {
  const before = await seedPerson('paid-after-sheet');
  const sheet = new Map<string, any[]>();
  const mockClient = client(async (_sheet: string, row: any[], _keyIndex: number, key: string) => {
    const action = sheet.has(key) ? 'updated' : 'created'; sheet.set(key, row); return { action, rowNumber: 17 };
  });
  const firstTask = await enqueueGoogleSheetSync({ entityType: 'remarketing', entityId: before.personKey, sheetName: 'remarketing', operation: 'upsert' });
  await processGoogleSheetSync(firstTask.id, { config: config('paid-after-sheet-1'), client: mockClient as any });
  await transaction((database) => {
    const registration = database.registrations.find((item) => item.id === 'paid-after-sheet')!;
    const payment = database.payments.find((item) => item.registrationId === registration.id)!;
    registration.status = 'paid'; registration.paidAt = '2026-08-07T11:00:00.000Z'; registration.confirmedAt = registration.paidAt; registration.updatedAt = registration.paidAt;
    payment.status = 'paid'; payment.paidAt = registration.paidAt; payment.updatedAt = registration.paidAt;
  });
  const afterDb = await snapshot();
  const after = remarketingModule.buildRemarketingProjections(afterDb).find((item) => item.registrationIds.includes('paid-after-sheet'))!;
  const paidTask = await enqueueGoogleSheetSync({ entityType: 'remarketing', entityId: after.personKey, sheetName: 'remarketing', operation: 'upsert' });
  await processGoogleSheetSync(paidTask.id, { config: config('paid-after-sheet-1'), client: mockClient as any });
  assert.equal(after.personKey, before.personKey); assert.equal(sheet.size, 1); assert.equal(sheet.get(before.personKey)?.[18], false); assert.equal(sheet.get(before.personKey)?.[19], 'PAID');
});

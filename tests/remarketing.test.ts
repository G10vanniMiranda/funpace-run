import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { AuditLogRecord, Database, PaymentRecord, RegistrationRecord } from '../server/database.js';
import {
  analyzeRemarketingIdentityConflicts,
  buildRemarketingProjections,
  createRemarketingPersonKey,
  summarizeRemarketingProjections,
} from '../server/remarketing.js';
import {
  buildRemarketingSheetRow,
  executeGoogleSheetSyncTask,
  getGoogleSheetsConfig,
  queueRemarketingGoogleSheetSyncForRegistration,
  reconcileRemarketingGoogleSheetSyncs,
} from '../server/google-sheets.js';

const NOW = new Date('2026-08-07T12:00:00.000Z');
const BASE_TIME = '2026-08-01T12:00:00.000Z';

function registration(id: string, overrides: Partial<RegistrationRecord> = {}): RegistrationRecord {
  return {
    id,
    eventId: 'event',
    distanceId: 'distance-5k',
    lotId: 'lot-1',
    cpfHash: `cpf-${id}`,
    status: 'pending_payment',
    amountCents: 10000,
    payload: {
      fullName: `Pessoa ${id}`,
      email: `${id}@mail.test.br`,
      cpf: '12345678901',
      phone: '69999999999',
      city: 'Porto Velho', state: 'RO', team: '', birthDate: '1990-01-01', gender: 'female',
      shirtSize: 'M', distance: '5K', emergencyContactName: 'Contato', emergencyContactPhone: '69988888888',
      termsAccepted: true, regulationAccepted: true, privacyAccepted: true,
    },
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    ...overrides,
  };
}

function payment(registrationId: string, overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: `payment-${registrationId}`,
    registrationId,
    provider: 'infinitepay',
    status: 'pending_payment',
    amountCents: 10000,
    providerPaymentId: `invoice-${registrationId}`,
    checkoutUrl: `https://checkout.test/${registrationId}`,
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    expiresAt: '2026-08-02T12:00:00.000Z',
    ...overrides,
  };
}

function database(registrations: RegistrationRecord[], payments = registrations.map((item) => payment(item.id)), auditLogs: AuditLogRecord[] = []): Database {
  return {
    events: [],
    distances: [{ id: 'distance-5k', eventId: 'event', name: '5K', distanceKm: 5, capacity: 100, status: 'active' }],
    lots: [{ id: 'lot-1', eventId: 'event', name: 'Lote 1', priceCents: 10000, capacity: 100, soldCount: 0, status: 'active', startsAt: BASE_TIME, endsAt: BASE_TIME, orderIndex: 1, continuesAfterCapacity: false }],
    registrations, payments, paymentEvents: [], googleSheetSyncs: [], checkIns: [], kitDeliveries: [], auditLogs,
    adminSessions: [], adminUsers: [], partnershipLeads: [], partners: [],
  };
}

function project(db: Database) {
  return buildRemarketingProjections(db, NOW);
}

test('1: one unpaid attempt is eligible', () => {
  const rows = project(database([registration('one')]));
  assert.equal(rows.length, 1); assert.equal(rows[0].eligible, true); assert.equal(rows[0].attemptCount, 1);
});

test('2: multiple unpaid attempts consolidate by CPF', () => {
  const first = registration('first', { cpfHash: 'same', createdAt: '2026-08-01T00:00:00.000Z' });
  const second = registration('second', { cpfHash: 'same', createdAt: '2026-08-02T00:00:00.000Z' });
  const rows = project(database([first, second]));
  assert.equal(rows.length, 1); assert.equal(rows[0].attemptCount, 2); assert.equal(rows[0].registrationIdReference, 'second');
});

test('3 and 17: later payment keeps person_key and suppresses the existing person', () => {
  const item = registration('later-paid');
  const before = project(database([item]))[0];
  const afterDb = database([{ ...item, status: 'paid', paidAt: '2026-08-07T10:00:00.000Z', confirmedAt: '2026-08-07T10:00:00.000Z' }], [payment(item.id, { status: 'paid', paidAt: '2026-08-07T10:00:00.000Z' })]);
  const after = project(afterDb)[0];
  assert.equal(after.personKey, before.personKey); assert.equal(after.eligible, false); assert.equal(after.suppressionReason, 'PAID'); assert.equal(after.remarketingStatus, 'PAGAMENTO_CONFIRMADO');
});

test('4: payment in another registration suppresses the person', () => {
  const first = registration('unpaid', { cpfHash: 'same-person' });
  const second = registration('paid', { cpfHash: 'same-person', status: 'paid', paidAt: BASE_TIME, createdAt: '2026-08-02T12:00:00.000Z' });
  const rows = project(database([first, second], [payment(first.id), payment(second.id, { status: 'paid', paidAt: BASE_TIME })]));
  assert.equal(rows.length, 1); assert.equal(rows[0].suppressionReason, 'PAID');
});

test('5: CPF is a strong identity', () => {
  const rows = project(database([
    registration('cpf-a', { cpfHash: 'same', payload: { ...registration('x').payload, email: 'a@a.test.br', phone: '69911111111' } }),
    registration('cpf-b', { cpfHash: 'same', payload: { ...registration('x').payload, email: 'b@b.test.br', phone: '69922222222' } }),
  ]));
  assert.equal(rows.length, 1);
});

test('6: phone matches records only when CPF does not conflict', () => {
  const a = registration('phone-a', { cpfHash: '', payload: { ...registration('x').payload, email: 'a@a.test.br', phone: '69911111111' } });
  const b = registration('phone-b', { cpfHash: '', payload: { ...registration('x').payload, email: 'b@b.test.br', phone: '5569911111111' } });
  assert.equal(project(database([a, b])).length, 1);
});

test('7: email matches records only when CPF does not conflict', () => {
  const a = registration('email-a', { cpfHash: '', payload: { ...registration('x').payload, email: ' Same@Mail.Test.Br ', phone: '69911111111' } });
  const b = registration('email-b', { cpfHash: '', payload: { ...registration('x').payload, email: 'same@mail.test.br', phone: '69922222222' } });
  assert.equal(project(database([a, b])).length, 1);
});

test('8, 9 and 10: operational statuses use expiry, failure and pending state', () => {
  const expired = project(database([registration('expired')]))[0];
  const failed = project(database([registration('failed', { status: 'payment_failed' })], [payment('failed', { status: 'payment_failed', expiresAt: '2026-08-08T00:00:00.000Z' })]))[0];
  const pending = project(database([registration('pending', { expiresAt: '2026-08-08T00:00:00.000Z' })], [payment('pending', { expiresAt: '2026-08-08T00:00:00.000Z' })]))[0];
  assert.equal(expired.remarketingStatus, 'PAGAMENTO_EXPIROU');
  assert.equal(failed.remarketingStatus, 'PAGAMENTO_FALHOU');
  assert.equal(pending.remarketingStatus, 'PAGAMENTO_PENDENTE');
});

test('11: unequivocal test registration is suppressed', () => {
  const item = registration('fixture', { metaContext: { fixture: true } });
  assert.equal(project(database([item]))[0].suppressionReason, 'TEST');
});

test('12: only an audited administrative cancellation is suppressed', () => {
  const item = registration('cancelled', { status: 'cancelled' });
  const userCancelled = project(database([item]))[0];
  const log: AuditLogRecord = { id: 'audit', actor: 'admin@example', action: 'registration.cancelled_do_not_contact', entityType: 'registration', entityId: item.id, payload: { doNotContact: true }, createdAt: BASE_TIME };
  const adminCancelled = project(database([item], [payment(item.id, { status: 'cancelled' })], [log]))[0];
  assert.equal(userCancelled.eligible, true); assert.equal(adminCancelled.suppressionReason, 'ADMIN_CANCELLED');
});

test('administrative cancellation for checkout retry remains technically eligible', () => {
  const item = registration('retry-cancel', { status: 'cancelled' });
  const log: AuditLogRecord = { id: 'retry-audit', actor: 'admin@example', action: 'registration.cancelled_for_retry', entityType: 'registration', entityId: item.id, payload: { reason: 'release checkout retry' }, createdAt: BASE_TIME };
  const row = project(database([item], [payment(item.id, { status: 'cancelled' })], [log]))[0];
  assert.equal(row.eligible, true); assert.equal(row.suppressionReason, '');
});

test('different CPF plus same phone or e-mail never merges', () => {
  const a = registration('conflict-a', { cpfHash: 'cpf-a', payload: { ...registration('x').payload, email: 'family@mail.test.br', phone: '69911111111' } });
  const b = registration('conflict-b', { cpfHash: 'cpf-b', payload: { ...registration('x').payload, email: 'family@mail.test.br', phone: '69911111111' } });
  const db = database([a, b]);
  assert.equal(project(db).length, 2);
  assert.deepEqual(analyzeRemarketingIdentityConflicts(db), { emailsSharedAcrossCpf: 1, phonesSharedAcrossCpf: 1, registrationsWithoutPhone: 0, registrationsWithoutEmail: 0, financialDivergences: 0 });
});

test('empty phone or e-mail does not create a candidate', () => {
  const noPhone = registration('no-phone', { payload: { ...registration('x').payload, phone: '' } });
  const noEmail = registration('no-email', { payload: { ...registration('x').payload, email: '' } });
  assert.equal(project(database([noPhone, noEmail])).length, 0);
});

test('paid_at and registration paid are monotonic payment evidence despite inconsistent statuses', () => {
  const byPaidAt = registration('paid-at');
  const byRegistration = registration('registration-paid', { status: 'paid' });
  const rows = project(database([byPaidAt, byRegistration], [
    payment(byPaidAt.id, { status: 'pending_payment', paidAt: BASE_TIME }),
    payment(byRegistration.id, { status: 'pending_payment' }),
  ]));
  assert.equal(rows.every((row) => row.suppressionReason === 'PAID'), true);
});

test('late or duplicate webhook evidence remains idempotent', () => {
  const item = registration('webhook', { status: 'paid', paidAt: BASE_TIME, confirmedAt: BASE_TIME });
  const rows = project(database([item], [payment(item.id, { status: 'paid', paidAt: BASE_TIME })]));
  const repeated = project(database([item, { ...item }], [payment(item.id, { status: 'paid', paidAt: BASE_TIME })]));
  assert.equal(rows[0].suppressionReason, 'PAID'); assert.equal(repeated.length, 1); assert.equal(repeated[0].personKey, rows[0].personKey);
});

test('person_key is stable across order, retry, reconciliation, cancellation and payload correction', () => {
  const first = registration('anchor', { cpfHash: 'stable', createdAt: '2026-07-01T00:00:00.000Z' });
  const second = registration('new', { cpfHash: 'stable', createdAt: '2026-08-01T00:00:00.000Z' });
  const expected = project(database([first, second]))[0].personKey;
  assert.equal(project(database([second, first]))[0].personKey, expected);
  assert.equal(project(database([{ ...first, status: 'cancelled', payload: { ...first.payload, fullName: 'Nome corrigido' } }, second]))[0].personKey, expected);
  assert.equal(expected, createRemarketingPersonKey(first.id));
});

test('sheet row has the documented 22 columns and never exposes cpf_hash', () => {
  const item = registration('row', { cpfHash: 'internal-secret-hash' });
  const row = buildRemarketingSheetRow(project(database([item]))[0]);
  assert.equal(row.length, 22); assert.equal(row.includes(item.cpfHash), false); assert.match(String(row[5]), /^\d{3}\.\*\*\*\.\*\*\*-\d{2}$/);
});

test('13 and 15: enqueue and replay use one technical person key', async () => {
  const db = database([registration('enqueue')]);
  const inputs: unknown[] = [];
  const config = getGoogleSheetsConfig({ GOOGLE_SHEETS_ENABLED: 'true', GOOGLE_SHEETS_REMARKETING_ENABLED: 'true', GOOGLE_SHEETS_SPREADSHEET_ID: 'test', GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@test.iam.gserviceaccount.com', GOOGLE_PRIVATE_KEY: 'key' });
  const enqueue = async (input: any) => { inputs.push(input); return { id: 'task', ...input, status: 'pending', rowNumber: null, attempts: 0, lastAttemptAt: null, synchronizedAt: null, lastError: null, createdAt: BASE_TIME, updatedAt: BASE_TIME }; };
  const first = await queueRemarketingGoogleSheetSyncForRegistration('enqueue', { config, enqueue, loadDatabase: async () => db });
  const retry = await queueRemarketingGoogleSheetSyncForRegistration('enqueue', { config, enqueue, loadDatabase: async () => db });
  assert.equal(first?.entityId, retry?.entityId); assert.equal((inputs[0] as any).entityId, (inputs[1] as any).entityId);
});

test('projection executor upserts using person_key and preserves the row hint', async () => {
  const db = database([registration('execute')]);
  const projection = project(db)[0];
  let received: any[] = [];
  const client = { upsertRow: async (...args: any[]) => { received = args; return { action: 'updated' as const, rowNumber: 7 }; } } as any;
  const result = await executeGoogleSheetSyncTask({ id: 'task', entityType: 'remarketing', entityId: projection.personKey, sheetName: 'remarketing', operation: 'upsert', status: 'processing', rowNumber: 7, attempts: 1, lastAttemptAt: BASE_TIME, synchronizedAt: null, lastError: null, createdAt: BASE_TIME, updatedAt: BASE_TIME }, db, client);
  assert.equal(result.rowNumber, 7); assert.equal(received[0], 'remarketing'); assert.equal(received[3], projection.personKey); assert.equal(received[4], 7);
});

test('16: incremental reconciliation advances deterministically without requeueing pending tasks', async () => {
  const registrations = Array.from({ length: 30 }, (_, index) => registration(`r-${String(index).padStart(2, '0')}`));
  const db = database(registrations);
  const enqueued: any[] = [];
  const config = getGoogleSheetsConfig({ GOOGLE_SHEETS_ENABLED: 'true', GOOGLE_SHEETS_REMARKETING_ENABLED: 'true', GOOGLE_SHEETS_SPREADSHEET_ID: 'test-reconcile', GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@test.iam.gserviceaccount.com', GOOGLE_PRIVATE_KEY: 'key' });
  const enqueue = async (input: any) => {
    enqueued.push(input);
    db.googleSheetSyncs.push({ id: `task-${enqueued.length}`, ...input, status: 'pending', rowNumber: null, attempts: 0, lastAttemptAt: null, synchronizedAt: null, lastError: null, createdAt: BASE_TIME, updatedAt: BASE_TIME });
    return db.googleSheetSyncs.at(-1)!;
  };
  const first = await reconcileRemarketingGoogleSheetSyncs(25, { config, enqueue, loadDatabase: async () => db });
  const second = await reconcileRemarketingGoogleSheetSyncs(25, { config, enqueue, loadDatabase: async () => db });
  assert.equal(first.queued, 25); assert.equal(second.queued, 5); assert.equal(new Set(enqueued.map((item) => item.entityId)).size, 30);
});

test('summary reports eligible status distribution and zero paid eligible', () => {
  const eligible = registration('summary-eligible');
  const paid = registration('summary-paid', { status: 'paid', paidAt: BASE_TIME });
  const rows = project(database([eligible, paid], [payment(eligible.id), payment(paid.id, { status: 'paid', paidAt: BASE_TIME })]));
  const summary = summarizeRemarketingProjections(rows);
  assert.equal(summary.eligible, 1); assert.equal(summary.suppressions.PAID, 1); assert.equal(rows.filter((row) => row.eligible && row.suppressionReason === 'PAID').length, 0);
});

test('remarketing migrations are additive, mirrored and preserve every existing outbox type', () => {
  const serverMigration = readFileSync(new URL('../server/migrations/20260807_remarketing_google_sheet_projection.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const supabaseMigration = readFileSync(new URL('../supabase/migrations/20260807000100_remarketing_google_sheet_projection.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(serverMigration, supabaseMigration);
  for (const type of ['registration', 'payment', 'check_in', 'shirt_summary', 'lot_summary', 'alert', 'partnership', 'email', 'remarketing']) assert.match(serverMigration, new RegExp(`'${type}'`));
  assert.match(serverMigration, /drop constraint if exists/i);
  assert.doesNotMatch(serverMigration, /(?:update|delete\s+from|truncate|alter\s+table\s+"run-(?:payments|registrations)")/i);
});

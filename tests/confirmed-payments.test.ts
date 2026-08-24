import assert from 'node:assert/strict';
import test from 'node:test';
import type { Database, PaymentRecord, RegistrationRecord } from '../server/database.js';
import {
  buildConfirmedPaymentsProjection,
  confirmedPaymentProviderLabel,
  maskConfirmedPaymentCpf,
} from '../server/confirmed-payments.js';
import { buildConfirmedPaymentSheetRow, executeGoogleSheetSyncTask, type GoogleSheetsClient } from '../server/google-sheets.js';
import { googleSheetsDateSerial } from '../server/google-sheets-layout.js';

function registration(overrides: Partial<RegistrationRecord> = {}): RegistrationRecord {
  return {
    id: 'registration-1', eventId: 'event-1', distanceId: 'distance-5k', lotId: 'lot-1', cpfHash: 'hash',
    status: 'paid', amountCents: 7990, createdAt: '2026-08-20T12:00:00.000Z', updatedAt: '2026-08-20T12:05:00.000Z',
    paidAt: '2026-08-20T12:05:00.000Z', bibNumber: '501', partnerName: null, partnerType: null,
    payload: {
      fullName: 'Maria da Silva', email: 'maria@example.com', cpf: '123.456.789-01', phone: '+55 69 99999-0000',
      city: 'Porto Velho', state: 'RO', team: '', birthDate: '1990-01-01', gender: 'female', shirtSize: 'M',
      distance: '5K', emergencyContactName: 'Contato', emergencyContactPhone: '69999990001', termsAccepted: true,
      regulationAccepted: true, privacyAccepted: true, attribution: { utmSource: 'instagram' },
    },
    ...overrides,
  };
}

function payment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: 'payment-1', registrationId: 'registration-1', provider: 'infinitepay', status: 'paid', amountCents: 7990,
    providerPaymentId: 'invoice-1', checkoutUrl: null, createdAt: '2026-08-20T12:00:00.000Z',
    updatedAt: '2026-08-20T12:05:00.000Z', paidAt: '2026-08-20T12:05:00.000Z',
    ...overrides,
  };
}

function database(registrations: RegistrationRecord[], payments: PaymentRecord[]): Database {
  return {
    events: [], distances: [{ id: 'distance-5k', eventId: 'event-1', name: '5K', distanceKm: 5, capacity: 500, status: 'active' }],
    lots: [{ id: 'lot-1', eventId: 'event-1', name: 'Lote 1', priceCents: 7990, capacity: 500, soldCount: 0, status: 'active', startsAt: '', endsAt: '', orderIndex: 1, continuesAfterCapacity: false }],
    registrations, payments, paymentEvents: [], googleSheetSyncs: [], checkIns: [], kitDeliveries: [], auditLogs: [],
    adminSessions: [], adminUsers: [], partnershipLeads: [], partners: [],
  };
}

test('projects only the paid registration + paid payment intersection', () => {
  const paid = registration();
  const pendingRegistration = registration({ id: 'registration-2', status: 'pending_payment' });
  const result = buildConfirmedPaymentsProjection(database(
    [paid, pendingRegistration, registration({ id: 'registration-3' })],
    [payment(), payment({ id: 'payment-2', registrationId: 'registration-2' }), payment({ id: 'payment-3', registrationId: 'registration-3', status: 'pending_payment' })],
  ));
  assert.deepEqual(result.projections.map((item) => item.registrationId), ['registration-1']);
  assert.equal(result.diagnostics.registrationPaidWithoutPaidPayment, 1);
  assert.equal(result.diagnostics.paymentPaidWithoutPaidRegistration, 1);
});

test('deduplicates paid payments deterministically using the newest payment', () => {
  const result = buildConfirmedPaymentsProjection(database([registration()], [
    payment({ id: 'payment-old', paidAt: '2026-08-20T12:00:00.000Z', amountCents: 7000 }),
    payment({ id: 'payment-new', paidAt: '2026-08-20T13:00:00.000Z', amountCents: 7990 }),
  ]));
  assert.equal(result.projections.length, 1);
  assert.equal(result.projections[0].paymentId, 'payment-new');
  assert.equal(result.diagnostics.duplicatePaidPaymentCount, 1);
  assert.deepEqual(result.diagnostics.duplicatePaidRegistrationIds, ['registration-1']);
});

test('uses payment id as a stable tie-breaker for duplicate timestamps', () => {
  const result = buildConfirmedPaymentsProjection(database([registration()], [payment({ id: 'payment-a' }), payment({ id: 'payment-z' })]));
  assert.equal(result.projections[0].paymentId, 'payment-z');
});

test('maps approved and unknown provider labels', () => {
  assert.equal(confirmedPaymentProviderLabel('infinitepay'), 'InfinitePay');
  assert.equal(confirmedPaymentProviderLabel('manual_pix'), 'PIX Manual');
  assert.equal(confirmedPaymentProviderLabel('stripe'), 'Outro — stripe');
  assert.equal(confirmedPaymentProviderLabel(''), 'Outro — não informado');
});

test('masks CPF and never exposes invalid input', () => {
  assert.equal(maskConfirmedPaymentCpf('123.456.789-01'), '123.***.***-01');
  assert.equal(maskConfirmedPaymentCpf('123'), '***.***.***-**');
});

test('projects partner, coupon, discount, bib and acquisition data', () => {
  const source = registration({
    partnerName: 'Equipe Norte', partnerType: 'sports_advisory', couponCode: 'VOLTA10', discountAmountCents: 1000,
    payload: { ...registration().payload, attribution: { firstTouch: { utmSource: 'meta', capturedAt: '2026-08-01T00:00:00.000Z' } } },
  });
  const projected = buildConfirmedPaymentsProjection(database([source], [payment()])).projections[0];
  assert.equal(projected.partner, 'Equipe Norte');
  assert.equal(projected.partnerType, 'Assessoria esportiva');
  assert.equal(projected.acquisitionOrigin, 'meta');
  assert.equal(projected.coupon, 'VOLTA10');
  assert.equal(projected.discountCents, 1000);
  assert.equal(projected.bibNumber, '501');
});

test('sorts projections by payment date descending', () => {
  const result = buildConfirmedPaymentsProjection(database(
    [registration(), registration({ id: 'registration-2' })],
    [payment(), payment({ id: 'payment-2', registrationId: 'registration-2', paidAt: '2026-08-21T12:00:00.000Z' })],
  ));
  assert.deepEqual(result.projections.map((item) => item.registrationId), ['registration-2', 'registration-1']);
});

test('builds exactly the approved 19 columns with real date and currency numbers', () => {
  const projected = buildConfirmedPaymentsProjection(database([registration()], [payment()])).projections[0];
  const row = buildConfirmedPaymentSheetRow(projected);
  assert.equal(row.length, 19);
  assert.equal(row[0], googleSheetsDateSerial(projected.paidAt));
  assert.equal(row[9], 79.9);
  assert.equal(row[15], 0);
  assert.deepEqual(row.slice(16), ['registration-1', 'payment-1', 'infinitepay']);
});

test('executor performs one global replace and returns mismatch diagnostics', async () => {
  let sheet = '';
  let rows: unknown[][] = [];
  const client = { replaceRows: async (receivedSheet: string, receivedRows: unknown[][]) => {
    sheet = receivedSheet; rows = receivedRows; return { rowCount: receivedRows.length };
  } } as unknown as GoogleSheetsClient;
  const result = await executeGoogleSheetSyncTask({
    id: 'sync-confirmed', entityType: 'confirmed_payments_projection', entityId: 'paid-and-paid', sheetName: 'confirmed_payments',
    operation: 'replace', status: 'processing', rowNumber: null, attempts: 1, lastAttemptAt: null, synchronizedAt: null,
    lastError: null, createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
  }, database([registration()], [payment()]), client);
  assert.equal(sheet, 'confirmed_payments');
  assert.equal(rows.length, 1);
  assert.equal(result.action, 'replaced');
  assert.equal(result.diagnostics.registrationPaidWithoutPaidPayment, 0);
});

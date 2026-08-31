import assert from 'node:assert/strict';
import test from 'node:test';

import {
  maskEmail,
  maskPhone,
  serializeAdminRegistrationForRole,
  serializeAdminRegistrationsForRole,
  serializeRegistrationHistoryForRole,
  serializeRegistrationTimelineForRole,
  OPERATION_HIDDEN_FIELDS,
  OPERATION_DETAIL_ONLY_FIELDS,
} from '../server/registration-visibility.js';

// ADMIN-003 Stage 3 — the role-aware serializer is the single authorization +
// PII-minimisation authority for the Inscrições surface. Pure, tested without
// the server.

// A representative `toAdminRow`-shaped object.
function fullRow() {
  return {
    id: 'reg-1',
    fullName: 'Giovanni Miranda',
    email: 'giovanni.miranda@example.com',
    cpfMasked: '123.***.***-09',
    phone: '11999991234',
    birthDate: '1990-05-01',
    age: 36,
    gender: 'male',
    emergencyContactName: 'Maria',
    emergencyContactPhone: '11988887777',
    city: 'Porto Velho',
    state: 'RO',
    team: 'FUNPACE',
    bibNumber: 'A123',
    checkInStatus: 'not_started',
    kitStatus: 'not_delivered',
    distance: '10 KM',
    distanceId: 'dist-1',
    lot: 'Lote 1',
    lotId: 'lot-1',
    shirtSize: 'M',
    status: 'paid',
    paymentStatus: 'paid',
    paymentProvider: 'infinitepay',
    providerPaymentId: 'pay_abc123',
    amountCents: 9990,
    originalPriceCents: 12000,
    finalPriceCents: 9990,
    discountPercentage: 16,
    discountAmountCents: 2010,
    couponCode: 'RUN10',
    couponAppliedAt: '2026-01-01T00:00:00.000Z',
    couponUsedAt: '2026-01-02T00:00:00.000Z',
    partnerId: 'p-1',
    partnerName: 'Assessoria X',
    partnerType: 'sports_advisory',
    partnerLink: 'x',
    partnerIdentifiedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    expiresAt: null,
    paidAt: '2026-01-02T10:00:00.000Z',
    confirmedAt: '2026-01-02T10:05:00.000Z',
    gatewayStatus: 'paid',
    gatewayTransactionId: 'txn_xyz',
    paymentMethod: 'pix',
    hasPaymentDivergence: false,
    googleSheetsStatus: 'synchronized',
    googleSheetsSynchronizedAt: '2026-01-02T10:06:00.000Z',
    confirmationEmailSentAt: '2026-01-02T10:07:00.000Z',
    confirmationEmailProvider: 'resend',
    confirmationEmailId: 'msg_1',
    confirmationEmailError: null,
  };
}

// ---- §13 masking ----

test('§13 maskEmail keeps first two chars + full domain, no length leak', () => {
  assert.equal(maskEmail('giovanni.miranda@example.com'), 'gi**************@example.com');
  assert.equal(maskEmail('ab@x.com'), 'ab****@x.com');
  assert.equal(maskEmail('a@x.com'), 'a****@x.com');
  assert.equal(maskEmail(''), '');
  assert.equal(maskEmail('not-an-email'), '***');
});

test('§13 maskPhone keeps only the last four digits', () => {
  assert.equal(maskPhone('11999991234'), '*******1234');
  assert.equal(maskPhone('+55 (11) 98888-7777'), '*********7777');
  assert.equal(maskPhone('12'), '**');
  assert.equal(maskPhone(''), '');
});

// ---- §25 / §35 operation list: absence, not null ----

test('§25/§35 operation list row OMITS financial + technical + partner + DOB fields', () => {
  const row = serializeAdminRegistrationForRole(fullRow(), 'operation', 'list');
  for (const field of OPERATION_HIDDEN_FIELDS) {
    assert.equal(field in row, false, `"${field}" must be ABSENT for operation, not null`);
  }
  // list view also drops emergency contact
  for (const field of OPERATION_DETAIL_ONLY_FIELDS) {
    assert.equal(field in row, false, `"${field}" must be absent from the operation LIST`);
  }
});

test('§25 operation list row keeps operational fields and masks e-mail / phone', () => {
  const row = serializeAdminRegistrationForRole(fullRow(), 'operation', 'list') as Record<string, unknown>;
  assert.equal(row.fullName, 'Giovanni Miranda');
  assert.equal(row.bibNumber, 'A123');
  assert.equal(row.distance, '10 KM');
  assert.equal(row.lot, 'Lote 1');
  assert.equal(row.shirtSize, 'M');
  assert.equal(row.status, 'paid');
  assert.equal(row.cpfMasked, '123.***.***-09');
  assert.equal(row.checkInStatus, 'not_started');
  assert.equal(row.kitStatus, 'not_delivered');
  assert.equal(row.email, 'gi**************@example.com');
  assert.equal(row.phone, '*******1234');
  // raw contact never present
  assert.notEqual(row.email, 'giovanni.miranda@example.com');
  assert.notEqual(row.phone, '11999991234');
});

// ---- §28 operation detail: emergency contact returns, financial still gone ----

test('§28 operation DETAIL keeps emergency contact but still no financial/gateway', () => {
  const row = serializeAdminRegistrationForRole(fullRow(), 'operation', 'detail') as Record<string, unknown>;
  assert.equal(row.emergencyContactName, 'Maria');
  assert.equal(row.emergencyContactPhone, '11988887777');
  assert.equal('amountCents' in row, false);
  assert.equal('gatewayStatus' in row, false);
  assert.equal('paymentMethod' in row, false);
  assert.equal('couponCode' in row, false);
  assert.equal('partnerName' in row, false);
  assert.equal(row.email, 'gi**************@example.com');
});

// ---- §26 / §27 administrator & finance: untouched ----

test('§26/§27 administrator and finance rows pass through byte-for-byte', () => {
  const original = fullRow();
  for (const role of ['administrator', 'finance'] as const) {
    const listed = serializeAdminRegistrationForRole(fullRow(), role, 'list');
    const detailed = serializeAdminRegistrationForRole(fullRow(), role, 'detail');
    assert.deepEqual(listed, original);
    assert.deepEqual(detailed, original);
    assert.equal(listed.amountCents, 9990);
    assert.equal(detailed.email, 'giovanni.miranda@example.com');
  }
});

test('serializer never mutates its input', () => {
  const row = fullRow();
  const snapshot = JSON.stringify(row);
  serializeAdminRegistrationForRole(row, 'operation', 'list');
  serializeAdminRegistrationForRole(row, 'operation', 'detail');
  assert.equal(JSON.stringify(row), snapshot);
});

test('serializeAdminRegistrationsForRole maps the whole page', () => {
  const rows = [fullRow(), { ...fullRow(), id: 'reg-2' }];
  const out = serializeAdminRegistrationsForRole(rows, 'operation', 'list');
  assert.equal(out.length, 2);
  for (const row of out) assert.equal('amountCents' in row, false);
  // admin untouched (same array reference is fine)
  assert.equal(serializeAdminRegistrationsForRole(rows, 'administrator', 'list'), rows);
});

// ---- §31 history ----

test('§31 operation history drops amount + payment timestamp, keeps status/id/canonical', () => {
  const history = [
    { id: 'a', status: 'expired', createdAt: '2026-01-01T00:00:00.000Z', amountCents: 9990, paidAt: null, isCanonical: false },
    { id: 'b', status: 'paid', createdAt: '2026-01-02T00:00:00.000Z', amountCents: 9990, paidAt: '2026-01-02T10:00:00.000Z', isCanonical: true },
  ];
  const out = serializeRegistrationHistoryForRole(history, 'operation');
  for (const item of out) {
    assert.equal('amountCents' in item, false);
    assert.equal('paidAt' in item, false);
  }
  assert.deepEqual(out.map((i) => [i.id, i.status, i.isCanonical]), [['a', 'expired', false], ['b', 'paid', true]]);
  // admin untouched
  assert.equal(serializeRegistrationHistoryForRole(history, 'administrator'), history);
});

// ---- timeline ----

test('operation timeline keeps only operational events with safe detail keys', () => {
  const events = [
    { id: '1', type: 'registration.created', occurredAt: 't1', details: { status: 'pending_payment', lotId: 'lot-1' } },
    { id: '2', type: 'checkout.started', occurredAt: 't2', details: { paymentId: 'pay_1' } },
    { id: '3', type: 'infinitepay.webhook_received', occurredAt: 't3', details: { providerEventId: 'evt', payload: { amount: 9990, card: '****' } } },
    { id: '4', type: 'payment.confirmed', occurredAt: 't4', details: { amountCents: 9990, transactionId: 'txn' } },
    { id: '5', type: 'check_in.completed', occurredAt: 't5', details: { notes: 'ok', ipAddress: '1.2.3.4' } },
    { id: '6', type: 'registration.updated', occurredAt: 't6', details: { before: { email: 'a@a.com' }, after: { email: 'b@b.com' }, ipAddress: '1.2.3.4' } },
    { id: '7', type: 'registration.bib_assigned', occurredAt: 't7', details: { reason: 'troca', previous: null, bibNumber: 'A9' } },
  ];
  const out = serializeRegistrationTimelineForRole(events, 'operation');
  assert.deepEqual(out.map((e) => e.id), ['1', '5', '7']);
  assert.deepEqual(out[0].details, { status: 'pending_payment' }); // lotId dropped
  assert.deepEqual(out[1].details, { notes: 'ok' });               // ipAddress dropped
  assert.deepEqual(out[2].details, { previous: null, bibNumber: 'A9' }); // reason dropped
  // admin sees the full stream
  assert.equal(serializeRegistrationTimelineForRole(events, 'administrator').length, events.length);
});

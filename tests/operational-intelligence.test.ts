import assert from 'node:assert/strict';
import test from 'node:test';
import type { Database, PaymentRecord, RegistrationRecord } from '../server/database';
import { buildExecutiveDashboard, buildRegistrationTimeline, detectOperationalAlerts } from '../server/operational-intelligence';

const now = new Date('2026-07-13T12:00:00.000Z');
const registration = (id: string, status: RegistrationRecord['status'], overrides: Partial<RegistrationRecord> = {}): RegistrationRecord => ({
  id, eventId: 'event', distanceId: 'distance', lotId: 'lot', cpfHash: id, status, amountCents: 10_000,
  payload: { city: 'Manaus', state: 'AM', gender: 'female', distance: '5K', shirtSize: 'M', birthDate: '1996-01-01', attribution: { utmSource: 'instagram', utmCampaign: 'lançamento' } } as RegistrationRecord['payload'],
  createdAt: '2026-07-13T10:00:00.000Z', updatedAt: '2026-07-13T10:00:00.000Z', ...overrides,
});
const payment = (id: string, registrationId: string, overrides: Partial<PaymentRecord> = {}): PaymentRecord => ({
  id, registrationId, provider: 'infinitepay', status: 'pending_payment', amountCents: 10_000,
  providerPaymentId: id, gatewayTransactionId: null, checkoutUrl: `https://checkout/${id}`,
  createdAt: '2026-07-13T10:01:00.000Z', updatedAt: '2026-07-13T10:01:00.000Z', ...overrides,
});
const database = (overrides: Partial<Database> = {}): Database => ({
  events: [{ id: 'event', name: 'Funpace', slug: 'funpace', status: 'published', date: '2026-08-01', startTime: '06:00', locationName: 'Arena', city: 'Manaus', state: 'AM' }],
  distances: [{ id: 'distance', eventId: 'event', name: '5K', distanceKm: 5, capacity: 100, status: 'active' }],
  lots: [{ id: 'lot', eventId: 'event', name: 'Lote 1', priceCents: 10_000, capacity: 2, soldCount: 0, status: 'active', startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2026-12-31T00:00:00.000Z', orderIndex: 1, continuesAfterCapacity: false }],
  registrations: [], payments: [], paymentEvents: [], googleSheetSyncs: [], checkIns: [], kitDeliveries: [], auditLogs: [], adminSessions: [], adminUsers: [], partnershipLeads: [], ...overrides,
});

test('executive dashboard calculates finance, conversion and four-state lot capacity', () => {
  const paid = registration('paid', 'paid', { paidAt: '2026-07-13T11:00:00.000Z', confirmedAt: '2026-07-13T11:00:01.000Z', confirmationEmailSentAt: '2026-07-13T11:01:00.000Z' });
  const reserved = registration('reserved', 'pending_payment', { expiresAt: '2026-07-13T12:30:00.000Z' });
  const result = buildExecutiveDashboard(database({ registrations: [paid, reserved], payments: [payment('paid-payment', paid.id, { status: 'paid', paidAt: paid.paidAt }), payment('reserved-payment', reserved.id)] }), now);
  assert.equal(result.financial.grossRevenueCents, 10_000);
  assert.equal(result.registrations.confirmed, 1);
  assert.deepEqual({ confirmed: result.lots[0].confirmed, temporaryReservations: result.lots[0].temporaryReservations, available: result.lots[0].available, level: result.lots[0].level }, { confirmed: 1, temporaryReservations: 1, available: 0, level: 'blocked' });
  assert.equal(result.marketing.topSource, 'Instagram');
});

test('alert detector identifies duplicate transactions and operational gaps', () => {
  const paid = registration('paid', 'paid', { confirmationEmailError: 'resend unavailable' });
  const db = database({ registrations: [paid, registration('orphan-registration', 'pending_payment')], payments: [payment('one', paid.id, { gatewayTransactionId: 'tx-1' }), payment('two', paid.id, { gatewayTransactionId: 'tx-1' })] });
  const types = detectOperationalAlerts(db, now).map((alert) => alert.alertType);
  assert.ok(types.includes('email_failure'));
  assert.ok(types.includes('registration_without_payment'));
  assert.ok(types.includes('duplicate_payment'));
});

test('registration timeline merges payment, webhook, email, sheet, kit and check-in chronologically', () => {
  const paid = registration('paid', 'paid', { paidAt: '2026-07-13T10:04:00.000Z', confirmedAt: '2026-07-13T10:05:00.000Z', confirmationEmailSentAt: '2026-07-13T10:07:00.000Z' });
  const pay = payment('payment', paid.id, { status: 'paid', paidAt: paid.paidAt });
  const db = database({
    registrations: [paid], payments: [pay],
    paymentEvents: [{ id: 'webhook', paymentId: pay.id, providerEventId: 'event-1', eventType: 'infinitepay.webhook', payload: {}, receivedAt: '2026-07-13T10:03:00.000Z' }],
    googleSheetSyncs: [{ id: 'sheet', entityType: 'registration', entityId: paid.id, sheetName: 'registrations', operation: 'upsert', status: 'synchronized', rowNumber: 2, attempts: 1, lastAttemptAt: '2026-07-13T10:06:00.000Z', synchronizedAt: '2026-07-13T10:06:00.000Z', lastError: null, createdAt: '2026-07-13T10:05:00.000Z', updatedAt: '2026-07-13T10:06:00.000Z' }],
    kitDeliveries: [{ id: 'kit', registrationId: paid.id, status: 'delivered', deliveredAt: '2026-07-20T10:00:00.000Z', deliveredBy: 'ops', notes: null }],
    checkIns: [{ id: 'checkin', registrationId: paid.id, status: 'checked_in', checkedInAt: '2026-08-01T05:30:00.000Z', checkedInBy: 'ops', notes: null }],
  });
  const timeline = buildRegistrationTimeline(db, paid.id);
  assert.deepEqual(timeline.map((event) => event.occurredAt), timeline.map((event) => event.occurredAt).sort());
  assert.ok(timeline.some((event) => event.type === 'email.sent'));
  assert.ok(timeline.some((event) => event.type === 'check_in.completed'));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import type { Database, PaymentEventRecord, PaymentRecord, RegistrationRecord } from '../server/database';
import { buildExecutiveMetrics, personIdentityKey, toPercent1 } from '../server/executive-metrics';

const NOW = new Date('2026-07-13T12:00:00.000Z');

const registration = (
  id: string,
  status: RegistrationRecord['status'],
  overrides: Partial<RegistrationRecord> = {},
): RegistrationRecord => ({
  id, eventId: 'event', distanceId: 'distance', lotId: 'lot', cpfHash: `cpf-${id}`, status, amountCents: 10_000,
  payload: { city: 'Porto Velho', state: 'RO', gender: 'female', distance: '5K', shirtSize: 'M', birthDate: '1996-01-01' } as RegistrationRecord['payload'],
  createdAt: '2026-07-13T09:00:00.000Z', updatedAt: '2026-07-13T09:00:00.000Z', ...overrides,
});

const payment = (
  id: string,
  registrationId: string,
  overrides: Partial<PaymentRecord> = {},
): PaymentRecord => ({
  id, registrationId, provider: 'infinitepay', status: 'pending_payment', amountCents: 10_000,
  providerPaymentId: id, gatewayTransactionId: null, checkoutUrl: `https://checkout/${id}`,
  createdAt: '2026-07-13T09:01:00.000Z', updatedAt: '2026-07-13T09:01:00.000Z', ...overrides,
});

const database = (overrides: Partial<Database> = {}): Database => ({
  events: [], distances: [], lots: [],
  registrations: [], payments: [], paymentEvents: [], emailDeliveries: [], googleSheetSyncs: [],
  checkIns: [], kitDeliveries: [], auditLogs: [], adminSessions: [], adminUsers: [],
  partnershipLeads: [], partners: [], ...overrides,
});

// -- §30 gross --------------------------------------------------------------
test('grossRevenueCents: paid only, manual included, expired and cancelled excluded', () => {
  const db = database({
    registrations: [
      registration('a', 'paid', { amountCents: 8_000 }),
      registration('b', 'paid', { amountCents: 9_000 }),
      registration('m', 'paid', { amountCents: 5_000 }), // manual pix, no checkout
      registration('c', 'expired', { amountCents: 100_000 }),
      registration('d', 'cancelled', { amountCents: 100_000 }),
    ],
    payments: [
      payment('pa', 'a', { status: 'paid', amountCents: 8_000 }),
      payment('pb', 'b', { status: 'paid', amountCents: 9_000 }),
      payment('pm', 'm', { status: 'paid', amountCents: 5_000, provider: 'manual_pix', providerPaymentId: null, checkoutUrl: null, gatewayStatus: 'manual_reconciled_paid' }),
    ],
  });
  const metrics = buildExecutiveMetrics(db, NOW);
  assert.equal(metrics.financial.grossRevenueCents, 22_000);
});

// -- §31 confirmed --------------------------------------------------------------
test('confirmedRevenueCents: only paid registrations reconciled against a paid payment; never a fabricated net', () => {
  const db = database({
    registrations: [
      registration('a', 'paid', { amountCents: 8_000 }),
      registration('b', 'paid', { amountCents: 9_000 }), // paid registration, no paid payment row
    ],
    payments: [payment('pa', 'a', { status: 'paid', amountCents: 8_000 })],
  });
  const metrics = buildExecutiveMetrics(db, NOW);
  assert.equal(metrics.financial.grossRevenueCents, 17_000);
  assert.equal(metrics.financial.confirmedRevenueCents, 8_000);
  assert.ok(!('netRevenueCents' in metrics.financial));
  assert.ok(!('estimatedFeesCents' in metrics.financial));
  assert.ok(!('refundedCents' in metrics.financial));
});

// -- §32 ticket --------------------------------------------------------------
test('averageTicketCents: gross / paid rows, zero when no paid population, never a lot price', () => {
  const withPaid = buildExecutiveMetrics(database({
    registrations: [registration('a', 'paid', { amountCents: 8_000 }), registration('b', 'paid', { amountCents: 9_001 })],
    payments: [payment('pa', 'a', { status: 'paid' }), payment('pb', 'b', { status: 'paid' })],
  }), NOW);
  assert.equal(withPaid.financial.averageTicketCents, Math.round(17_001 / 2)); // 8501

  const noPaid = buildExecutiveMetrics(database({
    lots: [{ id: 'lot', eventId: 'event', name: 'Lote', priceCents: 12_345, capacity: 10, soldCount: 0, status: 'active', startsAt: '', endsAt: '', orderIndex: 1, continuesAfterCapacity: false }],
    registrations: [registration('x', 'expired')],
  }), NOW);
  assert.equal(noPaid.financial.averageTicketCents, 0);
});

// -- §33 unique people --------------------------------------------------------------
test('uniquePeople: multiple retries by the same identity collapse to one', () => {
  const db = database({
    registrations: [
      registration('r1', 'expired', { cpfHash: 'same-person' }),
      registration('r2', 'cancelled', { cpfHash: 'same-person' }),
      registration('r3', 'paid', { cpfHash: 'same-person' }),
      registration('r4', 'paid', { cpfHash: 'other-person' }),
    ],
    payments: [payment('p3', 'r3', { status: 'paid' }), payment('p4', 'r4', { status: 'paid' })],
  });
  const metrics = buildExecutiveMetrics(db, NOW);
  assert.equal(metrics.registrations.registrationRows, 4);
  assert.equal(metrics.registrations.uniquePeople, 2);
});

// -- §34 unique paid people --------------------------------------------------------------
test('uniquePaidPeople: several rows, same identity, one paid -> counted once', () => {
  const db = database({
    registrations: [
      registration('r1', 'expired', { cpfHash: 'person-a' }),
      registration('r2', 'paid', { cpfHash: 'person-a' }),
      registration('r3', 'paid', { cpfHash: 'person-a' }),
    ],
    payments: [payment('p2', 'r2', { status: 'paid' }), payment('p3', 'r3', { status: 'paid' })],
  });
  const metrics = buildExecutiveMetrics(db, NOW);
  assert.equal(metrics.registrations.paidRegistrationRows, 2);
  assert.equal(metrics.registrations.uniquePaidPeople, 1);
});

// -- §35 participant conversion --------------------------------------------------------------
test('participantConversionRate: uniquePaidPeople / uniquePeople with one decimal', () => {
  // 3 unique people, 2 unique paid -> 66.7
  const db = database({
    registrations: [
      registration('r1', 'paid', { cpfHash: 'p1' }),
      registration('r2', 'expired', { cpfHash: 'p1' }),
      registration('r3', 'paid', { cpfHash: 'p2' }),
      registration('r4', 'expired', { cpfHash: 'p3' }),
    ],
    payments: [payment('p1', 'r1', { status: 'paid' }), payment('p3', 'r3', { status: 'paid' })],
  });
  const metrics = buildExecutiveMetrics(db, NOW);
  assert.equal(metrics.registrations.uniquePeople, 3);
  assert.equal(metrics.registrations.uniquePaidPeople, 2);
  assert.equal(metrics.registrations.participantConversionRate, 66.7);
  assert.equal(buildExecutiveMetrics(database(), NOW).registrations.participantConversionRate, 0);
});

test('toPercent1 is the single rounding rule: one decimal place', () => {
  assert.equal(toPercent1(230, 375), 61.3);
  assert.equal(toPercent1(2, 3), 66.7);
  assert.equal(toPercent1(1, 0), 0);
});

// -- §36 checkout population --------------------------------------------------------------
test('checkout paid does not grow from a manual payment that never had a checkout', () => {
  const db = database({
    registrations: [
      registration('a', 'paid'),
      registration('b', 'paid'),
      registration('m', 'paid'),
    ],
    payments: [
      payment('pa', 'a', { status: 'paid' }), // real checkout
      payment('pb', 'b', { status: 'pending_payment' }), // real checkout, unpaid
      payment('pm', 'm', { status: 'paid', provider: 'manual_pix', providerPaymentId: null, checkoutUrl: null }), // no checkout artefact
    ],
  });
  const metrics = buildExecutiveMetrics(db, NOW);
  assert.equal(metrics.checkouts.created, 2); // pa + pb only
  assert.equal(metrics.checkouts.paid, 1); // pa only; manual pm excluded from BOTH sides
  assert.equal(metrics.checkouts.checkoutConversionRate, 50);
});

test('checkout created counts a payment whose checkout artefact is only a checkout_created event', () => {
  const events: PaymentEventRecord[] = [
    { id: 'e1', paymentId: 'pe', providerEventId: 'x1', eventType: 'infinitepay.checkout_created', payload: {}, receivedAt: '2026-07-13T09:02:00.000Z' },
  ];
  const db = database({
    registrations: [registration('e', 'pending_payment')],
    payments: [payment('pe', 'e', { status: 'pending_payment', providerPaymentId: null, checkoutUrl: null })],
    paymentEvents: events,
  });
  assert.equal(buildExecutiveMetrics(db, NOW).checkouts.created, 1);
});

// -- §37 abandonment bounds --------------------------------------------------------------
test('abandonmentRate stays within 0..100 and mirrors checkout conversion', () => {
  const allPaid = buildExecutiveMetrics(database({
    registrations: [registration('a', 'paid')],
    payments: [payment('pa', 'a', { status: 'paid' })],
  }), NOW);
  assert.equal(allPaid.checkouts.checkoutConversionRate, 100);
  assert.equal(allPaid.checkouts.abandonmentRate, 0);

  const nonePaid = buildExecutiveMetrics(database({
    registrations: [registration('a', 'expired')],
    payments: [payment('pa', 'a', { status: 'expired' })],
  }), NOW);
  assert.equal(nonePaid.checkouts.abandonmentRate, 100);

  const empty = buildExecutiveMetrics(database(), NOW);
  assert.ok(empty.checkouts.abandonmentRate >= 0 && empty.checkouts.abandonmentRate <= 100);
});

test('personIdentityKey never returns a raw email / name and falls back per registration id', () => {
  const key = personIdentityKey(registration('z', 'paid', { cpfHash: '' }));
  assert.equal(key, 'registration:z');
});

// -- §21 today revenue in America/Porto_Velho -------------------------------
test('todayRevenueCents uses the business-local calendar day, not UTC', () => {
  // now = 2026-08-30 06:00 local (10:00Z) -> business "today" = 2026-08-30
  const now = new Date('2026-08-30T10:00:00.000Z');
  const db = database({
    registrations: [
      // paid 2026-08-30 01:00 local (05:00Z) -> today
      registration('a', 'paid', { amountCents: 5_000, paidAt: '2026-08-30T05:00:00.000Z' }),
      // paid 2026-08-29 22:00 local (2026-08-30T02:00Z) -> YESTERDAY local, but "today" in UTC
      registration('b', 'paid', { amountCents: 7_000, paidAt: '2026-08-30T02:00:00.000Z' }),
      // paid 2026-08-28 -> outside
      registration('c', 'paid', { amountCents: 9_000, paidAt: '2026-08-28T15:00:00.000Z' }),
    ],
    payments: [
      payment('pa', 'a', { status: 'paid' }), payment('pb', 'b', { status: 'paid' }), payment('pc', 'c', { status: 'paid' }),
    ],
  });
  const metrics = buildExecutiveMetrics(db, now);
  assert.equal(metrics.financial.todayRevenueCents, 5_000); // only 'a'; 'b' is local-yesterday
});

// -- §22 week revenue: current calendar week to date, Monday start ----------
test('weekRevenueCents runs from Monday 00:00 local, not rolling 7 days', () => {
  // now = Wednesday 2026-08-26 11:00 local (15:00Z)
  const now = new Date('2026-08-26T15:00:00.000Z');
  const db = database({
    registrations: [
      // Sunday 2026-08-23 23:59 local (2026-08-24T03:59Z) -> BEFORE this week
      registration('sun', 'paid', { amountCents: 4_000, paidAt: '2026-08-24T03:59:00.000Z' }),
      // Monday 2026-08-24 00:05 local (04:05Z) -> in week-to-date
      registration('mon', 'paid', { amountCents: 6_000, paidAt: '2026-08-24T04:05:00.000Z' }),
      // Wednesday today -> in
      registration('wed', 'paid', { amountCents: 8_000, paidAt: '2026-08-26T14:00:00.000Z' }),
      // 6 days ago (would be inside a rolling-7d-UTC window) but last week -> out
      registration('lastweek', 'paid', { amountCents: 50_000, paidAt: '2026-08-20T12:00:00.000Z' }),
    ],
    payments: [
      payment('psun', 'sun', { status: 'paid' }), payment('pmon', 'mon', { status: 'paid' }),
      payment('pwed', 'wed', { status: 'paid' }), payment('plw', 'lastweek', { status: 'paid' }),
    ],
  });
  const metrics = buildExecutiveMetrics(db, now);
  assert.equal(metrics.financial.weekRevenueCents, 14_000); // mon + wed only
});

// -- ADMIN-002 Stage 4B: event scope ---------------------------------------
const lot = (id: string, eventId: string) => ({
  id, eventId, name: id, priceCents: 10_000, capacity: 100, soldCount: 0, status: 'active' as const,
  startsAt: '', endsAt: '', orderIndex: 1, continuesAfterCapacity: false,
});

test('§41/§43 buildExecutiveMetrics(eventId) isolates one event from another', () => {
  const db = database({
    events: [
      { id: 'A', name: 'A', slug: 'a', status: 'published', date: '2026-09-20', startTime: '06:00', locationName: 'x', city: 'x', state: 'RO' },
      { id: 'B', name: 'B', slug: 'b', status: 'published', date: '2026-10-20', startTime: '06:00', locationName: 'x', city: 'x', state: 'RO' },
    ],
    lots: [lot('lA', 'A'), lot('lB', 'B')],
    registrations: [
      registration('a1', 'paid', { eventId: 'A', cpfHash: 'p1', amountCents: 10_000, lotId: 'lA' }),
      registration('a2', 'paid', { eventId: 'A', cpfHash: 'p2', amountCents: 10_000, lotId: 'lA' }),
      registration('b1', 'paid', { eventId: 'B', cpfHash: 'p3', amountCents: 30_000, lotId: 'lB' }),
      registration('bX', 'expired', { eventId: 'B', cpfHash: 'p4', lotId: 'lB' }),
    ],
    payments: [
      payment('pa1', 'a1', { status: 'paid' }), payment('pa2', 'a2', { status: 'paid' }),
      payment('pb1', 'b1', { status: 'paid' }), payment('pbX', 'bX', { status: 'expired' }),
    ],
  });

  const a = buildExecutiveMetrics(db, NOW, { eventId: 'A' });
  assert.equal(a.financial.grossRevenueCents, 20_000);
  assert.equal(a.financial.confirmedRevenueCents, 20_000);
  assert.equal(a.registrations.registrationRows, 2);
  assert.equal(a.registrations.paidRegistrationRows, 2);
  assert.equal(a.checkouts.paid, 2);

  const b = buildExecutiveMetrics(db, NOW, { eventId: 'B' });
  assert.equal(b.financial.grossRevenueCents, 30_000);
  assert.equal(b.registrations.registrationRows, 2); // b1 + bX
  assert.equal(b.registrations.paidRegistrationRows, 1);
  assert.equal(b.checkouts.created, 2); // pb1 + pbX had checkout urls
  assert.equal(b.checkouts.paid, 1);

  // no eventId -> ambiguous is the resolver's job; the engine simply aggregates all
  const all = buildExecutiveMetrics(db, NOW);
  assert.equal(all.financial.grossRevenueCents, 50_000);
});

test('§42 same person in Event A and Event B counts once per event, not cross-contaminated', () => {
  const db = database({
    events: [
      { id: 'A', name: 'A', slug: 'a', status: 'published', date: '2026-09-20', startTime: '06:00', locationName: 'x', city: 'x', state: 'RO' },
      { id: 'B', name: 'B', slug: 'b', status: 'published', date: '2026-10-20', startTime: '06:00', locationName: 'x', city: 'x', state: 'RO' },
    ],
    registrations: [
      registration('a-x', 'paid', { eventId: 'A', cpfHash: 'same-person' }),
      registration('a-y', 'paid', { eventId: 'A', cpfHash: 'other-a' }),
      registration('b-x', 'paid', { eventId: 'B', cpfHash: 'same-person' }),
    ],
    payments: [payment('pa', 'a-x', { status: 'paid' }), payment('pay', 'a-y', { status: 'paid' }), payment('pb', 'b-x', { status: 'paid' })],
  });
  assert.equal(buildExecutiveMetrics(db, NOW, { eventId: 'A' }).registrations.uniquePeople, 2);
  assert.equal(buildExecutiveMetrics(db, NOW, { eventId: 'A' }).registrations.uniquePaidPeople, 2);
  assert.equal(buildExecutiveMetrics(db, NOW, { eventId: 'B' }).registrations.uniquePeople, 1);
  // per-event sum is 2 + 1 = 3, but the shared person makes the GLOBAL distinct
  // count 2 — the exact divergence Stage 4A flagged; scoping is what fixes it.
  assert.equal(buildExecutiveMetrics(db, NOW, { eventId: 'A' }).registrations.uniquePeople
    + buildExecutiveMetrics(db, NOW, { eventId: 'B' }).registrations.uniquePeople, 3);
  assert.equal(buildExecutiveMetrics(db, NOW).registrations.uniquePeople, 2);
});

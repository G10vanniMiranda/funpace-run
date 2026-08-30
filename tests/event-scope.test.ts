import assert from 'node:assert/strict';
import test from 'node:test';
import type { Database, EventRecord } from '../server/database';
import { eventContext, resolveEventScope, scopeDatabaseToEvent } from '../server/event-scope';

const event = (id: string, status: EventRecord['status'], overrides: Partial<EventRecord> = {}): EventRecord => ({
  id, name: `Event ${id}`, slug: `slug-${id}`, status, date: '2026-09-20', startTime: '06:00',
  locationName: 'Arena', city: 'Porto Velho', state: 'RO', ...overrides,
});

// -- §4 resolution contract --------------------------------------------------
test('resolveEventScope: explicit eventId must exist', () => {
  const events = [event('a', 'published'), event('b', 'closed')];
  assert.deepEqual(resolveEventScope(events, { eventId: 'b' }), { ok: true, event: events[1] });
  const missing = resolveEventScope(events, { eventId: 'ghost' });
  assert.equal(missing.ok, false);
  assert.equal((missing as { code: string }).code, 'EVENT_NOT_FOUND');
});

test('resolveEventScope: explicit slug resolves (published or closed)', () => {
  const events = [event('a', 'published'), event('b', 'closed')];
  assert.deepEqual(resolveEventScope(events, { eventSlug: 'slug-b' }), { ok: true, event: events[1] });
  assert.deepEqual(resolveEventScope(events, 'slug-a'), { ok: true, event: events[0] });
});

test('resolveEventScope: no selector + exactly one published event -> that event', () => {
  const events = [event('a', 'published'), event('b', 'closed'), event('c', 'draft')];
  assert.deepEqual(resolveEventScope(events), { ok: true, event: events[0] });
});

test('resolveEventScope: no selector + zero published -> NO_PUBLISHED_EVENT', () => {
  const result = resolveEventScope([event('a', 'closed'), event('b', 'draft')]);
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, 'NO_PUBLISHED_EVENT');
});

test('resolveEventScope: no selector + two published -> EVENT_SCOPE_AMBIGUOUS (never events[0])', () => {
  const result = resolveEventScope([event('a', 'published'), event('b', 'published')]);
  assert.equal(result.ok, false);
  assert.equal((result as { code: string; publishedCount: number }).code, 'EVENT_SCOPE_AMBIGUOUS');
  assert.equal((result as { publishedCount: number }).publishedCount, 2);
});

test('eventContext exposes only non-sensitive metadata', () => {
  assert.deepEqual(eventContext(event('a', 'published')), {
    id: 'a', slug: 'slug-a', name: 'Event a', status: 'published', date: '2026-09-20',
  });
});

// -- scopeDatabaseToEvent isolation ----------------------------------------
const emptyDb = (overrides: Partial<Database> = {}): Database => ({
  events: [], distances: [], lots: [], registrations: [], payments: [], paymentEvents: [],
  emailDeliveries: [], googleSheetSyncs: [], checkIns: [], kitDeliveries: [], auditLogs: [],
  adminSessions: [], adminUsers: [], partnershipLeads: [], partners: [], ...overrides,
});

test('scopeDatabaseToEvent narrows every event-derived table and is idempotent', () => {
  const db = emptyDb({
    events: [event('A', 'published'), event('B', 'published')],
    registrations: [
      { id: 'rA', eventId: 'A', distanceId: 'dA', lotId: 'lA', cpfHash: 'p1', status: 'paid', amountCents: 1, payload: {} as never, createdAt: '', updatedAt: '' },
      { id: 'rB', eventId: 'B', distanceId: 'dB', lotId: 'lB', cpfHash: 'p2', status: 'paid', amountCents: 1, payload: {} as never, createdAt: '', updatedAt: '' },
    ],
    payments: [
      { id: 'pA', registrationId: 'rA', provider: 'infinitepay', status: 'paid', amountCents: 1, providerPaymentId: 'x', checkoutUrl: 'c', gatewayTransactionId: null, createdAt: '', updatedAt: '' },
      { id: 'pB', registrationId: 'rB', provider: 'infinitepay', status: 'paid', amountCents: 1, providerPaymentId: 'y', checkoutUrl: 'c', gatewayTransactionId: null, createdAt: '', updatedAt: '' },
    ],
    paymentEvents: [
      { id: 'eA', paymentId: 'pA', providerEventId: 'n1', eventType: 'infinitepay.webhook', payload: {}, receivedAt: '' },
      { id: 'eB', paymentId: 'pB', providerEventId: 'n2', eventType: 'infinitepay.webhook', payload: {}, receivedAt: '' },
    ],
    lots: [
      { id: 'lA', eventId: 'A', name: 'A', priceCents: 1, capacity: 1, soldCount: 0, status: 'active', startsAt: '', endsAt: '', orderIndex: 1, continuesAfterCapacity: false },
      { id: 'lB', eventId: 'B', name: 'B', priceCents: 1, capacity: 1, soldCount: 0, status: 'active', startsAt: '', endsAt: '', orderIndex: 1, continuesAfterCapacity: false },
    ],
    distances: [
      { id: 'dA', eventId: 'A', name: '5K', distanceKm: 5, capacity: 1, status: 'active' },
      { id: 'dB', eventId: 'B', name: '5K', distanceKm: 5, capacity: 1, status: 'active' },
    ],
    checkIns: [
      { id: 'ciA', registrationId: 'rA', status: 'checked_in', checkedInAt: '', checkedInBy: 'x', notes: null },
      { id: 'ciB', registrationId: 'rB', status: 'checked_in', checkedInAt: '', checkedInBy: 'x', notes: null },
    ],
    kitDeliveries: [
      { id: 'kA', registrationId: 'rA', status: 'delivered', deliveredAt: '', deliveredBy: 'x', notes: null },
      { id: 'kB', registrationId: 'rB', status: 'delivered', deliveredAt: '', deliveredBy: 'x', notes: null },
    ],
  });

  const a = scopeDatabaseToEvent(db, 'A');
  assert.deepEqual(a.registrations.map((r) => r.id), ['rA']);
  assert.deepEqual(a.payments.map((p) => p.id), ['pA']);
  assert.deepEqual(a.paymentEvents.map((e) => e.id), ['eA']);
  assert.deepEqual(a.lots.map((l) => l.id), ['lA']);
  assert.deepEqual(a.distances.map((d) => d.id), ['dA']);
  assert.deepEqual(a.checkIns.map((c) => c.id), ['ciA']);
  assert.deepEqual(a.kitDeliveries.map((k) => k.id), ['kA']);
  assert.deepEqual(a.events.map((e) => e.id), ['A']);

  // idempotent
  const twice = scopeDatabaseToEvent(a, 'A');
  assert.deepEqual(twice.registrations.map((r) => r.id), ['rA']);
});

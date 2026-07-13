import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateLotCapacity, selectLotWithAvailability, synchronizeLotProjections } from '../server/lot-capacity';
import type { LotRecord, RegistrationRecord } from '../server/database';

const lot = (id: string, capacity: number, orderIndex = 1): LotRecord => ({
  id, eventId: 'event', name: id, priceCents: 1000, capacity, soldCount: 99,
  status: 'active', startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2027-01-01T00:00:00.000Z',
  orderIndex, continuesAfterCapacity: false,
});

const registration = (id: string, lotId: string, status: RegistrationRecord['status'], expiresAt?: string): RegistrationRecord => ({
  id, eventId: 'event', distanceId: 'distance', lotId, cpfHash: id, status, amountCents: 1000,
  payload: {} as RegistrationRecord['payload'], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  expiresAt,
});

test('capacity separates confirmed sales, active reservations and available seats', () => {
  const now = new Date('2026-07-13T12:00:00.000Z');
  const state = calculateLotCapacity(lot('lot-1', 5), [
    registration('paid-1', 'lot-1', 'paid'),
    registration('pending-active', 'lot-1', 'pending_payment', '2026-07-13T12:10:00.000Z'),
    registration('pending-expired', 'lot-1', 'pending_payment', '2026-07-13T11:59:00.000Z'),
    registration('cancelled', 'lot-1', 'cancelled'),
  ], now);

  assert.deepEqual(state, { capacityTotal: 5, confirmed: 1, temporaryReservations: 1, occupied: 2, available: 3 });
});

test('lot selection never overbooks and advances to the next configured lot', () => {
  const now = new Date('2026-07-13T12:00:00.000Z');
  const lots = [lot('lot-1', 2, 1), lot('lot-2', 3, 2)];
  const registrations = [
    registration('paid', 'lot-1', 'paid'),
    registration('reserved', 'lot-1', 'pending_payment', '2026-07-13T12:10:00.000Z'),
  ];
  assert.equal(selectLotWithAvailability(lots, registrations, 'event', now)?.id, 'lot-2');
});

test('legacy soldCount projection contains confirmed sales only', () => {
  const lots = [lot('lot-1', 2)];
  const registrations = [
    registration('paid', 'lot-1', 'paid'),
    registration('reserved', 'lot-1', 'pending_payment', '2099-01-01T00:00:00.000Z'),
  ];
  synchronizeLotProjections({ lots, registrations }, new Date('2026-07-13T12:00:00.000Z'));
  assert.equal(lots[0].soldCount, 1);
  assert.equal(lots[0].status, 'sold_out');
});

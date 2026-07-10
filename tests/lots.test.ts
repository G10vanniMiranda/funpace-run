import test from 'node:test';
import assert from 'node:assert/strict';
import { selectLotForRegistrationNumber, type LotRecord } from '../server/database.js';

const lots: LotRecord[] = [
  {
    id: 'lot-1',
    eventId: 'funpace-run-2026',
    name: 'Lote 1',
    priceCents: 7990,
    capacity: 100,
    soldCount: 0,
    status: 'active',
    startsAt: '2026-06-01T00:00:00-04:00',
    endsAt: '2026-07-31T23:59:59-04:00',
    orderIndex: 1,
    continuesAfterCapacity: false,
  },
  {
    id: 'lot-2',
    eventId: 'funpace-run-2026',
    name: 'Lote 2',
    priceCents: 9990,
    capacity: 400,
    soldCount: 0,
    status: 'active',
    startsAt: '2026-08-01T00:00:00-04:00',
    endsAt: '2026-08-31T23:59:59-04:00',
    orderIndex: 2,
    continuesAfterCapacity: false,
  },
  {
    id: 'lot-3',
    eventId: 'funpace-run-2026',
    name: 'Lote 3',
    priceCents: 13990,
    capacity: 100,
    soldCount: 0,
    status: 'active',
    startsAt: '2026-09-01T00:00:00-04:00',
    endsAt: '2026-09-10T23:59:59-04:00',
    orderIndex: 3,
    continuesAfterCapacity: false,
  },
  {
    id: 'lot-4',
    eventId: 'funpace-run-2026',
    name: 'Lote 4',
    priceCents: 16990,
    capacity: 100,
    soldCount: 0,
    status: 'active',
    startsAt: '2026-09-11T00:00:00-04:00',
    endsAt: '2026-09-20T23:59:59-04:00',
    orderIndex: 4,
    continuesAfterCapacity: true,
  },
];

test('selects Lote 1 through registration 100 and Lote 2 from 101', () => {
  assert.equal(selectLotForRegistrationNumber(lots, 100)?.id, 'lot-1');
  assert.equal(selectLotForRegistrationNumber(lots, 100)?.priceCents, 7990);
  assert.equal(selectLotForRegistrationNumber(lots, 101)?.id, 'lot-2');
  assert.equal(selectLotForRegistrationNumber(lots, 101)?.priceCents, 9990);
});

test('selects Lote 2 through registration 500 and Lote 3 from 501', () => {
  assert.equal(selectLotForRegistrationNumber(lots, 500)?.id, 'lot-2');
  assert.equal(selectLotForRegistrationNumber(lots, 500)?.priceCents, 9990);
  assert.equal(selectLotForRegistrationNumber(lots, 501)?.id, 'lot-3');
  assert.equal(selectLotForRegistrationNumber(lots, 501)?.priceCents, 13990);
});

test('selects Lote 3 through registration 600 and Lote 4 from 601', () => {
  assert.equal(selectLotForRegistrationNumber(lots, 600)?.id, 'lot-3');
  assert.equal(selectLotForRegistrationNumber(lots, 600)?.priceCents, 13990);
  assert.equal(selectLotForRegistrationNumber(lots, 601)?.id, 'lot-4');
  assert.equal(selectLotForRegistrationNumber(lots, 601)?.priceCents, 16990);
});

test('keeps Lote 4 price after registration 700', () => {
  assert.equal(selectLotForRegistrationNumber(lots, 700)?.id, 'lot-4');
  assert.equal(selectLotForRegistrationNumber(lots, 701)?.id, 'lot-4');
  assert.equal(selectLotForRegistrationNumber(lots, 1000)?.priceCents, 16990);
});

test('returns null after configured capacity when no lot continues', () => {
  const cappedLots = lots.map((lot) => ({ ...lot, continuesAfterCapacity: false }));
  assert.equal(selectLotForRegistrationNumber(cappedLots, 701), null);
});

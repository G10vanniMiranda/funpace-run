import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LOT_STATUSES,
  LOT_UPDATE_REQUIRED_KEYS,
  buildLotUpdatePayload,
} from '../src/lib/admin-lot-mutation';

// ADMIN-UX-HOTFIX-001 — the payload builder for PATCH /api/admin/lots/:id.
// handleAdminLotUpdate is FULL-REPLACE; the builder must always yield the exact
// seven fields the endpoint reads, or an explicit failure the caller surfaces.

const LOT3 = {
  id: 'lot-3',
  eventId: 'funpace-run-2026',
  name: 'Lote 3',
  priceCents: 13990,
  capacity: 100,
  soldCount: 0,
  status: 'inactive',
  startsAt: '2026-09-01T00:00:00-04:00',
  endsAt: '2026-09-10T23:59:59-04:00',
};

test('the exact EVENT-OPS-001 operator change: price 13990 -> 11990, status stays inactive', () => {
  const result = buildLotUpdatePayload({ ...LOT3, priceCents: 11990 }, 'EVENT-OPS-001 — Lote 3 corrigido para R$ 119,90.');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.payload, {
    name: 'Lote 3',
    capacity: 100,
    priceCents: 11990,
    status: 'inactive',
    startsAt: '2026-09-01T00:00:00-04:00',
    endsAt: '2026-09-10T23:59:59-04:00',
    reason: 'EVENT-OPS-001 — Lote 3 corrigido para R$ 119,90.',
  });
});

test('payload carries EXACTLY the seven required keys — no id / eventId / soldCount leakage, nothing missing', () => {
  const result = buildLotUpdatePayload({ ...LOT3, priceCents: 11990 }, 'motivo valido aqui');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(Object.keys(result.payload).sort(), [...LOT_UPDATE_REQUIRED_KEYS].sort());
  assert.equal('id' in result.payload, false);
  assert.equal('eventId' in result.payload, false);
  assert.equal('soldCount' in result.payload, false);
});

test('reason is trimmed and must be >= 5 chars', () => {
  assert.equal(buildLotUpdatePayload(LOT3, '   ').ok, false);
  assert.equal(buildLotUpdatePayload(LOT3, 'abcd').ok, false);
  const ok = buildLotUpdatePayload(LOT3, '  abcde  ');
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.payload.reason, 'abcde');
  const short = buildLotUpdatePayload(LOT3, 'oi');
  assert.equal(short.ok, false);
  if (!short.ok) assert.equal(short.field, 'reason');
});

test('missing lot -> explicit failure (never a silent return)', () => {
  const r = buildLotUpdatePayload(null, 'motivo valido');
  assert.equal(r.ok, false);
  if (!r.ok) { assert.equal(r.field, 'lot'); assert.match(r.error, /Recarregue/); }
  assert.equal(buildLotUpdatePayload(undefined, 'motivo valido').ok, false);
});

test('invalid price is rejected', () => {
  for (const bad of [-1, 1.5, NaN, 'x', undefined]) {
    const r = buildLotUpdatePayload({ ...LOT3, priceCents: bad as number }, 'motivo valido');
    assert.equal(r.ok, false, `priceCents=${String(bad)}`);
    if (!r.ok) assert.equal(r.field, 'priceCents');
  }
  assert.equal(buildLotUpdatePayload({ ...LOT3, priceCents: 0 }, 'motivo valido').ok, true);
});

test('capacity below sold_count is rejected; equal / above is allowed', () => {
  const r = buildLotUpdatePayload({ ...LOT3, capacity: 5, soldCount: 10 }, 'motivo valido');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.field, 'capacity');
  assert.equal(buildLotUpdatePayload({ ...LOT3, capacity: 10, soldCount: 10 }, 'motivo valido').ok, true);
  assert.equal(buildLotUpdatePayload({ ...LOT3, capacity: -1 }, 'motivo valido').ok, false);
});

test('status must be one of the endpoint-accepted values', () => {
  for (const s of LOT_STATUSES) {
    assert.equal(buildLotUpdatePayload({ ...LOT3, status: s }, 'motivo valido').ok, true, s);
  }
  const r = buildLotUpdatePayload({ ...LOT3, status: 'paused' }, 'motivo valido');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.field, 'status');
});

test('name is required and trimmed', () => {
  assert.equal(buildLotUpdatePayload({ ...LOT3, name: '   ' }, 'motivo valido').ok, false);
  const r = buildLotUpdatePayload({ ...LOT3, name: '  Lote 3  ' }, 'motivo valido');
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.payload.name, 'Lote 3');
});

test('sale window must keep a timezone offset and start must precede end', () => {
  // a bare datetime-local value (no zone) would move the turnover boundary — rejected
  const noZone = buildLotUpdatePayload({ ...LOT3, startsAt: '2026-09-01T00:00', endsAt: '2026-09-10T23:59' }, 'motivo valido');
  assert.equal(noZone.ok, false);
  if (!noZone.ok) { assert.equal(noZone.field, 'window'); assert.match(noZone.error, /fuso/); }

  // Z is accepted
  assert.equal(buildLotUpdatePayload({ ...LOT3, startsAt: '2026-09-01T04:00:00Z', endsAt: '2026-09-11T03:59:59Z' }, 'motivo valido').ok, true);

  // start >= end rejected
  const inverted = buildLotUpdatePayload({ ...LOT3, startsAt: '2026-09-10T00:00:00-04:00', endsAt: '2026-09-01T00:00:00-04:00' }, 'motivo valido');
  assert.equal(inverted.ok, false);
  if (!inverted.ok) assert.equal(inverted.field, 'window');

  // empty rejected
  assert.equal(buildLotUpdatePayload({ ...LOT3, startsAt: '' }, 'motivo valido').ok, false);
});

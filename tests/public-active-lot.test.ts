import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  canRegisterWithPublicActiveLot,
  publicRegistrationPriceCents,
  publicActiveLotOrNull,
  publicActiveLotPriceCents,
  publicActiveLotUnavailableLabel,
  selectPublicActiveLot,
} from '../src/lib/publicActiveLot';
import { createSharedInFlightLoader } from '../src/hooks/usePublicAvailability';
import type { AvailabilityResponse } from '../src/types/registration';

// EVENT-OPS-001 — the public "current lot" must come from the canonical ACTIVE
// lot (/api/availability, lot.status === 'active'), never a static name/price,
// never an inactive lot that still appears in the list. A price turnover
// (Lote 2 -> Lote 3 -> Lote 4) must require ZERO source-code change.

const lot = (over: Partial<AvailabilityResponse['lots'][number]>): AvailabilityResponse['lots'][number] => ({
  id: 'lot-x', name: 'Lote X', priceCents: 0, capacity: 100, soldCount: 0,
  confirmed: 0, temporaryReservations: 0, occupied: 0, remaining: 100, available: 100,
  status: 'inactive', ...over,
});
const avail = (lots: AvailabilityResponse['lots']): AvailabilityResponse => ({
  event: { id: 'e', name: 'E', slug: 'e', status: 'published' },
  lots,
  distances: [],
});

const LOT2_INACTIVE = lot({ id: 'lot-2', name: 'Lote 2', priceCents: 9990, status: 'inactive' });
const LOT3_ACTIVE = lot({ id: 'lot-3', name: 'Lote 3', priceCents: 11990, status: 'active' });
const LOT3_INACTIVE = lot({ id: 'lot-3', name: 'Lote 3', priceCents: 11990, status: 'inactive' });
const LOT4_ACTIVE = lot({ id: 'lot-4', name: 'Lote 4', priceCents: 16990, status: 'active' });

test('A — lot-2 inactive + lot-3 active 11990 -> ready(lot-3), price 11990', () => {
  const state = selectPublicActiveLot(avail([LOT2_INACTIVE, LOT3_ACTIVE]), false);
  assert.deepEqual(state, { kind: 'ready', lot: LOT3_ACTIVE });
  assert.equal(publicActiveLotOrNull(state)?.name, 'Lote 3');
  assert.equal(publicActiveLotPriceCents(state), 11990);
});

test('B — next turnover lot-3 inactive + lot-4 active 16990 -> ready(lot-4), NO code change', () => {
  const state = selectPublicActiveLot(avail([LOT2_INACTIVE, LOT3_INACTIVE, LOT4_ACTIVE]), false);
  assert.deepEqual(state, { kind: 'ready', lot: LOT4_ACTIVE });
  assert.equal(publicActiveLotPriceCents(state), 16990);
});

test('C — an inactive lot-2 that appears BEFORE the active lot can NEVER win (root cause)', () => {
  // exact defect shape: inactive "Lote 2" still present, listed first
  const state = selectPublicActiveLot(avail([LOT2_INACTIVE, LOT3_ACTIVE]), false);
  assert.equal(state.kind, 'ready');
  assert.notEqual(publicActiveLotOrNull(state)?.id, 'lot-2');
  assert.equal(publicActiveLotOrNull(state)?.id, 'lot-3');
  // order must not matter
  assert.deepEqual(
    selectPublicActiveLot(avail([LOT3_ACTIVE, LOT2_INACTIVE]), false),
    selectPublicActiveLot(avail([LOT2_INACTIVE, LOT3_ACTIVE]), false),
  );
});

test('D — zero active lots -> none (legitimate ~33s window in a two-step turnover), no inactive advertised', () => {
  const state = selectPublicActiveLot(avail([LOT2_INACTIVE, LOT3_INACTIVE]), false);
  assert.deepEqual(state, { kind: 'none' });
  assert.equal(publicActiveLotOrNull(state), null);
  assert.equal(publicActiveLotPriceCents(state), null);
});

test('E — availability not resolved yet -> loading, never a price', () => {
  const state = selectPublicActiveLot(null, false);
  assert.deepEqual(state, { kind: 'loading' });
  assert.equal(publicActiveLotPriceCents(state), null);
  assert.equal(publicActiveLotUnavailableLabel(state), 'Carregando lote…');
});

test('F — /api/availability failed -> error, never a stale static price', () => {
  const state = selectPublicActiveLot(null, true);
  assert.deepEqual(state, { kind: 'error' });
  assert.equal(publicActiveLotPriceCents(state), null);
  // even if (stale) data is somehow present, a failed fetch still wins
  assert.deepEqual(selectPublicActiveLot(avail([LOT3_ACTIVE]), true), { kind: 'error' });
});

test('malformed API with >1 active lot -> ambiguous (fail safe, no arbitrary price)', () => {
  const state = selectPublicActiveLot(avail([LOT3_ACTIVE, LOT4_ACTIVE]), false);
  assert.deepEqual(state, { kind: 'ambiguous' });
  assert.equal(publicActiveLotPriceCents(state), null);
});

test('registration is enabled only for ready, never for loading/error/none/ambiguous', () => {
  assert.equal(canRegisterWithPublicActiveLot({ kind: 'loading' }), false);
  assert.equal(canRegisterWithPublicActiveLot({ kind: 'error' }), false);
  assert.equal(canRegisterWithPublicActiveLot({ kind: 'none' }), false);
  assert.equal(canRegisterWithPublicActiveLot({ kind: 'ambiguous' }), false);
  assert.equal(canRegisterWithPublicActiveLot({ kind: 'ready', lot: LOT3_ACTIVE }), true);
});

test('coupon or partner price is hidden unless the canonical public lot is ready', () => {
  for (const state of [
    { kind: 'loading' },
    { kind: 'error' },
    { kind: 'none' },
    { kind: 'ambiguous' },
  ] as const) {
    assert.equal(publicRegistrationPriceCents(state, 10_791), null);
  }
  assert.equal(publicRegistrationPriceCents({ kind: 'ready', lot: LOT3_ACTIVE }, 10_791), 10_791);
  assert.equal(publicRegistrationPriceCents({ kind: 'ready', lot: LOT3_ACTIVE }, null), 11_990);
});

test('shared availability loader deduplicates only concurrent calls and refreshes after settlement', async () => {
  let calls = 0;
  const load = createSharedInFlightLoader(async () => {
    calls += 1;
    return calls;
  });

  const [first, shared] = await Promise.all([load(), load()]);
  assert.deepEqual([first, shared], [1, 1]);
  assert.equal(calls, 1);

  assert.equal(await load(), 2);
  assert.equal(calls, 2);
});

test('shared availability loader does not cache a rejected request', async () => {
  let calls = 0;
  const load = createSharedInFlightLoader(async () => {
    calls += 1;
    if (calls === 1) throw new Error('temporary failure');
    return calls;
  });

  await assert.rejects(load(), /temporary failure/);
  assert.equal(await load(), 2);
});

test('sold_out is not active — only status === "active" is the public current lot', () => {
  const soldOut = lot({ id: 'lot-3', name: 'Lote 3', priceCents: 11990, status: 'sold_out' });
  assert.deepEqual(selectPublicActiveLot(avail([soldOut]), false), { kind: 'none' });
});

test('the selector is a pure function of its inputs (deterministic)', () => {
  const input = avail([LOT2_INACTIVE, LOT3_ACTIVE, LOT4_ACTIVE.status === 'active' ? { ...LOT4_ACTIVE, status: 'inactive' } : LOT4_ACTIVE]);
  const a = selectPublicActiveLot(input, false);
  const b = selectPublicActiveLot(input, false);
  assert.deepEqual(a, b);
});

// ---- source contract: no component re-invents lot selection or trusts static config ----

const forms = readFileSync('src/components/forms.tsx', 'utf8');
const hero = readFileSync('src/components/hero.tsx', 'utf8');
const eventConfig = readFileSync('src/config/event.ts', 'utf8');
const adminPage = readFileSync('src/pages/Admin.tsx', 'utf8');

test('G — Hero and RegistrationSection share ONE canonical source (usePublicAvailability)', () => {
  for (const [name, src] of [['forms.tsx', forms], ['hero.tsx', hero]] as const) {
    assert.match(src, /usePublicAvailability\(\)/, `${name} uses the shared hook`);
    assert.doesNotMatch(src, /\.lots\.find\(/, `${name} does not re-implement lot selection`);
    assert.doesNotMatch(src, /eventInfo\.currentLot(PriceCents|Capacity)?/, `${name} does not read static current-lot config`);
  }
});

test('H — the registration base price comes from the active lot only (no static fallback)', () => {
  assert.match(forms, /const activeLot = activeLotState\.kind === 'ready' \? activeLotState\.lot : null;/);
  assert.match(forms, /const lotPriceCents = activeLot\?\.priceCents \?\? null;/);
  assert.doesNotMatch(forms, /\?\?\s*eventInfo\.currentLotPriceCents/);
  // coupon / partner preview and the "Valor original" line both derive from lotPriceCents
  assert.match(forms, /registrationBaseCents = publicRegistrationPriceCents\(activeLotState, promotionalPriceCents\)/);
  assert.match(forms, /appliedCoupon && canRegister \? \(/, 'coupon prices require a ready active lot');
});

test('§10/§11/§12 — no stale price on loading / error / no-active; submit gated unless ready', () => {
  assert.match(forms, /registrationBaseCents !== null \? \(/, 'price only rendered when a real base exists');
  assert.match(forms, /activeLotUnavailableLabel/, 'a neutral placeholder is shown otherwise');
  assert.match(forms, /const canRegister = canRegisterWithPublicActiveLot\(activeLotState\);/);
  assert.match(forms, /if \(!canRegister\) \{/);
  assert.match(forms, /disabled=\{isSubmitting \|\| !canRegister\}/);
});

test('§15 — the dangerous static config is removed from src/config/event.ts', () => {
  assert.doesNotMatch(eventConfig, /currentLot\s*:/);
  assert.doesNotMatch(eventConfig, /currentLotPriceCents\s*:/);
  assert.doesNotMatch(eventConfig, /currentLotCapacity\s*:/);
});

test('§6 — the Admin dashboard fallback no longer depends on the removed config', () => {
  assert.doesNotMatch(adminPage, /eventInfo\.currentLot(PriceCents|Capacity)?/);
  assert.match(adminPage, /const activeLot = summary\?\.lots\.find\(\(lot\) => lot\.status === 'active'\)/);
});

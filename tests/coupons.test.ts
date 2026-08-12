import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { calculateCouponPricing, normalizeCouponCode } from '../server/coupons';

test('normalizes VOLTA10 case-insensitively', () => {
  assert.equal(normalizeCouponCode('volta10'), 'VOLTA10');
  assert.equal(normalizeCouponCode(' Volta10 '), 'VOLTA10');
  assert.equal(normalizeCouponCode('VOLTA10'), 'VOLTA10');
});

test('calculates VOLTA10 in integer cents with commercial rounding', () => {
  assert.deepEqual(calculateCouponPricing(9_990, 'volta10'), {
    code: 'VOLTA10',
    discountPercentage: 10,
    discountAmountCents: 999,
    originalPriceCents: 9_990,
    finalPriceCents: 8_991,
  });
  assert.equal(calculateCouponPricing(9_995, 'VOLTA10')?.discountAmountCents, 1_000);
});

test('invalid, empty and duplicated codes cannot alter pricing', () => {
  assert.equal(calculateCouponPricing(9_990, 'INEXISTENTE'), null);
  assert.equal(calculateCouponPricing(9_990, ''), null);
  assert.equal(calculateCouponPricing(9_990, ['VOLTA10', 'VOLTA10']), null);
  assert.equal(calculateCouponPricing(9_990, undefined), null);
});

test('ignores client-authored amount fields because pricing accepts only server price and code', () => {
  const manipulatedRequest = { couponCode: 'VOLTA10', finalAmount: 1, discountPercentage: 99 };
  const pricing = calculateCouponPricing(9_990, manipulatedRequest.couponCode);
  assert.equal(pricing?.finalPriceCents, 8_991);
  assert.notEqual(pricing?.finalPriceCents, manipulatedRequest.finalAmount);
});

test('applying VOLTA10 twice remains a single 10% snapshot, never a compounded discount', () => {
  const firstApplication = calculateCouponPricing(9_990, 'VOLTA10');
  const repeatedRequest = calculateCouponPricing(9_990, 'VOLTA10');
  assert.deepEqual(repeatedRequest, firstApplication);
  assert.equal(repeatedRequest?.finalPriceCents, 8_991);
});

test('checkout, confirmation and schema keep the coupon snapshot authoritative and auditable', () => {
  const handler = readFileSync(new URL('../server/index.ts', import.meta.url), 'utf8');
  const database = readFileSync(new URL('../server/database.ts', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../supabase/migrations/20260810185708_add_registration_coupon_snapshot.sql', import.meta.url), 'utf8');
  const vercelRoute = readFileSync(new URL('../api/coupons/validate.ts', import.meta.url), 'utf8');

  assert.match(migration, /^begin;/);
  assert.match(handler, /calculateCouponPricing\(activeLot\.priceCents, requestedCouponCode\)/);
  assert.match(handler, /action: repricedCoupon \? 'coupon\.applied' : 'coupon\.removed'/);
  assert.match(handler, /payment\.checkoutUrl = null/);
  assert.match(handler, /amountCents: response\.amountCents/);
  assert.match(database, /Number\(row\.amount_cents\) === Number\(row\.final_price\)/);
  assert.match(database, /coupon_used_at = case when coupon_code is not null/);
  assert.match(database, /provider_payment_id=null, checkout_url=null/);
  assert.match(migration, /coupon_code text/);
  assert.match(migration, /coupon_applied_at text/);
  assert.match(migration, /coupon_used_at text/);
  assert.match(migration, /coupon_code is null.*discount_percentage = 0/s);
  assert.match(vercelRoute, /handleApiRequest/);
});

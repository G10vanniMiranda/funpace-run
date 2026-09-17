import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// P0 HOTFIX — STALE CHECKOUT REUSE (distance + partner divergence)
//
// Confirmed production root cause: createPendingRegistrationInPostgres recovers an
// existing pending_payment/paid registration by (event, cpf_hash) and returned its
// already-generated checkout_url verbatim, without checking whether the *newly
// requested* distance or partner attribution still matched the persisted row.
// Distance divergence was ignored entirely; partner divergence was detected but only
// audited as `partner.session_replacement_blocked` — the stale registration/checkout
// stayed authoritative either way. Verified live against production registration
// 8882e754-9e22-4eec-b235-fb3f3f4290e1 (10K/Lote 3/R$119,90 checkout reused across
// three blocked influencer-partner attempts).
//
// Fix: extend the *already-existing* stale-pending detection (today only compares
// registration.amount_cents / payment.amount_cents against final_price) to also treat
// a distance or an eligible-partner mismatch as stale. A stale pending row is expired
// (status='expired', checkout_url/provider_payment_id cleared) exactly as the amount
// mismatch case already does, then falls through to the untouched fresh-registration
// path, which re-resolves distance capacity, lot, partner eligibility and coupon from
// the CURRENT request — no new pricing/recovery logic is introduced.
//
// Repo convention (see tests/registration-cutoff-safety.test.ts): no live PG in the
// committed suite — the SQL wiring is locked against source here, the behavioural
// contract is encoded as a pure reimplementation of the resolved staleness decision,
// and the real-PostgreSQL proof runs in homolog separately.

const serverDatabase = readFileSync('server/database.ts', 'utf8');

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function createPendingRegistrationFn(): string {
  const start = serverDatabase.indexOf('export async function createPendingRegistrationInPostgres(');
  assert.ok(start >= 0, 'createPendingRegistrationInPostgres located');
  const end = serverDatabase.indexOf('\nexport async function ', start + 1);
  assert.ok(end > start, 'end of createPendingRegistrationInPostgres located');
  return serverDatabase.slice(start, end);
}

// ---------------------------------------------------------------------------
// A — source wiring (fails on the pre-fix baseline, passes only after the fix)
// ---------------------------------------------------------------------------

test('the stale-pending detection query now compares requested distance and eligible partner', () => {
  const fn = code(createPendingRegistrationFn());
  const at = fn.indexOf('const stalePendingResult = await client.query(');
  assert.ok(at >= 0, 'stalePendingResult query present');
  const end = fn.indexOf('for update of registration`', at);
  assert.ok(end > at, 'stalePendingResult query closes with `for update of registration`');
  const stmt = fn.slice(at, end);

  assert.match(stmt, /registration\.amount_cents\s*<>\s*registration\.final_price/, 'original amount-mismatch clause retained');
  assert.match(stmt, /payment\.id is null/, 'original payment-missing clause retained');
  assert.match(stmt, /payment\.amount_cents\s*<>\s*registration\.final_price/, 'original payment-amount-mismatch clause retained');
  assert.match(stmt, /registration\.distance_id\s*<>\s*\$4/, 'new clause compares persisted distance against the requested distance');
  assert.match(stmt, /registration\.partner_id is distinct from \$5/, 'new clause compares persisted partner against the requested eligible partner');
  assert.match(stmt, /\$4::text is not null/, 'distance clause is a no-op when the requested distance could not be resolved');
  assert.match(stmt, /\$5::uuid is not null/, 'partner clause is a no-op when no eligible partner was presented (one-directional — sticky discount preserved); cast to uuid, matching registrations.partner_id\'s column type');
  assert.match(stmt, /registration\.status\s*=\s*\$3/, 'still scoped to pending_payment only — a paid registration is never a candidate');
});

test('the requested partner must pass eligibility (active, not deleted, identity match) before it can mark a row stale', () => {
  const fn = code(createPendingRegistrationFn());
  const helperAt = fn.indexOf('let requestedEligiblePartnerId');
  const queryAt = fn.indexOf('const stalePendingResult');
  assert.ok(helperAt >= 0 && helperAt < queryAt, 'eligible-partner resolution happens before the stale-pending query');
  const helperBlock = fn.slice(helperAt, queryAt);
  assert.match(helperBlock, /isPartnerRowEligibleForDiscount\(/, 'reuses the shared eligibility predicate — no bypass of partner validation');
  assert.match(helperBlock, /requestedPartnerRow\.slug === input\.partnerSlug/, 'still checks slug identity match, same as the fresh-registration path');
});

test('a stale row is expired using the exact existing invalidation contract (no new mutation shape)', () => {
  const fn = code(createPendingRegistrationFn());
  assert.match(fn, /status = 'expired'/, 'registration is expired, not deleted');
  assert.match(fn, /checkout_url = null,\s*\n\s*provider_payment_id = null/, 'checkout_url and provider_payment_id are cleared on the stale payment');
  assert.doesNotMatch(fn, /delete from \$\{table\.registrations\}/, 'never deletes a registration row');
  assert.doesNotMatch(fn, /delete from \$\{table\.payments\}/, 'never deletes a payment row');
});

test('new stale reasons are audited without inventing a second recovery architecture', () => {
  const fn = code(createPendingRegistrationFn());
  assert.match(fn, /'registration\.recovered_stale_distance'/, 'distance-caused staleness is distinguishable in the audit trail');
  assert.match(fn, /'registration\.recovered_stale_partner'/, 'partner-caused staleness is distinguishable in the audit trail');
  assert.match(fn, /'registration\.recovered_stale_amount'/, 'the pre-existing amount-mismatch case is now also labelled (previously unaudited)');
  assert.match(fn, /checkoutResolution:\s*'regenerated'/, 'minimal structured observability field added for the expired-and-regenerated path');
  assert.match(fn, /checkoutResolution:\s*shouldCreateCheckout \? 'regenerated' : 'reused'/, 'minimal structured observability field added for the in-place recovery path');

  const actionUnionAt = serverDatabase.indexOf('export type PartnerAuditAction =');
  assert.ok(actionUnionAt >= 0, 'PartnerAuditAction union located');
  const actionUnion = serverDatabase.slice(actionUnionAt, serverDatabase.indexOf(';', actionUnionAt));
  assert.match(actionUnion, /'registration\.recovered_stale_distance'/);
  assert.match(actionUnion, /'registration\.recovered_stale_partner'/);
  assert.match(actionUnion, /'registration\.recovered_stale_amount'/);
});

test('the coupon recovery branch is untouched (regression guard)', () => {
  const fn = code(createPendingRegistrationFn());
  assert.match(fn, /const requestedCouponDiffers = existing\.status === 'pending_payment'\s*\n\s*&& String\(existing\.coupon_code \|\| ''\) !== String\(input\.couponCode \|\| ''\)/, 'coupon-diff detection logic byte-identical to pre-fix');
  assert.match(fn, /O cupom não pode ser combinado com outro desconto\./, 'coupon+partner conflict message retained');
  assert.match(fn, /gateway_status=null, gateway_transaction_id=null, gateway_payload=null/, 'coupon reprice still clears gateway fields the same way');
});

test('the partner.session_replacement_blocked path is retained for ineligible/paid cases (regression guard)', () => {
  const fn = code(createPendingRegistrationFn());
  assert.match(fn, /const requestedPartnerDiffers = Boolean\(input\.partnerId\) && input\.partnerId !== existing\.partner_id/, 'raw partner-differs detection retained verbatim for the in-place branch');
  assert.match(fn, /'partner\.session_replacement_blocked'/, 'blocked-audit action retained for cases the new stale-check does not intercept (ineligible partner, or an already-paid registration)');
});

test('a paid registration is never a target of the new stale-expiry query', () => {
  const fn = code(createPendingRegistrationFn());
  const at = fn.indexOf('const stalePendingResult = await client.query(');
  const end = fn.indexOf('for update of registration`', at);
  const stmt = fn.slice(at, end);
  assert.doesNotMatch(stmt, /'paid'/, 'the stale-pending query never mentions paid — only pending_payment is eligible for expiry');
});

test('the fix does not widen the blast radius beyond the recovery path', () => {
  const fn = code(createPendingRegistrationFn());
  assert.doesNotMatch(fn, /savePostgresDatabase|readPostgresDatabase/, 'no full-database read/write');
  assert.doesNotMatch(fn, /hashtext\('funpace-run-write'\)/, 'no new global application write lock introduced');
});

// ---------------------------------------------------------------------------
// B — behavioural contract: a pure reimplementation of the resolved staleness
//     decision, byte-faithful to the patched query, exercised across the full matrix.
// ---------------------------------------------------------------------------

type PendingRow = {
  status: 'pending_payment' | 'paid';
  distanceId: string;
  partnerId: string | null;
  amountCents: number;
  finalPriceCents: number;
  paymentId: string | null;
  paymentAmountCents: number | null;
};

type RecoveryRequest = {
  requestedDistanceId: string | null; // null = requested distance did not resolve
  requestedEligiblePartnerId: string | null; // null = no partner presented, or presented but ineligible
};

/** Mirrors the patched `stalePendingResult` WHERE clause exactly. */
function resolveStaleness(row: PendingRow, request: RecoveryRequest): { stale: boolean; reasons: string[] } {
  if (row.status !== 'pending_payment') return { stale: false, reasons: [] };

  const distanceChanged = request.requestedDistanceId !== null && row.distanceId !== request.requestedDistanceId;
  const partnerChanged = request.requestedEligiblePartnerId !== null && (row.partnerId || '') !== request.requestedEligiblePartnerId;
  const amountMismatch = row.amountCents !== row.finalPriceCents
    || row.paymentId === null
    || row.paymentAmountCents !== row.finalPriceCents;

  const reasons = [
    ...(distanceChanged ? ['distance_changed'] : []),
    ...(partnerChanged ? ['partner_changed'] : []),
    ...(amountMismatch ? ['amount_mismatch'] : []),
  ];
  return { stale: reasons.length > 0, reasons };
}

const consistentPending: PendingRow = {
  status: 'pending_payment', distanceId: 'distance-10k', partnerId: null,
  amountCents: 11_990, finalPriceCents: 11_990, paymentId: 'payment-1', paymentAmountCents: 11_990,
};

test('E — 10K pending, resubmit 5K: stale (distance_changed), old checkout not reused', () => {
  const result = resolveStaleness(consistentPending, { requestedDistanceId: 'distance-5k', requestedEligiblePartnerId: null });
  assert.equal(result.stale, true);
  assert.deepEqual(result.reasons, ['distance_changed']);
});

test('F — full-price pending, resubmit with a valid influencer partner: stale (partner_changed)', () => {
  const result = resolveStaleness(consistentPending, { requestedDistanceId: 'distance-10k', requestedEligiblePartnerId: 'partner-influencer-1' });
  assert.equal(result.stale, true);
  assert.deepEqual(result.reasons, ['partner_changed']);
});

test('production incident shape — matches order 8882e754 exactly: distance unchanged, partner newly presented and eligible', () => {
  // distance-10k / lot-3 / 11990 cents / partner null, as read from production.
  const result = resolveStaleness(consistentPending, { requestedDistanceId: 'distance-10k', requestedEligiblePartnerId: '8e071a84-bf74-4757-810d-83a04859e8d4' });
  assert.equal(result.stale, true, 'this is exactly the case that today silently returns the stale full-price checkout');
  assert.deepEqual(result.reasons, ['partner_changed']);
});

test('G/H — identical resubmission (same distance, same partner, same price): not stale, checkout reuse preserved', () => {
  const withPartner: PendingRow = { ...consistentPending, partnerId: 'partner-influencer-1', amountCents: 10_791, finalPriceCents: 10_791, paymentAmountCents: 10_791 };
  const result = resolveStaleness(withPartner, { requestedDistanceId: 'distance-10k', requestedEligiblePartnerId: 'partner-influencer-1' });
  assert.equal(result.stale, false);
  assert.deepEqual(result.reasons, []);
});

test('I — coupon-only changes are never evaluated by this function (unrelated to distance/partner, handled by the untouched coupon branch)', () => {
  // resolveStaleness has no coupon parameter at all: it structurally cannot fire on a coupon change alone.
  const result = resolveStaleness(consistentPending, { requestedDistanceId: 'distance-10k', requestedEligiblePartnerId: null });
  assert.equal(result.stale, false, 'same distance, no partner requested -> the coupon-diff branch (untouched) is the only thing that can act here');
});

test('J — paid registration + distance change: never stale, no reprice, no new checkout', () => {
  const paid: PendingRow = { ...consistentPending, status: 'paid' };
  const result = resolveStaleness(paid, { requestedDistanceId: 'distance-5k', requestedEligiblePartnerId: null });
  assert.equal(result.stale, false);
  assert.deepEqual(result.reasons, []);
});

test('K — paid registration + partner change: never stale, no reprice, no new checkout', () => {
  const paid: PendingRow = { ...consistentPending, status: 'paid' };
  const result = resolveStaleness(paid, { requestedDistanceId: 'distance-10k', requestedEligiblePartnerId: 'partner-influencer-1' });
  assert.equal(result.stale, false);
  assert.deepEqual(result.reasons, []);
});

test('inverse partner test — existing discounted pending, resubmit with no partner session: sticky discount preserved (not stale)', () => {
  const discounted: PendingRow = { ...consistentPending, partnerId: 'partner-influencer-1', amountCents: 10_791, finalPriceCents: 10_791, paymentAmountCents: 10_791 };
  const result = resolveStaleness(discounted, { requestedDistanceId: 'distance-10k', requestedEligiblePartnerId: null });
  assert.equal(result.stale, false, 'partner comparison is one-directional: absence of a session never strips an existing discount');
});

test('ineligible/invalid partner presented: does not mark the row stale (falls through to the existing blocked-audit path)', () => {
  // requestedEligiblePartnerId is null whenever the presented partner failed identity or eligibility
  // validation upstream (see createPendingRegistrationInPostgres) — never the raw, unvalidated input.partnerId.
  const result = resolveStaleness(consistentPending, { requestedDistanceId: 'distance-10k', requestedEligiblePartnerId: null });
  assert.equal(result.stale, false, 'an ineligible partner attempt must not destroy a perfectly good pending registration');
});

test('requested distance could not be resolved: distance comparison is skipped (fail closed on unknown, not on known-good state)', () => {
  const result = resolveStaleness(consistentPending, { requestedDistanceId: null, requestedEligiblePartnerId: null });
  assert.equal(result.stale, false);
});

test('both distance and partner changed simultaneously: both reasons recorded, still a single stale outcome', () => {
  const result = resolveStaleness(consistentPending, { requestedDistanceId: 'distance-5k', requestedEligiblePartnerId: 'partner-influencer-1' });
  assert.equal(result.stale, true);
  assert.deepEqual(result.reasons, ['distance_changed', 'partner_changed']);
});

test('pre-existing amount-mismatch staleness (unrelated to this fix) is preserved unchanged', () => {
  const mismatched: PendingRow = { ...consistentPending, amountCents: 10_000 }; // amount_cents <> final_price
  const result = resolveStaleness(mismatched, { requestedDistanceId: 'distance-10k', requestedEligiblePartnerId: null });
  assert.equal(result.stale, true);
  assert.deepEqual(result.reasons, ['amount_mismatch']);
});

test('invariant: a paid registration is a fixed point regardless of any requested divergence', () => {
  const paid: PendingRow = { ...consistentPending, status: 'paid' };
  for (const request of [
    { requestedDistanceId: 'distance-5k', requestedEligiblePartnerId: null },
    { requestedDistanceId: 'distance-10k', requestedEligiblePartnerId: 'partner-influencer-1' },
    { requestedDistanceId: 'distance-5k', requestedEligiblePartnerId: 'partner-influencer-1' },
    { requestedDistanceId: null, requestedEligiblePartnerId: null },
  ] as RecoveryRequest[]) {
    assert.equal(resolveStaleness(paid, request).stale, false);
  }
});

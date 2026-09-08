import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// EVENT-DAY-REGISTRATION-CUTOFF-SAFETY-001 — a payment confirmation for a
// checkout that pre-dated an operator cut-off must still settle, but it MUST NOT
// re-open sales. The deployed `confirmPaymentInPostgres` rewrote
// `run-lots.status` to 'active' UNCONDITIONALLY on the first-time paid
// transition, so a late webhook flipped an operator-set `inactive` lot back to
// `active` and `selectLotWithAvailability` started selling it again.
//
// The fix adds one CASE branch — `when status = 'inactive' then 'inactive'` —
// making the operator-imposed closure state a fixed point of the confirmation
// path, exactly mirroring the `... else status end` idiom already used by the
// cancel path (`cancelRegistration...`) and migration
// 20260713_phase2_reconciliation_and_capacity.sql.
//
// Repo convention (see tests/admin-lot-direct-mutation.test.ts): no live PG in
// the committed suite — the SQL wiring is locked against source here, the
// behavioural contract is encoded as a pure reimplementation of the resolved
// status, and the real-PostgreSQL concurrency proof runs in homolog separately.

const serverDatabase = readFileSync('server/database.ts', 'utf8');

// strip // and /* */ comments so assertions test executable code, not prose
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function confirmPaymentFn(): string {
  const start = serverDatabase.indexOf('export async function confirmPaymentInPostgres(');
  assert.ok(start >= 0, 'confirmPaymentInPostgres located');
  const end = serverDatabase.indexOf('\nexport async function ', start + 1);
  assert.ok(end > start, 'end of confirmPaymentInPostgres located');
  return serverDatabase.slice(start, end);
}

// The lot UPDATE inside confirmPaymentInPostgres (the single writer under test).
function lotUpdateStatement(): string {
  const fn = confirmPaymentFn();
  const at = fn.indexOf('update ${table.lots} set sold_count = sold_count + 1');
  assert.ok(at >= 0, 'the sold_count += 1 lot UPDATE is present');
  // grab through the closing `end where id = $1`
  const tail = fn.indexOf("end where id = $1`", at);
  assert.ok(tail > at, 'lot UPDATE CASE closes with `end where id = $1`');
  return fn.slice(at, tail + "end where id = $1`".length);
}

// ---------------------------------------------------------------------------
// A — source wiring (fails on the pre-fix baseline, passes only after the fix)
// ---------------------------------------------------------------------------

test('the lot UPDATE preserves an operator-set `inactive` lot (fixed point)', () => {
  const stmt = code(lotUpdateStatement());
  assert.match(
    stmt,
    /when\s+status\s*=\s*'inactive'\s+then\s+'inactive'/,
    "CASE must special-case `when status = 'inactive' then 'inactive'`",
  );
});

test('the `inactive` guard is evaluated BEFORE the capacity branch', () => {
  const stmt = code(lotUpdateStatement());
  const inactiveAt = stmt.search(/when\s+status\s*=\s*'inactive'/);
  const capacityAt = stmt.search(/when\s+sold_count\s*\+\s*1\s*>=\s*capacity/);
  assert.ok(inactiveAt >= 0 && capacityAt >= 0, 'both branches present');
  assert.ok(inactiveAt < capacityAt, 'inactive fixed-point branch comes first');
});

test('sold_count is still incremented exactly once (projection preserved)', () => {
  const stmt = code(lotUpdateStatement());
  assert.match(stmt, /set\s+sold_count\s*=\s*sold_count\s*\+\s*1/, 'sold_count += 1 retained');
  assert.equal(
    (stmt.match(/sold_count\s*=\s*sold_count\s*\+\s*1/g) || []).length,
    1,
    'exactly one sold_count increment in the statement',
  );
});

test('the capacity-exhaustion and selling branches are unchanged', () => {
  const stmt = code(lotUpdateStatement());
  assert.match(stmt, /when\s+sold_count\s*\+\s*1\s*>=\s*capacity\s+then\s+'sold_out'/, 'sold_out branch intact');
  assert.match(stmt, /else\s+'active'\s*\n?\s*end/, "final else 'active' intact — active <-> sold_out stay capacity-derived");
});

test('the lot UPDATE still runs only on the first-time paid transition', () => {
  const fn = code(confirmPaymentFn());
  const guardAt = fn.indexOf('if (!wasAlreadyPaid)');
  const updateAt = fn.indexOf('update ${table.lots} set sold_count = sold_count + 1');
  assert.ok(guardAt >= 0 && guardAt < updateAt, 'lot UPDATE is inside `if (!wasAlreadyPaid)` — replay stays idempotent');
});

test('the fix does not widen the confirmation blast radius', () => {
  const fn = code(confirmPaymentFn());
  // no new generic full-blob writer / global write lock introduced
  assert.doesNotMatch(fn, /savePostgresDatabase|readPostgresDatabase/, 'no full-database read/write');
  assert.doesNotMatch(fn, /hashtext\('funpace-run-write'\)/, 'no global application write lock');
  assert.doesNotMatch(fn, /\btransaction\s*[<(]/, 'does not delegate to the generic transaction()');
  // amount / gateway handling untouched: the mismatch guard and the payment
  // UPDATE columns are still present verbatim
  assert.match(fn, /gateway_status\s*=\s*'amount_mismatch'/, 'amount-mismatch guard retained');
  assert.match(fn, /provider_payment_id\s*=\s*coalesce\(nullif\(\$2, ''\), provider_payment_id\)/, 'gateway metadata write retained');
  assert.match(fn, /on conflict \(provider_event_id\) do nothing/, 'payment-event dedupe retained');
});

// ---------------------------------------------------------------------------
// B — behavioural contract: a pure reimplementation of the resolved lot status,
//     byte-faithful to the patched CASE, exercised across the full matrix.
// ---------------------------------------------------------------------------

/** Mirrors `status = case when status='inactive' then 'inactive'
 *  when sold_count + 1 >= capacity then 'sold_out' else 'active' end`
 *  as applied by confirmPaymentInPostgres on a first-time paid transition. */
function resolveLotStatusOnConfirm(current: 'active' | 'inactive' | 'sold_out', soldCount: number, capacity: number): string {
  if (current === 'inactive') return 'inactive';
  if (soldCount + 1 >= capacity) return 'sold_out';
  return 'active';
}

const matrix: Array<{ name: string; from: 'active' | 'inactive' | 'sold_out'; sold: number; cap: number; expect: string }> = [
  { name: '1  active + payment below capacity -> active', from: 'active', sold: 10, cap: 100, expect: 'active' },
  { name: '2  active + payment reaches capacity -> sold_out', from: 'active', sold: 11, cap: 12, expect: 'sold_out' },
  { name: '3  inactive + late payment -> stays inactive', from: 'inactive', sold: 19, cap: 100, expect: 'inactive' },
  { name: '3b inactive + late payment that would fill it -> STILL inactive', from: 'inactive', sold: 99, cap: 100, expect: 'inactive' },
  { name: '6  inactive + Nth delayed payment -> still inactive', from: 'inactive', sold: 53, cap: 100, expect: 'inactive' },
  { name: '8  sold_out (capacity was raised) + payment -> active (legit reopen)', from: 'sold_out', sold: 20, cap: 40, expect: 'active' },
  { name: '8b sold_out still at capacity + payment -> sold_out', from: 'sold_out', sold: 20, cap: 20, expect: 'sold_out' },
];

for (const c of matrix) {
  test(`resolved lot status — ${c.name}`, () => {
    assert.equal(resolveLotStatusOnConfirm(c.from, c.sold, c.cap), c.expect);
  });
}

test('invariant: an inactive lot is a fixed point for every (sold_count, capacity)', () => {
  for (let sold = 0; sold <= 200; sold += 7) {
    for (const cap of [1, 10, 100, 150, 500]) {
      assert.equal(resolveLotStatusOnConfirm('inactive', sold, cap), 'inactive', `sold=${sold} cap=${cap}`);
    }
  }
});

test('invariant: active/sold_out still resolve purely by capacity (no closure leakage)', () => {
  assert.equal(resolveLotStatusOnConfirm('active', 0, 100), 'active');
  assert.equal(resolveLotStatusOnConfirm('active', 99, 100), 'sold_out');
  assert.equal(resolveLotStatusOnConfirm('sold_out', 5, 100), 'active'); // slot freed / capacity raised
  assert.equal(resolveLotStatusOnConfirm('sold_out', 99, 100), 'sold_out');
});

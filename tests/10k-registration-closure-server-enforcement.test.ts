import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// EVENT-OPS — close NEW 10K registrations, keep 5K open. Existing 10K
// registrations (paid/pending/service_swap/historical) must remain untouched.
//
// Repo convention (see tests/stale-checkout-reuse.test.ts, tests/public-active-lot.test.ts):
// no live PG in the committed suite — the SQL/control-flow wiring is locked
// against source here; the real-PostgreSQL proof runs in homolog separately.
//
// Central finding of this change: the server-side gate ALREADY exists and
// requires ZERO new code. createPendingRegistrationInPostgres only resolves a
// distance whose `status = 'active'`; when the requested distance (or any
// active lot) can't be resolved, it rolls back and returns a controlled 409
// with NO registration/payment/checkout row ever created. Closing "new 10K"
// while keeping "new 5K" open is therefore a pure DATA change
// (run-distances.status: 'active' -> 'inactive' for the 10K row), not a code
// change — these tests characterize/lock that existing contract so it can't
// silently regress, and prove existing-participant flows never touch this gate.

const serverDatabase = readFileSync('server/database.ts', 'utf8');

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function extractFn(name: string): string {
  const start = serverDatabase.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} located`);
  const end = serverDatabase.indexOf('\nexport async function ', start + 1);
  assert.ok(end > start, `end of ${name} located`);
  return serverDatabase.slice(start, end);
}

// ---------------------------------------------------------------------------
// A/F — a fresh 10K request must be rejected server-side (409), no rows created
// ---------------------------------------------------------------------------

test('A/F — createPendingRegistrationInPostgres only resolves a distance whose status is active', () => {
  const fn = code(extractFn('createPendingRegistrationInPostgres'));
  assert.match(
    fn,
    /select id, name, capacity from \$\{table\.distances\} where event_id = \$1 and name = \$2 and status = \$3 limit 1`,\s*\[event\.id, input\.payload\.distance, 'active'\]/,
    'the requested distance lookup is scoped to status = \'active\' (the same field /api/availability exposes per distance)',
  );
});

test('A/F — no active distance -> rollback + 409, zero registration/payment/checkout created', () => {
  const fn = code(extractFn('createPendingRegistrationInPostgres'));
  const at = fn.indexOf('const distance = requestedDistance;');
  assert.ok(at >= 0, 'the fresh-registration path reuses the already-resolved requestedDistance (no second query)');
  const guard = fn.slice(at, at + 700);
  assert.match(guard, /if \(!distance \|\| lotResult\.rows\.length === 0\) \{/, 'null distance is guarded before any insert');
  assert.match(guard, /await client\.query\('rollback'\);/, 'the transaction is rolled back, not committed');
  assert.match(guard, /statusCode:\s*409/, 'a controlled 409 is returned, never a 500, for this expected business condition');
  assert.match(guard, /success:\s*false/);
  assert.match(guard, /registrationId:\s*''/, 'no registration id is ever fabricated');
  assert.match(guard, /paymentId:\s*null/, 'no payment id is ever fabricated');
  assert.match(guard, /checkoutUrl:\s*null/, 'no checkout URL is ever fabricated');
  assert.match(guard, /message:\s*'Distancia ou lote indisponivel\.'/);

  // the guard must appear strictly BEFORE the registration insert
  const insertAt = fn.indexOf(`insert into \${table.registrations}`, at);
  assert.ok(insertAt > at, 'registrations insert located after the guard');
  const guardEndsAt = at + guard.indexOf('}', guard.indexOf('statusCode')) ;
  assert.ok(insertAt > guardEndsAt, 'the 409 guard runs strictly before any row is inserted');
});

test('the service_swap primitive uses the identical status = \'active\' distance gate (no separate 10K bypass)', () => {
  const fn = code(extractFn('createServiceSwapRegistrationInPostgres'));
  assert.match(
    fn,
    /select id from \$\{table\.distances\} where event_id = \$1 and name = \$2 and status = \$3 limit 1`,\s*\[event\.id, input\.payload\.distance, 'active'\]/,
  );
  assert.match(fn, /return \{ status: 'distance_or_lot_unavailable' \};/);
});

// ---------------------------------------------------------------------------
// C/D — existing 10K participants (paid or pending) are completely unaffected
// ---------------------------------------------------------------------------

test('C/D — confirmPaymentInPostgres never reads or gates on run-distances.status', () => {
  const fn = code(extractFn('confirmPaymentInPostgres'));
  assert.doesNotMatch(
    fn,
    /table\.distances/,
    'payment confirmation (webhook / reconciliation) operates on registration+payment+lot rows by id only — ' +
      'it must stay unreachable by a distance-level open/closed flag, so an existing pending 10K payment can ' +
      'always be confirmed regardless of the distance\'s current status',
  );
});

test('C/D — the stale-pending recovery branch (existing registration, same CPF) is reached BEFORE the ' +
  'active-distance guard, so it never re-validates distance availability for an already-persisted row', () => {
  const fn = code(extractFn('createPendingRegistrationInPostgres'));
  const existingBranchAt = fn.indexOf('if (existing) {');
  const guardAt = fn.indexOf("if (!distance || lotResult.rows.length === 0) {");
  assert.ok(existingBranchAt >= 0 && guardAt >= 0 && existingBranchAt < guardAt,
    'existing-registration recovery is resolved and returned before the fresh-distance guard is ever reached');
});

// ---------------------------------------------------------------------------
// B/E — 5K stays fully unaffected: same code path, same partner/coupon pricing
// ---------------------------------------------------------------------------

test('B/E — 5K and 10K share the exact same distance/lot/partner/coupon code path (no distance-specific branch)', () => {
  const fn = code(extractFn('createPendingRegistrationInPostgres'));
  // there must be no conditional branching on a literal '5K' or '10K' anywhere
  // in the pending-registration primitive — availability is entirely data-driven
  assert.doesNotMatch(fn, /===\s*'5K'/);
  assert.doesNotMatch(fn, /===\s*'10K'/);
});

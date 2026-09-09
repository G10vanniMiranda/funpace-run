import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// EVENT-DAY CHECK-IN HISTORY UX — Admin → Operação gains four read-only views
// (Pendentes / Check-in realizado / Kit entregue / Todos) over the SAME
// check-in / kit authority. No new table, no new writer, no primitive change.
//
// Repo convention (see tests/admin-lot-direct-mutation.test.ts): the committed
// suite locks the wiring against source + encodes the pure filter/counter
// contract; live-PG behaviour is proven read-only in homolog / Production
// separately.

const serverIndex = readFileSync('server/index.ts', 'utf8');
const adminPage = readFileSync('src/pages/Admin.tsx', 'utf8');

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}
function operationHandler(): string {
  const start = serverIndex.indexOf('async function handleAdminOperation(');
  assert.ok(start >= 0, 'handleAdminOperation located');
  const end = serverIndex.indexOf('\nasync function ', start + 1);
  assert.ok(end > start, 'end of handleAdminOperation located');
  return serverIndex.slice(start, end);
}

// ---------------------------------------------------------------------------
// A — server wiring: new read-only views, no new writer, RBAC + read unchanged
// ---------------------------------------------------------------------------

test('the operation handler adds `checked_in` and `kit_delivered` read filters', () => {
  const fn = code(operationHandler());
  assert.match(fn, /filter === 'checked_in' && row\.checkInStatus !== 'checked_in'/, 'checked_in view filter');
  assert.match(fn, /filter === 'kit_delivered' && row\.kitStatus !== 'delivered'/, 'kit_delivered view filter');
});

test('the pre-existing filters and totals are untouched', () => {
  const fn = code(operationHandler());
  assert.match(fn, /filter === 'kit_pending' && row\.kitStatus === 'delivered'/, 'kit_pending kept');
  assert.match(fn, /filter === 'checkin_pending' && row\.checkInStatus === 'checked_in'/, 'checkin_pending kept');
  assert.match(fn, /filter === 'completed' && !\(row\.kitStatus === 'delivered' && row\.checkInStatus === 'checked_in'\)/, 'completed kept');
  assert.match(fn, /totals: \{ paid: allPaid\.length, kitPending:.*checkInPending:.*completed:/s, 'totals shape unchanged');
});

test('`sort=recent` orders by the existing check-in / kit timestamp, name otherwise', () => {
  const fn = code(operationHandler());
  assert.match(fn, /url\.searchParams\.get\('sort'\) === 'recent' \? 'recent' : 'name'/, 'sort param, recent opt-in');
  assert.match(fn, /filter === 'kit_delivered' \? a\.kitDeliveredAt : a\.checkInAt/, 'recent key picks the right timestamp');
  assert.match(fn, /a\.fullName\.localeCompare\(b\.fullName, 'pt-BR'\)/, 'name sort remains the default / tie-break');
});

test('the handler stays a role-gated read — no new writer, no schema, no primitive', () => {
  const fn = code(operationHandler());
  assert.match(fn, /requireAdmin\(req, res, \['administrator', 'operation'\]\)/, 'RBAC unchanged');
  assert.match(fn, /transaction\(\(current\) => current, \{ persist: false, scope: 'admin-registrations' \}\)/, 'still a persist:false read');
  assert.doesNotMatch(fn, /savePostgresDatabase|readPostgresDatabase/, 'no full-database read/write');
  assert.doesNotMatch(fn, /checkInRegistrationInPostgres|deliverRegistrationKitInPostgres|setRegistrationBibInPostgres|undoRegistration/, 'no check-in / kit / bib primitive called from the list handler');
  assert.doesNotMatch(fn, /INSERT|UPDATE|DELETE|insert into|update .*set|delete from/i, 'no SQL mutation');
});

// ---------------------------------------------------------------------------
// B — pure contract: filter + sort + counters (the §13 matrix)
// ---------------------------------------------------------------------------

type Row = { id: string; fullName: string; checkInStatus: 'not_started' | 'checked_in'; checkInAt: string | null; kitStatus: 'not_delivered' | 'delivered'; kitDeliveredAt: string | null };

function view(rows: Row[], filter: string, sort: 'name' | 'recent', query = '') {
  const q = query.toLowerCase();
  return rows
    .filter((row) => {
      if (filter === 'kit_pending' && row.kitStatus === 'delivered') return false;
      if (filter === 'checkin_pending' && row.checkInStatus === 'checked_in') return false;
      if (filter === 'checked_in' && row.checkInStatus !== 'checked_in') return false;
      if (filter === 'kit_delivered' && row.kitStatus !== 'delivered') return false;
      if (filter === 'completed' && !(row.kitStatus === 'delivered' && row.checkInStatus === 'checked_in')) return false;
      if (q && ![row.id, row.fullName].some((v) => v.toLowerCase().includes(q))) return false;
      return true;
    })
    .sort((a, b) => {
      if (sort === 'recent') {
        const at = filter === 'kit_delivered' ? a.kitDeliveredAt : a.checkInAt;
        const bt = filter === 'kit_delivered' ? b.kitDeliveredAt : b.checkInAt;
        const recent = String(bt || '').localeCompare(String(at || ''));
        if (recent !== 0) return recent;
      }
      return a.fullName.localeCompare(b.fullName, 'pt-BR');
    });
}
function counters(rows: Row[]) {
  const paid = rows.length;
  const checkInPending = rows.filter((r) => r.checkInStatus !== 'checked_in').length;
  const completed = rows.filter((r) => r.kitStatus === 'delivered' && r.checkInStatus === 'checked_in').length;
  return { paid, pendentes: checkInPending, checkIns: paid - checkInPending, kitsEntregues: completed };
}

const R: Row[] = [
  { id: 'r1', fullName: 'Ana', checkInStatus: 'not_started', checkInAt: null, kitStatus: 'not_delivered', kitDeliveredAt: null },
  { id: 'r2', fullName: 'Bruno', checkInStatus: 'checked_in', checkInAt: '2026-09-20T09:10:00Z', kitStatus: 'not_delivered', kitDeliveredAt: null },
  { id: 'r3', fullName: 'Carla', checkInStatus: 'checked_in', checkInAt: '2026-09-20T09:40:00Z', kitStatus: 'delivered', kitDeliveredAt: '2026-09-20T09:55:00Z' },
  { id: 'r4', fullName: 'Diego', checkInStatus: 'checked_in', checkInAt: '2026-09-20T08:05:00Z', kitStatus: 'delivered', kitDeliveredAt: '2026-09-20T10:20:00Z' },
];

test('paid without check-in → Pendentes; not in Check-in realizado', () => {
  assert.deepEqual(view(R, 'checkin_pending', 'name').map((r) => r.id), ['r1']);
  assert.ok(!view(R, 'checked_in', 'recent').some((r) => r.id === 'r1'));
});
test('checked-in → Check-in realizado; not in Pendentes', () => {
  assert.deepEqual(view(R, 'checked_in', 'name').map((r) => r.id), ['r2', 'r3', 'r4']);
  assert.ok(!view(R, 'checkin_pending', 'name').some((r) => ['r2', 'r3', 'r4'].includes(r.id)));
});
test('kit delivered → Kit entregue (and kit implies check-in in the data)', () => {
  const kit = view(R, 'kit_delivered', 'recent');
  assert.deepEqual(kit.map((r) => r.id).sort(), ['r3', 'r4']);
  assert.ok(kit.every((r) => r.checkInStatus === 'checked_in'), 'every kit row is checked in');
});
test('Check-in realizado is ordered most-recent-first by checkInAt', () => {
  assert.deepEqual(view(R, 'checked_in', 'recent').map((r) => r.id), ['r3', 'r2', 'r4']);
});
test('Kit entregue is ordered most-recent-first by kitDeliveredAt', () => {
  assert.deepEqual(view(R, 'kit_delivered', 'recent').map((r) => r.id), ['r4', 'r3']);
});
test('Todos returns every paid row', () => {
  assert.equal(view(R, 'all', 'name').length, R.length);
});
test('search works inside every view without widening the fields', () => {
  assert.deepEqual(view(R, 'checked_in', 'recent', 'carla').map((r) => r.id), ['r3']);
  assert.deepEqual(view(R, 'all', 'name', 'ana').map((r) => r.id), ['r1']);
});
test('counters are consistent with the invariants', () => {
  const c = counters(R);
  assert.equal(c.paid, 4);
  assert.equal(c.pendentes, 1);
  assert.equal(c.checkIns, 3);
  assert.equal(c.kitsEntregues, 2);
  assert.equal(c.pendentes, c.paid - c.checkIns, 'PENDENTES = PAGOS − CHECK-INS');
  assert.ok(c.kitsEntregues <= c.checkIns, 'KITS ENTREGUES ≤ CHECK-INS');
});
test('after a check-in the athlete leaves Pendentes and enters Check-in realizado', () => {
  const before = R;
  const after = before.map((r) => (r.id === 'r1' ? { ...r, checkInStatus: 'checked_in' as const, checkInAt: '2026-09-20T11:00:00Z' } : r));
  assert.ok(view(before, 'checkin_pending', 'name').some((r) => r.id === 'r1'));
  assert.ok(!view(after, 'checkin_pending', 'name').some((r) => r.id === 'r1'));
  assert.equal(view(after, 'checked_in', 'recent')[0].id, 'r1', 'newest check-in first');
});

// ---------------------------------------------------------------------------
// C — Admin.tsx wiring: tabs + counters from the current authority, no hardcode
// ---------------------------------------------------------------------------

test('the four operational tabs exist and carry live counts', () => {
  const src = code(adminPage);
  for (const label of ['"Pendentes"', '"Check-in realizado"', '"Kit entregue"', '"Todos"']) {
    assert.ok(src.includes(label), `tab ${label} present`);
  }
  assert.match(src, /statusFilter === 'checked_in'/, 'checked_in tab wired');
  assert.match(src, /statusFilter === 'kit_delivered'/, 'kit_delivered tab wired');
  assert.match(src, /count=\{operationTotals\.paid - operationTotals\.checkInPending\}/, 'check-in count derived, not hardcoded');
  assert.match(src, /count=\{operationTotals\.completed\}/, 'kit count derived, not hardcoded');
});

test('the header counters are derived from operationTotals (no magic numbers)', () => {
  const src = code(adminPage);
  assert.match(src, /label="Total pagos" value=\{operationTotals\.paid\}/);
  assert.match(src, /label="Pendentes" value=\{operationTotals\.checkInPending\}/);
  assert.match(src, /label="Check-ins" value=\{operationTotals\.paid - operationTotals\.checkInPending\}/);
  assert.match(src, /label="Kits entregues" value=\{operationTotals\.completed\}/);
});

test('the recent sort is requested only for the history views', () => {
  const src = code(adminPage);
  assert.match(src, /statusFilter === 'checked_in' \|\| statusFilter === 'kit_delivered' \? 'recent' : ''/);
  assert.match(src, /getAdminOperation\(adminKey, \{ q: query, filter: statusFilter, sort: operationSort/);
});

test('check-in / kit times render in the event timezone via the existing formatter', () => {
  const src = code(adminPage);
  assert.match(src, /businessDateTimeFormatter\.format\(date\)/, 'reuses the America/Porto_Velho formatter');
  assert.match(src, /formatOperationTime\(registration\.checkInAt\)/, 'shows the check-in time');
  assert.match(src, /formatOperationTime\(registration\.kitDeliveredAt\)/, 'shows the kit time');
});

test('the operation list no longer forces a horizontal-scroll table', () => {
  const src = code(adminPage);
  const queue = src.slice(src.indexOf('function OperationalQueue('), src.indexOf('function OperationalQueue(') + 2600);
  assert.doesNotMatch(queue, /overflow-x-auto/, 'no horizontal scroll container');
  assert.doesNotMatch(queue, /min-w-190/, 'no fixed-min-width table');
  assert.match(queue, /registration\.bibNumber/, 'dorsal shown');
  assert.match(queue, /registration\.fullName/, 'name shown');
});

test('the check-in / kit quick actions still call the existing handlers only', () => {
  const src = code(adminPage);
  assert.match(src, /onQuickAction\(registration, 'check-in'\)/);
  assert.match(src, /onQuickAction\(registration, 'kit'\)/);
  // submitQuickAction still delegates to the existing API wrappers
  assert.match(src, /checkInAdminRegistration\(adminKey, quickActionDraft\.registration\.id, quickActionDraft\.notes\)/);
  assert.match(src, /deliverAdminKit\(adminKey, quickActionDraft\.registration\.id, quickActionDraft\.notes\)/);
});

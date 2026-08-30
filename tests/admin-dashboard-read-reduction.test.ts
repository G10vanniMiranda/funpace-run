import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// ADMIN-002 Stage 5B — the executive dashboard / summary use a lean read.

const db = readFileSync('server/database.ts', 'utf8');
const server = readFileSync('server/index.ts', 'utf8');

function block(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `${startNeedle} located`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  return source.slice(start, end >= 0 ? end : undefined);
}

test('the admin-dashboard scope loads events/distances/lots/registrations/payments/payment-events/check-ins/kit-deliveries', () => {
  const include = block(db, 'const include = {', '\n  };');
  for (const line of ['events:', 'distances:', 'lots:', 'registrations:', 'payments:', 'paymentEvents:', 'checkIns:', 'kitDeliveries:']) {
    const row = include.split('\n').find((l) => l.trim().startsWith(line));
    assert.ok(row && row.includes("'admin-dashboard'"), `${line} includes 'admin-dashboard'`);
  }
});

test('the admin-dashboard scope does NOT load audit-logs / email-deliveries / google-sheet-sync', () => {
  const include = block(db, 'const include = {', '\n  };');
  for (const line of ['auditLogs:', 'emailDeliveries:', 'googleSheetSyncs:']) {
    const row = include.split('\n').find((l) => l.trim().startsWith(line));
    assert.ok(row && !row.includes("'admin-dashboard'"), `${line} does NOT include 'admin-dashboard'`);
  }
});

test('the lean dashboard read selects no raw jsonb (payload / gateway_payload / meta_context / payment-event payload)', () => {
  // ADMIN-002 Stage 5C moved the lean projections into named LEAN_*_SELECT
  // constants (reused by the event-scoped queries). Assert on those.
  const read = block(db, 'export async function readPostgresDatabase', '\n  return {');
  const leanReg = read.slice(read.indexOf('const LEAN_REGISTRATION_SELECT'), read.indexOf('const LEAN_PAYMENT_SELECT'));
  assert.match(leanReg, /jsonb_build_object\(/);
  assert.ok(!/\bmeta_context\b/.test(leanReg), 'lean registrations: no meta_context');
  assert.ok(!/,\s*payload\s*,/.test(leanReg), 'lean registrations: no bare payload column');
  // the allow-list is exactly the fields the dashboard reads
  for (const f of ["'city'", "'state'", "'gender'", "'shirtSize'", "'distance'", "'birthDate'", "'attribution'"]) {
    assert.ok(leanReg.includes(f), `payload allow-list keeps ${f}`);
  }
  const leanPay = read.slice(read.indexOf('const LEAN_PAYMENT_SELECT'), read.indexOf('const LEAN_PAYMENT_EVENT_SELECT'));
  assert.ok(!/gateway_payload/.test(leanPay), 'lean payments: no gateway_payload');
  const leanPe = read.slice(read.indexOf('const LEAN_PAYMENT_EVENT_SELECT'), read.indexOf('const registrations ='));
  assert.ok(!/\bpayload\b/.test(leanPe), 'lean payment-events: no payload');
});

test('both dashboard endpoints use scope: admin-dashboard', () => {
  const exec = block(server, 'async function handleAdminExecutiveDashboard', '\nasync function ');
  const summary = block(server, 'async function handleAdminSummary', '\nasync function ');
  assert.match(exec, /scope: 'admin-dashboard'/);
  assert.match(summary, /scope: 'admin-dashboard'/);
  // and neither falls back to the heavy admin-registrations loader
  assert.ok(!/scope: 'admin-registrations'/.test(exec));
  assert.ok(!/scope: 'admin-registrations'/.test(summary));
});

test('SQL stays parameterized — the event-scoped lean read binds the event id, never interpolates it', () => {
  const read = block(db, 'export async function readPostgresDatabase', '\n  return {');
  // the LEAN_* SELECT constants interpolate only ${table.*}
  const selects = read.slice(read.indexOf('const LEAN_REGISTRATION_SELECT'), read.indexOf('const registrations ='));
  for (const t of selects.match(/\$\{[^}]+\}/g) || []) {
    assert.ok(/^\$\{table\./.test(t), `LEAN_* SELECTs interpolate only table names, found ${t}`);
  }
  // every event-scoped query passes the id through the bound `eventScopedParams`
  // array and interpolates only ${table.*} / ${LEAN_*_SELECT} into its text
  const scoped = read.match(/client\.query\(`[^`]*event_id = \$1[^`]*`, eventScopedParams\)/g) || [];
  assert.ok(scoped.length >= 5, `event-scoped queries are parameterised (found ${scoped.length})`);
  for (const q of scoped) {
    for (const t of q.match(/\$\{[^}]+\}/g) || []) {
      assert.ok(/^\$\{(table\.|LEAN_)/.test(t), `scoped query interpolates only table / LEAN_* constants, found ${t}`);
    }
  }
  assert.match(read, /const eventScopedParams = dashboardEventId \? \[dashboardEventId\] : \[\];/);
});

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
  // registrations lean branch
  const regLean = block(db, 'const registrations = include.registrations', ': emptyRows;');
  const leanReg = regLean.slice(regLean.indexOf('leanDashboard'), regLean.indexOf('from ${table.registrations}`') + 40);
  assert.match(leanReg, /jsonb_build_object\(/);
  assert.ok(!/\bmeta_context\b/.test(leanReg), 'lean registrations: no meta_context');
  assert.ok(!/,\s*payload\s*,/.test(leanReg), 'lean registrations: no bare payload column');
  // the allow-list is exactly the fields the dashboard reads
  for (const f of ["'city'", "'state'", "'gender'", "'shirtSize'", "'distance'", "'birthDate'", "'attribution'"]) {
    assert.ok(leanReg.includes(f), `payload allow-list keeps ${f}`);
  }
  // payments lean branch
  const payLean = block(db, 'const payments = include.payments', ': emptyRows;');
  const leanPay = payLean.slice(payLean.indexOf('leanDashboard'), payLean.indexOf('from ${table.payments}`') + 30);
  assert.ok(!/gateway_payload/.test(leanPay), 'lean payments: no gateway_payload');
  // payment-events lean branch
  const peLean = block(db, 'const paymentEvents = include.paymentEvents', ': emptyRows;');
  const leanPe = peLean.slice(peLean.indexOf('leanDashboard'), peLean.indexOf('from ${table.paymentEvents}`') + 30);
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

test('SQL stays parameterized — the lean read has no request-controlled interpolation', () => {
  const regLean = block(db, 'const registrations = include.registrations', ': emptyRows;');
  // only ${table.*} template refs are allowed; no ${eventId} / ${url...} etc.
  const templates = regLean.match(/\$\{[^}]+\}/g) || [];
  for (const t of templates) assert.ok(/^\$\{table\./.test(t), `only table templates in lean SQL, found ${t}`);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// ADMIN-002 Stage 3B — the Executive Dashboard must not present "refund" as an
// operational capability. Refund is not implemented (0 refunds ever;
// registration.status='refunded' is unreachable). The misleading "Reembolsadas"
// status tile was removed from the executive surface; the backend contract key
// stays for compatibility (KNOWN_LEGACY_DEBT), it is just no longer rendered.

function executiveDashboardPanel(): string {
  const source = readFileSync('src/pages/Admin.tsx', 'utf8');
  const start = source.indexOf('function ExecutiveDashboardPanel(');
  assert.ok(start >= 0, 'ExecutiveDashboardPanel located');
  const rest = source.slice(start);
  // stop at the next top-level `function ` declaration
  const end = rest.indexOf('\nfunction ', 1);
  return end >= 0 ? rest.slice(0, end) : rest;
}

test('executive dashboard no longer renders a "Reembolsadas" status tile', () => {
  const panel = executiveDashboardPanel();
  // no tile entry (the string may still appear inside the marker comment below)
  assert.ok(!/\[\s*'Reembolsadas'/.test(panel), 'no "Reembolsadas" tile entry on the executive surface');
  assert.ok(
    !/registrationsData\s*\??\.\s*refunded/.test(panel),
    'executive surface does not read registrations.refunded',
  );
});

test('executive dashboard keeps the real operational status tiles', () => {
  const panel = executiveDashboardPanel();
  for (const label of ['Confirmadas', 'Pendentes', 'Expiradas', 'Canceladas', 'Conversão participantes']) {
    assert.ok(panel.includes(label), `status funnel still shows "${label}"`);
  }
});

test('a marker comment discourages silently reintroducing the refund tile', () => {
  const panel = executiveDashboardPanel();
  assert.match(panel, /Stage 3B: "Reembolsadas" removed/);
});

test('backend executive contract still carries registrations.refunded for compatibility', () => {
  // Not rendered anymore, but the key is preserved so no consumer breaks.
  const builder = readFileSync('server/operational-intelligence.ts', 'utf8');
  assert.match(builder, /refunded: statusCounts\.refunded \|\| 0/);
  const types = readFileSync('src/types/registration.ts', 'utf8');
  assert.match(types, /refunded: number;/);
});

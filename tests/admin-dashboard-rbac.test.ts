import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { financialVisibleForRole } from '../server/executive-metrics';

// ADMIN-002 Stage 1 — RBAC contract for the executive dashboard surface.

test('financialVisibleForRole: administrator and finance only', () => {
  assert.equal(financialVisibleForRole('administrator'), true);
  assert.equal(financialVisibleForRole('finance'), true);
  assert.equal(financialVisibleForRole('operation'), false);
  assert.equal(financialVisibleForRole(null), false);
  assert.equal(financialVisibleForRole(undefined), false);
});

test('executive-dashboard endpoint is gated to administrator/finance (operation -> 403)', () => {
  const source = readFileSync('server/index.ts', 'utf8');
  assert.match(
    source,
    /handleAdminExecutiveDashboard[\s\S]{0,200}?requireAdmin\(req, res, \['administrator', 'finance'\]\)/,
  );
  // requireAdmin answers 403 for an authenticated session whose role is not listed.
  assert.match(source, /if \(session && roles\) \{ json\(res, 403,/);
});

test('admin summary redacts financial metrics for non-finance roles', () => {
  const source = readFileSync('server/index.ts', 'utf8');
  const summary = source.slice(
    source.indexOf('async function handleAdminSummary'),
    source.indexOf('async function handleAdminMetaIntegrationStatus'),
  );
  assert.ok(summary.length > 0, 'handleAdminSummary block located');
  assert.match(summary, /const financialVisible = financialVisibleForRole\(session\.role\)/);
  assert.match(summary, /revenueCents: financialVisible \? revenueCents : 0/);
  assert.match(summary, /averageTicketCents: financialVisible \? averageTicketCents : 0/);
  assert.match(summary, /todayRevenueCents: financialVisible \? todayRevenueCents : 0/);
  assert.match(summary, /manualReconciledPayments: financialVisible \? manualReconciledPayments : 0/);
  assert.match(summary, /daily: financialVisible \? daily : daily\.map\(\(point\) => \(\{ \.\.\.point, amountCents: 0 \}\)\)/);
});

test('admin summary still routes revenue through the single canonical engine', () => {
  const source = readFileSync('server/index.ts', 'utf8');
  const summary = source.slice(
    source.indexOf('async function handleAdminSummary'),
    source.indexOf('async function handleAdminMetaIntegrationStatus'),
  );
  assert.match(summary, /const metrics = buildExecutiveMetrics\(database, now\)/);
  assert.match(summary, /const revenueCents = metrics\.financial\.grossRevenueCents/);
  assert.match(summary, /const todayRevenueCents = metrics\.financial\.todayRevenueCents/);
  // no resurrected parallel revenue formula
  assert.ok(!/const revenueCents = paid\.reduce/.test(summary));
});

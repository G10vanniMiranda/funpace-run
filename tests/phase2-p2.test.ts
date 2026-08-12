import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('registration requests are treated as sensitive in frontend diagnostics', () => {
  const api = readFileSync('src/lib/api.ts', 'utf8');
  const start = api.indexOf('export function createRegistration');
  const end = api.indexOf('export function updateMarketingConsent', start);
  const registrationRequest = api.slice(start, end);
  assert.match(registrationRequest, /sensitive:\s*true/);
});

test('InfinitePay metadata avoids redundant athlete email', () => {
  const infinitePay = readFileSync('server/infinitepay.ts', 'utf8');
  const start = infinitePay.indexOf('export async function createInfinitePayCheckout');
  const end = infinitePay.indexOf('const timeout', start);
  const checkoutBody = infinitePay.slice(start, end);
  assert.doesNotMatch(checkoutBody, /athleteEmail/);
  assert.match(checkoutBody, /customer:\s*\{[\s\S]*email:\s*input\.customer\.email/);
});

test('admin bootstrap logs do not include the administrative email', () => {
  const server = readFileSync('server/index.ts', 'utf8');
  const script = readFileSync('scripts/bootstrap-admin.ts', 'utf8');
  assert.doesNotMatch(server, /Admin bootstrap ensured for \$\{adminBootstrapEmail\}/);
  assert.doesNotMatch(script, /Admin user ensured in database: \$\{email\}/);
  assert.match(server, /message:\s*'admin_bootstrap_ensured'/);
});

test('retention and first-touch/last-touch policies are explicit', () => {
  const policy = readFileSync('docs/META_PHASE2_DATA_POLICY.md', 'utf8');
  assert.match(policy, /firstTouch/);
  assert.match(policy, /lastTouch/);
  assert.match(policy, /meta_context/);
  assert.match(policy, /outbox/i);
  assert.match(policy, /logs/i);
});

test('polled admin dashboards do not synchronize the same operational alerts concurrently', () => {
  const server = readFileSync('server/index.ts', 'utf8');
  const database = readFileSync('server/database.ts', 'utf8');
  const dashboardStart = server.indexOf('async function handleAdminExecutiveDashboard');
  const dashboardEnd = server.indexOf('async function handleAdminAlerts', dashboardStart);
  const dashboard = server.slice(dashboardStart, dashboardEnd);
  const monitoringStart = server.indexOf('async function handleAdminMonitoring');
  const monitoringEnd = server.indexOf('async function handleAdminEventConfig', monitoringStart);
  const monitoring = server.slice(monitoringStart, monitoringEnd);
  assert.doesNotMatch(dashboard, /refreshOperationalAlerts\(/);
  assert.doesNotMatch(monitoring, /refreshOperationalAlerts\(/);
  assert.match(database, /pg_try_advisory_xact_lock\(hashtext\('funpace-run-operational-alert-sync'\)\)/);
});

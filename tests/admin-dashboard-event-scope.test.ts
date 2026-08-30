import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// ADMIN-002 Stage 4B — the executive dashboard surface is event-scoped.

const server = readFileSync('server/index.ts', 'utf8');
const admin = readFileSync('src/pages/Admin.tsx', 'utf8');
const api = readFileSync('src/lib/api.ts', 'utf8');

function block(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `${startNeedle} located`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  return source.slice(start, end >= 0 ? end : undefined);
}

test('executive-dashboard + summary handlers resolve an explicit event scope', () => {
  assert.match(server, /async function handleAdminExecutiveDashboard\(req: IncomingMessage, res: ServerResponse, url: URL\)/);
  assert.match(server, /async function handleAdminSummary\(req: IncomingMessage, res: ServerResponse, url: URL\)/);
  const dashboard = block(server, 'async function handleAdminExecutiveDashboard', '\nasync function ');
  assert.match(dashboard, /const eventScope = resolveDashboardEventScope\(res, fullDatabase, url\)/);
  assert.match(dashboard, /if \(!eventScope\) return;/);
  assert.match(dashboard, /event: eventScope\.context,/);
  // ADMIN-002 Stage 5C: the rows are already event-filtered in SQL; the engine
  // is handed eventScope.scoped (Stage 4B narrow) purely as defence-in-depth.
  assert.match(dashboard, /buildExecutiveDashboard\(eventScope\.scoped, new Date\(\), \{ eventId: eventScope\.event\.id \}\)/);
  const summary = block(server, 'async function handleAdminSummary', '\nasync function ');
  assert.match(summary, /const eventScope = resolveDashboardEventScope\(res, fullDatabase, url\)/);
  assert.match(summary, /const database = eventScope\.scoped;/);
  assert.match(summary, /event: eventScope\.context,/);
});

test('event scope resolver answers a controlled 400 — never 500 / fallback / leak', () => {
  const resolver = block(server, 'function resolveDashboardEventScope', '\nasync function handleAdminSummary');
  assert.match(resolver, /resolveEventScope\(database\.events, \{/);
  assert.match(resolver, /json\(res, 400, \{ code: resolution\.code/);
  assert.match(resolver, /return null;/);
  // no events\[0\] / latest / hardcoded slug fallback in the resolver
  assert.ok(!/events\[0\]/.test(resolver));
  assert.ok(!/funpace-run-2026/.test(resolver));
});

test('ADMIN-002 Stage 5B: executive dashboard no longer reads or emits alerts / reconciliation', () => {
  const dashboard = block(server, 'async function handleAdminExecutiveDashboard', '\nasync function ');
  assert.ok(!/listOperationalAlertsInPostgres\(\)/.test(dashboard), 'no alerts read in executive-dashboard');
  assert.ok(!/getReconciliationDashboardInPostgres\(\)/.test(dashboard), 'no reconciliation read in executive-dashboard');
  assert.ok(!/\balerts:\s*\{/.test(dashboard), 'no alerts field in executive-dashboard response');
  assert.ok(!/\breconciliation:\s*\{/.test(dashboard), 'no reconciliation field in executive-dashboard response');
  assert.match(dashboard, /scope: 'admin-dashboard'/);
  // the alert / reconciliation DOMAINS stay untouched (dedicated endpoints)
  assert.match(server, /url\.pathname === '\/api\/admin\/alerts'\) \{ await handleAdminAlerts/);
  assert.match(server, /url\.pathname === '\/api\/admin\/reconciliation'\) \{ await handleAdminReconciliation/);
});

test('ADMIN-002 Stage 5B: dashboard type contract dropped alerts / reconciliation', () => {
  const types = readFileSync('src/types/registration.ts', 'utf8');
  const dash = block(types, 'export type AdminExecutiveDashboard = {', '\n};');
  assert.ok(!/^\s*alerts:/m.test(dash), 'AdminExecutiveDashboard has no alerts field');
  assert.ok(!/^\s*reconciliation:/m.test(dash), 'AdminExecutiveDashboard has no reconciliation field');
});

test('GET /api/admin/events endpoint exists with dashboard RBAC and non-sensitive fields only', () => {
  assert.match(server, /url\.pathname === '\/api\/admin\/events'\) \{ await handleAdminEvents\(req, res\)/);
  const handler = block(server, 'async function handleAdminEvents', '\n}');
  assert.match(handler, /requireAdmin\(req, res, \['administrator', 'finance'\]\)/);
  assert.match(handler, /listAdminEventsInPostgres\(\)/);
  const dbFn = readFileSync('server/database.ts', 'utf8');
  assert.match(dbFn, /select id, slug, name, status, date from \$\{table\.events\}\s*\n\s*where status in \('published', 'closed'\)/);
});

test('RBAC unchanged — executive dashboard still administrator/finance only', () => {
  const dashboard = block(server, 'async function handleAdminExecutiveDashboard', '\nasync function ');
  assert.match(dashboard, /requireAdmin\(req, res, \['administrator', 'finance'\]\)/);
});

test('frontend keeps the selected event in the URL (?event=slug), never in session state', () => {
  const panel = block(admin, 'function ExecutiveDashboardPanel(', '\nfunction ExecutiveSeries(');
  assert.match(panel, /new URLSearchParams\(window\.location\.search\)\.get\('event'\)/);
  assert.match(panel, /window\.history\.replaceState/);
  assert.match(panel, /getAdminExecutiveDashboard\(adminKey, eventSlug\)/);
  assert.match(panel, /aria-label="Selecionar evento do dashboard"/);
  assert.ok(!/sessionStorage|localStorage/.test(panel), 'no session/local storage for event selection');
});

test('api client forwards the event slug as a query param', () => {
  assert.match(api, /getAdminExecutiveDashboard\(adminKey: string, eventSlug\?: string\)[\s\S]*?toQueryString\(\{ event: eventSlug \|\| '' \}\)/);
  assert.match(api, /getAdminSummary\(adminKey: string, eventSlug\?: string\)/);
  assert.match(api, /export function getAdminEvents\(adminKey: string\)/);
});

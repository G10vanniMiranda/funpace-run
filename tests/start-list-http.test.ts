import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// EVENT-DAY-OFFLINE-FALLBACK & START-LIST — HTTP wiring. Repo convention: no
// jsdom / no live server in unit tests; RBAC / no-store / zero-mutation are
// proven by static source assertion here and by the real-Postgres homolog proof
// (.tmp/start-list-homolog-proof.mts) separately.

const server = readFileSync('server/index.ts', 'utf8');
const api = readFileSync('src/lib/api.ts', 'utf8');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function block(source: string, start: string, end: string): string {
  const a = source.indexOf(start);
  assert.ok(a >= 0, `${start} located`);
  const b = source.indexOf(end, a + start.length);
  return source.slice(a, b >= 0 ? b : undefined);
}

const resolveBlock = () => block(server, 'async function resolveStartListRequest(', '\nasync function handleAdminStartList(');
const jsonHandler = () => block(server, 'async function handleAdminStartList(', '\nasync function handleAdminStartListCsv(');
const csvHandler = () => block(server, 'async function handleAdminStartListCsv(', '\nasync function handleAdminPartnershipsCsv(');

// ---------------------------------------------------------------------------
// routes exist, both GET, dedicated (NOT a preset on registrations.csv)
// ---------------------------------------------------------------------------
test('both routes are registered as GET and are dedicated endpoints', () => {
  assert.match(server, /req\.method === 'GET' && url\.pathname === '\/api\/admin\/start-list'\s*\)\s*\{\s*await handleAdminStartList\(req, res, url\)/);
  assert.match(server, /req\.method === 'GET' && url\.pathname === '\/api\/admin\/start-list\.csv'\s*\)\s*\{\s*await handleAdminStartListCsv\(req, res, url\)/);
  // not implemented as a preset on the PII-heavy registrations exporter
  assert.doesNotMatch(block(server, 'async function handleAdminRegistrationsCsv(', '\nasync function '), /start-list|startlist|preset/i);
});

// ---------------------------------------------------------------------------
// RBAC: administrator + operation on BOTH; canonical requireAdmin contract
// ---------------------------------------------------------------------------
test('RBAC is requireAdmin([administrator, operation]) via the shared resolver', () => {
  assert.match(resolveBlock(), /const session = await requireAdmin\(req, res, \['administrator', 'operation'\]\);/);
  assert.match(resolveBlock(), /if \(!session \|\| !requireAdminDatabase\(res\)\) return null;/);
  // both handlers go through the one resolver — no second, looser auth path
  assert.match(jsonHandler(), /const resolved = await resolveStartListRequest\(req, res, url\);\s*\n\s*if \(!resolved\) return;/);
  assert.match(csvHandler(), /const resolved = await resolveStartListRequest\(req, res, url\);\s*\n\s*if \(!resolved\) return;/);
  assert.doesNotMatch(jsonHandler() + csvHandler(), /requireAdmin\(/); // only the resolver authenticates
});

// ---------------------------------------------------------------------------
// event scope is mandatory — reuses the dashboard resolver (400 EVENT_*)
// ---------------------------------------------------------------------------
test('event scope is mandatory and reuses resolveDashboardEventScope', () => {
  assert.match(resolveBlock(), /const eventScope = resolveDashboardEventScope\(res, database, url\);\s*\n\s*if \(!eventScope\) return null;/);
  // invalid sort fails closed with a 400 code before any DB read
  assert.match(resolveBlock(), /if \(sort === null\) \{\s*\n\s*json\(res, 400, \{ code: 'INVALID_SORT'/);
});

// ---------------------------------------------------------------------------
// no-store on BOTH responses; CSV forces attachment
// ---------------------------------------------------------------------------
test('no-store cache headers on JSON and CSV; CSV is an attachment', () => {
  assert.match(server, /function setStartListCacheHeaders\(res: ServerResponse\) \{\s*\n\s*res\.setHeader\('Cache-Control', 'private, no-store, max-age=0'\);\s*\n\s*res\.setHeader\('Vary', 'Cookie'\);\s*\n\s*res\.setHeader\('X-Content-Type-Options', 'nosniff'\);/);
  assert.match(jsonHandler(), /setStartListCacheHeaders\(res\);\s*\n\s*json\(res, 200/);
  assert.match(csvHandler(), /setStartListCacheHeaders\(res\);/);
  // csv() helper always sets Content-Disposition: attachment
  assert.match(server, /function csv\(res: ServerResponse[\s\S]*?'Content-Disposition': `attachment; filename="\$\{filename\}"`/);
  assert.match(csvHandler(), /csv\(res, `\$\{slug\}-lista-largada-\$\{order\}-\$\{day\}\.csv`, body\)/);
});

// ---------------------------------------------------------------------------
// CSV contract: BOM + CRLF + every cell through the canonical escapeCsv
// ---------------------------------------------------------------------------
test('CSV: UTF-8 BOM, CRLF joins, canonical escapeCsv on every cell', () => {
  const h = csvHandler();
  assert.match(h, /const grid = startListCsvCells\(list\);/);
  assert.match(h, /`﻿\$\{grid\.map\(\(cells\) => cells\.map\(escapeCsv\)\.join\(','\)\)\.join\('\\r\\n'\)\}\\r\\n`/);
  // integrity fail-closed → 409, no file
  assert.match(h, /if \(list\.outcome\.status === 'blocked'\) \{\s*\n\s*json\(res, 409, \{\s*\n\s*code: 'START_LIST_INTEGRITY_FAILED'/);
});

// ---------------------------------------------------------------------------
// hand-built allowlist — the source row picks named fields off toAdminRow
// ---------------------------------------------------------------------------
test('source rows are a hand-built field allowlist off toAdminRow — no PII columns', () => {
  const r = code(resolveBlock());
  assert.match(r, /const row = toAdminRow\(eventScope\.scoped, registration\);/);
  // exactly the permitted source fields
  for (const f of ['id: row.id', 'name: row.fullName', 'cpfMasked: row.cpfMasked', 'bibNumber: row.bibNumber', 'distance: row.distance', 'distanceId: row.distanceId', 'shirtSize: row.shirtSize', 'status: row.status']) {
    assert.ok(r.includes(f), `missing source field: ${f}`);
  }
  // never forwards raw PII / financial fields to the projection
  for (const forbidden of [/row\.email/, /row\.phone/, /row\.birthDate/, /row\.amountCents/, /row\.gatewayTransactionId/, /row\.providerPaymentId/, /row\.couponCode/, /row\.partnerId/, /payload\.cpf/]) {
    assert.doesNotMatch(r, forbidden, `must not forward ${forbidden}`);
  }
  // personKey is derived from cpf_hash (already a hash) and only feeds the count
  assert.match(r, /personKey: registration\.cpfHash \? `cpf:\$\{registration\.cpfHash\}` : `id:\$\{registration\.id\}`/);
});

// ---------------------------------------------------------------------------
// ZERO MUTATION — read-only end to end
// ---------------------------------------------------------------------------
test('the whole feature is read-only: persist:false scoped read, no write, no audit', () => {
  const all = code(resolveBlock() + jsonHandler() + csvHandler());
  assert.match(all, /await transaction\(\(current\) => current, \{ persist: false, scope: 'admin-registrations' \}\)/);
  assert.doesNotMatch(all, /persist:\s*true/);
  assert.doesNotMatch(all, /savePostgresDatabase|pg_advisory_xact_lock|funpace-run-write/);
  assert.doesNotMatch(all, /appendAuditLogInPostgres|createAuditLog|auditLogs\.push|'registration\.[a-z_]+'/);
  assert.doesNotMatch(all, /\binsert into\b|\bupdate \$\{table|\bdelete from\b/i);
  assert.doesNotMatch(all, /checkInRegistrationInPostgres|deliverRegistrationKitInPostgres|setRegistrationBibInPostgres|correctRegistrationDistanceInPostgres/);
  assert.doesNotMatch(all, /sendEmail|processRegistrationEmail|notify/i);
  // only transaction() call is the persist:false read
  assert.equal([...all.matchAll(/\btransaction\(/g)].length, 1);
});

// ---------------------------------------------------------------------------
// pure module boundary
// ---------------------------------------------------------------------------
test('server/start-list.ts is pure — no DB, no http, no react, never reads payload.cpf', () => {
  const mod = readFileSync('server/start-list.ts', 'utf8');
  const src = code(mod);
  assert.doesNotMatch(src, /\btransaction\(|requirePool|IncomingMessage|ServerResponse|from 'react'/);
  assert.doesNotMatch(src, /payload\.cpf|registration\.payload/);
  // only import is node:crypto
  assert.deepEqual([...src.matchAll(/^import .*/gm)].map((m) => m[0].trim()), ["import { createHash } from 'node:crypto';"]);
});

// ---------------------------------------------------------------------------
// client api helpers
// ---------------------------------------------------------------------------
test('api.ts: getAdminStartList (JSON) + getAdminStartListCsvUrl, both event-scoped', () => {
  assert.match(api, /export function getAdminStartList\(adminKey: string, params: \{ sort: [^}]+\}\) \{/);
  assert.match(api, /\/api\/admin\/start-list\$\{toQueryString\(\{ event: currentEventParam\(\), sort: params\.sort \}\)\}/);
  assert.match(api, /export function getAdminStartListCsvUrl\(params: \{ sort: [^}]+\}\) \{/);
  assert.match(api, /\/api\/admin\/start-list\.csv\$\{toQueryString\(\{ event: currentEventParam\(\), sort: params\.sort \}\)\}/);
});

// ---------------------------------------------------------------------------
// FULL_BLOB containment unchanged
// ---------------------------------------------------------------------------
test('FULL_BLOB writer baseline is untouched by this wave', () => {
  const containment = readFileSync('tests/prod-safety-containment-static.test.ts', 'utf8');
  assert.match(containment, /const FULL_BLOB_WRITER_BASELINE = \{ 'server\/index\.ts': 12, 'server\/database\.ts': 2 \};/);
});

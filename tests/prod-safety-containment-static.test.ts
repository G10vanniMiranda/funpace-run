import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// PROD-SAFETY-001 Stage 2 — structural guards against regression of the
// EVENT-OPS INCIDENT-002 anti-patterns. Repo convention: no jsdom / no live PG
// in unit tests; real-PostgreSQL semantics are proven in homolog separately.

const db = readFileSync('server/database.ts', 'utf8');
const idx = readFileSync('server/index.ts', 'utf8');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function slice(src: string, startNeedle: string, endNeedle: string): string {
  const a = src.indexOf(startNeedle);
  const b = src.indexOf(endNeedle, a + startNeedle.length);
  assert.ok(a >= 0 && b > a, `located ${startNeedle}`);
  return src.slice(a, b);
}

// ---------------------------------------------------------------------------
// A — the runtime auto-migrate guard is wired fail-closed, BEFORE any DDL/DML
// ---------------------------------------------------------------------------
test('ensurePostgresDatabase calls the guard as its first statement (before the first CREATE)', () => {
  const fn = code(slice(db, 'async function ensurePostgresDatabase(', '\nasync function ensurePostgresReady()'));
  const guardAt = fn.indexOf('assertRuntimeAutoMigrateAllowed(');
  const firstQueryAt = fn.indexOf('client.query(');
  assert.ok(guardAt >= 0, 'guard present in ensurePostgresDatabase');
  assert.ok(guardAt < firstQueryAt, 'guard runs before the first client.query() — 0 CREATE/ALTER/INSERT before the fail');
});

test('ensurePostgresReady also calls the guard before memoising postgresReady', () => {
  const fn = code(slice(db, 'async function ensurePostgresReady()', '\nasync function expireTemporaryReservations'));
  const guardAt = fn.indexOf('assertRuntimeAutoMigrateAllowed(');
  const memoAt = fn.indexOf('postgresReady = ensurePostgresDatabase');
  assert.ok(guardAt >= 0 && guardAt < memoAt, 'guard runs before the promise is memoised — fails fast and identically every call');
});

// ---------------------------------------------------------------------------
// B — ensureConfiguredLots is a first-bootstrap seed, not a config reconciler
// ---------------------------------------------------------------------------
test('ensureConfiguredLots uses ON CONFLICT DO NOTHING — never re-prices / re-activates / re-dates an existing lot', () => {
  const fn = slice(db, 'async function ensureConfiguredLots(', '\nexport async function createPendingRegistrationInPostgres(');
  assert.match(fn, /on conflict \(id\) do nothing/, 'seed is insert-or-nothing');
  assert.doesNotMatch(fn, /on conflict[\s\S]*?do update/, 'no ON CONFLICT DO UPDATE anywhere in the seed');
  for (const col of ['price_cents = excluded', 'status = case', 'starts_at = excluded', 'ends_at = excluded', 'capacity = excluded', 'sold_count = excluded']) {
    assert.doesNotMatch(fn, new RegExp(col.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `seed must not overwrite ${col}`);
  }
});

// ---------------------------------------------------------------------------
// C — appendAuditLogInPostgres is narrow (no full-blob, no lock, no auto-migrate)
// ---------------------------------------------------------------------------
test('appendAuditLogInPostgres: single INSERT into run-audit-logs, nothing else', () => {
  const fn = code(slice(db, 'export async function appendAuditLogInPostgres(', 'export async function getRegistrationContactEmailInPostgres('));
  assert.doesNotMatch(fn, /ensurePostgresReady/, 'no runtime auto-migrate trigger');
  assert.doesNotMatch(fn, /readPostgresDatabase|savePostgresDatabase/, 'no full-dataset read/write');
  assert.doesNotMatch(fn, /pg_advisory_xact_lock|funpace-run-write/, 'no global advisory lock');
  assert.doesNotMatch(fn, /\btransaction\s*[<(]/, 'does not delegate to the generic transaction()');
  const tables = [...fn.matchAll(/\$\{table\.(\w+)\}/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(tables)], ['auditLogs'], `touches only run-audit-logs — got ${[...new Set(tables)].join(',')}`);
  const inserts = [...fn.matchAll(/insert into/gi)].length;
  assert.equal(inserts, 1, 'exactly one INSERT');
});

test('getRegistrationContactEmailInPostgres: one narrow SELECT, no full read', () => {
  const fn = code(slice(db, 'export async function getRegistrationContactEmailInPostgres(', '\nfunction mapIntegrationEvent('));
  assert.doesNotMatch(fn, /ensurePostgresReady|readPostgresDatabase|savePostgresDatabase|\btransaction\s*[<(]/);
  assert.match(fn, /select payload->>'email' as email from \$\{table\.registrations\} where id = \$1/);
});

// ---------------------------------------------------------------------------
// D — the INCIDENT-002 trigger no longer uses the generic full-blob transaction
// ---------------------------------------------------------------------------
test('email.confirmation.skipped (Postgres path) is a narrow audit append', () => {
  const skip = code(slice(idx, 'if (!isEmailConfigured()) {', "message: 'registration_email_skipped'"));
  assert.match(skip, /if \(usesPostgresDatabase\(\)\)/, 'Postgres path is branched out');
  assert.match(skip, /appendAuditLogInPostgres\(\{[\s\S]*?action: 'email\.confirmation\.skipped'/, 'Postgres path uses the narrow append');
  // the ONLY transaction() left in this branch is the JSON-mode fallback
  const pgPart = skip.slice(skip.indexOf('if (usesPostgresDatabase())'), skip.indexOf('} else {'));
  assert.doesNotMatch(pgPart, /\btransaction\s*[<(]/, 'the Postgres branch never calls transaction()');
});

// ---------------------------------------------------------------------------
// E — NO generic transaction() for a pure audit-only append (anti-pattern lock)
// ---------------------------------------------------------------------------
test('no generic persist:true transaction() whose callback ONLY pushes to auditLogs', () => {
  const src = idx.split('\n');
  const offenders: number[] = [];
  for (let i = 0; i < src.length; i++) {
    if (!/\btransaction\s*[<(]/.test(src[i]) || /function transaction/.test(src[i])) continue;
    // find the matching options object within the next 40 lines
    const block = src.slice(i, i + 40).join('\n');
    const head = block.slice(0, block.search(/\}\s*,\s*\{[^}]*\}\s*\)|\}\s*\)\s*;/));
    if (/persist:\s*false/.test(block)) continue;
    // heuristic: the callback body mutates ONLY auditLogs (push) and reads nothing structural
    const pushes = (head.match(/auditLogs\.push/g) || []).length;
    const otherMutation = /\.status\s*=|\.updatedAt\s*=|\bregistration\.\w+\s*=|\bpayment\.\w+\s*=|releaseRegistrationCapacity|synchronizeLotProjections|\.sold_?count/i.test(head);
    const structuralRead = /buildRemarketingProjections|buildParticipantsPage|consolidateParticipants|readPostgresDatabase/.test(head);
    if (pushes > 0 && !otherMutation && !structuralRead && head.replace(/[^{]/g, '').length <= 3) {
      // small, audit-only callback under a full-blob transaction — the forbidden shape
      offenders.push(i + 1);
    }
  }
  assert.deepEqual(offenders, [], `audit-only append must use appendAuditLogInPostgres, not transaction(); offenders at line(s): ${offenders.join(', ')}`);
});

// ---------------------------------------------------------------------------
// H — full-blob generic transaction() writer inventory is FROZEN (must not grow)
// ---------------------------------------------------------------------------
// Baseline captured at PROD-SAFETY-001 Stage 2. Each of these is a generic
// transaction() call without persist:false, i.e. it still routes through
// savePostgresDatabase (16-table writeback under funpace-run-write) on the
// Postgres path (many are `? narrowFn : transaction(jsonFallback)` ternaries).
// Wave 3 migrates these to narrow repository functions; this number must only
// ever DECREASE. A new full-blob writer must be justified + reviewed, then the
// baseline lowered deliberately.
//
// ADMIN-UX-RELIABILITY Wave 2A: 22 -> 21. handleAdminBibNumber no longer wraps
// the bib assignment in a generic full-blob transaction(); it delegates to the
// narrow setRegistrationBibInPostgres primitive (server/database.ts). The bib
// operation's only remaining transaction() call is the read-only
// `persist: false` refetch, which is not a full-blob writer.
//
// ADMIN-UX-RELIABILITY Wave 2B: 21 -> 20. handleAdminCheckIn delegates to the
// narrow checkInRegistrationInPostgres primitive and no longer wraps check-in in
// a generic full-blob transaction(). The undo-check-in branch of
// handleAdminRegistrationMaintenance also delegates (to
// undoRegistrationCheckInInPostgres), but that handler's generic transaction()
// LINE stays counted — it still serves undo-kit (Wave 2C) and the cancel
// JSON-mode fallback. So this wave removes exactly one independent writer
// (check-in); the 20 -> 19 decrement lands with Wave 2C.
//
// ADMIN-UX-RELIABILITY Wave 2C: 20 -> 19. handleAdminKitDelivery delegates to the
// narrow deliverRegistrationKitInPostgres primitive and no longer wraps kit
// delivery in a generic full-blob transaction(). The undo-kit branch of
// handleAdminRegistrationMaintenance also delegates (to
// undoRegistrationKitDeliveryInPostgres); that handler's generic transaction()
// LINE stays counted — it still structurally serves the cancel JSON-mode
// fallback. So this wave removes exactly one independent writer (kit delivery).
const FULL_BLOB_WRITER_BASELINE = { 'server/index.ts': 19, 'server/database.ts': 2 };

function countFullBlobWriters(src: string): number {
  const lines = src.split('\n');
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!/\btransaction\s*[<(]/.test(lines[i])) continue;
    if (/function transaction|serializeGoogleSheetJsonMutation/.test(lines[i])) continue;
    if (/^\s*(\*|\/\/)/.test(lines[i])) continue;
    if (/persist:\s*false/.test(lines.slice(i, i + 26).join('\n'))) continue;
    n += 1;
  }
  return n;
}

test('H: generic full-blob transaction() writer count has not increased', () => {
  const now = { 'server/index.ts': countFullBlobWriters(idx), 'server/database.ts': countFullBlobWriters(db) };
  for (const file of Object.keys(FULL_BLOB_WRITER_BASELINE) as Array<keyof typeof FULL_BLOB_WRITER_BASELINE>) {
    assert.ok(
      now[file] <= FULL_BLOB_WRITER_BASELINE[file],
      `${file}: full-blob transaction() writers = ${now[file]}, baseline ${FULL_BLOB_WRITER_BASELINE[file]}. `
      + 'A NEW full-blob writer appeared — replace it with a narrow repository function, '
      + 'or (if truly unavoidable) get architectural sign-off and lower the baseline.',
    );
  }
});

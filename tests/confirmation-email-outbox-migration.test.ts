import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// EMAIL-OPS-002 Stage 2 — migration + wiring contract for the dedicated
// confirmation-email outbox. Schema-only, additive, history-safe. The
// transactional-enqueue and concurrency guarantees are asserted against source
// (the repo's established pattern for Postgres-transaction invariants).

const serverMigration = readFileSync('server/migrations/20260901_confirmation_email_outbox.sql', 'utf8');
const supabaseMigration = readFileSync('supabase/migrations/20260901000100_confirmation_email_outbox.sql', 'utf8');
const canonicalSchema = readFileSync('server/supabase-schema.sql', 'utf8');
const databaseSource = readFileSync('server/database.ts', 'utf8');
const indexSource = readFileSync('server/index.ts', 'utf8');
const vercelConfig = readFileSync('vercel.json', 'utf8');

function block(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `${startNeedle} located`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  return source.slice(start, end >= 0 ? end : undefined);
}

test('migration is mirrored byte-for-byte between server/ and supabase/', () => {
  assert.equal(serverMigration.trim(), supabaseMigration.trim());
});

test('migration is schema-only, additive and history-safe — no data writes, no drops', () => {
  assert.doesNotMatch(serverMigration, /\binsert\s+into\b|\bupdate\s+public\b|\bdelete\s+from\b|\bdrop\s+table\b|\btruncate\b|\bdrop\s+column\b/i);
  assert.match(serverMigration, /create table if not exists public\."run-email-outbox"/);
  assert.match(serverMigration, /registration_id text not null references public\."run-registrations"\(id\)/);
});

test('the durable business invariant is DB-enforced: one obligation per (registration, email_type)', () => {
  assert.match(serverMigration, /unique \(registration_id, email_type\)/);
  // email is a destination, never identity — the outbox stores no recipient
  // address and keys nothing on one.
  assert.doesNotMatch(serverMigration, /recipient_email|recipient_hash|email_address/);
  assert.doesNotMatch(serverMigration, /unique\s*\([^)]*recipient[^)]*\)/i);
});

test('retry / lease columns and the status shape check exist', () => {
  for (const column of ['attempts', 'next_attempt_at', 'locked_at', 'locked_by', 'last_error', 'processed_at', 'event_id', 'source']) {
    assert.match(serverMigration, new RegExp(`\\b${column}\\b`), `column ${column}`);
  }
  assert.match(serverMigration, /check \(status in \('pending', 'processing', 'completed', 'failed'\)\)/);
  assert.match(serverMigration, /run-email-outbox_status_shape_check/);
  // due-selection + stale-reclaim indexes, partial, minimal
  assert.match(serverMigration, /create index if not exists "run-email-outbox_due_idx"[\s\S]*where status = 'pending'/);
  assert.match(serverMigration, /create index if not exists "run-email-outbox_processing_idx"[\s\S]*where status = 'processing'/);
});

test('canonical schema snapshot and the auto-migrate path both mirror the table', () => {
  assert.match(canonicalSchema, /create table if not exists "run-email-outbox"/);
  assert.match(canonicalSchema, /unique \(registration_id, email_type\)/);
  const ensureBody = block(databaseSource, 'create table if not exists ${table.confirmationEmailOutbox}', 'create table if not exists ${table.googleSheetSyncs}');
  assert.match(ensureBody, /unique \(registration_id, email_type\)/);
  assert.match(ensureBody, /run-email-outbox_status_shape_check/);
  assert.match(databaseSource, /create index if not exists "run-email-outbox_due_idx" on \$\{table\.confirmationEmailOutbox\}\(next_attempt_at asc\) where status = 'pending'/);
});

test('the obligation is enqueued INSIDE confirmPaymentInPostgres, before commit, under its rollback', () => {
  const fn = block(databaseSource, 'export async function confirmPaymentInPostgres', 'export async function markPaymentCreationFailedInPostgres');
  const enqueueIdx = fn.indexOf('enqueueConfirmationEmailInPostgres(client, row.id');
  assert.ok(enqueueIdx > 0, 'enqueue call present on the success path');
  const commitIdx = fn.indexOf("await client.query('commit');", enqueueIdx);
  assert.ok(commitIdx > enqueueIdx, 'enqueue happens before the transaction commits');
  assert.match(fn, /catch \(error\) \{\s*await client\.query\('rollback'\)/);
  // it participates in the SAME client/transaction — not a fresh connection
  const enqueueFn = block(databaseSource, 'export async function enqueueConfirmationEmailInPostgres', 'export async function enqueueConfirmationEmailObligationInPostgres');
  assert.match(enqueueFn, /client: Queryable/);
  assert.match(enqueueFn, /on conflict \(registration_id, email_type\) do nothing/);
});

test('the drain claims work concurrency-safely: FOR UPDATE SKIP LOCKED, bounded, oldest-first', () => {
  const fn = block(databaseSource, 'export async function claimDueConfirmationEmailOutboxInPostgres', 'export async function completeConfirmationEmailOutboxInPostgres');
  assert.match(fn, /for update skip locked/);
  assert.match(fn, /order by next_attempt_at asc, created_at asc/);
  assert.match(fn, /limit \$2/);
  assert.match(fn, /set status = 'processing', locked_at = \$1, locked_by = \$3/);
});

test('stale-processing reclaim is lease-based and time-stable within the call', () => {
  const fn = block(databaseSource, 'export async function reclaimStaleConfirmationEmailOutboxInPostgres', 'export async function claimDueConfirmationEmailOutboxInPostgres');
  assert.match(fn, /CONFIRMATION_EMAIL_OUTBOX_LEASE_MS/);
  assert.match(fn, /where status = 'processing' and locked_at is not null and locked_at < \$2/);
});

test('§12 silent-null elimination: every declined claim writes a claim_skipped audit, no alert', () => {
  const fn = block(databaseSource, 'export async function claimRegistrationEmailInPostgres', 'export async function completeRegistrationEmailInPostgres');
  assert.equal((fn.match(/email\.confirmation\.claim_skipped/g) || []).length, 2, 'both null exits are audited');
  assert.match(fn, /reason: !row \? 'no_registration' : 'not_paid_at_claim'/);
  assert.match(fn, /'already_sent'/);
  assert.match(fn, /'recent_attempt'/);
  assert.match(fn, /'legacy_summary_present'/);
  // claim_skipped must not raise an operational alert
  assert.doesNotMatch(fn, /recordOperationalAlert[\s\S]*claim_skipped|claim_skipped[\s\S]*recordOperationalAlert/);
});

test('webhook immediate send is de-swallowed: explicit catch + structured log, obligation authoritative', () => {
  const branch = block(indexSource, 'payment_webhook_completed', 'const result = await transaction<{ statusCode: number;');
  assert.match(branch, /immediateEmailAttempt/);
  assert.match(branch, /confirmation_email_immediate_attempt_failed/);
  assert.doesNotMatch(branch, /Promise\.allSettled\(\[\s*\n?\s*result\.registrationId \? processPaymentConfirmationEmail/);
});

test('the worker exists, alerts once on terminal failure with no PII, and has its own cron route', () => {
  assert.match(indexSource, /async function processConfirmationEmailOutbox\(/);
  assert.match(indexSource, /alertType: 'confirmation_email_unrecoverable'/);
  assert.match(indexSource, /url\.pathname === '\/api\/cron\/confirmation-emails'/);
  assert.match(vercelConfig, /"path": "\/api\/cron\/confirmation-emails"/);
  assert.match(vercelConfig, /"\/api\/cron\/confirmation-emails"[\s\S]*"schedule": "\*\/5 \* \* \* \*"/);
  // bounded per invocation: maxDuration cap + a wall-clock drain budget
  assert.match(vercelConfig, /"api\/cron\/confirmation-emails\.ts":\s*\{\s*"maxDuration": 60/);
  assert.match(indexSource, /Date\.now\(\) > deadline/);
  assert.match(indexSource, /CONFIRMATION_EMAIL_OUTBOX_DRAIN_BUDGET_MS/);
});

test('§17 Admin manual recovery leaves a durable obligation on failure, idempotently', () => {
  const block2 = block(indexSource, "if (action === 'send-email') {", "if (action === 'cancel' && usesPostgresDatabase())");
  assert.match(block2, /enqueueConfirmationEmailObligationInPostgres\(registrationId, \{ source: 'admin_recovery' \}\)/);
  // not enqueued when the failure was a config skip
  assert.match(block2, /!emailResult\?\.skipped/);
});

test('the outbox does not reuse the Google Sheets sync table', () => {
  const enqueueFn = block(databaseSource, 'export async function enqueueConfirmationEmailInPostgres', 'export async function enqueueConfirmationEmailObligationInPostgres');
  assert.doesNotMatch(enqueueFn, /run-google-sheet-sync|googleSheetSyncs/);
  assert.match(serverMigration, /create table if not exists public\."run-email-outbox"/);
  // the migration performs no DDL against the Google Sheets sync table
  assert.doesNotMatch(serverMigration, /(alter|create)[\s\S]{0,60}"run-google-sheet-sync"/i);
});

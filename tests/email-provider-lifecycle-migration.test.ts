import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// EMAIL-OPS-003 Stage 2 §4/§5/§6/§30 — migration + schema-wiring contract for
// the provider delivery lifecycle. Schema-only, additive, backward-compatible.

const serverMigration = readFileSync('server/migrations/20260901_email_provider_lifecycle.sql', 'utf8');
const supabaseMigration = readFileSync('supabase/migrations/20260901000200_email_provider_lifecycle.sql', 'utf8');
const canonicalSchema = readFileSync('server/supabase-schema.sql', 'utf8');
const databaseSource = readFileSync('server/database.ts', 'utf8');

function block(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `${startNeedle} located`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  return source.slice(start, end >= 0 ? end : undefined);
}

test('migration is mirrored byte-for-byte between server/ and supabase/', () => {
  assert.equal(serverMigration.trim(), supabaseMigration.trim());
});

test('§30 migration is schema-only, additive, history-safe — no data writes, no destructive DDL', () => {
  assert.doesNotMatch(
    serverMigration,
    /\binsert\s+into\b|\bupdate\s+public\b|\bdelete\s+from\b|\bdrop\s+table\b|\btruncate\b|\bdrop\s+column\b/i,
  );
  // the only `drop constraint` is the idempotent re-add of the new nullable
  // lifecycle CHECK — never a drop of an existing constraint.
  const drops = serverMigration.match(/drop constraint if exists "([^"]+)"/g) || [];
  assert.deepEqual(drops, ['drop constraint if exists "run-email-deliveries_provider_lifecycle_check"']);
  assert.match(serverMigration, /create table if not exists public\."run-email-provider-events"/);
});

test('append-only history table: unique(svix_id) idempotency key, correlation FKs, minimal indexes', () => {
  assert.match(serverMigration, /constraint "run-email-provider-events_svix_id_key" unique \(svix_id\)/);
  assert.match(serverMigration, /delivery_id text references public\."run-email-deliveries"\(id\)/);
  assert.match(serverMigration, /registration_id text references public\."run-registrations"\(id\)/);
  assert.match(serverMigration, /create index if not exists "run-email-provider-events_email_id_idx"/);
  assert.match(serverMigration, /create index if not exists "run-email-provider-events_delivery_created_idx"[\s\S]*provider_created_at asc/);
  assert.match(serverMigration, /create index if not exists "run-email-provider-events_registration_created_idx"/);
  assert.match(serverMigration, /create index if not exists "run-email-provider-events_type_received_idx"/);
});

test('§17 minimization: no raw email column, no raw payload column, digest is enforced hex', () => {
  // column definitions only (strip -- comments)
  const ddl = serverMigration.replace(/--.*$/gm, '');
  assert.doesNotMatch(ddl, /recipient_email\b/);
  assert.doesNotMatch(ddl, /^\s*payload\s+(text|jsonb)/im); // no raw payload column
  assert.doesNotMatch(ddl, /^\s*(subject|headers|recipient_email|to)\s+(text|jsonb|json)/im);
  assert.match(serverMigration, /payload_digest text not null/);
  assert.match(serverMigration, /payload_digest ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(serverMigration, /recipient_hash is null or recipient_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(serverMigration, /reason_detail is null or length\(reason_detail\) <= 500/);
});

test('never keys on email; no UNIQUE(email) anywhere', () => {
  assert.doesNotMatch(serverMigration, /unique\s*\([^)]*email[^)]*\)/i);
  // the only unique constraint is on svix_id
  const uniques = serverMigration.match(/unique \([^)]*\)/g) || [];
  assert.deepEqual(uniques, ['unique (svix_id)']);
});

test('§5/§6 derived lifecycle columns are additive + nullable; existing status CHECK untouched', () => {
  assert.match(serverMigration, /alter table public\."run-email-deliveries"\s*\n\s*add column if not exists provider_lifecycle text,\s*\n\s*add column if not exists provider_lifecycle_at text,\s*\n\s*add column if not exists provider_lifecycle_reason text;/);
  assert.match(serverMigration, /provider_lifecycle is null or provider_lifecycle in \(\s*'sent', 'delivery_delayed', 'delivered', 'bounced', 'complained', 'failed', 'suppressed'\s*\)/);
  // does not touch the attempting|sent|failed acceptance-ledger CHECK
  assert.doesNotMatch(serverMigration, /status in \('attempting'/);
  assert.doesNotMatch(serverMigration, /run-email-deliveries_status_timestamps_check/);
});

test('canonical schema snapshot mirrors the table and the additive columns', () => {
  assert.match(canonicalSchema, /create table if not exists "run-email-provider-events"/);
  assert.match(canonicalSchema, /constraint "run-email-provider-events_svix_id_key" unique \(svix_id\)/);
  assert.match(canonicalSchema, /provider_lifecycle text,\s*\n\s*provider_lifecycle_at text,\s*\n\s*provider_lifecycle_reason text,/);
  assert.match(canonicalSchema, /constraint "run-email-deliveries_provider_lifecycle_check"/);
});

test('the auto-migrate path (ensurePostgresDatabase) mirrors the same table + columns + indexes', () => {
  const ensureTable = block(databaseSource, 'create table if not exists ${table.emailProviderEvents}', 'create table if not exists ${table.confirmationEmailOutbox}');
  assert.match(ensureTable, /constraint "run-email-provider-events_svix_id_key" unique \(svix_id\)/);
  assert.match(ensureTable, /payload_digest text not null/);
  assert.match(ensureTable, /delivery_id text references \$\{table\.emailDeliveries\}\(id\)/);
  assert.match(databaseSource, /create index if not exists "run-email-provider-events_email_id_idx" on \$\{table\.emailProviderEvents\}/);
  assert.match(databaseSource, /alter table \$\{table\.emailDeliveries\} add column if not exists provider_lifecycle text/);
  assert.match(databaseSource, /alter table \$\{table\.emailDeliveries\} add column if not exists provider_lifecycle_at text/);
  assert.match(databaseSource, /alter table \$\{table\.emailDeliveries\} add constraint "run-email-deliveries_provider_lifecycle_check"/);
  assert.match(databaseSource, /emailProviderEvents: '"run-email-provider-events"'/);
});

test('§6 backward compatibility: nothing fabricates historical delivered/bounced', () => {
  assert.doesNotMatch(serverMigration, /provider_lifecycle\s*=\s*'(delivered|bounced|complained|failed|suppressed|sent)'/);
  assert.doesNotMatch(serverMigration, /set provider_lifecycle/i);
});

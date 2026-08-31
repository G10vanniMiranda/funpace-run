import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// ADMIN-IAM-001 Stage 1 — migration + data-layer contract.
// Schema-only, additive, backward-compatible with the deployed auth code.

const serverMigration = readFileSync('server/migrations/20260831_admin_iam_primitives.sql', 'utf8');
const supabaseMigration = readFileSync('supabase/migrations/20260831000100_admin_iam_primitives.sql', 'utf8');
const canonicalSchema = readFileSync('server/supabase-schema.sql', 'utf8');
const databaseSource = readFileSync('server/database.ts', 'utf8');

function block(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `${startNeedle} located`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  return source.slice(start, end >= 0 ? end : undefined);
}

test('§38 migration is mirrored byte-for-byte between server/ and supabase/', () => {
  assert.equal(serverMigration.trim(), supabaseMigration.trim());
});

test('§38 migration is schema-only, additive, history-safe — no data writes, no drops', () => {
  assert.doesNotMatch(serverMigration, /\binsert\s+into\b|\bupdate\s+public\b|\bdelete\s+from\b|\bdrop\s+table\b|\btruncate\b/i);
  // additive column adds are guarded
  assert.match(serverMigration, /alter table public\."run-admin-users" add column if not exists name text/);
  assert.match(serverMigration, /alter table public\."run-admin-users" add column if not exists created_by text/);
  assert.match(serverMigration, /alter table public\."run-admin-users" add column if not exists disabled_by text/);
  // password_hash becomes nullable so pending-invite accounts can exist
  assert.match(serverMigration, /alter table public\."run-admin-users" alter column password_hash drop not null/);
  // it does NOT set NOT NULL on name / created_by (legacy bootstrap row must survive)
  assert.doesNotMatch(serverMigration, /"run-admin-users" alter column name set not null/i);
  assert.doesNotMatch(serverMigration, /"run-admin-users" alter column created_by set not null/i);
});

test('§9/§38 auth token table: purpose CHECK, hashed-only, single-active partial unique index', () => {
  assert.match(serverMigration, /create table if not exists public\."run-admin-auth-tokens"/);
  assert.match(serverMigration, /purpose text not null check \(purpose in \('invite', 'reset'\)\)/);
  assert.match(serverMigration, /token_hash text not null check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  // no raw-token column
  assert.doesNotMatch(serverMigration, /\braw_token\b|\btoken\s+text\b|\bsecret\b/i);
  assert.match(serverMigration, /consumed_at text/);
  // §16 invariant: at most one unconsumed token per (user_id, purpose)
  assert.match(serverMigration, /create unique index if not exists "run-admin-auth-tokens_one_active_idx"\s*\n?\s*on public\."run-admin-auth-tokens"\(user_id, purpose\) where consumed_at is null/);
  assert.match(serverMigration, /create unique index if not exists "run-admin-auth-tokens_token_hash_idx"/);
});

test('§38 no self-referential FK — created_by / disabled_by are soft text references', () => {
  assert.doesNotMatch(serverMigration, /created_by[^,\n]*references/i);
  assert.doesNotMatch(serverMigration, /disabled_by[^,\n]*references/i);
  assert.doesNotMatch(serverMigration, /user_id[^,\n]*references/i);
});

test('§26/§38 canonical schema snapshot reflects the same additions', () => {
  const adminUsers = block(canonicalSchema, 'create table if not exists "run-admin-users"', 'create table if not exists "run-admin-auth-tokens"');
  assert.match(adminUsers, /password_hash text,/, 'password_hash nullable in the snapshot');
  assert.match(adminUsers, /\n\s*name text,/);
  assert.match(adminUsers, /\n\s*created_by text,/);
  assert.match(adminUsers, /\n\s*disabled_by text,/);
  assert.match(canonicalSchema, /create table if not exists "run-admin-auth-tokens"/);
  assert.match(canonicalSchema, /create unique index if not exists "run-admin-auth-tokens_one_active_idx"[^\n]*where consumed_at is null/);
});

test('§26 auto-migrate path (ensurePostgresDatabase) mirrors the canonical migration', () => {
  const body = block(databaseSource, 'ADMIN-IAM-001 Stage 1 — individual administrative identity primitives.', 'const existingEvents =');
  assert.match(body, /add column if not exists name text/);
  assert.match(body, /add column if not exists created_by text/);
  assert.match(body, /add column if not exists disabled_by text/);
  assert.match(body, /alter column password_hash drop not null/);
  assert.match(body, /create table if not exists \$\{table\.adminAuthTokens\}/);
  assert.match(body, /run-admin-auth-tokens_one_active_idx.*where consumed_at is null/s);
});

// ---- §44 / §20 last-administrator invariant (data-layer primitive) ----

test('§19/§20 ACTIVE_ADMINISTRATOR_SQL is the single definition and matches Stage 0 §19', () => {
  assert.match(databaseSource, /export const ACTIVE_ADMINISTRATOR_SQL\s*=/);
  const sql = block(databaseSource, 'export const ACTIVE_ADMINISTRATOR_SQL', ';');
  assert.match(sql, /role = 'administrator'/);
  assert.match(sql, /disabled_at is null/);
  assert.match(sql, /password_hash is not null/);
  // and it is the ONLY place the definition is spelled out
  assert.equal((databaseSource.match(/role = 'administrator' and disabled_at is null/g) || []).length, 1);
});

test('§20/§21 withAdminUsersMutation: transaction + advisory lock + IN-TX recount + rollback on violation', () => {
  const fn = block(databaseSource, 'export async function withAdminUsersMutation', 'Revoke every currently-active session');
  assert.match(fn, /await client\.query\('begin'\)/);
  // serialises concurrent IAM mutations — no two callers can each observe safety
  assert.match(fn, /pg_advisory_xact_lock\(hashtext\('funpace-run-admin-users'\)\)/);
  // caller's writes happen BEFORE the recount
  const mutateIdx = fn.indexOf('await mutate(client)');
  const countIdx = fn.indexOf('countActiveAdministrators(client)');
  assert.ok(mutateIdx > 0 && countIdx > mutateIdx, 'recount happens after the mutation, inside the same tx');
  assert.match(fn, /if \(await countActiveAdministrators\(client\) < 1\)/);
  assert.match(fn, /await client\.query\('rollback'\);\s*\n\s*throw new LastAdministratorError\(\)/);
  assert.match(fn, /await client\.query\('commit'\)/);
  // no "read count then update" outside a tx
  assert.doesNotMatch(fn, /countActiveAdministratorsInPostgres\(\)/);
});

test('§21 concurrency: the recount reads through the SAME client (locked tx), never a fresh pool query', () => {
  const fn = block(databaseSource, 'async function countActiveAdministrators(client: Queryable)', 'export async function countActiveAdministratorsInPostgres');
  assert.match(fn, /await client\.query\(/);
  assert.doesNotMatch(fn, /requirePool\(\)/);
});

test('§22 tech debt recorded: sessions keyed by email, not user_id', () => {
  assert.match(databaseSource, /TECH DEBT: run-admin-sessions\.actor is the email, not run-admin-users\.id/);
});

test('§26 bootstrap / login compatibility: no bootstrap or login code touched', () => {
  // ensureAdminBootstrap, ADMIN_EMAIL/ADMIN_PASSWORD, handleAdminLogin are index.ts concerns
  const indexSource = readFileSync('server/index.ts', 'utf8');
  // this stage adds nothing to index.ts
  assert.doesNotMatch(indexSource, /withAdminUsersMutation|revokeAllAdminSessionsForUserInPostgres|run-admin-auth-tokens|iam\/tokens|iam\/admin-account/);
});

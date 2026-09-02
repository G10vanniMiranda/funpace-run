import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  assertRuntimeAutoMigrateAllowed,
  PRODUCTION_SUPABASE_PROJECT_REF,
  HOMOLOGATION_SUPABASE_PROJECT_REF,
} from '../server/migration-environment.ts';

// PROD-SAFETY-001 — EVENT-OPS INCIDENT-002 containment.
// Runtime lazy bootstrap (ensurePostgresDatabase, reached via ensurePostgresReady
// from ~55 DB functions and every persist:true transaction()) must fail closed
// against the Production database — driven by the TARGET DATABASE identity, not
// by the presence/absence of VERCEL / NODE_ENV / DATABASE_AUTO_MIGRATE.

const PROD_URL = `postgres://postgres.${PRODUCTION_SUPABASE_PROJECT_REF}:pw@aws-1-sa-east-1.pooler.supabase.com:5432/postgres`;
const PROD_DIRECT_URL = `postgres://postgres:pw@db.${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co:5432/postgres`;
const HOMOLOG_URL = `postgres://postgres:pw@db.${HOMOLOGATION_SUPABASE_PROJECT_REF}.supabase.co:5432/postgres`;
const LOCAL_URL = 'postgres://postgres:postgres@localhost:5432/funpace';
const NON_SUPABASE_URL = 'postgres://user:pw@my-own-host.example.com:5432/prod';

// TEST A — Production identity + auto-migrate request => exception (the incident)
test('A: Production Supabase project => throws (no override) — INCIDENT-002 vector', () => {
  // exactly the incident environment: no VERCEL, NODE_ENV unset, DATABASE_AUTO_MIGRATE=true
  const env = { DATABASE_AUTO_MIGRATE: 'true' } as unknown as NodeJS.ProcessEnv;
  assert.throws(() => assertRuntimeAutoMigrateAllowed(PROD_URL, env), /refused against the Production database/);
  assert.throws(() => assertRuntimeAutoMigrateAllowed(PROD_DIRECT_URL, env), /refused against the Production database/);
});

test('A: no env override can re-enable it — even a permissive-looking flag', () => {
  for (const env of [
    { DATABASE_AUTO_MIGRATE: 'true', ALLOW_PRODUCTION_AUTO_MIGRATE: 'true' },
    { DATABASE_AUTO_MIGRATE: 'true', APP_ENV: 'production', EXPECTED_DATABASE_PROJECT_REF: PRODUCTION_SUPABASE_PROJECT_REF },
    { DATABASE_AUTO_MIGRATE: 'true', VERCEL: '1' },
    { DATABASE_AUTO_MIGRATE: 'true', NODE_ENV: 'development' },
  ] as unknown as NodeJS.ProcessEnv[]) {
    assert.throws(() => assertRuntimeAutoMigrateAllowed(PROD_URL, env), /refused/);
  }
});

// TEST B — non-production / homolog target => allowed (bootstrap not broken)
test('B: homologation Supabase project => allowed', () => {
  assert.doesNotThrow(() => assertRuntimeAutoMigrateAllowed(HOMOLOG_URL, { DATABASE_AUTO_MIGRATE: 'true' } as unknown as NodeJS.ProcessEnv));
});

test('B: local Postgres => allowed (developer workflow preserved)', () => {
  assert.doesNotThrow(() => assertRuntimeAutoMigrateAllowed(LOCAL_URL, { DATABASE_AUTO_MIGRATE: 'true' } as unknown as NodeJS.ProcessEnv));
});

test('B: no DATABASE_URL / empty => no-op (nothing to protect)', () => {
  assert.doesNotThrow(() => assertRuntimeAutoMigrateAllowed('', {} as unknown as NodeJS.ProcessEnv));
  assert.doesNotThrow(() => assertRuntimeAutoMigrateAllowed(null, {} as unknown as NodeJS.ProcessEnv));
});

// Reviewer challenge matrix
test('reviewer: malformed URL => no false negative, no crash', () => {
  // unparseable → deriveSupabaseProjectRef returns null → not the prod ref → allowed
  // (module-load assertDatabaseEnvironmentIsolation already rejects prod/homolog without a matching ref)
  assert.doesNotThrow(() => assertRuntimeAutoMigrateAllowed('not a url', { DATABASE_AUTO_MIGRATE: 'true' } as unknown as NodeJS.ProcessEnv));
});

test('reviewer: non-Supabase URL while APP_ENV=production => refused (defence in depth)', () => {
  assert.throws(
    () => assertRuntimeAutoMigrateAllowed(NON_SUPABASE_URL, { APP_ENV: 'production' } as unknown as NodeJS.ProcessEnv),
    /resolves to production/,
  );
});

test('reviewer: VERCEL_ENV=production against a non-homolog project => refused', () => {
  assert.throws(
    () => assertRuntimeAutoMigrateAllowed(LOCAL_URL, { VERCEL_ENV: 'production' } as unknown as NodeJS.ProcessEnv),
    /resolves to production/,
  );
});

test('reviewer: VERCEL_ENV=production against the homolog project => allowed', () => {
  assert.doesNotThrow(() => assertRuntimeAutoMigrateAllowed(HOMOLOG_URL, { VERCEL_ENV: 'production' } as unknown as NodeJS.ProcessEnv));
});

test('reviewer: prod ref embedded in the pooler username (real Supabase shape) is detected', () => {
  const url = `postgres://postgres.${PRODUCTION_SUPABASE_PROJECT_REF}:x@aws-1-sa-east-1.pooler.supabase.com:6543/postgres`;
  assert.throws(() => assertRuntimeAutoMigrateAllowed(url, {} as unknown as NodeJS.ProcessEnv), /Production database/);
});

test('the guard is a pure identity check — it never reads DATABASE_AUTO_MIGRATE / VERCEL presence for the decision', () => {
  const raw = readFileSync('server/migration-environment.ts', 'utf8');
  const body = raw
    .slice(raw.indexOf('export function assertRuntimeAutoMigrateAllowed'), raw.indexOf('export function assertMigrationEnvironmentIsolation'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(body, /DATABASE_AUTO_MIGRATE/, 'decision must not hinge on DATABASE_AUTO_MIGRATE');
  assert.doesNotMatch(body, /environment\.VERCEL\b|process\.env\.VERCEL\b/, 'decision must not hinge on VERCEL presence (VERCEL_ENV value is fine)');
  assert.match(body, /deriveSupabaseProjectRef/, 'decision derives the target project ref');
  assert.match(body, /PRODUCTION_SUPABASE_PROJECT_REF/, 'decision compares against the Production project ref');
});

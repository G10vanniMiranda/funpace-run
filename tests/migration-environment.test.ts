import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  assertConnectedDatabaseIdentity,
  assertMigrationEnvironmentIsolation,
  deriveSupabaseProjectRef,
  HOMOLOGATION_SUPABASE_PROJECT_REF,
  PRODUCTION_SUPABASE_PROJECT_REF,
} from '../server/migration-environment.ts';

const homologationUrl = `postgresql://postgres.${HOMOLOGATION_SUPABASE_PROJECT_REF}:secret@aws-1-sa-east-1.pooler.supabase.com:6543/postgres`;
const productionUrl = `postgresql://postgres.${PRODUCTION_SUPABASE_PROJECT_REF}:secret@aws-1-sa-east-1.pooler.supabase.com:6543/postgres`;

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    APP_ENV: 'homologation',
    EXPECTED_DATABASE_PROJECT_REF: HOMOLOGATION_SUPABASE_PROJECT_REF,
    DATABASE_URL: homologationUrl,
    ...overrides,
  };
}

test('migration guard permits only the expected homologation project', () => {
  const result = assertMigrationEnvironmentIsolation(environment());
  assert.equal(result.appEnvironment, 'homologation');
  assert.equal(result.expectedProjectRef, HOMOLOGATION_SUPABASE_PROJECT_REF);
  assert.equal(result.actualProjectRef, HOMOLOGATION_SUPABASE_PROJECT_REF);
  assert.equal(result.databaseName, 'postgres');
  assert.equal(result.databaseUser, 'postgres');
});

test('migration guard blocks a connection whose project differs from expected', () => {
  assert.throws(
    () => assertMigrationEnvironmentIsolation(environment({
      DATABASE_URL: 'postgresql://postgres.abcdefghijklmnopqrst:secret@aws-1-sa-east-1.pooler.supabase.com:6543/postgres',
    })),
    /does not match EXPECTED_DATABASE_PROJECT_REF/,
  );
});

test('migration guard explicitly blocks production during homologation', () => {
  assert.throws(
    () => assertMigrationEnvironmentIsolation(environment({ DATABASE_URL: productionUrl })),
    /production Supabase project is forbidden/,
  );
});

test('migration guard also prevents a production execution from targeting homologation', () => {
  assert.throws(
    () => assertMigrationEnvironmentIsolation(environment({
      APP_ENV: 'production',
      EXPECTED_DATABASE_PROJECT_REF: HOMOLOGATION_SUPABASE_PROJECT_REF,
    })),
    /production expected project ref is not allowlisted/,
  );
});

test('migration guard blocks missing APP_ENV', () => {
  assert.throws(
    () => assertMigrationEnvironmentIsolation(environment({ APP_ENV: undefined })),
    /APP_ENV must be explicitly set/,
  );
});

test('migration guard blocks missing EXPECTED_DATABASE_PROJECT_REF', () => {
  assert.throws(
    () => assertMigrationEnvironmentIsolation(environment({ EXPECTED_DATABASE_PROJECT_REF: undefined })),
    /EXPECTED_DATABASE_PROJECT_REF is missing or invalid/,
  );
});

test('migration guard blocks a connection whose project ref cannot be determined', () => {
  assert.equal(deriveSupabaseProjectRef('postgresql://postgres:secret@localhost:5432/postgres'), null);
  assert.throws(
    () => assertMigrationEnvironmentIsolation(environment({
      DATABASE_URL: 'postgresql://postgres:secret@localhost:5432/postgres',
    })),
    /project ref could not be determined/,
  );
});

test('connected database identity is verified with a read-only SELECT', async () => {
  const queries: string[] = [];
  const identity = await assertConnectedDatabaseIdentity({
    query: async (text) => {
      queries.push(text);
      return { rows: [{ database_name: 'postgres', database_user: 'postgres', transaction_read_only: 'off' }] };
    },
  }, assertMigrationEnvironmentIsolation(environment()));

  assert.equal(identity.databaseName, 'postgres');
  assert.equal(queries.length, 1);
  assert.match(queries[0], /^select current_database\(\)/);
});

test('connected database identity mismatch aborts before migration writes', async () => {
  await assert.rejects(
    assertConnectedDatabaseIdentity({
      query: async () => ({ rows: [{ database_name: 'other', database_user: 'postgres', transaction_read_only: 'off' }] }),
    }, assertMigrationEnvironmentIsolation(environment())),
    /connected database identity does not match/,
  );
});

test('migration executor is explicit, canonical and never falls back to local .env', () => {
  const executor = readFileSync('scripts/apply-migrations.mjs', 'utf8');
  assert.doesNotMatch(executor, /existsSync\(['"]\.env['"]\)/);
  assert.match(executor, /process\.env\.MIGRATION_NAME/);
  assert.match(executor, /server\/migrations\/\$\{migrationName\}/);
  assert.doesNotMatch(executor, /readdirSync/);
  assert.ok(executor.indexOf('assertMigrationEnvironmentIsolation') < executor.indexOf('new pg.Client'));
});

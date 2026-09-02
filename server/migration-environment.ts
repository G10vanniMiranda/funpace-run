export const HOMOLOGATION_SUPABASE_PROJECT_REF = 'tctbwjrdhpwxzwbcwcvy';
export const PRODUCTION_SUPABASE_PROJECT_REF = 'jypmwutwexpxjlaqwjvb';

export type MigrationEnvironment = 'homologation' | 'production';

export type MigrationEnvironmentGuard = {
  appEnvironment: MigrationEnvironment;
  expectedProjectRef: string;
  actualProjectRef: string;
  databaseName: string;
  databaseUser: string;
};

type DatabaseIdentityClient = {
  query: (text: string) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

function migrationGuardError(reason: string): never {
  throw new Error(`Migration environment isolation failed: ${reason}.`);
}

export function deriveSupabaseProjectRef(databaseUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return null;
  }

  const candidates = [parsed.hostname, decodeURIComponent(parsed.username), parsed.pathname];
  const refs = new Set<string>();
  for (const candidate of candidates) {
    for (const token of candidate.toLowerCase().split(/[^a-z0-9]+/)) {
      if (/^[a-z0-9]{20}$/.test(token)) refs.add(token);
    }
  }
  return refs.size === 1 ? [...refs][0] : null;
}

/**
 * PROD-SAFETY-001 — fail-closed guard for RUNTIME lazy bootstrap / auto-migrate
 * (server/database.ts::ensurePostgresDatabase, reached via ensurePostgresReady
 * from ~55 DB functions and every persist:true transaction()).
 *
 * EVENT-OPS INCIDENT-002: a local, non-Vercel process with DATABASE_AUTO_MIGRATE
 * =true and DATABASE_URL pointing at Production ran ensurePostgresDatabase ->
 * ensureConfiguredLots and reverted lot-3 (11990/active) to the seed
 * (13990/inactive) with no audit, causing a ~2h15m purchase outage.
 *
 * Unlike assertMigrationEnvironmentIsolation (the canonical migration runner's
 * guard, which allows an explicit one-shot authorization), this guard has NO
 * override: runtime lazy bootstrap must NEVER touch Production. If the target
 * database is the Production Supabase project — or the resolved app environment
 * is 'production' against any non-homologation project — throw BEFORE any
 * DDL/DML. Schema changes to Production go exclusively through
 * scripts/apply-migrations.mjs.
 *
 * The decision is driven by the TARGET DATABASE identity (derived project ref),
 * not by the presence/absence of VERCEL, NODE_ENV or DATABASE_AUTO_MIGRATE.
 */
export function assertRuntimeAutoMigrateAllowed(
  databaseUrl: string | null | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const url = String(databaseUrl || environment.DATABASE_URL || '').trim();
  if (!url) return; // no Postgres target configured — nothing to protect here

  const actualProjectRef = deriveSupabaseProjectRef(url);

  // Primary, non-bypassable: never auto-bootstrap the Production project.
  if (actualProjectRef === PRODUCTION_SUPABASE_PROJECT_REF) {
    throw new Error(
      'Runtime auto-migrate/bootstrap is refused against the Production database. '
      + 'Production schema/config changes must go through the canonical migration '
      + 'tool (scripts/apply-migrations.mjs) with explicit one-shot authorization.',
    );
  }

  // Defence in depth: a runtime that resolves to APP_ENV/VERCEL_ENV=production
  // must not auto-bootstrap any project other than the known homologation one
  // (covers a mis-set flag on the Vercel Production runtime, or a non-Supabase
  // Production URL).
  const appEnvironment = String(environment.APP_ENV || '').trim().toLowerCase()
    || (environment.VERCEL_ENV === 'production' ? 'production' : '');
  if (appEnvironment === 'production' && actualProjectRef !== HOMOLOGATION_SUPABASE_PROJECT_REF) {
    throw new Error(
      'Runtime auto-migrate/bootstrap is refused when the environment resolves to production.',
    );
  }
}

export function assertMigrationEnvironmentIsolation(
  environment: NodeJS.ProcessEnv = process.env,
): MigrationEnvironmentGuard {
  const appEnvironment = String(environment.APP_ENV || '').trim().toLowerCase();
  if (appEnvironment !== 'homologation' && appEnvironment !== 'production') {
    migrationGuardError('APP_ENV must be explicitly set to homologation or production');
  }

  const expectedProjectRef = String(environment.EXPECTED_DATABASE_PROJECT_REF || '').trim().toLowerCase();
  if (!/^[a-z0-9]{20}$/.test(expectedProjectRef)) {
    migrationGuardError('EXPECTED_DATABASE_PROJECT_REF is missing or invalid');
  }

  const databaseUrl = String(environment.DATABASE_URL || '').trim();
  if (!databaseUrl) migrationGuardError('DATABASE_URL is missing');

  const actualProjectRef = deriveSupabaseProjectRef(databaseUrl);
  if (!actualProjectRef) migrationGuardError('Supabase project ref could not be determined');

  if (appEnvironment === 'homologation') {
    if (expectedProjectRef !== HOMOLOGATION_SUPABASE_PROJECT_REF) {
      migrationGuardError('homologation expected project ref is not allowlisted');
    }
    if (actualProjectRef === PRODUCTION_SUPABASE_PROJECT_REF) {
      migrationGuardError('production Supabase project is forbidden for homologation');
    }
  } else if (expectedProjectRef !== PRODUCTION_SUPABASE_PROJECT_REF) {
    migrationGuardError('production expected project ref is not allowlisted');
  }

  if (actualProjectRef !== expectedProjectRef) {
    migrationGuardError('connection project ref does not match EXPECTED_DATABASE_PROJECT_REF');
  }

  const parsed = new URL(databaseUrl);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, '')).trim();
  const databaseUser = decodeURIComponent(parsed.username).split('.')[0]?.trim();
  if (!databaseName || !databaseUser) {
    migrationGuardError('database name or user could not be determined');
  }

  return { appEnvironment, expectedProjectRef, actualProjectRef, databaseName, databaseUser };
}

export async function assertConnectedDatabaseIdentity(
  client: DatabaseIdentityClient,
  guard: MigrationEnvironmentGuard,
) {
  const result = await client.query(
    `select current_database() as database_name,
            current_user as database_user,
            current_setting('transaction_read_only') as transaction_read_only`,
  );
  const row = result.rows[0] || {};
  const databaseName = String(row.database_name || '');
  const databaseUser = String(row.database_user || '');

  if (databaseName !== guard.databaseName || databaseUser !== guard.databaseUser) {
    migrationGuardError('connected database identity does not match the validated connection target');
  }

  return {
    databaseName,
    databaseUser,
    transactionReadOnly: String(row.transaction_read_only || ''),
  };
}

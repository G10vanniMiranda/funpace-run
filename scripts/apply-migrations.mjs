import { existsSync, readFileSync } from 'node:fs';
import pg from 'pg';
import {
  assertConnectedDatabaseIdentity,
  assertMigrationEnvironmentIsolation,
} from '../server/migration-environment.ts';

const migrationName = String(process.env.MIGRATION_NAME || '').trim();
if (!/^[0-9][A-Za-z0-9_-]+\.sql$/.test(migrationName)) {
  throw new Error('MIGRATION_NAME deve identificar explicitamente um arquivo SQL canonico.');
}

const migrationPath = `server/migrations/${migrationName}`;
if (!existsSync(migrationPath)) throw new Error(`Migration canonica nao encontrada: ${migrationName}.`);

// This must run before pg.Client is constructed or any database operation occurs.
const guard = assertMigrationEnvironmentIsolation(process.env);
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: (process.env.DATABASE_SSL || 'true') !== 'false' ? { rejectUnauthorized: false } : false,
});

await client.connect();
try {
  const connected = await assertConnectedDatabaseIdentity(client, guard);
  console.log(JSON.stringify({
    message: 'migration_environment_verified',
    appEnvironment: guard.appEnvironment,
    projectRef: guard.actualProjectRef,
    database: connected.databaseName,
    migration: migrationName,
  }));

  const controlTable = await client.query(`select to_regclass('public."run-schema-migrations"') as table_name`);
  const alreadyApplied = controlTable.rows[0]?.table_name
    ? Boolean((await client.query('select 1 from "run-schema-migrations" where name = $1 limit 1', [migrationName])).rowCount)
    : false;

  if (alreadyApplied) {
    console.log(`Ja aplicada: ${migrationName}`);
  } else {
    // The selected migration is the first write. Every guard above has passed by this point.
    await client.query('create table if not exists "run-schema-migrations" (name text primary key, applied_at text not null)');
    await client.query(readFileSync(migrationPath, 'utf8'));
    await client.query(
      'insert into "run-schema-migrations" (name, applied_at) values ($1, $2) on conflict (name) do nothing',
      [migrationName, new Date().toISOString()],
    );
    console.log(`Aplicada: ${migrationName}`);
  }
} finally {
  await client.end();
}

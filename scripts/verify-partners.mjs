import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import pg from 'pg';

if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL nao configurada.');

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: (process.env.DATABASE_SSL || 'true') !== 'false' ? { rejectUnauthorized: false } : false,
});

async function expectConstraintViolation(name, query, expectedConstraint) {
  await client.query(`savepoint ${name}`);
  try {
    await client.query(query);
    assert.fail(`A constraint ${expectedConstraint} deveria rejeitar a operacao.`);
  } catch (error) {
    assert.equal(error.constraint, expectedConstraint);
  } finally {
    await client.query(`rollback to savepoint ${name}`);
  }
}

await client.connect();
try {
  const migration = await client.query(
    `select name from "run-schema-migrations" where name = '20260721_phase1_partners.sql'`,
  );
  assert.equal(migration.rowCount, 1, 'Migration de parceiros nao registrada.');

  const idColumn = await client.query(
    `select data_type from information_schema.columns
     where table_schema = 'public' and table_name = 'run-partners' and column_name = 'id'`,
  );
  assert.equal(idColumn.rows[0]?.data_type, 'uuid', 'O id de parceiros deve ser UUID nativo.');

  const seeds = await client.query(
    `select name, slug, discount_percentage::float8 as discount_percentage, status
     from "run-partners"
     where slug in ('runners', 'pace', 'alpha')
     order by slug`,
  );
  assert.deepEqual(seeds.rows, [
    { name: 'Alpha Running', slug: 'alpha', discount_percentage: 10, status: 'active' },
    { name: 'Pace Team', slug: 'pace', discount_percentage: 10, status: 'active' },
    { name: 'Runners Club', slug: 'runners', discount_percentage: 10, status: 'active' },
  ]);

  await client.query('begin');
  const defaults = await client.query(
    `insert into "run-partners" (name, slug, discount_percentage)
     values ('Temporary Partner', 'phase1-verification', 10)
     returning id, status, created_at, updated_at`,
  );
  assert.match(String(defaults.rows[0].id), /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(defaults.rows[0].status, 'active');
  assert.ok(defaults.rows[0].created_at);
  assert.ok(defaults.rows[0].updated_at);

  await expectConstraintViolation(
    'duplicate_slug',
    `insert into "run-partners" (name, slug, discount_percentage) values ('Duplicate', 'runners', 10)`,
    'run-partners_slug_key',
  );
  await expectConstraintViolation(
    'zero_discount',
    `insert into "run-partners" (name, slug, discount_percentage) values ('Invalid', 'invalid-zero', 0)`,
    'run-partners_discount_percentage_check',
  );
  await expectConstraintViolation(
    'negative_discount',
    `insert into "run-partners" (name, slug, discount_percentage) values ('Invalid', 'invalid-negative', -1)`,
    'run-partners_discount_percentage_check',
  );
  await client.query('rollback');

  console.log('Fase 1 verificada: migration, tabela, UUID, defaults, constraints e seed validos.');
} finally {
  await client.end();
}

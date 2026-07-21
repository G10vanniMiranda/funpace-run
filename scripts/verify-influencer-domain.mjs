import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import pg from 'pg';

if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

assert.ok(process.env.DATABASE_URL, 'DATABASE_URL nao configurada.');

const database = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: (process.env.DATABASE_SSL || 'true') !== 'false' ? { rejectUnauthorized: false } : false,
});
const schema = `i2_verify_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const oldPartnerId = randomUUID();
const now = new Date().toISOString();

async function expectConstraint(savepoint, query, expectedConstraint) {
  await database.query(`savepoint ${savepoint}`);
  try {
    await database.query(query);
    assert.fail(`A constraint ${expectedConstraint} deveria rejeitar a operacao.`);
  } catch (error) {
    assert.equal(error.constraint, expectedConstraint);
  } finally {
    await database.query(`rollback to savepoint ${savepoint}`);
  }
}

await database.connect();
try {
  await database.query(`create schema "${schema}"`);
  await database.query(`set search_path to "${schema}"`);
  await database.query(`
    create table "run-partners" (
      id uuid primary key,
      name text not null,
      slug text not null unique,
      discount_percentage numeric(5,2) not null,
      status text not null default 'active',
      description text,
      created_at text not null,
      updated_at text not null,
      deleted_at text,
      constraint "run-partners_discount_percentage_check" check (discount_percentage > 0 and discount_percentage <= 100)
    );
    create table "run-registrations" (
      id text primary key,
      partner_id uuid,
      partner_name text,
      partner_link text,
      partner_identified_at text,
      discount_percentage numeric(5,2) not null default 0,
      discount_amount integer not null default 0,
      original_price integer not null,
      final_price integer not null,
      amount_cents integer not null,
      confirmed_at text,
      constraint "run-registrations_partner_metadata_check" check (
        (partner_id is null and partner_name is null and discount_percentage = 0 and discount_amount = 0)
        or (partner_id is not null and partner_name is not null and discount_percentage > 0 and discount_amount > 0)
      )
    );
  `);
  await database.query(
    `insert into "run-partners" (id,name,slug,discount_percentage,status,created_at,updated_at)
     values ($1,'Legacy Advisory','legacy-advisory',10,'active',$2,$2)`,
    [oldPartnerId, now],
  );
  await database.query(
    `insert into "run-registrations" (id,partner_id,partner_name,partner_link,partner_identified_at,discount_percentage,discount_amount,original_price,final_price,amount_cents,confirmed_at)
     values ('legacy-registration',$1,'Legacy Advisory','/p/legacy-advisory',$2,10,1200,12000,10800,10800,$2)`,
    [oldPartnerId, now],
  );

  await database.query(readFileSync('server/migrations/20260722_i2_partner_domain.sql', 'utf8'));

  const partnerColumn = await database.query(
    `select is_nullable,column_default from information_schema.columns
     where table_schema=$1 and table_name='run-partners' and column_name='partner_type'`,
    [schema],
  );
  assert.equal(partnerColumn.rows[0]?.is_nullable, 'NO');
  assert.match(String(partnerColumn.rows[0]?.column_default), /sports_advisory/);

  const legacyPartner = await database.query(`select partner_type from "run-partners" where id=$1`, [oldPartnerId]);
  const legacyRegistration = await database.query(`select partner_type from "run-registrations" where id='legacy-registration'`);
  assert.equal(legacyPartner.rows[0]?.partner_type, 'sports_advisory');
  assert.equal(legacyRegistration.rows[0]?.partner_type, 'sports_advisory');

  await database.query('begin');
  const legacyInsert = await database.query(
    `insert into "run-partners" (id,name,slug,discount_percentage,status,created_at,updated_at)
     values ($1,'Legacy API Partner','legacy-api',10,'active',$2,$2) returning partner_type`,
    [randomUUID(), now],
  );
  assert.equal(legacyInsert.rows[0].partner_type, 'sports_advisory');

  const influencerId = randomUUID();
  const influencer = await database.query(
    `insert into "run-partners" (id,name,slug,partner_type,discount_percentage,status,created_at,updated_at)
     values ($1,'Influencer I2','influencer-i2','influencer',10,'active',$2,$2) returning partner_type`,
    [influencerId, now],
  );
  assert.equal(influencer.rows[0].partner_type, 'influencer');

  await expectConstraint(
    'unsupported_type',
    `insert into "run-partners" (id,name,slug,partner_type,discount_percentage,status,created_at,updated_at)
     values ('${randomUUID()}','Future Type','future-type','ambassador',10,'active','${now}','${now}')`,
    'run-partners_partner_type_check',
  );
  await expectConstraint(
    'full_discount',
    `insert into "run-partners" (id,name,slug,discount_percentage,status,created_at,updated_at)
     values ('${randomUUID()}','Full Discount','full-discount',100,'active','${now}','${now}')`,
    'run-partners_discount_percentage_check',
  );
  await expectConstraint(
    'missing_snapshot_type',
    `insert into "run-registrations" (id,partner_id,partner_name,discount_percentage,discount_amount,original_price,final_price,amount_cents)
     values ('missing-type','${influencerId}','Influencer I2',10,1200,12000,10800,10800)`,
    'run-registrations_partner_metadata_check',
  );

  await database.query('savepoint immutable_snapshot');
  await assert.rejects(
    database.query(`update "run-registrations" set partner_type='influencer' where id='legacy-registration'`),
    /confirmed partner snapshot is immutable/,
  );
  await database.query('rollback to savepoint immutable_snapshot');

  await database.query(`update "run-partners" set partner_type='influencer' where id=$1`, [oldPartnerId]);
  const historicalSnapshot = await database.query(`select partner_type from "run-registrations" where id='legacy-registration'`);
  assert.equal(historicalSnapshot.rows[0].partner_type, 'sports_advisory');
  await database.query('rollback');

  await database.query('set search_path to public');
  const appliedMigration = await database.query(
    `select 1 from "run-schema-migrations" where name='20260722_i2_partner_domain.sql'`,
  );
  assert.equal(appliedMigration.rowCount, 1, 'A migration I2 deve estar registrada no banco configurado.');

  const persistedState = await database.query(`
    select
      count(*) filter (where partner_type is null)::int null_partner_types,
      count(*) filter (where partner_type <> 'sports_advisory')::int non_advisory_partners,
      count(*) filter (where partner_type not in ('sports_advisory','influencer'))::int invalid_partner_types
    from "run-partners"
  `);
  assert.deepEqual(persistedState.rows[0], {
    null_partner_types: 0,
    non_advisory_partners: 0,
    invalid_partner_types: 0,
  });

  const snapshotState = await database.query(`
    select count(*)::int invalid_snapshots
    from "run-registrations"
    where (partner_id is null and partner_type is not null)
       or (partner_id is not null and partner_type is null)
  `);
  assert.equal(snapshotState.rows[0].invalid_snapshots, 0);

  const databaseContracts = await database.query(`
    select
      (select pg_get_constraintdef(oid) from pg_constraint where conname='run-partners_discount_percentage_check' limit 1) discount_constraint,
      (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='protect_confirmed_partner_snapshot' limit 1) snapshot_function
  `);
  assert.match(databaseContracts.rows[0].discount_constraint, /discount_percentage\s*<\s*\(?100/);
  assert.match(databaseContracts.rows[0].snapshot_function, /new\.partner_type/);

  console.log('I2 verificada: migration isolada e estado real validados; backfill, tipos, constraints, snapshots e trigger imutavel validos.');
} finally {
  await database.query('rollback').catch(() => undefined);
  await database.query('set search_path to public').catch(() => undefined);
  await database.query(`drop schema if exists "${schema}" cascade`).catch(() => undefined);
  await database.end();
}

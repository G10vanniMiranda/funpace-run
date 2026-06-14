import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import pg from 'pg';
import type { RegistrationFormData, RegistrationStatus } from '../src/types/registration';

const { Pool } = pg;

export type EventRecord = {
  id: string;
  name: string;
  slug: string;
  status: 'draft' | 'published' | 'closed';
  date: string;
  startTime: string;
  locationName: string;
  city: string;
  state: string;
};

export type DistanceRecord = {
  id: string;
  eventId: string;
  name: RegistrationFormData['distance'];
  distanceKm: number;
  capacity: number;
  status: 'active' | 'inactive';
};

export type LotRecord = {
  id: string;
  eventId: string;
  name: string;
  priceCents: number;
  capacity: number;
  soldCount: number;
  status: 'active' | 'inactive' | 'sold_out';
  startsAt: string;
  endsAt: string;
};

export type RegistrationRecord = {
  id: string;
  eventId: string;
  distanceId: string;
  lotId: string;
  cpfHash: string;
  status: RegistrationStatus;
  amountCents: number;
  payload: RegistrationFormData;
  createdAt: string;
  updatedAt: string;
};

export type PaymentRecord = {
  id: string;
  registrationId: string;
  provider: string;
  status: RegistrationStatus;
  amountCents: number;
  providerPaymentId: string | null;
  checkoutUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PaymentEventRecord = {
  id: string;
  paymentId: string;
  providerEventId: string;
  eventType: string;
  payload: unknown;
  receivedAt: string;
};

export type Database = {
  events: EventRecord[];
  distances: DistanceRecord[];
  lots: LotRecord[];
  registrations: RegistrationRecord[];
  payments: PaymentRecord[];
  paymentEvents: PaymentEventRecord[];
};

type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;

const databasePath = resolve(process.env.DATABASE_FILE || 'data/funpace-db.json');
const databaseUrl = process.env.DATABASE_URL || '';
const databaseProvider = process.env.DATABASE_PROVIDER || (databaseUrl ? 'postgres' : 'json');
const databaseSsl = (process.env.DATABASE_SSL || 'true') !== 'false';

const table = {
  events: '"run-events"',
  distances: '"run-distances"',
  lots: '"run-lots"',
  registrations: '"run-registrations"',
  payments: '"run-payments"',
  paymentEvents: '"run-payment-events"',
} as const;

const initialDatabase: Database = {
  events: [
    {
      id: 'funpace-run-2026',
      name: 'FunPace Run 2026',
      slug: 'funpace-run-2026',
      status: 'published',
      date: '2026-09-12',
      startTime: '06:00',
      locationName: 'Complexo Madeira Mamore',
      city: 'Porto Velho',
      state: 'RO',
    },
  ],
  distances: [
    {
      id: 'distance-10k',
      eventId: 'funpace-run-2026',
      name: '10K',
      distanceKm: 10,
      capacity: 300,
      status: 'active',
    },
    {
      id: 'distance-5k',
      eventId: 'funpace-run-2026',
      name: '5K',
      distanceKm: 5,
      capacity: 500,
      status: 'active',
    },
  ],
  lots: [
    {
      id: 'lot-1',
      eventId: 'funpace-run-2026',
      name: 'Lote 1',
      priceCents: 9900,
      capacity: 250,
      soldCount: 0,
      status: 'active',
      startsAt: '2026-06-01T00:00:00-04:00',
      endsAt: '2026-07-31T23:59:59-04:00',
    },
  ],
  registrations: [],
  payments: [],
  paymentEvents: [],
};

const pool = databaseUrl
  ? new Pool({
    connectionString: databaseUrl,
    ssl: databaseSsl ? { rejectUnauthorized: false } : false,
  })
  : null;

let postgresReady: Promise<void> | null = null;

function ensureJsonDatabase() {
  if (existsSync(databasePath)) {
    return;
  }

  mkdirSync(dirname(databasePath), { recursive: true });
  writeFileSync(databasePath, JSON.stringify(initialDatabase, null, 2));
}

function readJsonDatabase(): Database {
  ensureJsonDatabase();

  return JSON.parse(readFileSync(databasePath, 'utf8')) as Database;
}

function writeJsonDatabase(database: Database) {
  mkdirSync(dirname(databasePath), { recursive: true });
  writeFileSync(databasePath, JSON.stringify(database, null, 2));
}

function requirePool() {
  if (!pool) {
    throw new Error('DATABASE_URL must be configured to use Supabase/Postgres.');
  }

  return pool;
}

async function ensurePostgresDatabase(client: Queryable) {
  await client.query(`
    create table if not exists ${table.events} (
      id text primary key,
      name text not null,
      slug text not null unique,
      status text not null check (status in ('draft', 'published', 'closed')),
      date text not null,
      start_time text not null,
      location_name text not null,
      city text not null,
      state text not null
    );

    create table if not exists ${table.distances} (
      id text primary key,
      event_id text not null references ${table.events}(id),
      name text not null,
      distance_km integer not null,
      capacity integer not null,
      status text not null check (status in ('active', 'inactive'))
    );

    create table if not exists ${table.lots} (
      id text primary key,
      event_id text not null references ${table.events}(id),
      name text not null,
      price_cents integer not null,
      capacity integer not null,
      sold_count integer not null default 0,
      status text not null check (status in ('active', 'inactive', 'sold_out')),
      starts_at text not null,
      ends_at text not null
    );

    create table if not exists ${table.registrations} (
      id text primary key,
      event_id text not null references ${table.events}(id),
      distance_id text not null references ${table.distances}(id),
      lot_id text not null references ${table.lots}(id),
      cpf_hash text not null,
      status text not null,
      amount_cents integer not null,
      payload jsonb not null,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists ${table.payments} (
      id text primary key,
      registration_id text not null references ${table.registrations}(id),
      provider text not null,
      status text not null,
      amount_cents integer not null,
      provider_payment_id text,
      checkout_url text,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists ${table.paymentEvents} (
      id text primary key,
      payment_id text not null,
      provider_event_id text not null unique,
      event_type text not null,
      payload jsonb not null,
      received_at text not null
    );

    create index if not exists "run-registrations_cpf_hash_idx" on ${table.registrations}(cpf_hash);
    create index if not exists "run-registrations_status_idx" on ${table.registrations}(status);
    create index if not exists "run-payments_registration_id_idx" on ${table.payments}(registration_id);
  `);

  const existingEvents = await client.query(`select count(*)::int as count from ${table.events}`);

  if (existingEvents.rows[0]?.count === 0) {
    await savePostgresDatabase(client, initialDatabase);
  }
}

async function ensurePostgresReady() {
  if (!postgresReady) {
    postgresReady = ensurePostgresDatabase(requirePool());
  }

  await postgresReady;
}

async function readPostgresDatabase(client: Queryable): Promise<Database> {
  await ensurePostgresReady();

  const [events, distances, lots, registrations, payments, paymentEvents] = await Promise.all([
    client.query(`select id, name, slug, status, date, start_time, location_name, city, state from ${table.events}`),
    client.query(`select id, event_id, name, distance_km, capacity, status from ${table.distances}`),
    client.query(`select id, event_id, name, price_cents, capacity, sold_count, status, starts_at, ends_at from ${table.lots}`),
    client.query(`select id, event_id, distance_id, lot_id, cpf_hash, status, amount_cents, payload, created_at, updated_at from ${table.registrations}`),
    client.query(`select id, registration_id, provider, status, amount_cents, provider_payment_id, checkout_url, created_at, updated_at from ${table.payments}`),
    client.query(`select id, payment_id, provider_event_id, event_type, payload, received_at from ${table.paymentEvents}`),
  ]);

  return {
    events: events.rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      date: row.date,
      startTime: row.start_time,
      locationName: row.location_name,
      city: row.city,
      state: row.state,
    })),
    distances: distances.rows.map((row) => ({
      id: row.id,
      eventId: row.event_id,
      name: row.name,
      distanceKm: row.distance_km,
      capacity: row.capacity,
      status: row.status,
    })),
    lots: lots.rows.map((row) => ({
      id: row.id,
      eventId: row.event_id,
      name: row.name,
      priceCents: row.price_cents,
      capacity: row.capacity,
      soldCount: row.sold_count,
      status: row.status,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
    })),
    registrations: registrations.rows.map((row) => ({
      id: row.id,
      eventId: row.event_id,
      distanceId: row.distance_id,
      lotId: row.lot_id,
      cpfHash: row.cpf_hash,
      status: row.status,
      amountCents: row.amount_cents,
      payload: row.payload,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    payments: payments.rows.map((row) => ({
      id: row.id,
      registrationId: row.registration_id,
      provider: row.provider,
      status: row.status,
      amountCents: row.amount_cents,
      providerPaymentId: row.provider_payment_id,
      checkoutUrl: row.checkout_url,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    paymentEvents: paymentEvents.rows.map((row) => ({
      id: row.id,
      paymentId: row.payment_id,
      providerEventId: row.provider_event_id,
      eventType: row.event_type,
      payload: row.payload,
      receivedAt: row.received_at,
    })),
  };
}

async function savePostgresDatabase(client: Queryable, database: Database) {
  for (const item of database.events) {
    await client.query(
      `insert into ${table.events} (id, name, slug, status, date, start_time, location_name, city, state)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (id) do update set
         name = excluded.name,
         slug = excluded.slug,
         status = excluded.status,
         date = excluded.date,
         start_time = excluded.start_time,
         location_name = excluded.location_name,
         city = excluded.city,
         state = excluded.state`,
      [item.id, item.name, item.slug, item.status, item.date, item.startTime, item.locationName, item.city, item.state],
    );
  }

  for (const item of database.distances) {
    await client.query(
      `insert into ${table.distances} (id, event_id, name, distance_km, capacity, status)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (id) do update set
         event_id = excluded.event_id,
         name = excluded.name,
         distance_km = excluded.distance_km,
         capacity = excluded.capacity,
         status = excluded.status`,
      [item.id, item.eventId, item.name, item.distanceKm, item.capacity, item.status],
    );
  }

  for (const item of database.lots) {
    await client.query(
      `insert into ${table.lots} (id, event_id, name, price_cents, capacity, sold_count, status, starts_at, ends_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (id) do update set
         event_id = excluded.event_id,
         name = excluded.name,
         price_cents = excluded.price_cents,
         capacity = excluded.capacity,
         sold_count = excluded.sold_count,
         status = excluded.status,
         starts_at = excluded.starts_at,
         ends_at = excluded.ends_at`,
      [item.id, item.eventId, item.name, item.priceCents, item.capacity, item.soldCount, item.status, item.startsAt, item.endsAt],
    );
  }

  for (const item of database.registrations) {
    await client.query(
      `insert into ${table.registrations} (id, event_id, distance_id, lot_id, cpf_hash, status, amount_cents, payload, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (id) do update set
         event_id = excluded.event_id,
         distance_id = excluded.distance_id,
         lot_id = excluded.lot_id,
         cpf_hash = excluded.cpf_hash,
         status = excluded.status,
         amount_cents = excluded.amount_cents,
         payload = excluded.payload,
         updated_at = excluded.updated_at`,
      [item.id, item.eventId, item.distanceId, item.lotId, item.cpfHash, item.status, item.amountCents, item.payload, item.createdAt, item.updatedAt],
    );
  }

  for (const item of database.payments) {
    await client.query(
      `insert into ${table.payments} (id, registration_id, provider, status, amount_cents, provider_payment_id, checkout_url, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (id) do update set
         registration_id = excluded.registration_id,
         provider = excluded.provider,
         status = excluded.status,
         amount_cents = excluded.amount_cents,
         provider_payment_id = excluded.provider_payment_id,
         checkout_url = excluded.checkout_url,
         updated_at = excluded.updated_at`,
      [item.id, item.registrationId, item.provider, item.status, item.amountCents, item.providerPaymentId, item.checkoutUrl, item.createdAt, item.updatedAt],
    );
  }

  for (const item of database.paymentEvents) {
    await client.query(
      `insert into ${table.paymentEvents} (id, payment_id, provider_event_id, event_type, payload, received_at)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (id) do update set
         payment_id = excluded.payment_id,
         provider_event_id = excluded.provider_event_id,
         event_type = excluded.event_type,
         payload = excluded.payload,
         received_at = excluded.received_at`,
      [item.id, item.paymentId, item.providerEventId, item.eventType, item.payload, item.receivedAt],
    );
  }
}

function shouldUsePostgres() {
  return databaseProvider === 'postgres' || databaseProvider === 'supabase';
}

export async function transaction<Result>(operation: (database: Database) => Result | Promise<Result>) {
  if (!shouldUsePostgres()) {
    const database = readJsonDatabase();
    const result = await operation(database);

    writeJsonDatabase(database);

    return result;
  }

  const client = await requirePool().connect();

  try {
    await client.query('begin');

    const database = await readPostgresDatabase(client);
    const result = await operation(database);

    await savePostgresDatabase(client, database);
    await client.query('commit');

    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function snapshot() {
  if (!shouldUsePostgres()) {
    return readJsonDatabase();
  }

  return readPostgresDatabase(requirePool());
}

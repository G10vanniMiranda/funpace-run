import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import type { CreateRegistrationResponse, RegistrationFormData, RegistrationStatus } from '../src/types/registration';

const { Pool } = pg;

if (!process.env.VERCEL && existsSync(resolve('.env'))) {
  loadEnvFile(resolve('.env'));
}

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
  status: 'active' | 'inactive' | 'sold_out';
};

export type LotRecord = {
  id: string;
  eventId: string;
  name: string;
  priceCents: number;
  capacity: number;
  soldCount: number;
  status: 'active' | 'inactive' | 'sold_out' | 'scheduled' | 'closed';
  startsAt: string;
  endsAt: string;
  orderIndex: number;
  continuesAfterCapacity: boolean;
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
  expiresAt?: string | null;
  paidAt?: string | null;
  confirmedAt?: string | null;
  bibNumber?: string | null;
  confirmationEmailSentAt?: string | null;
  confirmationEmailLastAttemptAt?: string | null;
  confirmationEmailProvider?: string | null;
  confirmationEmailId?: string | null;
  confirmationEmailError?: string | null;
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
  expiresAt?: string | null;
  paidAt?: string | null;
  gatewayStatus?: string | null;
  gatewayTransactionId?: string | null;
  gatewayPayload?: unknown;
};

export type PaymentEventRecord = {
  id: string;
  paymentId: string;
  providerEventId: string;
  eventType: string;
  payload: unknown;
  receivedAt: string;
};

export type GoogleSheetSyncRecord = {
  id: string;
  entityType: 'registration' | 'payment' | 'check_in' | 'shirt_summary';
  entityId: string;
  sheetName: 'registrations' | 'payments' | 'shirts' | 'check_in';
  operation: 'upsert' | 'replace';
  status: 'pending' | 'processing' | 'synchronized' | 'failed';
  rowNumber: number | null;
  attempts: number;
  lastAttemptAt: string | null;
  synchronizedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GoogleSheetSyncInput = Pick<GoogleSheetSyncRecord, 'entityType' | 'entityId' | 'sheetName' | 'operation'>;

export type CheckInRecord = {
  id: string;
  registrationId: string;
  status: 'checked_in';
  checkedInAt: string;
  checkedInBy: string;
  notes: string | null;
};

export type KitDeliveryRecord = {
  id: string;
  registrationId: string;
  status: 'delivered';
  deliveredAt: string;
  deliveredBy: string;
  notes: string | null;
};

export type AuditLogRecord = {
  id: string;
  actor: string;
  actorRole?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  payload: unknown;
  sessionId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
};

export type AdminSessionRecord = {
  id: string;
  actor: string;
  role: 'administrator' | 'finance' | 'operation';
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  ipAddress: string | null;
  userAgent: string | null;
};

export type AdminUserRecord = {
  id: string;
  email: string;
  passwordHash: string;
  role: 'administrator' | 'finance' | 'operation';
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  disabledAt: string | null;
};

export type PartnershipLeadStatus = 'new' | 'contacted' | 'negotiating' | 'approved' | 'rejected';

export type PartnershipLeadRecord = {
  id: string;
  companyName: string;
  contactName: string;
  contactRole: string;
  corporateEmail: string;
  involvementMessage: string;
  status: PartnershipLeadStatus;
  source: string;
  createdAt: string;
  updatedAt: string;
};

export type Database = {
  events: EventRecord[];
  distances: DistanceRecord[];
  lots: LotRecord[];
  registrations: RegistrationRecord[];
  payments: PaymentRecord[];
  paymentEvents: PaymentEventRecord[];
  googleSheetSyncs: GoogleSheetSyncRecord[];
  checkIns: CheckInRecord[];
  kitDeliveries: KitDeliveryRecord[];
  auditLogs: AuditLogRecord[];
  adminSessions: AdminSessionRecord[];
  adminUsers: AdminUserRecord[];
  partnershipLeads: PartnershipLeadRecord[];
};

export type PendingRegistrationInput = {
  payload: RegistrationFormData;
  cpfHash: string;
  paymentProvider: string;
  expiresAt: string;
  description: (distanceName: string, lotName: string) => string;
};

export type PendingRegistrationResult = CreateRegistrationResponse & {
  statusCode: number;
  amountCents?: number;
  description?: string;
  shouldCreateCheckout?: boolean;
};

export type RegistrationEmailDeliveryContext = {
  registration: RegistrationRecord;
  event: EventRecord;
  distanceName: string;
  lot: LotRecord | null;
  paymentMethod?: string | null;
  deliveryKey: string;
};

export type RegistrationEmailDeliveryResult = {
  ok: boolean;
  provider: string;
  providerMessageId?: string;
  error?: string;
};

export type PaymentConfirmationInput = {
  registrationId: string;
  providerEventId: string;
  providerPaymentId: string;
  providerTransactionId: string;
  eventType: string;
  gatewayStatus: string;
  amountCents: number | null;
  payload: unknown;
  auditAction: string;
  actor?: string;
  auditMetadata?: Record<string, unknown>;
};

export type PaymentConfirmationResult = {
  statusCode: number;
  registrationId?: string;
  paymentId?: string;
  previousStatus?: RegistrationStatus;
  duplicated?: boolean;
  error?: 'not_found' | 'amount_mismatch' | 'stale_checkout';
};

type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;

function mapGoogleSheetSyncRow(row: Record<string, unknown>): GoogleSheetSyncRecord {
  return {
    id: String(row.id),
    entityType: row.entity_type as GoogleSheetSyncRecord['entityType'],
    entityId: String(row.entity_id),
    sheetName: row.sheet_name as GoogleSheetSyncRecord['sheetName'],
    operation: row.operation as GoogleSheetSyncRecord['operation'],
    status: row.status as GoogleSheetSyncRecord['status'],
    rowNumber: row.row_number === null ? null : Number(row.row_number),
    attempts: Number(row.attempts),
    lastAttemptAt: row.last_attempt_at ? String(row.last_attempt_at) : null,
    synchronizedAt: row.synchronized_at ? String(row.synchronized_at) : null,
    lastError: row.last_error ? String(row.last_error) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
type DatabaseReadScope =
  | 'all'
  | 'availability'
  | 'registration-status'
  | 'checkout'
  | 'admin-registrations'
  | 'admin-auth'
  | 'audit'
  | 'partnerships';

const databasePath = resolve(process.env.DATABASE_FILE || 'data/funpace-db.json');
const databaseUrl = process.env.DATABASE_URL || '';
const databaseProvider = process.env.DATABASE_PROVIDER || (databaseUrl ? 'postgres' : 'json');
const databaseSsl = (process.env.DATABASE_SSL || 'true') !== 'false';
const databaseAutoMigrate = process.env.DATABASE_AUTO_MIGRATE === 'true'
  || (!process.env.VERCEL && process.env.DATABASE_AUTO_MIGRATE !== 'false');

const table = {
  events: '"run-events"',
  distances: '"run-distances"',
  lots: '"run-lots"',
  registrations: '"run-registrations"',
  payments: '"run-payments"',
  paymentEvents: '"run-payment-events"',
  googleSheetSyncs: '"run-google-sheet-sync"',
  checkIns: '"run-check-ins"',
  kitDeliveries: '"run-kit-deliveries"',
  auditLogs: '"run-audit-logs"',
  adminSessions: '"run-admin-sessions"',
  adminUsers: '"run-admin-users"',
  partnershipLeads: '"run-partnership-leads"',
} as const;

const initialDatabase: Database = {
  events: [
    {
      id: 'funpace-run-2026',
      name: 'FunPace Run 2026',
      slug: 'funpace-run-2026',
      status: 'published',
      date: '2026-09-20',
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
      priceCents: 7990,
      capacity: 100,
      soldCount: 0,
      status: 'inactive',
      startsAt: '2026-06-01T00:00:00-04:00',
      endsAt: '2026-07-31T23:59:59-04:00',
      orderIndex: 1,
      continuesAfterCapacity: false,
    },
    {
      id: 'lot-2',
      eventId: 'funpace-run-2026',
      name: 'Lote 2',
      priceCents: 9990,
      capacity: 400,
      soldCount: 0,
      status: 'active',
      startsAt: '2026-08-01T00:00:00-04:00',
      endsAt: '2026-08-31T23:59:59-04:00',
      orderIndex: 2,
      continuesAfterCapacity: false,
    },
    {
      id: 'lot-3',
      eventId: 'funpace-run-2026',
      name: 'Lote 3',
      priceCents: 13990,
      capacity: 100,
      soldCount: 0,
      status: 'inactive',
      startsAt: '2026-09-01T00:00:00-04:00',
      endsAt: '2026-09-10T23:59:59-04:00',
      orderIndex: 3,
      continuesAfterCapacity: false,
    },
    {
      id: 'lot-4',
      eventId: 'funpace-run-2026',
      name: 'Lote 4',
      priceCents: 16990,
      capacity: 100,
      soldCount: 0,
      status: 'inactive',
      startsAt: '2026-09-11T00:00:00-04:00',
      endsAt: '2026-09-20T23:59:59-04:00',
      orderIndex: 4,
      continuesAfterCapacity: true,
    },
  ],
  registrations: [],
  payments: [],
  paymentEvents: [],
  googleSheetSyncs: [],
  checkIns: [],
  kitDeliveries: [],
  auditLogs: [],
  adminSessions: [],
  adminUsers: [],
  partnershipLeads: [],
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

  return normalizeDatabase(JSON.parse(readFileSync(databasePath, 'utf8')) as Partial<Database>);
}

function normalizeDatabase(database: Partial<Database>): Database {
  return {
    events: database.events || [],
    distances: database.distances || [],
    lots: (database.lots || []).map((lot, index) => ({
      ...lot,
      orderIndex: lot.orderIndex || index + 1,
      continuesAfterCapacity: Boolean(lot.continuesAfterCapacity),
    })),
    registrations: database.registrations || [],
    payments: database.payments || [],
    paymentEvents: database.paymentEvents || [],
    googleSheetSyncs: database.googleSheetSyncs || [],
    checkIns: database.checkIns || [],
    kitDeliveries: database.kitDeliveries || [],
    auditLogs: database.auditLogs || [],
    adminSessions: database.adminSessions || [],
    adminUsers: database.adminUsers || [],
    partnershipLeads: database.partnershipLeads || [],
  };
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
      ends_at text not null,
      order_index integer not null default 0,
      continues_after_capacity boolean not null default false
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
      updated_at text not null,
      expires_at text,
      paid_at text,
      confirmed_at text,
      confirmation_email_sent_at text,
      confirmation_email_last_attempt_at text,
      confirmation_email_provider text,
      confirmation_email_id text,
      confirmation_email_error text
      ,bib_number text
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
      updated_at text not null,
      expires_at text,
      paid_at text,
      gateway_status text,
      gateway_transaction_id text,
      gateway_payload jsonb
    );

    create table if not exists ${table.paymentEvents} (
      id text primary key,
      payment_id text not null,
      provider_event_id text not null unique,
      event_type text not null,
      payload jsonb not null,
      received_at text not null
    );

    create table if not exists ${table.googleSheetSyncs} (
      id text primary key,
      entity_type text not null check (entity_type in ('registration', 'payment', 'check_in', 'shirt_summary')),
      entity_id text not null,
      sheet_name text not null check (sheet_name in ('registrations', 'payments', 'shirts', 'check_in')),
      operation text not null check (operation in ('upsert', 'replace')),
      status text not null check (status in ('pending', 'processing', 'synchronized', 'failed')),
      row_number integer,
      attempts integer not null default 0,
      last_attempt_at text,
      synchronized_at text,
      last_error text,
      created_at text not null,
      updated_at text not null,
      unique (entity_type, entity_id, sheet_name)
    );

    create table if not exists ${table.checkIns} (
      id text primary key,
      registration_id text not null references ${table.registrations}(id),
      status text not null check (status in ('checked_in')),
      checked_in_at text not null,
      checked_in_by text not null,
      notes text
    );

    create table if not exists ${table.kitDeliveries} (
      id text primary key,
      registration_id text not null references ${table.registrations}(id),
      status text not null check (status in ('delivered')),
      delivered_at text not null,
      delivered_by text not null,
      notes text
    );

    create table if not exists ${table.auditLogs} (
      id text primary key,
      actor text not null,
      actor_role text,
      action text not null,
      entity_type text not null,
      entity_id text not null,
      payload jsonb not null,
      session_id text,
      ip_address text,
      user_agent text,
      created_at text not null
    );

    create table if not exists ${table.adminSessions} (
      id text primary key,
      actor text not null,
      role text not null check (role in ('administrator', 'finance', 'operation')),
      created_at text not null,
      expires_at text not null,
      revoked_at text,
      ip_address text,
      user_agent text
    );

    create table if not exists ${table.adminUsers} (
      id text primary key,
      email text not null unique,
      password_hash text not null,
      role text not null check (role in ('administrator', 'finance', 'operation')),
      created_at text not null,
      updated_at text not null,
      last_login_at text,
      disabled_at text
    );

    create table if not exists ${table.partnershipLeads} (
      id text primary key,
      company_name text not null,
      contact_name text not null,
      contact_role text not null,
      corporate_email text not null,
      involvement_message text not null,
      status text not null check (status in ('new', 'contacted', 'negotiating', 'approved', 'rejected')),
      source text not null,
      created_at text not null,
      updated_at text not null
    );

    create index if not exists "run-registrations_cpf_hash_idx" on ${table.registrations}(cpf_hash);
    create index if not exists "run-registrations_status_idx" on ${table.registrations}(status);
    create index if not exists "run-payments_registration_id_idx" on ${table.payments}(registration_id);
    create index if not exists "run-google-sheet-sync_status_idx" on ${table.googleSheetSyncs}(status);
    create index if not exists "run-google-sheet-sync_entity_idx" on ${table.googleSheetSyncs}(entity_type, entity_id);
    create index if not exists "run-google-sheet-sync_updated_at_idx" on ${table.googleSheetSyncs}(updated_at);
    create unique index if not exists "run-check-ins_registration_id_idx" on ${table.checkIns}(registration_id);
    create unique index if not exists "run-kit-deliveries_registration_id_idx" on ${table.kitDeliveries}(registration_id);
    create index if not exists "run-audit-logs_entity_idx" on ${table.auditLogs}(entity_type, entity_id);
    create index if not exists "run-admin-sessions_actor_idx" on ${table.adminSessions}(actor);
    create index if not exists "run-admin-sessions_expires_at_idx" on ${table.adminSessions}(expires_at);
    create unique index if not exists "run-admin-users_email_idx" on ${table.adminUsers}(email);
    create index if not exists "run-partnership-leads_status_idx" on ${table.partnershipLeads}(status);
    create index if not exists "run-partnership-leads_created_at_idx" on ${table.partnershipLeads}(created_at);
  `);

  await client.query(`alter table ${table.registrations} add column if not exists expires_at text`);
  await client.query(`alter table ${table.registrations} add column if not exists paid_at text`);
  await client.query(`alter table ${table.registrations} add column if not exists confirmed_at text`);
  await client.query(`alter table ${table.registrations} add column if not exists confirmation_email_sent_at text`);
  await client.query(`alter table ${table.registrations} add column if not exists confirmation_email_last_attempt_at text`);
  await client.query(`alter table ${table.registrations} add column if not exists confirmation_email_provider text`);
  await client.query(`alter table ${table.registrations} add column if not exists confirmation_email_id text`);
  await client.query(`alter table ${table.registrations} add column if not exists confirmation_email_error text`);
  await client.query(`alter table ${table.registrations} add column if not exists bib_number text`);
  await client.query(`create unique index if not exists "run-registrations_event_bib_idx" on ${table.registrations}(event_id, bib_number) where bib_number is not null`);
  await client.query(`alter table ${table.lots} add column if not exists order_index integer not null default 0`);
  await client.query(`alter table ${table.lots} add column if not exists continues_after_capacity boolean not null default false`);
  await client.query(`create index if not exists "run-lots_event_order_idx" on ${table.lots}(event_id, order_index, starts_at)`);
  await client.query(`
    create or replace function public.run_select_lot_for_registration_number(
      p_event_id text,
      p_registration_number integer
    )
    returns table (
      id text,
      name text,
      price_cents integer,
      capacity integer,
      sold_count integer,
      status text,
      starts_at text,
      ends_at text,
      order_index integer,
      continues_after_capacity boolean
    )
    language plpgsql
    security definer
    set search_path = public
    as $$
    declare
      v_accumulated_capacity integer := 0;
      v_lot record;
      v_continuous_lot_id text := null;
    begin
      for v_lot in
        select lot.*
        from "run-lots" lot
        where lot.event_id = p_event_id
          and lot.status in ('active', 'sold_out')
        order by lot.order_index asc, lot.starts_at asc
      loop
        v_accumulated_capacity := v_accumulated_capacity + v_lot.capacity;

        if v_lot.continues_after_capacity then
          v_continuous_lot_id := v_lot.id;
        end if;

        if p_registration_number <= v_accumulated_capacity then
          return query
          select lot.id, lot.name, lot.price_cents, lot.capacity, lot.sold_count, lot.status,
                 lot.starts_at, lot.ends_at, lot.order_index, lot.continues_after_capacity
          from "run-lots" lot
          where lot.id = v_lot.id;
          return;
        end if;
      end loop;

      if v_continuous_lot_id is not null then
        return query
        select lot.id, lot.name, lot.price_cents, lot.capacity, lot.sold_count, lot.status,
               lot.starts_at, lot.ends_at, lot.order_index, lot.continues_after_capacity
        from "run-lots" lot
        where lot.id = v_continuous_lot_id;
      end if;
    end;
    $$;
  `);
  await client.query(`alter table ${table.payments} add column if not exists expires_at text`);
  await client.query(`alter table ${table.payments} add column if not exists paid_at text`);
  await client.query(`alter table ${table.payments} add column if not exists gateway_status text`);
  await client.query(`alter table ${table.payments} add column if not exists gateway_transaction_id text`);
  await client.query(`alter table ${table.payments} add column if not exists gateway_payload jsonb`);
  await client.query(`alter table ${table.auditLogs} add column if not exists actor_role text`);
  await client.query(`alter table ${table.auditLogs} add column if not exists session_id text`);
  await client.query(`alter table ${table.auditLogs} add column if not exists ip_address text`);
  await client.query(`alter table ${table.auditLogs} add column if not exists user_agent text`);

  const existingEvents = await client.query(`select count(*)::int as count from ${table.events}`);

  if (existingEvents.rows[0]?.count === 0) {
    await savePostgresDatabase(client, initialDatabase);
  }

  await ensureConfiguredLots(client);
}

async function ensurePostgresReady() {
  if (!databaseAutoMigrate) {
    return;
  }

  if (!postgresReady) {
    postgresReady = ensurePostgresDatabase(requirePool());
  }

  await postgresReady;
}

async function readPostgresDatabase(client: Queryable, scope: DatabaseReadScope = 'all'): Promise<Database> {
  if (scope === 'admin-auth') {
    const adminSessions = await client.query(`select id, actor, role, created_at, expires_at, revoked_at, ip_address, user_agent from ${table.adminSessions}`);
    const adminUsers = await client.query(`select id, email, password_hash, role, created_at, updated_at, last_login_at, disabled_at from ${table.adminUsers}`);

    return {
      events: [],
      distances: [],
      lots: [],
      registrations: [],
      payments: [],
      paymentEvents: [],
      googleSheetSyncs: [],
      checkIns: [],
      kitDeliveries: [],
      auditLogs: [],
      adminSessions: adminSessions.rows.map((row) => ({
        id: row.id,
        actor: row.actor,
        role: row.role,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
        ipAddress: row.ip_address,
        userAgent: row.user_agent,
      })),
      adminUsers: adminUsers.rows.map((row) => ({
        id: row.id,
        email: row.email,
        passwordHash: row.password_hash,
        role: row.role,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastLoginAt: row.last_login_at,
        disabledAt: row.disabled_at,
      })),
      partnershipLeads: [],
    };
  }

  const include = {
    events: ['all', 'availability', 'checkout'].includes(scope),
    distances: ['all', 'availability', 'checkout', 'admin-registrations'].includes(scope),
    lots: ['all', 'availability', 'checkout', 'admin-registrations'].includes(scope),
    registrations: ['all', 'availability', 'registration-status', 'checkout', 'admin-registrations'].includes(scope),
    payments: ['all', 'registration-status', 'checkout', 'admin-registrations'].includes(scope),
    paymentEvents: ['all', 'checkout', 'admin-registrations'].includes(scope),
    googleSheetSyncs: ['all', 'admin-registrations'].includes(scope),
    checkIns: ['all', 'admin-registrations'].includes(scope),
    kitDeliveries: ['all', 'admin-registrations'].includes(scope),
    auditLogs: ['all', 'audit', 'checkout', 'admin-registrations'].includes(scope),
    adminSessions: ['all', 'admin-auth'].includes(scope),
    adminUsers: ['all'].includes(scope),
    partnershipLeads: ['all', 'partnerships'].includes(scope),
  };
  const emptyRows = { rows: [] };
  // node-postgres serializes a client; issuing Promise.all on one client is
  // deprecated and can leave request completion detached from query completion.
  const events = include.events ? await client.query(`select id, name, slug, status, date, start_time, location_name, city, state from ${table.events}`) : emptyRows;
  const distances = include.distances ? await client.query(`select id, event_id, name, distance_km, capacity, status from ${table.distances}`) : emptyRows;
  const lots = include.lots ? await client.query(`select id, event_id, name, price_cents, capacity, sold_count, status, starts_at, ends_at, order_index, continues_after_capacity from ${table.lots}`) : emptyRows;
  const registrations = include.registrations ? await client.query(`select id, event_id, distance_id, lot_id, cpf_hash, status, amount_cents, payload, created_at, updated_at, expires_at, paid_at, confirmed_at, confirmation_email_sent_at, confirmation_email_last_attempt_at, confirmation_email_provider, confirmation_email_id, confirmation_email_error, bib_number from ${table.registrations}`) : emptyRows;
  const payments = include.payments ? await client.query(`select id, registration_id, provider, status, amount_cents, provider_payment_id, checkout_url, created_at, updated_at, expires_at, paid_at, gateway_status, gateway_transaction_id, gateway_payload from ${table.payments}`) : emptyRows;
  const paymentEvents = include.paymentEvents ? await client.query(`select id, payment_id, provider_event_id, event_type, payload, received_at from ${table.paymentEvents}`) : emptyRows;
  const googleSheetSyncs = include.googleSheetSyncs ? await client.query(`select id, entity_type, entity_id, sheet_name, operation, status, row_number, attempts, last_attempt_at, synchronized_at, last_error, created_at, updated_at from ${table.googleSheetSyncs}`) : emptyRows;
  const checkIns = include.checkIns ? await client.query(`select id, registration_id, status, checked_in_at, checked_in_by, notes from ${table.checkIns}`) : emptyRows;
  const kitDeliveries = include.kitDeliveries ? await client.query(`select id, registration_id, status, delivered_at, delivered_by, notes from ${table.kitDeliveries}`) : emptyRows;
  const auditLogs = include.auditLogs ? await client.query(`select id, actor, actor_role, action, entity_type, entity_id, payload, session_id, ip_address, user_agent, created_at from ${table.auditLogs}`) : emptyRows;
  const adminSessions = include.adminSessions ? await client.query(`select id, actor, role, created_at, expires_at, revoked_at, ip_address, user_agent from ${table.adminSessions}`) : emptyRows;
  const adminUsers = include.adminUsers ? await client.query(`select id, email, password_hash, role, created_at, updated_at, last_login_at, disabled_at from ${table.adminUsers}`) : emptyRows;
  const partnershipLeads = include.partnershipLeads ? await client.query(`select id, company_name, contact_name, contact_role, corporate_email, involvement_message, status, source, created_at, updated_at from ${table.partnershipLeads}`) : emptyRows;

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
      orderIndex: Number(row.order_index || 0),
      continuesAfterCapacity: Boolean(row.continues_after_capacity),
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
      expiresAt: row.expires_at,
      paidAt: row.paid_at,
      confirmedAt: row.confirmed_at,
      confirmationEmailSentAt: row.confirmation_email_sent_at,
      confirmationEmailLastAttemptAt: row.confirmation_email_last_attempt_at,
      confirmationEmailProvider: row.confirmation_email_provider,
      confirmationEmailId: row.confirmation_email_id,
      confirmationEmailError: row.confirmation_email_error,
      bibNumber: row.bib_number,
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
      expiresAt: row.expires_at,
      paidAt: row.paid_at,
      gatewayStatus: row.gateway_status,
      gatewayTransactionId: row.gateway_transaction_id,
      gatewayPayload: row.gateway_payload,
    })),
    paymentEvents: paymentEvents.rows.map((row) => ({
      id: row.id,
      paymentId: row.payment_id,
      providerEventId: row.provider_event_id,
      eventType: row.event_type,
      payload: row.payload,
      receivedAt: row.received_at,
    })),
    googleSheetSyncs: googleSheetSyncs.rows.map(mapGoogleSheetSyncRow),
    checkIns: checkIns.rows.map((row) => ({
      id: row.id,
      registrationId: row.registration_id,
      status: row.status,
      checkedInAt: row.checked_in_at,
      checkedInBy: row.checked_in_by,
      notes: row.notes,
    })),
    kitDeliveries: kitDeliveries.rows.map((row) => ({
      id: row.id,
      registrationId: row.registration_id,
      status: row.status,
      deliveredAt: row.delivered_at,
      deliveredBy: row.delivered_by,
      notes: row.notes,
    })),
    auditLogs: auditLogs.rows.map((row) => ({
      id: row.id,
      actor: row.actor,
      actorRole: row.actor_role,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      payload: row.payload,
      sessionId: row.session_id,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      createdAt: row.created_at,
    })),
    adminSessions: adminSessions.rows.map((row) => ({
      id: row.id,
      actor: row.actor,
      role: row.role,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
    })),
    adminUsers: adminUsers.rows.map((row) => ({
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      role: row.role,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastLoginAt: row.last_login_at,
      disabledAt: row.disabled_at,
    })),
    partnershipLeads: partnershipLeads.rows.map((row) => ({
      id: row.id,
      companyName: row.company_name,
      contactName: row.contact_name,
      contactRole: row.contact_role,
      corporateEmail: row.corporate_email,
      involvementMessage: row.involvement_message,
      status: row.status,
      source: row.source,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
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
      `insert into ${table.lots} (id, event_id, name, price_cents, capacity, sold_count, status, starts_at, ends_at, order_index, continues_after_capacity)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (id) do update set
         event_id = excluded.event_id,
         name = excluded.name,
         price_cents = excluded.price_cents,
         capacity = excluded.capacity,
         sold_count = excluded.sold_count,
         status = excluded.status,
         starts_at = excluded.starts_at,
         ends_at = excluded.ends_at,
         order_index = excluded.order_index,
         continues_after_capacity = excluded.continues_after_capacity`,
      [
        item.id,
        item.eventId,
        item.name,
        item.priceCents,
        item.capacity,
        item.soldCount,
        item.status,
        item.startsAt,
        item.endsAt,
        item.orderIndex,
        item.continuesAfterCapacity,
      ],
    );
  }

  for (const item of database.registrations) {
    await client.query(
      `insert into ${table.registrations} (id, event_id, distance_id, lot_id, cpf_hash, status, amount_cents, payload, created_at, updated_at, expires_at, paid_at, confirmed_at, confirmation_email_sent_at, confirmation_email_last_attempt_at, confirmation_email_provider, confirmation_email_id, confirmation_email_error, bib_number)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       on conflict (id) do update set
         event_id = excluded.event_id,
         distance_id = excluded.distance_id,
         lot_id = excluded.lot_id,
         cpf_hash = excluded.cpf_hash,
         status = excluded.status,
         amount_cents = excluded.amount_cents,
         payload = excluded.payload,
         updated_at = excluded.updated_at,
         expires_at = excluded.expires_at,
         paid_at = excluded.paid_at,
         confirmed_at = excluded.confirmed_at,
         confirmation_email_sent_at = excluded.confirmation_email_sent_at,
         confirmation_email_last_attempt_at = excluded.confirmation_email_last_attempt_at,
         confirmation_email_provider = excluded.confirmation_email_provider,
         confirmation_email_id = excluded.confirmation_email_id,
         confirmation_email_error = excluded.confirmation_email_error,
         bib_number = excluded.bib_number`,
      [
        item.id,
        item.eventId,
        item.distanceId,
        item.lotId,
        item.cpfHash,
        item.status,
        item.amountCents,
        item.payload,
        item.createdAt,
        item.updatedAt,
        item.expiresAt || null,
        item.paidAt || null,
        item.confirmedAt || null,
        item.confirmationEmailSentAt || null,
        item.confirmationEmailLastAttemptAt || null,
        item.confirmationEmailProvider || null,
        item.confirmationEmailId || null,
        item.confirmationEmailError || null,
        item.bibNumber || null,
      ],
    );
  }

  for (const item of database.payments) {
    await client.query(
      `insert into ${table.payments} (id, registration_id, provider, status, amount_cents, provider_payment_id, checkout_url, created_at, updated_at, expires_at, paid_at, gateway_status, gateway_transaction_id, gateway_payload)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       on conflict (id) do update set
         registration_id = excluded.registration_id,
         provider = excluded.provider,
         status = excluded.status,
         amount_cents = excluded.amount_cents,
         provider_payment_id = excluded.provider_payment_id,
         checkout_url = excluded.checkout_url,
         updated_at = excluded.updated_at,
         expires_at = excluded.expires_at,
         paid_at = excluded.paid_at,
         gateway_status = excluded.gateway_status,
         gateway_transaction_id = excluded.gateway_transaction_id,
         gateway_payload = excluded.gateway_payload`,
      [
        item.id,
        item.registrationId,
        item.provider,
        item.status,
        item.amountCents,
        item.providerPaymentId,
        item.checkoutUrl,
        item.createdAt,
        item.updatedAt,
        item.expiresAt || null,
        item.paidAt || null,
        item.gatewayStatus || null,
        item.gatewayTransactionId || null,
        item.gatewayPayload || null,
      ],
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

  for (const item of database.googleSheetSyncs) {
    await client.query(
      `insert into ${table.googleSheetSyncs} (id, entity_type, entity_id, sheet_name, operation, status, row_number, attempts, last_attempt_at, synchronized_at, last_error, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       on conflict (entity_type, entity_id, sheet_name) do update set
         operation = excluded.operation,
         status = excluded.status,
         row_number = excluded.row_number,
         attempts = excluded.attempts,
         last_attempt_at = excluded.last_attempt_at,
         synchronized_at = excluded.synchronized_at,
         last_error = excluded.last_error,
         updated_at = excluded.updated_at`,
      [
        item.id,
        item.entityType,
        item.entityId,
        item.sheetName,
        item.operation,
        item.status,
        item.rowNumber,
        item.attempts,
        item.lastAttemptAt,
        item.synchronizedAt,
        item.lastError,
        item.createdAt,
        item.updatedAt,
      ],
    );
  }

  for (const item of database.checkIns) {
    await client.query(
      `insert into ${table.checkIns} (id, registration_id, status, checked_in_at, checked_in_by, notes)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (registration_id) do update set
         status = excluded.status,
         checked_in_at = excluded.checked_in_at,
         checked_in_by = excluded.checked_in_by,
         notes = excluded.notes`,
      [item.id, item.registrationId, item.status, item.checkedInAt, item.checkedInBy, item.notes],
    );
  }

  for (const item of database.kitDeliveries) {
    await client.query(
      `insert into ${table.kitDeliveries} (id, registration_id, status, delivered_at, delivered_by, notes)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (registration_id) do update set
         status = excluded.status,
         delivered_at = excluded.delivered_at,
         delivered_by = excluded.delivered_by,
         notes = excluded.notes`,
      [item.id, item.registrationId, item.status, item.deliveredAt, item.deliveredBy, item.notes],
    );
  }

  for (const item of database.auditLogs) {
    await client.query(
      `insert into ${table.auditLogs} (id, actor, actor_role, action, entity_type, entity_id, payload, session_id, ip_address, user_agent, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (id) do update set
         actor = excluded.actor,
         actor_role = excluded.actor_role,
         action = excluded.action,
         entity_type = excluded.entity_type,
         entity_id = excluded.entity_id,
         payload = excluded.payload,
         session_id = excluded.session_id,
         ip_address = excluded.ip_address,
         user_agent = excluded.user_agent,
         created_at = excluded.created_at`,
      [item.id, item.actor, item.actorRole || null, item.action, item.entityType, item.entityId, item.payload, item.sessionId || null, item.ipAddress || null, item.userAgent || null, item.createdAt],
    );
  }

  for (const item of database.adminSessions) {
    await client.query(
      `insert into ${table.adminSessions} (id, actor, role, created_at, expires_at, revoked_at, ip_address, user_agent)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (id) do update set
         actor = excluded.actor,
         role = excluded.role,
         created_at = excluded.created_at,
         expires_at = excluded.expires_at,
         revoked_at = excluded.revoked_at,
         ip_address = excluded.ip_address,
         user_agent = excluded.user_agent`,
      [item.id, item.actor, item.role, item.createdAt, item.expiresAt, item.revokedAt, item.ipAddress, item.userAgent],
    );
  }

  for (const item of database.adminUsers) {
    await client.query(
      `insert into ${table.adminUsers} (id, email, password_hash, role, created_at, updated_at, last_login_at, disabled_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (id) do update set
         email = excluded.email,
         password_hash = excluded.password_hash,
         role = excluded.role,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at,
         last_login_at = excluded.last_login_at,
         disabled_at = excluded.disabled_at`,
      [item.id, item.email, item.passwordHash, item.role, item.createdAt, item.updatedAt, item.lastLoginAt, item.disabledAt],
    );
  }

  for (const item of database.partnershipLeads) {
    await client.query(
      `insert into ${table.partnershipLeads} (id, company_name, contact_name, contact_role, corporate_email, involvement_message, status, source, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (id) do update set
         company_name = excluded.company_name,
         contact_name = excluded.contact_name,
         contact_role = excluded.contact_role,
         corporate_email = excluded.corporate_email,
         involvement_message = excluded.involvement_message,
         status = excluded.status,
         source = excluded.source,
         updated_at = excluded.updated_at`,
      [
        item.id,
        item.companyName,
        item.contactName,
        item.contactRole,
        item.corporateEmail,
        item.involvementMessage,
        item.status,
        item.source,
        item.createdAt,
        item.updatedAt,
      ],
    );
  }
}

function shouldUsePostgres() {
  return databaseProvider === 'postgres' || databaseProvider === 'supabase';
}

export function usesPostgresDatabase() {
  return shouldUsePostgres();
}

type LotSelectionCandidate = Pick<LotRecord, 'id' | 'capacity' | 'orderIndex' | 'continuesAfterCapacity'>;

export function selectLotForRegistrationNumber<Lot extends LotSelectionCandidate>(
  lots: Lot[],
  registrationNumber: number,
): Lot | null {
  const orderedLots = lots
    .slice()
    .sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));
  let accumulatedCapacity = 0;

  for (const lot of orderedLots) {
    accumulatedCapacity += Number(lot.capacity);

    if (registrationNumber <= accumulatedCapacity) {
      return lot;
    }
  }

  for (let index = orderedLots.length - 1; index >= 0; index -= 1) {
    if (orderedLots[index].continuesAfterCapacity) {
      return orderedLots[index];
    }
  }

  return null;
}

async function ensureConfiguredLots(client: Queryable) {
  for (const lot of initialDatabase.lots) {
    await client.query(
      `insert into ${table.lots} (id, event_id, name, price_cents, capacity, sold_count, status, starts_at, ends_at, order_index, continues_after_capacity)
       values ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9, $10)
       on conflict (id) do update set
         event_id = excluded.event_id,
         name = excluded.name,
         price_cents = excluded.price_cents,
         capacity = excluded.capacity,
         status = case
           when ${table.lots}.status = 'inactive' then ${table.lots}.status
           when excluded.continues_after_capacity and excluded.status = 'active' then 'active'
           when ${table.lots}.sold_count >= excluded.capacity then 'sold_out'
           else excluded.status
         end,
         starts_at = excluded.starts_at,
         ends_at = excluded.ends_at,
         order_index = excluded.order_index,
         continues_after_capacity = excluded.continues_after_capacity`,
      [
        lot.id,
        lot.eventId,
        lot.name,
        lot.priceCents,
        lot.capacity,
        lot.status,
        lot.startsAt,
        lot.endsAt,
        lot.orderIndex,
        lot.continuesAfterCapacity,
      ],
    );
  }
}

export async function createPendingRegistrationInPostgres(input: PendingRegistrationInput): Promise<PendingRegistrationResult> {
  const configurationIssue = getDatabaseConfigurationIssue();

  if (configurationIssue) {
    throw new Error(configurationIssue);
  }

  const client = await requirePool().connect();

  try {
    await ensurePostgresReady();

    await client.query('begin');
    await client.query("select pg_advisory_xact_lock(hashtext('funpace-run-registration-lot'))");
    await client.query("set local lock_timeout = '5s'");
    await client.query("set local statement_timeout = '15s'");

    const eventResult = await client.query(
      `select id from ${table.events} where slug = $1 and status = $2 limit 1`,
      ['funpace-run-2026', 'published'],
    );
    const event = eventResult.rows[0];

    if (!event) {
      await client.query('rollback');
      return {
        statusCode: 409,
        success: false,
        registrationId: '',
        paymentId: null,
        registrationStatus: 'cancelled',
        checkoutStatus: 'not_configured',
        checkoutUrl: null,
        message: 'Evento indisponivel para inscricoes.',
      };
    }

    const stalePendingResult = await client.query(
      `select registration.id, registration.lot_id
       from ${table.registrations} registration
       join ${table.lots} lot on lot.id = registration.lot_id
       left join ${table.payments} payment on payment.registration_id = registration.id
       where registration.event_id = $1
         and registration.cpf_hash = $2
         and registration.status = $3
         and (
           lot.status <> 'active'
           or registration.amount_cents <> lot.price_cents
           or payment.id is null
           or payment.amount_cents <> lot.price_cents
         )
       for update of registration`,
      [event.id, input.cpfHash, 'pending_payment'],
    );

    if (stalePendingResult.rows.length > 0) {
      const now = new Date().toISOString();
      const staleIds = stalePendingResult.rows.map((row) => String(row.id));
      const staleLotCounts = stalePendingResult.rows.reduce<Record<string, number>>((accumulator, row) => {
        const lotId = String(row.lot_id);
        accumulator[lotId] = (accumulator[lotId] || 0) + 1;
        return accumulator;
      }, {});

      await client.query(
        `update ${table.registrations}
         set status = 'expired',
             updated_at = $1,
             expires_at = coalesce(expires_at, $1)
         where id = any($2::text[])`,
        [now, staleIds],
      );
      await client.query(
        `update ${table.payments}
         set status = 'expired',
             checkout_url = null,
             provider_payment_id = null,
             updated_at = $1,
             expires_at = coalesce(expires_at, $1)
         where registration_id = any($2::text[])`,
        [now, staleIds],
      );

      for (const [lotId, total] of Object.entries(staleLotCounts)) {
        await client.query(
          `update ${table.lots}
           set sold_count = greatest(sold_count - $1::int, 0)
           where id = $2`,
          [total, lotId],
        );
      }
    }

    const existingResult = await client.query(
      `select registration.id, registration.status, registration.expires_at,
              registration.amount_cents, payment.id as payment_id, payment.checkout_url,
              distance.name as distance_name, lot.name as lot_name
       from ${table.registrations} registration
       left join ${table.payments} payment on payment.registration_id = registration.id
       join ${table.distances} distance on distance.id = registration.distance_id
       join ${table.lots} lot on lot.id = registration.lot_id
       where registration.event_id = $1
         and registration.cpf_hash = $2
         and registration.status = any($3)
       limit 1`,
      [event.id, input.cpfHash, ['pending_payment', 'paid']],
    );
    const existing = existingResult.rows[0];

    if (existing) {
      await client.query('commit');
      const shouldCreateCheckout = existing.status === 'pending_payment' && !existing.checkout_url;
      return {
        statusCode: existing.status === 'paid' ? 409 : 200,
        success: existing.status !== 'paid',
        registrationId: existing.id,
        paymentId: existing.payment_id || null,
        registrationStatus: existing.status,
        checkoutStatus: existing.checkout_url ? 'created' : 'not_configured',
        checkoutUrl: existing.checkout_url || null,
        expiresAt: existing.expires_at || null,
        message: existing.status === 'paid'
          ? 'Ja existe uma inscricao paga para este CPF.'
          : shouldCreateCheckout
            ? 'Inscricao recuperada. Preparando um novo acesso ao checkout.'
            : 'Ja existe uma inscricao aguardando pagamento para este CPF.',
        amountCents: shouldCreateCheckout ? Number(existing.amount_cents) : undefined,
        description: shouldCreateCheckout ? input.description(existing.distance_name, existing.lot_name) : undefined,
        shouldCreateCheckout,
      };
    }

    const distanceResult = await client.query(
      `select id, name, capacity from ${table.distances} where event_id = $1 and name = $2 and status = $3 limit 1`,
      [event.id, input.payload.distance, 'active'],
    );
    const lotResult = await client.query(
      `select id, name, price_cents, capacity, sold_count, status, starts_at, ends_at, order_index, continues_after_capacity
       from ${table.lots}
       where event_id = $1 and status in ('active', 'sold_out')
       order by order_index asc, starts_at asc
       for update`,
      [event.id],
    );
    const distance = distanceResult.rows[0];

    if (!distance || lotResult.rows.length === 0) {
      await client.query('rollback');
      return {
        statusCode: 409,
        success: false,
        registrationId: '',
        paymentId: null,
        registrationStatus: 'cancelled',
        checkoutStatus: 'not_configured',
        checkoutUrl: null,
        message: 'Distancia ou lote indisponivel.',
      };
    }

    const distanceSoldResult = await client.query(
      `select count(*)::int as count from ${table.registrations} where distance_id = $1 and status = any($2)`,
      [distance.id, ['pending_payment', 'paid']],
    );
    const distanceSold = Number(distanceSoldResult.rows[0]?.count || 0);

    const eventPaidResult = await client.query(
      `select count(*)::int as count from ${table.registrations} where event_id = $1 and status = $2`,
      [event.id, 'paid'],
    );
    const eventPaid = Number(eventPaidResult.rows[0]?.count || 0);
    const configuredLots = lotResult.rows.map((row) => ({
      id: String(row.id),
      eventId: String(event.id),
      name: String(row.name),
      priceCents: Number(row.price_cents),
      capacity: Number(row.capacity),
      soldCount: Number(row.sold_count),
      status: row.status as LotRecord['status'],
      startsAt: String(row.starts_at),
      endsAt: String(row.ends_at),
      orderIndex: Number(row.order_index || 0),
      continuesAfterCapacity: Boolean(row.continues_after_capacity),
    }));
    const previousLot = eventPaid > 0 ? selectLotForRegistrationNumber(configuredLots, eventPaid) : null;
    const selectedLotResult = await client.query(
      `select id, name, price_cents, capacity, sold_count, status, starts_at, ends_at, order_index, continues_after_capacity
       from public.run_select_lot_for_registration_number($1, $2)
       limit 1`,
      [event.id, eventPaid + 1],
    );
    const selectedLot = selectedLotResult.rows[0];
    const lot = selectedLot ? {
      id: String(selectedLot.id),
      eventId: String(event.id),
      name: String(selectedLot.name),
      priceCents: Number(selectedLot.price_cents),
      capacity: Number(selectedLot.capacity),
      soldCount: Number(selectedLot.sold_count),
      status: selectedLot.status as LotRecord['status'],
      startsAt: String(selectedLot.starts_at),
      endsAt: String(selectedLot.ends_at),
      orderIndex: Number(selectedLot.order_index || 0),
      continuesAfterCapacity: Boolean(selectedLot.continues_after_capacity),
    } : null;

    if (distanceSold >= Number(distance.capacity) || !lot) {
      await client.query('commit');

      return {
        statusCode: 409,
        success: false,
        registrationId: '',
        paymentId: null,
        registrationStatus: 'cancelled',
        checkoutStatus: 'not_configured',
        checkoutUrl: null,
        message: distanceSold >= Number(distance.capacity)
          ? 'Vagas esgotadas para esta distancia.'
          : 'Nao ha lote configurado para novas inscricoes.',
      };
    }

    const now = new Date().toISOString();
    const registrationId = randomUUID();
    const paymentId = randomUUID();
    const amountCents = Number(lot.priceCents);

    await client.query(
      `insert into ${table.registrations} (id, event_id, distance_id, lot_id, cpf_hash, status, amount_cents, payload, created_at, updated_at, expires_at, paid_at, confirmed_at, confirmation_email_sent_at, confirmation_email_last_attempt_at, confirmation_email_provider, confirmation_email_id, confirmation_email_error)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, null, null, null, null, null, null, null)`,
      [registrationId, event.id, distance.id, lot.id, input.cpfHash, 'pending_payment', amountCents, input.payload, now, input.expiresAt],
    );
    await client.query(
      `insert into ${table.payments} (id, registration_id, provider, status, amount_cents, provider_payment_id, checkout_url, created_at, updated_at, expires_at, paid_at, gateway_status, gateway_transaction_id, gateway_payload)
       values ($1, $2, $3, $4, $5, null, null, $6, $6, $7, null, null, null, null)`,
      [paymentId, registrationId, input.paymentProvider || 'not_configured', 'pending_payment', amountCents, now, input.expiresAt],
    );
    await client.query(
      `update ${table.lots}
       set sold_count = sold_count + 1,
           status = case
             when continues_after_capacity then 'active'
             when sold_count + 1 >= capacity then 'sold_out'
             else 'active'
           end
       where id = $1`,
      [lot.id],
    );
    if (previousLot && previousLot.id !== lot.id) {
      await client.query(
        `insert into ${table.auditLogs} (id, actor, action, entity_type, entity_id, payload, created_at)
         values ($1, 'system', 'lot.changed', 'lot', $2, $3, $4)`,
        [randomUUID(), lot.id, {
          previousLotId: previousLot.id,
          previousLotName: previousLot.name,
          newLotId: lot.id,
          newLotName: lot.name,
          registrationNumber: eventPaid + 1,
          registrationId,
        }, now],
      );
    }
    await client.query('commit');

    return {
      statusCode: 201,
      success: true,
      registrationId,
      paymentId,
      registrationStatus: 'pending_payment',
      checkoutStatus: 'not_configured',
      checkoutUrl: null,
      expiresAt: input.expiresAt,
      message: input.paymentProvider === 'infinitepay'
        ? 'Inscricao criada. Redirecionando para o checkout InfinitePay.'
        : 'Inscricao pre-criada. Configure um adaptador de pagamento real para gerar checkout.',
      amountCents,
      description: input.description(distance.name, lot.name),
      shouldCreateCheckout: true,
    };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function attachCheckoutToPaymentInPostgres(input: {
  registrationId: string;
  providerPaymentId: string | null;
  checkoutUrl: string;
  raw: unknown;
}) {
  const client = await requirePool().connect();

  try {
    await ensurePostgresReady();

    await client.query('begin');
    const now = new Date().toISOString();
    const paymentResult = await client.query(
      `update ${table.payments}
       set provider = $1, provider_payment_id = $2, checkout_url = $3, updated_at = $4
       where registration_id = $5
       returning id`,
      ['infinitepay', input.providerPaymentId, input.checkoutUrl, now, input.registrationId],
    );
    const paymentId = paymentResult.rows[0]?.id || '';

    await client.query(
      `insert into ${table.paymentEvents} (id, payment_id, provider_event_id, event_type, payload, received_at)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (provider_event_id) do nothing`,
      [
        randomUUID(),
        paymentId,
        input.providerPaymentId || input.registrationId,
        'infinitepay.checkout_created',
        input.raw,
        now,
      ],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function confirmPaymentInPostgres(input: PaymentConfirmationInput): Promise<PaymentConfirmationResult> {
  const client = await requirePool().connect();
  const now = new Date().toISOString();

  try {
    await ensurePostgresReady();
    await client.query('begin');
    await client.query("select pg_advisory_xact_lock(hashtext('funpace-run-payment-confirmation'))");
    await client.query("set local lock_timeout = '5s'");
    await client.query("set local statement_timeout = '15s'");

    const result = await client.query(
      `select registration.id, registration.status, registration.amount_cents, registration.lot_id,
              payment.id as payment_id, payment.status as payment_status,
              payment.gateway_transaction_id as existing_gateway_transaction_id,
              lot.status as lot_status, lot.price_cents as lot_price_cents
       from ${table.registrations} registration
       join ${table.payments} payment on payment.registration_id = registration.id
       join ${table.lots} lot on lot.id = registration.lot_id
       where registration.id = $1
          or ($2 <> '' and payment.provider_payment_id = $2)
          or ($3 <> '' and (payment.gateway_transaction_id = $3 or payment.provider_payment_id = $3))
       limit 1
       for update of registration, payment`,
      [input.registrationId, input.providerPaymentId, input.providerTransactionId],
    );
    const row = result.rows[0];

    if (!row) {
      await client.query('rollback');
      return { statusCode: 404, error: 'not_found' };
    }

    if (input.amountCents !== null && Number(row.amount_cents) !== input.amountCents) {
      await client.query(
        `update ${table.payments}
         set gateway_status = 'amount_mismatch', gateway_transaction_id = coalesce(nullif($1, ''), gateway_transaction_id),
             gateway_payload = $2, updated_at = $3
         where id = $4`,
        [input.providerTransactionId, input.payload, now, row.payment_id],
      );
      await client.query('commit');
      return { statusCode: 409, registrationId: row.id, paymentId: row.payment_id, previousStatus: row.status, error: 'amount_mismatch' };
    }

    const duplicateEvent = input.providerEventId
      ? await client.query(`select 1 from ${table.paymentEvents} where provider_event_id = $1 limit 1`, [input.providerEventId])
      : { rowCount: 0 };
    const duplicate = Boolean(
      duplicateEvent.rowCount
      || (input.providerTransactionId && row.existing_gateway_transaction_id === input.providerTransactionId),
    );

    if (duplicate && row.status === 'paid' && row.payment_status === 'paid') {
      await client.query('commit');
      return { statusCode: 200, registrationId: row.id, paymentId: row.payment_id, previousStatus: row.status, duplicated: true };
    }
    const wasClosed = ['payment_failed', 'expired', 'cancelled', 'refunded'].includes(row.status);

    const bibResult = await client.query(
      `select lpad((coalesce(max(nullif(regexp_replace(bib_number, '\\D', '', 'g'), '')::int), 0) + 1)::text, 4, '0') as next_bib_number
       from ${table.registrations}
       where event_id = (select event_id from ${table.registrations} where id = $1)
         and bib_number is not null`,
      [row.id],
    );
    const nextBibNumber = String(bibResult.rows[0]?.next_bib_number || '0001');

    await client.query(
      `update ${table.registrations}
       set status = 'paid', updated_at = $1, expires_at = null,
           paid_at = coalesce(paid_at, $1), confirmed_at = coalesce(confirmed_at, $1),
           bib_number = coalesce(bib_number, $3)
       where id = $2`,
      [now, row.id, nextBibNumber],
    );
    await client.query(
      `update ${table.payments}
       set provider = 'infinitepay', status = 'paid', updated_at = $1, expires_at = null,
           paid_at = coalesce(paid_at, $1), provider_payment_id = coalesce(nullif($2, ''), provider_payment_id),
           gateway_transaction_id = coalesce(nullif($3, ''), gateway_transaction_id),
           gateway_status = $4, gateway_payload = $5
       where id = $6`,
      [now, input.providerPaymentId, input.providerTransactionId, input.gatewayStatus || 'paid', input.payload, row.payment_id],
    );
    if (wasClosed) {
      await client.query(
        `update ${table.lots} set sold_count = sold_count + 1,
           status = case
             when continues_after_capacity then 'active'
             when sold_count + 1 >= capacity then 'sold_out'
             else 'active'
           end where id = $1`,
        [row.lot_id],
      );
    }
    if (!duplicate) {
      await client.query(
        `insert into ${table.paymentEvents} (id, payment_id, provider_event_id, event_type, payload, received_at)
         values ($1, $2, $3, $4, $5, $6) on conflict (provider_event_id) do nothing`,
        [randomUUID(), row.payment_id, input.providerEventId || randomUUID(), input.eventType, input.payload, now],
      );
    }
    await client.query(
      `insert into ${table.auditLogs} (id, actor, action, entity_type, entity_id, payload, created_at)
       values ($1, $2, $3, 'registration', $4, $5, $6)`,
      [randomUUID(), input.actor || 'system', input.auditAction, row.id, {
        previousStatus: row.status,
        nextStatus: 'paid',
        providerEventId: input.providerEventId || null,
        providerPaymentId: input.providerPaymentId || null,
        providerTransactionId: input.providerTransactionId || null,
        ...(input.auditMetadata || {}),
      }, now],
    );
    await client.query('commit');
    return { statusCode: 200, registrationId: row.id, paymentId: row.payment_id, previousStatus: row.status, duplicated: duplicate };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function markPaymentCreationFailedInPostgres(registrationId: string) {
  const client = await requirePool().connect();

  try {
    await ensurePostgresReady();

    await client.query('begin');
    const now = new Date().toISOString();
    const registrationResult = await client.query(
      `update ${table.registrations}
       set status = $1, updated_at = $2
       where id = $3 and status = $4
       returning lot_id`,
      ['payment_failed', now, registrationId, 'pending_payment'],
    );
    const lotId = registrationResult.rows[0]?.lot_id;

    await client.query(
      `update ${table.payments} set status = $1, updated_at = $2 where registration_id = $3`,
      ['payment_failed', now, registrationId],
    );

    if (lotId) {
      await client.query(
        `update ${table.lots}
         set sold_count = greatest(sold_count - 1, 0),
             status = case
               when continues_after_capacity then 'active'
               when status = 'sold_out' and greatest(sold_count - 1, 0) < capacity then 'active'
               else status
             end
         where id = $1`,
        [lotId],
      );
    }

    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function upsertAdminBootstrapInPostgres(email: string, passwordHash: string) {
  const now = new Date().toISOString();
  await ensurePostgresReady();
  await requirePool().query(
    `insert into ${table.adminUsers} (id, email, password_hash, role, created_at, updated_at, last_login_at, disabled_at)
     values ($1, $2, $3, 'administrator', $4, $4, null, null)
     on conflict (email) do update set
       password_hash = excluded.password_hash,
       role = 'administrator',
       updated_at = excluded.updated_at,
       disabled_at = null`,
    [randomUUID(), email, passwordHash, now],
  );
}

export async function findAdminUserInPostgres(email: string): Promise<AdminUserRecord | null> {
  const result = await requirePool().query(
    `select id, email, password_hash, role, created_at, updated_at, last_login_at, disabled_at
     from ${table.adminUsers}
     where email = $1 and disabled_at is null
     limit 1`,
    [email],
  );
  const row = result.rows[0];
  return row ? {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
    disabledAt: row.disabled_at,
  } : null;
}

export async function createAdminSessionInPostgres(
  userId: string,
  session: AdminSessionRecord,
): Promise<AdminSessionRecord | null> {
  const client = await requirePool().connect();

  try {
    await client.query('begin');
    const userResult = await client.query(
      `update ${table.adminUsers}
       set last_login_at = $1, updated_at = $1
       where id = $2 and disabled_at is null
       returning email, role`,
      [session.createdAt, userId],
    );
    const user = userResult.rows[0];

    if (!user) {
      await client.query('rollback');
      return null;
    }

    await client.query(
      `insert into ${table.adminSessions} (id, actor, role, created_at, expires_at, revoked_at, ip_address, user_agent)
       values ($1, $2, $3, $4, $5, null, $6, $7)`,
      [session.id, user.email, user.role, session.createdAt, session.expiresAt, session.ipAddress, session.userAgent],
    );
    await client.query(
      `delete from ${table.adminSessions}
       where expires_at < $1 or (revoked_at is not null and revoked_at < $2)`,
      [session.createdAt, new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString()],
    );
    await client.query('commit');

    return { ...session, actor: user.email, role: user.role };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function findAdminSessionInPostgres(sessionId: string): Promise<AdminSessionRecord | null> {
  const result = await requirePool().query(
    `select id, actor, role, created_at, expires_at, revoked_at, ip_address, user_agent
     from ${table.adminSessions}
     where id = $1
     limit 1`,
    [sessionId],
  );
  const row = result.rows[0];
  return row ? {
    id: row.id,
    actor: row.actor,
    role: row.role,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
  } : null;
}

export async function revokeAdminSessionInPostgres(sessionId: string, revokedAt: string) {
  await requirePool().query(
    `update ${table.adminSessions}
     set revoked_at = coalesce(revoked_at, $1)
     where id = $2`,
    [revokedAt, sessionId],
  );
}

export type CancelRegistrationResult =
  | { status: 'cancelled'; previousStatus: RegistrationStatus }
  | { status: 'not_found' | 'already_closed' };

export async function cancelRegistrationInPostgres(input: {
  registrationId: string;
  actor: string;
  actorRole: string;
  reason: string;
  sessionId: string;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<CancelRegistrationResult> {
  const client = await requirePool().connect();

  try {
    await client.query('begin');
    const registrationResult = await client.query(
      `select status, lot_id from ${table.registrations} where id = $1 for update`,
      [input.registrationId],
    );
    const registration = registrationResult.rows[0];

    if (!registration) {
      await client.query('rollback');
      return { status: 'not_found' };
    }

    if (['cancelled', 'refunded'].includes(registration.status)) {
      await client.query('rollback');
      return { status: 'already_closed' };
    }

    const now = new Date().toISOString();
    await client.query(
      `update ${table.registrations}
       set status = 'cancelled', updated_at = $1, expires_at = null
       where id = $2`,
      [now, input.registrationId],
    );
    await client.query(
      `update ${table.payments}
       set status = 'cancelled', updated_at = $1, expires_at = null
       where registration_id = $2`,
      [now, input.registrationId],
    );

    if (['pending_payment', 'paid'].includes(registration.status)) {
      await client.query(
        `update ${table.lots}
         set sold_count = greatest(sold_count - 1, 0),
             status = case
               when continues_after_capacity then 'active'
               when status = 'sold_out' and greatest(sold_count - 1, 0) < capacity then 'active'
               else status
             end
         where id = $1`,
        [registration.lot_id],
      );
    }

    await client.query(
      `insert into ${table.auditLogs}
       (id, actor, actor_role, action, entity_type, entity_id, payload, session_id, ip_address, user_agent, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [randomUUID(), input.actor, input.actorRole, 'registration.cancel', 'registration', input.registrationId, {
        reason: input.reason,
        previousStatus: registration.status,
      }, input.sessionId, input.ipAddress, input.userAgent, now],
    );
    await client.query('commit');
    return { status: 'cancelled', previousStatus: registration.status };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function findPaymentMethod(value: unknown, depth = 0): string | null {
  if (!value || typeof value !== 'object' || depth > 4) return null;
  const record = value as Record<string, unknown>;
  for (const key of ['payment_method', 'paymentMethod', 'method', 'payment_type', 'paymentType', 'capture_method']) {
    if (typeof record[key] === 'string' && record[key].trim()) return record[key].trim();
  }
  for (const nested of Object.values(record)) {
    const found = findPaymentMethod(nested, depth + 1);
    if (found) return found;
  }
  return null;
}

export async function claimRegistrationEmailInPostgres(
  registrationId: string,
  provider: string,
  options: { force?: boolean } = {},
): Promise<RegistrationEmailDeliveryContext | null> {
  const client = await requirePool().connect();

  try {
    await ensurePostgresReady();
    await client.query('begin');

    const result = await client.query(
      `select registration.*, event.name as event_name, event.slug as event_slug,
              event.status as event_status, event.date as event_date, event.start_time,
              event.location_name, event.city as event_city, event.state as event_state,
              distance.name as distance_name,
              lot.name as lot_name, lot.price_cents as lot_price_cents,
              lot.capacity as lot_capacity, lot.sold_count as lot_sold_count,
              lot.status as lot_status, lot.starts_at, lot.ends_at, lot.order_index, lot.continues_after_capacity,
              payment.gateway_payload, payment.gateway_status
       from ${table.registrations} registration
       join ${table.events} event on event.id = registration.event_id
       join ${table.distances} distance on distance.id = registration.distance_id
       left join ${table.lots} lot on lot.id = registration.lot_id
       left join ${table.payments} payment on payment.registration_id = registration.id
       where registration.id = $1
       for update of registration`,
      [registrationId],
    );
    const row = result.rows[0];

    if (!row || row.status !== 'paid') {
      await client.query('commit');
      return null;
    }

    const recentAttempt = row.confirmation_email_last_attempt_at
      && Date.now() - new Date(row.confirmation_email_last_attempt_at).getTime() < 5 * 60_000;

    if (!options.force && (row.confirmation_email_sent_at || recentAttempt)) {
      await client.query('commit');
      return null;
    }

    const attemptedAt = new Date().toISOString();
    const deliveryKey = options.force
      ? `confirmation/${registrationId}/${randomUUID()}`
      : `confirmation/${registrationId}`;

    await client.query(
      `update ${table.registrations} set confirmation_email_last_attempt_at = $1 where id = $2`,
      [attemptedAt, registrationId],
    );
    await client.query(
      `insert into ${table.auditLogs} (id, actor, action, entity_type, entity_id, payload, created_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [randomUUID(), 'system', 'email.confirmation.attempted', 'registration', registrationId, {
        provider,
        email: row.payload.email,
        deliveryKey,
      }, attemptedAt],
    );
    await client.query('commit');

    return {
      registration: {
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
        expiresAt: row.expires_at,
        paidAt: row.paid_at,
        confirmedAt: row.confirmed_at,
        bibNumber: row.bib_number,
        confirmationEmailSentAt: row.confirmation_email_sent_at,
        confirmationEmailLastAttemptAt: attemptedAt,
        confirmationEmailProvider: row.confirmation_email_provider,
        confirmationEmailId: row.confirmation_email_id,
        confirmationEmailError: row.confirmation_email_error,
      },
      event: {
        id: row.event_id,
        name: row.event_name,
        slug: row.event_slug,
        status: row.event_status,
        date: row.event_date,
        startTime: row.start_time,
        locationName: row.location_name,
        city: row.event_city,
        state: row.event_state,
      },
      distanceName: row.distance_name,
      lot: row.lot_name ? {
        id: row.lot_id,
        eventId: row.event_id,
        name: row.lot_name,
        priceCents: row.lot_price_cents,
        capacity: row.lot_capacity,
        soldCount: row.lot_sold_count,
        status: row.lot_status,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        orderIndex: Number(row.order_index || 0),
        continuesAfterCapacity: Boolean(row.continues_after_capacity),
      } : null,
      paymentMethod: findPaymentMethod(row.gateway_payload) || row.gateway_status || null,
      deliveryKey,
    };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function completeRegistrationEmailInPostgres(
  registrationId: string,
  result: RegistrationEmailDeliveryResult,
) {
  const client = await requirePool().connect();
  const completedAt = new Date().toISOString();

  try {
    await ensurePostgresReady();
    await client.query('begin');
    await client.query(
      `update ${table.registrations}
       set confirmation_email_sent_at = case when $1 then $2 else confirmation_email_sent_at end,
           confirmation_email_provider = $3,
           confirmation_email_id = case when $1 then $4 else confirmation_email_id end,
           confirmation_email_error = case when $1 then null else $5 end
       where id = $6`,
      [result.ok, completedAt, result.provider, result.providerMessageId || null, result.error || 'Email send failed', registrationId],
    );
    await client.query(
      `insert into ${table.auditLogs} (id, actor, action, entity_type, entity_id, payload, created_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [randomUUID(), 'system', result.ok ? 'email.confirmation.sent' : 'email.confirmation.failed', 'registration', registrationId, {
        provider: result.provider,
        providerMessageId: result.providerMessageId || null,
        error: result.ok ? null : result.error || 'Email send failed',
      }, completedAt],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function enqueueGoogleSheetSync(input: GoogleSheetSyncInput): Promise<GoogleSheetSyncRecord> {
  const now = new Date().toISOString();

  if (!shouldUsePostgres()) {
    return transaction((database) => {
      const existing = database.googleSheetSyncs.find((item) => (
        item.entityType === input.entityType
        && item.entityId === input.entityId
        && item.sheetName === input.sheetName
      ));

      if (existing) {
        existing.operation = input.operation;
        existing.status = 'pending';
        existing.synchronizedAt = null;
        existing.lastError = null;
        existing.updatedAt = now;
        return existing;
      }

      const created: GoogleSheetSyncRecord = {
        id: randomUUID(),
        ...input,
        status: 'pending',
        rowNumber: null,
        attempts: 0,
        lastAttemptAt: null,
        synchronizedAt: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      };
      database.googleSheetSyncs.push(created);
      return created;
    });
  }

  await ensurePostgresReady();
  const result = await requirePool().query(
    `insert into ${table.googleSheetSyncs} (id, entity_type, entity_id, sheet_name, operation, status, row_number, attempts, last_attempt_at, synchronized_at, last_error, created_at, updated_at)
     values ($1, $2, $3, $4, $5, 'pending', null, 0, null, null, null, $6, $6)
     on conflict (entity_type, entity_id, sheet_name) do update set
       operation = excluded.operation,
       status = 'pending',
       synchronized_at = null,
       last_error = null,
       updated_at = excluded.updated_at
     returning id, entity_type, entity_id, sheet_name, operation, status, row_number, attempts, last_attempt_at, synchronized_at, last_error, created_at, updated_at`,
    [randomUUID(), input.entityType, input.entityId, input.sheetName, input.operation, now],
  );
  return mapGoogleSheetSyncRow(result.rows[0]);
}

export async function claimGoogleSheetSync(syncId: string): Promise<GoogleSheetSyncRecord | null> {
  const now = new Date().toISOString();

  if (!shouldUsePostgres()) {
    return transaction((database) => {
      const item = database.googleSheetSyncs.find((candidate) => candidate.id === syncId);
      if (!item || !['pending', 'failed'].includes(item.status)) return null;
      item.status = 'processing';
      item.attempts += 1;
      item.lastAttemptAt = now;
      item.updatedAt = now;
      return item;
    });
  }

  await ensurePostgresReady();
  const result = await requirePool().query(
    `update ${table.googleSheetSyncs}
     set status = 'processing', attempts = attempts + 1, last_attempt_at = $1, updated_at = $1
     where id = $2 and status in ('pending', 'failed')
     returning id, entity_type, entity_id, sheet_name, operation, status, row_number, attempts, last_attempt_at, synchronized_at, last_error, created_at, updated_at`,
    [now, syncId],
  );
  return result.rows[0] ? mapGoogleSheetSyncRow(result.rows[0]) : null;
}

export async function completeGoogleSheetSync(syncId: string, rowNumber: number | null): Promise<void> {
  const now = new Date().toISOString();

  if (!shouldUsePostgres()) {
    await transaction((database) => {
      const item = database.googleSheetSyncs.find((candidate) => candidate.id === syncId);
      if (!item) return;
      item.status = 'synchronized';
      item.rowNumber = rowNumber ?? item.rowNumber;
      item.synchronizedAt = now;
      item.lastError = null;
      item.updatedAt = now;
    });
    return;
  }

  await ensurePostgresReady();
  await requirePool().query(
    `update ${table.googleSheetSyncs}
     set status = 'synchronized', row_number = coalesce($1, row_number), synchronized_at = $2, last_error = null, updated_at = $2
     where id = $3`,
    [rowNumber, now, syncId],
  );
}

export async function failGoogleSheetSync(syncId: string, error: unknown): Promise<void> {
  const now = new Date().toISOString();
  const safeError = (error instanceof Error ? error.message : String(error || 'Unknown error')).slice(0, 500);

  if (!shouldUsePostgres()) {
    await transaction((database) => {
      const item = database.googleSheetSyncs.find((candidate) => candidate.id === syncId);
      if (!item) return;
      item.status = 'failed';
      item.lastError = safeError;
      item.updatedAt = now;
    });
    return;
  }

  await ensurePostgresReady();
  await requirePool().query(
    `update ${table.googleSheetSyncs} set status = 'failed', last_error = $1, updated_at = $2 where id = $3`,
    [safeError, now, syncId],
  );
}

export function getDatabaseConfigurationIssue() {
  if (shouldUsePostgres() && !databaseUrl) {
    return 'DATABASE_URL deve estar configurado quando DATABASE_PROVIDER usa Postgres/Supabase.';
  }

  if (process.env.VERCEL && !shouldUsePostgres()) {
    return 'Banco JSON local nao deve ser usado em ambiente serverless. Configure DATABASE_PROVIDER=supabase e DATABASE_URL.';
  }

  return null;
}

export function getDatabaseRuntimeConfig() {
  return {
    provider: databaseProvider,
    urlConfigured: Boolean(databaseUrl),
    autoMigrate: databaseAutoMigrate,
    configurationIssue: getDatabaseConfigurationIssue(),
  };
}

export async function transaction<Result>(
  operation: (database: Database) => Result | Promise<Result>,
  options: { persist?: boolean; scope?: DatabaseReadScope } = {},
) {
  const configurationIssue = getDatabaseConfigurationIssue();
  const shouldPersist = options.persist !== false;

  if (configurationIssue) {
    throw new Error(configurationIssue);
  }

  if (!shouldUsePostgres()) {
    const database = readJsonDatabase();
    const result = await operation(database);

    if (shouldPersist) {
      writeJsonDatabase(database);
    }

    return result;
  }

  const client = await requirePool().connect();

  try {
    if (shouldPersist) {
      await ensurePostgresReady();
    }

    await client.query('begin');
    if (shouldPersist) {
      await client.query("select pg_advisory_xact_lock(hashtext('funpace-run-write'))");
    }

    const database = await readPostgresDatabase(client, options.scope);
    const result = await operation(database);

    if (shouldPersist) {
      await savePostgresDatabase(client, database);
    }

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
  const configurationIssue = getDatabaseConfigurationIssue();

  if (configurationIssue) {
    throw new Error(configurationIssue);
  }

  if (!shouldUsePostgres()) {
    return readJsonDatabase();
  }

  return readPostgresDatabase(requirePool());
}

export async function pingDatabase() {
  const configurationIssue = getDatabaseConfigurationIssue();

  if (configurationIssue) {
    return {
      provider: databaseProvider,
      ok: false,
      issue: configurationIssue,
    };
  }

  if (!shouldUsePostgres()) {
    ensureJsonDatabase();
    return { provider: 'json', ok: true };
  }

  const client = await requirePool().connect();

  try {
    await client.query('select 1');
    return { provider: databaseProvider, ok: true };
  } finally {
    client.release();
  }
}

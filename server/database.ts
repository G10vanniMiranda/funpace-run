import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import type { CreateRegistrationResponse, RegistrationFormData, RegistrationStatus } from '../src/types/registration';
import type { MetaServerEvent, MetaUserData, MetaCustomData } from './meta-conversions-api.js';
import { selectAvailableLotCandidate } from './lot-capacity.js';
import { calculatePartnerPricing } from './partner-discount.js';
import { assertDatabaseEnvironmentIsolation } from './environment.js';

const { Pool } = pg;

if (!process.env.VERCEL && existsSync(resolve('.env'))) {
  loadEnvFile(resolve('.env'));
}

assertDatabaseEnvironmentIsolation();

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
  marketingConsent?: boolean;
  marketingConsentUpdatedAt?: string | null;
  expiresAt?: string | null;
  paidAt?: string | null;
  confirmedAt?: string | null;
  bibNumber?: string | null;
  confirmationEmailSentAt?: string | null;
  confirmationEmailLastAttemptAt?: string | null;
  confirmationEmailProvider?: string | null;
  confirmationEmailId?: string | null;
  confirmationEmailError?: string | null;
  partnerId?: string | null;
  partnerName?: string | null;
  partnerType?: PartnerType | null;
  partnerLink?: string | null;
  partnerIdentifiedAt?: string | null;
  discountPercentage?: number;
  discountAmountCents?: number;
  originalPriceCents?: number;
  finalPriceCents?: number;
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

export type IntegrationEventStatus = 'pending' | 'processing' | 'sent' | 'failed';

export type IntegrationEventRecord = {
  id: string;
  provider: 'meta';
  eventName: MetaServerEvent['event_name'];
  eventId: string;
  entityType: 'registration';
  entityId: string;
  eventTime: number;
  eventSourceUrl: string;
  userData: MetaUserData;
  clientContext: MetaUserData;
  customData: MetaCustomData;
  status: IntegrationEventStatus;
  attemptCount: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  responseCode: number | null;
  eventsReceived: number | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GoogleSheetSyncRecord = {
  id: string;
  entityType: 'registration' | 'payment' | 'check_in' | 'shirt_summary' | 'lot_summary' | 'alert' | 'partnership' | 'email';
  entityId: string;
  sheetName: 'registrations' | 'payments' | 'shirts' | 'check_in' | 'lots' | 'alerts' | 'partnerships' | 'emails';
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

export type PartnerStatus = 'active' | 'inactive';
export type PartnerType = 'sports_advisory' | 'influencer';

export type PartnerRecord = {
  id: string;
  name: string;
  slug: string;
  partnerType: PartnerType;
  discountPercentage: number;
  athleteLimit: number | null;
  status: PartnerStatus;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
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
  partners: PartnerRecord[];
};

export type PendingRegistrationInput = {
  payload: RegistrationFormData;
  cpfHash: string;
  paymentProvider: string;
  expiresAt: string;
  description: (distanceName: string, lotName: string) => string;
  partnerId?: string | null;
  partnerSlug?: string | null;
  partnerType?: PartnerType | null;
  correlationId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  accessAuditId?: string | null;
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
  | 'partnerships'
  | 'partners';

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
  partners: '"run-partners"',
  partnerAuditLogs: '"run-partner-audit-logs"',
  reconciliationRuns: '"run-reconciliation-runs"',
  paymentReconciliations: '"run-payment-reconciliations"',
  operationalAlerts: '"run-operational-alerts"',
  integrationEvents: '"run-integration-events"',
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
  partners: [],
};

const configuredDatabasePoolMax = Number.parseInt(process.env.DATABASE_POOL_MAX || '5', 10);
const databasePoolMax = Number.isInteger(configuredDatabasePoolMax) && configuredDatabasePoolMax > 0
  ? configuredDatabasePoolMax
  : 5;

const pool = databaseUrl
  ? new Pool({
    connectionString: databaseUrl,
    ssl: databaseSsl ? { rejectUnauthorized: false } : false,
    max: databasePoolMax,
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
    partners: (database.partners || []).map((partner) => ({
      ...partner,
      athleteLimit: partner.athleteLimit ?? null,
    })),
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
      marketing_consent boolean not null default false,
      marketing_consent_updated_at text,
      expires_at text,
      paid_at text,
      confirmed_at text,
      confirmation_email_sent_at text,
      confirmation_email_last_attempt_at text,
      confirmation_email_provider text,
      confirmation_email_id text,
      confirmation_email_error text,
      pending_email_sent_at text,
      pending_email_last_attempt_at text,
      bib_number text,
      partner_id uuid,
      partner_name text,
      partner_type text,
      partner_link text,
      partner_identified_at text,
      discount_percentage numeric(5, 2) not null default 0,
      discount_amount integer not null default 0,
      original_price integer not null,
      final_price integer not null
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
      entity_type text not null check (entity_type in ('registration', 'payment', 'check_in', 'shirt_summary', 'lot_summary', 'alert', 'partnership', 'email')),
      entity_id text not null,
      sheet_name text not null check (sheet_name in ('registrations', 'payments', 'shirts', 'check_in', 'lots', 'alerts', 'partnerships', 'emails')),
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

    create table if not exists ${table.integrationEvents} (
      id text primary key,
      provider text not null check (provider in ('meta')),
      event_name text not null check (event_name in ('InitiateCheckout', 'CompleteRegistration', 'Purchase')),
      event_id text not null,
      entity_type text not null check (entity_type in ('registration')),
      entity_id text not null references ${table.registrations}(id),
      event_time bigint not null,
      event_source_url text not null,
      user_data jsonb not null default '{}'::jsonb,
      client_context jsonb not null default '{}'::jsonb,
      custom_data jsonb not null default '{}'::jsonb,
      status text not null check (status in ('pending', 'processing', 'sent', 'failed')),
      attempt_count integer not null default 0,
      next_attempt_at text,
      last_attempt_at text,
      last_error text,
      response_code integer,
      events_received integer,
      sent_at text,
      created_at text not null,
      updated_at text not null,
      unique (provider, event_name, event_id)
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

    create table if not exists ${table.partners} (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      slug text not null,
      partner_type text not null default 'sports_advisory',
      discount_percentage numeric(5, 2) not null,
      athlete_limit integer,
      status text not null default 'active',
      description text,
      created_at text not null default (now()::text),
      updated_at text not null default (now()::text),
      deleted_at text,
      constraint "run-partners_slug_key" unique (slug),
      constraint "run-partners_partner_type_check" check (partner_type in ('sports_advisory', 'influencer')),
      constraint "run-partners_discount_percentage_check" check (discount_percentage > 0 and discount_percentage < 100),
      constraint "run-partners_athlete_limit_check" check (athlete_limit is null or athlete_limit > 0),
      constraint "run-partners_status_check" check (status in ('active', 'inactive'))
    );

    create table if not exists ${table.partnerAuditLogs} (
      id uuid primary key default gen_random_uuid(),
      partner_id uuid references ${table.partners}(id),
      action text not null,
      user_id text,
      registration_id text references ${table.registrations}(id),
      event_id text references ${table.events}(id),
      old_data jsonb,
      new_data jsonb,
      metadata jsonb not null default '{}'::jsonb,
      ip_address text,
      user_agent text,
      created_at text not null default (now()::text)
    );

    create table if not exists ${table.reconciliationRuns} (
      id text primary key,
      trigger_source text not null,
      mode text not null check (mode in ('dry_run', 'apply')),
      status text not null check (status in ('running', 'completed', 'failed')),
      checked_count integer not null default 0,
      corrected_count integer not null default 0,
      manual_review_count integer not null default 0,
      error_count integer not null default 0,
      summary jsonb not null default '{}'::jsonb,
      started_at text not null,
      completed_at text,
      created_by text not null
    );

    create table if not exists ${table.paymentReconciliations} (
      id text primary key,
      run_id text references ${table.reconciliationRuns}(id),
      issue_key text not null unique,
      issue_code text not null,
      severity text not null check (severity in ('info', 'warning', 'critical')),
      resolution_status text not null check (resolution_status in ('consistent', 'automatically_corrected', 'manual_review_required', 'resolved')),
      registration_id text references ${table.registrations}(id),
      payment_id text references ${table.payments}(id),
      gateway_transaction_id text,
      expected_amount_cents integer,
      gateway_amount_cents integer,
      details jsonb not null default '{}'::jsonb,
      first_detected_at text not null,
      last_detected_at text not null,
      resolved_at text,
      resolved_by text,
      resolution_notes text
    );

    create table if not exists ${table.operationalAlerts} (
      id text primary key,
      dedupe_key text not null unique,
      severity text not null check (severity in ('info', 'warning', 'critical')),
      alert_type text not null,
      title text not null,
      message text not null,
      entity_type text,
      entity_id text,
      payload jsonb not null default '{}'::jsonb,
      status text not null check (status in ('open', 'acknowledged', 'resolved')),
      detected_at text not null,
      acknowledged_at text,
      acknowledged_by text,
      resolved_at text
    );

    create index if not exists "run-registrations_cpf_hash_idx" on ${table.registrations}(cpf_hash);
    create index if not exists "run-registrations_status_idx" on ${table.registrations}(status);
    create index if not exists "run-registrations_partner_id_idx" on ${table.registrations}(partner_id) where partner_id is not null;
    create index if not exists "run-registrations_partner_type_status_created_idx" on ${table.registrations}(partner_type,status,created_at desc) where partner_id is not null;
    create index if not exists "run-payments_registration_id_idx" on ${table.payments}(registration_id);
    create index if not exists "run-payments_status_updated_idx" on ${table.payments}(status, updated_at desc);
    create index if not exists "run-payment-events_payment_received_idx" on ${table.paymentEvents}(payment_id, received_at asc);
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
    create index if not exists "run-partners_status_idx" on ${table.partners}(status);
    create index if not exists "run-partners_deleted_at_idx" on ${table.partners}(deleted_at) where deleted_at is null;
    create index if not exists "run-partner-audit_partner_created_idx" on ${table.partnerAuditLogs}(partner_id, created_at desc);
    create index if not exists "run-partner-audit_registration_created_idx" on ${table.partnerAuditLogs}(registration_id, created_at asc);
    create index if not exists "run-partner-audit_action_created_idx" on ${table.partnerAuditLogs}(action, created_at desc);
    create index if not exists "run-partner-audit_correlation_idx" on ${table.partnerAuditLogs}((metadata->>'correlationId')) where coalesce(metadata->>'correlationId','')<>'';
    create index if not exists "run-reconciliation-runs_started_idx" on ${table.reconciliationRuns}(started_at desc);
    create index if not exists "run-payment-reconciliations_status_idx" on ${table.paymentReconciliations}(resolution_status, severity);
    create index if not exists "run-operational-alerts_status_idx" on ${table.operationalAlerts}(status, severity, detected_at desc);
  `);

  await client.query(`alter table ${table.partners} add column if not exists partner_type text`);
  await client.query(`update ${table.partners} set partner_type = 'sports_advisory' where partner_type is null or btrim(partner_type) = ''`);
  await client.query(`alter table ${table.partners} alter column partner_type set default 'sports_advisory'`);
  await client.query(`alter table ${table.partners} alter column partner_type set not null`);
  await client.query(`alter table ${table.partners} drop constraint if exists "run-partners_partner_type_check"`);
  await client.query(`alter table ${table.partners} add constraint "run-partners_partner_type_check" check (partner_type in ('sports_advisory', 'influencer'))`);
  await client.query(`alter table ${table.partners} drop constraint if exists "run-partners_discount_percentage_check"`);
  await client.query(`alter table ${table.partners} add constraint "run-partners_discount_percentage_check" check (discount_percentage > 0 and discount_percentage < 100)`);
  await client.query(`alter table ${table.partners} add column if not exists athlete_limit integer`);
  await client.query(`alter table ${table.partners} drop constraint if exists "run-partners_athlete_limit_check"`);
  await client.query(`alter table ${table.partners} add constraint "run-partners_athlete_limit_check" check (athlete_limit is null or athlete_limit > 0)`);
  await client.query(`create index if not exists "run-partners_type_status_idx" on ${table.partners}(partner_type, status) where deleted_at is null`);
  await client.query(`alter table ${table.registrations} add column if not exists expires_at text`);
  await client.query(`alter table ${table.registrations} add column if not exists paid_at text`);
  await client.query(`alter table ${table.registrations} add column if not exists confirmed_at text`);
  await client.query(`alter table ${table.registrations} add column if not exists confirmation_email_sent_at text`);
  await client.query(`alter table ${table.registrations} add column if not exists confirmation_email_last_attempt_at text`);
  await client.query(`alter table ${table.registrations} add column if not exists confirmation_email_provider text`);
  await client.query(`alter table ${table.registrations} add column if not exists confirmation_email_id text`);
  await client.query(`alter table ${table.registrations} add column if not exists confirmation_email_error text`);
  await client.query(`alter table ${table.registrations} add column if not exists pending_email_sent_at text`);
  await client.query(`alter table ${table.registrations} add column if not exists pending_email_last_attempt_at text`);
  await client.query(`alter table ${table.registrations} add column if not exists bib_number text`);
  await client.query(`alter table ${table.registrations} add column if not exists partner_id uuid`);
  await client.query(`alter table ${table.registrations} add column if not exists partner_name text`);
  await client.query(`alter table ${table.registrations} add column if not exists partner_type text`);
  await client.query(`alter table ${table.registrations} add column if not exists partner_link text`);
  await client.query(`alter table ${table.registrations} add column if not exists partner_identified_at text`);
  await client.query(`alter table ${table.registrations} add column if not exists discount_percentage numeric(5, 2) default 0`);
  await client.query(`alter table ${table.registrations} add column if not exists discount_amount integer default 0`);
  await client.query(`alter table ${table.registrations} add column if not exists original_price integer`);
  await client.query(`alter table ${table.registrations} add column if not exists final_price integer`);
  await client.query(`update ${table.registrations} registration set partner_type = partner.partner_type from ${table.partners} partner where registration.partner_id = partner.id and registration.partner_type is null`);
  await client.query(`update ${table.registrations} set discount_percentage = coalesce(discount_percentage, 0), discount_amount = coalesce(discount_amount, 0), original_price = coalesce(original_price, amount_cents), final_price = coalesce(final_price, amount_cents)`);
  await client.query(`alter table ${table.registrations} alter column discount_percentage set not null`);
  await client.query(`alter table ${table.registrations} alter column discount_amount set not null`);
  await client.query(`alter table ${table.registrations} alter column original_price set not null`);
  await client.query(`alter table ${table.registrations} alter column final_price set not null`);
  await client.query(`
    do $$ begin
      if not exists (select 1 from pg_constraint where conname = 'run-registrations_partner_id_fkey') then
        alter table "run-registrations" add constraint "run-registrations_partner_id_fkey" foreign key (partner_id) references "run-partners"(id);
      end if;
      if not exists (select 1 from pg_constraint where conname = 'run-registrations_partner_pricing_check') then
        alter table "run-registrations" add constraint "run-registrations_partner_pricing_check" check (original_price > 0 and final_price > 0 and discount_amount >= 0 and discount_percentage >= 0 and discount_percentage < 100 and original_price - discount_amount = final_price and amount_cents = final_price);
      end if;
    end $$;
    alter table "run-registrations" drop constraint if exists "run-registrations_partner_type_check";
    alter table "run-registrations" add constraint "run-registrations_partner_type_check" check (partner_type is null or partner_type in ('sports_advisory', 'influencer'));
    alter table "run-registrations" drop constraint if exists "run-registrations_partner_metadata_check";
    alter table "run-registrations" add constraint "run-registrations_partner_metadata_check" check ((partner_id is null and partner_name is null and partner_type is null and discount_percentage = 0 and discount_amount = 0) or (partner_id is not null and partner_name is not null and partner_type is not null and discount_percentage > 0 and discount_amount > 0));
    create or replace function public.run_registration_pricing_defaults() returns trigger language plpgsql set search_path = public as $$ begin new.discount_percentage := coalesce(new.discount_percentage, 0); new.discount_amount := coalesce(new.discount_amount, 0); new.original_price := coalesce(new.original_price, new.amount_cents); new.final_price := coalesce(new.final_price, new.amount_cents); return new; end; $$;
    drop trigger if exists "run-registrations_pricing_defaults" on "run-registrations";
    create trigger "run-registrations_pricing_defaults" before insert on "run-registrations" for each row execute function public.run_registration_pricing_defaults();
    create or replace function public.protect_confirmed_partner_snapshot() returns trigger language plpgsql set search_path = public as $$ begin if old.confirmed_at is not null and (new.partner_id is distinct from old.partner_id or new.partner_name is distinct from old.partner_name or new.partner_type is distinct from old.partner_type or new.partner_link is distinct from old.partner_link or new.partner_identified_at is distinct from old.partner_identified_at or new.discount_percentage is distinct from old.discount_percentage or new.discount_amount is distinct from old.discount_amount or new.original_price is distinct from old.original_price or new.final_price is distinct from old.final_price) then raise exception 'confirmed partner snapshot is immutable'; end if; return new; end; $$;
    drop trigger if exists "run-registrations_partner_snapshot_immutable" on "run-registrations";
    create trigger "run-registrations_partner_snapshot_immutable" before update on "run-registrations" for each row execute function public.protect_confirmed_partner_snapshot();
  `);
  await client.query(`create unique index if not exists "run-registrations_event_bib_idx" on ${table.registrations}(event_id, bib_number) where bib_number is not null`);
  await client.query(`alter table ${table.lots} add column if not exists order_index integer not null default 0`);
  await client.query(`alter table ${table.lots} add column if not exists continues_after_capacity boolean not null default false`);
  await client.query(`alter table ${table.partners} add column if not exists deleted_at text`);
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
  await client.query(`alter table ${table.registrations} add column if not exists marketing_consent boolean not null default false`);
  await client.query(`alter table ${table.registrations} add column if not exists marketing_consent_updated_at text`);
  await client.query(`create index if not exists "run-integration-events_retry_idx" on ${table.integrationEvents}(status, next_attempt_at)`);
  await client.query(`create index if not exists "run-integration-events_entity_idx" on ${table.integrationEvents}(entity_type, entity_id, created_at)`);

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

async function expireTemporaryReservations(client: Queryable, now: string) {
  const expired = await client.query(
    `update ${table.registrations} registration
     set status = 'expired', updated_at = $1
     from ${table.payments} payment
     where payment.registration_id = registration.id
       and registration.status = 'pending_payment'
       and registration.expires_at is not null
       and registration.expires_at::timestamptz <= $1::timestamptz
       and payment.status <> 'paid'
       and payment.paid_at is null
     returning registration.id, registration.lot_id, registration.partner_id, registration.partner_type,
               registration.event_id, registration.amount_cents, registration.final_price`,
    [now],
  );
  if (expired.rows.length) {
    const ids = expired.rows.map((row) => String(row.id));
    await client.query(
      `update ${table.payments}
       set status = 'expired', updated_at = $1
       where registration_id = any($2::text[]) and status <> 'paid' and paid_at is null`,
      [now, ids],
    );
    for (const row of expired.rows) {
      await client.query(
        `insert into ${table.auditLogs} (id, actor, action, entity_type, entity_id, payload, created_at)
         values ($1, 'system', 'lot.reservation.expired', 'registration', $2, $3, $4)`,
        [randomUUID(), row.id, { lotId: row.lot_id, releasedAt: now }, now],
      );
      await client.query(
        `insert into ${table.operationalAlerts}
         (id, dedupe_key, severity, alert_type, title, message, entity_type, entity_id, payload, status, detected_at)
         values ($1,$2,'info','checkout_expired','Checkout expirado','A reserva temporária foi liberada automaticamente.','registration',$3,$4,'open',$5)
         on conflict (dedupe_key) do nothing`,
        [randomUUID(), `checkout-expired:${row.id}`, row.id, { lotId: row.lot_id, releasedAt: now }, now],
      );
      if (row.partner_id) {
        await insertPartnerAudit(client, {
          partnerId: row.partner_id,
          action: 'payment.expired',
          registrationId: row.id,
          eventId: row.event_id,
          oldData: { status: 'pending_payment' },
          newData: { status: 'expired' },
          metadata: {
            partnerType: row.partner_type,
            partner_type: row.partner_type,
            expectedAmountCents: Number(row.amount_cents),
            finalPriceCents: Number(row.final_price),
          },
          createdAt: now,
        });
      }
    }
  }
  return expired.rows.length;
}

export async function expireTemporaryReservationsInPostgres() {
  const client = await requirePool().connect();
  try {
    await ensurePostgresReady();
    await client.query('begin');
    await client.query("select pg_advisory_xact_lock(hashtext('funpace-run-registration-lot'))");
    const expiredCount = await expireTemporaryReservations(client, new Date().toISOString());
    await client.query('commit');
    return expiredCount;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
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
      partners: [],
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
    partners: ['all', 'partners', 'availability', 'checkout'].includes(scope),
  };
  const emptyRows = { rows: [] };
  // node-postgres serializes a client; issuing Promise.all on one client is
  // deprecated and can leave request completion detached from query completion.
  const events = include.events ? await client.query(`select id, name, slug, status, date, start_time, location_name, city, state from ${table.events}`) : emptyRows;
  const distances = include.distances ? await client.query(`select id, event_id, name, distance_km, capacity, status from ${table.distances}`) : emptyRows;
  const lots = include.lots ? await client.query(`select id, event_id, name, price_cents, capacity, sold_count, status, starts_at, ends_at, order_index, continues_after_capacity from ${table.lots}`) : emptyRows;
  const registrations = include.registrations ? await client.query(`select id, event_id, distance_id, lot_id, cpf_hash, status, amount_cents, payload, created_at, updated_at, marketing_consent, marketing_consent_updated_at, expires_at, paid_at, confirmed_at, confirmation_email_sent_at, confirmation_email_last_attempt_at, confirmation_email_provider, confirmation_email_id, confirmation_email_error, bib_number, partner_id, partner_name, partner_type, partner_link, partner_identified_at, discount_percentage, discount_amount, original_price, final_price from ${table.registrations}`) : emptyRows;
  const payments = include.payments ? await client.query(`select id, registration_id, provider, status, amount_cents, provider_payment_id, checkout_url, created_at, updated_at, expires_at, paid_at, gateway_status, gateway_transaction_id, gateway_payload from ${table.payments}`) : emptyRows;
  const paymentEvents = include.paymentEvents ? await client.query(`select id, payment_id, provider_event_id, event_type, payload, received_at from ${table.paymentEvents}`) : emptyRows;
  const googleSheetSyncs = include.googleSheetSyncs ? await client.query(`select id, entity_type, entity_id, sheet_name, operation, status, row_number, attempts, last_attempt_at, synchronized_at, last_error, created_at, updated_at from ${table.googleSheetSyncs}`) : emptyRows;
  const checkIns = include.checkIns ? await client.query(`select id, registration_id, status, checked_in_at, checked_in_by, notes from ${table.checkIns}`) : emptyRows;
  const kitDeliveries = include.kitDeliveries ? await client.query(`select id, registration_id, status, delivered_at, delivered_by, notes from ${table.kitDeliveries}`) : emptyRows;
  const auditLogs = include.auditLogs ? await client.query(`select id, actor, actor_role, action, entity_type, entity_id, payload, session_id, ip_address, user_agent, created_at from ${table.auditLogs}`) : emptyRows;
  const adminSessions = include.adminSessions ? await client.query(`select id, actor, role, created_at, expires_at, revoked_at, ip_address, user_agent from ${table.adminSessions}`) : emptyRows;
  const adminUsers = include.adminUsers ? await client.query(`select id, email, password_hash, role, created_at, updated_at, last_login_at, disabled_at from ${table.adminUsers}`) : emptyRows;
  const partnershipLeads = include.partnershipLeads ? await client.query(`select id, company_name, contact_name, contact_role, corporate_email, involvement_message, status, source, created_at, updated_at from ${table.partnershipLeads}`) : emptyRows;
  const partners = include.partners ? await client.query(`select id, name, slug, partner_type, discount_percentage, athlete_limit, status, description, created_at, updated_at, deleted_at from ${table.partners}`) : emptyRows;

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
      marketingConsent: row.marketing_consent === true,
      marketingConsentUpdatedAt: row.marketing_consent_updated_at,
      expiresAt: row.expires_at,
      paidAt: row.paid_at,
      confirmedAt: row.confirmed_at,
      confirmationEmailSentAt: row.confirmation_email_sent_at,
      confirmationEmailLastAttemptAt: row.confirmation_email_last_attempt_at,
      confirmationEmailProvider: row.confirmation_email_provider,
      confirmationEmailId: row.confirmation_email_id,
      confirmationEmailError: row.confirmation_email_error,
      bibNumber: row.bib_number,
      partnerId: row.partner_id,
      partnerName: row.partner_name,
      partnerType: row.partner_type,
      partnerLink: row.partner_link,
      partnerIdentifiedAt: row.partner_identified_at,
      discountPercentage: Number(row.discount_percentage || 0),
      discountAmountCents: Number(row.discount_amount || 0),
      originalPriceCents: Number(row.original_price ?? row.amount_cents),
      finalPriceCents: Number(row.final_price ?? row.amount_cents),
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
    partners: partners.rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      partnerType: row.partner_type,
      discountPercentage: Number(row.discount_percentage),
      athleteLimit: row.athlete_limit === null || row.athlete_limit === undefined ? null : Number(row.athlete_limit),
      status: row.status,
      description: row.description,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
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
      `insert into ${table.registrations} (id, event_id, distance_id, lot_id, cpf_hash, status, amount_cents, payload, created_at, updated_at, marketing_consent, marketing_consent_updated_at, expires_at, paid_at, confirmed_at, confirmation_email_sent_at, confirmation_email_last_attempt_at, confirmation_email_provider, confirmation_email_id, confirmation_email_error, bib_number, partner_id, partner_name, partner_type, partner_link, partner_identified_at, discount_percentage, discount_amount, original_price, final_price)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30)
       on conflict (id) do update set
         event_id = excluded.event_id,
         distance_id = excluded.distance_id,
         lot_id = excluded.lot_id,
         cpf_hash = excluded.cpf_hash,
         status = excluded.status,
         amount_cents = excluded.amount_cents,
         payload = excluded.payload,
         updated_at = excluded.updated_at,
         marketing_consent = excluded.marketing_consent,
         marketing_consent_updated_at = excluded.marketing_consent_updated_at,
         expires_at = excluded.expires_at,
         paid_at = excluded.paid_at,
         confirmed_at = excluded.confirmed_at,
         confirmation_email_sent_at = excluded.confirmation_email_sent_at,
         confirmation_email_last_attempt_at = excluded.confirmation_email_last_attempt_at,
         confirmation_email_provider = excluded.confirmation_email_provider,
         confirmation_email_id = excluded.confirmation_email_id,
         confirmation_email_error = excluded.confirmation_email_error,
         bib_number = excluded.bib_number,
         partner_id = excluded.partner_id,
         partner_name = excluded.partner_name,
         partner_type = excluded.partner_type,
         partner_link = excluded.partner_link,
         partner_identified_at = excluded.partner_identified_at,
         discount_percentage = excluded.discount_percentage,
         discount_amount = excluded.discount_amount,
         original_price = excluded.original_price,
         final_price = excluded.final_price`,
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
        item.marketingConsent ?? item.payload.meta?.marketingConsent === true,
        item.marketingConsentUpdatedAt || item.createdAt,
        item.expiresAt || null,
        item.paidAt || null,
        item.confirmedAt || null,
        item.confirmationEmailSentAt || null,
        item.confirmationEmailLastAttemptAt || null,
        item.confirmationEmailProvider || null,
        item.confirmationEmailId || null,
        item.confirmationEmailError || null,
        item.bibNumber || null,
        item.partnerId || null,
        item.partnerName || null,
        item.partnerType || null,
        item.partnerLink || null,
        item.partnerIdentifiedAt || null,
        item.discountPercentage || 0,
        item.discountAmountCents || 0,
        item.originalPriceCents ?? item.amountCents,
        item.finalPriceCents ?? item.amountCents,
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

  for (const item of database.partners) {
    await client.query(
      `insert into ${table.partners} (id, name, slug, partner_type, discount_percentage, athlete_limit, status, description, created_at, updated_at, deleted_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (id) do update set
         name = excluded.name,
         slug = excluded.slug,
         partner_type = excluded.partner_type,
         discount_percentage = excluded.discount_percentage,
         athlete_limit = excluded.athlete_limit,
         status = excluded.status,
         description = excluded.description,
         updated_at = excluded.updated_at,
         deleted_at = excluded.deleted_at`,
      [item.id, item.name, item.slug, item.partnerType, item.discountPercentage, item.athleteLimit, item.status, item.description, item.createdAt, item.updatedAt, item.deletedAt],
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
    await expireTemporaryReservations(client, new Date().toISOString());

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
       left join ${table.payments} payment on payment.registration_id = registration.id
       where registration.event_id = $1
         and registration.cpf_hash = $2
         and registration.status = $3
         and (
           registration.amount_cents <> registration.final_price
           or payment.id is null
           or payment.amount_cents <> registration.final_price
         )
       for update of registration`,
      [event.id, input.cpfHash, 'pending_payment'],
    );

    if (stalePendingResult.rows.length > 0) {
      const now = new Date().toISOString();
      const staleIds = stalePendingResult.rows.map((row) => String(row.id));
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
    }

    const existingResult = await client.query(
      `select registration.id, registration.status, registration.expires_at,
              registration.amount_cents, registration.partner_id, registration.partner_name, registration.partner_type,
              registration.discount_percentage, registration.discount_amount,
              registration.original_price, registration.final_price,
              payment.id as payment_id, payment.checkout_url,
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
      const recoveredAt = new Date().toISOString();
      const recoveredMarketingConsent = input.payload.meta?.marketingConsent === true;
      await client.query(
        `update ${table.registrations}
         set marketing_consent=$1,
             marketing_consent_updated_at=$2,
             payload=jsonb_set(
               payload,
               '{meta}',
               coalesce(payload->'meta', '{}'::jsonb) || jsonb_build_object('marketingConsent', $1::boolean),
               true
             )
         where id=$3`,
        [recoveredMarketingConsent, recoveredAt, existing.id],
      );
      if (!recoveredMarketingConsent) {
        await client.query(
          `update ${table.integrationEvents}
           set status='failed',next_attempt_at=null,last_error='MARKETING_CONSENT_REVOKED',updated_at=$1
           where provider='meta' and entity_id=$2 and status in ('pending','failed')`,
          [recoveredAt, existing.id],
        );
      }
      const requestedPartnerDiffers = Boolean(input.partnerId) && input.partnerId !== existing.partner_id;
      if (requestedPartnerDiffers) {
        await insertPartnerAudit(client, {
          partnerId: input.partnerId,
          action: 'partner.session_replacement_blocked',
          registrationId: existing.id,
          oldData: { partnerId: existing.partner_id || null, partnerType: existing.partner_type || null },
          newData: { requestedPartnerId: input.partnerId, requestedPartnerType: input.partnerType || null },
          metadata: { correlationId: input.correlationId || null, reason: 'registration_already_persisted', status: existing.status, partner_type: input.partnerType || null },
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          createdAt: recoveredAt,
        });
      }
      await insertPartnerAudit(client, {
        partnerId: existing.partner_id || null,
        action: 'registration.recovered',
        registrationId: existing.id,
        newData: { status: existing.status, partnerType: existing.partner_type || null, finalPriceCents: Number(existing.final_price) },
        metadata: { correlationId: input.correlationId || null, requestedPartnerId: input.partnerId || null, snapshotPreserved: true, partner_type: existing.partner_type || null },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        createdAt: recoveredAt,
      });
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
        partner: existing.partner_id ? {
          name: existing.partner_name,
          partnerType: existing.partner_type as PartnerType,
          discountPercentage: Number(existing.discount_percentage),
          discountAmountCents: Number(existing.discount_amount),
          originalPriceCents: Number(existing.original_price),
          finalPriceCents: Number(existing.final_price),
        } : null,
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
      `select count(*)::int as count from ${table.registrations}
       where distance_id = $1
         and (status = 'paid' or (status = 'pending_payment' and (expires_at is null or expires_at::timestamptz > now())))`,
      [distance.id],
    );
    const distanceSold = Number(distanceSoldResult.rows[0]?.count || 0);

    const lotOccupancyResult = await client.query(
      `select lot.id,
              count(registration.id) filter (where registration.status = 'paid')::int as confirmed,
              count(registration.id) filter (
                where registration.status = 'pending_payment'
                  and (registration.expires_at is null or registration.expires_at::timestamptz > now())
              )::int as temporary_reservations
       from ${table.lots} lot
       left join ${table.registrations} registration on registration.lot_id = lot.id
       where lot.event_id = $1
       group by lot.id`,
      [event.id],
    );
    const occupancyByLot = new Map(lotOccupancyResult.rows.map((row) => [String(row.id), {
      confirmed: Number(row.confirmed || 0),
      temporaryReservations: Number(row.temporary_reservations || 0),
    }]));
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
      confirmed: occupancyByLot.get(String(row.id))?.confirmed || 0,
      temporaryReservations: occupancyByLot.get(String(row.id))?.temporaryReservations || 0,
    }));
    const lot = selectAvailableLotCandidate(configuredLots);

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
    const originalPriceCents = Number(lot.priceCents);
    const partnerResult = input.partnerId
      ? await client.query(
        `select id,name,slug,partner_type,discount_percentage,status,deleted_at from ${table.partners} where id=$1 limit 1`,
        [input.partnerId],
      )
      : { rows: [] };
    const partnerRow = partnerResult.rows[0];
    const partnerIdentityIsValid = partnerRow
      && partnerRow.slug === input.partnerSlug
      && (!input.partnerType || partnerRow.partner_type === input.partnerType);
    const partnerPricing = partnerIdentityIsValid ? calculatePartnerPricing(originalPriceCents, {
      id: String(partnerRow.id), name: String(partnerRow.name),
      discountPercentage: Number(partnerRow.discount_percentage), status: partnerRow.status,
      deletedAt: partnerRow.deleted_at,
    }) : null;
    const partnerType = partnerPricing ? partnerRow.partner_type as PartnerType : null;
    const amountCents = partnerPricing?.finalPriceCents ?? originalPriceCents;

    if (input.partnerId && !partnerPricing) {
      await insertPartnerAudit(client, {
        partnerId: partnerRow?.id || null,
        action: 'consistency.issue_detected',
        eventId: event.id,
        oldData: { sessionPartnerId: input.partnerId, sessionSlug: input.partnerSlug || null, sessionPartnerType: input.partnerType || null },
        newData: partnerRow ? { partnerId: partnerRow.id, slug: partnerRow.slug, partnerType: partnerRow.partner_type, status: partnerRow.status, deleted: Boolean(partnerRow.deleted_at) } : null,
        metadata: { issueCode: 'partner_session_revalidation_failed', correlationId: input.correlationId || null, partnerType: partnerRow?.partner_type || input.partnerType || null, partner_type: partnerRow?.partner_type || input.partnerType || null },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        createdAt: now,
      });
    }

    await client.query(
      `insert into ${table.registrations} (id, event_id, distance_id, lot_id, cpf_hash, status, amount_cents, payload, created_at, updated_at, marketing_consent, marketing_consent_updated_at, expires_at, paid_at, confirmed_at, confirmation_email_sent_at, confirmation_email_last_attempt_at, confirmation_email_provider, confirmation_email_id, confirmation_email_error, partner_id, partner_name, partner_type, partner_link, partner_identified_at, discount_percentage, discount_amount, original_price, final_price)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $9, $11, null, null, null, null, null, null, null, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
      [registrationId, event.id, distance.id, lot.id, input.cpfHash, 'pending_payment', amountCents, input.payload, now,
        input.payload.meta?.marketingConsent === true, input.expiresAt,
        partnerPricing?.partnerId || null, partnerPricing?.partnerName || null, partnerType,
        partnerPricing ? `/p/${input.partnerSlug || ''}` : null, partnerPricing ? now : null,
        partnerPricing?.discountPercentage || 0, partnerPricing?.discountAmountCents || 0, originalPriceCents, amountCents],
    );
    await client.query(
      `insert into ${table.payments} (id, registration_id, provider, status, amount_cents, provider_payment_id, checkout_url, created_at, updated_at, expires_at, paid_at, gateway_status, gateway_transaction_id, gateway_payload)
       values ($1, $2, $3, $4, $5, null, null, $6, $6, $7, null, null, null, null)`,
      [paymentId, registrationId, input.paymentProvider || 'not_configured', 'pending_payment', amountCents, now, input.expiresAt],
    );
    await client.query(
      `insert into ${table.auditLogs} (id, actor, action, entity_type, entity_id, payload, created_at)
       values ($1, 'system', 'lot.reservation.created', 'registration', $2, $3, $4)`,
      [randomUUID(), registrationId, {
        lotId: lot.id,
        lotName: lot.name,
        expiresAt: input.expiresAt,
        capacityTotal: lot.capacity,
        confirmedBefore: lot.confirmed,
        temporaryReservationsBefore: lot.temporaryReservations,
      }, now],
    );
    if (partnerPricing) {
      const auditMetadata = { status: 'pending_payment', accessAuditId: input.accessAuditId || null, correlationId: input.correlationId || null, partnerType, partner_type: partnerType };
      await insertPartnerAudit(client, { partnerId: partnerPricing.partnerId, action: 'registration.started', registrationId, eventId: event.id, newData: { partnerName: partnerPricing.partnerName, partnerLink: `/p/${input.partnerSlug || ''}`, partnerType }, metadata: auditMetadata, ipAddress: input.ipAddress, userAgent: input.userAgent, createdAt: now });
      await insertPartnerAudit(client, { partnerId: partnerPricing.partnerId, action: 'discount.applied', registrationId, eventId: event.id, newData: { discountPercentage: partnerPricing.discountPercentage, discountAmountCents: partnerPricing.discountAmountCents, originalPriceCents, finalPriceCents: amountCents }, metadata: auditMetadata, ipAddress: input.ipAddress, userAgent: input.userAgent, createdAt: now });
      await insertPartnerAudit(client, { partnerId: partnerPricing.partnerId, action: 'partner.snapshot_persisted', registrationId, eventId: event.id, newData: { partnerId: partnerPricing.partnerId, partnerName: partnerPricing.partnerName, partnerType, partnerLink: `/p/${input.partnerSlug || ''}`, discountPercentage: partnerPricing.discountPercentage, discountAmountCents: partnerPricing.discountAmountCents, originalPriceCents, finalPriceCents: amountCents }, metadata: auditMetadata, ipAddress: input.ipAddress, userAgent: input.userAgent, createdAt: now });
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
      partner: partnerPricing ? {
        name: partnerPricing.partnerName,
        partnerType: partnerType!,
        discountPercentage: partnerPricing.discountPercentage,
        discountAmountCents: partnerPricing.discountAmountCents,
        originalPriceCents: partnerPricing.originalPriceCents,
        finalPriceCents: partnerPricing.finalPriceCents,
      } : null,
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
       returning id, registration_id`,
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
    const registration = await client.query(`select partner_id,partner_type,event_id from ${table.registrations} where id=$1`, [input.registrationId]);
    if (registration.rows[0]?.partner_id) await insertPartnerAudit(client, { partnerId: registration.rows[0].partner_id, action: 'payment.started', registrationId: input.registrationId, eventId: registration.rows[0].event_id, newData: { provider: 'infinitepay', providerPaymentId: input.providerPaymentId }, metadata: { partnerType: registration.rows[0].partner_type, partner_type: registration.rows[0].partner_type }, createdAt: now });
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
    await client.query("select pg_advisory_xact_lock(hashtext('funpace-run-registration-lot'))");
    await client.query("select pg_advisory_xact_lock(hashtext('funpace-run-payment-confirmation'))");
    await client.query("set local lock_timeout = '5s'");
    await client.query("set local statement_timeout = '15s'");

    const result = await client.query(
      `select registration.id, registration.status, registration.amount_cents, registration.final_price,
              registration.lot_id, registration.partner_id, registration.partner_type, registration.event_id,
              payment.id as payment_id, payment.status as payment_status, payment.amount_cents as payment_amount_cents,
              payment.gateway_transaction_id as existing_gateway_transaction_id,
              lot.status as lot_status, lot.price_cents as lot_price_cents,
              (select audit.metadata->>'correlationId' from ${table.partnerAuditLogs} audit
               where audit.registration_id=registration.id and audit.action='registration.started'
               order by audit.created_at asc limit 1) as correlation_id
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

    const persistedAmountsAgree = Number(row.amount_cents) === Number(row.final_price)
      && Number(row.amount_cents) === Number(row.payment_amount_cents);
    const providerAmountMatches = input.amountCents !== null
      && Number(row.amount_cents) === input.amountCents;

    if (!persistedAmountsAgree || !providerAmountMatches) {
      await client.query(
        `update ${table.payments}
         set gateway_status = 'amount_mismatch', gateway_transaction_id = coalesce(nullif($1, ''), gateway_transaction_id),
             gateway_payload = $2, updated_at = $3
         where id = $4`,
        [input.providerTransactionId, input.payload, now, row.payment_id],
      );
      if (row.partner_id) {
        const partnerMetadata = { partnerType: row.partner_type, partner_type: row.partner_type, correlationId: row.correlation_id || null };
        await insertPartnerAudit(client, { partnerId: row.partner_id, action: 'webhook.received', registrationId: row.id, eventId: row.event_id, metadata: { ...partnerMetadata, eventType: input.eventType, providerEventId: input.providerEventId }, createdAt: now });
        await insertPartnerAudit(client, { partnerId: row.partner_id, action: 'payment.amount_mismatch', registrationId: row.id, eventId: row.event_id, oldData: { registrationAmountCents: Number(row.amount_cents), finalPriceCents: Number(row.final_price), paymentAmountCents: Number(row.payment_amount_cents) }, newData: { providerAmountCents: input.amountCents }, metadata: { ...partnerMetadata, reason: input.amountCents === null ? 'provider_amount_missing' : 'amount_mismatch' }, createdAt: now });
      }
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
      if (row.partner_id) {
        const priorDuplicate = input.providerEventId ? await client.query(
          `select 1 from ${table.partnerAuditLogs}
           where registration_id=$1 and action='payment.duplicate_ignored' and metadata->>'providerEventId'=$2 limit 1`,
          [row.id, input.providerEventId],
        ) : { rowCount: 0 };
        if (!priorDuplicate.rowCount) await insertPartnerAudit(client, {
          partnerId: row.partner_id, action: 'payment.duplicate_ignored', registrationId: row.id, eventId: row.event_id,
          metadata: { partnerType: row.partner_type, partner_type: row.partner_type, correlationId: row.correlation_id || null, eventType: input.eventType, providerEventId: input.providerEventId || null }, createdAt: now,
        });
      }
      await client.query('commit');
      return { statusCode: 200, registrationId: row.id, paymentId: row.payment_id, previousStatus: row.status, duplicated: true };
    }
    const wasAlreadyPaid = row.status === 'paid' && row.payment_status === 'paid';

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
    if (!wasAlreadyPaid) {
      await client.query(
        `update ${table.lots} set sold_count = sold_count + 1,
           status = case
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
    if (row.partner_id && !duplicate) {
      const partnerMetadata = { partnerType: row.partner_type, partner_type: row.partner_type, correlationId: row.correlation_id || null };
      await insertPartnerAudit(client, { partnerId: row.partner_id, action: 'webhook.received', registrationId: row.id, eventId: row.event_id, metadata: { ...partnerMetadata, eventType: input.eventType, providerEventId: input.providerEventId, gatewayStatus: input.gatewayStatus }, createdAt: now });
      await insertPartnerAudit(client, { partnerId: row.partner_id, action: 'payment.approved', registrationId: row.id, eventId: row.event_id, oldData: { status: row.status }, newData: { status: 'paid', amountCents: Number(row.amount_cents) }, metadata: { ...partnerMetadata, providerTransactionId: input.providerTransactionId }, createdAt: now });
    }
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
       returning lot_id,partner_id,event_id`,
      ['payment_failed', now, registrationId, 'pending_payment'],
    );
    await client.query(
      `update ${table.payments} set status = $1, updated_at = $2 where registration_id = $3`,
      ['payment_failed', now, registrationId],
    );
    if (registrationResult.rows[0]?.partner_id) await insertPartnerAudit(client, { partnerId: registrationResult.rows[0].partner_id, action: 'payment.declined', registrationId, eventId: registrationResult.rows[0].event_id, newData: { status: 'payment_failed' }, metadata: { reason: 'checkout_creation_failed' }, createdAt: now });

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
    await client.query("select pg_advisory_xact_lock(hashtext('funpace-run-registration-lot'))");
    const registrationResult = await client.query(
      `select status, lot_id, partner_id, partner_type, event_id from ${table.registrations} where id = $1 for update`,
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

    if (registration.status === 'paid') {
      await client.query(
        `update ${table.lots}
         set sold_count = greatest(sold_count - 1, 0),
             status = case
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
    if (registration.partner_id) await insertPartnerAudit(client, { partnerId: registration.partner_id, action: 'registration.cancelled', userId: input.actor, registrationId: input.registrationId, eventId: registration.event_id, oldData: { status: registration.status }, newData: { status: 'cancelled' }, metadata: { reason: input.reason, partnerType: registration.partner_type, partner_type: registration.partner_type }, ipAddress: input.ipAddress, userAgent: input.userAgent, createdAt: now });
    await client.query('commit');
    return { status: 'cancelled', previousStatus: registration.status };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function persistReconciliationRunInPostgres(input: {
  id: string;
  triggerSource: string;
  mode: 'dry_run' | 'apply';
  checkedCount: number;
  correctedCount: number;
  manualReviewCount: number;
  errorCount: number;
  summary: unknown;
  startedAt: string;
  completedAt: string;
  createdBy: string;
  issues: Array<{
    issueKey: string;
    issueCode: string;
    severity: 'info' | 'warning' | 'critical';
    resolutionStatus: 'consistent' | 'automatically_corrected' | 'manual_review_required';
    registrationId: string;
    paymentId: string | null;
    details: unknown;
  }>;
}) {
  const client = await requirePool().connect();
  try {
    await ensurePostgresReady();
    await client.query('begin');
    await client.query(
      `insert into ${table.reconciliationRuns}
       (id, trigger_source, mode, status, checked_count, corrected_count, manual_review_count, error_count, summary, started_at, completed_at, created_by)
       values ($1, $2, $3, 'completed', $4, $5, $6, $7, $8, $9, $10, $11)`,
      [input.id, input.triggerSource, input.mode, input.checkedCount, input.correctedCount, input.manualReviewCount, input.errorCount, input.summary, input.startedAt, input.completedAt, input.createdBy],
    );
    for (const issue of input.issues) {
      await client.query(
        `insert into ${table.paymentReconciliations}
         (id, run_id, issue_key, issue_code, severity, resolution_status, registration_id, payment_id, details, first_detected_at, last_detected_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
         on conflict (issue_key) do update set
           run_id = excluded.run_id,
           severity = excluded.severity,
           resolution_status = case
             when ${table.paymentReconciliations}.resolution_status = 'resolved' then 'resolved'
             else excluded.resolution_status
           end,
           details = excluded.details,
           last_detected_at = excluded.last_detected_at`,
        [randomUUID(), input.id, issue.issueKey, issue.issueCode, issue.severity, issue.resolutionStatus, issue.registrationId, issue.paymentId, issue.details, input.completedAt],
      );
    }
    const activeFinancialIssueKeys = input.issues
      .filter((issue) => issue.issueCode === 'local_paid_without_real_transaction')
      .map((issue) => issue.issueKey);
    await client.query(
      `update ${table.paymentReconciliations}
       set resolution_status = 'resolved', resolved_at = $1, resolved_by = $2,
           resolution_notes = 'Classificacao anterior substituida por evidencia de transacao presente no payload do gateway.'
       where issue_code = 'local_paid_without_real_transaction'
         and resolution_status = 'manual_review_required'
         and not (issue_key = any($3::text[]))`,
      [input.completedAt, input.createdBy, activeFinancialIssueKeys],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function getReconciliationDashboardInPostgres() {
  await ensurePostgresReady();
  const [runs, issues] = await Promise.all([
    requirePool().query(`select * from ${table.reconciliationRuns} order by started_at desc limit 30`),
    requirePool().query(`select * from ${table.paymentReconciliations} order by last_detected_at desc limit 500`),
  ]);
  return {
    runs: runs.rows.map((row) => ({
      id: row.id, triggerSource: row.trigger_source, mode: row.mode, status: row.status,
      checkedCount: Number(row.checked_count), correctedCount: Number(row.corrected_count),
      manualReviewCount: Number(row.manual_review_count), errorCount: Number(row.error_count),
      summary: row.summary, startedAt: row.started_at, completedAt: row.completed_at, createdBy: row.created_by,
    })),
    issues: issues.rows.map((row) => ({
      id: row.id, issueKey: row.issue_key, issueCode: row.issue_code, severity: row.severity,
      resolutionStatus: row.resolution_status, registrationId: row.registration_id, paymentId: row.payment_id,
      details: row.details, firstDetectedAt: row.first_detected_at, lastDetectedAt: row.last_detected_at,
      resolvedAt: row.resolved_at, resolutionNotes: row.resolution_notes,
    })),
  };
}

export type PartnerAnalyticsFilters = {
  eventId?: string;
  dateFrom?: string;
  dateTo?: string;
  paymentStatus?: string;
  partnerId?: string;
  city?: string;
  partnerType?: PartnerType;
};

function partnerAnalyticsFilter(filters: PartnerAnalyticsFilters) {
  const values: unknown[] = [];
  const conditions = ['r.partner_id is not null'];
  const add = (value: unknown) => { values.push(value); return `$${values.length}`; };
  if (filters.eventId) conditions.push(`r.event_id = ${add(filters.eventId)}`);
  if (filters.dateFrom) conditions.push(`r.created_at::timestamptz >= ${add(filters.dateFrom)}::date`);
  if (filters.dateTo) conditions.push(`r.created_at::timestamptz < (${add(filters.dateTo)}::date + interval '1 day')`);
  if (filters.paymentStatus) conditions.push(`r.status = ${add(filters.paymentStatus)}`);
  if (filters.partnerId) conditions.push(`r.partner_id = ${add(filters.partnerId)}::uuid`);
  if (filters.city) conditions.push(`lower(coalesce(r.payload->>'city', '')) = lower(${add(filters.city)}::text)`);
  if (filters.partnerType) conditions.push(`r.partner_type = ${add(filters.partnerType)}`);
  return { sql: conditions.join(' and '), values };
}

function partnerEntityFilter(filters: Pick<PartnerAnalyticsFilters, 'partnerId' | 'partnerType'>, startIndex = 0, alias = 'p') {
  const values: unknown[] = [];
  const conditions = [`${alias}.deleted_at is null`];
  const add = (value: unknown) => { values.push(value); return `$${startIndex + values.length}`; };
  if (filters.partnerId) conditions.push(`${alias}.id = ${add(filters.partnerId)}::uuid`);
  if (filters.partnerType) conditions.push(`${alias}.partner_type = ${add(filters.partnerType)}`);
  return { sql: conditions.join(' and '), values };
}

function mapPartnerMetric(row: Record<string, unknown>) {
  return {
    label: String(row.label || ''),
    registrations: Number(row.registrations || 0),
    grossRevenueCents: Number(row.gross_revenue_cents || 0),
    discountAmountCents: Number(row.discount_amount_cents || 0),
    netRevenueCents: Number(row.net_revenue_cents || 0),
    ...(row.share_percentage === undefined ? {} : { sharePercentage: Number(row.share_percentage || 0) }),
  };
}

function mapPartnerRanking(row: Record<string, unknown>) {
  return {
    partnerId: String(row.partner_id), name: String(row.name), slug: String(row.slug), status: row.status as PartnerRecord['status'],
    partnerType: row.partner_type as PartnerType,
    paidRegistrations: Number(row.paid_registrations || 0), averageTicketCents: Number(row.average_ticket_cents || 0),
    ...mapPartnerMetric({ ...row, label: row.name }),
  };
}

export async function getPartnerDashboardInPostgres(filters: PartnerAnalyticsFilters, page = 1, pageSize = 20) {
  await ensurePostgresReady();
  const pool = requirePool();
  const filtered = partnerAnalyticsFilter(filters);
  const offset = (page - 1) * pageSize;
  const partnerScope = partnerEntityFilter(filters);
  const joinedPartnerScope = partnerEntityFilter(filters, filtered.values.length);
  const financial = `filter (where status = 'paid')`;
  const [summaryResult, rankingResult, monthlyResult, comparisonResult, emptyResult, inactiveResult, growthResult, optionsResult, partnerSummaryResult, breakdownResult] = await Promise.all([
    pool.query(
      `with filtered as (select * from ${table.registrations} r where ${filtered.sql}),
       partner_totals as (
         select partner_id, max(partner_name) name, count(*) registrations
         from filtered group by partner_id order by registrations desc, name asc limit 1
       )
       select count(*)::int total_registrations,
         count(*) filter (where status = 'paid')::int paid_registrations,
         coalesce(sum(original_price) ${financial}, 0)::bigint gross_revenue_cents,
         coalesce(sum(discount_amount) ${financial}, 0)::bigint discount_amount_cents,
         coalesce(sum(final_price) ${financial}, 0)::bigint net_revenue_cents,
         coalesce(round(avg(final_price) ${financial}), 0)::bigint average_ticket_cents,
         (select partner_id from partner_totals) leader_id,
         (select name from partner_totals) leader_name,
         coalesce((select registrations from partner_totals), 0)::int leader_registrations
       from filtered`, filtered.values),
    pool.query(
      `with filtered as (select * from ${table.registrations} r where ${filtered.sql}), ranked as (
         select p.id partner_id, p.name, p.slug, p.status, p.partner_type, count(f.id)::int registrations,
           count(f.id) filter (where f.status='paid')::int paid_registrations,
           coalesce(sum(f.original_price) filter (where f.status='paid'),0)::bigint gross_revenue_cents,
           coalesce(sum(f.discount_amount) filter (where f.status='paid'),0)::bigint discount_amount_cents,
           coalesce(sum(f.final_price) filter (where f.status='paid'),0)::bigint net_revenue_cents,
           coalesce(round(avg(f.final_price) filter (where f.status='paid')),0)::bigint average_ticket_cents
         from ${table.partners} p left join filtered f on f.partner_id=p.id
         where ${joinedPartnerScope.sql}
         group by p.id, p.name, p.slug, p.status, p.partner_type
       ) select *, count(*) over()::int total_count from ranked
         order by registrations desc, name asc limit $${filtered.values.length + joinedPartnerScope.values.length + 1} offset $${filtered.values.length + joinedPartnerScope.values.length + 2}`,
      [...filtered.values, ...joinedPartnerScope.values, pageSize, offset]),
    pool.query(
      `with filtered as (select * from ${table.registrations} r where ${filtered.sql})
       select to_char(date_trunc('month', created_at::timestamptz), 'YYYY-MM') label,
         count(*)::int registrations, count(*) filter (where status='paid')::int paid_registrations,
         coalesce(sum(original_price) filter (where status='paid'),0)::bigint gross_revenue_cents,
         coalesce(sum(discount_amount) filter (where status='paid'),0)::bigint discount_amount_cents,
         coalesce(sum(final_price) filter (where status='paid'),0)::bigint net_revenue_cents
       from filtered group by date_trunc('month', created_at::timestamptz) order by date_trunc('month', created_at::timestamptz) asc`, filtered.values),
    pool.query(
      `with filtered as (select * from ${table.registrations} r where ${filtered.sql}), aggregate as (
         select p.id partner_id, p.name, p.slug, p.status, p.partner_type, count(f.id)::int registrations,
           count(f.id) filter (where f.status='paid')::int paid_registrations,
           coalesce(sum(f.original_price) filter (where f.status='paid'),0)::bigint gross_revenue_cents,
           coalesce(sum(f.discount_amount) filter (where f.status='paid'),0)::bigint discount_amount_cents,
           coalesce(sum(f.final_price) filter (where f.status='paid'),0)::bigint net_revenue_cents,
           coalesce(round(avg(f.final_price) filter (where f.status='paid')),0)::bigint average_ticket_cents
         from ${table.partners} p left join filtered f on f.partner_id=p.id
         where ${joinedPartnerScope.sql}
         group by p.id, p.name, p.slug, p.status, p.partner_type
       ), totals as (select coalesce(sum(registrations),0) total from aggregate)
       select aggregate.*, case when totals.total=0 then 0 else round(aggregate.registrations::numeric * 100 / totals.total, 2) end share_percentage
       from aggregate cross join totals order by registrations desc, name asc limit 12`,
      [...filtered.values, ...joinedPartnerScope.values]),
    pool.query(
      `select p.id partner_id, p.name from ${table.partners} p
       where ${partnerScope.sql} and not exists (select 1 from ${table.registrations} r where r.partner_id=p.id)
       order by p.name asc limit 100`, partnerScope.values),
    pool.query(
      `select p.id partner_id, p.name from ${table.partners} p where ${partnerScope.sql} and p.status='inactive'
       order by p.name asc limit 100`, partnerScope.values),
    pool.query(
      `with counts as (
         select p.id partner_id, p.name,
           count(r.id) filter (where r.created_at::timestamptz >= date_trunc('month', now()))::int current_count,
           count(r.id) filter (where r.created_at::timestamptz >= date_trunc('month', now()) - interval '1 month' and r.created_at::timestamptz < date_trunc('month', now()))::int previous_count
         from ${table.partners} p left join ${table.registrations} r on r.partner_id=p.id
         where ${partnerScope.sql} group by p.id,p.name
       ) select *, case when previous_count=0 then case when current_count>0 then 100 else 0 end
         else round((current_count-previous_count)::numeric*100/previous_count,2) end change_percentage
       from counts where current_count<>previous_count order by change_percentage desc, name asc`, partnerScope.values),
    pool.query(
      `select jsonb_build_object(
        'events', (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]') from ${table.events}),
        'partners', (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'partnerType',partner_type) order by name),'[]') from ${table.partners} where deleted_at is null and ($1='' or partner_type=$1)),
        'cities', (select coalesce(jsonb_agg(city order by city),'[]') from (select distinct payload->>'city' city from ${table.registrations} where partner_id is not null and coalesce(payload->>'city','')<>'' and ($1='' or partner_type=$1)) c)
       ) options`, [filters.partnerType || '']),
    pool.query(
      `with filtered as (select * from ${table.registrations} r where ${filtered.sql}), scoped as (
         select p.id,p.name,p.partner_type,p.status,count(f.id)::int registrations,
           count(f.id) filter(where f.status='paid')::int paid_registrations,
           coalesce(sum(f.final_price) filter(where f.status='paid'),0)::bigint revenue_cents,
           coalesce(sum(f.discount_amount) filter(where f.status='paid'),0)::bigint discount_cents
         from ${table.partners} p left join filtered f on f.partner_id=p.id
         where ${joinedPartnerScope.sql} group by p.id,p.name,p.partner_type,p.status
       ) select count(*)::int total_partners,
         count(*) filter(where partner_type='sports_advisory')::int sports_advisories,
         count(*) filter(where partner_type='influencer')::int influencers,
         count(*) filter(where status='active')::int active_partners,
         count(*) filter(where status='inactive')::int inactive_partners,
         count(*) filter(where registrations=0)::int without_registrations,
         (select jsonb_build_object('partnerId',id,'name',name,'value',revenue_cents) from scoped where revenue_cents>0 order by revenue_cents desc,name asc limit 1) top_revenue,
         (select jsonb_build_object('partnerId',id,'name',name,'value',discount_cents) from scoped where discount_cents>0 order by discount_cents desc,name asc limit 1) top_discount,
         (select jsonb_build_object('partnerId',id,'name',name,'value',round(paid_registrations::numeric*100/registrations,2)) from scoped where registrations>0 order by paid_registrations::numeric/registrations desc,paid_registrations desc,name asc limit 1) top_conversion
       from scoped`, [...filtered.values, ...joinedPartnerScope.values]),
    pool.query(
      `with filtered as (select * from ${table.registrations} r where ${filtered.sql})
       select partner_type,count(*)::int registrations,
         count(*) filter(where status='paid')::int paid_registrations,
         coalesce(sum(final_price) filter(where status='paid'),0)::bigint revenue_cents,
         coalesce(sum(discount_amount) filter(where status='paid'),0)::bigint discount_cents,
         coalesce(round(avg(final_price) filter(where status='paid')),0)::bigint average_ticket_cents
       from filtered group by partner_type order by partner_type`, filtered.values),
  ]);
  const summary = summaryResult.rows[0] || {};
  const ranking = rankingResult.rows.map(mapPartnerRanking);
  const total = Number(rankingResult.rows[0]?.total_count || 0);
  const growth = growthResult.rows.map((row) => ({ partnerId: String(row.partner_id), name: String(row.name), current: Number(row.current_count), previous: Number(row.previous_count), changePercentage: Number(row.change_percentage) }));
  const totalRegistrations = Number(summary.total_registrations || 0);
  const paidRegistrations = Number(summary.paid_registrations || 0);
  const options = optionsResult.rows[0]?.options || {};
  const partnerSummary = partnerSummaryResult.rows[0] || {};
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalPartners: Number(partnerSummary.total_partners || total),
      sportsAdvisories: Number(partnerSummary.sports_advisories || 0), influencers: Number(partnerSummary.influencers || 0),
      activePartners: Number(partnerSummary.active_partners || 0), inactivePartners: Number(partnerSummary.inactive_partners || 0),
      withoutRegistrations: Number(partnerSummary.without_registrations || 0), totalRegistrations, paidRegistrations,
      grossRevenueCents: Number(summary.gross_revenue_cents || 0), discountAmountCents: Number(summary.discount_amount_cents || 0),
      netRevenueCents: Number(summary.net_revenue_cents || 0), averageTicketCents: Number(summary.average_ticket_cents || 0),
      leader: summary.leader_id ? { partnerId: String(summary.leader_id), name: String(summary.leader_name), registrations: Number(summary.leader_registrations) } : null,
      conversionRate: totalRegistrations ? Number(((paidRegistrations * 100) / totalRegistrations).toFixed(2)) : 0,
      conversionDefinition: 'Inscricoes pagas divididas pelo total de inscricoes atribuidas a parceiros.',
      topRevenue: partnerSummary.top_revenue || null,
      topDiscount: partnerSummary.top_discount || null,
      topConversion: partnerSummary.top_conversion || null,
    },
    ranking,
    rankingPagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    charts: { monthly: monthlyResult.rows.map(mapPartnerMetric), comparison: comparisonResult.rows.map(mapPartnerRanking) },
    breakdown: breakdownResult.rows.map((row) => ({
      partnerType: row.partner_type as PartnerType,
      registrations: Number(row.registrations || 0), paidRegistrations: Number(row.paid_registrations || 0),
      revenueCents: Number(row.revenue_cents || 0), discountAmountCents: Number(row.discount_cents || 0),
      averageTicketCents: Number(row.average_ticket_cents || 0),
      conversionRate: Number(row.registrations) ? Number((Number(row.paid_registrations) * 100 / Number(row.registrations)).toFixed(2)) : 0,
      participationPercentage: totalRegistrations ? Number((Number(row.registrations) * 100 / totalRegistrations).toFixed(2)) : 0,
    })),
    indicators: {
      leader: comparisonResult.rows[0] ? mapPartnerRanking(comparisonResult.rows[0]) : null,
      withoutRegistrations: emptyResult.rows.map((row) => ({ partnerId: String(row.partner_id), name: String(row.name) })),
      inactive: inactiveResult.rows.map((row) => ({ partnerId: String(row.partner_id), name: String(row.name) })),
      fastestGrowing: growth.filter((item) => item.changePercentage > 0).slice(0, 5),
      declining: growth.filter((item) => item.changePercentage < 0).reverse().slice(0, 5),
    },
    options: { events: options.events || [], partners: options.partners || [], cities: options.cities || [], paymentStatuses: ['pending_payment','paid','payment_failed','expired','cancelled','refunded'], partnerTypes: ['sports_advisory','influencer'] },
  };
}

export async function getPartnerDetailInPostgres(partnerId: string, filters: PartnerAnalyticsFilters, page = 1, pageSize = 25) {
  await ensurePostgresReady();
  const pool = requirePool();
  const scopedFilters = { ...filters, partnerId };
  const filtered = partnerAnalyticsFilter(scopedFilters);
  const offset = (page - 1) * pageSize;
  const [partnerResult, metricsResult, monthlyResult, registrationsResult] = await Promise.all([
    pool.query(`select * from ${table.partners} where id=$1::uuid and deleted_at is null limit 1`, [partnerId]),
    pool.query(`with filtered as (select * from ${table.registrations} r where ${filtered.sql}) select
      count(*)::int registrations, count(*) filter(where status='paid')::int paid_registrations,
      coalesce(sum(original_price) filter(where status='paid'),0)::bigint gross_revenue_cents,
      coalesce(sum(discount_amount) filter(where status='paid'),0)::bigint discount_amount_cents,
      coalesce(sum(final_price) filter(where status='paid'),0)::bigint net_revenue_cents,
      coalesce(round(avg(final_price) filter(where status='paid')),0)::bigint average_ticket_cents,
      max(created_at) last_registration_at from filtered`, filtered.values),
    pool.query(`with filtered as (select * from ${table.registrations} r where ${filtered.sql}) select
      to_char(date_trunc('month',created_at::timestamptz),'YYYY-MM') label, count(*)::int registrations,
      coalesce(sum(original_price) filter(where status='paid'),0)::bigint gross_revenue_cents,
      coalesce(sum(discount_amount) filter(where status='paid'),0)::bigint discount_amount_cents,
      coalesce(sum(final_price) filter(where status='paid'),0)::bigint net_revenue_cents
      from filtered group by date_trunc('month',created_at::timestamptz) order by date_trunc('month',created_at::timestamptz)`, filtered.values),
    pool.query(`with filtered as (select * from ${table.registrations} r where ${filtered.sql}) select
      r.id, coalesce(r.payload->>'fullName','Atleta') athlete_name, e.name event_name, coalesce(r.payload->>'city','') city,
      r.created_at, r.original_price, r.discount_amount, r.final_price, r.status, count(*) over()::int total_count
      from filtered r join ${table.events} e on e.id=r.event_id order by r.created_at desc
      limit $${filtered.values.length + 1} offset $${filtered.values.length + 2}`, [...filtered.values, pageSize, offset]),
  ]);
  if (!partnerResult.rows[0]) return null;
  const partner = partnerResult.rows[0];
  if (filters.partnerType && partner.partner_type !== filters.partnerType) return null;
  const metrics = metricsResult.rows[0] || {};
  const total = Number(registrationsResult.rows[0]?.total_count || 0);
  return {
    generatedAt: new Date().toISOString(),
    partner: { id: String(partner.id), name: String(partner.name), slug: String(partner.slug), partnerType: partner.partner_type as PartnerType, discountPercentage: Number(partner.discount_percentage), athleteLimit: partner.athlete_limit === null || partner.athlete_limit === undefined ? null : Number(partner.athlete_limit), status: partner.status, description: partner.description || null, createdAt: String(partner.created_at), updatedAt: String(partner.updated_at) },
    metrics: { registrations: Number(metrics.registrations || 0), paidRegistrations: Number(metrics.paid_registrations || 0), grossRevenueCents: Number(metrics.gross_revenue_cents || 0), discountAmountCents: Number(metrics.discount_amount_cents || 0), netRevenueCents: Number(metrics.net_revenue_cents || 0), averageTicketCents: Number(metrics.average_ticket_cents || 0), lastRegistrationAt: metrics.last_registration_at ? String(metrics.last_registration_at) : null },
    monthly: monthlyResult.rows.map(mapPartnerMetric),
    registrations: registrationsResult.rows.map((row) => ({ id: String(row.id), athleteName: String(row.athlete_name), eventName: String(row.event_name), city: String(row.city), createdAt: String(row.created_at), originalPriceCents: Number(row.original_price), discountAmountCents: Number(row.discount_amount), finalPriceCents: Number(row.final_price), paymentStatus: String(row.status) })),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

export async function exportPartnerRegistrationsInPostgres(filters: PartnerAnalyticsFilters) {
  await ensurePostgresReady();
  const filtered = partnerAnalyticsFilter(filters);
  const result = await requirePool().query(`select r.id, coalesce(r.payload->>'fullName','Atleta') athlete_name,
    e.name event_name, p.name partner_name, r.partner_type, coalesce(r.payload->>'city','') city, r.created_at,
    r.original_price, r.discount_amount, r.final_price, r.discount_percentage, r.status
    from ${table.registrations} r join ${table.events} e on e.id=r.event_id join ${table.partners} p on p.id=r.partner_id
    where ${filtered.sql} order by r.created_at desc limit 100000`, filtered.values);
  return result.rows.map((row) => ({ id: String(row.id), athleteName: String(row.athlete_name), eventName: String(row.event_name), partnerName: String(row.partner_name), partnerType: row.partner_type as PartnerType, city: String(row.city), createdAt: String(row.created_at), originalPriceCents: Number(row.original_price), discountAmountCents: Number(row.discount_amount), finalPriceCents: Number(row.final_price), discountPercentage: Number(row.discount_percentage), paymentStatus: String(row.status) }));
}

export type PartnerAuditAction =
  | 'partner.created' | 'partner.updated' | 'partner.type_changed' | 'partner.type_change_blocked' | 'partner.activated' | 'partner.inactivated' | 'partner.deleted'
  | 'partner.link_accessed' | 'partner.link_rejected' | 'partner.resolution_approved' | 'partner.session_created'
  | 'partner.session_replaced' | 'partner.session_replacement_blocked' | 'registration.started' | 'registration.recovered'
  | 'partner.snapshot_persisted' | 'discount.applied'
  | 'payment.started' | 'webhook.received' | 'payment.approved' | 'payment.declined' | 'payment.amount_mismatch'
  | 'payment.duplicate_ignored' | 'payment.expired'
  | 'registration.cancelled' | 'payment.refunded' | 'consistency.issue_detected' | 'partner.persistence_failed';

export type PartnerAuditInput = {
  partnerId?: string | null; action: PartnerAuditAction; userId?: string | null; registrationId?: string | null;
  eventId?: string | null; oldData?: unknown; newData?: unknown; metadata?: Record<string, unknown>;
  ipAddress?: string | null; userAgent?: string | null; createdAt?: string;
};

async function insertPartnerAudit(client: Queryable, input: PartnerAuditInput) {
  const id = randomUUID();
  await client.query(
    `insert into ${table.partnerAuditLogs}
     (id,partner_id,action,user_id,registration_id,event_id,old_data,new_data,metadata,ip_address,user_agent,created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [id, input.partnerId || null, input.action, input.userId || null, input.registrationId || null, input.eventId || null,
      input.oldData ?? null, input.newData ?? null, input.metadata || {}, input.ipAddress || null, input.userAgent || null, input.createdAt || new Date().toISOString()],
  );
  return id;
}

export async function appendPartnerAuditLogInPostgres(input: PartnerAuditInput) {
  await ensurePostgresReady();
  return insertPartnerAudit(requirePool(), input);
}

export async function findPartnerRegistrationBySessionInPostgres(input: { correlationId?: string | null; accessAuditId?: string | null }) {
  await ensurePostgresReady();
  if (!input.correlationId && !input.accessAuditId) return null;
  const result = await requirePool().query(
    `select log.registration_id,log.partner_id,registration.partner_type,registration.status
     from ${table.partnerAuditLogs} log
     join ${table.registrations} registration on registration.id=log.registration_id
     where log.action='registration.started'
       and (($1::text is not null and log.metadata->>'correlationId'=$1)
         or ($2::text is not null and log.metadata->>'accessAuditId'=$2))
     order by log.created_at desc limit 1`,
    [input.correlationId || null, input.accessAuditId || null],
  );
  const row = result.rows[0];
  return row ? { registrationId: String(row.registration_id), partnerId: String(row.partner_id), partnerType: row.partner_type as PartnerType, status: String(row.status) } : null;
}

export async function appendPartnerPaymentStatusAuditInPostgres(registrationId: string, status: RegistrationStatus, metadata: Record<string, unknown> = {}) {
  await ensurePostgresReady(); const client = await requirePool().connect();
  try { await client.query('begin'); const row = (await client.query(`select partner_id,partner_type,event_id from ${table.registrations} where id=$1`, [registrationId])).rows[0];
    if (row?.partner_id) { const now=new Date().toISOString(); const typedMetadata={...metadata,partnerType:row.partner_type,partner_type:row.partner_type}; await insertPartnerAudit(client,{partnerId:row.partner_id,action:'webhook.received',registrationId,eventId:row.event_id,metadata:typedMetadata,createdAt:now}); const action:PartnerAuditAction=status==='refunded'?'payment.refunded':status==='expired'?'payment.expired':'payment.declined'; await insertPartnerAudit(client,{partnerId:row.partner_id,action,registrationId,eventId:row.event_id,newData:{status},metadata:typedMetadata,createdAt:now}); }
    await client.query('commit');
  } catch(error){await client.query('rollback').catch(()=>undefined);throw error;} finally{client.release();}
}

function mapPartnerRow(row: Record<string, unknown>): PartnerRecord {
  return { id: String(row.id), name: String(row.name), slug: String(row.slug), partnerType: row.partner_type as PartnerType, discountPercentage: Number(row.discount_percentage), athleteLimit: row.athlete_limit === null || row.athlete_limit === undefined ? null : Number(row.athlete_limit), status: row.status as PartnerRecord['status'], description: row.description ? String(row.description) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at), deletedAt: row.deleted_at ? String(row.deleted_at) : null };
}

export async function listAdminPartnersInPostgres(
  filters: { name?: string; slug?: string; status?: PartnerStatus; partnerType?: PartnerType },
  page = 1,
  pageSize = 20,
) {
  await ensurePostgresReady();
  const values: unknown[] = [];
  const where = ['deleted_at is null'];
  const add = (value: unknown) => { values.push(value); return `$${values.length}`; };
  if (filters.name) where.push(`name ilike '%' || ${add(filters.name)} || '%'`);
  if (filters.slug) where.push(`slug like '%' || ${add(filters.slug)} || '%'`);
  if (filters.status) where.push(`status=${add(filters.status)}`);
  if (filters.partnerType) where.push(`partner_type=${add(filters.partnerType)}`);
  const pool = requirePool();
  const countResult = await pool.query(`select count(*)::int total from ${table.partners} where ${where.join(' and ')}`, values);
  const result = await pool.query(
    `select * from ${table.partners} where ${where.join(' and ')} order by name asc,id asc
     limit $${values.length + 1} offset $${values.length + 2}`,
    [...values, pageSize, (page - 1) * pageSize],
  );
  const total = Number(countResult.rows[0]?.total || 0);
  return {
    partners: result.rows.map(mapPartnerRow),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

export class PartnerTypeChangeBlockedError extends Error {
  readonly details: { registrations: number; payments: number; transactionalAuditLogs: number };

  constructor(details: { registrations: number; payments: number; transactionalAuditLogs: number }) {
    super('O tipo nao pode ser alterado porque o parceiro ja possui historico transacional.');
    this.name = 'PartnerTypeChangeBlockedError';
    this.details = details;
  }
}

export async function mutatePartnerWithAuditInPostgres(input: {
  mode: 'create' | 'update' | 'status' | 'delete'; partnerId?: string; partner?: Pick<PartnerRecord, 'name' | 'slug' | 'partnerType' | 'discountPercentage' | 'athleteLimit' | 'status' | 'description'>;
  status?: PartnerRecord['status']; actor: string; actorRole: string; sessionId: string; ipAddress: string | null; userAgent: string | null;
}) {
  const client = await requirePool().connect();
  let transactionFinished = false;
  try {
    await ensurePostgresReady(); await client.query('begin');
    const now = new Date().toISOString();
    let before: PartnerRecord | null = null; let after: PartnerRecord | null = null; let action: PartnerAuditAction;
    if (input.mode === 'create') {
      const id = randomUUID(); const partner = input.partner!;
      const result = await client.query(`insert into ${table.partners} (id,name,slug,partner_type,discount_percentage,athlete_limit,status,description,created_at,updated_at,deleted_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,null) returning *`, [id,partner.name,partner.slug,partner.partnerType,partner.discountPercentage,partner.athleteLimit,partner.status,partner.description,now]);
      after = mapPartnerRow(result.rows[0]); action = 'partner.created';
    } else {
      const current = await client.query(`select * from ${table.partners} where id=$1::uuid and deleted_at is null for update`, [input.partnerId]);
      if (!current.rows[0]) { await client.query('rollback'); return null; }
      before = mapPartnerRow(current.rows[0]);
      if (input.mode === 'update') {
        const partner = input.partner!;
        if (partner.partnerType !== before.partnerType) {
          const history = (await client.query(
            `select
              (select count(*)::int from ${table.registrations} where partner_id=$1::uuid) registrations,
              (select count(*)::int from ${table.payments} payment join ${table.registrations} registration on registration.id=payment.registration_id where registration.partner_id=$1::uuid) payments,
              (select count(*)::int from ${table.partnerAuditLogs} where partner_id=$1::uuid and (registration_id is not null or action in ('registration.started','discount.applied','payment.started','webhook.received','payment.approved','payment.declined','payment.amount_mismatch','payment.duplicate_ignored','payment.expired','registration.cancelled','payment.refunded'))) transactional_audit_logs`,
            [input.partnerId],
          )).rows[0];
          const details = {
            registrations: Number(history?.registrations || 0),
            payments: Number(history?.payments || 0),
            transactionalAuditLogs: Number(history?.transactional_audit_logs || 0),
          };
          if (details.registrations > 0 || details.payments > 0 || details.transactionalAuditLogs > 0) {
            const metadata = { partnerType: before.partnerType, partner_type: before.partnerType, previousPartnerType: before.partnerType, requestedPartnerType: partner.partnerType, actorRole: input.actorRole, sessionId: input.sessionId, history: details };
            await insertPartnerAudit(client, { partnerId: before.id, action: 'partner.type_change_blocked', userId: input.actor, oldData: before, newData: { requestedPartnerType: partner.partnerType }, metadata, ipAddress: input.ipAddress, userAgent: input.userAgent, createdAt: now });
            await client.query(`insert into ${table.auditLogs} (id,actor,actor_role,action,entity_type,entity_id,payload,session_id,ip_address,user_agent,created_at) values ($1,$2,$3,$4,'partner',$5,$6,$7,$8,$9,$10)`, [randomUUID(),input.actor,input.actorRole,'partner.type_change_blocked',before.id,{ before, requestedPartnerType: partner.partnerType, metadata },input.sessionId,input.ipAddress,input.userAgent,now]);
            await client.query('commit'); transactionFinished = true;
            throw new PartnerTypeChangeBlockedError(details);
          }
        }
        const result = await client.query(`update ${table.partners} set name=$1,slug=$2,partner_type=$3,discount_percentage=$4,athlete_limit=$5,status=$6,description=$7,updated_at=$8 where id=$9::uuid returning *`, [partner.name,partner.slug,partner.partnerType,partner.discountPercentage,partner.athleteLimit,partner.status,partner.description,now,input.partnerId]);
        after = mapPartnerRow(result.rows[0]); action = partner.partnerType === before.partnerType ? 'partner.updated' : 'partner.type_changed';
      } else if (input.mode === 'status') {
        const result = await client.query(`update ${table.partners} set status=$1,updated_at=$2 where id=$3::uuid returning *`, [input.status,now,input.partnerId]);
        after = mapPartnerRow(result.rows[0]); action = input.status === 'active' ? 'partner.activated' : 'partner.inactivated';
      } else {
        const active = await client.query(`select count(*)::int count from ${table.registrations} where partner_id=$1::uuid and status in ('pending_payment','paid')`, [input.partnerId]);
        const result = await client.query(`update ${table.partners} set status='inactive',deleted_at=$1,updated_at=$1 where id=$2::uuid returning *`, [now,input.partnerId]);
        after = mapPartnerRow(result.rows[0]); action = 'partner.deleted';
        if (Number(active.rows[0]?.count || 0) > 0) await client.query(`insert into ${table.operationalAlerts} (id,dedupe_key,severity,alert_type,title,message,entity_type,entity_id,payload,status,detected_at) values ($1,$2,'critical','partner_removed_with_active_registrations','Parceiro removido com inscricoes ativas',$3,'partner',$4,$5,'open',$6) on conflict (dedupe_key) do update set payload=excluded.payload,detected_at=excluded.detected_at,status='open',resolved_at=null`, [randomUUID(),`partner-removed-active:${input.partnerId}`,`${before.name} foi removido com inscricoes pendentes ou pagas.`,input.partnerId,{ activeRegistrations: Number(active.rows[0].count) },now]);
      }
    }
    const metadata = { partnerType: after!.partnerType, partner_type: after!.partnerType, previousPartnerType: before?.partnerType ?? null, nextPartnerType: after!.partnerType, actorRole: input.actorRole, sessionId: input.sessionId };
    await insertPartnerAudit(client, { partnerId: after!.id, action, userId: input.actor, oldData: before, newData: after, metadata, ipAddress: input.ipAddress, userAgent: input.userAgent, createdAt: now });
    await client.query(`insert into ${table.auditLogs} (id,actor,actor_role,action,entity_type,entity_id,payload,session_id,ip_address,user_agent,created_at) values ($1,$2,$3,$4,'partner',$5,$6,$7,$8,$9,$10)`, [randomUUID(),input.actor,input.actorRole,action,after!.id,{before,after,metadata},input.sessionId,input.ipAddress,input.userAgent,now]);
    await client.query('commit'); transactionFinished = true; return after;
  } catch (error) { if (!transactionFinished) await client.query('rollback').catch(() => undefined); throw error; }
  finally { client.release(); }
}

function mapPartnerAuditRow(row: Record<string, unknown>) {
  return { id: String(row.id), partnerId: row.partner_id ? String(row.partner_id) : null, partnerName: row.partner_name ? String(row.partner_name) : null, action: String(row.action), userId: row.user_id ? String(row.user_id) : null, registrationId: row.registration_id ? String(row.registration_id) : null, athleteName: row.athlete_name ? String(row.athlete_name) : null, eventId: row.event_id ? String(row.event_id) : null, eventName: row.event_name ? String(row.event_name) : null, oldData: row.old_data || null, newData: row.new_data || null, metadata: row.metadata || {}, ipAddress: row.ip_address ? String(row.ip_address) : null, userAgent: row.user_agent ? String(row.user_agent) : null, createdAt: String(row.created_at) };
}

export async function listPartnerAuditLogsInPostgres(filters: { partnerId?: string; registrationId?: string; action?: string; dateFrom?: string; dateTo?: string; partnerType?: PartnerType }, page = 1, pageSize = 25) {
  await ensurePostgresReady(); const values: unknown[] = []; const where: string[] = ['1=1']; const add = (value: unknown) => { values.push(value); return `$${values.length}`; };
  if (filters.partnerId) where.push(`log.partner_id=${add(filters.partnerId)}::uuid`);
  if (filters.registrationId) where.push(`log.registration_id=${add(filters.registrationId)}`);
  if (filters.action) where.push(`log.action=${add(filters.action)}`);
  if (filters.dateFrom) where.push(`log.created_at::timestamptz>=${add(filters.dateFrom)}::date`);
  if (filters.dateTo) where.push(`log.created_at::timestamptz<(${add(filters.dateTo)}::date+interval '1 day')`);
  if (filters.partnerType) where.push(`p.partner_type=${add(filters.partnerType)}`);
  const result = await requirePool().query(`select log.*,p.name partner_name,r.payload->>'fullName' athlete_name,e.name event_name,count(*) over()::int total_count from ${table.partnerAuditLogs} log left join ${table.partners} p on p.id=log.partner_id left join ${table.registrations} r on r.id=log.registration_id left join ${table.events} e on e.id=log.event_id where ${where.join(' and ')} order by log.created_at desc limit $${values.length+1} offset $${values.length+2}`, [...values,pageSize,(page-1)*pageSize]);
  const total = Number(result.rows[0]?.total_count || 0); return { logs: result.rows.map(mapPartnerAuditRow), pagination: { page,pageSize,total,totalPages: Math.ceil(total/pageSize) } };
}

export async function getRegistrationPartnerAuditInPostgres(registrationId: string) {
  await ensurePostgresReady();
  const result = await requirePool().query(`with access_ids as (select metadata->>'accessAuditId' id from ${table.partnerAuditLogs} where registration_id=$1 and action='registration.started') select log.*,p.name partner_name,r.payload->>'fullName' athlete_name,e.name event_name from ${table.partnerAuditLogs} log left join ${table.partners} p on p.id=log.partner_id left join ${table.registrations} r on r.id=log.registration_id left join ${table.events} e on e.id=log.event_id where log.registration_id=$1 or log.id::text in (select id from access_ids where id is not null) order by log.created_at asc`, [registrationId]);
  return result.rows.map(mapPartnerAuditRow);
}

export async function getPartnerMonitoringInPostgres(page = 1, pageSize = 25, partnerType?: PartnerType) {
  await ensurePostgresReady();
  const result = await requirePool().query(`with linked as (select distinct partner_id,registration_id from ${table.partnerAuditLogs} where action='registration.started' and coalesce(metadata->>'accessAuditId','')<>''), audit as (
    select log.partner_id,count(*) filter(where action='partner.link_accessed')::int accesses,count(distinct log.registration_id) filter(where action='registration.started')::int started,count(distinct log.registration_id) filter(where action='payment.approved')::int completed,count(distinct log.registration_id) filter(where action='payment.approved' and exists(select 1 from linked where linked.partner_id=log.partner_id and linked.registration_id=log.registration_id))::int converted,count(*) filter(where action in ('partner.link_rejected','payment.declined','payment.amount_mismatch','partner.persistence_failed','consistency.issue_detected'))::int failures from ${table.partnerAuditLogs} log group by log.partner_id
  ), rows as (select p.id partner_id,p.name,p.status,p.partner_type,coalesce(a.accesses,0)::int accesses,coalesce(a.started,0)::int started,coalesce(a.completed,0)::int completed,coalesce(a.failures,0)::int failures,
    case when coalesce(a.accesses,0)=0 then 0 else round(a.converted::numeric*100/a.accesses,2) end conversion_rate,
    greatest(coalesce(a.started,0)-coalesce(a.completed,0),0)::int abandoned,
    case when coalesce(a.started,0)=0 then 0 else round(greatest(a.started-a.completed,0)::numeric*100/a.started,2) end abandonment_rate
    from ${table.partners} p left join audit a on a.partner_id=p.id where p.deleted_at is null and ($3='' or p.partner_type=$3))
    select *,count(*) over()::int total_count from rows order by accesses desc,name asc limit $1 offset $2`, [pageSize,(page-1)*pageSize,partnerType || '']);
  const total = Number(result.rows[0]?.total_count || 0); const rows = result.rows.map((row) => ({ partnerId:String(row.partner_id),name:String(row.name),status:row.status,partnerType:row.partner_type as PartnerType,accesses:Number(row.accesses),started:Number(row.started),completed:Number(row.completed),conversionRate:Number(row.conversion_rate),abandoned:Number(row.abandoned),abandonmentRate:Number(row.abandonment_rate),failures:Number(row.failures) }));
  const totals = await requirePool().query(`with linked as (select distinct log.registration_id from ${table.partnerAuditLogs} log join ${table.partners} p on p.id=log.partner_id where log.action='registration.started' and coalesce(log.metadata->>'accessAuditId','')<>'' and ($1='' or p.partner_type=$1)) select count(*) filter(where log.action='partner.link_accessed')::int accesses,count(distinct log.registration_id) filter(where log.action='registration.started')::int started,count(distinct log.registration_id) filter(where log.action='payment.approved')::int completed,count(distinct log.registration_id) filter(where log.action='payment.approved' and log.registration_id in(select registration_id from linked))::int converted,count(*) filter(where log.action in ('partner.link_rejected','payment.declined','payment.amount_mismatch','partner.persistence_failed','consistency.issue_detected'))::int failures from ${table.partnerAuditLogs} log join ${table.partners} p on p.id=log.partner_id where ($1='' or p.partner_type=$1)`, [partnerType || '']);
  const t=totals.rows[0]||{}; const accesses=Number(t.accesses||0),started=Number(t.started||0),completed=Number(t.completed||0),converted=Number(t.converted||0);
  return { generatedAt:new Date().toISOString(),totals:{accesses,started,completed,conversionRate:accesses?Number((converted*100/accesses).toFixed(2)):0,abandoned:Math.max(started-completed,0),abandonmentRate:started?Number((Math.max(started-completed,0)*100/started).toFixed(2)):0,failures:Number(t.failures||0)},partners:rows,pagination:{page,pageSize,total,totalPages:Math.ceil(total/pageSize)} };
}

export async function runPartnerConsistencyCheckInPostgres(actor = 'system:cron') {
  await ensurePostgresReady(); const client = await requirePool().connect(); const runId=randomUUID(); const now=new Date().toISOString();
  try { await client.query('begin');
    const issues = await client.query(`select * from (
      select r.partner_id,r.id registration_id,r.event_id,r.partner_type,'partner_without_discount' issue_code,'Atribuicao persistida sem desconto positivo' message
        from ${table.registrations} r where r.partner_id is not null and (r.discount_percentage<=0 or r.discount_amount<=0)
      union all select r.partner_id,r.id,r.event_id,r.partner_type,'partner_snapshot_incomplete','Snapshot de atribuicao incompleto'
        from ${table.registrations} r where r.partner_id is not null and (r.partner_name is null or r.partner_type is null or r.partner_link is null or r.partner_identified_at is null)
      union all select r.partner_id,r.id,r.event_id,r.partner_type,'partner_snapshot_pricing_mismatch','Calculo financeiro do snapshot e inconsistente'
        from ${table.registrations} r where r.partner_id is not null and (r.amount_cents<>r.final_price or r.original_price-r.discount_amount<>r.final_price or round(r.original_price*r.discount_percentage/100.0)::int<>r.discount_amount)
      union all select r.partner_id,r.id,r.event_id,r.partner_type,'payment_amount_mismatch','Pagamento diverge do valor final persistido na inscricao'
        from ${table.registrations} r join ${table.payments} pay on pay.registration_id=r.id where pay.amount_cents<>r.final_price or pay.amount_cents<>r.amount_cents
      union all select r.partner_id,r.id,r.event_id,r.partner_type,'payment_paid_registration_not_paid','Pagamento pago com inscricao em estado divergente'
        from ${table.registrations} r join ${table.payments} pay on pay.registration_id=r.id where pay.status='paid' and r.status<>'paid'
      union all select r.partner_id,r.id,r.event_id,r.partner_type,'registration_paid_payment_not_paid','Inscricao paga sem pagamento pago correspondente'
        from ${table.registrations} r left join ${table.payments} pay on pay.registration_id=r.id where r.status='paid' and (pay.id is null or pay.status<>'paid')
      union all select null::uuid,r.id,r.event_id,r.partner_type,'approved_without_partner','Pagamento aprovado com evidencia de atribuicao sem partner_id persistido'
        from ${table.registrations} r where r.status='paid' and r.partner_id is null and exists(select 1 from ${table.partnerAuditLogs} l where l.registration_id=r.id and l.action in ('discount.applied','partner.snapshot_persisted'))
      union all select null::uuid,r.id,r.event_id,r.partner_type,'plain_registration_has_partner_snapshot','Inscricao sem parceiro contem dados parciais de atribuicao ou desconto'
        from ${table.registrations} r where r.partner_id is null and (r.partner_name is not null or r.partner_type is not null or r.partner_link is not null or r.partner_identified_at is not null or r.discount_percentage<>0 or r.discount_amount<>0)
      union all select r.partner_id,r.id,r.event_id,r.partner_type,'invalid_partner_type','Tipo persistido fora do dominio permitido'
        from ${table.registrations} r where r.partner_id is not null and r.partner_type not in ('sports_advisory','influencer')
    ) issues`);
    for (const issue of issues.rows) {
      const key=`partner-consistency:${issue.issue_code}:${issue.registration_id}`;
      const entityLabel=issue.partner_type==='influencer'?'influenciador':'parceiro';
      await client.query(`insert into ${table.operationalAlerts} (id,dedupe_key,severity,alert_type,title,message,entity_type,entity_id,payload,status,detected_at) values ($1,$2,'critical',$3,$4,$5,'registration',$6,$7,'open',$8) on conflict(dedupe_key) do update set payload=excluded.payload,detected_at=excluded.detected_at,status=case when ${table.operationalAlerts}.status='resolved' then 'open' else ${table.operationalAlerts}.status end,resolved_at=null`, [randomUUID(),key,issue.issue_code,`Inconsistencia de ${entityLabel}`,issue.message,issue.registration_id,{runId,partnerId:issue.partner_id,partnerType:issue.partner_type||null},now]);
      await insertPartnerAudit(client,{partnerId:issue.partner_id,action:'consistency.issue_detected',userId:actor,registrationId:issue.registration_id,eventId:issue.event_id,metadata:{runId,issueCode:issue.issue_code,message:issue.message,partnerType:issue.partner_type||null,partner_type:issue.partner_type||null},createdAt:now});
    }
    await client.query('commit'); return {runId,checkedAt:now,issues:issues.rows.length};
  } catch(error){await client.query('rollback').catch(()=>undefined);throw error;} finally{client.release();}
}

export type OperationalAlertRecord = {
  id: string;
  dedupeKey: string;
  severity: 'info' | 'warning' | 'critical';
  alertType: string;
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  payload: Record<string, unknown>;
  status: 'open' | 'acknowledged' | 'resolved';
  detectedAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
};

function mapOperationalAlert(row: Record<string, unknown>): OperationalAlertRecord {
  return {
    id: String(row.id), dedupeKey: String(row.dedupe_key), severity: row.severity as OperationalAlertRecord['severity'],
    alertType: String(row.alert_type), title: String(row.title), message: String(row.message),
    entityType: row.entity_type ? String(row.entity_type) : null, entityId: row.entity_id ? String(row.entity_id) : null,
    payload: (row.payload || {}) as Record<string, unknown>, status: row.status as OperationalAlertRecord['status'],
    detectedAt: String(row.detected_at), acknowledgedAt: row.acknowledged_at ? String(row.acknowledged_at) : null,
    acknowledgedBy: row.acknowledged_by ? String(row.acknowledged_by) : null, resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
  };
}

export async function synchronizeOperationalAlertsInPostgres(alerts: Array<{
  dedupeKey: string; severity: 'info' | 'warning' | 'critical'; alertType: string; title: string; message: string;
  entityType?: string | null; entityId?: string | null; payload?: Record<string, unknown>;
}>) {
  const client = await requirePool().connect();
  const now = new Date().toISOString();
  try {
    await ensurePostgresReady();
    await client.query('begin');
    for (const alert of alerts) {
      const persisted = await client.query(
        `insert into ${table.operationalAlerts}
         (id, dedupe_key, severity, alert_type, title, message, entity_type, entity_id, payload, status, detected_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open',$10)
         on conflict (dedupe_key) do update set
           severity = excluded.severity, title = excluded.title, message = excluded.message,
           payload = excluded.payload,
           status = case when ${table.operationalAlerts}.status = 'resolved' then 'resolved' else ${table.operationalAlerts}.status end
         returning id`,
        [randomUUID(), alert.dedupeKey, alert.severity, alert.alertType, alert.title, alert.message, alert.entityType || null, alert.entityId || null, alert.payload || {}, now],
      );
      if (process.env.GOOGLE_SHEETS_ENABLED === 'true' && persisted.rows[0]?.id) {
        await client.query(
          `insert into ${table.googleSheetSyncs}
           (id,entity_type,entity_id,sheet_name,operation,status,row_number,attempts,last_attempt_at,synchronized_at,last_error,created_at,updated_at)
           values ($1,'alert',$2,'alerts','upsert','pending',null,0,null,null,null,$3,$3)
           on conflict (entity_type,entity_id,sheet_name) do update set status=case when ${table.googleSheetSyncs}.status='processing' then 'processing' else 'pending' end, updated_at=excluded.updated_at`,
          [randomUUID(), persisted.rows[0].id, now],
        );
      }
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export async function listOperationalAlertsInPostgres(filters: { status?: string; severity?: string; type?: string } = {}) {
  await ensurePostgresReady();
  const result = await requirePool().query(
    `select * from ${table.operationalAlerts}
     where ($1 = '' or status = $1) and ($2 = '' or severity = $2) and ($3 = '' or alert_type = $3)
     order by case severity when 'critical' then 1 when 'warning' then 2 else 3 end, detected_at desc limit 500`,
    [filters.status || '', filters.severity || '', filters.type || ''],
  );
  return result.rows.map(mapOperationalAlert);
}

export async function updateOperationalAlertInPostgres(input: {
  id: string; status: 'acknowledged' | 'resolved'; actor: string; actorRole: string;
  sessionId: string; ipAddress: string | null; userAgent: string | null; resolution: string;
}) {
  const client = await requirePool().connect();
  const now = new Date().toISOString();
  try {
    await ensurePostgresReady(); await client.query('begin');
    const result = await client.query(
      `update ${table.operationalAlerts} set status=$1,
       acknowledged_at=coalesce(acknowledged_at,$2), acknowledged_by=coalesce(acknowledged_by,$3),
       resolved_at=case when $1='resolved' then $2 else resolved_at end,
       payload=payload || $4::jsonb where id=$5 returning *`,
      [input.status, now, input.actor, JSON.stringify({ resolution: input.resolution }), input.id],
    );
    if (!result.rows[0]) { await client.query('rollback'); return null; }
    await client.query(
      `insert into ${table.auditLogs} (id,actor,actor_role,action,entity_type,entity_id,payload,session_id,ip_address,user_agent,created_at)
       values ($1,$2,$3,'alert.updated','alert',$4,$5,$6,$7,$8,$9)`,
      [randomUUID(), input.actor, input.actorRole, input.id, { status: input.status, resolution: input.resolution }, input.sessionId, input.ipAddress, input.userAgent, now],
    );
    await client.query('commit'); return mapOperationalAlert(result.rows[0]);
  } catch (error) { await client.query('rollback').catch(() => undefined); throw error; }
  finally { client.release(); }
}

export async function createCriticalOperationalAlertInPostgres(input: {
  dedupeKey: string; alertType: string; title: string; message: string; payload?: Record<string, unknown>;
}) {
  return synchronizeOperationalAlertsInPostgres([{ ...input, severity: 'critical', entityType: 'system', entityId: input.dedupeKey }]);
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

function mapIntegrationEvent(row: Record<string, unknown>): IntegrationEventRecord {
  return {
    id: String(row.id),
    provider: 'meta',
    eventName: row.event_name as IntegrationEventRecord['eventName'],
    eventId: String(row.event_id),
    entityType: 'registration',
    entityId: String(row.entity_id),
    eventTime: Number(row.event_time),
    eventSourceUrl: String(row.event_source_url),
    userData: (row.user_data || {}) as MetaUserData,
    clientContext: (row.client_context || {}) as MetaUserData,
    customData: (row.custom_data || {}) as MetaCustomData,
    status: row.status as IntegrationEventStatus,
    attemptCount: Number(row.attempt_count || 0),
    nextAttemptAt: row.next_attempt_at ? String(row.next_attempt_at) : null,
    lastAttemptAt: row.last_attempt_at ? String(row.last_attempt_at) : null,
    lastError: row.last_error ? String(row.last_error) : null,
    responseCode: row.response_code === null || row.response_code === undefined ? null : Number(row.response_code),
    eventsReceived: row.events_received === null || row.events_received === undefined ? null : Number(row.events_received),
    sentAt: row.sent_at ? String(row.sent_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function enqueueMetaIntegrationEventInPostgres(
  entityId: string,
  event: MetaServerEvent,
) {
  await ensurePostgresReady();
  const now = new Date().toISOString();
  const {
    client_ip_address,
    client_user_agent,
    fbc,
    fbp,
    ...hashedUserData
  } = event.user_data;
  const clientContext = {
    ...(client_ip_address ? { client_ip_address } : {}),
    ...(client_user_agent ? { client_user_agent } : {}),
    ...(fbc ? { fbc } : {}),
    ...(fbp ? { fbp } : {}),
  };
  const result = await requirePool().query(
    `insert into ${table.integrationEvents}
      (id,provider,event_name,event_id,entity_type,entity_id,event_time,event_source_url,user_data,client_context,custom_data,status,attempt_count,next_attempt_at,last_attempt_at,last_error,response_code,events_received,sent_at,created_at,updated_at)
     select $1,'meta',$2,$3,'registration',registration.id,$5,$6,$7,$8,$9,'pending',0,$10,null,null,null,null,null,$10,$10
     from ${table.registrations} registration
     where registration.id=$4 and registration.marketing_consent=true
     on conflict (provider,event_name,event_id) do nothing
     returning id`,
    [
      randomUUID(),
      event.event_name,
      event.event_id,
      entityId,
      event.event_time,
      event.event_source_url,
      hashedUserData,
      clientContext,
      event.custom_data,
      now,
    ],
  );
  return Boolean(result.rowCount);
}

export async function claimMetaIntegrationEventsInPostgres(limit: number, maxAttempts: number) {
  await ensurePostgresReady();
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
  const result = await requirePool().query(
    `with candidates as (
       select integration.id
       from ${table.integrationEvents} integration
       join ${table.registrations} registration on registration.id=integration.entity_id
       where integration.attempt_count < $1
         and registration.marketing_consent=true
         and integration.event_time >= extract(epoch from now() - interval '7 days')::bigint
         and (
           integration.status = 'pending'
           or (integration.status = 'failed' and integration.next_attempt_at is not null and integration.next_attempt_at::timestamptz <= $2::timestamptz)
           or (integration.status = 'processing' and integration.last_attempt_at::timestamptz <= $3::timestamptz)
         )
       order by integration.created_at asc
       for update of integration skip locked
       limit $4
     )
     update ${table.integrationEvents} target
     set status='processing',attempt_count=target.attempt_count+1,last_attempt_at=$2,updated_at=$2
     from candidates
     where target.id=candidates.id
     returning target.*`,
    [maxAttempts, now, staleBefore, Math.max(1, Math.min(limit, 20))],
  );
  return result.rows.map(mapIntegrationEvent);
}

export async function completeMetaIntegrationEventInPostgres(
  id: string,
  result: { responseCode: number; eventsReceived: number },
) {
  await ensurePostgresReady();
  const now = new Date().toISOString();
  await requirePool().query(
    `update ${table.integrationEvents}
     set status='sent',next_attempt_at=null,last_error=null,response_code=$1,events_received=$2,sent_at=$3,updated_at=$3
     where id=$4 and status='processing'`,
    [result.responseCode, result.eventsReceived, now, id],
  );
}

export async function failMetaIntegrationEventInPostgres(input: {
  id: string;
  errorCode: string;
  responseCode: number | null;
  retryAt: string | null;
}) {
  await ensurePostgresReady();
  const now = new Date().toISOString();
  const errorCode = /^[A-Z0-9_-]{1,100}$/.test(input.errorCode) ? input.errorCode : 'META_UNKNOWN_ERROR';
  await requirePool().query(
    `update ${table.integrationEvents}
     set status='failed',next_attempt_at=$1,last_error=$2,response_code=$3,events_received=null,updated_at=$4
     where id=$5 and status='processing'`,
    [input.retryAt, errorCode, input.responseCode, now, input.id],
  );
}

export async function withMetaConsentSendAuthorizationInPostgres<T>(
  registrationId: string,
  send: () => Promise<T>,
): Promise<{ authorized: false } | { authorized: true; result: T }> {
  await ensurePostgresReady();
  const client = await requirePool().connect();
  try {
    await client.query('begin');
    const consent = await client.query(
      `select marketing_consent
       from ${table.registrations}
       where id=$1
       for update`,
      [registrationId],
    );
    if (consent.rows[0]?.marketing_consent !== true) {
      await client.query('rollback');
      return { authorized: false };
    }

    // Serialize consent revocation with the actual external request. A revoke
    // either commits first and blocks this send, or becomes effective only
    // after the request has already finished.
    const result = await send();
    await client.query('commit');
    return { authorized: true, result };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function getMetaRegistrationSnapshotInPostgres(registrationId: string) {
  await ensurePostgresReady();
  const result = await requirePool().query(
    `select registration.id,registration.status,registration.amount_cents,registration.created_at,
            registration.paid_at,registration.confirmed_at,registration.payload,
            registration.marketing_consent,registration.marketing_consent_updated_at,
            event.id event_id,event.name event_name,
            payment.status payment_status,payment.amount_cents payment_amount_cents,payment.paid_at payment_paid_at,
            context.client_context,context.event_source_url
     from ${table.registrations} registration
     join ${table.events} event on event.id=registration.event_id
     left join ${table.payments} payment on payment.registration_id=registration.id
     left join lateral (
       select client_context,event_source_url
       from ${table.integrationEvents}
       where provider='meta' and entity_id=registration.id and client_context <> '{}'::jsonb
       order by created_at asc
       limit 1
     ) context on true
     where registration.id=$1
     limit 1`,
    [registrationId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    registrationId: String(row.id),
    status: row.status as RegistrationStatus,
    paymentStatus: row.payment_status as RegistrationStatus | undefined,
    amountCents: Number(row.payment_amount_cents ?? row.amount_cents),
    createdAt: String(row.created_at),
    paidAt: row.payment_paid_at || row.paid_at || row.confirmed_at
      ? String(row.payment_paid_at || row.paid_at || row.confirmed_at)
      : null,
    payload: row.payload as RegistrationFormData,
    marketingConsent: row.marketing_consent === true,
    marketingConsentUpdatedAt: row.marketing_consent_updated_at ? String(row.marketing_consent_updated_at) : null,
    eventId: String(row.event_id),
    eventName: String(row.event_name),
    clientContext: (row.client_context || {}) as MetaUserData,
    eventSourceUrl: row.event_source_url ? String(row.event_source_url) : null,
  };
}

export async function listPaidRegistrationsMissingMetaPurchaseInPostgres(limit = 20) {
  await ensurePostgresReady();
  const result = await requirePool().query(
    `select registration.id
     from ${table.registrations} registration
     join ${table.payments} payment on payment.registration_id=registration.id
     where registration.status='paid' and payment.status='paid'
       and registration.marketing_consent=true
       and coalesce(payment.paid_at,registration.paid_at,registration.confirmed_at)::timestamptz >= now() - interval '7 days'
       and not exists (
         select 1 from ${table.integrationEvents} integration
         where integration.provider='meta'
           and integration.event_name='Purchase'
           and integration.event_id='purchase_' || registration.id
       )
     order by coalesce(payment.paid_at,registration.paid_at,registration.confirmed_at) asc
     limit $1`,
    [Math.max(1, Math.min(limit, 100))],
  );
  return result.rows.map((row) => String(row.id));
}

export async function updateMetaMarketingConsentInPostgres(
  registrationIds: string[],
  marketingConsent: boolean,
) {
  await ensurePostgresReady();
  const ids = [...new Set(registrationIds)].slice(0, 8);
  if (ids.length === 0) return { updatedRegistrations: 0, blockedEvents: 0 };
  const client = await requirePool().connect();
  const now = new Date().toISOString();

  try {
    await client.query('begin');
    const registrations = await client.query(
      `update ${table.registrations}
       set marketing_consent=$1,
           marketing_consent_updated_at=$2,
           payload=jsonb_set(
             payload,
             '{meta}',
             coalesce(payload->'meta', '{}'::jsonb) || jsonb_build_object('marketingConsent', $1::boolean),
             true
           )
       where id=any($3::text[])
       returning id`,
      [marketingConsent, now, ids],
    );
    let blockedEvents = 0;
    if (!marketingConsent && registrations.rows.length > 0) {
      const matchedIds = registrations.rows.map((row) => String(row.id));
      const blocked = await client.query(
        `update ${table.integrationEvents}
         set status='failed',next_attempt_at=null,last_error='MARKETING_CONSENT_REVOKED',updated_at=$1
         where provider='meta'
           and entity_id=any($2::text[])
           and status in ('pending','failed')`,
        [now, matchedIds],
      );
      blockedEvents = blocked.rowCount || 0;
    }
    await client.query('commit');
    return { updatedRegistrations: registrations.rowCount || 0, blockedEvents };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function cleanupMetaClientContextInPostgres() {
  await ensurePostgresReady();
  const now = new Date().toISOString();
  const result = await requirePool().query(
    `update ${table.integrationEvents} integration
     set client_context='{}'::jsonb,updated_at=$1
     where client_context <> '{}'::jsonb
       and (
         event_time < extract(epoch from now() - interval '7 days')::bigint
         or exists (
           select 1 from ${table.integrationEvents} purchase
           where purchase.entity_id=integration.entity_id
             and purchase.provider='meta'
             and purchase.event_name='Purchase'
             and purchase.status='sent'
         )
         or exists (
           select 1 from ${table.registrations} registration
           where registration.id=integration.entity_id
             and registration.status in ('expired','cancelled','payment_failed','refunded')
             and registration.updated_at::timestamptz < now() - interval '24 hours'
         )
       )`,
    [now],
  );
  return result.rowCount || 0;
}

export async function getMetaIntegrationStatusInPostgres() {
  await ensurePostgresReady();
  const result = await requirePool().query(
    `select
       max(sent_at) filter (where status='sent') last_successful_event_at,
       count(*) filter (where status='failed' and updated_at::timestamptz >= now() - interval '24 hours')::int recent_failures,
       count(*) filter (where status='pending')::int pending_events
     from ${table.integrationEvents}`,
  );
  return {
    lastSuccessfulEventAt: result.rows[0]?.last_successful_event_at || null,
    recentFailures: Number(result.rows[0]?.recent_failures || 0),
    pendingEvents: Number(result.rows[0]?.pending_events || 0),
  };
}

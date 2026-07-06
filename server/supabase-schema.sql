create table if not exists "run-events" (
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

create table if not exists "run-distances" (
  id text primary key,
  event_id text not null references "run-events"(id),
  name text not null,
  distance_km integer not null,
  capacity integer not null,
  status text not null check (status in ('active', 'inactive'))
);

create table if not exists "run-lots" (
  id text primary key,
  event_id text not null references "run-events"(id),
  name text not null,
  price_cents integer not null,
  capacity integer not null,
  sold_count integer not null default 0,
  status text not null check (status in ('active', 'inactive', 'sold_out')),
  starts_at text not null,
  ends_at text not null
);

create table if not exists "run-registrations" (
  id text primary key,
  event_id text not null references "run-events"(id),
  distance_id text not null references "run-distances"(id),
  lot_id text not null references "run-lots"(id),
  cpf_hash text not null,
  status text not null,
  amount_cents integer not null,
  payload jsonb not null,
  created_at text not null,
  updated_at text not null,
  expires_at text,
  paid_at text,
  confirmed_at text,
  pending_email_sent_at text,
  confirmation_email_sent_at text,
  pending_email_last_attempt_at text,
  confirmation_email_last_attempt_at text,
  confirmation_email_provider text,
  confirmation_email_id text,
  confirmation_email_error text
  ,bib_number text
);

create table if not exists "run-payments" (
  id text primary key,
  registration_id text not null references "run-registrations"(id),
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

create table if not exists "run-payment-events" (
  id text primary key,
  payment_id text not null,
  provider_event_id text not null unique,
  event_type text not null,
  payload jsonb not null,
  received_at text not null
);

create table if not exists "run-check-ins" (
  id text primary key,
  registration_id text not null references "run-registrations"(id),
  status text not null check (status in ('checked_in')),
  checked_in_at text not null,
  checked_in_by text not null,
  notes text
);

create table if not exists "run-kit-deliveries" (
  id text primary key,
  registration_id text not null references "run-registrations"(id),
  status text not null check (status in ('delivered')),
  delivered_at text not null,
  delivered_by text not null,
  notes text
);

create table if not exists "run-audit-logs" (
  id text primary key,
  actor text not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  payload jsonb not null,
  created_at text not null
);

create table if not exists "run-partnership-leads" (
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

create index if not exists "run-registrations_cpf_hash_idx" on "run-registrations"(cpf_hash);
create index if not exists "run-registrations_status_idx" on "run-registrations"(status);
create index if not exists "run-payments_registration_id_idx" on "run-payments"(registration_id);
create unique index if not exists "run-check-ins_registration_id_idx" on "run-check-ins"(registration_id);
create unique index if not exists "run-kit-deliveries_registration_id_idx" on "run-kit-deliveries"(registration_id);
create index if not exists "run-audit-logs_entity_idx" on "run-audit-logs"(entity_type, entity_id);
create index if not exists "run-partnership-leads_status_idx" on "run-partnership-leads"(status);
create index if not exists "run-partnership-leads_created_at_idx" on "run-partnership-leads"(created_at);

alter table "run-registrations" add column if not exists expires_at text;
alter table "run-registrations" add column if not exists paid_at text;
alter table "run-registrations" add column if not exists confirmed_at text;
alter table "run-registrations" add column if not exists pending_email_sent_at text;
alter table "run-registrations" add column if not exists confirmation_email_sent_at text;
alter table "run-registrations" add column if not exists pending_email_last_attempt_at text;
alter table "run-registrations" add column if not exists confirmation_email_last_attempt_at text;
alter table "run-registrations" add column if not exists confirmation_email_provider text;
alter table "run-registrations" add column if not exists confirmation_email_id text;
alter table "run-registrations" add column if not exists confirmation_email_error text;
alter table "run-registrations" add column if not exists bib_number text;
create unique index if not exists "run-registrations_event_bib_idx" on "run-registrations"(event_id, bib_number) where bib_number is not null;
alter table "run-payments" add column if not exists expires_at text;
alter table "run-payments" add column if not exists paid_at text;
alter table "run-payments" add column if not exists gateway_status text;
alter table "run-payments" add column if not exists gateway_transaction_id text;
alter table "run-payments" add column if not exists gateway_payload jsonb;

insert into "run-events" (id, name, slug, status, date, start_time, location_name, city, state)
values (
  'funpace-run-2026',
  'FunPace Run 2026',
  'funpace-run-2026',
  'published',
  '2026-09-12',
  '06:00',
  'Complexo Madeira Mamore',
  'Porto Velho',
  'RO'
)
on conflict (id) do nothing;

insert into "run-distances" (id, event_id, name, distance_km, capacity, status)
values
  ('distance-10k', 'funpace-run-2026', '10K', 10, 300, 'active'),
  ('distance-5k', 'funpace-run-2026', '5K', 5, 500, 'active')
on conflict (id) do nothing;

insert into "run-lots" (id, event_id, name, price_cents, capacity, sold_count, status, starts_at, ends_at)
values (
  'lot-1',
  'funpace-run-2026',
  'Lote 1',
  7990,
  100,
  0,
  'active',
  '2026-06-01T00:00:00-04:00',
  '2026-07-31T23:59:59-04:00'
)
on conflict (id) do nothing;

update "run-lots"
set
  price_cents = 7990,
  capacity = 100
where id = 'lot-1';

update "run-registrations"
set
  status = 'expired',
  amount_cents = 7990,
  updated_at = now()::text,
  expires_at = coalesce(expires_at, now()::text)
where lot_id = 'lot-1'
  and status = 'pending_payment'
  and amount_cents <> 7990;

update "run-payments" payment
set
  status = 'expired',
  amount_cents = 7990,
  checkout_url = null,
  provider_payment_id = null,
  updated_at = now()::text,
  expires_at = coalesce(payment.expires_at, now()::text)
from "run-registrations" registration
where payment.registration_id = registration.id
  and registration.lot_id = 'lot-1'
  and payment.status = 'pending_payment'
  and payment.amount_cents <> 7990;

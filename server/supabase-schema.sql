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
  updated_at text not null
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
  updated_at text not null
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

create index if not exists "run-registrations_cpf_hash_idx" on "run-registrations"(cpf_hash);
create index if not exists "run-registrations_status_idx" on "run-registrations"(status);
create index if not exists "run-payments_registration_id_idx" on "run-payments"(registration_id);
create unique index if not exists "run-check-ins_registration_id_idx" on "run-check-ins"(registration_id);
create unique index if not exists "run-kit-deliveries_registration_id_idx" on "run-kit-deliveries"(registration_id);
create index if not exists "run-audit-logs_entity_idx" on "run-audit-logs"(entity_type, entity_id);

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
  6999,
  100,
  0,
  'active',
  '2026-06-01T00:00:00-04:00',
  '2026-07-31T23:59:59-04:00'
)
on conflict (id) do nothing;

update "run-lots"
set
  price_cents = 6999,
  capacity = 100
where id = 'lot-1';

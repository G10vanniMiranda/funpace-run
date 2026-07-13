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
  ends_at text not null,
  order_index integer not null default 0,
  continues_after_capacity boolean not null default false
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
  confirmation_email_sent_at text,
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

create table if not exists "run-google-sheet-sync" (
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

create table if not exists "run-admin-sessions" (
  id text primary key,
  actor text not null,
  role text not null check (role in ('administrator', 'finance', 'operation')),
  created_at text not null,
  expires_at text not null,
  revoked_at text,
  ip_address text,
  user_agent text
);

create table if not exists "run-admin-users" (
  id text primary key,
  email text not null unique,
  password_hash text not null,
  role text not null check (role in ('administrator', 'finance', 'operation')),
  created_at text not null,
  updated_at text not null,
  last_login_at text,
  disabled_at text
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
create unique index if not exists "run-payments_gateway_transaction_idx"
  on "run-payments"(gateway_transaction_id)
  where gateway_transaction_id is not null and gateway_transaction_id not like 'manual_reconcile_%';
create index if not exists "run-google-sheet-sync_status_idx" on "run-google-sheet-sync"(status);
create index if not exists "run-google-sheet-sync_entity_idx" on "run-google-sheet-sync"(entity_type, entity_id);
create index if not exists "run-google-sheet-sync_updated_at_idx" on "run-google-sheet-sync"(updated_at);
create unique index if not exists "run-check-ins_registration_id_idx" on "run-check-ins"(registration_id);
create unique index if not exists "run-kit-deliveries_registration_id_idx" on "run-kit-deliveries"(registration_id);
create index if not exists "run-audit-logs_entity_idx" on "run-audit-logs"(entity_type, entity_id);
create index if not exists "run-admin-sessions_actor_idx" on "run-admin-sessions"(actor);
create index if not exists "run-admin-sessions_expires_at_idx" on "run-admin-sessions"(expires_at);
create unique index if not exists "run-admin-users_email_idx" on "run-admin-users"(email);
create index if not exists "run-partnership-leads_status_idx" on "run-partnership-leads"(status);
create index if not exists "run-partnership-leads_created_at_idx" on "run-partnership-leads"(created_at);

alter table "run-registrations" add column if not exists expires_at text;
alter table "run-registrations" add column if not exists paid_at text;
alter table "run-registrations" add column if not exists confirmed_at text;
alter table "run-registrations" add column if not exists confirmation_email_sent_at text;
alter table "run-registrations" add column if not exists confirmation_email_last_attempt_at text;
alter table "run-registrations" add column if not exists confirmation_email_provider text;
alter table "run-registrations" add column if not exists confirmation_email_id text;
alter table "run-registrations" add column if not exists confirmation_email_error text;
alter table "run-registrations" add column if not exists bib_number text;
create unique index if not exists "run-registrations_event_bib_idx" on "run-registrations"(event_id, bib_number) where bib_number is not null;
alter table "run-lots" add column if not exists order_index integer not null default 0;
alter table "run-lots" add column if not exists continues_after_capacity boolean not null default false;
create index if not exists "run-lots_event_order_idx" on "run-lots"(event_id, order_index, starts_at);

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

alter table "run-payments" add column if not exists expires_at text;
alter table "run-payments" add column if not exists paid_at text;
alter table "run-payments" add column if not exists gateway_status text;
alter table "run-payments" add column if not exists gateway_transaction_id text;
alter table "run-payments" add column if not exists gateway_payload jsonb;
alter table "run-audit-logs" add column if not exists actor_role text;
alter table "run-audit-logs" add column if not exists session_id text;
alter table "run-audit-logs" add column if not exists ip_address text;
alter table "run-audit-logs" add column if not exists user_agent text;

insert into "run-events" (id, name, slug, status, date, start_time, location_name, city, state)
values (
  'funpace-run-2026',
  'FunPace Run 2026',
  'funpace-run-2026',
  'published',
  '2026-09-20',
  '06:00',
  'Complexo Madeira Mamore',
  'Porto Velho',
  'RO'
)
on conflict (id) do nothing;

update "run-events"
set
  date = '2026-09-20',
  start_time = '06:00',
  location_name = 'Complexo Madeira Mamore',
  city = 'Porto Velho',
  state = 'RO'
where id = 'funpace-run-2026';

insert into "run-distances" (id, event_id, name, distance_km, capacity, status)
values
  ('distance-10k', 'funpace-run-2026', '10K', 10, 300, 'active'),
  ('distance-5k', 'funpace-run-2026', '5K', 5, 500, 'active')
on conflict (id) do nothing;

insert into "run-lots" (id, event_id, name, price_cents, capacity, sold_count, status, starts_at, ends_at, order_index, continues_after_capacity)
values
  ('lot-1', 'funpace-run-2026', 'Lote 1', 7990, 100, 0, 'inactive', '2026-06-01T00:00:00-04:00', '2026-07-31T23:59:59-04:00', 1, false),
  ('lot-2', 'funpace-run-2026', 'Lote 2', 9990, 400, 0, 'active', '2026-08-01T00:00:00-04:00', '2026-08-31T23:59:59-04:00', 2, false),
  ('lot-3', 'funpace-run-2026', 'Lote 3', 13990, 100, 0, 'inactive', '2026-09-01T00:00:00-04:00', '2026-09-10T23:59:59-04:00', 3, false),
  ('lot-4', 'funpace-run-2026', 'Lote 4', 16990, 100, 0, 'inactive', '2026-09-11T00:00:00-04:00', '2026-09-20T23:59:59-04:00', 4, true)
on conflict (id) do update set
  event_id = excluded.event_id,
  name = excluded.name,
  price_cents = excluded.price_cents,
  capacity = excluded.capacity,
  status = case
    when "run-lots".status = 'inactive' then "run-lots".status
    when excluded.continues_after_capacity and excluded.status = 'active' then 'active'
    when "run-lots".sold_count >= excluded.capacity then 'sold_out'
    else excluded.status
  end,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  order_index = excluded.order_index,
  continues_after_capacity = excluded.continues_after_capacity;

with stale_pending as (
  select registration.id, registration.lot_id
  from "run-registrations" registration
  join "run-lots" lot on lot.id = registration.lot_id
  left join "run-payments" payment on payment.registration_id = registration.id
  where registration.status = 'pending_payment'
    and (
      lot.status <> 'active'
      or registration.amount_cents <> lot.price_cents
      or payment.id is null
      or payment.amount_cents <> lot.price_cents
    )
),
expired_registrations as (
  update "run-registrations" registration
  set
    status = 'expired',
    updated_at = now()::text,
    expires_at = coalesce(registration.expires_at, now()::text)
  from stale_pending
  where registration.id = stale_pending.id
  returning stale_pending.lot_id
),
released_lots as (
  select lot_id, count(*)::int as total
  from expired_registrations
  group by lot_id
)
update "run-lots" lot
set sold_count = greatest(lot.sold_count - released_lots.total, 0)
from released_lots
where lot.id = released_lots.lot_id;

update "run-payments" payment
set
  status = 'expired',
  checkout_url = null,
  provider_payment_id = null,
  updated_at = now()::text,
  expires_at = coalesce(payment.expires_at, now()::text)
from "run-registrations" registration
where payment.registration_id = registration.id
  and registration.status = 'expired'
  and payment.status = 'pending_payment'
  and (
    payment.checkout_url is not null
    or payment.provider_payment_id is not null
    or payment.amount_cents <> registration.amount_cents
  );

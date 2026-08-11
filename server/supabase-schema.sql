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
  marketing_consent boolean not null default false,
  marketing_consent_updated_at text,
  meta_context jsonb not null default '{}'::jsonb check (jsonb_typeof(meta_context) = 'object'),
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
  final_price integer not null,
  coupon_code text,
  coupon_applied_at text,
  coupon_used_at text,
  constraint "run-registrations_partner_pricing_check" check (
    original_price > 0 and final_price > 0 and discount_amount >= 0
    and discount_percentage >= 0 and discount_percentage < 100
    and original_price - discount_amount = final_price and amount_cents = final_price
  ),
  constraint "run-registrations_partner_metadata_check" check (
    (partner_id is null and partner_name is null and partner_type is null and coupon_code is null and discount_percentage = 0 and discount_amount = 0)
    or (partner_id is not null and partner_name is not null and partner_type is not null and coupon_code is null and discount_percentage > 0 and discount_amount > 0)
    or (partner_id is null and partner_name is null and partner_type is null and coupon_code is not null and discount_percentage > 0 and discount_amount > 0)
  )
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
  entity_type text not null check (entity_type in ('registration', 'payment', 'check_in', 'shirt_summary', 'lot_summary', 'alert', 'partnership', 'email', 'remarketing')),
  entity_id text not null,
  sheet_name text not null check (sheet_name in ('registrations', 'payments', 'shirts', 'check_in', 'lots', 'alerts', 'partnerships', 'emails', 'remarketing')),
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

create table if not exists "run-partners" (
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

alter table "run-partners" add column if not exists partner_type text;
update "run-partners" set partner_type = 'sports_advisory' where partner_type is null or btrim(partner_type) = '';
alter table "run-partners" alter column partner_type set default 'sports_advisory';
alter table "run-partners" alter column partner_type set not null;
alter table "run-partners" drop constraint if exists "run-partners_partner_type_check";
alter table "run-partners" add constraint "run-partners_partner_type_check" check (partner_type in ('sports_advisory', 'influencer'));
alter table "run-partners" drop constraint if exists "run-partners_discount_percentage_check";
alter table "run-partners" add constraint "run-partners_discount_percentage_check" check (discount_percentage > 0 and discount_percentage < 100);
alter table "run-partners" add column if not exists athlete_limit integer;
alter table "run-partners" drop constraint if exists "run-partners_athlete_limit_check";
alter table "run-partners" add constraint "run-partners_athlete_limit_check" check (athlete_limit is null or athlete_limit > 0);

alter table "run-registrations" add column if not exists partner_type text;
alter table "run-registrations" add column if not exists coupon_code text;
alter table "run-registrations" add column if not exists coupon_applied_at text;
alter table "run-registrations" add column if not exists coupon_used_at text;
update "run-registrations" registration set partner_type = partner.partner_type
from "run-partners" partner where registration.partner_id = partner.id and registration.partner_type is null;
alter table "run-registrations" drop constraint if exists "run-registrations_partner_type_check";
alter table "run-registrations" add constraint "run-registrations_partner_type_check" check (partner_type is null or partner_type in ('sports_advisory', 'influencer'));
alter table "run-registrations" drop constraint if exists "run-registrations_partner_metadata_check";
alter table "run-registrations" add constraint "run-registrations_partner_metadata_check" check (
  (partner_id is null and partner_name is null and partner_type is null and coupon_code is null and discount_percentage = 0 and discount_amount = 0)
  or (partner_id is not null and partner_name is not null and partner_type is not null and coupon_code is null and discount_percentage > 0 and discount_amount > 0)
  or (partner_id is null and partner_name is null and partner_type is null and coupon_code is not null and discount_percentage > 0 and discount_amount > 0)
);

create table if not exists "run-partner-audit-logs" (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid references "run-partners"(id),
  action text not null,
  user_id text,
  registration_id text references "run-registrations"(id),
  event_id text references "run-events"(id),
  old_data jsonb,
  new_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at text not null default (now()::text)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'run-registrations_partner_id_fkey') then
    alter table "run-registrations" add constraint "run-registrations_partner_id_fkey"
      foreign key (partner_id) references "run-partners"(id);
  end if;
end;
$$;

create index if not exists "run-registrations_cpf_hash_idx" on "run-registrations"(cpf_hash);
create index if not exists "run-registrations_status_idx" on "run-registrations"(status);
create index if not exists "run-registrations_partner_id_idx" on "run-registrations"(partner_id) where partner_id is not null;
create index if not exists "run-registrations_partner_type_status_created_idx" on "run-registrations"(partner_type,status,created_at desc) where partner_id is not null;
create index if not exists "run-registrations_partner_created_idx" on "run-registrations"(partner_id, created_at desc) where partner_id is not null;
create index if not exists "run-registrations_partner_status_created_idx" on "run-registrations"(partner_id, status, created_at desc) where partner_id is not null;
create index if not exists "run-registrations_partner_event_created_idx" on "run-registrations"(partner_id, event_id, created_at desc) where partner_id is not null;
create index if not exists "run-registrations_partner_city_idx" on "run-registrations"(lower((payload->>'city'))) where partner_id is not null and coalesce(payload->>'city', '') <> '';
create index if not exists "run-partners_type_status_idx" on "run-partners"(partner_type, status) where deleted_at is null;
create index if not exists "run-partner-audit_partner_created_idx" on "run-partner-audit-logs"(partner_id, created_at desc);
create index if not exists "run-partner-audit_registration_created_idx" on "run-partner-audit-logs"(registration_id, created_at asc);
create index if not exists "run-partner-audit_action_created_idx" on "run-partner-audit-logs"(action, created_at desc);
create index if not exists "run-partner-audit_event_created_idx" on "run-partner-audit-logs"(event_id, created_at desc);
create index if not exists "run-partner-audit_correlation_idx" on "run-partner-audit-logs"((metadata->>'correlationId')) where coalesce(metadata->>'correlationId','')<>'';

create or replace function prevent_partner_audit_mutation()
returns trigger language plpgsql set search_path = pg_catalog, public as $$ begin raise exception 'partner audit logs are immutable'; end; $$;
drop trigger if exists "run-partner-audit-immutable" on "run-partner-audit-logs";
create trigger "run-partner-audit-immutable" before update or delete on "run-partner-audit-logs"
for each row execute function prevent_partner_audit_mutation();

create or replace function protect_confirmed_partner_snapshot()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if old.confirmed_at is not null and (
    new.partner_id is distinct from old.partner_id or new.partner_name is distinct from old.partner_name
    or new.partner_type is distinct from old.partner_type
    or new.partner_link is distinct from old.partner_link or new.partner_identified_at is distinct from old.partner_identified_at
    or new.discount_percentage is distinct from old.discount_percentage or new.discount_amount is distinct from old.discount_amount
    or new.original_price is distinct from old.original_price or new.final_price is distinct from old.final_price
    or new.coupon_code is distinct from old.coupon_code or new.coupon_applied_at is distinct from old.coupon_applied_at
    or new.coupon_used_at is distinct from old.coupon_used_at
  ) then raise exception 'confirmed pricing snapshot is immutable'; end if;
  return new;
end; $$;
drop trigger if exists "run-registrations_partner_snapshot_immutable" on "run-registrations";
create trigger "run-registrations_partner_snapshot_immutable" before update on "run-registrations"
for each row execute function protect_confirmed_partner_snapshot();
create index if not exists "run-payments_registration_id_idx" on "run-payments"(registration_id);
create index if not exists "run-payments_status_updated_idx" on "run-payments"(status, updated_at desc);
create index if not exists "run-payment-events_payment_received_idx" on "run-payment-events"(payment_id, received_at asc);
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
create index if not exists "run-partners_status_idx" on "run-partners"(status);
create index if not exists "run-partners_deleted_at_idx" on "run-partners"(deleted_at) where deleted_at is null;

alter table "run-registrations" add column if not exists expires_at text;
alter table "run-registrations" add column if not exists paid_at text;
alter table "run-registrations" add column if not exists confirmed_at text;
alter table "run-registrations" add column if not exists marketing_consent boolean not null default false;
alter table "run-registrations" add column if not exists marketing_consent_updated_at text;
alter table "run-registrations" add column if not exists meta_context jsonb not null default '{}'::jsonb;
alter table "run-registrations" add column if not exists confirmation_email_sent_at text;
alter table "run-registrations" add column if not exists confirmation_email_last_attempt_at text;
alter table "run-registrations" add column if not exists confirmation_email_provider text;
alter table "run-registrations" add column if not exists confirmation_email_id text;
alter table "run-registrations" add column if not exists confirmation_email_error text;
alter table "run-registrations" add column if not exists pending_email_sent_at text;
alter table "run-registrations" add column if not exists pending_email_last_attempt_at text;
alter table "run-registrations" add column if not exists bib_number text;
alter table "run-registrations" add column if not exists partner_id uuid references "run-partners"(id);
alter table "run-registrations" add column if not exists partner_name text;
alter table "run-registrations" add column if not exists partner_type text;
alter table "run-registrations" add column if not exists discount_percentage numeric(5, 2) default 0;
alter table "run-registrations" add column if not exists discount_amount integer default 0;
alter table "run-registrations" add column if not exists original_price integer;
alter table "run-registrations" add column if not exists final_price integer;
alter table "run-registrations" add column if not exists coupon_code text;
alter table "run-registrations" add column if not exists coupon_applied_at text;
alter table "run-registrations" add column if not exists coupon_used_at text;
alter table "run-registrations" drop constraint if exists "run-registrations_coupon_snapshot_check";
alter table "run-registrations" add constraint "run-registrations_coupon_snapshot_check" check (
  (coupon_code is null and coupon_applied_at is null and coupon_used_at is null)
  or (coupon_code = upper(btrim(coupon_code)) and coupon_code <> '' and coupon_applied_at is not null)
);
update "run-registrations" set discount_percentage = coalesce(discount_percentage, 0), discount_amount = coalesce(discount_amount, 0), original_price = coalesce(original_price, amount_cents), final_price = coalesce(final_price, amount_cents);
alter table "run-registrations" alter column discount_percentage set not null;
alter table "run-registrations" alter column discount_amount set not null;
alter table "run-registrations" alter column original_price set not null;
alter table "run-registrations" alter column final_price set not null;
create or replace function public.run_registration_pricing_defaults() returns trigger language plpgsql set search_path = public as $$ begin new.discount_percentage := coalesce(new.discount_percentage, 0); new.discount_amount := coalesce(new.discount_amount, 0); new.original_price := coalesce(new.original_price, new.amount_cents); new.final_price := coalesce(new.final_price, new.amount_cents); return new; end; $$;
drop trigger if exists "run-registrations_pricing_defaults" on "run-registrations";
create trigger "run-registrations_pricing_defaults" before insert on "run-registrations" for each row execute function public.run_registration_pricing_defaults();
create unique index if not exists "run-registrations_event_bib_idx" on "run-registrations"(event_id, bib_number) where bib_number is not null;
create index if not exists "run-registrations_coupon_code_created_idx" on "run-registrations"(coupon_code, created_at desc) where coupon_code is not null;
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
security invoker
set search_path = pg_catalog, public
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
revoke execute on function public.run_select_lot_for_registration_number(text, integer) from public, anon, authenticated;

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

insert into "run-partners" (name, slug, discount_percentage, status)
values
  ('Runners Club', 'runners', 10, 'active'),
  ('Pace Team', 'pace', 10, 'active'),
  ('Alpha Running', 'alpha', 10, 'active')
on conflict (slug) do update set
  name = excluded.name,
  discount_percentage = excluded.discount_percentage,
  status = excluded.status,
  updated_at = now()::text;

with stale_pending as (
  select registration.id, registration.lot_id
  from "run-registrations" registration
  join "run-lots" lot on lot.id = registration.lot_id
  left join "run-payments" payment on payment.registration_id = registration.id
  where registration.status = 'pending_payment'
    and (
      lot.status <> 'active'
      or registration.original_price <> lot.price_cents
      or registration.amount_cents <> registration.final_price
      or payment.id is null
      or payment.amount_cents <> registration.final_price
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
  returning registration.id
)
select count(*) from expired_registrations;

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

create table if not exists "run-reconciliation-runs" (
  id text primary key, trigger_source text not null,
  mode text not null check (mode in ('dry_run', 'apply')),
  status text not null check (status in ('running', 'completed', 'failed')),
  checked_count integer not null default 0, corrected_count integer not null default 0,
  manual_review_count integer not null default 0, error_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb, started_at text not null,
  completed_at text, created_by text not null
);

create table if not exists "run-payment-reconciliations" (
  id text primary key, run_id text references "run-reconciliation-runs"(id),
  issue_key text not null unique, issue_code text not null,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  resolution_status text not null check (resolution_status in ('consistent', 'automatically_corrected', 'manual_review_required', 'resolved')),
  registration_id text references "run-registrations"(id), payment_id text references "run-payments"(id),
  gateway_transaction_id text, expected_amount_cents integer, gateway_amount_cents integer,
  details jsonb not null default '{}'::jsonb, first_detected_at text not null, last_detected_at text not null,
  resolved_at text, resolved_by text, resolution_notes text
);

create table if not exists "run-operational-alerts" (
  id text primary key, dedupe_key text not null unique,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  alert_type text not null, title text not null, message text not null,
  entity_type text, entity_id text, payload jsonb not null default '{}'::jsonb,
  status text not null check (status in ('open', 'acknowledged', 'resolved')),
  detected_at text not null, acknowledged_at text, acknowledged_by text, resolved_at text
);

create index if not exists "run-reconciliation-runs_started_idx" on "run-reconciliation-runs"(started_at desc);
create index if not exists "run-payment-reconciliations_status_idx" on "run-payment-reconciliations"(resolution_status, severity);
create index if not exists "run-operational-alerts_status_idx" on "run-operational-alerts"(status, severity, detected_at desc);

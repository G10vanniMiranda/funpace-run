begin;

alter table "run-registrations" add column if not exists coupon_code text;
alter table "run-registrations" add column if not exists coupon_applied_at text;
alter table "run-registrations" add column if not exists coupon_used_at text;

alter table "run-registrations" drop constraint if exists "run-registrations_partner_metadata_check";
alter table "run-registrations" add constraint "run-registrations_partner_metadata_check" check (
  (
    partner_id is null and partner_name is null and partner_type is null
    and coupon_code is null and discount_percentage = 0 and discount_amount = 0
  )
  or (
    partner_id is not null and partner_name is not null and partner_type is not null
    and coupon_code is null and discount_percentage > 0 and discount_amount > 0
  )
  or (
    partner_id is null and partner_name is null and partner_type is null
    and coupon_code is not null and discount_percentage > 0 and discount_amount > 0
  )
);

alter table "run-registrations" drop constraint if exists "run-registrations_coupon_snapshot_check";
alter table "run-registrations" add constraint "run-registrations_coupon_snapshot_check" check (
  (coupon_code is null and coupon_applied_at is null and coupon_used_at is null)
  or (
    coupon_code = upper(btrim(coupon_code))
    and coupon_code <> ''
    and coupon_applied_at is not null
  )
);

create index if not exists "run-registrations_coupon_code_created_idx"
  on "run-registrations"(coupon_code, created_at desc)
  where coupon_code is not null;

create or replace function public.protect_confirmed_partner_snapshot()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.confirmed_at is not null and (
    new.partner_id is distinct from old.partner_id
    or new.partner_name is distinct from old.partner_name
    or new.partner_type is distinct from old.partner_type
    or new.partner_link is distinct from old.partner_link
    or new.partner_identified_at is distinct from old.partner_identified_at
    or new.discount_percentage is distinct from old.discount_percentage
    or new.discount_amount is distinct from old.discount_amount
    or new.original_price is distinct from old.original_price
    or new.final_price is distinct from old.final_price
    or new.coupon_code is distinct from old.coupon_code
    or new.coupon_applied_at is distinct from old.coupon_applied_at
    or new.coupon_used_at is distinct from old.coupon_used_at
  ) then
    raise exception 'confirmed pricing snapshot is immutable';
  end if;
  return new;
end;
$$;

commit;

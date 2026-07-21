begin;

do $$
begin
  if exists (
    select 1
    from "run-partners"
    where discount_percentage <= 0 or discount_percentage >= 100
  ) then
    raise exception 'cannot enforce partner discount constraint: values must be greater than 0 and lower than 100';
  end if;
end;
$$;

alter table "run-partners"
  add column if not exists partner_type text;

update "run-partners"
set partner_type = 'sports_advisory'
where partner_type is null or btrim(partner_type) = '';

alter table "run-partners"
  alter column partner_type set default 'sports_advisory',
  alter column partner_type set not null;

alter table "run-partners"
  drop constraint if exists "run-partners_partner_type_check";
alter table "run-partners"
  add constraint "run-partners_partner_type_check"
  check (partner_type in ('sports_advisory', 'influencer'));

alter table "run-partners"
  drop constraint if exists "run-partners_discount_percentage_check";
alter table "run-partners"
  add constraint "run-partners_discount_percentage_check"
  check (discount_percentage > 0 and discount_percentage < 100);

create index if not exists "run-partners_type_status_idx"
  on "run-partners"(partner_type, status)
  where deleted_at is null;

alter table "run-registrations"
  add column if not exists partner_type text;

update "run-registrations" registration
set partner_type = partner.partner_type
from "run-partners" partner
where registration.partner_id = partner.id
  and registration.partner_type is null;

alter table "run-registrations"
  drop constraint if exists "run-registrations_partner_type_check";
alter table "run-registrations"
  add constraint "run-registrations_partner_type_check"
  check (partner_type is null or partner_type in ('sports_advisory', 'influencer'));

alter table "run-registrations"
  drop constraint if exists "run-registrations_partner_metadata_check";
alter table "run-registrations"
  add constraint "run-registrations_partner_metadata_check" check (
    (
      partner_id is null
      and partner_name is null
      and partner_type is null
      and discount_percentage = 0
      and discount_amount = 0
    )
    or (
      partner_id is not null
      and partner_name is not null
      and partner_type is not null
      and discount_percentage > 0
      and discount_amount > 0
    )
  );

create or replace function protect_confirmed_partner_snapshot()
returns trigger language plpgsql as $$
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
  ) then
    raise exception 'confirmed partner snapshot is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists "run-registrations_partner_snapshot_immutable" on "run-registrations";
create trigger "run-registrations_partner_snapshot_immutable"
before update on "run-registrations"
for each row execute function protect_confirmed_partner_snapshot();

commit;

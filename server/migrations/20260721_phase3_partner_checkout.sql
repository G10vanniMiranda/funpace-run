begin;

alter table "run-registrations" add column if not exists partner_id uuid references "run-partners"(id);
alter table "run-registrations" add column if not exists partner_name text;
alter table "run-registrations" add column if not exists discount_percentage numeric(5, 2) default 0;
alter table "run-registrations" add column if not exists discount_amount integer default 0;
alter table "run-registrations" add column if not exists original_price integer;
alter table "run-registrations" add column if not exists final_price integer;

update "run-registrations"
set
  discount_percentage = coalesce(discount_percentage, 0),
  discount_amount = coalesce(discount_amount, 0),
  original_price = coalesce(original_price, amount_cents),
  final_price = coalesce(final_price, amount_cents);

alter table "run-registrations" alter column discount_percentage set default 0;
alter table "run-registrations" alter column discount_percentage set not null;
alter table "run-registrations" alter column discount_amount set default 0;
alter table "run-registrations" alter column discount_amount set not null;
alter table "run-registrations" alter column original_price set not null;
alter table "run-registrations" alter column final_price set not null;

alter table "run-registrations" drop constraint if exists "run-registrations_partner_pricing_check";
alter table "run-registrations" add constraint "run-registrations_partner_pricing_check" check (
  original_price > 0
  and final_price > 0
  and discount_amount >= 0
  and discount_percentage >= 0
  and discount_percentage < 100
  and original_price - discount_amount = final_price
  and amount_cents = final_price
);

alter table "run-registrations" drop constraint if exists "run-registrations_partner_metadata_check";
alter table "run-registrations" add constraint "run-registrations_partner_metadata_check" check (
  (
    partner_id is null
    and partner_name is null
    and discount_percentage = 0
    and discount_amount = 0
  )
  or (
    partner_id is not null
    and partner_name is not null
    and discount_percentage > 0
    and discount_amount > 0
  )
);

create or replace function public.run_registration_pricing_defaults()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.discount_percentage := coalesce(new.discount_percentage, 0);
  new.discount_amount := coalesce(new.discount_amount, 0);
  new.original_price := coalesce(new.original_price, new.amount_cents);
  new.final_price := coalesce(new.final_price, new.amount_cents);
  return new;
end;
$$;

drop trigger if exists "run-registrations_pricing_defaults" on "run-registrations";
create trigger "run-registrations_pricing_defaults"
before insert on "run-registrations"
for each row execute function public.run_registration_pricing_defaults();

create index if not exists "run-registrations_partner_id_idx"
  on "run-registrations"(partner_id)
  where partner_id is not null;

commit;

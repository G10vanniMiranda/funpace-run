begin;

alter table "run-registrations" add column if not exists partner_link text;
alter table "run-registrations" add column if not exists partner_identified_at text;

update "run-registrations" registration
set partner_link = '/p/' || partner.slug,
    partner_identified_at = coalesce(registration.partner_identified_at, registration.created_at)
from "run-partners" partner
where registration.partner_id = partner.id
  and (registration.partner_link is null or registration.partner_identified_at is null);

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

create index if not exists "run-partner-audit_partner_created_idx"
  on "run-partner-audit-logs"(partner_id, created_at desc);
create index if not exists "run-partner-audit_registration_created_idx"
  on "run-partner-audit-logs"(registration_id, created_at asc);
create index if not exists "run-partner-audit_action_created_idx"
  on "run-partner-audit-logs"(action, created_at desc);
create index if not exists "run-partner-audit_event_created_idx"
  on "run-partner-audit-logs"(event_id, created_at desc);

create or replace function prevent_partner_audit_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'partner audit logs are immutable';
end;
$$;

drop trigger if exists "run-partner-audit-immutable" on "run-partner-audit-logs";
create trigger "run-partner-audit-immutable"
before update or delete on "run-partner-audit-logs"
for each row execute function prevent_partner_audit_mutation();

create or replace function protect_confirmed_partner_snapshot()
returns trigger language plpgsql as $$
begin
  if old.confirmed_at is not null and (
    new.partner_id is distinct from old.partner_id
    or new.partner_name is distinct from old.partner_name
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

revoke update, delete, truncate on "run-partner-audit-logs" from public;

commit;

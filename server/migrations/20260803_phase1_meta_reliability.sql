begin;

alter table public."run-registrations"
  add column if not exists meta_context jsonb not null default '{}'::jsonb;

alter table public."run-registrations"
  drop constraint if exists "run-registrations_meta_context_object_check";
alter table public."run-registrations"
  add constraint "run-registrations_meta_context_object_check"
  check (jsonb_typeof(meta_context) = 'object');

alter table public."run-integration-events"
  drop constraint if exists "run-integration-events_status_check";
alter table public."run-integration-events"
  add constraint "run-integration-events_status_check"
  check (status in ('pending', 'processing', 'sent', 'failed', 'dead'));

update public."run-integration-events"
set status = 'dead', updated_at = now()::text
where status = 'failed' and next_attempt_at is null;

commit;

-- Operational rollback: map dead rows back to failed, restore the original
-- four-status constraint, then remove meta_context. Historical rows safely
-- keep the empty default and no marketing identifiers are invented.

create table if not exists public."run-email-deliveries" (
  id text primary key,
  registration_id text not null references public."run-registrations"(id),
  kind text not null check (kind in ('confirmation')),
  recipient_email text not null,
  recipient_hash text not null check (recipient_hash ~ '^[0-9a-f]{64}$'),
  context_key text not null,
  idempotency_key text not null,
  provider text not null,
  provider_message_id text,
  status text not null check (status in ('attempting', 'sent', 'failed')),
  attempt_count integer not null default 1 check (attempt_count > 0),
  attempted_at text not null,
  sent_at text,
  failed_at text,
  error text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at text not null,
  updated_at text not null,
  constraint "run-email-deliveries_idempotency_key_key" unique (idempotency_key),
  constraint "run-email-deliveries_status_timestamps_check" check (
    (status = 'attempting' and sent_at is null and failed_at is null)
    or (status = 'sent' and sent_at is not null and failed_at is null and error is null and provider_message_id is not null)
    or (status = 'failed' and sent_at is null and failed_at is not null and error is not null)
  )
);

create unique index if not exists "run-email-deliveries_provider_message_id_idx"
  on public."run-email-deliveries"(provider, provider_message_id)
  where provider_message_id is not null and btrim(provider_message_id) <> '';

create index if not exists "run-email-deliveries_registration_created_idx"
  on public."run-email-deliveries"(registration_id, created_at asc);

create index if not exists "run-email-deliveries_status_attempted_idx"
  on public."run-email-deliveries"(status, attempted_at asc);

alter table public."run-google-sheet-sync"
  drop constraint if exists "run-google-sheet-sync_entity_type_check",
  add constraint "run-google-sheet-sync_entity_type_check"
    check (entity_type in ('registration', 'payment', 'check_in', 'shirt_summary', 'lot_summary', 'alert', 'partnership', 'email', 'email_delivery', 'remarketing', 'confirmed_payments_projection'));

begin;

create table if not exists "run-integration-events" (
  id text primary key,
  provider text not null check (provider in ('meta')),
  event_name text not null check (event_name in ('InitiateCheckout', 'CompleteRegistration', 'Purchase')),
  event_id text not null,
  entity_type text not null check (entity_type in ('registration')),
  entity_id text not null references "run-registrations"(id),
  event_time bigint not null,
  event_source_url text not null,
  user_data jsonb not null default '{}'::jsonb,
  client_context jsonb not null default '{}'::jsonb,
  custom_data jsonb not null default '{}'::jsonb,
  status text not null check (status in ('pending', 'processing', 'sent', 'failed')),
  attempt_count integer not null default 0,
  next_attempt_at text,
  last_attempt_at text,
  last_error text,
  response_code integer,
  events_received integer,
  sent_at text,
  created_at text not null,
  updated_at text not null,
  unique (provider, event_name, event_id)
);

create index if not exists "run-integration-events_retry_idx"
  on "run-integration-events"(status, next_attempt_at);

create index if not exists "run-integration-events_entity_idx"
  on "run-integration-events"(entity_type, entity_id, created_at);

commit;

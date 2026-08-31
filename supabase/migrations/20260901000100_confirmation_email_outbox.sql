-- EMAIL-OPS-002 Stage 2 — dedicated durable confirmation-email outbox.
-- Schema-only, additive, history-safe. Separate bounded context from
-- run-google-sheet-sync: this table holds the "a paid registration is owed a
-- confirmation email" obligation and nothing else. The obligation is enqueued
-- inside the SAME transaction that makes a registration paid, so a committed
-- PAID can never exist without a committed obligation.
create table if not exists public."run-email-outbox" (
  id text primary key,
  registration_id text not null references public."run-registrations"(id),
  event_id text,
  email_type text not null check (email_type in ('confirmation')),
  status text not null check (status in ('pending', 'processing', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at text not null,
  locked_at text,
  locked_by text,
  last_error text,
  source text,
  created_at text not null,
  updated_at text not null,
  processed_at text,
  -- One durable confirmation obligation per (registration, email_type). A
  -- duplicate payment webhook or a repeated confirmation pass is absorbed here.
  constraint "run-email-outbox_registration_type_key" unique (registration_id, email_type),
  constraint "run-email-outbox_status_shape_check" check (
    (status = 'pending' and locked_by is null)
    or (status = 'processing' and locked_at is not null and locked_by is not null)
    or (status = 'completed' and processed_at is not null)
    or (status = 'failed' and processed_at is not null)
  )
);

-- Oldest-eligible-first retry selection.
create index if not exists "run-email-outbox_due_idx"
  on public."run-email-outbox"(next_attempt_at asc)
  where status = 'pending';

-- Stale-lease reclaim for crashed workers.
create index if not exists "run-email-outbox_processing_idx"
  on public."run-email-outbox"(locked_at asc)
  where status = 'processing';

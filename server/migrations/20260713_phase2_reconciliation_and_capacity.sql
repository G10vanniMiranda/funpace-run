begin;

create table if not exists "run-reconciliation-runs" (
  id text primary key,
  trigger_source text not null,
  mode text not null check (mode in ('dry_run', 'apply')),
  status text not null check (status in ('running', 'completed', 'failed')),
  checked_count integer not null default 0,
  corrected_count integer not null default 0,
  manual_review_count integer not null default 0,
  error_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  started_at text not null,
  completed_at text,
  created_by text not null
);

create table if not exists "run-payment-reconciliations" (
  id text primary key,
  run_id text references "run-reconciliation-runs"(id),
  issue_key text not null unique,
  issue_code text not null,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  resolution_status text not null check (resolution_status in ('consistent', 'automatically_corrected', 'manual_review_required', 'resolved')),
  registration_id text references "run-registrations"(id),
  payment_id text references "run-payments"(id),
  gateway_transaction_id text,
  expected_amount_cents integer,
  gateway_amount_cents integer,
  details jsonb not null default '{}'::jsonb,
  first_detected_at text not null,
  last_detected_at text not null,
  resolved_at text,
  resolved_by text,
  resolution_notes text
);

create table if not exists "run-operational-alerts" (
  id text primary key,
  dedupe_key text not null unique,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  alert_type text not null,
  title text not null,
  message text not null,
  entity_type text,
  entity_id text,
  payload jsonb not null default '{}'::jsonb,
  status text not null check (status in ('open', 'acknowledged', 'resolved')),
  detected_at text not null,
  acknowledged_at text,
  acknowledged_by text,
  resolved_at text
);

create index if not exists "run-reconciliation-runs_started_idx" on "run-reconciliation-runs"(started_at desc);
create index if not exists "run-payment-reconciliations_status_idx" on "run-payment-reconciliations"(resolution_status, severity);
create index if not exists "run-payment-reconciliations_registration_idx" on "run-payment-reconciliations"(registration_id);
create index if not exists "run-operational-alerts_status_idx" on "run-operational-alerts"(status, severity, detected_at desc);

-- sold_count is a projection of confirmed sales. Active reservations are
-- calculated from pending registrations and their expiration timestamps.
update "run-lots" lot
set sold_count = (
  select count(*)::int from "run-registrations" registration
  where registration.lot_id = lot.id and registration.status = 'paid'
),
status = case
  when (
    select count(*)::int from "run-registrations" registration
    where registration.lot_id = lot.id
      and (
        registration.status = 'paid'
        or (registration.status = 'pending_payment' and (registration.expires_at is null or registration.expires_at::timestamptz > now()))
      )
  ) >= lot.capacity then 'sold_out'
  when lot.status = 'sold_out' then 'active'
  else lot.status
end;

commit;

-- EMAIL-OPS-003 Stage 2 - provider delivery lifecycle ingestion.
-- Schema-only, additive, history-safe. Separate bounded context: this holds the
-- append-only history of what Resend told us happened to a message AFTER
-- acceptance (delivered / delayed / bounced / complained / failed / suppressed),
-- plus a derived current-state on run-email-deliveries. It does NOT redefine
-- run-email-outbox.status or run-email-deliveries.status='sent', which remain
-- the operational obligation and the send-acceptance ledger.
--
-- No data writes. No historical lifecycle fabrication: existing rows keep
-- provider_lifecycle = NULL (conceptually "accepted only") until a real signed
-- provider event correlates to them.
create table if not exists public."run-email-provider-events" (
  id text primary key,
  -- Svix delivery id: the canonical webhook ingestion idempotency key.
  svix_id text not null,
  -- data.email_id from the payload == the id returned by POST /emails ==
  -- run-email-deliveries.provider_message_id. The ONLY correlation key. Never
  -- the recipient address (Production already has shared-email participants).
  email_id text not null,
  event_type text not null,
  provider text not null default 'resend',
  provider_created_at text not null,
  received_at text not null,
  delivery_id text references public."run-email-deliveries"(id),
  registration_id text references public."run-registrations"(id),
  recipient_hash text,
  reason_category text,
  reason_detail text,
  -- SHA-256 of the raw verified webhook body. The raw body itself is never
  -- stored (it carries to[], subject, headers).
  payload_digest text not null,
  created_at text not null,
  constraint "run-email-provider-events_svix_id_key" unique (svix_id),
  constraint "run-email-provider-events_recipient_hash_check"
    check (recipient_hash is null or recipient_hash ~ '^[0-9a-f]{64}$'),
  constraint "run-email-provider-events_payload_digest_check"
    check (payload_digest ~ '^[0-9a-f]{64}$'),
  constraint "run-email-provider-events_reason_category_check" check (
    reason_category is null or reason_category in (
      'accepted', 'delivered', 'delayed', 'hard', 'soft', 'complaint', 'failed', 'suppressed', 'unknown'
    )
  ),
  constraint "run-email-provider-events_reason_detail_len_check"
    check (reason_detail is null or length(reason_detail) <= 500)
);

create index if not exists "run-email-provider-events_email_id_idx"
  on public."run-email-provider-events"(email_id);

create index if not exists "run-email-provider-events_delivery_created_idx"
  on public."run-email-provider-events"(delivery_id, provider_created_at asc)
  where delivery_id is not null;

create index if not exists "run-email-provider-events_registration_created_idx"
  on public."run-email-provider-events"(registration_id, provider_created_at asc)
  where registration_id is not null;

create index if not exists "run-email-provider-events_type_received_idx"
  on public."run-email-provider-events"(event_type, received_at asc);

-- Additive, nullable derived lifecycle on the acceptance ledger. Legacy rows
-- and any not-yet-correlated row simply stay NULL. The existing
-- status = attempting|sent|failed CHECK is untouched.
alter table public."run-email-deliveries"
  add column if not exists provider_lifecycle text,
  add column if not exists provider_lifecycle_at text,
  add column if not exists provider_lifecycle_reason text;

alter table public."run-email-deliveries"
  drop constraint if exists "run-email-deliveries_provider_lifecycle_check";
alter table public."run-email-deliveries"
  add constraint "run-email-deliveries_provider_lifecycle_check" check (
    provider_lifecycle is null or provider_lifecycle in (
      'sent', 'delivery_delayed', 'delivered', 'bounced', 'complained', 'failed', 'suppressed'
    )
  );

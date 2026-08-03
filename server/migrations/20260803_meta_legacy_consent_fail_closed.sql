begin;

with rollout as (
  select to_char(
    transaction_timestamp() at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) as occurred_at
), legacy_registrations as (
  update public."run-registrations" registration
  set marketing_consent = false,
      marketing_consent_updated_at = rollout.occurred_at,
      payload = jsonb_set(
        registration.payload,
        '{meta}',
        coalesce(registration.payload->'meta', '{}'::jsonb)
          || jsonb_build_object('marketingConsent', false),
        true
      )
  from rollout
  returning registration.id, rollout.occurred_at
)
update public."run-integration-events" integration
set status = 'failed',
    next_attempt_at = null,
    last_error = 'LEGACY_MARKETING_CONSENT_FAIL_CLOSED',
    updated_at = legacy.occurred_at
from legacy_registrations legacy
where integration.provider = 'meta'
  and integration.entity_id = legacy.id
  and integration.status in ('pending', 'processing', 'failed');

alter table public."run-registrations" enable row level security;
alter table public."run-integration-events" enable row level security;

commit;

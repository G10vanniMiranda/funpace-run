begin;

alter table public."run-registrations"
  add column if not exists marketing_consent boolean not null default false;

alter table public."run-registrations"
  add column if not exists marketing_consent_updated_at text;

update public."run-registrations"
set marketing_consent = coalesce(payload #> '{meta,marketingConsent}', 'false'::jsonb) = 'true'::jsonb,
    marketing_consent_updated_at = coalesce(marketing_consent_updated_at, created_at)
where marketing_consent_updated_at is null;

alter table public."run-registrations" enable row level security;

commit;

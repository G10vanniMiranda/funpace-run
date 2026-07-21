create index if not exists "run-registrations_partner_created_idx"
  on "run-registrations" (partner_id, created_at desc)
  where partner_id is not null;

create index if not exists "run-registrations_partner_status_created_idx"
  on "run-registrations" (partner_id, status, created_at desc)
  where partner_id is not null;

create index if not exists "run-registrations_partner_event_created_idx"
  on "run-registrations" (partner_id, event_id, created_at desc)
  where partner_id is not null;

create index if not exists "run-registrations_partner_city_idx"
  on "run-registrations" (lower((payload->>'city')))
  where partner_id is not null and coalesce(payload->>'city', '') <> '';

create index concurrently if not exists "run-registrations_partner_type_status_created_idx"
  on "run-registrations"(partner_type, status, created_at desc)
  where partner_id is not null;

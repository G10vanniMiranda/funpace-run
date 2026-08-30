-- ADMIN-002 Stage 5C — support the executive dashboard / summary event push-down.
-- Single statement so scripts/apply-migrations.mjs runs it as a lone simple query
-- (no implicit transaction block) and CREATE INDEX CONCURRENTLY is permitted.
-- Do NOT add other statements to this file.
create index concurrently if not exists "run-registrations_event_status_idx"
  on "run-registrations" (event_id, status);

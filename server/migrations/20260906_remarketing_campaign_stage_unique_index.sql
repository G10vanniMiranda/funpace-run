-- ADMIN-UX-RELIABILITY Wave 4C Stage 2 — DB-backed idempotency for the manual
-- remarketing campaign-funnel event
-- (POST /api/admin/remarketing/campaigns/whatsapp_remarketing_volta10/events).
--
-- The application dedupe key is (action, payload->>'campaign', payload->>'personKey'),
-- restricted to the two funnel-stage actions. This PARTIAL unique index makes it
-- race-safe (the old in-memory `db.auditLogs.some(...)` was only serialised by
-- the accidental global 'funpace-run-write' advisory lock, which Wave 4C removes)
-- and is the ON CONFLICT arbiter for recordRemarketingCampaignEventsInPostgres.
--
-- Partial predicate => ZERO effect on any other audit action, including
-- 'remarketing.checkout_returned' (different handler, NULL personKey).
--
-- Single statement so scripts/apply-migrations.mjs runs it as a lone simple
-- query (no implicit transaction block) and CREATE UNIQUE INDEX CONCURRENTLY is
-- permitted. Do NOT add other statements to this file.
--
-- Precondition (run read-only BEFORE applying — must return zero rows):
--   select action, payload->>'campaign' c, payload->>'personKey' pk, count(*)
--     from "run-audit-logs"
--    where action in ('remarketing.eligible','remarketing.message_sent')
--    group by 1,2,3 having count(*) > 1;
-- Rollback:
--   drop index concurrently if exists "run-audit-logs_remarketing_campaign_stage_idx";
create unique index concurrently if not exists "run-audit-logs_remarketing_campaign_stage_idx"
  on "run-audit-logs" (action, (payload->>'campaign'), (payload->>'personKey'))
  where action in ('remarketing.eligible', 'remarketing.message_sent');

-- KIT-DELIVERY-EMAIL-001 Stage 1B — widen run-email-deliveries.kind to allow
-- 'event_campaign' alongside the existing 'confirmation'.
--
-- Metadata-only change: no column added, no index touched, no row rewritten.
-- Postgres validates the existing rows against the new CHECK when it is
-- added; every current row is kind='confirmation', which trivially satisfies
-- `kind in ('confirmation', 'event_campaign')`, so validation is effectively
-- instantaneous (a scan, not a rewrite) and there is nothing to migrate in
-- the data itself.
--
-- Idempotent: safe to re-run (the second run's DROP CONSTRAINT IF EXISTS is a
-- no-op once applied; the ADD CONSTRAINT below would only fail if run twice
-- without the drop, which this file guards against by always dropping first).
alter table public."run-email-deliveries"
  drop constraint if exists "run-email-deliveries_kind_check";

alter table public."run-email-deliveries"
  add constraint "run-email-deliveries_kind_check"
  check (kind in ('confirmation', 'event_campaign'));

-- Rollback (NOT executed by this file — documented for the release plan):
--   Only safe once zero rows have kind = 'event_campaign'. Running the DROP/
--   ADD below while any such row exists will fail the constraint validation
--   (by design — it must not silently delete campaign delivery history).
--
--   alter table public."run-email-deliveries"
--     drop constraint if exists "run-email-deliveries_kind_check";
--   alter table public."run-email-deliveries"
--     add constraint "run-email-deliveries_kind_check" check (kind in ('confirmation'));

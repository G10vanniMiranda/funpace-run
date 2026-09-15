-- SERVICE-SWAP-001 Stage 2C — two-layered safety model that permits an
-- explicitly authorized, narrowly-defined zero-value "service swap"
-- registration WITHOUT opening a hidden free-checkout path through a
-- misconfigured commercial lot.
--
-- Layer A: commercial lots must always have a strictly positive price. Today
-- `updateLotConfigurationInPostgres` only rejects a NEGATIVE price
-- (`priceCents < 0`), so `price_cents = 0` is currently DB-legal on
-- `run-lots` even though nothing ever configures a lot that way. This closes
-- that path structurally: with this constraint in place, ordinary public
-- checkout (which derives `amount_cents`/`final_price` directly from
-- `lot.price_cents` whenever no coupon/partner applies — see
-- server/index.ts:1933,1954) can never again produce a zero-value
-- registration, because the lot it reads from can never be priced at 0.
--
-- Layer B: `run-registrations_partner_pricing_check` gains ONE narrow
-- additional branch — `original_price = 0 AND final_price = 0 AND
-- discount_amount = 0 AND discount_percentage = 0 AND amount_cents = 0` —
-- exclusively for the service_swap primitive's own INSERT (see
-- createServiceSwapRegistrationInPostgres in server/database.ts), which sets
-- all five of those fields to exactly 0 and never touches partner/coupon
-- fields. The existing branch (full-price / partner-discount / coupon
-- registrations, all requiring `final_price > 0`) is preserved byte-for-byte;
-- this is a pure OR-addition, not a relaxation of the existing rule. Combined
-- with Layer A, no public-facing code path can satisfy this new branch —
-- only a deliberate, explicit zero-value insert can.
--
-- No column added, no index touched, no row rewritten. Both ALTERs are a
-- validation scan against the existing, unchanged data — every current
-- `run-lots` row already has price_cents > 0 (7990-16990 in both homolog and
-- Production, verified read-only before writing this migration) and every
-- current `run-registrations` row already satisfies the untouched first
-- branch, so validation is effectively instantaneous.
--
-- Idempotent: safe to re-run (DROP CONSTRAINT IF EXISTS before each ADD).

-- Layer A — commercial lots must always be priced.
alter table public."run-lots"
  add constraint "run-lots_price_cents_check"
  check (price_cents > 0);

-- Layer B — the narrow, explicit zero-value service_swap branch.
alter table public."run-registrations"
  drop constraint if exists "run-registrations_partner_pricing_check";

alter table public."run-registrations"
  add constraint "run-registrations_partner_pricing_check"
  check (
    (
      original_price > 0 and final_price > 0 and discount_amount >= 0
      and discount_percentage >= 0 and discount_percentage < 100
      and original_price - discount_amount = final_price
      and amount_cents = final_price
    )
    or
    (
      original_price = 0 and final_price = 0
      and discount_amount = 0 and discount_percentage = 0
      and amount_cents = 0
    )
  );

-- Rollback (NOT executed by this file — documented for the release plan):
--   Layer A can be reverted any time (no row will ever violate its absence):
--     alter table public."run-lots" drop constraint if exists "run-lots_price_cents_check";
--   Layer B can be reverted to the OLD (single-branch) definition ONLY once
--   zero rows exist with final_price = 0 (i.e. no real service_swap
--   registration has been created, or all have been handled/removed first —
--   reverting while any such row exists will fail the constraint validation
--   by design, exactly like the kit-delivery event_campaign migration above):
--     alter table public."run-registrations" drop constraint if exists "run-registrations_partner_pricing_check";
--     alter table public."run-registrations" add constraint "run-registrations_partner_pricing_check"
--       check (original_price > 0 and final_price > 0 and discount_amount >= 0 and discount_percentage >= 0
--              and discount_percentage < 100 and original_price - discount_amount = final_price and amount_cents = final_price);

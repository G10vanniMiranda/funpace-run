-- ADMIN-IAM-001 Stage 1 — data primitives for individual administrative identities.
--
-- Schema-only. Additive. Backward-compatible with the currently deployed auth code:
--   * the existing bootstrap-shaped "run-admin-users" row keeps working unchanged;
--   * name / created_by / disabled_by are NULLABLE at the DB level and are enforced
--     only at the IAM API boundary (IAM-2/3), never for the legacy bootstrap row;
--   * password_hash becomes nullable so a pending-invite account can exist before
--     its owner sets a password. Every existing row already has a hash, so dropping
--     NOT NULL touches no data.
--
-- No data writes. No account creation. No bootstrap change. No endpoint. No email.

alter table public."run-admin-users" add column if not exists name text;
alter table public."run-admin-users" add column if not exists created_by text;
alter table public."run-admin-users" add column if not exists disabled_by text;

alter table public."run-admin-users" alter column password_hash drop not null;

-- Single-use invite / password-reset tokens. Only the SHA-256 hash of the
-- high-entropy bearer token is stored; the raw token is returned once to the
-- issuer and is never persisted or logged.
--
-- Two independent terminal facts, never conflated (audit / incident review):
--   consumed_at  -> the USER completed the flow (accepted invite / set password);
--   revoked_at   -> the SYSTEM invalidated it (a replacement token was issued, or
--                   the account was disabled).
create table if not exists public."run-admin-auth-tokens" (
  id text primary key,
  user_id text not null,
  purpose text not null check (purpose in ('invite', 'reset')),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  email_snapshot text not null,
  expires_at text not null,
  consumed_at text,
  revoked_at text,
  created_by text,
  created_at text not null
);

-- Defensive: if an earlier revision of this migration already created the table
-- without revoked_at (e.g. on a preview environment), add the column now.
alter table public."run-admin-auth-tokens" add column if not exists revoked_at text;

-- O(1) lookup by hash for the future accept flow; also blocks any hash reuse.
create unique index if not exists "run-admin-auth-tokens_token_hash_idx"
  on public."run-admin-auth-tokens"(token_hash);

create index if not exists "run-admin-auth-tokens_user_purpose_idx"
  on public."run-admin-auth-tokens"(user_id, purpose);

-- INVARIANT: at most ONE OUTSTANDING token per (user_id, purpose), where
-- "outstanding" = neither consumed by the user nor revoked by the system. The
-- predicate is time-stable (no NOW()): a token that merely EXPIRED still occupies
-- the slot until the IAM-2/3 issuance transaction revokes it (revoked_at = now())
-- immediately before inserting the replacement. Expired tokens therefore never
-- block a legitimate re-invite / re-reset, and every historical row is kept.
drop index if exists "run-admin-auth-tokens_one_active_idx";
create unique index if not exists "run-admin-auth-tokens_one_outstanding_idx"
  on public."run-admin-auth-tokens"(user_id, purpose)
  where consumed_at is null and revoked_at is null;

-- Supports revoke-all-sessions-for-user and "active sessions" counts.
create index if not exists "run-admin-sessions_actor_active_idx"
  on public."run-admin-sessions"(actor) where revoked_at is null;

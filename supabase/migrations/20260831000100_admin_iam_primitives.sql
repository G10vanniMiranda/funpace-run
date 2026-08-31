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

create table if not exists public."run-admin-auth-tokens" (
  id text primary key,
  user_id text not null,
  purpose text not null check (purpose in ('invite', 'reset')),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  email_snapshot text not null,
  expires_at text not null,
  consumed_at text,
  created_by text,
  created_at text not null
);

-- O(1) lookup by hash for the future accept flow; also blocks any hash reuse.
create unique index if not exists "run-admin-auth-tokens_token_hash_idx"
  on public."run-admin-auth-tokens"(token_hash);

create index if not exists "run-admin-auth-tokens_user_purpose_idx"
  on public."run-admin-auth-tokens"(user_id, purpose);

-- Invariant: at most ONE unconsumed token per (user_id, purpose). An expired but
-- unconsumed token still occupies the slot; the IAM-2/3 issuance transaction
-- consumes the previous outstanding token before inserting a new one. This partial
-- unique index is the DB-level guard for that invariant.
create unique index if not exists "run-admin-auth-tokens_one_active_idx"
  on public."run-admin-auth-tokens"(user_id, purpose) where consumed_at is null;

-- Supports revoke-all-sessions-for-user and "active sessions" counts.
create index if not exists "run-admin-sessions_actor_active_idx"
  on public."run-admin-sessions"(actor) where revoked_at is null;

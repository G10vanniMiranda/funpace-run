begin;

create table if not exists "run-google-sheet-sync" (
  id text primary key,
  entity_type text not null check (entity_type in ('registration', 'payment', 'check_in', 'shirt_summary')),
  entity_id text not null,
  sheet_name text not null check (sheet_name in ('registrations', 'payments', 'shirts', 'check_in')),
  operation text not null check (operation in ('upsert', 'replace')),
  status text not null check (status in ('pending', 'processing', 'synchronized', 'failed')),
  row_number integer,
  attempts integer not null default 0,
  last_attempt_at text,
  synchronized_at text,
  last_error text,
  created_at text not null,
  updated_at text not null,
  unique (entity_type, entity_id, sheet_name)
);

create index if not exists "run-google-sheet-sync_status_idx" on "run-google-sheet-sync"(status);
create index if not exists "run-google-sheet-sync_entity_idx" on "run-google-sheet-sync"(entity_type, entity_id);
create index if not exists "run-google-sheet-sync_updated_at_idx" on "run-google-sheet-sync"(updated_at);

commit;

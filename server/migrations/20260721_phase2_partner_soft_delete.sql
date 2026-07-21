begin;

alter table "run-partners" add column if not exists deleted_at text;

create index if not exists "run-partners_deleted_at_idx"
  on "run-partners"(deleted_at)
  where deleted_at is null;

commit;

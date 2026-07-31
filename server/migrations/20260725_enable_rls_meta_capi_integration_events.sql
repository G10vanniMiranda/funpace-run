begin;

alter table public."run-integration-events"
  enable row level security;

commit;

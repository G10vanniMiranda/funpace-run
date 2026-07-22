begin;

alter table "run-partners"
  add column if not exists athlete_limit integer;

alter table "run-partners"
  drop constraint if exists "run-partners_athlete_limit_check";

alter table "run-partners"
  add constraint "run-partners_athlete_limit_check"
  check (athlete_limit is null or athlete_limit > 0);

commit;

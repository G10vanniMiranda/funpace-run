begin;

alter table "run-registrations"
  add column if not exists pending_email_sent_at text;

alter table "run-registrations"
  add column if not exists pending_email_last_attempt_at text;

commit;

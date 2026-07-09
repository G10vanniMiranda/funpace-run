begin;

alter table "run-registrations" drop column if exists pending_email_sent_at;
alter table "run-registrations" drop column if exists pending_email_last_attempt_at;

commit;

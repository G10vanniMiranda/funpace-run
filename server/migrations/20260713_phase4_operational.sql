begin;

alter table "run-google-sheet-sync" drop constraint if exists "run-google-sheet-sync_entity_type_check";
alter table "run-google-sheet-sync" drop constraint if exists "run-google-sheet-sync_sheet_name_check";
alter table "run-google-sheet-sync" add constraint "run-google-sheet-sync_entity_type_check"
  check (entity_type in ('registration', 'payment', 'check_in', 'shirt_summary', 'lot_summary', 'alert', 'partnership', 'email'));
alter table "run-google-sheet-sync" add constraint "run-google-sheet-sync_sheet_name_check"
  check (sheet_name in ('registrations', 'payments', 'shirts', 'check_in', 'lots', 'alerts', 'partnerships', 'emails'));

create index if not exists "run-registrations_paid_at_idx" on "run-registrations"(paid_at) where status = 'paid';
create index if not exists "run-registrations_created_at_idx" on "run-registrations"(created_at desc);
create index if not exists "run-registrations_lot_status_expires_idx" on "run-registrations"(lot_id, status, expires_at);
create index if not exists "run-payments_status_paid_at_idx" on "run-payments"(status, paid_at desc);
create index if not exists "run-payment-events_received_at_idx" on "run-payment-events"(received_at desc);
create index if not exists "run-audit-logs_created_at_idx" on "run-audit-logs"(created_at desc);

commit;

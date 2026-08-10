begin;

alter table "run-google-sheet-sync" drop constraint if exists "run-google-sheet-sync_entity_type_check";
alter table "run-google-sheet-sync" drop constraint if exists "run-google-sheet-sync_sheet_name_check";

alter table "run-google-sheet-sync" add constraint "run-google-sheet-sync_entity_type_check"
  check (entity_type in ('registration', 'payment', 'check_in', 'shirt_summary', 'lot_summary', 'alert', 'partnership', 'email', 'remarketing'));
alter table "run-google-sheet-sync" add constraint "run-google-sheet-sync_sheet_name_check"
  check (sheet_name in ('registrations', 'payments', 'shirts', 'check_in', 'lots', 'alerts', 'partnerships', 'emails', 'remarketing'));

commit;

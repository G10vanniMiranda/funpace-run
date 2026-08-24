alter table public."run-google-sheet-sync"
  drop constraint if exists "run-google-sheet-sync_entity_type_check",
  add constraint "run-google-sheet-sync_entity_type_check"
    check (entity_type in ('registration', 'payment', 'check_in', 'shirt_summary', 'lot_summary', 'alert', 'partnership', 'email', 'remarketing', 'confirmed_payments_projection')),
  drop constraint if exists "run-google-sheet-sync_sheet_name_check",
  add constraint "run-google-sheet-sync_sheet_name_check"
    check (sheet_name in ('registrations', 'payments', 'shirts', 'check_in', 'lots', 'alerts', 'partnerships', 'emails', 'remarketing', 'confirmed_payments'));

begin;

alter function public.prevent_partner_audit_mutation()
  set search_path = pg_catalog, public;

alter function public.protect_confirmed_partner_snapshot()
  set search_path = pg_catalog, public;

alter function public.run_select_lot_for_registration_number(text, integer)
  security invoker;

alter function public.run_select_lot_for_registration_number(text, integer)
  set search_path = pg_catalog, public;

revoke execute on function public.run_select_lot_for_registration_number(text, integer)
  from public, anon, authenticated;

commit;

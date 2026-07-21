begin;

create index if not exists "run-payments_status_updated_idx"
  on "run-payments"(status, updated_at desc);

create index if not exists "run-payment-events_payment_received_idx"
  on "run-payment-events"(payment_id, received_at asc);

create index if not exists "run-partner-audit_correlation_idx"
  on "run-partner-audit-logs"((metadata->>'correlationId'))
  where coalesce(metadata->>'correlationId', '') <> '';

commit;

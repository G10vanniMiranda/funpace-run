-- Phase 1: financial idempotency for verified InfinitePay transactions.
-- Manual legacy markers are deliberately excluded because they are not gateway NSUs.
create unique index if not exists "run-payments_gateway_transaction_idx"
  on "run-payments"(gateway_transaction_id)
  where gateway_transaction_id is not null
    and gateway_transaction_id not like 'manual_reconcile_%';

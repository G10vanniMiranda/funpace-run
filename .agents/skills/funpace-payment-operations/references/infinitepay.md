# InfinitePay Contract

## GENERIC-PROMOTABLE

- Never trust unsigned, unauthenticated, or otherwise unverified external payment evidence.
- Treat checkout creation, notification delivery, provider verification, local persistence, and downstream side effects as separate stages with separate evidence.
- A webhook or redirect is not absolute proof by itself when the integration requires server-to-server verification. Authenticate and normalize the message, then use the provider's authoritative verification path.
- Persist real provider identifiers exactly as returned and under their correct meaning. Never synthesize an identifier to pass validation or deduplication.
- Make repeated delivery safe with stable event/transaction keys, uniqueness enforcement, and state-aware idempotency. Do not translate at-least-once delivery into duplicate financial effects.
- On timeout or ambiguous response, inspect provider and local state before retry. A network error does not prove failure.

## FUNPACE-SPECIFIC

### Checkout and verification

- InfinitePay owns the checkout and its response. FUNPACE may request a link only when payment creation is enabled and must persist the actual checkout/provider result rather than manufacturing one.
- The current server-to-server `payment_check` requires the configured handle plus the real order, transaction, and checkout identifiers. It returns paid state and amount evidence; confirm the current provider contract before use.
- Payment confirmation must remain guarded by the environment's payment-confirmation controls. A local script or administrative request does not bypass those controls.
- Do not treat a webhook, checkout return, copied transaction number, or local `paid` field alone as conclusive. Corroborate the real InfinitePay check, expected amount, persisted registration/payment pair, and event/audit history.

### Amount and state

- Compare the provider's amount and paid amount, when present, with registration amount, final price, and payment amount in cents. Missing or divergent provider amount is a stop condition, not permission to assume success.
- Represent a confirmed InfinitePay payment as provider `infinitepay` only when InfinitePay was actually involved and the required evidence path passed.
- Preserve real `provider_payment_id`, transaction identifier, gateway status, and provider payload according to their actual meanings. Do not move manual evidence into these fields as if it came from InfinitePay.

### Events and idempotency

- Inspect `provider_event_id` and provider transaction reuse before applying effects. Duplicate delivery to an already-paid registration/payment should be recognized without incrementing lot, reallocating bib, or recreating the financial transition.
- Do not create an artificial webhook or fake provider event for reconciliation. Reconciliation reads real provider evidence and compares it with local state.
- If the previous request timed out or its result is ambiguous, check InfinitePay and authoritative database state before any retry. Stop while transaction, event, amount, or state remains unresolved.

### Side effects and reporting

- Keep payment confirmation separate from confirmation email, Google Sheets, Meta/CAPI, partner dashboards, and summaries. Repair those systems through their owning workflows without replaying InfinitePay payment confirmation.
- Marketing consent remains independent. Never infer consent or emit an artificial marketing event merely because a valid payment was confirmed or regularized.
- Report the provider verification method, observed paid/amount response, matched local rows, event/dedup status, financial change, non-financial side effects, and `ZERO MUTATION` when auditing only. Do not expose raw payload secrets or unnecessary identifiers.

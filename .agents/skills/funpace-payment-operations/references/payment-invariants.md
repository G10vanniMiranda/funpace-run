# Payment Invariants

## GENERIC-PROMOTABLE

### Financial source of truth and evidence hierarchy

Payment confirmation is a corroborated conclusion, not a single field or message. Prove the provider-specific evidence path and the effective database model before changing state.

Use this hierarchy while preserving provenance:

1. Authenticated provider verification for a gateway payment, or authorized original external-payment evidence for a genuinely manual flow.
2. Compatible persisted payment and business-entity states read from the authoritative database.
3. Deduplicated payment events and immutable audit history that explain how the state was reached.
4. Related lot, bib, pricing, partner/coupon, and side-effect records that corroborate consequences.
5. Receipts, screenshots, copied identifiers, or human reports that have not passed the required verification path.

Lower-ranked evidence can initiate an investigation but cannot impersonate higher-ranked evidence. Label facts `OBSERVED`, conclusions `INFERRED`, and unsupported claims `UNVERIFIED`. A webhook is transport evidence; its authority depends on authentication, normalization, deduplication, and any server-to-server verification required by the system.

### Provider and state integrity

- Preserve the actual payment rail and provider. An external/manual payment must not be represented as a gateway-confirmed payment.
- Never fabricate checkout, provider response, payment check, webhook, provider payment ID, transaction ID, NSU, TXID, EndToEndId, or event.
- Define allowed transitions from the effective model. `pending`, `expired`, `cancelled`, `refunded`, courtesy, discount, and `paid` are not interchangeable.
- Do not silently reuse an expired, cancelled, old-price, or old-lot registration when the correct architecture requires a new record. Classify records as `CURRENT` or `HISTORICAL` and preserve history.
- If courtesy or refund/cancellation has no supported model and workflow, stop with `REVIEW REQUIRED: PRODUCT DECISION REQUIRED`.

### Amount and idempotency

- Use the currency and integer minor unit required by the system. Compare expected/original price, discount, final price, amount received, and persisted payment amount.
- Do not silently round a mismatch or infer a discount. A mismatch stops confirmation until partner/coupon rules and the authoritative final price are proven.
- Before retry, prove current registration/payment state, existing provider identifiers, payment event, bib, lot delta, and audit record.
- Deduplicate by the strongest stable provider or operation key supported by the workflow. If a previous result is ambiguous, re-read authoritative state and stop until the outcome is known.

### Auditability and side-effect separation

- A financial administrative action records actor, reason, amount, method/provider, previous and next state, provider involvement, evidence class, and relevant partner context.
- Keep audit history append-only or use an explicit compensating action. Never delete history to make records appear clean.
- Financial state is distinct from email, Sheets, analytics, marketing, dashboards, and summaries. Failure of a non-financial side effect does not reverse payment and is not a reason to replay it.
- Do not generate marketing lifecycle events during administrative correction unless the current contract specifically requires them and execution is authorized. Valid payment does not grant marketing consent.

## FUNPACE-SPECIFIC

### Canonical payment state

- PostgreSQL is authoritative. The current confirmation invariant conceptually requires `run-registrations.status = 'paid'` and the related `run-payments.status = 'paid'`, compatible persisted amounts, and provider-appropriate evidence. Confirm the effective code/schema before relying on these names.
- `run-payment-events` and audit relations explain transition provenance and deduplication; they do not independently prove provider truth.
- For InfinitePay, require its real verification path and amount evidence. For external/manual PIX, use the distinct administrative model described in `manual-pix.md`.

### Pricing, partner, and coupon

- Current pricing snapshots include registration amount, original price, discount amount, final price, and payment amount. They must agree according to the effective constraints.
- Establish partner or coupon attribution before the confirmed snapshot becomes immutable. Do not change a confirmed partner/pricing snapshot silently.
- Inspect current constraints before combining partner and coupon. The present model treats the two attribution modes as mutually exclusive and requires internally consistent discount fields.
- A discount changes price; it does not prove payment. Courtesy is neither discount nor manual payment.

### Lot and bib

- Payment confirmation can affect lot occupancy and `sold_count`. Capture a baseline, execute only the established atomic path, and verify post-state by registration/payment identity.
- A global `sold_count` delta is not attributable proof under concurrency. Correlate registrations and use Operational Reconciliation when the observed delta includes other activity.
- Capacity considers confirmed registrations and active temporary reservations in the current implementation. Inspect the effective selection/locking rules before a write.
- Bib allocation currently occurs during confirmation under transactional locking, with uniqueness scoped by event. Verify generation, scope, collision, and sequencing; never invent or overwrite a bib outside the authorized mechanism.

### Events, audit, and atomic workflow

- Confirm event type, provider event identity, uniqueness constraint, deduplication behavior, and payload provenance. Aim for effectively-once financial effects even when delivery is at least once.
- Gateway confirmation and manual administration use distinct event types. A manual operation must never emit a fake gateway event.
- Registration, payment, lot increment, bib, event, and audit effects that form one confirmation should follow the current transaction and lock contract. Direct SQL that omits one effect or bypasses a trigger is not an equivalent shortcut.
- Audit previous/next state, actor, reason, amount, provider/method, provider involvement, and partner context when applicable.

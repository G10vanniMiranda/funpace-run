---
name: funpace-payment-operations
description: Govern FUNPACE payment semantics, provider evidence, financial state, amounts, manual PIX, refunds, idempotency, and payment-linked lot, bib, partner, coupon, event, audit, or reconciliation decisions. Do not trigger for layout, Git-only, deploy-only, Sheets-only, or schema-only work without financial meaning.
---

# FUNPACE Payment Operations

## Objective and authority

Establish whether a FUNPACE financial state is supported by authoritative evidence and define a safe operation without fabricating provider facts. This skill owns payment-domain semantics; it does not grant production access or write authority.

For a real financial write, use `funpace-production-safety` and its L4 safeguards. Use `funpace-database-audit` to prove effective schema, constraints, transaction, and lock behavior. Invoke `funpace-operational-reconciliation` when evidence must be compared across provider, database, or projection, and whenever an aggregate count or before/after delta must be attributed to stable registration/payment keys. Use `funpace-release-gate` only when files will be versioned or promoted.

## Boundary

### USE WHEN

Use for payments; `paid`, `pending_payment`, expired, cancelled, or refund states; InfinitePay; PIX; manual/external payment; gateway checks; payment events; financial reconciliation; amount inconsistency; payment-linked lot or bib effects; partner/coupon pricing; or idempotency of a financial operation.

### DO NOT USE WHEN

Do not use for layout-only, deploy-only, Git-only, non-financial Google Sheets, or database-schema audits with no financial consequence. Do not absorb production authorization, database mechanics, cross-system drift classification, or release control from their owning skills.

## Financial evidence

Never infer “paid” from one signal. Prove the effective model first; the current conceptual invariant requires both registration and payment to be `paid`, with compatible amounts and evidence appropriate to the provider. A schema or workflow change may alter the proof, so inspect current code and catalog before a critical operation.

Keep evidence categories explicit:

- **OBSERVED**: provider verification, authoritative persisted row, event, immutable audit, or inspected constraint.
- **INFERRED**: conclusion derived from named observations and assumptions.
- **UNVERIFIED**: human report, screenshot, receipt, webhook, identifier, or state not authenticated through its required path.

Read [references/payment-invariants.md](references/payment-invariants.md) for the evidence hierarchy, state model, amounts, and FUNPACE relations. For InfinitePay, read [references/infinitepay.md](references/infinitepay.md). For an external/manual PIX, read [references/manual-pix.md](references/manual-pix.md).

## Read-only preflight

Before proposing any financial mutation:

1. Identify the person/entity without exposing unnecessary PII and distinguish `CURRENT` from `HISTORICAL` registrations.
2. Inspect registration, payment, payment events, audit, provider evidence, partner/coupon snapshot, lot, bib, and prior attempts.
3. Classify the case: gateway-confirmed payment, external/manual payment, courtesy, discount, pending, expired, cancelled, refund, or unsupported/product decision.
4. Compare expected price, discount, final price, amount received, and persisted payment amount in integer cents. Do not silently round or tolerate currency ambiguity.
5. Prove whether the operation already happened before considering retry.

## Operation flow

1. Record target, requested mode, exact authorization, provider involvement, and evidence quality.
2. Establish current and historical state using authoritative read paths.
3. Prove amount, partner/coupon rules, capacity, bib uniqueness, event deduplication, audit requirements, and the atomic workflow.
4. Separate the **FINANCIAL STATE** from email, Sheets, Meta/CAPI, dashboards, summaries, and other **NON-FINANCIAL SIDE EFFECTS**. Do not repeat a payment to repair telemetry or projection delivery.
5. Route any real write to Production Safety. Use the smallest authorized canary, the established application workflow, post-write authoritative reads, and a credible rollback or compensating plan.
6. Preserve audit history. Never create a fake checkout, webhook, provider response, provider payment ID, transaction ID, NSU, TXID, EndToEndId, `payment_check`, or provider event.

Use [checklists/payment-operation.md](checklists/payment-operation.md) for an actual or proposed payment operation.

## Stop conditions

Stop with `REVIEW REQUIRED` or `BLOCKED` for ambiguous provider or currency, insufficient evidence, amount divergence, duplicate active registration/payment, event or bib collision, lot capacity risk, partner/coupon conflict, immutable snapshot conflict, ambiguous previous execution, unknown rollback, unsupported courtesy/refund model, a requested invariant bypass, or a platform guardrail. Never blind-retry a financial operation.

## Output

Report: `TARGET`, `AUTHORIZATION`, `CURRENT STATE`, `HISTORICAL STATE`, `PROVIDER`, `EVIDENCE`, `AMOUNT`, `PARTNER/COUPON`, `LOT/BIB`, `EVENT/AUDIT`, `SIDE EFFECTS`, `CHANGED` or `ZERO MUTATION`, `VALIDATED`, `ROLLBACK`, and `VERDICT`. Use `PRODUCT DECISION REQUIRED` as a reason under `REVIEW REQUIRED`, not as write permission.

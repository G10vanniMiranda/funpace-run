---
name: funpace-production-safety
description: Govern FUNPACE production access and external writes involving real databases, services, credentials, Vercel Production, Supabase Production, Google Sheets, or payments. Do not trigger for purely static local edits or code analysis without real-system access.
---

# FUNPACE Production Safety

## Objective and authority

Keep production work evidence-based, explicitly authorized, bounded, auditable, and recoverable. This skill may veto an unsafe mutation. Loading it does **not** authorize a mutation.

Distinguish the requested mode before acting:

- **ANALYZE**: inspect read-only evidence and report facts.
- **PLAN**: design an operation without changing state.
- **PREPARE**: create local artifacts or commands, but do not execute external writes.
- **EXECUTE**: produce an external effect only when the task gives unequivocal authorization for the proven target and scope.

## Boundary

Use when work touches production, a real database or service, credentials, Vercel Production, Supabase Production, a real Google Sheet, payments, or any external write. If applicability is uncertain, use this skill.

Do not use for a purely static local task, code analysis with no external access, or local documentation that contains no real data. Keep ordinary local work proportional; do not impose production ceremony on it.

Domain semantics remain with the relevant domain skill. Safety governs authorization, risk, evidence, execution boundaries, and recovery.

## Preconditions

Before an external mutation:

1. Record the requested mode and exact authorization.
2. Prove project, account, environment, resource, subject, and source of truth using read-only evidence.
3. Classify the operation and blast radius:
   - **L0 — read-only/local**: observe only; preserve zero-mutation evidence.
   - **L1 — local write**: review scope and preserve unrelated work; normal local authorization is sufficient.
   - **L2 — reversible non-production external write**: prove target, capture baseline, define rollback, and obtain task authorization.
   - **L3 — production operational write**: require explicit production authorization, checkpoint or backup, bounded canary, post-write audit, and tested or credible rollback.
   - **L4 — financial, security, or high-impact production write**: require authoritative evidence, unambiguous subject and amount/scope, explicit authorization, strongest available checkpoint, smallest viable canary, independent after-state verification, and no retry while outcome is ambiguous.
4. Select the smallest write that can satisfy the request.

For the detailed evidence and safeguards per level, read [references/safety-contract.md](references/safety-contract.md). For an actual L2–L4 operation, use [checklists/production-operation.md](checklists/production-operation.md).

## Essential flow

1. Inspect read-only and separate **OBSERVED** facts from **INFERRED** conclusions.
2. Capture before-state and a zero-mutation baseline.
3. State target, scope, write mechanism, expected after-state, retry behavior, and rollback.
4. Reconfirm authorization immediately before the write.
5. Execute one bounded canary when the operation is authorized.
6. Verify the after-state from an authoritative read path before expanding.
7. Stop at the authorized scope; audit and report with [templates/operation-report.md](templates/operation-report.md).

## Stop conditions

Stop and return `REVIEW REQUIRED` or `BLOCKED` when:

- the environment, source of truth, user, or target is not proven;
- unexpected PII is exposed or a secret appears in output;
- a required backup/checkpoint is absent or rollback is unknown;
- blast radius exceeds authorization or state drift is detected;
- financial evidence diverges across authoritative sources;
- a platform guardrail blocks the action;
- a prior execution has an ambiguous outcome; or
- retryability is unknown.

Never bypass a guardrail automatically. Never retry an ambiguous write until authoritative evidence proves whether it occurred.

## Related skills and output

Route to, but do not automatically load, `funpace-database-audit`, `funpace-payment-operations`, `funpace-google-sheets-ops`, `funpace-vercel-production`, or `funpace-release-gate` when their domains apply.

At minimum report: mode, risk level, proven target, authorization, observed baseline, intended or actual change, validation, rollback, and verdict. Use only `PASS`, `REVIEW REQUIRED`, `BLOCKED`, or `ROLLBACK REQUIRED` as the verdict.

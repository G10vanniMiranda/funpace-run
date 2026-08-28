---
name: funpace-google-sheets-ops
description: Operate and diagnose FUNPACE Google Sheets projections, outbox tasks, retries, leases, structure gates, backlog recovery, and key-level reconciliation. Do not trigger for visual-only styling, unrelated payments, frontend work, or Git-only tasks.
---

# FUNPACE Google Sheets Operations

## Objective and authority

Keep Google Sheets as a reliable, rebuildable projection of authoritative FUNPACE data. This skill owns pipeline mechanics: enqueue, claim, lease, retry classification, projection building, upsert or replacement, structure validation, reconciliation, cron behavior, backlog recovery, and technical writer access. It does not grant access to a real spreadsheet or authorize an external write.

PostgreSQL is the source of truth. Google Sheets is a projection layer. Never repair PostgreSQL from a sheet, accept a manual sheet edit as canonical evidence, or use a sheet alone to prove a financial state. When systems diverge, follow `database -> projection builder -> sheet` and preserve source data.

## Boundary

### USE WHEN

Use for the Google Sheets API, `run-google-sheet-sync`, outbox state, synchronization, retry or lease behavior, failed or stuck tasks, `PERMANENT` failures, projections, `upsertRow`, `replaceRows`, spreadsheet structure, service accounts, Sheets cron jobs, backlog recovery, Remarketing, Pagamentos Confirmados, or source-to-sheet reconciliation.

### DO NOT USE WHEN

Do not use for visual design alone, web frontend UI, payments with no Sheets consequence, deploys with no Sheets pipeline, or pure Git work. `funpace-sheets-ux` owns presentation. Payment Operations owns financial semantics. Operational Reconciliation owns cross-system drift classification, while this skill owns Sheets mechanics.

For real Sheets access or writes, invoke `funpace-production-safety`, prove the spreadsheet, project, account, environment, scope, and authorization, and use a bounded canary. For database facts, use `funpace-database-audit`. For comparisons across source, outbox, and sheet, use `funpace-operational-reconciliation` and compare keys, not counts alone.

## Read-only diagnosis

1. Define the target tab, population, stable key, expected cardinality, timeframe, timezone, status scope, and exclusions.
2. Read the source projection, relevant outbox tasks, structure/header contract, and sheet state without exposing secrets or unnecessary PII.
3. Separate producer health from sheet appearance. A visually correct tab can still have a stalled producer or stale tasks.
4. Classify missing, extras, duplicates, mismatch, stale, orphan, schema/header, configuration, permission, or unknown evidence.
5. Record `ZERO MUTATION` unless an external write is explicitly authorized.

## Outbox and replay rules

Treat `pending`, `processing`, `synchronized`, and `failed` as distinct lifecycle states. Inspect entity type and ID, sheet name, operation, attempt count, lease evidence, row hint, last error, timestamps, and retryability. `failed` never means retryable by itself. A `PERMANENT` classification, exhausted attempts, missing entity, incompatible header, invalid data, configuration fault, or permission issue must be investigated before replay.

A claim must have one winner under concurrency. Recover `processing` only after the proven lease expires. Do not invent a new lock when the current claim/lease contract already supplies exclusivity, and do not retry while the outcome of a previous write is ambiguous.

Read [references/outbox-and-projections.md](references/outbox-and-projections.md) for detailed upsert, full-projection, Remarketing, Pagamentos Confirmados, and recovery contracts. Use [checklists/sheets-reconciliation.md](checklists/sheets-reconciliation.md) for an audit or replay proposal.

## Safe operation flow

1. Run the structure gate and verify the tab, exact technical header, and expected columns before an important sync. Do not rename technical headers for aesthetics.
2. Validate the projection before writing. For keyed rows, prove the actual key column and update-or-append without duplicate keys. For full projections, write header/data, verify, then clear only the stale tail.
3. Choose a deterministic, low-PII, idempotent, observable canary. Verify status transition, sheet effect, zero duplicates, and unchanged source.
4. Expand gradually when authorized: one task, then a small batch such as 5, then 10 or 20, then the remainder only if audits remain clean.
5. Reconcile source, tasks, and sheet by stable keys after each wave. Report missing, extras, duplicates, failures, and retry classes.

## Stop conditions and output

Stop with `REVIEW REQUIRED` or `BLOCKED` for unproven target or key, header mismatch, `PERMANENT` or unknown retryability, orphan, duplicate key, ambiguous prior write, service-account permission uncertainty, unexplained drift, excessive batch scope, or a guardrail. Never replay hundreds of tasks blindly.

Report: `TARGET`, `SOURCE OF TRUTH`, `SHEET`, `KEY`, `STRUCTURE`, `OUTBOX`, `PROJECTION`, `MISSING`, `EXTRAS`, `DUPLICATES`, `FAILED`, `RETRYABILITY`, `CANARY`, `BATCH`, `POST-AUDIT`, `ZERO MUTATION` or `CHANGED`, and `VERDICT`.

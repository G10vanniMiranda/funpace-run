---
name: funpace-operational-reconciliation
description: Reconcile FUNPACE records across systems by key and classify missing, extra, duplicate, mismatched, stale, orphaned, historical, schema, or configuration drift. Do not trigger for single-system audits, ordinary local edits, or automatic correction work.
---

# FUNPACE Operational Reconciliation

## Objective

Compare evidence from two or more systems, prove meaningful divergence, and recommend a bounded next step. The default flow is `detect -> classify -> correlate -> explain -> recommend`, never `detect -> mutate`.

## Boundary

### USE WHEN

Use for cross-system comparisons such as PostgreSQL versus Google Sheets, database versus outbox, database versus gateway evidence, runtime versus configured environment, or local versus remote migration history. Use when the question concerns missing, extras, duplicates, mismatches, stale projections, orphans, or historical drift.

### DO NOT USE WHEN

Do not use for a database-only fact that `funpace-database-audit` can answer, a single-system implementation task, ordinary local editing, or a request whose only goal is to execute an already approved correction. This skill classifies discrepancies; it does not own provider, Sheets pipeline, database, or deployment mechanics.

## Preconditions: comparable universe

Before comparing, define:

- **population**: the exact entities eligible for comparison;
- **key**: the stable identity used on every side;
- **timeframe** and timezone semantics;
- **status scope** and lifecycle point;
- **source of truth** for each field or decision;
- **exclusions** such as test, deleted, pending, archived, or legitimately delayed records.

Do not compare raw counts from different universes. Prefer key-level comparison; equal totals can conceal both missing and duplicate rows.

## Metrics and evidence

Record `EXPECTED` and `OBSERVED`, then calculate where applicable:

- `MISSING`: expected keys absent from the observed side;
- `EXTRAS`: observed keys outside the expected universe;
- `DUPLICATES`: repeated keys where uniqueness is expected;
- `MISMATCH`: same key with conflicting authoritative fields;
- `STALE`: a projection older than its source under proven timestamp semantics;
- `ORPHAN`: a task/reference whose entity no longer exists;
- `UNCLASSIFIED`: evidence insufficient for a supported category.

For an operation with two audits, preserve `BEFORE`, `AFTER`, and `DELTA` using identical definitions.

## Core workflow

1. Invoke Production Safety when real production or external access is involved; remain read-only unless correction is explicitly authorized elsewhere.
2. Prove each target and obtain database facts through `funpace-database-audit` when PostgreSQL participates.
3. Define the comparable universe, key, timeframe, statuses, source authority, and exclusions.
4. Capture zero-mutation baselines from every system.
5. Normalize only proven representational differences; preserve raw evidence.
6. Compare keys first, then fields and freshness within matched keys.
7. Classify each discrepancy using [references/drift-taxonomy.md](references/drift-taxonomy.md).
8. Correlate causes and separate OBSERVED evidence from INFERRED explanations.
9. Report and recommend. Do not correct, replay, delete, or retry unless a later task supplies explicit scoped authorization and the relevant domain skill.

For a read-only cross-system audit, use [checklists/zero-mutation-audit.md](checklists/zero-mutation-audit.md). Reuse the Production Safety operation report when its risk boundary applies.

## Stop conditions

Stop with `REVIEW REQUIRED` or `BLOCKED` when the universe is undefined, keys are incompatible, source of truth is ambiguous, timezone/timeframe semantics conflict, counts are not comparable, drift cannot be supported by evidence, or a correction is implied without explicit authorization. Never retry an orphan blindly or silently repair historical drift during an unrelated task.

## Relationships and output

Database Audit proves database facts; this skill compares those facts with another system. Future `funpace-google-sheets-ops` owns outbox/projection mechanics, while this skill owns the comparison result. Provider semantics remain with Payment Operations.

Minimum output: `UNIVERSE`, `KEY`, `EXPECTED`, `OBSERVED`, `MISSING`, `EXTRAS`, `DUPLICATES`, `MISMATCH`, `CLASSIFICATION`, `ZERO MUTATION` or `CHANGED`, and `VERDICT`. Counts without key evidence must be labeled insufficient.

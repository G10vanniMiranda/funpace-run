# Sheets Reconciliation Checklist

## TARGET
- [ ] Project, environment, spreadsheet, tab, mode, scope, and authorization are proven.

## SOURCE OF TRUTH
- [ ] PostgreSQL population, field authority, timeframe, statuses, and exclusions are explicit.

## SHEET
- [ ] Sheet is treated as a rebuildable projection, never canonical evidence.

## HEADER
- [ ] Tab exists and exact technical headers/column count pass the structure gate.

## KEY
- [ ] Stable key, key column, normalization, and expected cardinality are proven.

## OUTBOX
- [ ] Entity, operation, status, attempts, lease, timestamps, row hint, and error are inspected.

## PROJECTION
- [ ] Builder universe and row widths are validated before any write.

## MISSING
- [ ] Expected keys absent from the sheet and/or task set are listed.

## EXTRAS
- [ ] Sheet/task keys outside the source universe are listed.

## DUPLICATES
- [ ] Duplicate keys and their provenance are measured; equal counts are not accepted as proof.

## FAILED
- [ ] Failures are grouped by entity type, error class, age, and attempt count.

## RETRYABILITY
- [ ] Transient, `PERMANENT`, exhausted, orphan, configuration, and unknown cases are separated.

## CANARY
- [ ] One deterministic, low-PII, idempotent, observable task and stop conditions are defined.

## BATCH
- [ ] Expansion is bounded and audited between waves; no blind bulk replay occurs.

## POST-AUDIT
- [ ] Status, sheet effect, keys, duplicates, source immutability, failures, and drift are rechecked.

## ZERO MUTATION / CHANGED
- [ ] Actual external effects or `ZERO MUTATION` are stated exactly.

## VERDICT
- [ ] PASS, REVIEW REQUIRED, BLOCKED, or ROLLBACK REQUIRED is reported.

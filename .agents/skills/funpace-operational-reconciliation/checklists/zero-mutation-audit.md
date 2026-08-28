# Zero-Mutation Reconciliation Checklist

## PRE-FLIGHT
- [ ] Mode is read-only and external targets/authorization boundaries are proven.

## UNIVERSE
- [ ] Population, timeframe, timezone, status scope, and exclusions are explicit.

## KEY
- [ ] Stable key and expected cardinality are compatible across systems.

## SOURCE
- [ ] Source of truth is assigned per entity/field and evidence path is authoritative.

## READS
- [ ] Only necessary read paths are used; credentials and PII are not exposed.
- [ ] Raw evidence is preserved separately from normalization.

## COUNTS
- [ ] Expected and observed counts use the same universe.
- [ ] Counts are treated as signals, not proof of integrity.

## KEY COMPARISON
- [ ] Missing, extras, duplicates, matched keys, mismatches, and freshness are computed.

## DRIFT CLASSIFICATION
- [ ] Every discrepancy has a supported taxonomy class or remains UNKNOWN.
- [ ] Historical drift and expected lag are separated from active drift.
- [ ] Orphans are reported without blind retry.

## INFERRED
- [ ] Conclusions are separated from observed data with assumptions stated.

## ZERO MUTATION PROOF
- [ ] No write, replay, retry, delete, correction, or external mutation occurred.
- [ ] Before and after state are unchanged, or the audit states why re-read was unnecessary.
- [ ] Report states `ZERO MUTATION`.

## VERDICT
- [ ] Result is PASS, REVIEW REQUIRED, or BLOCKED with next read-only evidence identified.

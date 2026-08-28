# Database Audit Checklist

## TARGET
- [ ] Project, database, environment, role, and exact resource are proven.

## SOURCE OF TRUTH
- [ ] Authoritative database and verification path are identified.

## SCHEMA
- [ ] Effective catalog is inspected before relying on migration history.
- [ ] Expected and effective schemas are compared.

## CONSTRAINTS
- [ ] CHECK, UNIQUE, FK, NOT NULL, indexes, defaults, and immutability are reviewed.

## TRIGGERS
- [ ] Relevant triggers and called functions are inspected for side effects.

## BASELINE
- [ ] Population, predicates, counts, key-level state, and snapshot assumptions are recorded.

## READ-ONLY QUERY
- [ ] Smallest sufficient reads are used in a read-only context when supported.
- [ ] OBSERVED results are kept separate from INFERRED conclusions.

## ATOMICITY
- [ ] Relations and side effects that must commit or roll back together are mapped.

## LOCKS
- [ ] Advisory/row/table locks, isolation, deduplication, and retry behavior are understood.

## DRIFT
- [ ] Schema, data, and migration-history drift are classified.

## WRITE PLAN
- [ ] Exact SQL, affected rows, invariant bypass risk, authorization, and stop conditions are stated.

## ROLLBACK
- [ ] Checkpoint, rollback mechanism, trigger, owner, and verification are credible.

## POST-WRITE
- [ ] Effective schema and data are independently re-read and compared with baseline.

## VERDICT
- [ ] Result is PASS, REVIEW REQUIRED, BLOCKED, or ROLLBACK REQUIRED.
- [ ] Audit-only work states `ZERO MUTATION`.

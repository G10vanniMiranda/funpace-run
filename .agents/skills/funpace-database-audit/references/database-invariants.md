# Database Invariants

## GENERIC-PROMOTABLE

### Source of truth and schema proof

- Prove the database identity, environment, role, and search path before interpreting results.
- Treat the effective catalog as evidence of what exists now. Treat migration files and documentation as expected state until reconciled with the catalog.
- Record exact relations, columns, types, defaults, indexes, constraints, triggers, functions, and ownership relevant to the question.
- Compare before and after using the same population, predicates, isolation assumptions, and authoritative read path.

### Constraints and bypass risk

- Inspect `CHECK`, `UNIQUE`, foreign keys, `NOT NULL`, exclusion constraints, generated/default values, and partial indexes.
- Inspect triggers and called functions, including ordering, conditions, security context, and whether they mutate other relations.
- Verify status-transition rules, immutable snapshots, audit immutability, and append-only expectations.
- Before direct SQL, identify validations and side effects normally supplied by the application. A syntactically valid `INSERT` or `UPDATE` can still bypass a business invariant.

### Atomicity, transactions, and locks

- Map every relation and side effect that must succeed or fail together.
- Identify transaction boundaries, isolation level, retry behavior, savepoints, and failure handling.
- Inspect advisory locks, row/table locks, serialization, deduplication checks, and ordering rules when concurrency matters.
- Absence of a database `UNIQUE` constraint does not prove duplicates are allowed; a rule may exist in a locked or serialized application path.
- Prefer a read-only transaction for multi-query audits when supported and useful. Record if reads can observe different snapshots.
- Do not replace an established atomic application workflow with direct SQL merely because the SQL is shorter.

### Audit discipline

- Establish baseline counts and key-level state before mutation.
- Use the narrowest predicates and prove expected affected-row counts.
- Treat unexpected affected rows, trigger side effects, lock contention, or timeout as stop conditions.
- Verify after-state through an independent authoritative read. If no write occurred, report `ZERO MUTATION`.

## FUNPACE-SPECIFIC

- `run-registrations` is central registration evidence; inspect status rules, event/distance/lot relationships, immutable price or partner snapshots, and audit fields relevant to the question.
- `run-payments` and `run-payment-events` provide database-level payment and event evidence. Do not infer provider truth or perform provider reconciliation here.
- `run-google-sheet-sync` represents projection/outbox evidence. Its rows do not replace PostgreSQL entity state and may require cross-system reconciliation.
- Audit tables must preserve attribution and history. Verify immutability and actor/action semantics before proposing direct changes.
- Partner snapshots should be evaluated as captured historical evidence, not silently replaced with a partner's current state.
- Lot occupancy, capacity, and bib allocation may depend on transaction-level locks and multi-table atomicity. Inspect the effective implementation before judging correctness from one table.
- Quote hyphenated relation names correctly when writing SQL, but first prove their effective names from the catalog; do not copy a stale migration name.
- Keep InfinitePay and manual payment mechanics out of this reference. Database evidence may support those domains, but provider semantics belong to Payment Operations.

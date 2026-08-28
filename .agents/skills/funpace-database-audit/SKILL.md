---
name: funpace-database-audit
description: Audit FUNPACE PostgreSQL or Supabase schema, constraints, triggers, migrations, transactions, locks, atomicity, or database drift using database evidence. Do not trigger for layout, Git-only release work, Vercel-only deployment, or tasks that need no database facts.
---

# FUNPACE Database Audit

## Objective

Establish database facts from the effective PostgreSQL/Supabase target, distinguish direct evidence from conclusions, and identify unsafe drift or write plans. PostgreSQL is FUNPACE's source of truth, but this skill does not grant database access or write authority.

## Boundary

### USE WHEN

Use for SQL, PostgreSQL, Supabase database evidence, schemas, constraints, triggers, migrations, locks, transactions, atomicity, orphans, and database drift, including read-only audits.

### DO NOT USE WHEN

Do not use for layout-only work, Vercel-only deployment, Git/release-only work, or tasks that require no database evidence. Do not absorb payment-provider semantics or cross-system comparison; route those to their domain skills.

## Preconditions

Before any database write:

1. Prove the project, database, environment, role, and exact target without exposing credentials.
2. Identify the authoritative source and verification path.
3. Inspect the effective catalog before trusting documentation or historical migration SQL.
4. Inspect relevant constraints, indexes, triggers, functions, and application invariants.
5. Capture baseline counts and affected state.
6. Prefer `BEGIN READ ONLY` or a technically equivalent read-only context when supported; do not require syntax the platform lacks.
7. Classify the proposed write under `funpace-production-safety` and define rollback.

Loading this skill means ANALYZE unless the task independently and unequivocally authorizes a write.

## Evidence rules

Keep these categories separate:

- **OBSERVED**: direct query result, catalog definition, migration record, transaction result, or log entry.
- **INFERRED**: a conclusion derived from observations, with assumptions stated.

For example, observing `registration.status = 'paid'` does not by itself prove financial consistency. Verify every other required invariant before making that inference.

Never infer an effective table, constraint, or trigger name from an old migration. Compare the expected schema with the actual catalog first. An absence of `UNIQUE` also does not prove absence of a business rule: concurrency protection may live in advisory locks, serialized transactions, deduplication, or an atomic application workflow.

## Core workflow

1. Prove identity and capture a zero-mutation baseline.
2. Define the database question and affected population.
3. Inspect actual schema and migration history.
4. Inspect constraints, triggers, functions, locks, and transactional boundaries relevant to the question.
5. Run the smallest read-only queries that can establish the facts.
6. Separate observed results, inferred conclusions, and unresolved evidence.
7. Classify schema/data/migration drift and its blast radius.
8. If a write is requested, review SQL scope, invariant bypass risk, atomicity, lock behavior, checkpoint, rollback, and post-write proof before seeking execution authorization.
9. Report `ZERO MUTATION` for an audit-only run.

For schema and transaction invariants, read [references/database-invariants.md](references/database-invariants.md). For any Supabase migration question, also read [references/supabase-migrations.md](references/supabase-migrations.md). Use [checklists/database-audit.md](checklists/database-audit.md) for an actual database audit or proposed write.

## Stop conditions

Stop with `REVIEW REQUIRED` or `BLOCKED` when the target or database identity is uncertain, the effective schema is unproven, SQL exceeds authorized scope, migration drift is unclassified, a migration contains unexpected DML, rollback is unknown, or a direct write would bypass required invariants. Never broaden SQL or apply all pending migrations to escape uncertainty.

## Related skills and output

Use `funpace-production-safety` for real production access or writes. Use `funpace-operational-reconciliation` when database facts must be compared with another system. Route payment semantics to `funpace-payment-operations` when available. Related skills are routing options, not automatic dependencies.

Minimum output: `TARGET`, `OBSERVED`, `SCHEMA`, `INVARIANTS`, `DRIFT`, `CHANGED`, `VALIDATED`, and `VERDICT`. Reuse the Production Safety report structure when it applies, and never mix inference into `OBSERVED`.

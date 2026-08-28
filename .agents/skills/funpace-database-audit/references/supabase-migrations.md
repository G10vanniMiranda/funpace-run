# Supabase Migration Contract

## Target and history proof

- Prove the intended Supabase project and environment without printing project IDs, database URLs, passwords, or service-role keys.
- Capture local migration files and remote migration history before planning an apply.
- Establish the common history, local-only entries, remote-only entries, reordered versions, and checksum/content differences.
- Distinguish expected repository state from the effective remote schema. Neither history alone proves schema parity.

## Review before apply

- Use the available dry-run, diff, or SQL preview path first. If the tooling cannot produce one, inspect the exact SQL that would execute.
- Prove effective relation, column, constraint, trigger, and function names from the target catalog. Never rely only on an older migration's identifiers.
- Classify the migration as schema-only, DML-only, or mixed. Treat unexpected DML, destructive DDL, broad rewrites, or implicit data conversion as a stop condition.
- Review transaction behavior: whether the tool wraps the migration, statements that cannot run transactionally, lock level/duration, timeout, retries, and partial-failure recovery.
- Define the exact authorized migration/version and SQL. Do not expand authorization to every pending file.

## Drift and scoped application

- If the remote contains legacy migrations absent locally, do **not** run an indiscriminate database push.
- Stop, classify migration-history drift, and determine whether the discrepancy is history-only, schema drift, or both.
- Choose a scoped mechanism appropriate to the proven state: reconcile history metadata, apply one reviewed migration, or create a corrective migration. Do not fabricate parity or rewrite history silently.
- A checksum mismatch requires content inspection and provenance; matching version labels are insufficient.
- Preserve unrelated pending migrations. “Pending” does not mean authorized.

## Execution gate

- A successful audit or dry-run is not write authorization.
- Before an authorized apply, require Production Safety classification, target reconfirmation, a restorable checkpoint, expected lock/blast radius, rollback mechanism, and post-migration queries.
- Apply only the reviewed SQL to the proven target. Stop on guardrails, unexpected prompts, identity changes, wider SQL, ambiguous results, or unknown retryability.
- Do not retry an ambiguous migration until catalog and migration-history evidence prove whether it committed.

## Post-migration verification

- Re-read migration history and verify the applied version/checksum where supported.
- Inspect the effective catalog rather than assuming the statements had their intended effect.
- Verify new or changed constraints, triggers, indexes, defaults, permissions, and functions explicitly.
- Compare baseline and after-state counts when DML or table rewrites were authorized.
- Record drift remaining after the operation and whether rollback is required.
- For an audit-only run, state `ZERO MUTATION`.

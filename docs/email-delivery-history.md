# Email delivery history

## Contract

`run-email-deliveries` is the source of truth for confirmation-email history. A registration can own multiple delivery rows. A delivery row is never reused for a different recipient or communication context.

The legacy `run-registrations.confirmation_email_*` columns remain as a **latest delivery summary** for backward-compatible dashboards and APIs. They are not historical evidence after this migration. Historical queries must use `run-email-deliveries`.

Each delivery uses:

- a generated `id` as its primary identity;
- `registration_id` only as a many-to-one reference;
- normalized `recipient_email` for delivery and audit retrieval;
- `recipient_hash` for comparison without exposing the address;
- a unique `idempotency_key` derived from registration, kind, recipient hash and stable context;
- a provider/message-id partial unique index when a message ID exists;
- lifecycle states `attempting`, `sent`, and `failed`.

Retries after a failed/stale attempt retain the same delivery ID and provider idempotency key. An already-sent delivery and an in-progress delivery inside the cooldown are not claimed again. A legitimate later communication for the same address requires an explicit, stable new context key; random force keys are not allowed.

## Backfill

Backfill is separate from the schema migration. Run `scripts/dry-run-email-delivery-backfill.mjs --dry-run` first. It reconstructs the historical recipient from the closest preceding `email.confirmation.attempted` audit when available, because the registration payload may now belong to a transferred participant. It reports fallback recipients and candidate/existing collisions without writing.

Production backfill requires a separately reviewed and authorized execution artifact. Every fallback, collision and ambiguous candidate must be resolved first. The execution must insert only collision-free, unambiguous candidates, preserve audit logs and never update registration, payment, lot, bib, Meta or provider records.

### Cohort classification (read-only)

`npm run email:audit-backfill -- --dry-run --json` recomputes, in a read-only
transaction, the current cohort of legacy-email registrations that have no
append-only history and classifies each one:

- **evidence** — `PROVEN` / `RECOVERABLE` / `AMBIGUOUS` / `UNRESOLVED`. The
  current registration email is never accepted as proof of the historical
  recipient.
- **gap** — position of the send relative to the history rollout (derived from
  the earliest live delivery, not hard-coded): `PRE_HISTORY_EXPECTED_BACKFILL`,
  `POST_HISTORY_LIVE_FLOW_GAP`, `MIGRATION_WINDOW`, `AMBIGUOUS_TIMELINE`.
- **collision** — whether the candidate's provider message id already lives on
  another delivery (`SAME_EVENT_DIFFERENT_CONTEXT`, `TRANSFER_IDENTITY_CHANGE`,
  `LEGACY_CONTEXT_DRIFT`, `DATA_INCONSISTENCY`).
- **plan (model only)** — `PLANNED_INSERT_HIGH_CONFIDENCE` only for
  `PROVEN + PRE_HISTORY` with no collision; `POST_HISTORY_LIVE_FLOW_GAP` is
  `HOLD_FOR_ROOT_CAUSE`; everything else is a review/no-backfill class.

The tool has no `--apply` / `--execute` / `--write` path and cannot insert. It
does not import the email sender, provider, cron, webhook or any outbox, and it
carries no production snapshot and no real identifiers.

## Google Sheets contract

Old header:

`Data | Inscrição | Destinatário | Status | Provedor | Message ID | Erro`

New header:

`Data | Inscrição | Destinatário | Status | Provedor | Message ID | Erro | Delivery ID`

`Delivery ID` is the unique key and a hidden technical column. `Inscrição` remains a reference and is no longer unique. The worker accepts the legacy header as a temporary structure state, but refuses every `email_delivery` write until the exact new header is present. Legacy `email` tasks are permanently disabled to prevent historical overwrite.

## Controlled rollout

1. Review and apply only `20260825_email_delivery_history.sql` to the proven database target.
2. Verify table, constraints, indexes and the extended outbox check.
3. Run the backfill dry run; resolve every fallback, collision and ambiguous candidate.
4. Execute a separately authorized scoped historical backfill and verify counts/keys.
5. In a coordinated maintenance window, migrate `Emails enviados` to the v2 contract described below.
6. Deploy the compatible application revision. No email should be sent as part of deployment.
7. Verify the exact deployed revision and keep confirmation delivery disabled until the database and sheet dependency gates pass.
8. Enable the new projection and allow one natural or explicitly authorized confirmation canary.
9. Reconcile database delivery, audit, outbox and sheet row by delivery ID.
10. For the designated confirmation case, verify the first delivery before authorizing a second communication; then prove that the second communication created a distinct delivery and did not overwrite the first.

The sheet migration must precede the application deployment. Deploying first could create valid database deliveries whose outbox tasks are permanently rejected by the still-legacy seven-column header.

## Sheets v2 rollout

1. Prove the spreadsheet, tab, writer identity and maintenance authorization; capture a recoverable backup of `Emails enviados`.
2. Run the dependency/header gate and record the current seven-column header, row count and stable evidence available for matching.
3. Append the exact technical `Delivery ID` column and preserve every existing historical row and value.
4. Materialize each historical delivery ID from the verified database backfill using provider/message identity and registration reference; stop on missing, duplicate or ambiguous matches.
5. Verify every non-header row has exactly one delivery ID and that delivery IDs are unique. Registration IDs may legitimately repeat.
6. Apply the eight-column layout and keep `Delivery ID` as the hidden technical key.
7. Enable the `email_delivery` projection only after the exact header and uniqueness gates pass.
8. Process one deterministic, low-PII, idempotent canary and verify the outbox transition and sheet upsert by delivery ID.
9. Reconcile PostgreSQL deliveries, audit entries, outbox tasks and sheet rows by delivery ID; classify missing, extras, duplicates, mismatches and stale rows.
10. Re-read the header, key set and canary row after reconciliation. Stop without batch expansion on any unexplained divergence.

## Rollback

Before any delivery exists, application rollback is safe; the additive table and outbox value may remain unused. The sheet header migration can be restored from its checkpoint while no v2 rows exist.

After v2 deliveries exist, do not drop the table or remove `Delivery ID`. Roll back application behavior only, preserve delivery rows and outbox/audit evidence, and disable email delivery until a forward fix is ready. Dropping the table is destructive and is not an operational rollback.

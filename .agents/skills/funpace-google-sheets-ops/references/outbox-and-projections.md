# Outbox and Projection Contract

## GENERIC-PROMOTABLE

### Source, projection, and comparable universe

An operational sheet is a projection, not a source of truth. Define the authoritative population, stable key, expected cardinality, timeframe, lifecycle scope, and exclusions before comparing or replaying anything. Equal totals do not prove equality: compare keys for missing, extras, and duplicates, then compare authoritative fields and freshness within matched keys.

Trace the complete path independently:

1. source entity and its authoritative state;
2. projection builder and its resulting row universe;
3. outbox task and lifecycle evidence;
4. API write result;
5. actual sheet keys, values, and structure.

This distinguishes a producer that never enqueued work, a worker that stalled, a rejected write, and a sheet that was manually altered.

### Outbox lifecycle, claim, and lease

An outbox record should retain entity type, entity ID, sheet name, operation, status, attempt count, lease or last-attempt evidence, last error, synchronized time, row hint when applicable, and timestamps. Common lifecycle states are `pending`, `processing`, `synchronized`, and `failed`.

- Enqueue idempotently by the operation's stable identity.
- Claim atomically so concurrent workers have one winner.
- Treat `processing` as owned until its proven lease expires; only then may eligible work be recovered.
- Preserve a re-enqueue that arrives during processing instead of allowing completion of the old attempt to erase newer work.
- A synchronized task is not automatically claimable again.
- Never infer that a timed-out call failed to write. Inspect authoritative task and sheet evidence before retry.

Do not add a parallel lock merely from habit. First prove whether the existing transaction, uniqueness, claim, and lease mechanism already provides the required exclusion.

### Retry classification

Classify before retry. Transient network errors, timeouts, rate limits, and eligible server faults may be retryable within the established backoff and attempt limit. A `PERMANENT` prefix or equivalent non-retryable classification excludes automatic replay.

Investigate permanent or unknown failures by category: header/schema mismatch, orphan or missing entity, invalid row/key, unsupported operation, configuration, authentication/permission, or exhausted attempts. Do not rewrite the error label to make a task claimable. Repairing the cause and authorizing replay are separate decisions.

### Keyed upsert and full replacement

For a keyed upsert, prove the tab's real key column and normalized key semantics. Validate row width; verify any stored row hint still contains the same key; otherwise search the key column. Update the existing row or append when absent. Reconcile afterward to prove zero duplicate keys.

For a rebuildable full projection, validate every row before writing. Avoid `clear all -> write`, which can leave a tab empty if the write fails. Prefer:

`validate projection -> write header/data -> read-back verification -> clear stale tail -> verify keys and row count`.

If post-write verification fails, preserve the old tail and stop. Idempotent replay must converge to the same keyed or full-projection state without multiplying rows.

### Canary and backlog recovery

Capture a baseline by status, entity type, error class, age, and key. Select a deterministic, low-PII, idempotent, observable canary. After one task, verify claim/completion state, actual sheet effect, zero duplicate key, and unchanged source. Expand only with clean evidence: commonly `1 -> 5 -> 10/20 -> remainder`. Recalculate failure and drift metrics after every wave; never replay a large backlog blindly.

## FUNPACE-SPECIFIC

### Outbox and structure gate

`run-google-sheet-sync` records FUNPACE projection work. Its task state is operational evidence, not canonical business state. The current worker validates spreadsheet structure before executing a task. Required tabs may be created, but any non-empty incompatible technical header stops synchronization. Treat `ensureSpreadsheetStructure` as a gate shared by the workbook: a header defect in one tab can block an otherwise unrelated task, so diagnose the global guard before retrying.

The service account is the technical writer. Never print its private key, tokens, or credential payload. Before adding or tightening protected ranges, prove that the effective service-account identity remains an editor.

### FUNPACE projection modes

- Inscrições, Financeiro, Check-in, Patrocínio, Emails enviados, Alertas, and Remarketing use keyed upserts under their current key contracts.
- Camisas and Lotes are rebuildable summaries and use full replacement.
- Pagamentos Confirmados is a rebuildable global projection and uses full replacement.

For each tab, inspect the current headers and executor rather than guessing the key from a visible label. Technical IDs remain part of reconciliation even when the UX layer hides them.

### Remarketing

Remarketing combines event-driven producer enqueue with a reconciliation cron. The current projection preserves 22 columns and uses `person_key` as the row key. The producer maps a registration change to a person projection; reconciliation detects missing tasks and synchronized tasks that became stale relative to the projection.

Diagnose `source projection -> outbox tasks -> sheet`. A correct-looking tab does not prove the producer is healthy. Compare projected `person_key` values with task identities and sheet keys, classify missing/stale/duplicate rows, and preserve the current architecture rather than reopening identity design during recovery.

### Pagamentos Confirmados

Pagamentos Confirmados is a global, rebuildable universe produced from current authoritative records. Payment Operations owns the rule that determines financial confirmation. Sheets Operations consumes the builder result, replaces the tab safely, and reconciles by `registration_id` and `payment_id` so missing, extras, and duplicates are zero.

Never promote the sheet to financial evidence or duplicate provider/state semantics here. Builder diagnostics such as paid registrations without compatible paid payments, paid payments without paid registrations, or duplicate paid payments require Payment Operations and key-level reconciliation before operational replay.

### Other operational tabs

Camisas and Lotes must remain safe under replacement hardening. Emails and Alertas may expose a global structure-gate failure even when their own rows are valid. Across every tab, preserve PostgreSQL as authority, exact technical headers, stable keys, source immutability, bounded replay, and a post-operation reconciliation report.

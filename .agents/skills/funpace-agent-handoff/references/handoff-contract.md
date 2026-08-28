# Handoff Contract

## GENERIC-PROMOTABLE

### Purpose

A handoff answers ten questions so a different agent can resume safely:

1. What are we doing? (`MISSION`, `OBJECTIVE`)
2. Why? (`OBJECTIVE`)
3. Where are we? (`PHASE`, `STATUS`, `CHECKPOINT`)
4. What has been proven? (`EVIDENCE`, `TESTS`, `CI`, `DEPLOYMENT`)
5. What has been mutated? (`MUTATION LEDGER`)
6. What must not be repeated? (`DO NOT REPEAT`)
7. What is protected? (`PROTECTED PATHS`)
8. What is blocked? (`BLOCKERS`)
9. What is unknown? (`UNKNOWN`)
10. What is the next safe action? (`NEXT SAFE ACTION`)

### Required sections

`MISSION`, `OBJECTIVE`, `PHASE`, `STATUS`, `CHECKPOINT`, `SOURCE OF TRUTH`,
`BRANCH`, `HEAD`, `BASE SHA`, `PRODUCTION SHA`, `WORKTREE`, `DIRTY TREE`,
`PROTECTED PATHS`, `MUTATION LEDGER`, `AUTHORIZATION STATE`, `TESTS`, `CI`,
`DEPLOYMENT`, `BLOCKERS`, `UNKNOWN`, `HUMAN GATES`, `ROLLBACK`,
`NEXT SAFE ACTION`, `DO NOT REPEAT`, `REFERENCES`.

`NEXT SAFE ACTION` and `DO NOT REPEAT` are mandatory and must be non-empty.

### STATUS values

Use exactly one: `NOT_STARTED`, `IN_PROGRESS`, `BLOCKED`, `HUMAN_GATE`,
`READY_TO_CONTINUE`, `READY_TO_RELEASE`, `RELEASED`, `VERIFIED`, `ABORTED`.

### AUTHORIZATION STATE values

Use exactly one: `AUTHORIZED`, `NOT_AUTHORIZED`, `REQUIRES_HUMAN_GATE`,
`EXPIRED_AUTHORIZATION`, `UNKNOWN`. Authorization is per-mission and
per-target; it does not persist to a new mutation or a later session.

### Mutation ledger

For each domain — `GIT`, `GITHUB`, `DATABASE`, `PAYMENT`, `EMAIL`, `SHEETS`,
`META`, `VERCEL`, `SUPABASE`, `FILESYSTEM`, `OTHER` — record exactly one of
`NONE`, `READ_ONLY`, `MUTATED`, `UNKNOWN`. For `MUTATED`, record only safe
metadata: what changed, scope, ref/PR/run identifiers, and whether it is
reversible. Never record raw rows, payloads, PII, or secrets.

### Protected paths

Record `path`, `status` (`MODIFIED` / `UNTRACKED` / `STAGED` / `CLEAN`),
`classification` (for example `PROTECTED_WIP`), and an optional `sha256` of the
working file. Never paste a diff. Protected content is opaque: it is not copied
into the handoff and its unreleased implementation is not treated as policy.

### Target fingerprints

Support non-secret identity anchors so the resuming agent can confirm it is
operating on the intended target: environment label, project-ref fingerprint
(a hash, not the ref), branch SHA, Production SHA, deployment id, database
identity hash. Never a connection string, token, key, or cookie.

### Next safe action

Must be a single executable instruction, not "continue work". Good:
"Rebase branch `X` onto `origin/main`, push with `--force-with-lease`, then wait
for `quality-gate`." Bad: "finish the release."

### Do not repeat

An explicit list of operations that already happened and must not run again,
for example: do not resend a confirmation email; do not replay a permanent
outbox item; do not re-run a participant transfer; do not recreate a payment;
do not run `vercel --prod`; do not reset protected WIP.

### Redaction (hard rules)

A handoff must never contain: a password, token, cookie, full `Authorization`
header, private key, service-role key, connection string, raw PII, CPF,
personal email, phone number, bank data, or payment-card data. Prefer
`configured: YES` over a value, and `participant_hash` / `registration_hash` /
opaque internal key over a name or real id. Safe placeholders such as
`<EMAIL_HASH>` or `<REGISTRATION_ID>` in a template are not PII.

### Freshness (consumer duties)

A handoff does not replace a freshness check. On receipt: read the handoff and
the root operating contract; fetch the current source of truth; compare
recorded vs current `origin/main` / base / Production SHA; validate protected
paths; validate relevant external state; re-establish authorization; only then
continue. If `current main != handoff main`, classify `HANDOFF_STALE_SOURCE`
and reconcile — do not discard the handoff.

### Provider portability

The handoff must work for `Codex -> Claude`, `Claude -> Codex`,
`Claude -> future agent`, and `orchestrator -> specialist`. It must not depend
on chat history, hidden memory, or provider-specific conversation identifiers.

### Precedence

Higher wins: platform/system safety rules; explicit current human instruction;
project invariants (`AGENTS.md`); the relevant domain skill; the mission
prompt; recorded handoff state. Do not use a handoff to override a higher rule.

## FUNPACE-SPECIFIC

- `SOURCE OF TRUTH` for code/config is GitHub `main`. Record `origin/main` SHA, the PR base SHA, and the Vercel Production Git SHA; a mismatch is `RELEASE_DRIFT`.
- `main` protection is the ruleset `main-protection` (PR required, `quality-gate` required, strict up-to-date, squash-only, no bypass). Record open PR numbers and the last `quality-gate` run id in `CI`.
- Known protected WIP lives on a non-`main` local branch (email / Google Sheets / manual-PIX). Record only path, status, classification, optional sha256.
- Runtime handoff instances belong in `.tmp/handoff/`, which is gitignored. The versioned template and this contract are the only handoff artifacts that enter `main`.
- Validate an instance with `node scripts/validate-agent-handoff.mjs .tmp/handoff/HANDOFF.md` before relying on it. The validator is offline and needs no production or provider access.

## Future evolution (not implemented here)

Automatic checkpointing, orchestrator integration, multi-agent locks / lease
ownership, task-DAG integration, and persistent execution state are out of
scope for this release. The template and schema are kept small so they can be
extracted later without a framework migration.

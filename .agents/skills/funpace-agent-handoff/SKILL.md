---
name: funpace-agent-handoff
description: Generate or consume a FUNPACE execution-checkpoint handoff so one agent can safely interrupt a mission and another can resume it without relying on conversation memory. Use when pausing, resuming, or transferring an in-progress mission across agents or sessions. Do not use for ordinary single-session work that will finish now.
---

# FUNPACE Agent Handoff

## Objective and authority

Let a mission survive an agent change, a session boundary, or an interruption.
A handoff records the **minimum sufficient execution state** to resume safely:
what is being done, what has been proven, what has been mutated, what must not
be repeated, what is blocked, and the next safe action.

This skill does not authorize any mutation. A received handoff is evidence of
prior state, not permission to continue. The resuming agent still performs its
own freshness and authorization checks.

## Use when

- Pausing an in-progress mission that another agent or a later session will continue.
- Resuming from a handoff written by a previous agent.
- Transferring a mission between providers (for example Codex to Claude, or Claude to a future agent) or from an orchestrator to a specialist.

## Do not use when

- The current task will complete in this session with no transfer.
- The request is a plain status update with no execution state to preserve.
- Something needs a full conversation transcript — a handoff is not that, and must not become that.

## What a handoff is and is not

A handoff **is** an execution checkpoint: refs, SHAs, mutation ledger,
blockers, authorization state, next safe action.

A handoff is **not** a conversation dump, a reasoning log, a chain of thought,
raw logs, raw database rows, or raw participant data. Record decisions,
evidence, results, status, and the next action — never private reasoning.

## Two artifacts, do not confuse them

- **Contract / template (versioned):** `.agents/skills/funpace-agent-handoff/**` and `.agents/handoff/HANDOFF.template.md`. Optional machine-readable shape: `.agents/handoff/handoff-state.schema.json`.
- **Live instance (runtime, gitignored):** `.tmp/handoff/HANDOFF.md` and optionally `.tmp/handoff/handoff-state.json`. A live instance holds mission-specific state and must never be committed.

Never write a live handoff instance outside `.tmp/` and never `git add` one.

## Generate a handoff

Follow [checklists/generate-handoff.md](checklists/generate-handoff.md). In summary:

1. Copy `.agents/handoff/HANDOFF.template.md` to `.tmp/handoff/HANDOFF.md`.
2. Collect safe state: branch, HEAD, intended base SHA, `origin/main` SHA, Production SHA, worktree path, `git status --short` classification, open PR numbers, CI run ids.
3. Fill the mutation ledger per domain (`GIT`, `GITHUB`, `DATABASE`, `PAYMENT`, `EMAIL`, `SHEETS`, `META`, `VERCEL`, `SUPABASE`, `FILESYSTEM`, `OTHER`) with one of `NONE`, `READ_ONLY`, `MUTATED`, `UNKNOWN`; for `MUTATED`, record only safe metadata.
4. Record protected paths as `path + status + classification (+ optional sha256)`. Never paste a diff that could contain PII.
5. Record `AUTHORIZATION STATE` (`AUTHORIZED`, `NOT_AUTHORIZED`, `REQUIRES_HUMAN_GATE`, `EXPIRED_AUTHORIZATION`, `UNKNOWN`) and any pending Human Gates.
6. Record target fingerprints (environment, project-ref fingerprint, branch SHA, Production SHA, deployment id) — never secrets.
7. Write `DO NOT REPEAT` and a concrete, executable `NEXT SAFE ACTION`.
8. Redact: no secrets, no raw PII, no real participant/payment identifiers, no absolute personal paths.
9. Validate with `scripts/validate-agent-handoff.mjs` before relying on it.

## Consume a handoff

Follow [checklists/consume-handoff.md](checklists/consume-handoff.md). In summary:

1. Read the handoff and `AGENTS.md`.
2. Fetch the current source of truth and compare the recorded `origin/main` / base / Production SHA with the current values.
3. If they differ, classify `HANDOFF_STALE_SOURCE` and reconcile before continuing — do not discard the handoff automatically.
4. Verify protected paths are unchanged (status and, if present, sha256).
5. Verify any relevant external state named in the ledger.
6. Re-establish authorization for the next mutation; prior-mission authorization does not carry over.
7. Only then perform the `NEXT SAFE ACTION`, honoring `DO NOT REPEAT`.

## Stop conditions

Stop with `REVIEW REQUIRED` or `BLOCKED` when: the handoff contains a secret or
raw PII; `NEXT SAFE ACTION` or `DO NOT REPEAT` is missing or not executable;
`STATUS` is invalid; recorded and current source-of-truth SHAs diverge and
cannot be reconciled from evidence; a protected path changed unexpectedly; the
mutation ledger has an unresolved `UNKNOWN` for a risky domain; or authorization
for the next action cannot be re-established. Never continue a mutation on a
stale or unvalidated handoff.

## Related skills and output

Use `funpace-release-gate` for the Git/PR/merge state that feeds the ledger,
`funpace-production-safety` for authorization and risk of the next action, and
the relevant domain skill for external-state verification.

Report: handoff path, `STATUS`, source-of-truth comparison result, protected-path
check, validator result, and the `NEXT SAFE ACTION` to be taken. Reference
[references/handoff-contract.md](references/handoff-contract.md) for section
semantics, redaction rules, and freshness rules.

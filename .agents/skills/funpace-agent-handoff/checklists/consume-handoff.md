# Consume Handoff Checklist

## READ
- [ ] Read `.tmp/handoff/HANDOFF.md` (or the provided path) in full.
- [ ] Read `AGENTS.md` and load only the skills the `NEXT SAFE ACTION` needs.
- [ ] Confirm required sections are present and `STATUS` is a valid value.

## FRESHNESS
- [ ] `git fetch origin --prune`.
- [ ] Compare recorded vs current `origin/main` SHA, `BASE SHA`, `PRODUCTION SHA`.
- [ ] If any differ: classify `HANDOFF_STALE_SOURCE`, reconcile, do not discard the handoff.

## PROTECTED PATHS
- [ ] Each protected path still has the recorded status.
- [ ] Where a `sha256` was recorded, the working file still matches it.
- [ ] Nothing in the protected set was staged, reset, or cleaned.

## EXTERNAL STATE
- [ ] For every `MUTATED` domain in the ledger, verify current state from an authoritative read (PR state, CI run, deployment provenance, etc.).
- [ ] Resolve any `UNKNOWN` for a risky domain before acting; if unresolved, stop.

## AUTHORIZATION
- [ ] Re-establish authorization for the `NEXT SAFE ACTION`; prior-mission authorization does not carry over.
- [ ] If `AUTHORIZATION STATE` is `REQUIRES_HUMAN_GATE` or `EXPIRED_AUTHORIZATION`, stop for a Human Gate.

## CONTINUE
- [ ] Perform only the `NEXT SAFE ACTION`.
- [ ] Honor every item in `DO NOT REPEAT`.
- [ ] After acting, update or regenerate the handoff (see the generate checklist).

## VERDICT
- [ ] Report: source-of-truth comparison result, protected-path check, validator result, action taken, new `STATUS`.

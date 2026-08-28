# Generate Handoff Checklist

## PREPARE
- [ ] Mission will be interrupted or transferred (not finishing now).
- [ ] Copy `.agents/handoff/HANDOFF.template.md` to `.tmp/handoff/HANDOFF.md`.
- [ ] Confirm `.tmp/` is gitignored; the instance is never staged.

## STATE
- [ ] `MISSION`, `OBJECTIVE`, `PHASE`, `STATUS` (one valid value), `CHECKPOINT` filled.
- [ ] `BRANCH`, `HEAD`, `BASE SHA`, `origin/main` SHA, `PRODUCTION SHA`, `WORKTREE` recorded.
- [ ] `DIRTY TREE`: `git status --short` output classified as task / preexisting / generated / unknown.

## PROTECTED PATHS
- [ ] Each protected path recorded as `path + status + classification (+ optional sha256)`.
- [ ] No diff, payload, or PII from a protected path copied into the handoff.

## MUTATION LEDGER
- [ ] Every domain has exactly one of `NONE` / `READ_ONLY` / `MUTATED` / `UNKNOWN`: `GIT`, `GITHUB`, `DATABASE`, `PAYMENT`, `EMAIL`, `SHEETS`, `META`, `VERCEL`, `SUPABASE`, `FILESYSTEM`, `OTHER`.
- [ ] Each `MUTATED` row has safe metadata only (what, scope, ref/PR/run id, reversible?).
- [ ] No raw rows, payloads, tokens, or PII in the ledger.

## AUTHORIZATION
- [ ] `AUTHORIZATION STATE` is one valid value.
- [ ] `HUMAN GATES` lists any pending decision and why.

## FINGERPRINTS
- [ ] Environment label, project-ref fingerprint (hash), branch SHA, Production SHA, deployment id recorded as needed.
- [ ] No secret, connection string, token, key, or cookie anywhere.

## CONTINUITY
- [ ] `TESTS`, `CI`, `DEPLOYMENT` reflect the last proven results (run ids, PR numbers).
- [ ] `BLOCKERS` and `UNKNOWN` are explicit.
- [ ] `ROLLBACK` names mechanism, trigger, owner, verification — or states why not applicable.
- [ ] `DO NOT REPEAT` lists every already-performed operation that must not run again.
- [ ] `NEXT SAFE ACTION` is a single executable instruction.

## VALIDATE
- [ ] `node scripts/validate-agent-handoff.mjs .tmp/handoff/HANDOFF.md` passes.
- [ ] Manual re-read confirms no secret, no raw PII, no real participant/payment identifier, no personal absolute path.

## VERDICT
- [ ] Handoff path reported with `STATUS` and `NEXT SAFE ACTION`.

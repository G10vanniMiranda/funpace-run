# FUNPACE Mission Handoff

<!--
Copy this file to .tmp/handoff/HANDOFF.md and fill it in. Do not edit the
template in place for a mission. Keep every required section heading.
No secrets. No raw PII. No real participant or payment identifiers. No
personal absolute paths. Use hashes, counts, status, and opaque keys.
Validate with: node scripts/validate-agent-handoff.mjs .tmp/handoff/HANDOFF.md
-->

## MISSION

<!-- One line: the mission name / prompt title being executed. -->

## OBJECTIVE

<!-- Why this mission exists and its definition of done. -->

## PHASE

<!-- Current phase or step label. -->

## STATUS

<!-- Exactly one of: NOT_STARTED, IN_PROGRESS, BLOCKED, HUMAN_GATE,
     READY_TO_CONTINUE, READY_TO_RELEASE, RELEASED, VERIFIED, ABORTED -->
IN_PROGRESS

## CHECKPOINT

<!-- Short description of the last completed, verified step. -->

## SOURCE OF TRUTH

<!-- Code/config truth = GitHub main. Note if any other truth domain matters. -->

## BRANCH

<!-- Working branch name for this mission. -->

## HEAD

<!-- Current HEAD SHA of the working branch. -->

## BASE SHA

<!-- The origin/main SHA this branch is based on / PR base SHA. -->

## PRODUCTION SHA

<!-- Current Vercel Production Git SHA. Should equal origin/main after a release. -->

## WORKTREE

<!-- Isolated worktree path, e.g. .tmp/worktrees/<mission>. -->

## DIRTY TREE

<!-- git status --short, each path classified: task / preexisting / generated / unknown. -->

## PROTECTED PATHS

<!-- One line per protected path: path | status | classification | optional sha256.
     Never paste a diff or file content. -->

## MUTATION LEDGER

<!-- Exactly one of NONE / READ_ONLY / MUTATED / UNKNOWN per domain.
     For MUTATED: what changed, scope, ref/PR/run id, reversible? -->

- GIT:
- GITHUB:
- DATABASE:
- PAYMENT:
- EMAIL:
- SHEETS:
- META:
- VERCEL:
- SUPABASE:
- FILESYSTEM:
- OTHER:

## AUTHORIZATION STATE

<!-- Exactly one of: AUTHORIZED, NOT_AUTHORIZED, REQUIRES_HUMAN_GATE,
     EXPIRED_AUTHORIZATION, UNKNOWN. Scope note: what exactly is authorized. -->

## TESTS

<!-- Last proven local/CI test result: counts and pass/fail. -->

## CI

<!-- Last quality-gate run id, event, conclusion; open PR numbers. -->

## DEPLOYMENT

<!-- Last deployment: id, source branch, Git SHA, status, alias check. -->

## BLOCKERS

<!-- What is preventing progress right now. "None" if none. -->

## UNKNOWN

<!-- Facts not yet established that the next agent must resolve. "None" if none. -->

## HUMAN GATES

<!-- Pending decisions that require a human, and why. "None" if none. -->

## ROLLBACK

<!-- Mechanism, trigger, owner, verification path. Or why not applicable. -->

## NEXT SAFE ACTION

<!-- REQUIRED. A single executable instruction. Not "continue work". -->

## DO NOT REPEAT

<!-- REQUIRED. Operations already performed that must not run again, e.g.:
     - Do not resend the confirmation email for <REGISTRATION_ID>.
     - Do not replay a permanent outbox item.
     - Do not run `vercel --prod`.
     - Do not reset or stage protected WIP. -->

## REFERENCES

<!-- Links: PR URLs, CI run URLs, prior report paths under .tmp/. -->

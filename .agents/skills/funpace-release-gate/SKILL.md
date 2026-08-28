---
name: funpace-release-gate
description: Govern FUNPACE Git staging, commits, PRs, merges, releases, deploy promotion, and post-deploy release validation. Trigger for versioning or promotion work, not for ordinary edits with no release action.
---

# FUNPACE Release Gate

## Objective and boundary

Produce a reviewable release whose refs, files, hunks, checks, and promotion state are proven. This skill governs dirty-tree handling, exact staging, diff review, checks, commit scope, PR, merge, promotion, post-deploy validation, and release rollback.

It does not govern financial semantics, database correctness, provider behavior, Google Sheets internals, or deep Vercel environment semantics. Route those questions to their domain skills.

Readiness is not permission. `READY TO COMMIT`, `READY FOR PR`, and `READY FOR DEPLOY` are evidence states only. Committing, pushing, opening or merging a PR, and deploying require authorization from the task; external promotion also remains subject to `funpace-production-safety`.

## Preconditions

1. Identify the requested gate and whether execution is authorized.
2. Refresh remote refs before Git decisions when network access is allowed; otherwise mark ref freshness unproven.
3. Prove current branch, HEAD, intended base, and their relationship.
4. Capture `git status --short` and classify every changed path as task, preexisting, generated, or unknown.
5. Inspect hunks in any file that may contain both task and preexisting work.

For detailed Git invariants, and the concrete FUNPACE `main` ruleset and normal release flow (required PR, `quality-gate`, strict up-to-date, squash-only, `Production SHA == main SHA`), read [references/git-scope-safety.md](references/git-scope-safety.md). For an actual commit, PR, merge, or deploy gate, use [checklists/release.md](checklists/release.md).

## Hard staging rule

Never assume a dirty working tree belongs to the task. Do not recommend or use `git add -A`, `git add .`, or `git commit -am` until prior classification proves the entire affected scope belongs to the task; prefer exact path or hunk staging even then.

Required flow:

1. Inspect status and unstaged/staged diffs.
2. Classify files.
3. Classify mixed hunks as **TASK HUNKS** or **PREEXISTING HUNKS**.
4. Stage the exact authorized paths or hunks.
5. Review `git diff --cached` as the proposed commit.
6. Run proportional tests, typecheck, build, and diff checks required by the changed surface.
7. Commit only after the cached diff and checks pass.

When hunks are mixed, use interactive staging, a reviewed patch, or a safe equivalent. Never reset, overwrite, stash destructively, or stage preexisting hunks merely to simplify release work.

## Release flow

1. Prove ref freshness, branch, HEAD, base, and PR target.
2. Establish the exact release fileset and hunk set.
3. Review unstaged and staged state independently.
4. Run checks proportional to runtime impact and record any justified omission.
5. Inspect commit metadata and the final commit diff.
6. Validate the PR diff against the intended base and task scope.
7. Before merge or deploy, recheck authorization, required reviews/checks, target environment, rollback, and Safety applicability.
8. After promotion, validate the deployed revision and bounded user-visible or operational health; invoke the rollback gate on failure.

Stop with `REVIEW REQUIRED` if refs are stale, a path or hunk is unknown, cached diff exceeds scope, checks fail, the base/target is ambiguous, authorization is missing, or rollback is not credible. Do not force push or bypass protections unless separately and explicitly authorized for a proven recovery case.

## Related skills and output

Route to, but do not automatically load, `funpace-production-safety` for external promotion and `funpace-vercel-production` for Vercel-specific deployment semantics.

Report: ref proof, dirty-tree classification, exact staged scope, checks, cached/PR diff review, authorization state, promotion validation, rollback, and one readiness/verdict state. Never describe an unexecuted action as completed.

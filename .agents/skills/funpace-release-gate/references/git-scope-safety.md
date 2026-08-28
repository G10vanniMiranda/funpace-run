# Git Scope Safety

## GENERIC-PROMOTABLE

### Dirty tree and scope proof

- Treat every existing modification as user work until evidence assigns it to the task.
- Capture staged and unstaged state separately. A clean cached diff does not imply a clean working tree, and vice versa.
- Classify each path, then each overlapping hunk. A fileset cannot prove scope when task and preexisting edits share a file.
- Use exact path staging for task-only files. Use interactive staging, a reviewed patch, or an equivalent index-only method for mixed hunks.
- Never reset, overwrite, or destructively stash unrelated hunks to make staging easier.

### Ref freshness and identity

- Fetch/prune the intended remote before relying on remote-tracking refs when network access and authorization permit.
- Record branch, HEAD, intended base, upstream, and ancestry or divergence. Stop when the release base or target cannot be proven.
- Inspect both the proposed commit diff and the PR diff against the fresh target base; they answer different scope questions.

### Commit and promotion integrity

- Review `git diff --cached` immediately before commit and verify no secrets, PII, generated noise, or unrelated changes entered the index.
- Inspect the resulting commit identity, parents, message, names, and patch before declaring it ready for PR.
- Do not force push, rewrite shared history, bypass checks, or override branch protection without separate explicit authorization and a recovery rationale.
- Revalidate PR head/base and required checks before merge; ref movement can invalidate earlier evidence.
- Promotion must identify the exact revision and environment. Validate that revision after deploy, not merely that a deployment command returned success.
- Define release rollback before promotion: previous known-good revision, rollback mechanism, trigger, authority, and post-rollback verification.

## FUNPACE APPLICATION

### Source of truth and normal flow

- GitHub `main` is the code/config source of truth: `NO GITHUB = NOT OFFICIALLY RELEASED`. Local commits and a dirty working tree are `UNRELEASED` until merged to `main`.
- Normal flow: `feature branch -> push -> PR into main -> CI quality-gate green -> squash merge -> Vercel Git-integration Production deploy -> post-deploy verification`.
- After a release, `origin/main SHA == GitHub merge SHA == Vercel Production Git SHA`. A mismatch is `RELEASE_DRIFT`.

### `main` branch protection (ruleset `main-protection`, verify live at operation time)

- A pull request is required; direct pushes, force pushes, and deletion of `main` are blocked; there are no bypass actors (an emergency requires temporarily disabling the ruleset, which is itself auditable).
- Required status check: `quality-gate` (GitHub Actions). Its steps run on Linux + Node 22 and must all pass: `npm ci`, `git diff --check`, `npm run lint` (typecheck), `npm test` (0 failures), `npm run build`, `gitleaks`.
- Strict up-to-date is enabled: rebase the branch onto the latest `origin/main` and let CI run again before merge.
- Merge method is squash only (1 PR -> 1 `main` commit); head branches auto-delete on merge.
- `vercel --prod` is not part of the normal flow; see `funpace-vercel-production`.

### Working-tree discipline

- Keep preexisting, unrelated work (for example local manual-payment or Sheets WIP) out of the release staging unless a later task explicitly adopts and classifies it. Stage only the task's exact paths or hunks.
- `funpace-release-gate` can establish readiness but cannot grant Git or deployment authorization.
- Use `funpace-production-safety` for external promotion and a domain skill for system-specific correctness.

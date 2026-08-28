# FUNPACE Run — Release Policy

**GitHub `main` is the source of truth. `NO GITHUB = NOT OFFICIALLY RELEASED`.**

Adopted after SOURCE-001 (git/local/production reconciliation) and RELEASE-01
(first GitHub-first release). Enforced by `.github/workflows/ci.yml` and the
`main` branch ruleset.

---

## 1. Source of truth

- The deployed Production code MUST correspond to a commit that exists on
  `origin/main`.
- Production is built by Vercel's native Git integration from the `main`
  branch. Feature branches build to **Preview** only.
- After every deploy: `Production Git SHA == origin/main SHA`. A mismatch is
  **RELEASE_DRIFT** and must be reconciled.

## 2. Branch model

| Branch | Purpose | Lifetime |
|--------|---------|----------|
| `main` | protected, always deployable, source of truth | permanent |
| `feat/*`, `fix/*`, `chore/*`, `docs/*`, `ci/*`, `infra/*` | one focused change, branched from `main` | deleted after merge |
| `release/*` | optional staged release train; still merges to `main` before Production | short |

Do not stack long-lived branches. After a merge, recreate your working branch
from the new `origin/main`.

## 3. Normal flow (required)

```
git switch -c feat/<slug> origin/main
# ... small, single-domain commits ...
npm run lint && npm test && npm run build
git push -u origin feat/<slug>
# open PR -> main  (PR template auto-fills)
# CI (quality-gate) must be green
# squash-merge -> main
# Vercel builds main -> Production
# verify: section/behaviour on www.funpace.club + Production SHA == main SHA
```

## 4. CI quality gate (`.github/workflows/ci.yml`)

Runs on every PR to `main` and every push to `main`. One job: **`quality-gate`**.

Steps (all hard-fail):
1. checkout (full history)
2. Node **22** (`actions/setup-node`, matches `package.json` `engines`)
3. `npm ci` (lockfile is authoritative; never `npm install` in CI)
4. `git diff --check` (whitespace / conflict markers)
5. `npm run lint` (`tsc --noEmit`)
6. `npm test` (`node --test tests/*.test.ts`; gate = 0 failing)
7. `npm run build` (`vite build`)
8. `gitleaks` secret scan (PR commits on PRs; history on push)

CI has **no Production secrets**. It cannot send email, take payment, mutate
Supabase, emit Meta events, write Google Sheets, or deploy. Tests run against
fixtures / in-memory / mocks only.

Third-party actions are pinned by commit SHA:
- `actions/checkout` `11d5960a326750d5838078e36cf38b85af677262` (v4.2.2)
- `actions/setup-node` `49933ea5288caeca8642d1e84afbd3f7d6820020` (v4.4.0)
- `gitleaks/gitleaks-action` `dcedce43c6f43de0b836d1fe38946645c9c638dc` (v2.3.9)

Workflow permission: `contents: read` only. `concurrency` cancels superseded
runs. Job `timeout-minutes: 15`.

## 5. `main` ruleset (enforced)

- **Pull request required** before merging (no direct pushes to `main`).
- **Required status check:** `quality-gate` must pass. Strict = branch must be
  up to date with `main` before merge.
- **Force pushes blocked.** **Branch deletion blocked.**
- **Approvals:** 0 required. FUNPACE Run currently has a single operator, who
  cannot approve their own PR; requiring a human approval would be a lockout.
  `REQUIRED PR` and `REQUIRED HUMAN APPROVAL` are separate decisions — only the
  first is enforced. Revisit if a second maintainer joins (then require 1).
- **No bypass actors.** Even a repo admin goes through PR + green CI in the
  normal flow. In a true emergency the ruleset can be temporarily disabled in
  repo Settings (this is recorded in the repo audit log) — see §7.

## 6. Merge settings

- **Squash merge is the standard** (1 PR → 1 `main` commit). Squash title =
  PR title; body = commit messages.
- Merge commits and rebase merges remain enabled only for exceptional
  history-preserving needs; prefer squash.
- **Head branches are deleted automatically** after merge.

## 7. Emergency hotfix (exception to §3)

Only when Production is broken and waiting for CI is not acceptable:

1. Get explicit authorization (record who/when).
2. Branch from `main`, make the minimal fix.
3. If unavoidable, deploy directly: `vercel --prod` from that branch build, or
   temporarily disable the `main` ruleset to fast-merge. Log it.
4. **Within 24h**: open the fix as a normal PR to `main`, pass CI, merge.
5. Re-enable the ruleset (if disabled). Confirm `Production SHA == main SHA`.
6. Add an entry to `RELEASES.md`.

`vercel --prod` is **not** part of the normal flow. Its only sanctioned use is
this procedure.

## 8. Critical-path changes (extra scrutiny)

Changes touching any of these get a dedicated reviewer and, in future,
path-scoped CODEOWNERS + additional CI:

- payments / manual payment / reconciliation
- `server/database.ts`, `server/migrations/**`, `supabase/migrations/**`
- auth / RBAC / admin sessions
- email provider integration
- Google Sheets integration
- Meta (Pixel / Conversions API)
- Vercel config (`vercel.json`, project settings)

## 9. Post-deploy verification (every release)

- Deployment `state == READY`.
- Deployment git branch == `main`, git SHA == `origin/main` SHA.
- `www.funpace.club` and `funpace.club` serve that deployment.
- Domain smoke: home loads; expected sections present; the shipped change is
  visible/behaving.
- Record in `RELEASES.md`.

## 10. Future hardening (not yet enforced)

- GitHub Actions CI for `server/` unit + integration coverage gaps.
- `.github/CODEOWNERS` for critical paths.
- Admin "System Information" panel exposing build SHA / deployment id / env
  (`VERCEL_GIT_COMMIT_SHA`, `VERCEL_DEPLOYMENT_ID`, `VERCEL_ENV`) so drift is
  visible in-app.
- Require 1 approval once a second maintainer exists.

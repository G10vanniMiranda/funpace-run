# Releases

Significant releases of FUNPACE Run under the GitHub-first policy
(`docs/RELEASE_POLICY.md`). Newest first. Not a changelog — one line of intent
plus the evidence needed to trace and roll back.

| Date (UTC) | PR | main SHA | Deployment | Scope | Verification | Rollback |
|------------|----|----------|------------|-------|--------------|----------|
| 2026-08-28 | [#8](https://github.com/G10vanniMiranda/funpace-run/pull/8) | `92dfd45` | Vercel `funpace-run` prod, Git-triggered from `main`, READY | UI: show Course section before the Registration form on the public landing (`src/SiteApp.tsx`, 1-line JSX reorder). Regularizes local-only commit `37de8c0`. First GitHub-first release. | `www.funpace.club` live bundle render order confirmed `Kit → Course → Registration`; parent build has them reversed; `Production SHA == origin/main SHA`. | Revert the one-line change in a follow-up PR. |

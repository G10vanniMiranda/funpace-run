# Environment and Deployment Contract

## GENERIC-PROMOTABLE

### Target proof and environment separation

Do not trust a repository directory, cached CLI link, hostname fragment, or previous command as complete identity proof. Establish team/account, project, project ID through redacted evidence, target environment, deployment, source revision, and expected domain before an operation. Production, Preview, Development, and any custom environment are separate configuration scopes.

For every environment variable decision record:

- `NAME`;
- `TARGET`;
- `PREVIOUS STATE`;
- `INTENDED STATE`;
- whether a new deployment is required.

Do not emit secret values. For confidential variables, use only state labels such as `present`, `absent`, `configured`, `invalid`, or `equals expected: true/false`. Redact identifiers when their literal value is unnecessary to prove the decision.

### Project env versus deployment snapshot

Project env current state describes what a future deployment for that target should receive. A deployment's effective state describes what was captured or resolved for that specific build/runtime. Updating project env does not retroactively change an earlier deployment.

Never replace this distinction with “the dashboard is correct.” Correlate variable name and target, project configuration update time, deployment creation time, source SHA, and runtime behavior. If the platform cannot expose the effective value, preserve uncertainty and use non-secret behavioral evidence.

When production currently behaves correctly but future project env is inconsistent, do not redeploy first. Use:

1. prove the current serving deployment and runtime behavior;
2. inspect current project env for the exact target;
3. normalize future config only with explicit authorization;
4. pull or re-read redacted configuration;
5. deploy only after dependencies and rollback are ready.

### Configuration before deployment

Enumerate only the env names required by the changed feature and their dependency graph. Prove presence, valid boolean state, target, and mutual consistency. A global integration flag has a wider blast radius than a feature-specific flag. A feature flag cannot compensate for a disabled global dependency, missing credential, invalid endpoint, or environment guard.

Stop before deployment when a required variable is absent, invalid, targeted to the wrong environment, or inconsistent. Never deploy merely to test whether configuration is adequate.

### Promotion and deployment identity

Recognize the project's established promotion method rather than selecting one automatically:

- push or merge to the configured Production Branch and Vercel Git auto-deploy;
- promote a verified preview or staged production deployment;
- direct production deployment through the approved Vercel CLI workflow.

Release Gate owns source/ref and merge authorization. Production Safety owns authorization for the external production write. This skill may report `READY FOR PRODUCTION DEPLOY`, but that state is not permission to merge or deploy.

For every candidate capture deployment ID, URL, source commit SHA, target, status, creation time, and expected aliases/domains. Require build/deployment status `READY`; then separately prove that the production domain is assigned to that exact deployment. Existence, successful build output, or a generated URL alone does not prove that production traffic moved.

Stop on `ERROR`, `CANCELED`, indefinitely `BUILDING`, wrong SHA, unexpected concurrent deployment, target mismatch, alias mismatch, or state change during the gate.

### Cron, logs, and behavioral proof

For a cron canary, record the schedule source, deployment/runtime target, last observed activity, next expected window, and expected state transition or effect. Prefer a natural scheduled invocation when the objective is to prove real production scheduling. A manual invocation needs a distinct reason, explicit authorization, and labeling; it cannot substitute silently for natural-cycle evidence.

When no suitable event occurs, report `PENDING NATURAL EVENT` if waiting is acceptable. Never create production records solely to manufacture proof. Account for overlapping invocation and duplicate-delivery behavior through the application's established locking and idempotency contract.

Logs are supporting evidence. CLI/dashboard retention, filters, redirects, caching, or tool limits can produce `NO LOG OBSERVED` even when execution occurred. Do not infer `NO EXECUTION OCCURRED` without corroboration. Compare request behavior, deployment identity, database/outbox timestamps, and domain-specific runtime effects.

If effective env cannot be read directly, behavioral contrasts can support a conclusion. For example, the same deployment running a global pipeline while a dependent feature remains inactive may indicate a feature flag difference. Grade the conclusion `PROVED`, `HIGHLY LIKELY`, `PLAUSIBLE`, or `UNKNOWN`; state observations and competing explanations.

### Configuration drift and rollback

Compare project env, deployment creation/config snapshot, current serving alias, runtime behavior, and latest deployment. Classify an evidence-backed mismatch as `CONFIGURATION DRIFT`; otherwise retain `UNKNOWN`. Do not normalize, redeploy, or roll back merely because timestamps or aggregate symptoms differ.

Before promotion, identify the previous stable deployment and prove it is eligible for the intended rollback or re-promotion method. Code rollback changes the served deployment. Config rollback changes future project state and generally requires a new deployment to take effect. Record previous env state, but do not automatically restore it when that state may be defective.

During an incident, prefer a proven rollback/re-promotion to a known-good deployment when the regression is code-bound. Investigate configuration-bound failures before changing env. After any authorized rollback, prove serving domains, deployment identity, runtime health, cron implications, and whether future env still needs normalization.

## FUNPACE-SPECIFIC

### Project and promotion model

FUNPACE maintains a production project distinct from the documented homologation project and from branch previews. Never reuse homologation identity, database, credentials, aliases, or opt-in flags as production evidence. Do not hardcode project IDs or deployment IDs in this skill.

The established FUNPACE normal flow is: a squash-merge into the default branch (`main`) triggers a Vercel Git-integration Production deployment, and Vercel assigns the production domain(s) to that deployment. `vercel --prod`, `vercel deploy --prod`, and manual dashboard promotion are **not** part of the normal flow; they are reserved for an explicitly authorized emergency-hotfix procedure that must still be reconciled back into `main` afterward. Prove the effective Production Branch, the Git-integration state, and the auto-assignment behavior at operation time; this documented expectation does not replace live verification, and a historical workflow does not establish current settings.

Expected production aliases are the documented official public domain(s), while homologation uses its separately proven project/alias. Capture actual domains through redacted authoritative evidence and verify `domain -> deployment`; never infer production service from a deployment URL alone.

### Environment and integration guards

FUNPACE integrations commonly combine a global flag with a feature or homologation opt-in. Verify the full dependency chain before deployment. For Google Sheets Remarketing, for example, the feature flag does not replace the global Sheets enablement and required backend credentials. Apply the same reasoning to cron, payments, email, webhooks, and Meta without importing their domain semantics into this skill.

### Cron integration patterns

The current repository declares production cron routes in `vercel.json` for payment recovery, Meta processing, and Google Sheets processing. Treat that file as the schedule source for the candidate revision, then verify the deployment actually contains it. The routes are authenticated and their business effects remain governed by their domain skills.

For post-deploy evidence, prefer the next natural schedule window. Correlate runtime invocation evidence with authoritative domain effects such as outbox transitions or timestamps. A missing Vercel log entry alone does not prove the cron stopped, and a successful manual HTTP request alone does not prove Vercel scheduling.

### FUNPACE release relationship

Use the chain `Production Safety -> Vercel Production -> Release Gate` for a deploy. For project-env versus runtime discrepancy, add Operational Reconciliation. A database migration with no Vercel deployment does not require this skill merely because the application is hosted on Vercel.

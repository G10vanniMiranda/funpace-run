---
name: funpace-vercel-production
description: Govern FUNPACE Vercel project identity, environments, deployment-effective configuration, production promotion, aliases, domains, cron evidence, runtime logs, configuration drift, and rollback. Do not trigger for local Git-only work, undeployed frontend review, database-only work, payment semantics, or Sheets internals.
---

# FUNPACE Vercel Production

## Objective and authority

Prove deployment identity, effective configuration, production routing, and whether promotion or rollback is operationally safe. This skill owns Vercel semantics; it does not authorize writes, merge, or deploy.

Use `funpace-production-safety` for authorization and safeguards, `funpace-release-gate` for source and promotion permission, and `funpace-operational-reconciliation` when configuration, deployment, runtime, or aliases diverge.

## Boundary

### USE WHEN

Use for Vercel identity, environments, env variables, deployment snapshots, deploy/redeploy, promotion, aliases/domains, cron, logs, production state, drift, or rollback.

### DO NOT USE WHEN

Do not use for local Git-only work, undeployed frontend review, database/payment work without Vercel consequence, or internal Sheets mechanics. Domain skills retain their semantics.

## Identity and state model

Never infer the target from a local directory or prior link. Prove team/account, project and redacted ID, environment, deployment, source SHA, and intended domains. Separate production from homologation and previews.

Keep these states separate:

- **PROJECT ENV CURRENT STATE**: configuration presently stored for a named target and future deployments.
- **DEPLOYMENT EFFECTIVE STATE**: immutable or deployment-bound configuration and code actually used by a specific deployment.
- **RUNTIME OBSERVED STATE**: behavioral evidence emitted by the serving deployment.

Changing a project env does not retroactively update an existing deployment. Never claim these states are equal without deployment-specific or strong behavioral proof.

## Environment safety

For every env decision record `NAME`, `TARGET`, `PREVIOUS STATE`, and `INTENDED STATE`. For secrets, report only `present`, `absent`, `configured`, `invalid`, or `equals expected`; never print values.

Before production deploy, prove required env names, target, boolean state, and dependencies. A feature flag may depend on a broader global flag. Inconsistent config stops deployment.

When runtime works but project env appears inconsistent: prove runtime; inspect project env; normalize future env only when authorized; recheck redacted config; then consider deployment. Read [references/environment-and-deployment.md](references/environment-and-deployment.md) for details.

## Production deployment gate

1. Prove project, account, Production target, source SHA, promotion method, expected aliases/domains, and previous stable deployment.
2. Capture required env state without secret values and compare it with the deployment-effective evidence available.
3. Respect the project's established method: Git production-branch auto-deploy, approved preview/staged promotion, or direct production CLI deployment. Do not choose or combine methods automatically. For FUNPACE the established normal flow is a squash-merge to `main` that triggers a Vercel Git-integration Production deployment; `vercel --prod` and manual promotion are emergency-only. See [references/environment-and-deployment.md](references/environment-and-deployment.md).
4. Capture deployment ID, URL, source SHA, target, status, and creation time; build completion alone is insufficient.
5. Require deployment status `READY`, then prove the expected production alias/domain resolves to that deployment. Stop on `ERROR`, `CANCELED`, indefinite `BUILDING`, unexpected deployment, SHA mismatch, or wrong alias.
6. Run the bounded post-deploy checks and natural cron canary appropriate to the change. Use [checklists/production-deploy.md](checklists/production-deploy.md).

## Cron, logs, and behavioral evidence

For cron, prove schedule source, production runtime target, last observed activity, next expected window, idempotency/concurrency contract, and whether evidence came from natural or manual invocation. Prefer a natural cycle when validating real production. If no eligible event occurs, report `PENDING NATURAL EVENT`; do not fabricate production activity.

`NO LOG OBSERVED` is not the same as `NO EXECUTION OCCURRED`. Corroborate with HTTP behavior, database/outbox timestamps, runtime effects, and deployment identity. When direct effective-env evidence is unavailable, grade behavioral conclusions as `PROVED`, `HIGHLY LIKELY`, `PLAUSIBLE`, or `UNKNOWN` and state assumptions.

## Rollback and stop conditions

Before promotion, identify the previous stable deployment and the verification path for re-promotion or rollback. Separate code rollback from config rollback. Record the previous env state, but never restore it automatically when it may be the defect being corrected. Do not improvise env removal during an incident.

Stop with `REVIEW REQUIRED` or `BLOCKED` for uncertain project/account/target, inconsistent required env, secret exposure, SHA mismatch, unexpected deployment, wrong alias, unknown rollback candidate, absent production authorization, state drift during execution, ambiguous outcome, or platform guardrail. Never bypass a guardrail.

Report: `PROJECT`, `TARGET`, `CURRENT DEPLOYMENT`, `SOURCE SHA`, `PROJECT ENV`, `DEPLOYMENT EFFECTIVE STATE`, `CONFIG DRIFT`, `PROMOTION METHOD`, `DEPLOYMENT ID`, `READY`, `ALIASES`, `CRON CANARY`, `RUNTIME EVIDENCE`, `POST-DEPLOY`, `ROLLBACK`, `ZERO MUTATION` or `CHANGED`, `CONFIDENCE`, and `VERDICT`.

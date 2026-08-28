# FUNPACE Operating Rules

Root operating contract for any coding agent working in this repository
(provider-agnostic: Codex, Claude, or a future agent — "the executing agent").
Domain detail lives in `.agents/skills/**`; this file holds only high-level
invariants.

## Core invariants

- FUNPACE operates real production systems; treat external actions as potentially consequential.
- Begin with read-only inspection and collect evidence before proposing or performing mutations.
- Prove the project, database, environment, account, and exact target before any write.
- PostgreSQL is the system of record; Google Sheets is a rebuildable projection layer.
- Classify every external mutation by risk and blast radius before execution.
- Loading a skill or preparing a command never grants permission to execute it.
- Financial operations require explicit authorization and provider-backed evidence.
- Never fabricate a provider response, transaction ID, webhook, payment, or confirmation.
- Minimize output containing PII, credentials, tokens, identifiers, or production data.
- Stop if a secret or unexpected PII appears; do not repeat it in reports.
- Inspect, classify, and preserve a dirty working tree, including preexisting changes.
- Never use indiscriminate staging; stage only the task's exact files or hunks.
- Do not reset, overwrite, or hide unrelated work to simplify the current task.
- Test and audit in proportion to the operation's risk and affected scope.
- Production changes require preflight, a recoverable checkpoint, a bounded canary, post-write audit, and rollback plan.
- Stop on ambiguity in identity, target, scope, authorization, evidence, or rollback.
- Do not bypass platform guardrails, and do not blindly retry ambiguous operations.

## Source of truth and release flow

- GitHub `main` is the code and configuration source of truth: `NO GITHUB = NOT OFFICIALLY RELEASED`.
- Local commits, branches, and a dirty working tree are `UNRELEASED`. Never present unreleased local work as production truth.
- Normal flow: `feature branch -> push -> PR into main -> CI quality-gate green -> squash merge -> Vercel Git-integration Production deploy -> post-deploy verification`.
- `main` is protected (ruleset `main-protection`): PR required, `quality-gate` check required, strict up-to-date, squash-only merges, force-push and deletion blocked, no bypass actors. Verify the live ruleset at operation time.
- `vercel --prod` and manual promotion are not part of the normal flow; they are an emergency-only procedure that must still be reconciled into `main`.
- After a release, `origin/main SHA == GitHub merge SHA == Vercel Production Git SHA`. A mismatch is `RELEASE_DRIFT`.

## Multiple sources of truth

Git contains code and configuration truth only. It does not contain database,
provider, or operational truth. Keep these domains distinct:

- **CODE / CONFIG TRUTH**: GitHub `main`.
- **DEPLOYMENT TRUTH**: Vercel deployment provenance (branch, SHA, status, alias).
- **DATABASE TRUTH**: a verified production PostgreSQL/Supabase read.
- **PAYMENT TRUTH**: database plus provider evidence appropriate to the operation.
- **EMAIL TRUTH**: delivery and audit evidence.
- **OPERATION TRUTH**: auditable runtime evidence.

## Protected working tree

- Some local branches carry preexisting work-in-progress (for example email, Google Sheets, or manual-PIX changes) that is not part of the current task and not released.
- Treat such paths as `OPAQUE` and `PROTECTED_WIP`: do not stash, reset, clean, checkout, reformat, move, delete, or stage them, and do not absorb their unreleased implementation as official policy.
- Use an isolated clean worktree created from the current `origin/main` for release work.

## Authorization and Human Gates

- Authorization is per-mission and per-target. It does not carry over to a new mutation, a new target, or a later session.
- Require an explicit Human Gate for: financial mutation, refund, participant-identity mutation, manual/external payment, an email resend when duplicate risk exists, a destructive production database operation, a destructive provider-side mutation, disabling a branch ruleset, and an emergency direct production deploy.
- When two legitimate interpretations of production behavior exist, or two skills conflict, record `CONFLICT` and stop for a Human Gate rather than choosing silently.

## Precedence

When guidance conflicts, apply in this order (higher wins), without attempting
to override the platform or model-provider's own safety rules:

1. Platform and system safety rules.
2. Explicit current human instruction.
3. This file's project invariants (`AGENTS.md`).
4. The relevant domain skill under `.agents/skills/**`.
5. The mission-specific prompt.
6. Recorded handoff state.

## Skills and handoff

- Discover skills under `.agents/skills/**`; load only those relevant to the task.
- Use `funpace-production-safety` for production, external writes, credentials, or financial operations.
- Use `funpace-release-gate` for staging, commits, PRs, merges, releases, and production promotion. Release readiness is evidence, not authorization for an external write.
- Use domain skills for system-specific invariants.
- To interrupt or resume a mission across agents or sessions, use `funpace-agent-handoff`. A handoff is a minimal execution-checkpoint contract, not a conversation summary, and it never contains secrets, raw PII, or private reasoning. A received handoff does not replace a fresh source-of-truth check.

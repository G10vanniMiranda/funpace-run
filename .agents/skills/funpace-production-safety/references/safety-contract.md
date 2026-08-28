# Safety Contract

## GENERIC-PROMOTABLE

### Evidence by risk level

| Level | Evidence and authorization | Checkpoint and canary | Audit and rollback |
| --- | --- | --- | --- |
| L0 read-only/local | Identify source and query; no write authority needed | No backup; do not mutate | Record `ZERO MUTATION` and relevant observations |
| L1 local write | Confirm task scope and distinguish preexisting work | Preserve the original or rely on versioned recovery when appropriate | Review diff and run proportional checks |
| L2 reversible non-production external | Prove account, environment, resource, and task authorization | Capture before-state; use a narrow sample when useful | Verify after-state and exercise or document rollback |
| L3 production operational | Prove production target and explicit scope authorization with authoritative baseline | Obtain a restorable checkpoint; run the smallest representative canary | Compare before/after from an authoritative read path; stop before expansion on mismatch |
| L4 financial/security/high impact | Corroborate subject, value/scope, current state, and explicit authorization; resolve all conflicts | Use the strongest available checkpoint and one minimal action; do not batch first | Independently verify outcome; rollback or escalate according to the approved plan; never blind-retry |

### Universal invariants

- Read-only discovery precedes mutation.
- Target proof must identify the concrete account, environment, resource, and affected subjects without exposing unnecessary sensitive values.
- Blast radius includes rows, users, money, credentials, integrations, and downstream projections.
- Capture comparable before/after evidence and retain a zero-mutation baseline.
- A canary must be bounded, representative, observable, and safe to stop after.
- A rollback must name the mechanism, owner, trigger, and verification path; “undo later” is not a plan.
- Reports minimize PII and secrets. Redact sensitive output at collection time when possible.
- If no mutation occurred, say `ZERO MUTATION`; absence of an error is not proof of success.

## FUNPACE-SPECIFIC

- PostgreSQL is the source of truth. Treat Google Sheets as a rebuildable projection and never use a sheet alone to prove canonical state.
- Production financial writes require provider-backed evidence, exact subject/scope, and explicit authorization. Never synthesize confirmation data.
- Keep Meta and InfinitePay identities, credentials, events, and evidence separate; evidence from one provider does not prove state in the other.
- Preserve dirty working-tree content. Classify files and hunks before editing or staging, and never disturb unrelated manual-payment work.
- Use the relevant domain skill for database, payment, Sheets, or Vercel invariants. This contract supplies the cross-domain safety gate, not their internal runbooks.

# Production Operation Checklist

## PRE-FLIGHT
- [ ] Mode is ANALYZE, PLAN, PREPARE, or explicitly authorized EXECUTE.
- [ ] Risk level and blast radius are recorded.
- [ ] Relevant Safety and domain instructions are loaded.

## TARGET
- [ ] Project, account, environment, resource, and subject are proven read-only.
- [ ] Source of truth and authoritative verification path are identified.

## AUTHORIZATION
- [ ] Exact target, scope, and operation match unequivocal authorization.
- [ ] Readiness has not been mistaken for permission.

## BASELINE
- [ ] Before-state and zero-mutation evidence are captured.
- [ ] PII and secrets are minimized or redacted.

## BACKUP
- [ ] Required checkpoint is current and restorable.
- [ ] Recovery owner and retention are known.

## WRITE PLAN
- [ ] Smallest viable write, expected outcome, and blast radius are stated.
- [ ] Idempotency/retry behavior and stop conditions are known.

## CANARY
- [ ] Canary is bounded, representative, observable, and authorized.
- [ ] Expansion requires an authoritative canary audit.

## POST-WRITE AUDIT
- [ ] After-state is read independently from an authoritative path.
- [ ] Before/after differences match only the authorized scope.
- [ ] Downstream effects and drift are checked proportionally.

## ROLLBACK
- [ ] Mechanism, trigger, owner, and verification are explicit.
- [ ] Ambiguous results are not retried blindly.

## VERDICT
- [ ] Verdict is PASS, REVIEW REQUIRED, BLOCKED, or ROLLBACK REQUIRED.
- [ ] Report separates observed facts, inferences, changes, and validation.

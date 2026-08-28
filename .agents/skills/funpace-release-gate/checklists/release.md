# Release Checklist

## PRE-FLIGHT
- [ ] Requested gate and execution authorization are explicit.
- [ ] Working tree baseline is captured without mutation.

## REF FRESHNESS
- [ ] Remote refs are fresh, or freshness is marked unproven.
- [ ] Branch, HEAD, base, upstream, and divergence are proven.

## SCOPE
- [ ] Every changed path is task, preexisting, generated, or unknown.
- [ ] Mixed files have TASK HUNKS and PREEXISTING HUNKS classified.

## TESTS
- [ ] Diff check and proportional tests/typecheck/build pass.
- [ ] Any omitted check has a risk-based justification.

## STAGING
- [ ] Only exact authorized paths or hunks are staged.
- [ ] No preexisting work was reset, hidden, or staged.

## CACHED DIFF
- [ ] `git diff --cached` matches the task and contains no sensitive data.

## COMMIT
- [ ] Commit permission is explicit.
- [ ] Commit identity, parents, message, names, and patch are reviewed.

## PR
- [ ] Fresh base/head and full PR diff match intended scope.
- [ ] Required checks and reviews are satisfied.

## MERGE GATE
- [ ] Merge permission and method are explicit; refs were rechecked.
- [ ] No protection or failed check is bypassed.

## DEPLOY GATE
- [ ] Exact revision and target environment are proven.
- [ ] Safety, domain checks, authorization, and rollback are satisfied.

## POST-DEPLOY
- [ ] Deployed revision and bounded health are independently verified.

## ROLLBACK
- [ ] Known-good revision, trigger, mechanism, authority, and verification are recorded.

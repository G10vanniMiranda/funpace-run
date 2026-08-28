# Production Deploy Checklist

## PROJECT
- [ ] Team/account, project name, redacted project ID, and repository relationship are proven.

## TARGET
- [ ] Production is distinguished from Preview, Development, homologation, and custom environments.

## CURRENT DEPLOYMENT
- [ ] Serving deployment ID, URL, status, created time, aliases, and runtime baseline are captured.

## SOURCE SHA
- [ ] Candidate commit SHA and deployment source SHA match exactly.

## ENV REQUIREMENTS
- [ ] Required names, global/feature dependencies, targets, and validity rules are enumerated.

## ENV STATE
- [ ] Previous and intended states are recorded without secret values.
- [ ] Project env current state is separated from deployment-effective state.

## CONFIG DRIFT
- [ ] Project config, deployment age/snapshot, serving alias, and behavior are reconciled.

## ROLLBACK CANDIDATE
- [ ] Previous stable deployment and eligibility are proven before promotion.

## PROMOTION METHOD
- [ ] Git auto-deploy, staged/preview promotion, or direct CLI deploy is explicitly selected and authorized.
- [ ] For FUNPACE the default is squash-merge to `main` -> Vercel Git-integration; `vercel --prod` requires an emergency authorization and later reconciliation to `main`.

## DEPLOYMENT ID
- [ ] New deployment ID, URL, target, source SHA, and created time are captured.

## READY
- [ ] Status is `READY`; `ERROR`, `CANCELED`, or indefinite `BUILDING` stops the gate.

## ALIASES
- [ ] Every expected production domain resolves to the intended deployment.

## CRON CANARY
- [ ] Schedule source, next natural window, expected effect, and invocation type are recorded.

## RUNTIME EVIDENCE
- [ ] Logs and behavioral evidence are distinguished; confidence is graded.

## POST-DEPLOY
- [ ] Domain, revision, health, changed feature, dependencies, cron, and drift are rechecked.

## ROLLBACK
- [ ] Code and config rollback are separated with trigger, authority, mechanism, and verification.

## VERDICT
- [ ] PASS, REVIEW REQUIRED, BLOCKED, ROLLBACK REQUIRED, or PENDING NATURAL EVENT is reported.

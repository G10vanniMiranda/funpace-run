# Payment Operation Checklist

## TARGET
- [ ] Environment, entity, payment rail, currency, and exact scope are proven.

## AUTHORIZATION
- [ ] Requested mode and L4 financial-write authorization are explicit.

## PERSON/ENTITY
- [ ] Identity is unambiguous and unnecessary PII is excluded from output.

## CURRENT STATE
- [ ] Registration, payment, event, audit, provider, lot, and bib are read first.

## HISTORICAL STATE
- [ ] Current and historical registrations are separated; history is preserved.

## PROVIDER EVIDENCE
- [ ] Evidence is OBSERVED/INFERRED/UNVERIFIED; no provider fact is fabricated.

## EXPECTED AMOUNT
- [ ] Original price, discount, final price, currency, and cents are proven.

## RECEIVED AMOUNT
- [ ] Received/provider/persisted amounts match or the operation stops.

## PARTNER/COUPON
- [ ] Attribution, exclusivity, eligibility, and snapshot immutability are proven.

## LOT
- [ ] Capacity and baseline are proven; post-delta will be correlated by entity.

## BIB
- [ ] Generation, event scope, uniqueness, collision, and sequencing are safe.

## EVENT
- [ ] Event type, real identity, uniqueness, deduplication, and retry are proven.

## AUDIT
- [ ] Actor, reason, evidence, amount, provider, states, and context are recorded.

## SIDE EFFECTS
- [ ] Financial state is separated from email, Sheets, Meta, and projections.

## WRITE PLAN
- [ ] Established atomic path, exact effects, locks, stop conditions, and scope are reviewed.

## CANARY
- [ ] One smallest authorized action is defined; no batch or blind retry occurs.

## POST-WRITE
- [ ] Registration/payment, amount, event/audit, lot, bib, and side effects are re-read.

## ROLLBACK
- [ ] Supported rollback or compensating action, owner, trigger, and proof are credible.

## VERDICT
- [ ] PASS, REVIEW REQUIRED, BLOCKED, or ROLLBACK REQUIRED is reported.

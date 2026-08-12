# Meta Phase 2: attribution and data retention

## Attribution semantics

- `firstTouch` is written on the first visit seen by the current browser session and is never replaced during reloads or SPA navigation.
- `lastTouch` is replaced only when a new entry contains at least one permitted marketing parameter: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, or `fbclid`.
- Reloads and navigation without those parameters preserve both touches.
- A later campaign preserves `firstTouch` and atomically replaces `lastTouch`; values from different visits are not merged.
- The legacy flat fields (`utmSource`, `utmMedium`, `utmCampaign`, `campaign`, `term`, `content`, `fbclid`, `referrer`, and `landingPage`) consistently mirror `lastTouch`, keeping existing reports compatible.
- Partner handoff propagates only the six permitted marketing parameters and the internal `partner=active` marker. Arbitrary query parameters are discarded.

## Recommended retention

This is a policy recommendation only. Phase 2 performs no deletion or backfill.

| Data | Recommended retention | Rationale |
| --- | --- | --- |
| Registration and financial evidence | Legal/accounting period applicable to the organizer; review annually | Contract fulfillment, support, chargeback, and statutory evidence |
| Attribution (`firstTouch`/`lastTouch`) | 13 months after the event or last interaction, whichever is later | Campaign analysis with a bounded marketing lifetime |
| `meta_context` | Until successful Meta delivery or consent revocation; hard maximum 7 days after financial confirmation | Matching/recovery only; revocation must clear it immediately |
| Meta outbox payload | Sent: 90 days; dead/failed: 180 days after resolution | Operational audit and retry diagnosis without indefinite retention |
| Application/runtime logs | 30 days online; up to 90 days restricted archive for security incidents | Production troubleshooting with limited PII exposure |

Access to registration and financial records should remain role-restricted. Logs must not contain raw email, CPF, phone, full name, consent cookies, authorization headers, access tokens, `fbp`, `fbc`, or `fbclid`. Retention changes and any future purge require a separately reviewed migration/runbook with backup and legal approval.

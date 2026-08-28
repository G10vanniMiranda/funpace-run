<!-- Keep it short. Delete lines that do not apply. -->

## Scope
<!-- One sentence. What single thing does this PR do? -->

## Risk
<!-- low / medium / high — and why -->

## Changed files
<!-- List them, or "see diff". Flag anything outside the stated scope. -->

## Checklist
- [ ] `npm run lint` (typecheck) passes
- [ ] `npm test` passes (0 failing)
- [ ] `npm run build` passes
- [ ] No secrets / PII / `.env` / operational artifacts in the diff
- [ ] DB migration included? (yes/no — if yes, describe)
- [ ] Touches an external provider (Resend / InfinitePay / Meta / Google Sheets / Supabase)? (yes/no)
- [ ] Causes a Production data mutation on deploy? (yes/no)

## Rollback
<!-- How to revert: which commit / which action. -->

## Post-deploy verification
<!-- What to check on www.funpace.club after merge; confirm Production SHA == main SHA. -->

---
<!--
Critical-path changes (payments, manual payment, database/migrations, auth/RBAC,
email provider, Google Sheets, Meta, Vercel config) require extra review and a
dedicated reviewer. See docs/RELEASE_POLICY.md.
-->

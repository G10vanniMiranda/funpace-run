---
name: funpace-sheets-ux
description: Design, apply, and visually audit FUNPACE Google Sheets layout as code, including freeze, filters, widths, formats, hidden technical columns, protections, checkboxes, banding, and conditional formatting. Do not trigger for website UI, outbox-only mechanics, payment semantics, or deploy-only work.
---

# FUNPACE Sheets UX

## Objective and authority

Make operational spreadsheets legible, consistent, safe, and reproducible without changing their data semantics. This skill owns presentation: declarative layout, freeze panes, filters, widths, hidden columns, protected ranges, number and date formats, validations, conditional formatting, banding, and visual verification. It does not own projection mechanics or authorize access to a real spreadsheet.

Layout is code. Express the desired state in a reappliable contract rather than relying on one-off browser edits. A second application must converge without duplicating filters, protected ranges, conditional rules, validations, or banding. Managed resources need stable identifiers or descriptions so stale managed state can be replaced without deleting unrelated user resources.

## Boundary

### USE WHEN

Use for Google Sheets layout, frozen rows or columns, filters, widths, row heights, wrap, alignment, hidden technical columns, protected ranges, number formats, checkbox validation, conditional formatting, banding, API layout verification, or browser visual audit.

### DO NOT USE WHEN

Do not use for website or landing-page UI, generic frontend UX, outbox-only diagnosis, financial semantics, or Vercel deployment. `funpace-google-sheets-ops` owns pipeline mechanics. Payment Operations owns financial meaning. For a visual request that also changes headers, keys, types, or projections, use both Sheets skills and preserve the technical contract.

For any real spreadsheet read or write, invoke `funpace-production-safety`, prove the exact spreadsheet, tab, account, environment, mode, and authorization, and avoid exposing credentials or PII. Browser access is verification, not permission to apply manual fixes.

## Semantic invariants

Presentation must not rewrite meaning. Never rename a technical header merely for aesthetics, delete technical identifiers, turn numeric money into formatted strings, convert timestamps to decorative text, or replace a boolean with localized labels without proving the producer and consumer contracts.

Technical columns such as `registration_id`, `payment_id`, `person_key`, `provider_event_id`, and `entity_id` may be hidden and protected, but not removed. A visual checkbox should preserve the underlying boolean. Status color belongs on the relevant cell unless an operational reason justifies a full-row treatment.

Read [references/layout-contract.md](references/layout-contract.md) for idempotency, data types, the FUNPACE visual system, and tab-specific rules. Use [checklists/visual-audit.md](checklists/visual-audit.md) after an API-level layout check.

## Layout-as-code flow

1. Inspect exact headers, column count, data types, current metadata, writer identity, and the existing layout contract.
2. Define desired freeze, filter range, widths, hidden columns, protections, number formats, validations, notes, conditional rules, row/header heights, wrap, alignment, and banding.
3. Compare desired versus actual managed state. Update or replace only managed resources and preserve unrelated resources unless their removal is explicitly scoped.
4. Prove that filters span the intended full range and have no unintended criteria. Verify formulas and conditional rules target the correct column.
5. Before protection, prove the service account remains an authorized technical writer and that owner/admin access remains appropriate.
6. Apply only when explicitly authorized. Re-read metadata and values to prove format, validations, hidden state, protection, and preserved semantics.
7. Open the sheet visually after API validation. Inspect desktop readability, truncation, wrapping, dates, money, colors, freeze, filters, hidden columns, checkboxes, banding, and legibility.

If the browser reveals a defect, correct the declarative layout and reapply it. Do not patch production manually in the browser.

## Type and format rules

Prefer real numeric dates with a number format and a proven timezone. Prefer numeric currency with a locale-appropriate display format. Before applying percentage formatting, prove whether the stored unit is `99`, `0.99`, or another representation; never scale blindly. Preserve booleans for checkbox-backed fields.

## Stop conditions and output

Stop with `REVIEW REQUIRED` or `BLOCKED` for unproven headers or types, uncertain percentage units, partial or misplaced filters, duplicated managed resources, technical-column deletion, service-account lockout risk, timezone ambiguity, semantic conversion, unexpected PII, or missing authorization for a real-sheet write.

Report: `SHEET`, `CONTRACT`, `HEADER`, `FREEZE`, `FILTER`, `WIDTHS`, `WRAP`, `DATES`, `MONEY`, `STATUS`, `HIDDEN`, `PROTECTED`, `CHECKBOX`, `BANDING`, `DESKTOP REVIEW`, `API RECHECK`, `ZERO MUTATION` or `CHANGED`, and `VERDICT`.

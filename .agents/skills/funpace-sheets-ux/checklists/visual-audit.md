# Sheets Visual Audit Checklist

## SHEET
- [ ] Project, spreadsheet, tab, environment, mode, and authorization are proven.

## CONTRACT
- [ ] Desired layout is declarative, versioned, idempotent, and scoped to managed resources.

## HEADER
- [ ] Exact technical headers/order are preserved; style and height match the contract.

## FREEZE
- [ ] Frozen rows/columns match the tab's declared navigation needs.

## FILTER
- [ ] Filter spans the full intended range with no accidental hidden criteria.

## WIDTHS
- [ ] Widths expose operational content without excessive empty space.

## WRAP
- [ ] Wrapping, alignment, font, and row heights remain legible.

## DATES
- [ ] Cells are real dates, timezone is proven, and display is `dd/mm/yyyy hh:mm`.

## MONEY
- [ ] Values remain numeric and render in the intended currency format.

## STATUS
- [ ] Colors target relevant cells and preserve technical status values.

## HIDDEN
- [ ] Technical columns are preserved, hidden only by contract, and still reconcilable.

## PROTECTED
- [ ] Managed ranges are idempotent; service account and admin access remain effective.

## CHECKBOX
- [ ] Checkbox validation preserves the producer's boolean type and correct data range.

## BANDING
- [ ] One intended managed banding covers the live data range without duplication.

## DESKTOP REVIEW
- [ ] Browser review covers truncation, wrap, colors, freeze, filters, hidden columns, and legibility.

## API RECHECK
- [ ] Metadata and representative values confirm the visual state without semantic drift.

## VERDICT
- [ ] PASS, REVIEW REQUIRED, BLOCKED, or ROLLBACK REQUIRED is reported.

# Layout Contract

## GENERIC-PROMOTABLE

### Layout as code and desired state

Represent layout declaratively so it can be reviewed, versioned, reapplied, and audited. A useful contract can express frozen rows and columns, full-range filters, column widths, hidden columns, protected ranges, number formats, data validations, header notes, conditional formatting, row and header heights, wrapping, alignment, and banding.

Compare desired state with actual spreadsheet metadata before applying changes. A second run must converge rather than append duplicates. Give managed protections, conditional rules, banding, and similar resources stable identities or descriptions. Update the matching managed resource, remove only stale managed resources within scope, and preserve unrelated user-managed resources.

### Semantics before presentation

Formatting never changes field authority or data meaning. Preserve exact technical headers, column order, key values, and primitive types required by producers and consumers. Hide and protect technical identifiers instead of deleting them. Use a checkbox UI only when the stored value remains the expected boolean.

Prefer numeric cells plus number formats:

- dates/times remain serial/numeric values with an appropriate display pattern;
- money remains numeric rather than a preformatted currency string;
- percentages are formatted only after the stored unit is proven;
- identifiers that require leading zeros or are not quantities remain text.

Conditional formatting should target the relevant status cell or field. Avoid coloring entire rows without an operational purpose. Confirm custom formulas use the correct absolute/relative references and begin on the intended data row.

### Filters, protection, and dual audit

A filter should span the complete managed column range and intended rows. Do not preserve hidden filter criteria accidentally; criteria must be explicit and reviewed. A range that stops before the final column or applies a condition to the wrong column is a contract failure.

Before protecting headers, technical columns, or managed projection ranges, prove the effective technical writer remains authorized. Preserve suitable owner/admin control. Do not use protection as a substitute for access design, and never print service-account secrets while checking identity.

Verify twice. The API/metadata audit proves frozen panes, dimensions, filters, formats, validation, conditional rules, banding, and protection. The visual audit proves human usability: truncation, wrap, density, contrast, date and money rendering, checkbox display, hidden-column behavior, and desktop readability. Fix defects in the declarative contract, not through one-off browser styling.

## FUNPACE-SPECIFIC

### Visual system

The current FUNPACE Sheets contract uses:

- header background `#17324D`, white bold text, Arial 10, and 32 px height;
- body Arial 10 with approximately 26 px rows;
- alternating white and `#F8FAFC` banding;
- success `#DCFCE7` / `#166534`;
- warning `#FEF3C7` / `#92400E`;
- error `#FEE2E2` / `#991B1B`;
- info `#DBEAFE` / `#1E40AF`;
- inactive `#E5E7EB` / `#374151`.

These colors, fonts, dimensions, timezone, and tab policies are FUNPACE-specific, not generic defaults for other projects.

### Technical columns and managed tabs

Technical columns support idempotency and reconciliation. Preserve columns such as registration/payment IDs, `person_key`, event/provider identity, and entity IDs. Hide and protect them where the current tab contract calls for it, and attach technical notes when defined. Never remove them to make a tab look simpler.

Remarketing preserves exactly 22 columns. Its current hidden technical columns correspond to `person_key`, the registration reference, first-registration timestamp, last-payment-check timestamp, and `updated_at` under the effective contract. The `eligible` field remains a real boolean; its visual checkbox is protected and must not be rewritten to “Sim/Não”. Conditional colors apply to the relevant registration, payment, remarketing, eligibility, or suppression cells.

Pagamentos Confirmados preserves its technical registration, payment, and provider columns even when they are hidden. Its visible financial meaning comes from the projection; layout must not alter provider or payment semantics.

### Dates, money, and percentages

FUNPACE operational time uses `America/Manaus`. Convert timestamps to Google Sheets serial values in that wall-clock context and display them as `dd/mm/yyyy hh:mm`, avoiding an unintended UTC shift. This timezone is local policy, not a generic rule.

Money stays numeric and should display in Brazilian reais, visually `R$ #.##0,00` under the sheet locale. The current API number-format contract may express the pattern as `R$ #,##0.00`; verify the rendered locale result rather than converting values to strings.

For Lotes, the current occupancy value is stored as a literal percentage number such as `99`, not necessarily a fraction such as `0.99`; the format contract therefore uses a numeric pattern with a literal percent sign. Inspect the effective unit before modifying any percent format.

### Filters, protections, and visual verification

Freeze and filter settings vary by tab and must come from the declared layout. Remarketing currently freezes the header and three leading columns; Pagamentos Confirmados freezes the header and two leading columns. Both use filters across their full technical column range.

Managed protected ranges use stable FUNPACE descriptions and retain the service account as editor. Prove the effective writer identity before tightening protection. After metadata validation, perform a desktop visual review for widths, wrap, dates, currency, cell-scoped colors, frozen navigation, filter coverage, hidden technical fields, boolean checkboxes, banding, and legibility. Any correction returns to Layout as Code and is then revalidated through both API and browser evidence.

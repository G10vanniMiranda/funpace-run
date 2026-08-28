---
name: funpace-ui-ux-engineering
description: Audit, design, implement, and visually verify FUNPACE web and product UI/UX while preserving the existing brand. Use for frontend pages, landing pages, components, responsive or mobile layouts, visual design, accessibility or WCAG, motion or animation, design systems, form UX, CTA or conversion work, and browser-based visual refinement. Do not use for Google Sheets layout, backend-only work, database/schema audits, deploy-only work, or payment semantics without UI.
---

# FUNPACE UI/UX Engineering

## Objective and authority

Produce intentional, accessible, responsive, performant-feeling web UI that still looks and behaves like FUNPACE. A green build is necessary but does not prove visual, interaction, mobile, accessibility, or runtime quality.

**Preserve the existing FUNPACE color palette and brand identity unless explicitly authorized otherwise.** The current identity uses black/zinc, white, lime `#d7ff00`, Space Grotesk, Inter, JetBrains Mono, and an athletic, energetic, premium, technical personality. Improve hierarchy, typography, spacing, composition, density, surfaces, interaction, responsive behavior, motion, polish, and consistency before proposing identity change.

If an improvement requires a new primary palette, logo, brand positioning, or substantial identity shift, stop with `STOP — BRAND DECISION REQUIRED` unless the user explicitly authorizes that decision.

## Boundary and routing

Use this skill for web/product UI audits, implementation, responsive design, accessibility, interaction, motion, conversion, prototypes, and browser visual review.

Do not use it for Google Sheets layout; route that to `funpace-sheets-ux`. Do not use it for backend-only code, migrations, database schemas, payment semantics without UI, deep performance work without UX consequences, Git/release work, or Vercel deployment. Related skills include `funpace-payment-operations`, `funpace-release-gate`, `funpace-vercel-production`, and `funpace-production-safety`; load them only when their domain is actually in scope. Visual payment work remains subordinate to existing price, amount, provider, and status semantics.

## Choose the operating mode

- **Audit-only:** inspect and report evidence with P0-P3 priorities. Make no source changes.
- **Focused implementation:** implement an authorized, bounded UI change, then complete browser verification.
- **Significant redesign:** follow `AUDIT -> REPORT -> APPROVAL -> IMPLEMENT`. Never rewrite the frontend automatically after an audit.
- **Visual exploration:** for a consequential but uncertain direction, produce three genuinely different prototypes in isolation and wait for a human choice before convergence or production integration.

## Architecture-first workflow

Before visual decisions, inspect the framework, routes and pages, component tree, styling system, tokens, installed UI and motion libraries, responsive strategy, existing patterns, and state ownership. Extend the current system. Prefer `normalize -> reuse -> refine -> polish` before rewrite, and do not impose a different stack.

Read only the material needed for the task:

- For hierarchy, typography, spacing, composition, surfaces, components, state completeness, and FUNPACE tokens, read [references/visual-system-and-composition.md](references/visual-system-and-composition.md).
- For interaction, motion, gestures, divergence, or complex UI primitives, read [references/interaction-and-motion.md](references/interaction-and-motion.md).
- For WCAG, keyboard, focus, dialogs, forms, mobile, zoom, or reflow, read [references/accessibility-and-responsive.md](references/accessibility-and-responsive.md).
- For CTA, conversion, performance-as-UX, screenshots, browser verification, or refinement, read [references/conversion-performance-and-verification.md](references/conversion-performance-and-verification.md).

Use [checklists/ui-audit.md](checklists/ui-audit.md) for a complete audit. After implementation, use [checklists/visual-review.md](checklists/visual-review.md).

## Design and implementation gates

1. Identify the primary content and action, secondary actions, supporting information, and visual competition.
2. Preserve semantic HTML, component contracts, state ownership, brand tokens, and business invariants.
3. Cover applicable states: default, hover, focus, active, disabled, loading, success, error, and empty; also pressed, selected, open, closed, or dragging where relevant.
4. Treat responsive UI as a contextual redesign. Validate narrow mobile, normal mobile, desktop, wide desktop, zoom/reflow, long content, touch, and keyboard where applicable.
5. Treat WCAG 2.2 AA as the baseline. Accessibility is part of design quality and Definition of Done, not a final optional pass.
6. Motion must earn its existence by communicating feedback, state, space, continuity, explanation, or restrained delight. Provide a reduced-motion alternative and preserve user agency under rapid or interrupted input.
7. Before hand-rolling a complex primitive, inventory dependencies and existing primitives, compare accessibility, weight, and fit, then recommend. Do not install a dependency without authorization.
8. For performance claims, measure before calling something a defect. Change one bottleneck at a time and compare under equivalent conditions.

## Browser completion gate

For browser-facing implementation, complete this loop:

`IMPLEMENT -> OPEN BROWSER -> CHECK CONSOLE/NETWORK -> INTERACT -> KEYBOARD -> RESPONSIVE/ZOOM -> ACCESSIBILITY TREE -> SCREENSHOTS -> VISUAL CRITIQUE -> REFINE`

Capture before/after and representative desktop, mobile, and key-state screenshots when tooling permits. If browser tooling or required runtime state is unavailable, state exactly what was not verified; never present static inspection, build success, or unit tests as visual verification.

## Priority and output

Classify findings by severity, reach, frequency, conversion impact, and effort:

- **P0:** critical task, accessibility, payment-flow, or visual failure.
- **P1:** major perception, usability, or conversion improvement.
- **P2:** systemic consistency or polish.
- **P3:** fine craft and detail.

For audits, report current state, observed design system, evidence-backed P0-P3 findings, quick wins, systemic issues, page-specific issues, mobile, accessibility, motion, conversion, proposed waves, and `NO IMPLEMENTATION`. For implementation, report changed scope, checks, browser evidence, screenshots, remaining risks, and verdict.

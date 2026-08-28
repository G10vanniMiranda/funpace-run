# UI Audit Checklist

## Architecture
- [ ] Confirm audit-only or authorized implementation scope.
- [ ] Map framework, routes, pages, component tree, and state ownership.
- [ ] Inventory styling, tokens, UI libraries, icons, and motion libraries.
- [ ] Identify canonical patterns and significant local exceptions.
- [ ] Record runtime/browser availability and evidence limits.

## Brand
- [ ] Preserve black/zinc, white, lime `#d7ff00`, and existing identity.
- [ ] Preserve Space Grotesk, Inter, and JetBrains Mono unless authorized.
- [ ] Check athletic, energetic, premium, technical personality.
- [ ] Stop with `STOP — BRAND DECISION REQUIRED` for material identity change.

## Hierarchy and typography
- [ ] Identify focal point, primary action, secondary actions, and support.
- [ ] Find visual competition and unclear content priority.
- [ ] Verify semantic heading order and one coherent page title.
- [ ] Audit type scale, weight, line-height, tracking, and line length.
- [ ] Test long Portuguese content, numbers, currency, and mobile wrapping.

## Spacing and layout
- [ ] Audit section rhythm, grouping, padding, gaps, and density.
- [ ] Tie every spacing recommendation to relationship or hierarchy.
- [ ] Check containers, grid, alignment, balance, proximity, and focal point.
- [ ] Verify logical source order and intentional responsive reordering.
- [ ] Check whitespace for both crowding and disconnection.

## Color and surfaces
- [ ] Verify text, component, focus, and status contrast.
- [ ] Ensure meaning does not depend on color alone.
- [ ] Check lime remains a selective, high-value accent.
- [ ] Justify gradients, opacity, translucency, and semantic colors.
- [ ] Use surfaces for grouping, borders for separation, shadows for elevation.
- [ ] Flag card nesting, heavy shadows, excessive blur, glass, or outlines.

## Components and forms
- [ ] Prefer normalize, reuse, refine, and polish before rewrite.
- [ ] Check component contracts, composition, and monolithic responsibility.
- [ ] Cover default, hover, focus, active, disabled, loading, success, error, empty.
- [ ] Cover pressed, selected, open, closed, or dragging when applicable.
- [ ] Verify persistent and programmatically associated labels.
- [ ] Check grouping, helper text, errors, validation timing, and recovery.
- [ ] Check input type, inputmode, autocomplete, keyboard, and autofill.
- [ ] Prevent duplicate action and preserve entered data.

## CTA and conversion
- [ ] Identify primary and secondary CTA hierarchy.
- [ ] Verify copy, placement, next step, and mobile reachability.
- [ ] Verify price, discount, total, trust, urgency, and support clarity.
- [ ] Check form friction and success/failure recovery.
- [ ] Reject dark patterns and unproven urgency or social proof.
- [ ] Preserve payment and registration semantics.

## Responsive and accessibility
- [ ] Test narrow mobile, normal mobile, desktop, and wide desktop.
- [ ] Test zoom/reflow, 200% text, and long content.
- [ ] Check navigation, CTA, forms, tables, maps, media, and virtual keyboard.
- [ ] Verify semantic HTML, accessible name/role/state/value, and landmarks.
- [ ] Traverse all functionality by keyboard with visible, unobscured focus.
- [ ] Verify no keyboard trap and correct dialog focus lifecycle.
- [ ] Check labels, instructions, errors, live status, and non-color cues.
- [ ] Check target size and alternatives to dragging or hover-only behavior.

## Motion and performance
- [ ] Name motion purpose or remove it.
- [ ] Check tool, property cost, easing, duration, exit, and reduced motion.
- [ ] Test rapid input, reversal, repeated actions, gestures, and stale state.
- [ ] Flag measured jank, layout thrashing, or vestibular motion without alternative.
- [ ] Identify UX-facing LCP, INP, CLS, image, font, video, blur, or bundle risks.
- [ ] Require baseline before calling a performance risk a defect.

## Browser, issues, and verdict
- [ ] Inspect actual route, console, network, DOM, and accessibility tree.
- [ ] Exercise primary, loading, error, recovery, and success paths as applicable.
- [ ] Capture representative desktop, mobile, and key-state screenshots.
- [ ] Record confirmed evidence separately from unverified risk.
- [ ] Classify findings P0-P3 by severity, reach, frequency, conversion, and effort.
- [ ] Report quick wins, systemic issues, page-specific issues, and proposed waves.
- [ ] End audit-only work with `NO IMPLEMENTATION` and a clear verdict.

# Accessibility and Responsive Design

Use this reference for WCAG, semantics, keyboard access, focus, dialogs, forms, mobile behavior, zoom, reflow, touch, and screen-reader implications. Treat accessibility as design quality and use WCAG 2.2 Level AA as the baseline.

## Requirements versus recommendations

Label findings accurately:

- **Normative:** a WCAG 2.2 A/AA success criterion or another explicit project requirement.
- **Strong recommendation:** a robust usability or inclusive-design practice that exceeds or clarifies the minimum.
- **Contextual improvement:** beneficial in the observed workflow but not a general compliance rule.

Do not claim WCAG conformance from an automated score alone. Conformance requires the complete process and a combination of automated and human evaluation.

## Semantic structure and names

Use native elements for their intended behavior: buttons for actions, links for navigation, headings for document structure, lists for collections, and labeled form controls. Preserve logical source and reading order. Each interactive control needs a programmatically determinable accessible name, role, state, and value. Visible text on a control should be included in its accessible name.

Images need useful alternatives or `alt=""` when decorative. Decorative icons should not add noise to the accessibility tree. Dynamic status that does not take focus—saving, loading completion, coupon application, or validation summary—must be exposed through an appropriate status mechanism. Use assertive announcements sparingly for urgent errors.

ARIA supplements semantics; it does not repair an unsuitable interaction model. Prefer native controls and established accessible primitives over recreating keyboard and focus behavior on generic elements.

## Keyboard and focus

All functionality must be available from a keyboard unless the function inherently depends on a path-based input. Maintain a logical tab sequence, avoid positive `tabindex`, expose a visible focus indicator, and ensure sticky headers, banners, dialogs, or overlays do not obscure the focused element. Never create a keyboard trap.

When content opens, moves, disappears, or reports an error, decide where focus should remain or move based on the workflow. Do not move focus merely to announce a status that can be exposed through a live region.

For modal dialogs:

- move focus inside on open;
- keep `Tab` and `Shift+Tab` within the modal;
- provide an accessible title and close operation;
- make background content inert or otherwise unavailable;
- return focus to the invoker or the next logical workflow element on close;
- for destructive or financial confirmations, strongly consider initial focus on the least destructive action.

## Contrast and non-color cues

At Level AA, normal text requires at least 4.5:1 contrast and large text at least 3:1, subject to WCAG exceptions. Active UI component boundaries and meaningful graphical objects generally require 3:1 against adjacent colors. Focus indicators, errors, selected states, required fields, and payment outcomes cannot rely on color alone; add text, shape, iconography, pattern, or position.

Measure actual color pairs, including opacity blended against their real backgrounds. Inspect hover, disabled, placeholder, translucent, video-backed, and dark-mode surfaces rather than checking token hex values in isolation.

## Forms and validation

Use persistent visible labels and programmatic association. Placeholder text can demonstrate format but should not be the only label. Group related controls with suitable structure. Use appropriate `type`, `inputmode`, and `autocomplete` so mobile keyboards and autofill match the data.

Validation should occur at a useful time, identify the specific field, explain what went wrong, and suggest recovery when known. Associate inline errors with their controls, update invalid state programmatically, and provide a focusable or navigable error summary when a failed submission spans multiple fields. Preserve entered data. Disabled and loading behavior must not produce duplicate payment or registration actions. Success must communicate what happened and the next step.

## Reflow, text resizing, and responsive behavior

WCAG 2.2 AA requires content to reflow without loss of information or functionality at a width equivalent to 320 CSS pixels, except content that genuinely requires two-dimensional layout. Text must resize to 200% without loss. Verify zoom and enlarged text independently from ordinary narrow viewport testing.

Responsive design is a redesign for context, not desktop scaled down. Choose mobile-first or desktop-first according to the current architecture and target usage, but validate public responsive UI at narrow mobile, normal mobile, desktop, wide desktop, zoom/reflow, and with long realistic content.

Inspect content priority, source order, navigation, CTA visibility, forms, keyboard appearance, safe areas, fixed controls, tables, maps, media, and error messages. Mobile may stack, reorder visually, simplify ornament, or expose a different control, but it must not remove essential function or context. Wide desktop should not stretch readable text or controls beyond useful measures.

## Targets, touch, and alternative input

WCAG 2.2 AA sets a 24 by 24 CSS pixel minimum target subject to spacing and other exceptions. A 44 by 44 CSS pixel target is a strong recommendation and an enhanced criterion, especially for primary mobile actions. Judge dense inline links and operational controls with the normative exceptions rather than misreporting them automatically.

Do not make hover the only way to discover or operate a feature. Ensure touch, pointer, keyboard, and assistive technology expose equivalent function. If dragging performs an operation, provide a simple pointer alternative unless dragging is essential. Avoid accidental activation by supporting cancellation where relevant.

## Motion and sensory accessibility

Honor reduced-motion preferences and provide a way to disable non-essential interaction-triggered motion where WCAG requires it. Avoid flashing beyond applicable thresholds, uncontrollable autoplay, large parallax, and persistent movement that competes with reading. Reduced motion should preserve necessary state feedback through static changes, restrained fades, text, or color with sufficient contrast.

## Verification evidence

Use automated checks to find common violations, then perform keyboard traversal, focus-order review, zoom/reflow testing, accessibility-tree inspection, dialog operation, form-error recovery, and representative screen-reader smoke testing when risk warrants it. Record what was tested and distinguish confirmed failures from code-level risks awaiting runtime verification.

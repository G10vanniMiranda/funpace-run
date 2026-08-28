# Visual System and Composition

Use this reference when evaluating visual hierarchy, typography, spacing, composition, surfaces, component architecture, or design-system consistency. It contains generic design-engineering rules plus the current FUNPACE constraints.

## Start from the observed system

Inventory actual tokens, recurring utility classes, container widths, page shells, component variants, fonts, icon sets, shadows, borders, motion values, and responsive patterns before recommending change. Distinguish a deliberate local exception from accidental drift. Do not demand a repository-wide design-system migration when a bounded normalization solves the problem.

Prefer existing primitives and canonical patterns. When a component has repeated intents or sizes, a typed variant API may be appropriate; when it has one local conditional class, do not create an abstraction merely for symmetry. Keep state close to the component that owns it, separate remote/server state from transient UI state, and avoid monoliths whose rendering, data fetching, validation, and workflow control cannot be reviewed independently.

## Hierarchy and composition

Every screen should quickly answer: where am I, what matters most, what can I do next, what is supporting detail, and how do I leave or recover? Establish hierarchy through content order first, then size, weight, contrast, spacing, grouping, and density. A louder treatment cannot rescue unclear content priority.

Use containers to support reading and scanning rather than as automatic centered boxes. Use grids to express importance and relationships, not to produce equal cards for unequal information. Asymmetry is useful when it creates a deliberate focal point; misalignment without a compositional reason reads as error. Place controls near what they affect. Preserve logical source order even when responsive composition changes visually.

Whitespace is active structure. Excess space can disconnect related content just as insufficient space can crowd it. Review the entire page rhythm: transition between sections, internal component padding, repeated gaps, and the density appropriate to a conversion page versus an operational dashboard.

## Typography

Treat typography as a system of size, weight, line-height, tracking, measure, and semantic role. Inspect the existing scale before introducing another value. Large display text normally benefits from tighter leading and tracking; body text requires comfortable leading and a readable line length. Dense operational UI may be tighter, but never at the cost of comprehension or zoom resilience.

Use semantic headings in a logical hierarchy. Styling a paragraph like a heading does not make it a heading, and using a heading only for size corrupts the document outline. Verify long Portuguese strings, currency, dates, validation messages, narrow mobile wrapping, and 200% text resizing. Avoid walls of uppercase or wide tracking for long informational text. Use tabular figures when changing numeric values would otherwise shift the layout.

## Spacing

Spacing represents relationship:

- tight spacing binds label, value, icon, or control;
- medium spacing separates groups inside a shared section;
- large spacing signals a new section or task phase.

Audit vertical rhythm, section boundaries, component padding, grid gaps, form grouping, and density. Recommend a specific relationship change, such as “reduce the gap so the helper text remains associated with its field,” rather than “add more whitespace.” Normalize recurring near-duplicate values when that reduces drift, but allow content-driven exceptions.

## Color and brand

FUNPACE currently uses black/zinc foundations, white content, and lime `#d7ff00` as the primary accent. The type stack is Space Grotesk for display, Inter for general reading, and JetBrains Mono for technical or numeric information. The product personality is athletic, energetic, premium, and technical.

Preserve these choices unless a brand change is explicitly authorized. Derived zinc/lime shades, opacity, transparency, and semantic status colors may improve hierarchy and contrast. Lime should retain visual force: use it for priority, selection, focus, or meaningful accent rather than painting every interactive element equally. Never rely on lime, red, or green alone to communicate state.

## Surfaces, borders, and shadows

Choose treatment by function:

- **Surface:** groups related content or creates a working context.
- **Border:** provides precise separation or a visible state boundary.
- **Shadow:** communicates elevation, overlap, or focus above another layer.

Avoid card-inside-card structures, heavy shadows without elevation, glass on every surface, expensive blur over large moving areas, and outlines around every group. A hierarchy that only works through glow or backdrop blur is fragile. Test translucent content over its busiest realistic background and under increased contrast or reduced transparency when supported.

## Components and state completeness

Favor composition, narrow contracts, and reusable semantic primitives. Components should expose meaningful intents rather than dozens of visual switches. Separate data acquisition from presentation when doing so makes loading, error, empty, and success behavior explicit.

For every relevant interactive component, inspect default, hover, focus, active, disabled, loading, success, error, and empty. Add pressed, selected, open, closed, or dragging states as applicable. Ensure the visual differences reflect semantic differences and remain understandable without color. Loading must prevent duplicate actions without making the interface appear frozen; success and error must explain the next useful step.

## Visual anti-patterns

Reject generic “AI design” defaults that ignore the product: arbitrary purple/indigo, excessive gradients, maximum rounding, oversized padding, generic hero blocks, stock card grids, decorative dashboards, placeholder copy, and layered shadows. Also reject a cosmetic rewrite that discards functioning FUNPACE patterns without evidence.

Craft is cumulative: optical alignment, wrapping, exact copy, icon weight, focus treatment, error placement, consistent section rhythm, and edge cases together determine perceived quality. Review those details after the system and hierarchy are correct, not instead of them.

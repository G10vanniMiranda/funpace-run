# Interaction and Motion

Use this reference for interaction states, animation, gestures, interruptibility, prototypes, visual divergence, or selection of complex UI primitives. Motion is not a decoration quota; it must improve understanding or response.

## Motion decision tree

Run these questions in order:

1. **Should it move?** Consider interaction frequency, functional density, device, and user intent.
2. **Why?** Name feedback, state indication, spatial consistency, continuity, explanation, or restrained delight.
3. **What information does motion communicate?** If none, remove it.
4. **What is the simplest suitable tool?** CSS transition, CSS animation, Web Animations API, or the installed Motion library.
5. **Which property and rendering cost?** Prefer compositing when it produces the required result.
6. **Which easing and duration fit the distance, scale, frequency, and context?**
7. **Can it be interrupted or reversed without a jump?**
8. **Does the exit preserve the spatial story?**
9. **What does reduced motion receive?**

High-frequency or keyboard-driven actions should usually be instant or nearly imperceptible. Occasional dialogs, menus, disclosures, or feedback may use restrained motion. Rare onboarding, success, or celebratory moments have a larger delight budget, but never at the expense of task completion.

## Properties and cost

`transform` and `opacity` are preferred when suitable because they commonly avoid repeated layout and paint. They are not a universal correctness rule: layer count, texture size, compositing, and actual traces still matter.

`clip-path`, a small disclosure height, and limited layout animation can be acceptable when they express the interaction more accurately. Keep their affected area bounded and inspect frames. Treat broad blur/filter changes, large translucent moving layers, animated box shadows, repeated geometry reads/writes, and layout-affecting properties as expensive until measured. Block measured jank, layout thrashing, or vestibular motion with no accessible alternative.

## Easing and duration

Match easing to behavior:

- entry or immediate feedback often benefits from ease-out;
- an object visibly moving between two settled positions often benefits from ease-in-out;
- constant progress, rotation, or marquee motion uses linear;
- gesture-driven, retargetable, or velocity-carrying behavior usually benefits from a spring.

Ease-in is not universally forbidden. It can fit a deliberate departure where the element should accelerate away, provided the response does not feel delayed. Do not apply one easing everywhere.

Duration depends on distance, physical scale, frequency, context, device, and interruptibility. Press and hover feedback should feel immediate; tooltips and menus should not delay access; larger surfaces may need more time to remain legible. Treat numeric ranges as starting hypotheses. Inspect at normal speed, slowed down, under rapid input, and on representative hardware.

## Interruptibility and gestures

Test rapid clicking, reversal mid-flight, close-before-open-finishes, repeated toggles, route changes, stale state, and unmount during animation. Dynamic transitions should continue from the current presentation value rather than restarting visibly. Never lock useful input merely to protect an animation.

For direct manipulation, keep the object aligned with the pointer or touch, preserve the grab offset, capture the pointer when appropriate, handle multi-touch intentionally, and hand off velocity into settling motion. Use progressive resistance beyond a boundary rather than a dead stop when the interaction calls for rubber-banding. Provide a non-drag alternative for functionality that otherwise requires dragging.

## Reduced motion and pointer capability

Respect `prefers-reduced-motion`. Replace large translation, parallax, looping motion, and bounce with static state changes or restrained opacity/color feedback when that preserves comprehension. Do not assume that “reduced” always means removing every transition. Gate hover-only effects to devices that actually support hover and ensure touch receives equivalent feedback.

## Vocabulary

Use precise terms: enter/exit, fade, slide, scale, reveal, origin-aware animation, continuity transition, shared-element transition, layout animation, stagger, orchestration, press feedback, hold-to-confirm, interruptible animation, spring, damping, momentum, velocity, rubber-banding, compositing, layout thrashing, jank, and reduced motion. Clarify ambiguous descriptions before implementation.

## Divergence before convergence

Use visual exploration when the user wants a substantial hero, navigation, pricing structure, card architecture, primary CTA, or significant interaction but the direction is uncertain. Do not invoke it for a label, trivial bug, or small spacing adjustment.

Default to three genuinely different directions. Name the axis of each direction—for example editorial restraint, high-energy sport, or premium data density—and state its benefit and cost. Use the current FUNPACE tokens, real content, realistic states, and full-size context. Keep prototypes isolated from production. Switching colors or padding alone does not create a direction. Stop for human selection before converging or integrating.

## UI primitive selection

Before hand-rolling a dialog, popover, tooltip, dropdown, tabs, command menu, combobox, toast, or other complex primitive:

1. inventory installed dependencies and existing wrappers;
2. inspect whether an existing primitive already satisfies the contract;
3. compare trusted candidates for accessibility, behavior, bundle weight, styling fit, and maintenance;
4. recommend one path with tradeoffs;
5. obtain authorization before installation or dependency churn.

FUNPACE currently uses React 19, Vite 6, Tailwind CSS 4, Radix Dialog, Motion 12, and Lucide/React Icons. Prefer Radix for a matching accessible dialog need and Motion only when CSS cannot adequately express the required dynamic behavior. Existing installation is evidence to evaluate, not an instruction to use a tool outside its strengths.

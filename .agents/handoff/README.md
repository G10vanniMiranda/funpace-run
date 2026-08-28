# Agent Handoff

Continuity artifacts for interrupting and resuming a FUNPACE mission across
agents or sessions. See the skill `.agents/skills/funpace-agent-handoff/` for
how to generate and consume a handoff.

## Versioned (in this directory)

- `HANDOFF.template.md` — the canonical human template. Copy it, do not edit it in place for a mission.
- `handoff-state.schema.json` — optional machine-readable shape of the same checkpoint (JSON Schema draft 2020-12).

## Runtime (never committed)

- `.tmp/handoff/HANDOFF.md` — the live human handoff for the current mission.
- `.tmp/handoff/handoff-state.json` — optional live machine-readable state.

`.tmp/` is gitignored. A live handoff instance holds mission-specific state and
must never be staged or committed. Validate an instance with:

```
node scripts/validate-agent-handoff.mjs .tmp/handoff/HANDOFF.md
```

The validator is offline and needs no production, database, or provider access.

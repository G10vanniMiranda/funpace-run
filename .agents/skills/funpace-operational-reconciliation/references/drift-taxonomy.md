# Drift Taxonomy

Use the smallest supported category. Preserve `UNKNOWN` when evidence does not justify a stronger label. “Correct now?” always remains subject to explicit authorization and the owning domain skill.

| Class | Definition | Typical severity | Correct now? / Can wait? | Stop? | Required evidence |
| --- | --- | --- | --- | --- | --- |
| EXPECTED LAG | A documented asynchronous delay within its proven service window | Low | Usually wait and re-observe | Stop only if outside the window or expanding | Source timestamp, projection timestamp, service window, matching key |
| HISTORICAL DRIFT | Divergence demonstrably predating the current task or baseline | Low–Medium | Separate issue; never silently fold into unrelated work | Stop current correction if it would absorb the drift | Earlier snapshot/log/history and current key-level difference |
| ACTIVE DRIFT | Current processing is creating or maintaining divergence | High | Investigate promptly; correction needs separate authorization | Stop expansion or related writes | Reproducible before/after evidence tied to current processing |
| ORPHAN | A task or reference points to an entity that no longer exists | Medium–High | Report first; decide skip/resolution/history policy | Stop blind retry | Reference key, authoritative absence, deletion/history evidence |
| DUPLICATE | A key appears more times than the universe permits | High when operational or financial | Quarantine/investigate before correction | Stop if uniqueness or replay safety is uncertain | Raw rows, normalized key, expected cardinality, provenance |
| STALE PROJECTION | Projection is older than its source under proven freshness semantics | Medium | Wait only within expected lag; otherwise investigate | Stop writes based on stale state | Proven timestamp meanings, source/projection versions or timestamps |
| SOURCE MISMATCH | The same key has conflicting values for a field with known authority | High for status/financial fields | Resolve authority and cause before correction | Stop decisions using the disputed field | Both raw values, field authority, update/history evidence |
| SCHEMA DRIFT | Effective structures or migration histories differ from expected compatible state | High | Database owner must classify and scope remediation | Stop blind migration or query assumptions | Catalogs, migration histories, versions/checksums |
| CONFIGURATION DRIFT | Runtime-effective configuration differs across intended equivalent environments/systems | Medium–High | Correct only after target and desired value are proven | Stop deployment/operation if identity or safety changes | Effective redacted config, environment identity, expected source |
| UNKNOWN | Evidence cannot support another category | Unknown | Do not correct; collect evidence | Yes for mutation or retry | Missing facts, conflicting sources, and next read-only checks |

## Classification rules

- Classify per key or discrepancy set, not merely per aggregate count.
- A discrepancy can transition from EXPECTED LAG to STALE PROJECTION when its proven window expires.
- HISTORICAL DRIFT describes timing/provenance, not harmlessness. Escalate severity when its domain impact warrants it.
- ORPHAN does not imply deletion is erroneous. Determine whether the entity legitimately disappeared and whether the task should be skipped/resolved or retained historically.
- Do not define staleness as `source.updated_at > projection.synchronized_at` until both fields' meanings, clocks, timezone, update coverage, and null behavior are proven. Use the domain's equivalent version/watermark when timestamps are unsuitable.
- Equal counts are not a classification. Compare keys, cardinality, fields, and freshness.

## Historical drift isolation

When one system has `N` records and another has `N+1`, and evidence proves the difference predates the current task:

1. Record the original baselines and exact differing key.
2. Classify it as HISTORICAL DRIFT, plus any applicable impact category.
3. Preserve it during unrelated work.
4. Open or recommend a separately scoped reconciliation action.

Never manufacture a match by deleting, inserting, replaying, or excluding the difference without evidence and authorization.

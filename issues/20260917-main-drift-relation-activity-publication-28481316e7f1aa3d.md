# main drift: relation-activity-publication has a stale committed record

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-09-17
**Drift gate:** `relation-activity-publication`
**Outcome:** `STALE`
**Failure signature:** `sha256:28481316e7f1aa3d7115aa7085d7a556b05f179758534d2cc03c510379e742c7`
**Causal landing:** `9159d5e3a60048924a19eb1fbe1f790a57b4f90c` (feat(engine,server): W5 runtime-cost recorder and server observations)
**Detected at:** `cca6a2d0b1fc14f337f592c880e260242b97fd9b`
**Last observed:** `722ac37773884d4ba11fb27495f9f5c8e3aa1ac7`
**Attribution:** `first-parent-signature-epoch`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop ran `relation-activity-publication` independently of path selection on
`main` and found the committed record stale. The conservative first-parent-signature-epoch attribution names the landing above. This ticket is keyed by gate plus
normalized failure signature and remains idempotent while open.

## Stale record

- `crates/snapback-engine/src/local-relation-activity-publication.v1.json and its pinned readers`

Checker materialization, when available:

- The checker did not materialize a working-tree diff; see its command output.

## Reproduce and reconcile

Check:

```sh
node tests/conformance/relation-activity-publication-v1.mjs
```

Regenerate/reconcile:

```sh
node scripts/refresh-publication-carrier.mjs
```

Commit the reconciled record with the measured change, verify the gate, record
the resolution here, and move this ticket to `issues/closed/`.

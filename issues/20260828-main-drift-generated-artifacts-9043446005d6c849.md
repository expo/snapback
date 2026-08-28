# main drift: generated-artifacts has a stale committed record

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-08-28
**Drift gate:** `generated-artifacts`
**Outcome:** `STALE`
**Failure signature:** `sha256:9043446005d6c849cc5a84a606caa4499e8f5f497a689d036014df7fa66702e2`
**Causal landing:** `none — record-epoch-off-first-parent`
**Detected at:** `4d4ce40bd9b3921a88d37063b47693923ca8c1d3`
**Last observed:** `095880f167755431165137247bd51844b8c29e09`
**Attribution:** `record-epoch-off-first-parent`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop ran `generated-artifacts` independently of path selection on
`main` and found the committed record stale, but record-epoch-off-first-parent prevents a supported causal-landing claim. This ticket is keyed by gate plus
normalized failure signature and remains idempotent while open.

## Stale record

- `committed review manifests and projections selected by scripts/generated-artifact-policy.mjs`

Checker materialization, when available:

- `demos/todo-v2/snapback/generated-remote-service/artifacts.json`
- `demos/todo-v2/snapback/generated-remote-service/authorization-review.json`
- `demos/todo-v2/snapback/generated-remote-service/functions.manifest.json`
- `demos/todo-v2/snapback/generated-remote-service/schema.manifest.json`

## Reproduce and reconcile

Check:

```sh
scripts/check-generated-artifacts
```

Regenerate/reconcile:

```sh
scripts/check-generated-artifacts
```

Commit the reconciled record with the measured change, verify the gate, record
the resolution here, and move this ticket to `issues/closed/`.

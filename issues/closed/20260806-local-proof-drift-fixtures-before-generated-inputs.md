# Drift fixtures ran before their ignored generated inputs

**Status:** Closed — fixed forward 2026-08-06
**Opened:** 2026-08-06
**Systems:** Local proof, Generated artifacts, Drift enforcement
**Related:** LLP 0061, LLP 0175, GitHub Actions run `31147355293`, PR #18

## Failure

The clean Linux proof's committed-history drift fixtures found their workspace
links after the first fix, then refused because
`demos/competitive-checkpoint/snapback/generated/operations/startReply.args.schema.json`
did not exist. Both affected fixture cases correctly classified this as a
missing prepared Guide input rather than a stale receipt.

## Attribution

The fixtures landed in `a18a1556e6` before the proof had an explicit producer
edge. Their canonical gate ran near the start of `verify-local-proof`, while
the ignored generated-artifact corpus was materialized later. An ambient local
codegen output masked the ordering error.

## Resolution

The fixture gate now runs after and explicitly requires `generated-artifacts`.
The fixtures still operate on committed disposable clones and still fail
closed when a declared dependency is absent; the canonical proof now produces
the intentionally ignored inputs before asking the fixtures to copy them.

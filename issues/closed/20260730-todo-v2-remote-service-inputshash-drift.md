# todo-v2 remote-service codegen inputsHash drifts from committed baseline in fresh worktrees

**Status:** Resolved (2026-07-30)
**Severity:** P3
**Systems:** Codegen, Proof infrastructure
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-30
**Related:** LLP 0015 (portability rules), `scripts/check-generated-artifacts`

## Observation

On 2026-07-30, two independent fresh worktrees of current main (`ba752a14`
lineage) on the primary development machine observed the same drift:
regenerating `demos/todo-v2/snapback/generated-remote-service` (via
`scripts/check-generated-artifacts`, which runs
`snapback generate snapback --target-profile remote-service-sqlite-ibex`)
produces `inputsHash`/cache key
`4bdc9be16bb780b33aeee1548a771c0d5e70a085cddb501275059509a45b0875`, while the
committed `artifacts.json` carries
`36622e1f6d2fd2a65621568b5265a6ce974b2242b4cb3d55d050498a87f24ee0`. The
member `sha256` fields shift with it (~22 lines). One session reproduced the
drift under both node 25 and volta node 24.18.0, so it is not a node-version
artifact.

`scripts/check-generated-artifacts` therefore FAILs in a fresh worktree
("committed review manifests or policy projections are stale") even with no
local changes to any codegen input. All test suites pass against the
committed bytes, and both sessions restored the committed file rather than
committing the churn.

## Why it matters

- The complete-inputs-hash rule is "regenerate-or-fail-closed"; a
  machine/worktree-dependent hash makes the freshness gate cry wolf and
  trains agents to revert generated diffs, which is exactly the reflex that
  hides a real staleness one day.
- This matches the earlier "stranded baseline" phenomenon recorded during
  the LLP 0076 execution (unreproducible receipt), suggesting a
  path-dependent or environment-dependent input leaks into the hash for the
  remote-service target profile specifically (the local-dev targets
  regenerate cleanly byte-identical).

## What to do

1. Diff the hashed input manifest between a fresh-worktree regeneration and
   the committed one (the codegen summary records `producerInputs`-style
   entries) to identify which input byte-shifts across checkouts.
2. Fix the input normalization (likely a path or ordering issue) or, if the
   input is legitimately environment-bound, exclude it from the
   complete-inputs-hash and record why.
3. Re-run `scripts/check-generated-artifacts` in a fresh worktree; it must
   pass with zero diffs before this closes.

Not verified: whether the primary checkout regenerates cleanly (left
untouched because it is shared with live sessions).

## Resolution (2026-07-30)

**Root cause: the committed baseline was stale, not environment-dependent.**
Commit `00f1f218` ("feat(attribution): land the LLP 0062 attribution wire
seams", landed 2026-07-30 14:21 PT) added the establishment-metadata blocks
(+37 lines each) to `schemas/live.subscribe.output.schema.json` and
`schemas/live.resume.output.schema.json`. Both files are
`REMOTE_SERVICE_WIRE_SCHEMAS` identity inputs for the
`remote-service-sqlite-ibex` target profile
(`loadRemoteServiceInputs` in `packages/snapback-codegen/index.mjs`), but
that commit did not regenerate
`demos/todo-v2/snapback/generated-remote-service`. Every fresh worktree
fetched after 14:21 therefore correctly regenerated to
`4bdc9be16bb7…` against a committed `36622e1f6d2f…` baseline. This ticket
was filed at 14:29 — eight minutes after the schema change landed — which
is why two independent worktrees "reproduced" it and why node 25 vs 24.18.0
made no difference: the regeneration is deterministic, and the local-dev
profile (which does not admit the wire schemas) stayed byte-identical.

Causality proof: restoring only those two schema files to their
`00f1f218^` bytes and regenerating reproduces the committed
`36622e1f6d2f…` exactly. Diffing the two cache graphs shows the only
member-byte differences are (a) the embedded `inputsHash` in each manifest
and (b) the recorded `sha256` references for the two wire schemas in
`remote-data-capability.manifest.json` (old `8c9beaae…`/`4fc1ea64…` →
current `80d00ae9…`/`6a1e6145…`, which match `shasum -a 256` of the
committed schemas). No path, ordering, or environment value leaks into the
hash; no exclusion or normalization change is warranted.

**Fix:** regenerate and commit the
`demos/todo-v2/snapback/generated-remote-service/artifacts.json` baseline
(inputsHash `4bdc9be16bb780b33aeee1548a771c0d5e70a085cddb501275059509a45b0875`).
`scripts/check-generated-artifacts` passes with zero diffs in a fresh
worktree afterwards. The gate itself worked as designed — it only runs in
`scripts/verify-local-proof`, which the `00f1f218` landing evidently
skipped; any change to `schemas/*.schema.json` wire files must re-run it.
The earlier "stranded baseline" comparison in this ticket was a
misdiagnosis: no machine-local input is involved.

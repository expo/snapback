# todo-v2 remote-service codegen inputsHash drifts from committed baseline in fresh worktrees

**Status:** Open
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

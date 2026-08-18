# Path-migration straggler gate coverage limits

**Status:** Open
**Systems:** Project, Build, Verification
**Date:** 2026-08-17
**Source:** LLP 0276 Lane P0-D final blind-review round

## Boundary

`scripts/check-path-migration-stragglers.mjs` is a deterministic lexical
backstop behind the checked path-migration manifest. It is not a completeness
proof that no stale path exists. The battery's fail-closed inventories remain
the net behind the manifest and this gate.

Known lexical misses are arbitrary composed paths: concatenation across lines,
separator variables, derived template roots, and helpers defined in another
file. The bounded scanner recognizes literal `join`, `resolve`, and `new URL`
component sequences on one line, but it must not be described as deciding the
general composed-path problem.

`crate::` module paths are explicitly out of scope. The Rust compiler and the
workspace-graph gate own that coverage; this scanner must not be credited with
it.

Epoch-assignment validation proves only that a consumer is not assigned before
its destination can exist. It does not prove that the selected epoch is fully
correct.

The two final blind reviewers independently sampled 16 and 19 of the 207
manifest rows. The remaining rows were not independently re-verified, and this
gate must not be used to imply otherwise.

## Done when

Close this ticket only if a later mechanism replaces these limits with real,
bounded coverage. Do not close it because the lexical pattern set grows or a
larger row sample passes review.

# Snapback 4: Publish schema, programs, derived state and generation together

Status: Open
Priority: P1
Observed: 2026-09-12
Review finding: R03
Evidence: Restart reproduced; failure and competing-owner paths code traced
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.000](../llp/3000.000-atomic-schema-and-release-activation.research.md), [comprehensive review](../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

`Engine::new` installs a changed schema without advancing the persisted replica
generation. Restarting `dev` after changing a text bound reported generation
1 both before and after restart. A device can therefore retain state from a
different schema without taking the generation-reset path.

`adopt` has a related partial-activation problem: installation commits, the
engine swaps schema/programs, maintains rebuild, and generation is written in
separate steps. A failure can leave mixed state. `Store::install` also changes
its in-memory catalog before the SQL transaction commits. Multiple commands
can install schemas into a store while another engine remains open.

Establish one activation/ownership boundary as explored in LLP 3000.000.
Advance a monotone persisted activation identity for a changed schema/program
set on restart as well as live adoption. Publish the data projection, indexes,
derived values and program set consistently, and prevent an old open engine
from writing with a stale catalog. Reproduce failure during rebuild/commit and
prove the previous activation remains usable; verify a connected device resets
exactly when the active semantic generation changes.

## Implementation locations

- [crates/snapback4-core/src/engine/mod.rs](../snapback4/crates/snapback4-core/src/engine/mod.rs)
- [crates/snapback4-core/src/store.rs](../snapback4/crates/snapback4-core/src/store.rs)
- [crates/snapback4/src/project.rs](../snapback4/crates/snapback4/src/project.rs)
- [crates/snapback4/src/serve.rs](../snapback4/crates/snapback4/src/serve.rs)

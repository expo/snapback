# Shared Cargo target can substitute another lane's CLI during a test

**Status:** Open
**Date:** 2026-10-04
**Scope:** Snapback 4 test artifact isolation on concurrent worktrees
**Source:** Lane FC full-suite run on eb1000, baseline `1c18847b79`

FC and concurrent lanes use the commissioned external
`CARGO_TARGET_DIR=~/sb5-lanes/target`. The full suite's
`snapback4::check::w11_why_every_registered_code_returns_its_dedicated_section`
failed at `tests/check.rs:302`: its linked language library expected this lane's
`E_QUARRY_MATCHING_INDEX` card, but the child CLI printed a different lane's
updated card ("A plain unique index supplies its column order..."). FC's source
and its pinned CLI still said "A plain index has no words key...".

`check.rs` embeds `env!("CARGO_BIN_EXE_snapback4")`, which names the shared
`target/debug/snapback4`. Cargo's build lock protects compilation, not subsequent
execution of a test inventory. Another worktree can rebuild that path after the
runner collects the tests. `SNAPBACK4_BIN` pins FC's JS fixtures but does not
override this Rust constant. The observed mismatch is infrastructure
interference, not a Following product failure or an inherited source red.

At investigation time the pinned FC CLI SHA-256 was
`c37b9f8b249aa0497ff748d9372a7d719ba60c3c2e4a40940cc46af57abd0bf8`.
The shared path printed the foreign card in a direct read. The exact paths,
hashes, both outputs and timestamp are retained in
`~/sb5-lanes/fc-artifacts/shared-target-interference.txt`; the full failure is
in `full-suite.log`, and its classification in `~/sb5-lanes/fc.report.md`.

Follow-up: give simultaneously tested source trees isolated executable output
paths while retaining dependency caching, or pin the CLI and compiled inventory
to an immutable run directory. Do not overwrite another lane's shared binary
by hand, weaken the equality assertion, or claim a clean battery from the mixed
artifact run. FC leaves the prescribed shared target unchanged and reports the
original full-suite result; no product change is needed for this failure.

# main red: derive_plan_steps grew a predecessor arg; two test callers still pass two

**Status:** Open
**Impact:** 4
**Urgency:** 4
**Ease:** 4
**Confidence:** 5
**Systems:** Migration, Tests
**Date:** 2026-08-15
**Found while:** pc0815 papercut sweep, verifying the devserver lane's cargo
gate against main

## Problem

`src/migration.rs` `derive_plan_steps` now takes three arguments
(`predecessor_schema`, `successor_schema`, `intents`) after today's migration
landings (`6141540cf` feat(migration): support json to structured evolution;
`d50ed4f7b` fix(migration): constrain ConvertJsonToStructured to its named
transition). Two callers were not updated and still pass two arguments:

- `tests/migration_corpus_v0.rs:88` —
  `derive_plan_steps(&successor, &intents)`
- `src/storage/tests.rs:1556` —
  `crate::migration::derive_plan_steps(&successor, &[...])`

Both fail `E0061` ("argument #2 of type `&snapback::manifest::SchemaManifest`
is missing"), so the **lib test target and migration_corpus_v0 do not
compile on current main** — every full or filtered `cargo test` is blocked
before any test runs. Verified against origin/main at `0d8829485`
(2026-08-15). The 2026-08-15 re-observation in
`issues/20260810-main-red-lib-quad-evening-landings.md` (three clean full-lib
runs at `1c05bba66`) predates this; the compile break is newer than that
baseline and is not part of that tracker's five-red set.

## Why not fixed here

The mechanical fix is passing the correct predecessor schema at each call
site, but which schema is the semantic predecessor is the migration lane's
call — `d50ed4f7b` added predecessor-dependent validation, so a guessed
argument compiles while quietly changing what the test asserts. The owning
lane was actively landing today; per the 2026-08-10 sitting convention this
is theirs to claim, and unclaimed for 24h it becomes fix-forward for anyone.

## Acceptance

- Both callers pass the intended predecessor schema and the tests' original
  assertions still hold.
- `cargo test` compiles on main (red set returns to the tracked
  content reds, currently the MediaRef family).

## Resolution

Resolved 2026-08-15, fixed forward same-evening (the semantic predecessor
turned out to be unambiguous at both sites, so the 24h claim window was not
needed). The owning lane fixed the storage preview caller concurrently
(`35bc3cd82`, passing `db.schema()` — semantically identical to this run's
draft, which was ceded to theirs on rebase); this landing fixes the remaining
`tests/migration_corpus_v0.rs` caller by passing the `predecessor()` already
constructed in `plan()`. Verified at the pre-race base: lib target compiles,
`migration_preview_populates_bounded_precondition_rows` passes, and
`migration_corpus_v0` passes 4/4; re-verified `migration_corpus_v0` 4/4 after
the rebase.

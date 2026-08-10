# main red: tests/local_v0.rs + tests/structural_validation_v0.rs fail E0624 (private storage methods)

**Status:** Open
**Severity:** P2 (two integration suites uncompilable on main; unrelated work must exclude them from verification scopes)
**Systems:** Storage, Testing
**Date:** 2026-08-09

## Problem

At `aabf2c245` (and presumably since the storage god-file split), the
default `cargo test` cannot compile two integration suites: 11 E0624
errors — `tests/local_v0.rs` and `tests/structural_validation_v0.rs` call
`LocalDatabase` methods that are now `pub(super)` in
`src/storage/versions.rs` (`current_version`, `table_change_version`,
`prune_change_journal`, `journal_floor_version`), while the public route
is the `VersionsKernel` accessor (`db.versions().table_change_version()`,
`src/storage.rs:1994`) the split introduced.

Found during the LLP 0211/unique-where-present landing verification
(Lane B's codex session correctly identified the reds as pre-existing;
the orchestrator's first baseline check mismeasured — pipeline `$?` —
and briefly disputed it; a clean stash/compile comparison confirmed 11
E0624 at base on both sides).

## Ask

Mechanical fix-forward: port the ~11 call sites in the two suites to the
`versions()`/`versions_read()` kernel accessors (or restore thin pub
wrappers if the kernel is not meant to be the test-facing surface —
whichever the god-file-split program intended). Then re-admit both suites
to the default verification scope.

## Done when

`cargo test --test local_v0 --test structural_validation_v0` compiles and
passes on main.

## Resolution (2026-08-09)

Fixed forward by the fleet the same day: main now ports both suites
through the versions/query-reads kernel accessors; both compile clean
at 979f3aab5 (verified during the LLP 0211 landing).

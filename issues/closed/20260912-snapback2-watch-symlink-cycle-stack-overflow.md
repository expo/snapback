# snapback2 watcher recurses through symlinks — cycle = stack-overflow abort

**Status:** Resolved
**Priority:** P1
**Date:** 2026-09-12
**Source:** snapback2 comprehensive review workflow (2026-09-11 sweep)
**Location:** `snapback2/crates/snapback2/src/watch.rs:210` (`collect_authored_sources`)

## What was reported

`collect_authored_sources` recurses on `path.is_dir()`, which follows
symlinks, with no cycle set or depth cap. A symlink cycle under `snapback/`
(e.g. `a/b -> ..`) yields unbounded recursion and a stack-overflow abort in
the watcher thread. Symlink contents under a watched tree can be
attacker- or accident-influenced (vendored deps, linked checkouts).

## Suggested fix

- Do not follow symlinks during the walk (`symlink_metadata` + file-type
  check), or keep a visited `(dev, ino)` set plus a depth cap.
- Add a regression test with a symlink cycle fixture asserting termination.

## Acceptance

- Cyclic-symlink fixture terminates with a bounded result; no stack
  overflow under the test harness.

## Resolution (2026-09-12)

Source traversal now reads directory-entry types and skips symlink directories and files. The cycle/linked-file regression terminates and sees only regular authored sources. Validation: the integrated native owner suite passed 263 tests, including `source_walk_does_not_follow_symlink_cycles_or_linked_files`.

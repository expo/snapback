# snapback2 publish scratch sweep can panic an active long put

**Status:** Resolved
**Priority:** P1
**Date:** 2026-09-12
**Source:** snapback2 comprehensive review workflow (2026-09-11 sweep)
**Location:** `snapback2/crates/snapback2/src/blob_store.rs:723` (`PublishScratchWriter::write`), `:669` (`enumerate_page`)

## What was reported

`PublishScratchWriter::write` expects its scratch-map entry to exist, but
`enumerate_page:669` evicts temp entries older than 5 minutes. A concurrent
sweep during a long-running put removes the entry out from under the active
writer and the worker panics.

## Suggested fix

- Make the write path entry-or-recreate (or hold a generation guard / skip
  the sweep for puts with active writers).
- Add a regression test: slow put spanning a sweep must complete, not panic.
- Reproduce before fixing (short eviction timeout + slow writer).

## Acceptance

- Long puts survive concurrent sweeps; sweep still reclaims genuinely
  abandoned temps.

## Resolution — 2026-09-12

The reported eviction was already prevented by active_puts on the starting revision. Strengthened the paused-writer regression by setting its temporary's mtime beyond the five-minute eviction age: it passes both before and after this work, completes publication, and preserves the active entry through sweep. The existing abandoned/failed-cleanup sweep regressions still remove aged inactive files. The writer now also returns an I/O error if its accounting entry is absent rather than panicking. All 14 blob tests pass.

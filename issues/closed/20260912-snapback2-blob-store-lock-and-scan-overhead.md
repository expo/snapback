# snapback2 blob_store lock and per-write scan overhead

**Status:** Resolved
**Priority:** P1 (per-chunk / per-reservation cost)
**Date:** 2026-09-12
**Source:** snapback2 comprehensive review workflow (2026-09-11 sweep)
**Location:** `snapback2/crates/snapback2/src/blob_store.rs:716`, `:172`, `:427`, `:324`, `:578`, `:787`

## What was reported

- `:716` — `write()` folds the **whole** scratch map
  (`values().copied().fold`) per `write()` call: O(map) per chunk. Same
  idiom at `:172`, `:427`. Fix: index by id.
- `:324` — `reserve_scratch` holds the scratch guard across
  `scratch_usage()`, which does `read_dir` + `symlink_metadata` per entry:
  disk latency serializes all reservations. Fix: snapshot usage lock-free
  or two-phase (compute outside the guard).
- `:578` — `enumerate_page` holds the `enumerations` mutex across
  per-entry `symlink_metadata` + nested `active_puts`/`publish_scratch`
  locks + `remove_file`: one slow entry stalls enumerations. Fix:
  collect-then-sweep outside the lock.
- `:787` — `copy_from` locks/unlocks twice per 64KB iteration
  (cancel + write). Fix: single critical section / local cancel flag.

Measure before/after (reservation latency, write throughput, enumeration
hold time) — the review gave no numbers for these.

## Acceptance

- Per-write cost independent of map size; reservation and enumeration no
  longer serialize on disk I/O; benchmarks or ad-hoc measurements recorded
  in the ticket.

## Resolution — 2026-09-12

Publication now maintains an aggregate byte counter and HashMap entries, with no per-write map fold. Reservation physical scans precede the accounting lock. Enumeration takes one cursor out of the shared registry; read_dir/metadata/unlink/visitor calls run outside that mutex. Upload copying uses an atomic cancellation observation before read and one custody lock per chunk before write.

Mac local debug measurements (100,000 one-byte writes, includes disk syscall): baseline map=1 210.1ms, map=32 256.0ms; after map=1 259.5ms, map=32 209.6ms. The new implementation has no cardinality slope; absolute timings are load-sensitive, so no general throughput gain is claimed. 1,000 empty-directory reservations: baseline 12.5ms, after 16.2ms; the intended gain is concurrent lock availability, not faster read_dir. At the actual enumeration inspection hook the registry can now be acquired in 3.25us; previously the same inspection/visitor executed with that registry held for its whole duration. Regression assertions prove both disk-scan reservation-lock availability and enumeration inspection/visitor lock availability. Fourteen blob tests pass. Scratch ceilings and retained failed-cleanup charges remain covered.

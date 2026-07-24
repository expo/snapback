# Boundedness: 64 KiB buffer accounting, one in-flight pull, absolute wall clock

**Status:** Open — local arm landed 2026-07-24. Done: accounting domain
defined (host-materialized bytes per invocation, one queued chunk per cursor
plus handoff copy; kernel/socket buffers explicitly out of scope), real
counter + four-cursor slow-consumer high-water witness under 64 KiB;
one-in-flight-pull-per-cursor serialized structurally (rendezvous channel)
and in the shared bridge reader; separate connect/idle/per-read/wall timers
with the 30 s ceiling absolute on the read itself (blocked-read witness) and
2 s terminalization grace reserved ahead of the watchdog (witnessed);
decision 6's monotonic elapsedMs/deltaMs on every read result; local
manifest buffered-bytes row flipped to real `Enforced` plus
read-size/cursor/wall rows. `cargo test --lib` 1138; instrument PASS 6/6.
Remaining before close: the Workerd arm legs of every bullet (blocked on the
unlanded Workerd streaming baseline; see the program index).
**Severity:** P2
**Systems:** Actions, Runtime, Outbound fetch, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0076 §Surface (limits) + Evidence-status gaps, src/server.rs (no buffer counter, wall check at read boundaries, ureq idle-window timeout), cloudflare/src/coordinator.js (per-chunk bound), packages/snapback-harness/ctx-bootstrap.js (concurrent reads), issues/20260723-llp0076-streaming-program.md
**Marker:** llp-0076, streaming, boundedness

The 64 KiB buffered-byte bound has no accounting domain and no local counter
(only Workerd enforces a per-chunk bound); the shared reader permits multiple
outstanding `read()` calls per cursor; the local host caps the upstream request
timeout at the idle window and checks the 30 s wall only at read boundaries, so
a productive stream can fail near 5 s and be mislabeled, and the wall ceiling is
not an absolute bound on the read.

**Done when:**

- The 64 KiB accounting domain is defined (host-retained unread vs bridge copies
  vs VM/platform buffering — the local host relies on excluding kernel/socket
  buffering; state whether that is in scope), a real counter enforces it, and a
  slow-consumer witness records a peak-buffered high-water mark.
- At most one in-flight pull per cursor is serialized on both hosts.
- Separate overall/idle/connect/per-read timers; the 30 s ceiling is absolute
  (bounds the read itself); terminalization grace is reserved outside the action
  watchdog so a default action can reach and durably settle its 30 s timeout.
- The buffer-accounting and wall-clock gap rows move to closed; the manifest
  `bounded_response_stream_buffered_bytes` row can flip from a false `Enforced`
  to real enforcement (coordinate with the capability-honesty ticket).

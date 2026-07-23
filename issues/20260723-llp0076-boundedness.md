# Boundedness: 64 KiB buffer accounting, one in-flight pull, absolute wall clock

**Status:** Open
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

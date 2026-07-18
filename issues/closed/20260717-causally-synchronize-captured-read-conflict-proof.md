# Causally synchronize the captured-read conflict proof

**Status:** Closed
**Severity:** P2
**Systems:** Runtime, OCC, Local integration proof
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0003; LLP 0032
**Marker:** runtime, occ, captured-read, test-flake

The captured handler-read conflict test opened the stale-read window by polling
storage from JavaScript up to 100,000 times while a second `LocalSnapback`
instance opened, loaded functions, and committed. Under the loaded canonical
proof, the handler could fail during that synthetic polling loop before it
reached commit-time captured-read validation. The isolated test passed, making
the proof scheduler-sensitive and obscuring the behavior it intended to test.

**Done when:**

- The first handler pauses only after recording the exact row dependency.
- The concurrent mutation commits before the first handler resumes.
- The test reaches commit-time validation without repeated host calls or
  ambient-clock timing.
- The synchronization helper remains debug-only, one-shot, bounded, and does
  not hold its global mutex while paused.
- Focused and canonical proofs pass.

## Resolution

The debug-only captured-point-read hook now consumes the matching hook once,
signals that the dependency has been recorded, and waits on a bounded release
channel without holding the hook mutex. The test commits the concurrent write
and then releases the first handler. Its JavaScript fixture performs one
captured read followed by the patch, so the assertion exercises captured-read
OCC directly instead of a high-volume polling race.

Focused proof on 2026-07-17:

- `cargo test --test local_v0 captured_handler_read_conflict_rejects_without_client_read_set -- --nocapture`
  — passed.

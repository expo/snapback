# Per-read authority fence and cursor cancellation signal

**Status:** Open — local arm landed 2026-07-24 (pre/post-pull revalidation
with late-byte discard, attempt-to-cursor cancellation signal at the pull
boundary with physical upstream closure, terminalization-during-read and
indefinite-source socket-close witnesses; `cargo test --lib` 1135). Remaining
before close: (1) an end-to-end witness under real ServicePrincipal
authority — the fence's service tier shares the reviewed process-fence
predicate but has not been executed through a streamed action with scoped
tokens; needs the service-connection fixture; (2) the Workerd arm, which
still validates only before the operation (blocked on the unlanded Workerd
streaming baseline; see the program index's baseline-landing note). The
local in-flight pull drains (bounded by the 5 s idle ceiling) rather than
aborts — an abort would need a reader-thread redesign and is not claimed.
**Severity:** P1
**Systems:** Actions, Runtime, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0076 §Authority and lifecycle + Evidence-status gaps, src/server.rs (validate_live, read_response_stream), cloudflare/src/coordinator.js (Workerd read closure), issues/20260723-llp0076-attempt-control-plane.md, issues/20260723-llp0076-streaming-program.md
**Marker:** llp-0076, streaming, authority

Local host-op validation checks abandonment, generation, and deadline but not
service authority, and a blocking read has no post-read revalidation before
returning bytes; Workerd checks only before the operation. An authority
terminalization landing during a blocked read can still hand bytes to the
action. Caller cancellation reaches the physical reader only when a later
progress mutation observes the terminal row, so a stalled read may not act until
idle timeout.

**Done when:**

- An exact permit (or equivalent fenced post-pull check) is held through pull and
  byte handoff on both hosts; service authority is part of the revalidated
  predicate; late bytes are discarded when authority was lost.
- A direct attempt-to-cursor cancellation signal aborts or drains the in-flight
  pull and prevents new pulls, decoupled from the next progress mutation.
- Deterministic terminalization-during-open and terminalization-during-read
  witnesses, plus an observable upstream-socket-close test against an
  indefinite no-more-bytes source.
- The per-read-fence and cancellation gap rows move to closed.

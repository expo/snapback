# Per-read authority fence and cursor cancellation signal

**Status:** Open — local arm landed 2026-07-24 (pre/post-pull revalidation
with late-byte discard, attempt-to-cursor cancellation signal at the pull
boundary with physical upstream closure, terminalization-during-read and
indefinite-source socket-close witnesses). Workerd leg landed 2026-07-24:
reads revalidate the action-abandonment signal before AND after the pull and
discard late bytes; on `cloudflare-do-sqlite-v8` that signal is the complete
revalidation predicate because hosted auth (and with it scoped-token service
authority) is `unavailable` on the target — witnessed within the 27/27
Miniflare egress acceptance. Remaining before close: ONE item — the local
end-to-end witness under real ServicePrincipal authority (needs the
service-connection fixture).
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

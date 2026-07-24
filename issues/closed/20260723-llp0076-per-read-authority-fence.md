# Per-read authority fence and cursor cancellation signal

**Status:** Resolved (2026-07-24 — all legs witnessed, including the
ServicePrincipal tier end to end; see Resolution)
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

## Resolution (2026-07-24)

Local arm (commit b66f46e1): pre- and post-pull revalidation of
abandonment/generation/deadline plus the lock-free process-fence tier of
service authority, with late-byte discard; the direct attempt-to-cursor
cancellation signal with physical upstream closure; terminalization-during-
read and indefinite-source socket-close witnesses.

Workerd leg (commit 15e1984a): reads revalidate the action-abandonment
signal before AND after the pull and discard late bytes; on
`cloudflare-do-sqlite-v8` that signal is the complete revalidation predicate
(hosted auth, and with it scoped-token service authority, is `unavailable`
on the target). Witnessed inside the Miniflare egress acceptance.

ServicePrincipal tier, end to end (this commit):
`service_principal_terminalization_fences_stream_open_and_discards_late_bytes`
prepares a REAL scoped-token authority through the production machinery —
sessions-mode `AdmissionController`, the `HttpAction` source class that
admits ServicePrincipal, `InvocationGate::prepare_admitted_authority`, and a
fence-registry publication whose witness identity the per-read check matches
field for field — then commits a real service terminal gate
(`acquire_terminal_gate` → `prepare_terminal` → `committed`) 200 ms into a
blocked pull. The late bytes are discarded with the exact
`SNAPBACK_AUTH_SCOPED_TOKEN_INVALID`, the cursor closes, and a subsequent
open under the terminalized authority is refused at the pre-open leg with
the same code. The local in-flight pull drains (bounded by the 5 s idle
ceiling) rather than aborts — stated, not hidden.

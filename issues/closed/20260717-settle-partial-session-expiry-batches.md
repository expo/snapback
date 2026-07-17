# Settle partial session-expiry batches without losing terminal propagation

**Status:** Closed
**Severity:** P1
**Systems:** Session auth, Expiry worker, Connection grants, Live delivery
**Author:** Codex (GPT-5)
**Date:** 2026-07-17
**Related:** LLP 0059 §Plan, begin, commit, finalize; LLP 0059 §Typed terminal auth error
**Marker:** auth, expiry, concurrency, terminal-order, release-blocker

A due-expiry batch installs one exact ticket per sampled session and then
finalizes those tickets sequentially. A concurrent, already-premarked
revocation can win one session after the expiry ticket is installed. If an
earlier batch entry has already finalized when the losing entry returns an
error, the coordinator discards the whole result: the successful session never
reaches the terminal sink, while the losing expiry ticket remains pending.

That violates the mandatory post-commit propagation phase and can leave an
expired live grant without its typed notifier event until process shutdown or
some later activity happens to observe the stale leaf.

**Done when:**

- A batch classifies each exact expiry ticket independently after every drain.
- A ticket whose sibling already made the session terminal is exact-unmarked
  without changing that sibling's committed state.
- Every expiry ticket that still owns its sampled predecessor finalizes and is
  returned to the terminal sink even when another entry loses.
- Any contradictory entry fails closed without discarding already-finalized
  terminal outputs or leaving an otherwise-settleable ticket pending.
- A deterministic two-session race lets a sibling revocation win one entry,
  proves the other session reaches grant/notifier terminal propagation, and
  proves neither expiry ticket remains stranded.
- Focused coordinator/runtime/server tests and `./ref-check --verbose` pass.

## Resolution

Sampled expiry finalization now settles each exact ticket independently. A
sibling logout, security revocation, or deadline replacement exact-unmarks only
the losing expiry ticket and does not suppress successful siblings. A true
ticket/fence contradiction closes the coordinator globally, but the batch
continues settling independent entries and carries every successful terminal
result to the runtime; the infallible expiry sink consumes those results before
the projection diagnostic is returned.

Covered by
`sampled_expiry_settles_sibling_revocation_without_losing_successes`,
`contradictory_expiry_entry_preserves_successful_terminal_outputs`,
`failed_expiry_batch_delivers_successful_siblings_before_error`, and
`authoritative_expiry_terminal_sink_is_idempotent`. The session-projection,
coordinator, and runtime test modules pass, the real grant/notifier sink test
passes, and `./ref-check --verbose` reports zero errors and unchecked refs.

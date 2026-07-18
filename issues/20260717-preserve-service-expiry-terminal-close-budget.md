# Preserve the service-expiry terminal close budget

**Status:** Fixed — canonical proof pending
**Severity:** P1
**Systems:** Agent auth, Service authority, Connection grants, Live sockets
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0059 §Finite service authority fence; LLP 0059 §Typed terminal auth error
**Marker:** auth, scoped-token, expiry, close-budget, lifecycle, release-blocker

Finite HTTP deadline maintenance and the live connection deadline observer
calculate `closeBy` only after the exact-token drain and durable expiry
transaction finish. Both paths therefore grant a fresh five-second close grace
at observation/commit time, even when the projected monotonic expiry was
noticed late. LLP 0059 instead makes scheduler, drain, and commit latency spend
the one budget measured from the projected monotonic deadline. Only an epoch
deadline newly proved by a forward wall-clock jump starts grace at observation.

The authority fence still refuses every act after expiry, but an arbitrarily
delayed observer can keep a terminal socket and its transport resources alive
beyond the protocol's hard close bound.

**Done when:**

- Deadline classification retains the terminal close deadline together with
  the durable token/grant ending plan.
- A projected monotonic token or grant expiry closes at that projection plus
  `TERMINAL_CLOSE_GRACE`; later scheduling, drain, and commit work do not reset
  the grace.
- A forward wall-clock proof which precedes all projected monotonic deadlines
  closes at observation plus the same grace.
- Both finite HTTP and live deadline owners propagate the retained close
  deadline to every affected service carrier.
- A delayed-observer regression proves same-grant sibling fanout retains the
  original close deadline, plus a focused clock test covers the forward-wall
  exception.
- Focused service-fence/server tests, LLP references, and the canonical proof
  pass.

## Resolution

`ServiceAuthorityDeadlineTerminal` now carries the hard `close_by` selected at
the first deadline classification. Classification chooses the earliest due
projected monotonic deadline when one exists and spends grace from that point;
otherwise the due epoch deadline is a forward-wall observation and spends
grace from the observation cut. The finite HTTP owner and live observer retain
that value through planning, exact-token drain, durable terminal publication,
all-token lifecycle propagation, and final exact-ticket settlement.

Focused verification on 2026-07-17:

- `cargo test --lib delayed_monotonic_observer_spends_the_original_terminal_close_budget -- --nocapture` — passed.
- `cargo test --lib delayed_live_observer_grant_expiry_preserves_close_budget_and_fanout -- --nocapture` — passed.
- `./ref-check --verbose` — 63 LLP documents, 1,347 references, 0 errors, 0 unchecked.

The repository-wide canonical proof remains for the parent landing pass.

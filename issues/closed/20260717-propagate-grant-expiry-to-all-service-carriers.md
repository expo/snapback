# Propagate grant expiry to every service carrier

**Status:** Closed
**Severity:** P1
**Systems:** Agent auth, Service authority, Connection grants, Live queries
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0055 §Ending authority: revocation, expiry, deactivation; LLP 0059 §Finite service authority fence; LLP 0059 §Typed terminal auth error
**Marker:** auth, service-authority, expiry, fanout, lifecycle, release-blocker

A grant-deadline transaction correctly plans and revokes every scoped token for
the grant, and its exact process-fence settlement marks every token
`durableDelete`. Both server deadline owners nevertheless propagate lifecycle
cleanup only for the one token that happened to observe the deadline. Sibling
connections on other tokens lose act authority but can miss the typed
`expired` / `durableDelete` wake, registry retirement, effect purge, and owned
topology cleanup.

`LocalSnapback::persist_service_deadline_if_due` can make this worse for managed
server calls: it may synchronously commit the terminal transaction while Local
is held, before the independently owned async deadline helper runs. The later
helper then sees an already-terminal publication and skips the only lifecycle
fanout entirely.

**Done when:**

- Both the finite HTTP deadline owner and the connection/live deadline observer
  retain the transaction's exact planned token-id vector through lifecycle
  propagation.
- Grant expiry sends `reason: expired` and
  `authorityDisposition: durableDelete` to every socket carried by every token
  in the grant, removes each connection grant, and purges each connection's
  retained effects/topology.
- Managed Local execution cannot commit deadline terminalization ahead of the
  async drain-before-write owner; it fails the current act closed and leaves
  durable commit plus fanout to the registered HTTP middleware or live
  observer. Direct library embedding keeps its synchronous persistence seam.
- Deterministic two-token/same-grant socket coverage proves all-token fanout,
  including a direct scoped-bearer request whose deadline crosses after
  authority preparation but before the Local handler act.
- Focused storage/local/server tests and the canonical proof pass.

## Resolution

The finite HTTP deadline owner and live-stream observer now carry their exact
planned token vector into typed lifecycle propagation. Managed Local expiry
refuses before writing so those owned paths cannot be bypassed; the direct
embedding seam remains synchronous. Deterministic two-token/two-socket tests
cover both owners, including two retained live topologies and a direct bearer
whose deadline crosses at the pre-handler pause.

The final ordering review found one additional cross-ending race: commit
settlement removed the exact service-domain ticket before typed lifecycle
fanout. A stronger overlapping ending could then commit while the predecessor
still owned fanout, and the first lifecycle removal could consume the only
connection captures before the stronger disposition reached them. Settlement
is now split into after-Local terminal publication and a final ticket release;
all service-ending handlers queue lifecycle propagation between those phases.
The deterministic
`committed_gate_stays_exactly_pending_through_after_local_lifecycle` regression
attempts a stronger ending from inside predecessor lifecycle work and proves it
cannot pass until the predecessor ticket is released.

The final observer audit removed another false-success boundary. Live deadline
observation now returns classification, planning, exact-gate, durable
transaction, owned-task panic, and `JoinError` failures rather than silently
returning. A due publication stays `Unavailable` and no typed durable terminal
is inferred from a failed attempt; the socket owner emits only a stable,
identifier-free cause code and synchronously transfers a panic-isolated retry
owner before returning. Its exponential backoff starts at 10 ms and caps at
60 seconds, preventing a permanent poison from logging at high frequency.
Deterministic planning/gate/transaction/task-panic injections prove the first
failure is observable and fail-closed, the independent owner survives the
socket path, consumes every later failure, and finally performs the required
all-token durableDelete fanout and retirement.

Focused grant-deadline and service-fence tests passed, followed by the full
Rust library suite (1,102 passed), `local_v0` (96 passed), and LLP reference
validation.

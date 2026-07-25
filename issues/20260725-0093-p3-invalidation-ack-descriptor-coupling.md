# 0093 P-3: invalidation-ack routes demand the authority-descriptor offer — deliberate or defect?

**Opened:** 2026-07-25
**Source:** LLP 0096 §8.1 (P-3 verification pass)
**Systems:** Auth, Wire Protocol, Server
**Kind:** author decision

## Finding (verified at `0de3e875`)

`registered_invocation_source` maps
`/live/authorization-invalidation/acknowledge` and
`/live/authorization-invalidation/manual-retry` to
`InvocationSource::StandaloneAcknowledgement` (`src/server.rs:7993-7997`),
and `queued_replay_requested` returns `true` for every standalone
acknowledgement (`src/server.rs:8084-8095`). The sessions-mode gate at
`prepare_registered_route_authority` (`src/server.rs:8117-8130`) therefore
requires authority-descriptor **readiness** and the
`x-snapback-authority-descriptor-protocol: 1` offer on both
invalidation-ack routes — coupling `auth/live`'s acknowledge path
(axis `authScopedLive`) to `auth/replay`'s plane (axis `queuedReplay`).

Consequence: in the readiness interval where authorization invalidation
is ready but the authority-descriptor program is not (a state LLP 0059's
item ordering admits — see
`later_items_unlock_only_their_owned_surfaces`,
`src/auth/handshake.rs:717-765`), `GET /auth/session` advertises
`authScopedLive: available` while the axis's own acknowledge protocol
refuses with `SNAPBACK_AUTH_POLICY_UNAVAILABLE
{capability: "queuedReplay"}`. A client claiming only `auth/live` cannot
discharge invalidation obligations without also sending the descriptor
offer.

## Decision needed

Either:

1. **Deliberate** — acknowledgements are descriptor-bound by design (the
   ack token binds to authority identity). Then LLP 0053/0059 should
   state the rule explicitly, and LLP 0096 §2.2's "observed behavior"
   flag graduates to ratified contract (a dated 0096 amendment).
2. **Defect** — LLP 0059's axis independence should hold; the two
   invalidation-ack routes need their own `queued_replay_requested`
   classification (return `false` for them, or split
   `StandaloneAcknowledgement` into mutation-settlement vs
   invalidation-ack sources) so `auth/live` stands alone.

Until decided, LLP 0096 §2.2 instructs claiming clients to send the
descriptor offer on the ack routes to interoperate with shipped servers.

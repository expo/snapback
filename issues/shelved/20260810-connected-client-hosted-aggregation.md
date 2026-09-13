# Connected-client predicate lacks a hosted multi-instance authority

**Status:** Open
**Area:** Realtime, hosted deployment, auth, actions
**Related:** LLP 0222, LLP 0008, LLP 0014, LLP 0143

## Problem

The local Rust target can answer `ctx.realtime.hasFreshClient` truthfully
because managed client acts and action handlers share one app-instance process.
The remote-service capability projection is independently qualified and the
Cloudflare target currently has neither the session-authenticated client
surface nor an action host backed by the Rust witness index. Advertising the
local process index on either target would therefore produce false negatives
whenever the action and client land on different authorities.

The 2026-08-10 LLP 0222 author ruling asked for an honest aggregation story,
not a capability-shaped placeholder. This lane implements and declares
`aggregationMode: single-authority-routing` for the local target and keeps the
remote/Cloudflare projections Missing. There is no proved shared union today.

## Required resolution

Before a multi-instance or hosted target advertises
`realtime.connected-client-predicate`, it must choose and prove one of:

1. route every qualifying managed-WebSocket/authenticated-poll act and every
   predicate-reading action for an app to the same declared authority, with
   failover/restart semantics matching the 15-second budget; or
2. maintain a bounded shared expiry index whose updates and exact
   grant/generation retirement are ordered well enough that `true` never
   outlives a known terminal carrier and `false` is a union across all serving
   instances.

The target manifest must then publish its own semantics/version/transport and
aggregation facts, and acceptance must cover cross-instance multi-device
existence, expiry, revocation, failover, and action routing. Do not close this
ticket merely by copying the local manifest row.

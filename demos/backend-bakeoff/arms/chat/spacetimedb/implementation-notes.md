# Implementation notes

## Provider-native shape

- Private source tables hold personas, channels, memberships, messages,
  presence, typing, read markers, and page-result snapshots.
- Public per-caller views expose only rows authorized for `ctx.sender`.
- Reducers derive actor identity and commit timestamp from server context.
- An auto-incrementing `u64` is the deterministic total message order.
- Client caches are populated and updated by native WebSocket subscriptions.
- `clientConnected` and `clientDisconnected` lifecycle reducers maintain
  presence.
- Stable 25-row pages are materialized by a reducer because views do not
  accept application parameters.

## Explicit nonclaims

- `typing_state` is durable application glue with explicit clear. It is not
  claimed as native ephemeral state or native TTL.
- The SDK subscription cache is in-memory. No provider-backed persistent
  cold-start offline history is claimed.
- The calibration used server-issued development identities and an
  application reducer that binds an identity to a frozen persona. This is not
  a complete human account system.
- Hosted Maincloud evidence was unavailable and is recorded as a neutral
  environment GAP, not a product failure.

## Reproduction outline

The retained source can be rebuilt with SpacetimeDB CLI 2.7.0 and Node 24.
The original target has intentionally been removed, so reproduction must use
a new isolated database name and update the client/harness constants.

1. Start a standalone server with an explicit listen address and data path.
2. Install `work/server/spacetimedb` dependencies and publish the module.
3. Generate TypeScript bindings.
4. Build `work/client`.
5. Run `work/harness/verify.ts` against the new target.

Never reuse the deleted target identity or the original worker ports without
re-running the isolation preflight.

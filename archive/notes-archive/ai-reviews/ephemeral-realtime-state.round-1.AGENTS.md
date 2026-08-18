# Review: LLP 0013 — Ephemeral realtime state

**Reviewed:** `llp/0013-ephemeral-realtime-state.rfc.md`
**Reviewer:** Codex
**Date:** 2026-06-25

## Overall assessment

This is the right subsystem boundary. The strongest decision is the negative
one: ephemeral state is not faster durable state, not raw Redis, and not ordinary
query-result sync. Typed, scoped, TTL-bound latest-state collections fit
Snapback's agent-first and local-first constraints while protecting the
SQLite/Postgres path from cursor-position write amplification.

The RFC is directionally good enough to keep, but it should become more
implementation-shaping before agents start building against it. Right now it
leaves too many concrete limits and runtime mechanics in open questions, which
means the first implementation could accidentally invent incompatible behavior.

## Strengths

- The durable/ephemeral/cache vocabulary is clear and should reduce the human and
  agent confusion that motivated the feature.
- TTLs, leases, snapshot-first subscriptions, and resnapshot recovery are the
  right semantics for presence-like data.
- Keeping Redis, memcached, UDP, and SpacetimeDB out of the app-facing API is the
  correct portability call.
- The document already treats auth, privacy, and backpressure as core semantics,
  not optional infrastructure details.
- The validation requirements are product-shaped rather than implementation-only;
  they exercise disconnect, restart, multi-instance capability gaps, and auth.

## Concerns

- **C1 — Limits are too deferred. [High]** The RFC says TTL, payload size,
  publish rate, and subscriber limits are open. Those are not polish; they shape
  the API, diagnostics, and test harness. Add provisional local-target defaults,
  clearly labeled as draft budgets to benchmark, so implementation has a
  concrete starting contract.

- **C2 — Scope routing is underspecified. [High]** "Scope partitions fan-out" is
  right, but hosted targets need a routing key/room identity. Cloudflare Durable
  Objects and Redis-style fan-out both depend on whether all writes/subscribers
  for one scope land in the same authority. Add a routing model that says a
  collection/scope maps to one ephemeral room and that multi-instance local
  memory is invalid without sticky scope routing.

- **C3 — Durable and ephemeral delivery lanes need explicit isolation. [High]**
  The document distinguishes durable and ephemeral messages, but cursor floods
  must also be unable to starve durable mutation acks or changesets on one
  WebSocket. Add transport scheduling: durable reliable lane first, ephemeral
  latest-state lane coalesced and bounded separately.

- **C4 — Server handler reads should be stricter. [Medium]** "Unsupported or
  advisory-only" leaves a footgun open. V1 should ban server reads of ephemeral
  state on the paved path. Publishing advisory state after commit is fine;
  deriving durable correctness from ephemeral state is not.

- **C5 — Stale-update rejection needs a concrete revision concept. [Medium]**
  A server timestamp alone is not enough once adapters differ or clocks have
  coarse precision. Define an adapter-allocated monotonic `entryVersion` per
  collection/scope/key, plus a scope epoch for resnapshot boundaries.

- **C6 — Publisher admission control is separate from subscriber backpressure.
  [Medium]** The RFC handles slow subscribers well, but a single publisher can
  still burn CPU by sending too fast. Add per-connection/per-collection publish
  budgets and specify that rejected publishes surface as ephemeral errors without
  affecting durable mutation state.

- **C7 — Client storage lifecycle should be explicit. [Low]** Ephemeral snapshots
  should live in an in-memory client overlay, not the retained offline local
  store. That distinction will stop adapters from accidentally preserving stale
  cursors offline.

## Suggestions

- Add a "V1 local defaults" section with draft numbers: 5s default TTL, 30s max
  TTL, 1 KiB default value budget, 4 KiB local hard cap, 20 Hz sustained publish
  rate per connection/collection, short burst allowance, 30 Hz or 33ms coalesced
  dispatch tick, diagnostics around 100 subscribers per scope.
- Add "rooms" or "ephemeral scopes" as the routing unit:
  `collection + normalized scope` maps to a room owned by one local process,
  Durable Object, or Redis channel group.
- Add a small record shape for stored entries: value, owner, expiry, server
  receive time, `entryVersion`, and adapter epoch.
- Add a delivery-lane section: durable messages are reliable/ordered by commit
  version; ephemeral messages are latest-state/coalesced and may force resync.
- Make v1 server-side reads of ephemeral state unsupported on the paved path.
- Add a warning that ephemeral state should not be retained in the client
  offline store.
- Keep the status as `Draft`; after revision, it may be ready for `Review` if
  the author wants a second-pass external review.

## Open questions

- Are the proposed v1 default budgets acceptable as product defaults, or should
  they be local-development defaults only?
- Should scope routing be mandatory in the generated API, or inferred from the
  first scope field?
- Should the first Redis-compatible adapter prefer simple pub/sub plus key TTLs,
  or streams for better resync diagnostics?
- Should WebTransport be a named v2 milestone, or stay as a transport-neutral
  future option?

## Revision plan

Revise the RFC to add concrete v1 budgets, scope-room routing, delivery lane
isolation, entry versioning, publisher admission control, client overlay
lifecycle, and stricter server-handler read semantics. Keep remaining hard
adapter choices open.

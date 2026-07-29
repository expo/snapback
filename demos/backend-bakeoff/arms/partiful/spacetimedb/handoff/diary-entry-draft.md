# Diary draft — Partiful / SpacetimeDB deep round

## What felt good

SpacetimeDB’s best moment was how few moving pieces the authoritative event
model needed. Private tables plus identity-aware views made “Mallory sees the
public invitation but none of the protected event state” unusually direct.
The same views also removed Bob’s protected rows from an already-connected
client immediately after revocation. That is a strong end result for Snapback
to match: authorization changes should invalidate live client state, not only
reject the next write.

Transactional reducers were excellent for RSVP capacity. The final-seat race
needed no explicit lock, retry loop, or separate transaction API: two actor
calls crossed one barrier, one committed, and one was rejected without
overbooking. Generated bindings made reducer names and row shapes pleasant in
both the harness and UI.

Native scheduled procedures plus procedure HTTP requests were another real
strength. A schedule row became a durable run, and the same effect ledger could
serve scheduled and manual deliveries. The explicit split between transaction
sections and external HTTP also nudged the implementation toward a sound
outbox-like shape.

## What felt bad or surprising

The CLI had several avoidable papercuts. `spacetime version` is not the version
command; init requires a positional name even with a project path; build and
generate use `--module-path`; generation cannot point at a server; and the npm
package is `spacetimedb`, not `spacetime`. Each error was recoverable from help,
but the command surface did not feel internally predictable.

The SDK reports intentional reducer rejections as a generic `InternalError:
The instance encountered a fatal error`; the useful application diagnostic is
in the server log. Negative authorization and capacity tests therefore felt
much worse than the reducer code itself. Snapback should make expected domain
rejections structured and visible at the call site.

Views are powerful, but debugging a stale or incorrect harness assumption is
opaque because the client exposes the resulting table, not why a caller’s view
contains a particular row. A first-class authorization/view trace would be
valuable.

Procedure HTTP correctly blocks private destinations. That is secure, but it
made a deterministic local fake unexpectedly expensive: an ephemeral public
tunnel and readiness gate were necessary. The first tunnel URL also appeared
before its DNS record was usable. Local effect testing deserves an explicit,
safe development escape hatch or an official fake transport.

The effect exercise also reinforced that transport status is not delivery
truth. When the receiver accepted a request and dropped the response,
Cloudflare returned 502. Treating that as failure was wrong; it must remain
ambiguous and reuse the same idempotency key. Snapback could make
known-success/known-failure/ambiguous settlement a standard effect primitive.

Inline table bytes were enough for the frozen asset, and authorization was
clean, but large production event media would want native object storage,
signed delivery, metadata, and lifecycle support.

## Snapback implications

1. Match automatic live-query invalidation after authorization or membership
   changes, including removal of already-cached protected rows.
2. Make transactional contention the default ergonomic path and return
   structured domain errors to clients.
3. Offer a first-class durable effect ledger with explicit ambiguous
   settlement, idempotency-key reuse, known-success suppression, and inspection.
4. Make scheduled work and its run history inspectable without bespoke tables.
5. Provide an authorization/live-query explain tool for “why does this actor
   see this row?”
6. Preserve Snapback’s opportunity to offer a more coherent CLI: one project
   locator vocabulary, obvious version commands, actionable errors, and
   consistent local-state isolation.
7. Add a safe official local-effect test transport and eventually native asset
   storage/delivery ergonomics.

## Honest trajectory note

Nothing in this arm suggests Snapback’s approach is fundamentally disqualified
from becoming the go-to choice. SpacetimeDB’s strongest advantages here are
end results Snapback can plausibly match: automatic authorization-aware live
invalidation, serializable contention, inspectable schedules, and disciplined
effects. The gap is execution depth and coherence. If repeated refinement
turns these into paved, observable primitives rather than app-specific glue,
the trajectory can be competitive without copying SpacetimeDB’s database
architecture.

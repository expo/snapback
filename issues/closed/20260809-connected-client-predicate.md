# Server-side connected-client predicate for push seams

All three Clique pilot lanes (Snapback, Convex, Supabase) hand-built
the same thing for the push milestone: a heartbeat table + freshness
threshold to answer "does this user have a connected client right
now?" — because no platform exposes it. Snapback already tracks live
connections server-side for live queries/presence; exposing a
queryable connection predicate (or a connectedness fact on principals)
would make the notification seam ~zero-plumbing and is a genuine
differentiator since neither competitor has it. B7 scored 58/58/55 —
a three-way tie waiting to be broken. Related rows:
backend.notifications, backend.expo-push-seam, realtime.ephemeral.

## Author ruling — 2026-08-10

Proceed, at full scope. Implement the whole LLP 0222 surface at once and ship
it **enabled by default** — no conservative v1 fence. The author's explicit
posture: "don't be conservative. implement everything all at once and flip it
to on. let's surface the problems and work through them." Applied to the
RFC's open questions: **OQ1** — attempt the hosted/multi-instance aggregation
story rather than marking the capability Missing; **OQ2** — widen the
transport contract where needed for the predicate to be truthful for real
clients, keeping the `semanticsVersion` discipline for any widening;
**OQ3** — add the normative "not for exactly-once live-vs-push arbitration;
that belongs to LLP 0045's durable notification-intent lifecycle" note to
LLP 0045 now. Problems surfaced by the maximal implementation are worked
through as tickets, not fenced out of scope in advance. (Ruling recorded here
rather than in `llp/0222` because a live super-refine loop holds uncommitted
edits to that file; the loop should fold this ruling into the RFC.)

## Resolution — 2026-08-10

Implemented the enabled-by-default local target surface: a bounded 15-second
server witness index for managed WebSockets and authenticated poll acts,
session-action `ctx.realtime.hasFreshClient`, conditional generated typings,
structured semantics-v2 capability facts, lifecycle fencing/removal, the push
skip acceptance slice, and the named LLP/guide amendments. The implementation
proves multi-device existence, exact expiry/generation behavior, hard capacity,
high-churn stability, restart clearing, grant retirement, and zero durable
version advancement.

The sound aggregation posture reached in this lane is single-authority routing:
all local client acts and handlers share one app-instance process. Remote and
Cloudflare targets remain Missing rather than returning process-local false
negatives. The remaining hosted shared-union/routing proof is tracked in
`issues/20260810-connected-client-hosted-aggregation.md`.

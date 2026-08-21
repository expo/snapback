---
title: "Recipe: writes during authentication transitions"
id: recipes.auth-transition-writes
order: 12
audience: agent-first
capabilities: [clients.outbox-drain, clients.mutation-outcomes, auth.invalidation-barrier]
authorities: [llp/0043-offline-replay-retention.rfc.md, llp/0059-session-projection-and-client-barrier.spec.md, llp/0218-outbox-settlement-contract.rfc.md, packages/snapback-client/authorization-invalidation.test.mjs, packages/snapback-client/outbox-store.test.mjs]
examples: [packages/snapback-client/authorization-invalidation.test.mjs, packages/snapback-client/outbox-store.test.mjs, demos/browser-local-first]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-21
reviewed-authorities-digest: sha256:d8cac17f99ba2c4dcf845310194e20d29b6542948551e506397efdbc259e00ba
---

# Recipe: writes during authentication transitions

Login, logout, refresh, and bearer replacement create a real authority
barrier. Protected subscriptions blank and foreground sends may pause while
the predecessor is retired and the successor is proven. A background effect
that writes during that interval can receive
`SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED`; this is a custody signal, not a
content refusal and not evidence that the mutation reached the server.
This includes the reproduced “eager route-entry receipt” and broader
“background writes during auth transitions” cases, as well as an
authorization-suspended foreground gesture.

## Prefer queueable generated mutations

For receipts, route-entry bookkeeping, feed acknowledgements, and other
background work that remains meaningful after the same logical user settles,
use the generated queueable mutation path. During the barrier it resolves as
queued with `authorizationDisposition: "authorization-suspended"`; the outbox
drain resumes only after authority proof. Render that as pending and observe
the mutation settlement rather than turning it into an unhandled UI error.

Capture the logical intent once. Do not let a React effect manufacture a new
mutation id on every auth snapshot or retry tick. After a principal change,
the outbox custody rules may strand or privacy-delete predecessor work; follow
the reported disposition rather than silently replaying it as the successor.

## Fence non-queueable gestures

A foreground operation declared with `queue: false` rejects locally while
authority is suspended and does not reach transport. Disable or defer the
gesture until the coordinator/app client reports settled authority. If a race
still produces `SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED`, keep the same logical
intent, wait for that barrier to settle once, and offer or perform one bounded
retry only if the resulting principal is still the intended actor.

Treat every terminal branch explicitly: success, queued, application refusal,
auth terminal status, and genuine transport/lifecycle failure. An uncaught
authorization-suspended rejection can poison a route even though the system is
behaving correctly.

## Anti-patterns

- Retrying from an unbounded effect whose dependency is the changing auth
  object.
- Converting authorization suspension into a content refusal or “server
  failed” message.
- Assuming a foreground rejection means the mutation may already have
  committed.
- Re-recording predecessor work under a successor principal without the
  explicit stranded-intent workflow.
- Hiding queued status and declaring success before settlement.

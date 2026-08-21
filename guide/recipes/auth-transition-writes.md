---
title: "Recipe: writes during authentication transitions"
id: recipes.auth-transition-writes
order: 12
audience: agent-first
capabilities: [clients.outbox-drain, clients.mutation-outcomes, auth.invalidation-barrier]
authorities: [llp/0043-offline-replay-retention.rfc.md, llp/0059-session-projection-and-client-barrier.spec.md, llp/0218-outbox-settlement-contract.rfc.md, packages/snapback-client/index.mjs, packages/snapback-react/implementation.mjs, packages/snapback-client/authorization-invalidation.test.mjs, packages/snapback-client/generated-optimistic-default.test.mjs, packages/snapback-client/outbox-store.test.mjs, scripts/auth-settlement-packed-proof.mjs, scripts/check-guide-auth-settlement-packed-proof.mjs]
examples: [packages/snapback-client/authorization-invalidation.test.mjs, packages/snapback-client/generated-optimistic-default.test.mjs, packages/snapback-client/outbox-store.test.mjs, scripts/auth-settlement-packed-proof.mjs, demos/browser-local-first]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-21
reviewed-authorities-digest: sha256:d99337e46d8723f811216c93f0b822dd08535ceb5aa9ee1bd52e1ce04b825ce8
---

# Recipe: writes during authentication transitions

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Login, logout, refresh, and bearer replacement create a real authority
barrier. Protected subscriptions blank and foreground sends may pause while
the predecessor is retired and the successor is proven. A background effect
that writes during that interval can receive
`SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED`; this is a custody signal, not a
content refusal and not evidence that the mutation reached the server.
This includes the reproduced “eager route-entry receipt” and broader
“background writes during auth transitions” cases, as well as an
authorization-suspended foreground gesture.

In the vocabulary builders actually searched, this is the **write after login**,
**mutation during sign-in**, **outbox suspended**, or **background write auth**
recipe.

## Read the settlement state first

The shipped generated-client vocabulary distinguishes a stable signed-out
state from an authority transition. `blocked:authentication-required` and
`blocked:authentication-not-settled` below are compact spellings for the two
field pairs, not single status strings:

| Situation | Protected live-query state | Imperative one-shot refusal | Caller response |
| --- | --- | --- | --- |
| Settled signed out | `status: "blocked"`, `reason: "authentication-required"`, `transitionOwner: "auth-coordinator"` | `SNAPBACK_AUTH_REQUIRED` with `reason: "authentication-required"` and `diagnostic.details.transitionOwner: "auth-coordinator"` | Keep the intent undispatched; ask for authentication. Do not start a retry timer. |
| Signing in or signing out | `status: "blocked"`, `reason: "authentication-not-settled"`, `transitionOwner: "auth-coordinator"` | `SNAPBACK_CLIENT_AUTHORITY_CLEARING` with `reason: "authentication-not-settled"` and `diagnostic.details.transitionOwner: "auth-coordinator"` | Wait for the in-flight auth operation to settle. No transport was issued. |
| Settled signed in | `ready` or `refreshing` | admitted | Dispatch under the settled principal. |
| Terminal auth failure | `status: "error"` with `transitionOwner: "auth-coordinator"` | the recorded terminal code | Stop automatic retry, restore the control, and render/report the terminal diagnostic. |

A protected live query leaving `blocked:authentication-not-settled` is a
useful framework-visible settlement observation. Awaiting the sign-in or
sign-out call is the corresponding gesture-owned barrier. Do not invent a
second timer, a `waitForAuthSettlement` API, or a private coordinator probe.

## Prefer queueable generated mutations

For receipts, route-entry bookkeeping, feed acknowledgements, and other
background work that remains meaningful after the same logical user settles,
use the default queueable generated mutation path. In React,
`useSnapbackMutation(reference)` uses the `queue: "auto"` behavior and returns
the truthful `settled | queued` union. On the local target with a qualified
outbox and settlement ledger, accepted intent held behind the authorization
barrier resolves `queued`; the headless outcome additionally reports
`authorizationDisposition: "authorization-suspended"`. The outbox drain
resumes only after authority proof. Render that branch as pending and observe
the mutation settlement rather than declaring success.

`queue: "auto"` is capability-sensitive: without a qualified outbox it
degrades to `queue: false` and rejects instead of pretending the intent is
durable. Explicit `queue: true` requires outbox support. The separate declared
housekeeping lane and `blockedReason: "auth-barrier"` vocabulary in the LLP
0295 D0.2 implementation program are not shipped APIs today; do not invent a
`housekeeping: true` flag or promise foreground/housekeeping lane isolation.

Capture the logical intent once. Do not let a React effect manufacture a new
mutation id on every auth snapshot or retry tick. After a principal change,
the outbox custody rules may strand or privacy-delete predecessor work; follow
the reported disposition rather than silently replaying it as the successor.

## Fence non-queueable gestures

A foreground operation declared with `queue: false` rejects locally while
authority is suspended and does not reach transport. This includes
`useSnapbackSettledMutation` and Familiar `useMutation`. Disable or defer the
gesture while its sign-in/sign-out promise is in flight or its protected query
state is `blocked:authentication-not-settled`.

If a race still makes an interactive feed mutation reject with
`SNAPBACK_CLIENT_AUTHORITY_CLEARING` or
`SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED`, keep the same logical intent, wait
for that barrier to settle once, and offer or perform one bounded retry only
if the resulting principal is still the intended actor. A
`SNAPBACK_AUTH_REQUIRED` result after settlement is not another transient
attempt: return the gesture to an enabled state and route the user to sign-in.

Every dispatched promise must be awaited or have a rejection handler attached
immediately. An event handler that starts async work must end in an observed
`try`/`catch` path (or attach `.catch(...)` at dispatch), including the final
retry. Always restore disabled/pending UI in `finally`. This makes the
authorization race a rendered terminal branch instead of an unhandled rejection
that leaves the Expo error overlay intercepting later gestures.

Treat every terminal branch explicitly: success, queued, application refusal,
auth terminal status, and genuine transport/lifecycle failure. An uncaught
authorization-suspended rejection can poison a route even though the system is
behaving correctly.

The run that exposed the poisoned overlay also used six live subscriptions.
Consolidating them removed its repeated trigger, but that behavior remains a
separate open contention investigation:
[the retained ticket](repo:issues/20260820-familiar-live-subscription-contention.md).
This recipe settles the foreground promise safely; it does not classify the
subscription behavior or make one aggregate query a universal requirement.

## What proves this contract

The [packed-external settlement fixture](repo:scripts/auth-settlement-packed-proof.mjs)
is executed by the Guide check against freshly packed Contract, client, and
React packages and proves the
signed-out, signing-in, signed-in, signing-out, and revoked rows for both
one-shot and live-query projections. Its retained tarball-integrity receipt is
in the [signed-out settlement closure](repo:issues/closed/20260820-authenticated-query-signed-out-settlement.md).

```js source=scripts/auth-settlement-packed-proof.mjs
const result = Object.freeze({
  oneShot: await proveOneShots(),
  live: await proveLive(),
});
process.stdout.write(`${JSON.stringify(result)}\n`);
```

That packed closure stops at the advertised settlement spelling: it does not
exercise mutation queueing or a component event handler. Those promises are
separately CI-enforced by the client package suite. In
[`generated-optimistic-default.test.mjs`](repo:packages/snapback-client/generated-optimistic-default.test.mjs),
“generated read-free insert cannot repaint after authorization quarantine”
proves the default generated mutation resolves `queued` with
`authorizationDisposition: "authorization-suspended"`. In
[`authorization-invalidation.test.mjs`](repo:packages/snapback-client/authorization-invalidation.test.mjs),
“client-owned outbox suspension” independently proves explicit queueing does
not cross transport, while “offlineQueue:false persists live roots” proves
`queue: false` rejects with `SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED` before
transport. In
[`outbox-store.test.mjs`](repo:packages/snapback-client/outbox-store.test.mjs),
“default foreground mutation without an explicit id” independently pins the
same no-transport foreground rejection. None of these receipts claims the
unimplemented D0.2 housekeeping-lane surface.

## Anti-patterns

- Dispatching from an effect whose dependency is a mutation function or
  changing auth object; effect identity changes can turn one intent into
  repeated writes.
- Fire-and-forget foreground dispatch with no rejection handler; the first
  auth refusal can poison the development UI.
- Converting authorization suspension into a content refusal or “server
  failed” message.
- Assuming a foreground rejection means the mutation may already have
  committed.
- Re-recording predecessor work under a successor principal without the
  explicit stranded-intent workflow.
- Hiding queued status and declaring success before settlement.

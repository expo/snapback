---
title: "Recipe: writes during authentication transitions"
id: recipes.auth-transition-writes
order: 12
audience: agent-first
capabilities: [clients.outbox-drain, clients.mutation-outcomes, auth.invalidation-barrier]
authorities: [llp/0043-offline-replay-retention.rfc.md, llp/0059-session-projection-and-client-barrier.spec.md, llp/0218-outbox-settlement-contract.rfc.md, packages/snapback-client/index.mjs, packages/snapback-client/outbox-shared.mjs, packages/snapback-client/rqs-store-sqlite.mjs, packages/snapback-react/implementation.mjs, packages/snapback-client/authority-transition-conformance.test.mjs, packages/snapback-client/authorization-invalidation.test.mjs, packages/snapback-client/generated-optimistic-default.test.mjs, packages/snapback-client/outbox-drain.test.mjs, packages/snapback-client/outbox-store.test.mjs, scripts/auth-settlement-packed-proof.mjs, scripts/check-guide-auth-settlement-packed-proof.mjs]
examples: [packages/snapback-client/authority-transition-conformance.test.mjs, packages/snapback-client/authorization-invalidation.test.mjs, packages/snapback-client/generated-optimistic-default.test.mjs, packages/snapback-client/outbox-drain.test.mjs, packages/snapback-client/outbox-store.test.mjs, scripts/auth-settlement-packed-proof.mjs, demos/browser-local-first]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-21
reviewed-authorities-digest: sha256:147f274f197b8fb2e15b67c559278c0858f9505d608634b3e7acaf8d24da0fdf
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
the truthful `settled | queued` union. Call the hook with no `queue` option —
the React hook admits only omitted `queue` or `queue: false`
(`useSnapbackSettledMutation` is the settled-only spelling); passing
`queue: "auto"` or `queue: true` to the hook throws a `TypeError`. Those
option spellings belong to the headless `client.mutate()` surface only. On the local target with a qualified
outbox and settlement ledger, accepted intent held behind the authorization
barrier resolves `queued`; the headless outcome additionally reports
`authorizationDisposition: "authorization-suspended"`. The outbox drain
resumes only after authority proof. Render that branch as pending and observe
the mutation settlement rather than declaring success.

`queue: "auto"` is capability-sensitive: without a qualified outbox it
degrades to `queue: false` and rejects instead of pretending the intent is
durable. Explicit `queue: true` requires outbox support.

## Declare only genuine housekeeping

The headless client has a separate shipped lane for background work that is
idempotent, latest-wins for one stable key, and valid under the successor
principal:

```js fragment reason="illustrative application declaration; function references and route keys are app-specific"
const outcome = await client.mutate(refreshRouteReceipt, {
  args: { route: "/inbox" },
  housekeeping: {
    key: "route-inbox",
    idempotent: true,
    successorValid: true,
  },
});
```

During an active auth barrier, that exact declaration may resolve `queued`
with `blockedReason: "auth-barrier"`; it performs zero transport until the
successor settles. A later pending record with the same key supersedes the
older one, whose `mutationStatus(clientMutationId)` becomes `failed` with
`SNAPBACK_HOUSEKEEPING_SUPERSEDED`. Do not mark a user gesture as
housekeeping: ordinary foreground query/mutation admission promptly refuses
with `SNAPBACK_CLIENT_AUTHORITY_CLEARING` during the barrier.

In compact terms: declare `{ key, idempotent: true, successorValid: true }`
only for latest-wins housekeeping. `blockedReason: auth-barrier` means zero
transport. Observe `SNAPBACK_HOUSEKEEPING_SUPERSEDED` through mutation status.

Foreground and housekeeping transports are independent lanes. A suspended or
slow housekeeping request does not head-of-line block a replayable foreground
record; authority/root cuts remain exclusive across both. Cross-lane ordering
is not promised: foreground admission is independent of suspended housekeeping.

Predecessor work is reconciled before successor observation. Anonymous →
authenticated, dev → sessions, and same-user/new-session intent strands for
explicit discard or re-record. A → B, authenticated → anonymous, sessions →
dev, and authorization-stream incarnation changes privacy-delete predecessor
intent. No stranded record is automatically sent under the successor.

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
  modePendingReload: await proveModePendingReload(),
  housekeeping: await proveHousekeepingBarrier(),
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
same no-transport foreground rejection and the item-5 strand/delete rows.
[`authority-transition-conformance.test.mjs`](repo:packages/snapback-client/authority-transition-conformance.test.mjs)
proves declared housekeeping queues under `auth-barrier` with zero transport,
and [`outbox-drain.test.mjs`](repo:packages/snapback-client/outbox-drain.test.mjs)
holds a real housekeeping fetch while a later replayable foreground record
enters and settles transport. SQLite's focused store suite pins the same lane
gate and authorization-generation CAS on the Expo carrier.

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

---
title: Framework bindings
id: clients.framework-bindings
order: 8
audience: agent-first
capabilities: [clients.framework-bindings]
authorities: [llp/0012-headless-integration-contract.spec.md, llp/0034-contract-source-seam-provider-side.rfc.md, llp/0053-authorization-invalidation.rfc.md, llp/0064-native-client-surfaces.rfc.md, packages/snapback-client/external-store.mjs, packages/snapback-client/index.mjs, packages/snapback-react/index.mjs]
examples: [demos/partiful-matrix/surfaces/vanilla]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:ef95f794e1201fad76046e3f04ccc1fd42a1a5326f23d9cc8c32b9639755ed6d
---

# Framework bindings

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

A query hook is the small part. The [React](./react.md) and
[Contract](./contract-adapter.md) bindings ship today; no
first-party Vue, Svelte, or Solid package is claimed. Those systems can
adapt “current rows plus subscribe” in well under 100 lines. A valuable
Snapback binding centralizes the lifecycle and failure behavior that otherwise
fails silently.

This page also owns the map of the **framework-neutral seam layer** — the
twins that let a non-React shell reach every React capability. On the
provider: `observeSnapbackQueries`, `observeSnapbackPresence`,
`observeSnapbackOutbox` ([React page](./react.md)) and
`observeSnapbackSurface`/`provider.surface(...)`
([surfaces](./surfaces.md#observe-the-same-surface-without-react)); actions:
`invokeSnapbackMutation` and `invokeSnapbackCommand`
([React page](./react.md#run-a-mutation)). Below the provider entirely:
`createCommandClient` over a bare client and the Micro entry-point family
([headless client](./headless.md)).

## Build on the external store

Use `snapback.external-store.v1` from `@expo/snapback-client/external-store`.
It owns canonical query identity, same-key sibling sharing, late-handle
resolution, stale-generation fencing, error/connection snapshots, optimistic
settlement, refcounts, and final disposal
([the headless client's external-store contract](./headless.md#project-live-state-into-a-framework-neutral-external-store)).
Project that store into the framework's native subscription primitive.

Do not add a second query cache, socket owner, or mutation settlement model.

## Own the hard transitions

A binding must cover:

| Transition | Required behavior |
| --- | --- |
| identity changes | retire predecessor scope, synchronously blank protected rows, subscribe under successor authority |
| socket loss | surface stale/connecting state, obtain a fresh grant when needed, fresh subscribe with supersession |
| background | call the provider handle's `pause()`; release demand and quiesce retries |
| foreground | call `resume()`; reconcile authority, reconnect, and fresh-subscribe |
| invalidation | publish the atomic replacement only after version guard; ACK after apply |
| transient reservation conflict | retry only the exact typed refusal within the client budget |
| terminal auth | expose an error state and blank predecessor materialization before callbacks resume |
| scope disposal | release every handle even if an observer throws |

High-level handle disposal is idempotent after its own logout or terminal
authority retirement. Keep that exact-handle behavior in the binding; do not
catch arbitrary low-level `unsubscribeLive` errors, because foreign ids and
ownership/session mismatches remain fail-closed. View unmount may ignore the
returned cleanup task after synchronous local teardown; lifecycle tests and
operational cleanup should await it so genuine typed failures stay visible.

The headless JS handle already supplies `pause()`, `resume()`, `dispose()`,
connection events, and error state. Native clients expose equivalent
provider-level lifecycle hooks. Bind host lifecycle once at the provider
boundary, not in every component.

## Keep errors as state

A rejected setup promise is not enough: after initial render, reconnect,
authorization, and server diagnostics are ongoing state. The framework
projection should expose rows, connection phase, and the latest structured
error together. Preserve the diagnostic code; do not reduce it to a boolean.

## Test the binding, not its syntax

The acceptance suite should prove identity rotation, background/foreground,
socket-loss re-grant, version regression refusal, typed retry, observer-throw
cleanup, and final unmount disposal. A hook unit test that only receives one
row update does not establish a useful binding.

## Anti-patterns

- Do not publish a framework package whose only value is a query hook.
- Do not let view mount/unmount own server demand directly.
- Do not preserve predecessor rows across an authority change.
- Do not swallow structured diagnostics into console logging.
- Do not reconnect a socket without re-establishing its subscriptions.

---
title: "Recipe: activity presence, heartbeats, and withdrawal"
id: recipes.activity-presence
order: 13
audience: agent-first
capabilities: [realtime.ephemeral]
authorities: [llp/0013-ephemeral-realtime-state.rfc.md, llp/0257-activity-scoped-presence-convenience.rfc.md, packages/snapback-react/index.mjs, packages/snapback-react/implementation.mjs]
examples: [demos/messaging-snapback, packages/snapback-cli/templates/expo-chat]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-21
reviewed-authorities-digest: sha256:f645f4b9705e5a52f2adb649c71a1e2c03d5a3bc13a19c40d81957c5a4b4f054
---

# Recipe: activity presence, heartbeats, and withdrawal

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Snapback presence is an ephemeral lease. A bound value is not a durable row,
and publishing it once does not promise that it remains present. Conversely,
a convenience surface can continuously republish a non-null bound value. This
is why `useSurface({ typing: value })` may look like simple state binding while
behaving like a continuous publish.

Put in the diary's exact terms: “surface presence value is a continuous
publish.” The heartbeat vs bound value decision determines whether the owner
should continuously publish or explicitly publish + delete.

Search phrase: surface presence value is a continuous publish.

Choose the lifetime you actually mean:

- **Continuous bound value:** keep publishing while the component and scope
  are active. Use for “online in this room” when mounting is the activity.
- **Activity-driven value:** use `useSnapbackActivityPresence` when input,
  focus, pointer, or another activity signal should touch the lease. It owns
  the activity deadline and withdrawal after the idle window; the provider
  owns lease heartbeat/renewal.
- **Explicit event:** call the presence publisher on activity and the delete
  path on blur, send, cancel, scope change, or unmount. Use this in a
  headless/adapter owner that already owns those transitions.

For a typing indicator, call `touch()` on meaningful input and withdraw on
send, clear, blur, room change, and dispose. The provider renews the published
lease while the activity owner remains active; do not add a second timer. TTL
is the crash/disconnect backstop; explicit or idle withdrawal is the ordinary
stop signal. The mental translation from Supabase
`track({ typing: true })` is therefore “publish plus heartbeat plus delete,”
not “assign a bound value forever.”

The generated room scope and membership admission remain authoritative.
Heartbeat extends only an already admitted ephemeral entry; it does not grant
membership or make presence durable history.

## Anti-patterns

- Passing a truthy presence value continuously when the product means “for a
  few seconds after activity.”
- Publishing once and relying on a long TTL as the normal stop mechanism.
- Adding an independent app timer when the activity-presence owner already
  owns heartbeat and withdrawal.
- Treating an expired or deleted entry as a durable offline-status record.
- Reusing presence as membership, authorization, or message history.

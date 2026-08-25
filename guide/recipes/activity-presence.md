---
title: "Recipe: activity presence, heartbeats, and withdrawal"
id: recipes.activity-presence
order: 13
audience: agent-first
capabilities: [realtime.ephemeral]
authorities: [llp/0013-ephemeral-realtime-state.rfc.md, llp/0257-activity-scoped-presence-convenience.rfc.md, packages/snapback-react/index.mjs, packages/snapback-react/implementation.mjs, packages/snapback-expo/activity-presence.mjs, scripts/activity-presence-vertical-contract.mjs]
examples: [demos/messaging-snapback, packages/snapback-cli/templates/expo-chat, tests/fixtures/activity-presence-vertical]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-25
reviewed-authorities-digest: sha256:87b3b3dfd641544285f417a31e6f94cf34186881c33aac835598402798dc27da
---

# Recipe: activity presence, heartbeats, and withdrawal

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Snapback presence is an ephemeral lease. The key rule is: **a surface presence
value is a continuous publish**. A value other than `skip` bound through
`useSurface(surface, params, { presence: { typing: value } })` remains desired
while that binding is mounted, so the provider heartbeat keeps renewing it. A
five-second TTL or acceptance ceiling does not make that value disappear after
five seconds of no typing. Bound withdrawal is `skip`; `null` is a value publish
attempt and fails the generated value contract.

Choose the import from the provider that owns the tree. URL-first web imports
`useSnapbackActivityPresence` from `@expo/snapback-react` alongside
`SnapbackProvider`. The `@expo/snapback-expo` facade hook is for
`SnapbackExpoProvider` only; it requires the Expo lifecycle context and adds
AppState withdrawal. There is no third activity-presence hook.

This is the usual cause of a “typing indicator stuck” or “presence not
expiring” report. The heartbeat-vs-bound-value decision comes before choosing
a TTL:

Search vocabulary: typing indicator stuck; presence not expiring; track() equivalent; supabase track; presence heartbeat; surface presence value is a continuous publish.

- **Continuous bound value:** keep publishing while the component and scope
  are active. Use for “online in this room” when mounting is the activity.
- **Activity-driven value:** use `useSnapbackActivityPresence` when input,
  focus, pointer, or another activity signal should touch the lease. It owns
  the absolute idle deadline and calls the delete path after that window; the
  provider owns presence heartbeat/renewal.
- **Explicit event:** call the presence publisher on activity and the delete
  path on blur, send, cancel, scope change, or unmount. Use this in a
  headless/adapter owner that already owns those transitions.

For a typing indicator, the supported spelling is touch-on-keystroke and
delete-on-idle. `withdraw()` is the helper's explicit delete action for send,
clear, blur, room change, and dispose:

```ts source=tests/fixtures/activity-presence-vertical/client-projection.ts
export function TypingComposer() {
  const presence = useSnapbackActivityPresence(typing, {
    scope: { roomId: 'room-one' },
    value: () => ({ userHandle: 'ada', name: 'Ada' }),
    idleMs: 3_000,
  });

  const onKeystroke = () => presence.touch();
  const onClearOrSend = () => void presence.withdraw();
  void onKeystroke;
  void onClearOrSend;
  return null;
}
```

The provider renews the admitted lease while the activity owner remains
active; do not add a second app timer or heartbeat loop. TTL is the
crash/disconnect backstop. Explicit or idle delete is the ordinary stop
signal. Choose `idleMs` below the product expiry deadline, leaving room for the
delete to become visible: for a five-second ceiling, the shown three-second
idle window leaves that convergence budget. TTL will not enforce the deadline
while the activity owner is active.

<!-- since: 0.1.27 -->

## Keep presence values stable

Volatile values defeat the no-op dedup. `touch()` evaluates `value` on every
activity tick; a timestamp, counter, draft body, or other changing field turns
every keystroke into a real publish. At typing speed this can reach the presence
rate limit and suspend the publisher with `publish-error`.

Search vocabulary: presence rate limit; typing indicator too many publishes;
volatile presence value; `SNAPBACK_REACT_PRESENCE_VALUE_CHURN`.

Before — the timestamp changes the canonical value on every touch:

```tsx source=tests/fixtures/activity-presence-vertical/client-projection.ts
export function VolatileTypingValue({ displayName }: { displayName: string }) {
  const presence = useSnapbackActivityPresence(typing, {
    scope: { roomId: 'room-one' },
    value: () => ({ userHandle: 'ada', name: `${displayName}-${Date.now()}` }),
    idleMs: 3_000,
  });
  const onKeystroke = () => presence.touch();
  void onKeystroke;
  return null;
}
```

After — bind and memoize only the small state peers actually need:

```tsx source=tests/fixtures/activity-presence-vertical/client-projection.ts
export function StableTypingValue({ displayName }: { displayName: string }) {
  const boundValue = useMemo(
    () => ({ userHandle: 'ada', name: displayName }),
    [displayName],
  );
  const presence = useSnapbackActivityPresence(typing, {
    scope: { roomId: 'room-one' },
    value: () => boundValue,
    idleMs: 3_000,
  });
  const onKeystroke = () => presence.touch();
  void onKeystroke;
  return null;
}
```

In a positively identified development build, N consecutive actual
changed-value publishes for one presence key inside the short diagnostic
window emit `SNAPBACK_REACT_PRESENCE_VALUE_CHURN`. The warning names the key
and this repair without recording the presence value. Repeated unchanged
touches, provider heartbeats, and superseded intents do not count.

## Coming from Supabase `track()`

Supabase `track()` is the lifecycle analogue of bound `useSurface` presence or
a non-`skip` `useSnapbackPresence` value: Supabase keeps the state until
`untrack()`, channel leave, or disconnect; Snapback keeps the value desired
while its binding is mounted and uses the provider heartbeat to sustain its
TTL lease. Neither expires merely because the user went idle.

Idle typing therefore needs extra stop choreography on both systems:
`track()`/`untrack()` in Supabase, or **touch + provider heartbeat + delete**
in Snapback:

- `touch()` on each meaningful activity tick;
- let the provider renew the unchanged admitted value;
- let `useSnapbackActivityPresence` delete at `idleMs`, and call
  `withdraw()` for earlier product transitions.

The hook admits `idleMs` only as a finite safe integer from 250 through
2,147,483,647 milliseconds. Invalid configuration refuses during render with
`SNAPBACK_REACT_ACTIVITY_IDLE_MS_INVALID`; fix the deadline instead of
clamping or adding another timer. That legal range is not a product-timing
guarantee: `idleMs` plus delete visibility still must fit the expiry ceiling
the application promises.

The generated room scope and membership admission remain authoritative.
Heartbeat extends only an already admitted ephemeral entry; it does not grant
membership or make presence durable history.

## Anti-patterns

- Passing a truthy presence value continuously when the product means “for a
  few seconds after activity.”
- Publishing once and relying on a long TTL as the normal stop mechanism.
- Adding an independent app timer when the activity-presence owner already
  owns heartbeat and withdrawal.
- Putting timestamps, counters, or draft text in an activity-presence value
  when a stable typing/active marker is enough.
- Treating an expired or deleted entry as a durable offline-status record.
- Reusing presence as membership, authorization, or message history.

The packed external vertical receipt is
`node scripts/activity-presence-vertical-contract.mjs`. It proves the `typing`
Guide route, generated reference and public imports, runtime publish/delete,
React idle and explicit withdrawal, Expo background withdrawal, and the
invalid-`idleMs` diagnostic from one installed package closure. It also proves
that a bound surface value persists past TTL under renewal and that switching
that binding to `skip` withdraws it before TTL.

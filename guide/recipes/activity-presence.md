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
reviewed: 2026-08-21
reviewed-authorities-digest: sha256:bc63638fe4b4139746c3c8da33d2670e25eebb35d8985d34b5f226fde2343200
---

# Recipe: activity presence, heartbeats, and withdrawal

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Snapback presence is an ephemeral lease. The key rule is: **a surface presence
value is a continuous publish**. A non-null value bound through
`useSurface({ typing: value })` remains desired while that binding is mounted,
so the provider heartbeat keeps renewing it. A five-second TTL or acceptance
ceiling does not make that value disappear after five seconds of no typing.

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
signal.

## Coming from Supabase `track()`

There is no one-shot `track()` equivalent for idle activity. Translating
Supabase `track({ typing: true })` as a long-lived bound value imports the
wrong prior. Translate it as **touch + provider heartbeat + delete**:

- `touch()` on each meaningful activity tick;
- let the provider renew the unchanged admitted value;
- let `useSnapbackActivityPresence` delete at `idleMs`, and call
  `withdraw()` for earlier product transitions.

The hook admits `idleMs` only as a finite safe integer from 250 through
2,147,483,647 milliseconds. Invalid configuration refuses during render with
`SNAPBACK_REACT_ACTIVITY_IDLE_MS_INVALID`; fix the deadline instead of
clamping or adding another timer.

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

The packed external vertical receipt is
`node scripts/activity-presence-vertical-contract.mjs`. It proves the `typing`
Guide route, generated reference and public imports, runtime publish/delete,
React idle and explicit withdrawal, Expo background withdrawal, and the
invalid-`idleMs` diagnostic from one installed package closure.

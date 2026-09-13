# Snapback 4: `mutate` can return `pending` and drop the terminal Write

Status: Open
Priority: P1
Date: 2026-09-13
Systems: local/native/online clients, `useMutation`, reference composers
Author: Grok 4.6 (comprehensive review of origin/main `f9bf18f0e`)
Related: [LLP 3000.001](../llp/3000.001-durable-replica-and-write-lifecycle.research.md) (durable discovery of a write’s terminal outcome)

## Problem and reproduction

Local and native `mutate` race the outbox settlement against a 4 s timer and return `{ state: "pending", id }`. The resolver stays in `settled` until flush; after `mutate` returns, nobody is listening. `useMutation` stores that `pending` as `last` and clears `inFlight`. Flush later calling `settled.get(id)?.(sent|failed)` is a no-op for the hook.

The web composer then keeps “Queued on this device” even after the row is confirmed (`pending` flag gone) or after a durable refusal.

Online `createClient` has the same shape: `Promise.race(settled, flush.then(() => pending))`. A 503 that schedules `retryFlush` completes `flush` without resolving `settled`, so the caller also gets `pending` and never hears `sent` / `failed`.

The card’s only write API therefore cannot report the eventual refusal after the submitting call has returned `pending`.

## Implementation locations

- [snapback4/packages/snapback4/src/local.ts](../snapback4/packages/snapback4/src/local.ts) (~541)
- [snapback4/packages/snapback4/src/native.ts](../snapback4/packages/snapback4/src/native.ts) (~528)
- [snapback4/packages/snapback4/src/client.ts](../snapback4/packages/snapback4/src/client.ts) (~318)
- [snapback4/packages/snapback4/src/react.tsx](../snapback4/packages/snapback4/src/react.tsx) (`useMutation`)
- [snapback4/apps/chat/src/Composer.tsx](../snapback4/apps/chat/src/Composer.tsx)

## Suggestion

Keep `mutate`’s promise open until a terminal `Write`, or have `useMutation` subscribe to settlement by id instead of the first return value. The composer should treat row `pending` / `link`, not `last === pending`, as “queued”.

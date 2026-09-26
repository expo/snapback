# Snapback 4: a second same-id mutate inherits the first caller's wait

- **Opened:** 2026-09-26, from the LLP 3000.008.002.000 code review (Astra F3; four real-backend probes).
- **Area:** `packages/snapback4/src/writes.ts` `MutationIds.run` (`if (held.running) return held.running`),
  with `local.ts`, `client.ts` and `app-online.ts` mutate.
- **Severity:** Low (latency in an edge case; outcomes stay correct).

## What happens

A same-id call that overlaps the first submission returns the first caller's whole running promise, so a
second caller passing `waitSeconds: 0` waits for the first caller's settlement deadline (up to 4 s on a
device, until the response online) even though custody was already established. Probed on the native
and wasm devices, the raw online client and `createApp` online.

## Fix sketch

Share admission and execution ownership, but apply the wait per invocation: each submission exposes
its custody moment (the tiers resolve admission separately from settlement), and a zero-wait caller
awaits only that.

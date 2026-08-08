# Cloudflare coordinator fail-closed serving gate is only on `fetch`; `alarm()` and `webSocketMessage()` bypass it

**Opened:** 2026-08-08 · **Severity:** P1 (correctness/data-integrity; a stale deployment can write and read against a store the HTTP plane refuses) · **Area:** cloudflare

## What

`cloudflare/src/coordinator.js`

`route()` refuses the data plane when the store is in a refused state
(`const startupRefusal = this.startupError || this.socketLimitError;` at ~1558 —
stale bundle/schema hash, `SNAPBACK_STALE_CLOUDFLARE_*`, unvalidated
subscription bounds, etc.). But the Durable Object has three entry points and
only `fetch` consults the full gate:

- `alarm()` (~3323): **no** startup/refusal check at all. It iterates armed cron
  jobs and calls `runCronJob → executeAction → runMutationForAction → commit()`
  — the exact write path the HTTP plane fails closed against.
- `webSocketMessage(ws, message)` (~5238): checks only `this.socketLimitError`,
  never `this.startupError`. Hibernated sockets survive a deploy, so a
  `subscribe`/mutation frame reads/registers against the refused store.

## Failure scenario

Deploy a new Worker whose schema/bundle hash mismatches the stored DO state
(the `staleArtifact` conditions). Hibernated WebSockets and an armed cron alarm
survive the deployment. The alarm wakes and commits rows under the *new* code
into the *old*, refused store; socket frames similarly read/register against
refused state — while `fetch` is correctly returning the refusal. This is
precisely the hibernation-survives-deploy scenario the constructor comments call
out, so it is reachable, not theoretical (needs retained demand / an armed job).

## Fix

Introduce one `servablePrecondition()` (or reuse the `startupRefusal`
computation) and consult it at the top of all three entry points:
- `alarm()`: if refused, skip the run but keep the alarm armed (re-arm / return
  early) rather than committing.
- `webSocketMessage`: if `this.startupError` is set, close with 1013 exactly as
  the `socketLimitError` branch already does.

## Confidence

High that the gap exists (verified all three entry points and the gate at
~1558); medium on real-world blast radius (requires a stale deployment with
retained demand). No comment marks the omission deliberate.

## Related

Same class as the broader "one gate, three doors" observation — worth a wire-
level test that drives `alarm()`/`webSocketMessage` against a forced
`startupError` and asserts no commit / a 1013 close.

## Resolution (2026-08-08)
Fixed on main (Lane H). Verified (Node 24.18.0): acceptance 53/53, cron 13/13, rqs 42/42, wire-schema-gate 20/20, index-scaling pass; deployment-identity regenerated + check pass; ref-check clean.

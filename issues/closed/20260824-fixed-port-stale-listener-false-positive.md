# SNAPBACK_DEV_FIXED_PORT_STALE_LISTENER fires falsely on a stale descriptor with no OS listener

**Status:** Closed
**Opened:** 2026-08-24
**Resolved:** 2026-08-24
**Systems:** CLI, Local server lifecycle, Diagnostics
**Related:** LLP 0301, LLP 0306 (chip-away B11),
`issues/closed/20260821-fixed-origin-external-client-dev-lifecycle.md`,
`issues/20260823-expo-supervisor-restart-verb-port-drift.md`

## Problem

`snapback dev` with a pinned port refuses with
`SNAPBACK_DEV_FIXED_PORT_STALE_LISTENER` ("does not identify a live
receipt-verifiable Snapback listener … the listener was not adopted or
terminated") when a stale `.snapback/ready.json` descriptor is present even
though **no OS listener exists on the port**. The published-0.1.25 Clique
pair hit this after an earlier server died without cleaning its ready file;
the diagnostic told the agent a listener existed when none did.

Verified still true on main at `9a782983d` (2026-08-24). Three emit sites in
`packages/snapback-cli/index.mjs`:

1. `index.mjs:5567-5581` (`verifyDevAttach`): any failure of
   `validateReadyDescriptorHealth(descriptor)` — which is an HTTP health call
   against `descriptor.serverUrl` (`index.mjs:3978-4010`) — is rewritten to
   the stale-listener code when `fixedPort !== null`. **No
   `loopbackPortAcceptsConnections` probe guards this branch**, so a dead
   process's leftover descriptor produces the false positive. The branch is
   only reached under `existsSync(readyFile)` (`index.mjs:5964`), confirming
   the trigger is a stale descriptor, not a live socket.
2. `index.mjs:5586-5600`: same rewrite for a failed
   `readApplicationReadyReceipt`.
3. `index.mjs:5978-5990`: the honest occupied-port site, correctly guarded by
   `await loopbackPortAcceptsConnections(fixedPort)`.

The guide documents the code as meaning an *occupied* port
(`guide/recipes/fixed-origin-development.md:68`,
`guide/clients/react-expo.md:427`), which is exactly what makes the false
positive expensive: the agent trusts the documented meaning and goes hunting
for a process that does not exist.

## Direction

At sites 1 and 2, probe the port before choosing the diagnostic:

- port accepts connections → keep `SNAPBACK_DEV_FIXED_PORT_STALE_LISTENER`
  (something is listening but it is not a receipt-verifiable Snapback
  server);
- port refuses connections → emit a distinct stale-descriptor diagnostic
  (or reuse an existing one) whose remediation is "remove/ignore the stale
  ready descriptor and start fresh" — which the lifecycle could safely do
  itself in `auto` mode, since there is provably nothing to adopt or
  terminate.

## Acceptance

- A stale `ready.json` with no listener on the pinned port yields a
  diagnostic that names the stale descriptor (not a live listener) and a
  remediation that succeeds without the agent inventing cleanup — or the
  `auto` lifecycle recovers by itself.
- A genuinely occupied pinned port still yields
  `SNAPBACK_DEV_FIXED_PORT_STALE_LISTENER`.
- A regression test covers the dead-process/stale-descriptor branch for both
  `dev` and the Vite lifecycle re-emit
  (`packages/snapback-vite/lifecycle.mjs:505-512`).
- Guide text for the code matches the narrowed meaning.

## Resolution

`verifyDevAttach` now probes the pinned loopback port before rewriting either
descriptor-health or application-ready-receipt failures. An accepting port
retains `SNAPBACK_DEV_FIXED_PORT_STALE_LISTENER`; a refusing port produces
`SNAPBACK_DEV_FIXED_PORT_STALE_DESCRIPTOR` with the ready-file path and an
exact remove-and-start-fresh remediation. Only `ECONNREFUSED` selects that
diagnosis, and its text says the refusal was observed at probe time. A timeout
or any other socket error preserves the descriptor and reports the existing
`SNAPBACK_DEV_SERVER_ATTACH_FAILED` code with the probe error. CLI and Vite
regressions cover refused, accepting, timeout, and other-error branches, and the
two guide passages document the distinction.

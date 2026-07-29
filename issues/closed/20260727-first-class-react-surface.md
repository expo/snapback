# First-class React provider, mutation, presence, and connection surface

**Status:** Resolved
**Impact:** 5  
**Urgency:** 4  
**Ease:** 2  
**Confidence:** 5  
**Severity:** P1  
**Systems:** React, Client integration, Live Queries, Ephemeral state, Auth, Testing  
**Author:** Codex, directed by Charlie Cheever  
**Date:** 2026-07-27  
**Related:** LLP 0012, LLP 0053, LLP 0064, LLP 0074; `packages/snapback-client`, `packages/snapback-react`

## Resolution

The prepared provider, generated-ref query/group/mutation hooks, aggregate
connection projection, local managed presence, result-validated optimistic
rebase/rollback, shared room/query ownership, and exact disposal inspection
are implemented under LLP 0114/0106. Signal Desk uses the first-class surface.
The package suites, web/Expo packed witnesses, guide, starter, and retained
ten-check React receipt pass.

`packages/snapback-react/lifecycle.test.mjs` now retains the remaining
React-level witnesses. It drives presence through disconnect, reconnect, and
resync; exercises the provider auth barrier's synchronous blank and fresh
resume; overlaps predecessor and successor providers as an HMR-like
replacement; and proves exact zero stores, subscriptions, listeners,
republishers, and authority barriers after disposal. These checks use the same
headless transport, grant, room, and external-store owners as the public React
surface, rather than a React-only lifecycle.

`useSnapbackQuery` and the external store already own Strict Mode replay,
same-key sharing, connection state, optimistic settlement, rollback, and
cleanup. The context provider, dedicated mutation and presence hooks, and
app-level connection projection now complete the public surface, while the
explicit-provider override remains available for libraries and tests.

## Desired resolution

- Add `SnapbackProvider` with an explicit-provider override for libraries and
  tests. It owns one client/provider, authority transitions, lifecycle, and
  final cleanup.
- Add generated-ref-only `useSnapbackQuery`, `useSnapbackMutation`,
  `useSnapbackPresence`, and a connection-state hook with a documented
  aggregation rule.
- Presence wraps the existing ephemeral client/grant/overlay lifecycle,
  including publish/delete, TTL, reconnect/resync, disconnect cleanup, and
  authorization changes; it does not create a second transport.
- Preserve the framework-neutral external store as the one current-value plus
  subscription seam, and preserve honest Online/Parity capability language.
- Thread generated argument/result inference through every hook after the
  result-contract ticket lands.

## Acceptance

- Missing provider, wrong generated ref kind, incompatible protocol, and
  unsupported presence capability fail with stable diagnostics before work.
- Strict Mode, HMR-like replacement, same/different-key sharing, late handles,
  unmount, authority replacement, optimistic rejection rollback, and mixed
  connection transitions have deterministic tests.
- Presence tests cover subscribe, publish, delete, TTL, socket disconnect,
  reconnect, auth revocation, and durable-version separation.
- React web and Expo package witnesses use the same implementation and contain
  no app-local subscription cleanup flags or parallel cache.
- The React guide, headless/framework-binding pages, capability index, package
  README, and installable starter all use the public surface.

# First-class React provider, mutation, presence, and connection surface

**Status:** Open  
**Impact:** 5  
**Urgency:** 4  
**Ease:** 2  
**Confidence:** 5  
**Severity:** P1  
**Systems:** React, Client integration, Live Queries, Ephemeral state, Auth, Testing  
**Author:** Codex, directed by Charlie Cheever  
**Date:** 2026-07-27  
**Related:** LLP 0012, LLP 0053, LLP 0064, LLP 0074; `packages/snapback-client`, `packages/snapback-react`

`useSnapbackQuery` and the external store already own Strict Mode replay,
same-key sharing, connection state, optimistic settlement, rollback, and
cleanup. The package still lacks a context provider, dedicated mutation and
presence hooks, and an app-level connection projection. Every query must
receive a provider explicitly, and ordinary React apps still wire ephemeral
grant/subscription lifecycles themselves.

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

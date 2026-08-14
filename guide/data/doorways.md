---
title: Choose the tiny data doorway
id: data.doorways
order: 40
audience: agent-first
capabilities: [data.doorways-v1]
authorities: [llp/0255-tiny-data-surface-v1-api.spec.md, llp/0012-headless-integration-contract.spec.md, llp/0064-native-client-surfaces.rfc.md, packages/snapback-client/data-client.mjs, packages/snapback-react/data.mjs, packages/snapback-umbrella/package.json, packages/snapback-expo/package.json]
examples: [tests/fixtures/data-surface-a1, tests/acceptance/data-surface-a1-v1.mjs, packages/snapback-react/data.test.mjs]
status: current
targets: [local]
maturity: partial
since: 0.1.21
reviewed: 2026-08-14
reviewed-authorities-digest: sha256:7a5261926cfacd1fa74bb9395e98f758d3134fb706fced1e342789fd25566c25
---

# Choose the tiny data doorway

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Generate first. The generated `data.mjs` carries descriptors, transaction
chunks, catalogues, and the binding identity. The doorway supplies no second
transport, cache, auth coordinator, outbox, policy evaluator, settlement
registry, or diagnostic type; it delegates those jobs to the existing client.

## Use the headless doorway

Import from the umbrella package's exact experimental subpath and bind the
generated data projection to an existing Snapback client:

```js source=tests/fixtures/data-surface-a1/snapback/app.mjs
import { createDataClient } from '@expo/snapback/data';
import { db as reactDb } from '@expo/snapback/react/data';
import { db as expoDb } from '@expo/snapback-expo/data';
import { data } from './generated/data.mjs';

// @ref LLP 0255#s9-package-doorway-and-generated-typing
export const createA1Database = (client) => createDataClient({ client, data });
export const reactAndExpoShareDoorway = reactDb === expoDb;
```

The direct client package also exposes
`@expo/snapback-client/data`. `createDataClient({ client, data })` is the
imperative doorway for `read`, `watch`, `explain`, `tx`, `transact`, and
`transaction(intentId)`.

## Use the provider-bound React or Expo doorway

Import only `db` from `@expo/snapback/react/data`. Expo reexports the identical
runtime value from `@expo/snapback-expo/data`; the umbrella package also offers
`@expo/snapback/react/data`. Generated `data.d.ts` augments the React binding,
so resource names, descriptors, transaction chunks, and results retain exact
application types.

`db` must be used below the ordinary `SnapbackProvider` carrying the generated
app binding. Missing or stale data binding refuses
`SNAPBACK_DATA_BINDING_REQUIRED` and tells you to run normal generation and
install that binding. There is deliberately no exported `useQuery`; the hook
spelling is `db.useQuery(descriptor)` so one generated root owns the surface.
Because `db` is provider-bound, obtain its methods during a React render.
Invoke `read`, `watch`, and transaction methods from that captured binding in
an effect or event handler; use the headless doorway in modules and workers.

## Keep Experimental separate from default

These subpaths are additive, Experimental, and non-default. Do not reexport
them from existing package roots, label them recommended, or add compatibility
promises. LLP 0256's evaluation scaffold lives at
[`benchmarks/tiny-data-surface/v1`](repo:benchmarks/tiny-data-surface/v1/README.md);
it is not an application starter and must not be used for a timed lane until
its publication clock and run gates are armed.

## Anti-patterns

- Do not import or invent a standalone `useQuery` for this surface. Use
  `db.useQuery` under the provider.
- Do not construct a data client without generated `data`; regenerate and
  install the generated app binding.
- Do not add a transport, cache, outbox, auth context, or policy layer to make
  the facade feel self-contained. Those are canonical client/runtime owners.
- Do not expose a public Swift API from the Phase 0 goldens.

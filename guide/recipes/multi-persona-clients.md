---
title: "Recipe: multiple Node personas and storage partitions"
id: recipes.multi-persona-clients
order: 11
audience: agent-first
capabilities: [clients.headless, auth.sessions]
authorities: [llp/0059-session-projection-and-client-barrier.spec.md, llp/0219-client-dev-diagnostics-channel.rfc.md, llp/0258-first-party-application-auth-bootstrap.rfc.md, llp/0295-published-matrix-improvement-program.plan.md, packages/snapback-client/app-client-defaults.mjs, packages/snapback-client/app-client.mjs, packages/snapback-client/app-client.d.mts, packages/snapback-client/app-client.test.mjs, scripts/check-guide-multi-persona-clients.mjs]
examples: [tests/fixtures/guide-multi-persona-clients/multi-persona-clients.mts, packages/snapback-client/app-client.test.mjs, demos/messaging-snapback/tests/acceptance/headless.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-21
reviewed-authorities-digest: sha256:f5909b72b54dd6d3fd5b63221ca3448c2d03c2ded26e635dc6548e8f508aac48
---

# Recipe: multiple Node personas and storage partitions

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

In one Node process, `createSnapbackAppClient` deliberately shares durable
auth custody for the same application and storage partition. The default
partition is literally `"default"`. That is useful for two handles belonging
to one persona, but wrong for an acceptance harness, bot runner, or seed replay
that represents several users. Without explicit partitions, every persona can
restore and write as the last principal in the shared default custody — the
classic “every persona wrote as Henry” failure.

In the diary's vocabulary, durable custody is “process-global in Node” unless
the multi-persona harness selects distinct partitions.

> **Multiple clients can mean the same session.** If personas share login, a
> second client can have the same user because both calls omitted
> `storagePartition` and selected the default owner. Separate JavaScript
> objects do not separate custody. The common symptom searches are “multiple
> clients same session,” “personas share login,” and “second client same
> user.”

## Fix “multiple clients same session” with a stable partition per persona

The “second client same user” symptom has the same repair.

Choose a deterministic, non-secret partition per logical actor and worker, and
pass it at construction. The packed external fixture imports the current root
constant spelling, `DEFAULT_AUTH_STORAGE_PARTITION`, and rejects accidental
use of it:

```ts source=tests/fixtures/guide-multi-persona-clients/multi-persona-clients.mts
import {
  DEFAULT_AUTH_STORAGE_PARTITION,
  createSnapbackAppClient,
} from '@expo/snapback-client';

type AppClientInput = Parameters<typeof createSnapbackAppClient>[0];

export async function createAcceptancePersonas(
  input: Omit<AppClientInput, 'storagePartition'>,
  workerId: string,
) {
  const partitionFor = (persona: string) => `acceptance:${workerId}:${persona}`;
  const henryPartition = partitionFor('henry');
  const miaPartition = partitionFor('mia');
  if (
    henryPartition === DEFAULT_AUTH_STORAGE_PARTITION
    || miaPartition === DEFAULT_AUTH_STORAGE_PARTITION
  ) throw new Error('acceptance personas must not use the default auth storage partition');

  const [henry, mia] = await Promise.all([
    createSnapbackAppClient({
      ...input,
      storagePartition: henryPartition,
    }),
    createSnapbackAppClient({
      ...input,
      storagePartition: miaPartition,
    }),
  ]);
  return { henry, mia };
}
```

The custody owner key is `(app identity, storagePartition)`. Reusing a
partition means “same persona, shared durable session”; changing it means
“different persona, isolated durable session.” The value must be non-empty,
at most 128 characters, and contain no NUL. It is an isolation label, not a
password, principal assertion, or server-side authorization boundary.

Sign in each client independently, wait for its authority to settle, and
assert `currentAuthorizationScope().principalScope.userId` before performing
persona-labelled writes. That assertion catches an accidentally reused
partition at the test boundary instead of after corrupted expectations.

Dispose every app client at teardown. Durable state intentionally survives
that disposal, so reuse the same partition only when a later run is meant to
restore the same actor. Give parallel test workers an additional stable worker
prefix when they must not share custody.

## Read the implicit-reuse warning

In Node, a second implicit-default client that adopts an already-authenticated
durable owner emits one bounded warning on the shared client's diagnostics
channel:

`SNAPBACK_AUTH_STORAGE_PARTITION_IMPLICIT_REUSE`

The warning does not refuse construction, log credentials, change custody, or
guess that two callers represent different people. It names the default
partition, this guide page, and the supported repair: pass one stable explicit
`storagePartition` per persona or worker. It does not fire for explicit
partition reuse, anonymous custody, or volatile custody.

## Anti-patterns

- Creating multiple Node clients without `storagePartition` and assuming
  object identity isolates their sessions.
- Using a display name as authorization evidence instead of checking the
  settled principal.
- Generating a fresh random partition on every boot when session restoration
  is part of the test.
- Treating a storage partition as a server-side tenant or permission scope.

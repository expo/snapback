---
title: "Recipe: multiple Node personas and storage partitions"
id: recipes.multi-persona-clients
order: 11
audience: agent-first
capabilities: [clients.headless, auth.sessions]
authorities: [llp/0059-session-projection-and-client-barrier.spec.md, packages/snapback-client/app-client.mjs, packages/snapback-client/app-client.d.mts, packages/snapback-client/app-client.test.mjs]
examples: [packages/snapback-client/app-client.test.mjs, demos/messaging-snapback/tests/acceptance/headless.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-21
reviewed-authorities-digest: sha256:0aac45468f10f0b49fd624a7612f1e65a0809af8162a193de392be160fa0e4a5
---

# Recipe: multiple Node personas and storage partitions

In one Node process, `createSnapbackAppClient` deliberately shares durable
auth custody for the same application and storage partition. The default
partition is literally `"default"`. That is useful for two handles belonging
to one persona, but wrong for an acceptance harness, bot runner, or seed replay
that represents several users. Without explicit partitions, every persona can
restore and write as the last principal in the shared default custody — the
classic “every persona wrote as Henry” failure.

In the diary's vocabulary, durable custody is “process-global in Node” unless
the multi-persona harness selects distinct partitions.

## Give every persona a stable partition

Choose a deterministic, non-secret partition per logical actor and pass it at
construction:

```ts fragment reason="application descriptors, admitted bindings, and platform adapters are fixture-specific"
const henry = await createSnapbackAppClient({
  app,
  binding,
  platform,
  storagePartition: 'acceptance:henry',
});

const mia = await createSnapbackAppClient({
  app,
  binding,
  platform,
  storagePartition: 'acceptance:mia',
});
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

## Anti-patterns

- Creating multiple Node clients without `storagePartition` and assuming
  object identity isolates their sessions.
- Using a display name as authorization evidence instead of checking the
  settled principal.
- Generating a fresh random partition on every boot when session restoration
  is part of the test.
- Treating a storage partition as a server-side tenant or permission scope.

---
title: The Contract adapter
id: clients.contract-adapter
order: 1
audience: agent-first
capabilities: [clients.contract, clients.optimistic-overlays]
authorities: [llp/0005-contract-exact-react-integration.explainer.md, llp/0034-contract-source-seam-provider-side.rfc.md, llp/0052-contract-update-economy-and-host-state.rfc.md, llp/0055-agent-principals-and-scoped-grants.rfc.md, llp/0059-session-projection-and-client-barrier.spec.md, packages/snapback-contract/index.mjs]
examples: [demos/todo-v2/surfaces/contract, demos/all-aboard/surfaces/contract, packages/snapback-contract/agent-authority-contract.test.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-07-17
reviewed-commit: 9c9786772d9e590cbc37002609d0618338020569
---

# The Contract adapter

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

`@snapback/contract` (`packages/snapback-contract`) binds a Snapback
backend into a Contract/Exact app: codegen emits per-function Contract
binding modules, and `createSnapbackContractSurface` wires them to a live
client at boot. You write no data-plumbing — the `.contract` file names
what it uses, and everything between it and the server is generated or
product code. (Contract *authoring* itself — language, components, styling
— is the Exact guide's territory; this page covers the Snapback side of
the seam.)

## Bind functions in the .contract file

Codegen wrote one module per query/mutation under
`snapback/generated/contract/`. The app `use`s them and declares
`query`/`mutation` bindings:

```contract source=demos/todo-v2/surfaces/contract/todo.contract
use listTodos from "../../snapback/generated/contract/listTodos.query.ts"
use createTodo from "../../snapback/generated/contract/createTodo.mutation.ts"
use setCompleted from "../../snapback/generated/contract/setCompleted.mutation.ts"
```

```contract source=demos/todo-v2/surfaces/contract/todo.contract
  query todos = listTodos({})
  mutation addTodo = createTodo
  mutation markDone = setCompleted
```

Actions call mutations with typed args:

```contract source=demos/todo-v2/surfaces/contract/todo.contract
  action toggleTodo(id, completed) mutates markDone
    markDone({ id: id, completed: completed })
```

## What a generated binding is

Small and inspectable — a typed delegate into a runtime-links registry:

```ts source=demos/todo-v2/snapback/generated/contract/setCompleted.mutation.ts
export const descriptor = 'setCompleted';
export type SetCompletedArgs = { id: string; completed: boolean };

export function setCompleted(args: SetCompletedArgs) {
  return getSnapbackContractLinks().setCompleted(args);
}
```

```ts source=demos/todo-v2/snapback/generated/contract/runtime-links.ts
let links: SnapbackContractLinks | null = null;

export function configureSnapbackContractLinks(next: SnapbackContractLinks): void {
  links = next;
}
```

The generated `SnapbackContractLinks` interface enumerates every bound
query, mutation, and ephemeral channel — using one before the bridge is
configured throws, so a missed boot step fails loudly, not emptily.

For cross-repo provider verification, the optional discovery helper reports
whether Exact registers its conformance suite:

```sh
node packages/snapback-contract/exact-conformance.mjs
node packages/snapback-contract/exact-conformance.mjs --require
node packages/snapback-contract/exact-conformance.mjs --run
```

The Todo v2 provider-conformance acceptance points the Exact-owned suite at a
live Snapback provider. Ordinary Snapback core work does not require a sibling
Exact checkout; release/integration lanes use `--require` or `--run`.

## Boot: one surface, one idempotent ensure

```ts source=demos/todo-v2/surfaces/contract/main.ts
  const surface = await createSnapbackContractSurface({
    queryName: 'listTodos',
    boundaryKey: 'todos',
    // No hand-written reducers: todo-v2's mutations are IR-tier, so the
    // adapter derives their optimistic overlays from the manifest-embedded
    // plans (Exact LLP 0329 E-B). Apps may still pass optimisticReducers to
    // override per mutation.
    runtime: await import('@exact/contract/runtime'),
    client,
    clientStore,
    userId: ADA,
    manifest: contractDataManifest,
    artifactIndex,
    schemaManifest,
    functionManifest: functionsManifest,
  });
  activeSurface = surface;
```

Then hand the surface's links to the generated registry —
`configureSnapbackContractLinks(surface.links)` — and mount. Before the
surface, boot runs `client.health()` and the **idempotent**
`client.ensureApp({ schema, functions, seed })` (provisions only what's
missing, seeds only empty tables — a reload never resets data; LLP 0034
§5). If the backend is unreachable, the surface may still boot from an
authorized retained snapshot; a true first run fails with the original
network error instead of inventing an empty app.

Agent clients use the same surface constructor. A `SnapbackClient` configured
with `AgentAuthorityFence` is resolved as explicit custody; Contract does not
reinterpret it as a browser session and does not fall back to an unfenced
bearer. Token rotation for the same actor/credential-generation/grant tuple
keeps queued replay bound while refreshing the live carrier. A tuple change or
terminal scoped-token/grant outcome synchronously blanks the Contract boundary;
tuple changes also delete predecessor durable work before the successor can
resume. Retained service-principal reads remain refused on the local v1 plane,
so agent-backed surfaces can use durable queued replay without claiming
retained-read Parity. A terminal purge leaves the format-6 client store marked
`terminallyUnbound`, so direct bind and old tuple captures stay invalid. A
delayed first bind may consume that marker only for the coordinator's exact
still-current capture and the store generation observed with the marker. If
custody later proves a distinct one-epoch successor, that privacy-clean store
binds during the successor barrier. Format-5 migration is deletion-only because
it cannot prove an older writer did not erase the marker; drain and upgrade
every tab/process sharing the same store key together.

The final safe store generation is reserved for terminal deletion. Ordinary
writes stop one value earlier. If an older writer already left bound bytes at
the ceiling, retained and queued reads fail closed even when the deletion write
itself fails; a successful purge may replace that final identity only with a
clean terminal marker. That final marker is idempotent but cannot be rebound—
replace the physical client store before admitting a successor.

All non-null client authority aliases and an explicitly supplied
`authCoordinator` must name the same fence object. A split configuration is
refused with `SNAPBACK_CONTRACT_AUTH_COORDINATOR_MISMATCH`: transport results
captured under fence A cannot be published by comparing them under fence B.

What the surface does for you:

- **Validates artifacts** — the Contract data manifest is checked against
  the artifact index; stale generates fail with
  `SNAPBACK_STALE_CONTRACT_DATA_*` codes rather than mis-binding.
- **Optimistic overlays** — declarative (IR-tier) mutations get their
  optimistic overlay **derived from the manifest-embedded plan**; a
  rejected mutation republishes authoritative rows and surfaces
  `SNAPBACK_CONTRACT_MUTATION_FAILED`. Pass `optimisticReducers` only to
  override.
- **Live push** — `livePush: true` by default; multi-query apps pass
  `liveQueries: [...]` (each entry a name or `{ name, args }`) bound over
  one shared stream. `onConnectionChange` carries the
  [connection axis](../realtime/live-queries.md).
- **Offline/Parity** — with a `clientStore`
  (`createLocalStorageSnapbackClientStore` /
  `createMemorySnapbackClientStore`) the surface persists retained queries
  and an outbox; it reports capability class `Parity` only when the store
  is configured, the manifest claims `offlineReplay`, and every declared
  mutation has a derivable plan — else `Online`. Honest classes, no
  pretending. The complete retention, outbox, replay, and settlement contract
  is in [offline retention and mutation replay](../sync/offline-and-retention.md).
- **Ephemeral channels** — bound as generated links (subscribe + publish
  pairs). For connection-keyed maps, the adapter derives `self` from the
  opaque granted id captured by the successful overlay subscribe—not from the
  surface's readable `connectionId` label—so collision and mint-only
  containment remain correct. See the
  [presence recipe](../recipes/presence-cursors.md) and
  [ephemeral-state reference](../realtime/ephemeral-state.md).

## Anti-patterns

- **Do not hand-wire `client.mutate` inside a Contract app.** The generated
  bindings + surface links are the product path; hand-wiring bypasses
  optimistic overlays, receipts, and reconciliation.
- **Do not write optimistic reducers for declarative mutations.** They are
  derived; hand-written ones drift.
- **Do not skip `artifactIndex`/manifest validation by passing stale
  generates.** Regenerate; the stale-rejection codes exist to stop exactly
  this.
- **Do not pass a scoped token as a raw bearer to Contract.** Construct the
  headless client with `AgentAuthorityFence`; protocol-v1 agent work without
  that custody owner is refused.

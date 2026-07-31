---
title: The Contract adapter
id: clients.contract-adapter
order: 1
audience: agent-first
capabilities: [clients.contract, clients.contract-provider-generation, clients.contract-keyed-scopes, clients.mutation-outcomes, clients.optimistic-overlays]
authorities: [llp/0005-contract-exact-react-integration.explainer.md, llp/0034-contract-source-seam-provider-side.rfc.md, llp/0043-offline-replay-retention.rfc.md, llp/0052-contract-update-economy-and-host-state.rfc.md, llp/0055-agent-principals-and-scoped-grants.rfc.md, llp/0059-session-projection-and-client-barrier.spec.md, llp/0063-partitime-platform-roadmap.plan.md, packages/snapback-contract/index.mjs, packages/snapback-contract/keyed-provider.mjs, packages/snapback-contract/online-surface.mjs]
examples: [demos/todo-v2/surfaces/contract, demos/all-aboard/surfaces/contract, packages/snapback-contract/agent-authority-contract.test.mjs, demos/partiful-matrix/tests/acceptance/step1-keyed-scopes.mjs, demos/partiful-matrix/tests/acceptance/step1-mutation-projection.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-07-20
reviewed-commit: 7d686f7d4ce4f606e3f9a00aeb1ea50d211ac1a7
---

# The Contract adapter

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

`@expo/snapback-contract` (`packages/snapback-contract`) binds a Snapback
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

## Generate a provider-neutral Contract surface

The ordinary Snapback path above still generates bindings directly from the
Snapback artifact set. Partitime also carries the reference integration for a
broader boundary: Exact consumes a provider-native declaration and emits the
Contract manifest, callable binding module, metadata sidecar, named row/result
types, conformance fixtures, and provider documentation. The same generator
consumes independently produced Snapback and Convex declarations; it does not
branch on the provider.

```js source=demos/partiful-matrix/scripts/generate-contract-provider.mjs
const declarations = {
  convex: produceConvexProviderDeclaration(convexInput),
  snapback: produceSnapbackProviderDeclaration(snapbackInput),
};
const artifacts = Object.fromEntries(
  Object.entries(declarations).map(([provider, declaration]) => [
    provider,
    generateFromDeclaration(declaration, {
      contractModuleSpecifier: './provider.generated.ts',
    }),
  ]),
);
```

Run the reference generator and its cumulative gate with a clean Exact
checkout:

```sh
bun demos/partiful-matrix/scripts/generate-contract-provider.mjs \
  --exact-checkout /path/to/exact
node demos/partiful-matrix/tests/acceptance/step3-provider-boundary.mjs \
  --exact-checkout /path/to/exact
```

The generated module exposes a typed configure/reset registry and callable
query and mutation exports. Provider facts remain honest: the Convex adapter
claims WebSocket subscriptions and an initial snapshot, but declines receipts,
offline replay, forced states, and optimistic mutations it does not implement.
The Exact-owned DataProvider suite treats those omissions as declared skips,
not passes or hidden fallbacks.

This integration surface is shipped as the **Partitime reference**, not yet the
stable registry-published `@expo/snapback-contract` package path. Use it to add or
verify a provider producer; do not copy Partitime's generated files into
another app or hand-maintain the generated `.contract-meta.ts` mirror. Stable
external publication remains a later packaged-loop gate in LLP 0063.

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
    // Register-mode adoption: the bound query consumes its bundle
    // registration (one-shot) and the shared socket presents the
    // bundle-minted grant for the atomic pending-registration handoff.
    ...(registeredBoot
      ? {
          connectionId: registeredBoot.connection.connectionId,
          rqsRegistered: (name: string, args: Record<string, unknown>) =>
            registeredBoot.consume(name, args),
        }
      : {}),
  });
  activeSurface = surface;
```

Then hand the surface's links to the generated registry —
`configureSnapbackContractLinks(surface.links)` — and mount. Before the
surface, boot runs `client.health()` and the **idempotent**
`client.ensureApp({ schema, functions, seed, routes })` (provisions only
what's missing, seeds only empty tables — a reload never resets data; LLP
0034 §5). If the backend is unreachable, the surface may still boot from an
authorized retained snapshot; a true first run fails with the original
network error instead of inventing an empty app.

The `registeredBoot` spread is the optional **Channel C register-mode boot**
(LLP 0090 D4): one `client.fetchBundle({ route, mode: 'register', userId })`
returns every query's snapshot plus its live registration and the connection
grant at a single commit cut; `createRqsRegisteredRegistry(bundle)` keys the
entries, and the surface adopts each one instead of opening its own
snapshot-with-subscribe (zero `/live/*/subscribe` round trips at boot). Any
failure degrades to the ordinary fresh-subscribe boot, so the spread is
strictly an optimization.

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
  one shared stream. Maintained transport-provenance tests may pass
  `liveFallbackToPoll: false` so an observed update proves socket delivery;
  product callers should keep the resilient polling-fallback default.
  `onConnectionChange` carries the
  [connection axis](../realtime/live-queries.md). A multi-live surface
  serves **configured live queries only**. Pass the mounted component's
  compiler-known binding list as `requiredQueries`; if any required binding
  is absent from `liveQueries`, construction fails before queries or
  subscriptions start with `SNAPBACK_CONTRACT_QUERY_UNCONFIGURED`, naming
  the missing query and the `liveQueries` repair. The runtime error cell is
  retained only as defense in depth for dynamic/untyped callers. Configuring a snapshot query in
  live-push mode is refused at construction with
  `SNAPBACK_CONTRACT_LIVEQUERY_NOT_LIVE`. Author UI-facing reads as live
  queries; membership-gated live queries deny by *emptiness* (the
  semi-join delivers no rows to non-members) while gated JS point reads
  deny by *diagnostic* — pick the locked-state branch accordingly
  (`empty` vs `error`).
- **Dynamic keyed scopes** — pass `keyedQueryScopes: true` with
  `liveQueries` as a descriptor allowlist when a component's props or state
  choose query args. The adapter no longer preopens one boot-scoped instance;
  each binding's args reach Snapback. Exact's runtime canonicalizes the
  logical key, shares same-key attempts with independent refcounts, and fences
  predecessor generations. Snapback rotates the opaque partition at the auth
  barrier and holds successor transport opens until resume. This mode requires
  the LLP 0063-era Exact runtime and live push; it deliberately refuses a
  retained/offline store until that profile earns its later gate. The legacy
  boot-scoped mode remains the default for currently published Exact packages.

  ```js source=packages/snapback-contract/keyed-provider.test.mjs
  const factorySurface = await createSnapbackContractSurface({
    runtime,
    client: {
      liveQuery(name, options) {
        factoryOpens.push({ name, options });
        return Promise.resolve({ rows: [{ _id: options.args.eventId }], connection: 'live', dispose() {} });
      },
      async mutate() {},
    },
    userId: 'factory-user',
    manifest,
    liveQueries: [{ name: 'eventDetails', args: { eventId: 'legacy-boot-scope' } }],
    keyedQueryScopes: true,
  });
  ```

  For an **Online-only** surface with no `authCoordinator`,
  `agentAuthority`, or retained client store, import
  `createKeyedSnapbackContractProvider` from
  `@expo/snapback-contract/keyed-provider` directly when the Exact runtime exports
  `rotatePartition`. Pass `artifactIndex`,
  `schemaManifest`, and `functionManifest` with the Contract manifest so the
  capability-scoped path keeps the same stale-artifact refusal. It also owns
  Exact-compatible scoped/broadcast `forceQueryState` controls and does not
  open a Snapback transport for a binding mounted under an active force. Do
  not use this shortcut for coordinated auth or offline custody: use
  `createSnapbackContractSurface({ keyedQueryScopes: true })` so the authority
  participant owns boot, quiesce, partition rotation, and resume.
- **Published-runtime Online packaging** — the published Exact 0.1.2 runtime
  predates keyed partition rotation. An Online-only app pinned to that runtime
  can import `createOnlineSnapbackContractSurface` from
  `@expo/snapback-contract/online-surface`. This smaller entrypoint preserves the
  legacy `liveQueries: [{ name, args }]` boot-scoped behavior, artifact
  validation, the runtime's force-state plane, live connection updates,
  server-authoritative mutations, and cleanup without retaining offline/auth/
  ephemeral code. Binding args must match the configured boot scope; mismatch
  is diagnosed and does not become a dynamic-scope claim. It refuses clients
  with coordinated authority. Upgrade to the keyed provider when the runtime
  exposes partition rotation; use the full surface for auth/offline custody.
- **Structural mutation outcomes** — Snapback preserves raw call, optimistic
  overlay, receipt, durable-version, correlation, and ambiguity facts. Exact
  projects those facts into attempt/overlay/evidence state; neither side lets
  late or contradictory evidence rewrite an already committed outcome. The
  Step 1 fault gate covers timeout, retry, duplicate delivery, idempotency,
  late confirmation, rejection, and receipt-less ambiguity against Snapback
  and a non-Snapback provider.
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

## Checked helper metadata and result shapes

Project-owned TypeScript helpers cross into Contract through a
`.contract-meta.ts` sidecar. `node scripts/check-contract-meta.mjs` compares
every `pure({ params: [...] })` list with the actual exported TypeScript
function signature; drift fails the local proof with
`SNAPBACK_CONTRACT_META_PARAMS_DRIFT`. Run Exact's metadata generator when
introducing a sidecar, then keep the drift gate green rather than hand-copying
signature changes blindly.

Declare structural helper results with `shape(...)`, and reference that shape
from `pure({ result: 'ShapeName' })`. The compiler then validates every member:
All Aboard's `board.hero.headsgn` regression fails with
`shape_unknown_member` and suggests `headsign`. A result left as `object` or an
undeclared nominal string remains opaque and cannot provide that protection.

Function-valued declarations have one deliberate residue in the currently
pinned Exact suite: `action(name: Type)` props are arity/type checked, while a
raw decorative function spelling such as `(id) => void` is not a complete
checked signature. Use action-typed props for Contract events; reserve raw
function props for legacy capability glue until Exact promotes that spelling.

## Anti-patterns

- **Do not hand-wire `client.mutate` inside a Contract app.** The generated
  bindings + surface links are the product path; hand-wiring bypasses
  optimistic overlays, receipts, and reconciliation.
- **Do not write optimistic reducers for declarative mutations.** They are
  derived; hand-written ones drift.
- **Do not hand-author provider binding sidecars.** Generate them from the
  provider declaration; a handwritten mirror defeats the closed type loop.
- **Do not skip `artifactIndex`/manifest validation by passing stale
  generates.** Regenerate; the stale-rejection codes exist to stop exactly
  this.
- **Do not pass a scoped token as a raw bearer to Contract.** Construct the
  headless client with `AgentAuthorityFence`; protocol-v1 agent work without
  that custody owner is refused.

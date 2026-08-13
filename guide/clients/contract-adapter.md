---
title: The Contract adapter
id: clients.contract-adapter
order: 1
audience: agent-first
capabilities: [clients.contract, clients.contract-provider-generation, clients.contract-keyed-scopes, clients.mutation-outcomes, clients.optimistic-overlays]
authorities: [llp/0005-contract-exact-react-integration.explainer.md, llp/0021-contract-exact-integration-hardening.plan.md, llp/0034-contract-source-seam-provider-side.rfc.md, llp/0043-offline-replay-retention.rfc.md, llp/0052-contract-update-economy-and-host-state.rfc.md, llp/0055-agent-principals-and-scoped-grants.rfc.md, llp/0059-session-projection-and-client-barrier.spec.md, llp/0063-partitime-platform-roadmap.plan.md, packages/snapback-codegen/codegen-policy.schema.json, packages/snapback-contract/index.mjs, packages/snapback-contract/keyed-provider.mjs, packages/snapback-contract/online-surface.mjs]
examples: [demos/todo-v2/snapback/codegen.policy.json, demos/todo-v2/surfaces/contract, demos/all-aboard/surfaces/contract, demos/team-chat/surfaces/contract, demos/pointing-room, packages/snapback-contract/agent-authority-contract.test.mjs, demos/partiful-matrix/tests/acceptance/step1-keyed-scopes.mjs, demos/partiful-matrix/tests/acceptance/step1-mutation-projection.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-11
reviewed-authorities-digest: sha256:3b0befc7c75710f4371fd0a0fb62af039db64b8c78ffdd26cb5e0b9f49bbaa4b
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

<!-- since: 0.1.21 unreleased -->

> **Unreleased.** Explicit Exact metadata output is not present in the newest
> published closure, 0.1.20. The generated-artifact guide documents the
> temporary npm-only workaround for earlier releases.

## Opt in to Exact metadata before compiling Contract

Add `"contractMetadata": "exact"` to the committed
`snapback/codegen.policy.json`, preserving its existing
`committedProjections`, then run `snapback generate snapback`. If the project
had no policy, start with:

```json fragment reason="minimal codegen policy; applications preserve any existing committed projections"
{
  "schemaVersion": "snapback.codegen-policy.v1",
  "committedProjections": [],
  "contractMetadata": "exact"
}
```

That declaration deterministically adds the `.contract-meta.ts` modules Exact
discovers beside the callable query, mutation, and ephemeral modules. Merely
installing `@exact/contract` never changes generated output. Projects that do
not compile Contract leave the field absent and keep the neutral callable and
runtime-link artifacts. See [generated artifact custody and
review](../getting-started/generated-artifacts.md#choose-exact-metadata-output-explicitly)
for the output split and the temporary TypeScript exclusion for older published
versions.

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

A sessions-mode Contract/Vite surface that needs its one-time code during
local boot should use the
[serve-only dev mailbox relay](../recipes/browser-auth.md#get-the-sign-in-code-in-local-development):
Vite owns the admin and impersonation carriers, while the browser sees only the
code it passes to `authExchange`.

The `registeredBoot` spread is the optional **Channel C register-mode boot**
(LLP 0090 D4): one `client.fetchBundle({ route, mode: 'register', userId })`
returns every query's snapshot plus its live registration and the connection
grant at a single commit cut; `createRqsRegisteredRegistry(bundle)` keys the
entries, and the surface adopts each one instead of opening its own
snapshot-with-subscribe (zero `/live/*/subscribe` round trips at boot). Any
failure degrades to the ordinary fresh-subscribe boot, so the spread is
strictly an optimization.

Boot-order variants: `createSnapbackContractSurface` treats the connection
as a precondition — links return only after ensure and every live
snapshot-with-subscribe. When the app needs a useful first paint before the
backend answers, use the **render-first** pair instead:
`createDeferredContractLinks()` returns links synchronously with every
binding pending (the `.contract` `loading` arm renders with zero backend),
and `createRenderFirstSnapbackContractSurface(...)` runs connection, ensure,
and subscription establishment behind the mounted app, attaching bindings
live in place. Both are package-root exports (ENG-23736; LLP 0034 §10.7).
`mountSnapbackContractHeadless(runtime, component, options)` is the shared
mount helper for driving a compiled Contract component without a DOM shell —
acceptance suites and headless hosts use it; the surface's own mount paths
compose it.

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

<!-- since: 0.1.19 -->

  One `createSnapbackContractSurface({ keyedQueryScopes: true })` now boots a
  component that combines keyed durable queries with manifest-declared
  ephemeral collections. The returned `links` contains each durable query and
  mutation plus the generated ephemeral `<name>` / `<name>Publish` read/publish
  pair; Pointing Room therefore configures one registry from one surface, with
  no companion-surface merge. The durable `liveQueries` list remains an
  allowlist, while an ephemeral named by `requiredQueries` is checked against
  ephemeral wiring instead of that durable allowlist.

  One surface does not mean one physical connection: the durable keyed lane
  keeps the surface connection, while the ephemeral lane uses its own stable
  connection across authority transitions. That separation prevents an
  ephemeral consumer from withholding a disposed keyed binding's durable
  unsubscribe.

  Construction refuses with `SNAPBACK_CONTRACT_EPHEMERAL_UNSUPPORTED` when the
  client cannot provide `subscribeEphemeral()` and `liveStreamManager()` for
  the required ephemeral collections—or for every manifest-declared ephemeral
  when none is explicitly required. Its message names both missing generated
  links for each collection, such as `roomPresence` and
  `roomPresencePublish`, before the component mounts.

  The deliberate remaining limit is force-state tooling: the keyed provider
  exposes `forceQueryState` but not `forceEphemeralState`. The ordinary
  multi-live boundary-provider path still exposes local-only
  `forceEphemeralState`; use that path when a test needs to force an ephemeral
  cell.

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
  containment remain correct. Ordinary collection values publish through the
  same rated-channel clause as pointers; `pointerChannel` is the carrier, not
  a payload restriction. See
  [publish ordinary presence from Contract](../recipes/presence-cursors.md#publish-ordinary-presence-from-contract) and the
  [ephemeral-state reference](../realtime/ephemeral-state.md).

## Prove disclosure at the wire boundary

Contract owns the `contract` block grammar. Read Exact's closed
[clause inventory](repo(exact):guide/contract/contract-blocks.md#the-complete-clause-inventory)
and [claim ceiling](repo(exact):guide/contract/contract-blocks.md#know-what-a-claim-cannot-say)
instead of inferring a stronger assertion language from the Snapback binding.
An invariant has the form `invariant [when <expr> then] <assertion>`, where the
assertion is only `has`, `missing`, `count`, or `state`.

For authorization- or disclosure-shaped claims, that means a Contract block
can continuously prove the observable UI shadow: presence/absence, element
state, and counts that match derived partitions. Pointing Room partitions the
nullable server result and keeps the rendered branches aligned with those
counts:

```contract source=demos/pointing-room/surfaces/contract/pointing.contract
  derive maskedVoteCount = tally.filter((vote) => vote.value == null).length
  derive revealedVoteCount = tally.filter((vote) => vote.value != null).length
```

```contract source=demos/pointing-room/surfaces/contract/pointing.contract
    count node testId="participant-card" = tally.length
    invariant count node testId="masked-vote-value" = maskedVoteCount
    invariant count node testId="revealed-vote-value" = revealedVoteCount
```

The block cannot prove rendered-text equality against an expression, quantify
over every `each` row, or state that a value came from a particular field,
row, principal, or server response. Selector strings are literals, and
`count` is the only assertion with an expression on the right. Therefore the
count partition is genuine UI evidence, but it is not an authorization or
wire-disclosure proof.

Pair the Contract block with a wire-level acceptance test. Pointing Room's
[`disclosure-invariant.mjs`](repo:demos/pointing-room/tests/acceptance/disclosure-invariant.mjs)
mints two principals and asserts the raw subscription-response and WebSocket
bytes: a masked vote is `null`, the hidden value is absent before reveal, the
revealed value arrives afterward, and another room never appears. Keep the
Contract claim scoped to rendering and let the two-principal test carry the
server disclosure claim.

## Call a paged query from a Contract screen

Standard-pattern page pairs (`firstRoomMessagePage` / `nextRoomMessagePage`
and kin) are **callable-only** `Query` definitions — they cannot be
subscribed, so they are not Contract data links (see
[why the pair is callable-only](../backend/standard-patterns.md)). The
intended composition when a Contract product screen needs one: keep the live
room state and actions in compiled Contract, and invoke the generated page
references from a small host/client control through the ordinary Snapback
client. That boundary is deliberate, not a workaround — a subscribable
historical page would create one authorization-sensitive subscription per
visited page.

Team Chat's Contract surface is the CI-verified example
([demos/team-chat/surfaces/contract/main.ts](repo:demos/team-chat/surfaces/contract/main.ts),
exercised by the contract-browser acceptance). The host control owns
loading, terminal, and refusal state and gates every settlement on a
`disposed` flag so a torn-down screen never renders a late page:

```ts source=demos/team-chat/surfaces/contract/main.ts
  button.addEventListener('click', () => {
    error.textContent = '';
    const request = cursor === null
      ? client.query(api.firstRoomMessagePage, { args: { roomId }, userId })
      : client.query(api.nextRoomMessagePage, { args: { roomId, after: cursor }, userId });
    void request.then((page) => {
      if (disposed) return;
      rows = cursor === null ? page.rows : [...rows, ...page.rows];
      cursor = page.cursor ?? null;
      terminal = cursor === null;
      render();
    }, (cause) => {
      if (disposed) return;
      rows = [];
      cursor = null;
      terminal = false;
      error.textContent = cause instanceof Error ? cause.message : String(cause);
      render();
    });
  });
```

A `null` cursor from the server is the terminal signal (`terminal = cursor
=== null`); a refused call (for example after losing the room seat) lands in
the rejection path, which clears the accumulated rows rather than showing
history the caller can no longer read. The same surface pairs the control
with a membership live query that blanks the page list the moment the seat
is revoked — fresh grants are observed by simply calling the first page
again.

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
- **Do not treat a Contract invariant as an authorization proof.** It can
  check the rendered partition, not provenance or raw response bytes; pair it
  with a wire-level two-principal acceptance test.

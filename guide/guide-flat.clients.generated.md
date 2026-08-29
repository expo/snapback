<!-- Generated clients section flat projection by scripts/generate-guide-manifest.mjs. Never hand-edit. -->

---

<!-- snapback-guide-source: guide/clients/contract-adapter.md -->
---
title: The Contract adapter
id: clients.contract-adapter
order: 1
audience: agent-first
capabilities: [clients.contract, clients.contract-provider-generation, clients.contract-keyed-scopes, clients.mutation-outcomes, clients.optimistic-overlays]
authorities: [llp/0005-contract-exact-react-integration.explainer.md, llp/0021-contract-exact-integration-hardening.plan.md, llp/0034-contract-source-seam-provider-side.rfc.md, llp/0043-offline-replay-retention.rfc.md, llp/0052-contract-update-economy-and-host-state.rfc.md, llp/0055-agent-principals-and-scoped-grants.rfc.md, llp/0059-session-projection-and-client-barrier.spec.md, llp/0063-partitime-platform-roadmap.plan.md, llp/0266-coterie-exact-contract-benchmark.plan.md, packages/snapback-codegen/codegen-policy.schema.json, packages/snapback-contract/index.mjs, packages/snapback-contract/keyed-provider.mjs, packages/snapback-contract/online-surface.mjs, demos/coterie/src/data/provider-factory.ts, demos/coterie/src/data/snapback-provider.ts, demos/coterie/src/data/generated/coterie.bindings.ts, demos/coterie/tests/snapback-provider.integration.test.ts]
examples: [demos/todo-v2/snapback/codegen.policy.json, demos/todo-v2/surfaces/contract, demos/all-aboard/surfaces/contract, demos/team-chat/surfaces/contract, demos/pointing-room, demos/coterie, packages/snapback-contract/agent-authority-contract.test.mjs, demos/partiful-matrix/tests/acceptance/step1-keyed-scopes.mjs, demos/partiful-matrix/tests/acceptance/step1-mutation-projection.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-21
reviewed-authorities-digest: sha256:07e25fc91a4d8b6859d623234e4dba3d66ecd830f7cff7e0b51b840dcc467995
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

<!-- since: 0.1.21 -->

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

## Adapt an already-frozen provider-neutral declaration

Before copying this demo adapter's per-subscription mechanics, read the
[provider lifecycle recipe](../recipes/provider-lifecycle.md). A production
provider owns a stable connection identity above its cells and multiplexes
logical subscriptions; the bounded foreign-declaration example below is not a
numeric connection-budget policy.

Sometimes the declaration, generated bindings, and declaration digest already
belong to an application that supports several providers. In that inverse
case, implement the existing `ContractDataProvider` over Snapback; do not feed
Snapback identity or capability extensions into a second declaration.
Coterie's adapter is the bounded reference shape.

### Preserve the foreign digest; qualify the provider beside it

Return the exact foreign manifest from `provider.manifest`, then configure the
already-generated bindings through their digest handshake. The generated
module compares `provider.manifest.inputsHash` with the declaration digest on
every configure, including HMR reconfiguration:

```ts source=demos/coterie/src/data/generated/coterie.bindings.ts
export function configureFromProvider(provider: ContractDataProvider): { dispose(): void } {
  const providerInputsHash = provider.manifest.inputsHash;
  if (providerInputsHash !== bindings.inputsHash) {
    throw new Error(
      `configureFromProvider(coterie): declaration digest mismatch — generated bindings expect inputsHash "${bindings.inputsHash}" but provider.manifest carries "${String(providerInputsHash)}". Regenerate the generated bindings from the current declaration (fail-closed on every configure, including HMR reconfigure).`,
    );
  }
  const projection = createProviderLinks(provider);
  // The one sanctioned boundary cast (LLP 0391 §4.2): createProviderLinks
  // builds one link per manifest descriptor, and the digest check above
  // pinned provider.manifest to this generated surface.
  configureGeneratedProviderLinks(projection.links as unknown as GeneratedProviderLinks);
  return { dispose: () => projection.dispose() };
}
```

Keep provider-specific facts as **qualification evidence**, not declaration
inputs. Coterie exposes the shared manifest verbatim, a separate milestone
label, and a provider-neutral `listProviderClaims` allow-list. A benchmark or
release receipt records the foreign `inputsHash`, the provider lane, the exact
claimed operations and compatibility tokens, and the conformance probes that
actually ran. Changing Snapback's claim set must not change the declaration
digest.

### Compose Snapback mechanisms behind the provider seam

The adapter, not Contract views, owns three different Snapback surfaces:

- `AuthCoordinator` custody plus `subscribeCurrentPrincipal` and
  `subscribeAuthTerminal` project the foreign `listSession` cell. A principal
  transition republishes or blanks that cell and starts/stops protected query
  subscriptions.
- Generated Snapback live-query references back foreign query observers.
  A transport-proof adapter sets `transport: 'stream'` and
  `fallbackToPoll: false`; it maps initial rows, updates, connection changes,
  disposal, and structured errors into the foreign cell contract.
- `createAssetClient(client).upload(...)` performs ordinary session-owned
  upload and finalization; the adapter then calls an owner-authorized Snapback
  mutation that attaches the typed asset reference. Only the foreign avatar
  reference and result cross back above the seam.

Coterie's profile subscription disables the lower transport's polling fallback
so a delivered update proves stream push:

```ts source=demos/coterie/src/data/snapback-provider.ts
        const handle = await this.#client.liveQuery(api.listProfiles, {
          args: {},
          connectionId: `${this.#instanceId}-profiles-${++this.#profileConnectionSequence}`,
          transport: 'stream',
          fallbackToPoll: false,
          onUpdate: (rows) => {
            if (!subscription.active || subscription.generation !== generation) return;
            const nextRows = (rows ?? []) as readonly BackendProfileRow[];
            if (this.#testHooks.suppressProfileUpdate?.(
              nextRows,
            )) return;
            this.#rememberProfileIdentities(nextRows);
            if (!established) return;
            const sameProfiles = nextRows.length === subscription.backendRows.length
```

Its avatar path keeps byte acquisition and digesting app-owned, then uses the
ordinary Snapback asset and typed-attach surfaces behind the provider:

```ts source=demos/coterie/src/data/snapback-provider.ts
    const sourceDigest = await sha256Hex(bytes);
    const assetCacheKey = `${current.ownerId}:${sourceDigest}`;
    let assetId = this.#uploadedAvatarAssets.get(assetCacheKey);
    const reused = assetId !== undefined;
    if (!assetId) {
      const assetClient = createAssetClient(
        this.#client as unknown as Parameters<typeof createAssetClient>[0],
      );
      assetId = await assetClient.upload(
        api.avatarUpload,
        new Blob([bytes], { type: mediaType }),
      );
      this.#rememberAvatarAsset(assetCacheKey, assetId);
    }
```

Do not add polling, another offline queue, raw asset routes, or client-asserted
identity above `ContractDataProvider`. Those are provider responsibilities.

### Refuse unqualified milestones and translate errors deliberately

The foreign manifest may already contain future operations. Maintain explicit
qualified query and mutation sets. A call named by the manifest but outside
the qualified set returns the adapter's serialized, named milestone refusal;
it must not return empty data, succeed as a no-op, or fall through to an
unknown-operation error. Names such as `SnapbackMilestoneUnsupportedError`
belong to the adapter. Only mapped errors declared by the foreign contract,
such as `DuplicateHandleError`, carry declaration-owned names:

```ts source=demos/coterie/src/data/snapback-provider.ts
function milestoneRefusal(name: string): NamedProviderError {
  const milestone = milestoneForOperation(name) ?? 'M2/M3/M4/M5/M8';
  return new NamedProviderError(
    'SnapbackMilestoneUnsupportedError',
    `snapback provider claims M1+M2+M3 plus provider discovery only; ${name} is outside that claim — LLP 0266 D7 (${milestone})`,
  );
}
```

Centralize the error translation before serializing. Read both Snapback's
platform diagnostic code and `diagnostic.details.appCode`: map the former to
the foreign declaration's auth/asset error names and the latter to its domain
refusal names. Preserve a generic `SnapbackProviderError` only for unmapped
failures, rather than leaking `SNAPBACK_*` or application codes as accidental
foreign API names. Coterie's mapping, for example, turns an app
`DUPLICATE_HANDLE` refusal into `DuplicateHandleError` and platform password
diagnostics into the declaration's auth errors:

```ts source=demos/coterie/src/data/snapback-provider.ts
  const applicationMapping = appCode
    ? applicationMappings[operation]?.[appCode]
    : undefined;
  if (applicationMapping) {
    return new NamedProviderError(applicationMapping[0], applicationMapping[1], { cause: error });
  }

  if (operation === 'login' && code === 'SNAPBACK_AUTH_CREDENTIAL_INVALID') {
    return new NamedProviderError(
      'InvalidCredentialsError',
      'Email or password is incorrect.',
      { cause: error },
    );
  }
  if (operation === 'signup' && code === 'SNAPBACK_AUTH_PASSWORD_EXISTS') {
    return new NamedProviderError(
      'DuplicateEmailError',
      'An account already uses that email.',
      { cause: error },
    );
  }
```

### Prove it with two event-driven clients

Run two independent provider instances against the same backend. Subscribe
client B, register a promise for a future matching delivery, mutate through
client A, and await that delivery. Client B performs no query, mutation,
timer-based refetch, or polling after the waiter is armed:

```ts source=demos/coterie/tests/snapback-provider.integration.test.ts
          async applySubscriptionUpdate() {
            updateSequence += 1;
            const displayName = `Alice Conformance ${updateSequence}`;
            const delivery = clientBProfiles.next((rows) => (
              rows.some((row) => row.id === 'alice' && row.displayName === displayName)
            ));
            mutationValue(
              await clientA.mutate('editProfile', {
                displayName,
                bio: `Conformance live update ${updateSequence}`,
                handle: null,
                location: null,
                link: null,
              }),
              'conformance subscription update',
            );
            await delivery;
          },
```

Keep “no polling” true both below and above the seam: disable the Snapback
live-query fallback for the proof, and do not compensate with a provider-level
poller. Exercise disposal and connection/error projection as part of the same
probe.

A generic `DataProvider` conformance runner may validate the **entire shared
manifest and capability declaration** while behaviorally probing only one
primary query and mutation. That is useful, but it is not evidence that every
declared operation ran. Report both scopes explicitly: the qualified
operation/token allow-list, and the exact primary query/mutation pairs (plus
any separate two-client probes) actually exercised. Never summarize the
runner's whole-manifest validation as whole-manifest behavioral conformance.

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

- **Do not hand-wire `client.mutate` in Contract presentation or application
  code.** Generated bindings + surface links are the product path there. An
  inverse adapter may hand-wire generated live queries, `client.mutate`, and
  `createAssetClient` only behind the `ContractDataProvider` provider seam.
- **Allow no polling above the seam.** The adapter owns subscriptions and may
  disable a lower transport fallback for a stream-only proof; Contract code
  must not add a provider-level poller.
- **Do not create a second declaration or provider-specific identity.** Adapt
  the frozen declaration and keep provider claims as qualification evidence.
- **Do not leak `SNAPBACK_*` or application refusal codes above the seam.** Map
  declared errors to declaration-owned names and use adapter-owned names for
  milestone and unmapped-provider refusals.
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

---

<!-- snapback-guide-source: guide/clients/headless.md -->
---
title: The headless client
id: clients.headless
order: 1
audience: agent-first
capabilities: [clients.headless, clients.external-store, clients.micro, clients.optimistic-mutation-view]
authorities: [llp/0012-headless-integration-contract.spec.md, llp/0064-native-client-surfaces.rfc.md, llp/0218-outbox-settlement-contract.rfc.md, llp/0219-client-dev-diagnostics-channel.rfc.md, llp/0238-explicit-client-lifecycles.rfc.md, llp/0247-ordinary-client-normalization-and-recovery.rfc.md, llp/0262-dev-identity-custody-capability.rfc.md, llp/0270-local-first-client-defaults.rfc.md, packages/snapback-client/index.mjs, packages/snapback-client/index.d.mts, packages/snapback-client/generated-mutation-ir.mjs, packages/snapback-client/optimistic-rebase.mjs, packages/snapback-client/generated-optimistic-default.test.mjs, packages/snapback-client/commands.mjs, packages/snapback-client/commands.d.mts, packages/snapback-client/reference-kinds.mjs, packages/snapback-client/online.mjs, packages/snapback-client/external-store.mjs, packages/snapback-client/agent-authority.mjs, packages/snapback-client/exact-reference-types.fixture.ts, packages/snapback-client/auth-identity-types.fixture.ts, packages/snapback-client/reference-kind.test.mjs, packages/snapback-client/outbox-store.test.mjs, packages/snapback-client/outbox-drain.test.mjs, packages/snapback-codegen/client-lifecycle.mjs, packages/snapback-codegen/client-lifecycle.test.mjs, demos/_kit/agent-authority-filesystem.mjs, demos/_kit/server-process.mjs, packages/snapback-contract/index.mjs, packages/snapback-contract/lifecycle-generation-exhaustion.test.mjs, demos/todo/tests/acceptance/headless.mjs, demos/card-game/tests/acceptance/authority-scope.mjs]
examples: [demos/todo, demos/todo-v2, demos/graffiti, demos/card-game, demos/partiful-matrix/surfaces/vanilla]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-25
reviewed-authorities-digest: sha256:6b002186d94944cf9c5a3021c79654857ab0e11265ea7758ae917dca708f23de
---

# The headless client

If you came looking for a “drive the generated API from Node” page, stay here.
This is the framework-neutral Node/browser-worker surface for the same
generated Explicit and Familiar references: construct with `baseUrl`, pass a
stable `connectionId` to `liveQuery`, and use the generated command client for
asset-bearing commands. There is no second Node-only generated API.

Search vocabulary: drive the generated API from Node;
command-client input shape; flat args; asset source.

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

`SnapbackClient` from the versioned `@expo/snapback-client` package is the
framework-neutral reference arm. The old `demos/_kit/client.mjs` path is a
compatibility re-export only. Demos, acceptance suites, the React arm, and
`@expo/snapback-contract` build on the same transport, live-stream, ephemeral,
receipt, and auth behavior rather than reimplementing HTTP.

Browser bundles that load a client entry as a dynamic module namespace should
import `SnapbackClient` from `@expo/snapback-client/online`. It re-exports the same
class while keeping optional agent-custody and external-store package exports
out of consumers that did not select them. Use the root entry when those
additional exports are required.

The compiled **Micro profile** is a third entry-point family: three published
subpaths, `@expo/snapback-client/micro`, `./micro/core`, and `./micro/live`
([LLP 0147](repo:llp/0147-compiled-microclient.rfc.md)). `./micro` re-exports
the capability-minimal core runtime (`createMicroRuntime`); `./micro/core` is
the standalone core/operations/authority-fence graph with no live, outbox,
socket, or storage imports; `./micro/live` is the smallest polling live
composition and is imported only when a generated Micro entry selects a live
operation, so a core-only compiled entry can never make the live lane
reachable through a barrel. Selection rule: the package root when
agent-custody or external-store exports are needed, `./online` for browser
dynamic-namespace bundles, and the Micro subpaths only for LLP 0147 compiled
profiles.

For declaration-exact constructor options and method signatures, use the
generated [`SnapbackClient`](../reference/expo-snapback-client.md#symbol-snapbackclient-cabf32a88f)
and [`SnapbackClientOptions`](../reference/expo-snapback-client.md#symbol-snapbackclientoptions-715941730d)
entries. Those anchors and `snapback guide SnapbackClient` resolve the same
build-bound registry identity.

When something breaks behind this client, open the
[admin console](../operating/admin-console.md) before writing another probe:
`snapback admin --ready-file .snapback/dev.ready.json` opens the shipped
browser debugger for Data, Functions, Realtime, Errors, and Logs against the
same running backend — check it before falling back to `curl`, raw host
operations, or a one-off verification script.

## Construct one client per backend and custody context

> **Multiple Node clients can share one login.** App clients in one process
> share durable auth custody when both their app identity and
> `storagePartition` match; the implicit partition is `"default"`. A
> multi-persona harness must assign one stable explicit `storagePartition` per persona or worker,
> or every client may restore the same principal. Once
> multiple implicit-default handles
> share an authenticated durable owner — whether construction happened before
> or after sign-in — the client emits the bounded warning
> `SNAPBACK_AUTH_STORAGE_PARTITION_IMPLICIT_REUSE`. Follow the
> [multiple Node personas recipe](../recipes/multi-persona-clients.md).

When this client installs dev-mode, client-asserted identity, pass the current
per-boot capability as `devIdentityCapability`; the client sends its dedicated
`x-snapback-dev-identity` carrier only on identity-bearing app requests and
`/connection/open`, never on admin-token-gated host operations. The demo
server kit validates the ready descriptor's `devIdentityCapabilityFile`, reads
the owner-only sidecar, and exposes both `server.devIdentityCapability` and
`server.clientOptions` for direct construction. LLP 0262 rollout stage 2 still
accepts a client whose kit or older server has no carrier, with one server
warning per boot naming the committed enforcement flip; a presented bad value
already receives the generic `SNAPBACK_DEV_IDENTITY_REFUSED`, and absence
becomes a refusal only after every supported carrier's acceptance witness
permits that flip.

```js source=packages/snapback-client/index.mjs
    bearerToken = null,
    // 0137 A4-f6: an explicit anonymous mode so headless consumers (suites,
    // SSR, prerender) can read `auth: 'public'` operations from a sessions
    // server — the protocol offer is sent with no credential. Auth-required
    // operations receive the server's ordinary anonymous refusal.
    custody = null,
    authClientProtocol = null,
    // Capability advertisement, default-on at the implementing library
    // boundary. Embedded integrations may pass null to remain intentionally
    // legacy; auth-scoped live work then refuses rather than degrading.
    authInvalidationProtocol = 1,
    authorityDescriptorProtocol = 1,
    authorizedLeaseProtocol = null,
    // LLP 0163 pre-publication carrier. Explicit opt-in only while the Spec
    // and capability rows remain Draft/Missing; v1 requires a durable outbox
    // so range, next counter, and intent share one restart-safe transition.
    operationIdentityProtocol = null,
    // Set only after capability preflight advertises the hosted ephemeral
    // authority offer. Old servers therefore never see an unknown member.
    ephemeralAuthorityProtocol = null,
    // LLP 0107's additive expiry clock negotiation. A version-aware server
    // echoes 1; a legacy server is retried without this member so durable
    // operations remain available while React presence reports unsupported.
    ephemeralExpiryProtocol = 1,
    authCoordinator = null,
    agentAuthority = null,
    senderConstrained = false,
    clientStoreId = processClientStoreId,
```

`baseUrl` is the running server. `adminToken` is only for explicit
development/operations methods. Browser-owned sessions use an
`AuthCoordinator`; do not also pass `bearerToken`, because that would bypass
coordinator custody. `clientStoreId` binds authorization and retained query
namespaces to one durable client store.

When a trusted server-side identity broker returns a genuine Snapback session,
construct the explicit protocol-client arm with
`createExternalSessionClient(baseUrl, { bearerToken })`. It repeats the exact
`auth/rr` and `auth/live` offers, including connection-open invalidation
negotiation. This is ordinary bearer custody: it does not refresh or logout
through an `AuthCoordinator`, and it must not be substituted for the dedicated
sender-constrained hosted browser constructor. See
[native authentication](../auth/native-apps.md).

`senderConstrained` is an internal composition option for the dedicated
`@expo/snapback-client/hosted-browser` entrypoint. Local applications should not set
it directly, and no current hosted target has positive admission; see
[target honesty](../auth/targets.md).

Authorization-invalidation protocol v1 is a library capability and therefore
defaults on for every `SnapbackClient` custody arm. Only an embedded integration
that intentionally targets a legacy server should pass
`authInvalidationProtocol: null`; sessions-mode auth-scoped live work then
refuses instead of silently degrading.

CLI and daemon agents use `AgentAuthorityFence`, not the browser
`AuthCoordinator`. Construct it from the scoped-token mint response plus its
actor id, then pass it as `agentAuthority`. Replace an expiring token only through
`replaceAgentCredential(...)`. The client first offers the proposed bearer to
`GET /auth/session` without changing custody, verifies the exact returned
service-principal descriptor, and only then begins the transition. A rejected
or mismatched proposal leaves the predecessor custody record and its queued
work unchanged. A same-tuple replacement preserves the durable
actor/credential-generation/grant axis while invalidating the old token
carrier; a changed tuple deletes predecessor state before publishing the
validated successor. In either case, no successor result can publish until an
exact final custody comparison succeeds.

This fork only **adopts an already-issued agent credential**. No
user-reachable client or server route registers an agent principal or issues
the initial `sbac_` credential today; those credentials come from
harness/test-lane provisioning. Treat
[`auth.agent-registration`](../capabilities.md) as a capability GAP, not as a
missing method to keep searching for.

Long-running Node CLI and daemon processes should import
`createFilesystemAgentAuthorityCustodyStorage` directly from
`demos/_kit/agent-authority-filesystem.mjs` and pass its result plus a stable
`custodyId` to `AgentAuthorityFence`. The factory requires an absolute private
state directory. It creates 0600 atomic custody files under a 0700 directory,
serializes independent processes with a bounded OS advisory lock, and never
persists the scoped-token bearer or carrier id. This is a Node-only import;
browser code continues to import the portable client arm without filesystem
dependencies. The first handshake, restart adoption, and interrupted-transition
recovery all require the server-issued descriptor proof; plain synchronization
cannot claim an unvalidated durable tuple. Treat the state directory and
`custodyId` as stable deployment identity, not as per-process temporary state.

The adapter validates the directory once and retains its exact POSIX inode in a
dedicated helper. SQLite locking, record reads, temporary writes, rename,
cleanup, and directory fsync all use single-component names relative to that
kernel-held directory, so replacing the configured pathname cannot redirect a
commit. A helper crash releases both the lock and the only possible writer; the
current process then fails closed until restart instead of reopening the path.
Keep the configured-directory set small: one process retains at most 32 such
capabilities and refuses the next one with
`SNAPBACK_AUTH_CUSTODY_DIRECTORY_CAPABILITY_LIMIT`.

The directory must be a normalized absolute path to an effective-user-owned
`0700` directory. The adapter rejects untrusted symlink components, unsafe
ancestor owners/ACLs, hard-linked or non-`0600` custody files, and records over
64 KiB. Under each primary, ledger-root, bucket, or migration-witness partition
lock it removes only validated files in that exact record's temporary
namespace: one deterministic `<record>.tmp` sidecar capped at 64 KiB.
`maintenanceSnapshot()` reports the last exact cleanup; partial-cleanup failures use the
exported `SNAPBACK_AUTH_CUSTODY_ORPHAN_*` diagnostics. A ledger/migration scan
examines at most 4,096 directory entries and fails closed with
`SNAPBACK_AUTH_CUSTODY_PARTITION_SCAN_LIMIT` above that operator-rotation
boundary. Do not share the directory with another Unix account. The retained
capability closes directory-name ABA, but it does not protect against a
malicious same-uid process mutating entries inside the pinned inode.

Durable deletion records the exact actor/credential-generation/grant tuple in
a bounded terminal ledger. By default the ledger has 64 deterministic buckets
of at most 64 exact entries; it stores no bearer, token id, or carrier id. If a
bucket fills, the root becomes globally `closed` and every tuple is refused —
Snapback never evicts an entry or risks reopening an old validated descriptor.
Call `await agentAuthority.inspectCustody()` for redacted operations data:
format/state, unique witness count, stored ledger bytes, capacity, the 75%
total and per-bucket warning thresholds, largest bucket count, and a warning
bit. It does not return tuple identities, and closed state always warns.

Upgrading from tuple-specific v1 witness files is automatic and crash-safe
under the universal custody gate. Until the primary moves to format 2, new
terminal facts are written to the v1 journal first so an interrupted old reader
still sees them. Once the bucket ledger is active (or closed), Snapback cuts the
primary to format 2, retires each identified journal JSON and lock file, and
writes the legacy-cut cleanup seal last. Steady v2 gates do not scan the shared
directory. They derive and strictly inspect only a candidate tuple's exact v1
filename, so an unidentifiable malformed related witness still fails that
candidate closed, while malformed unrelated files are isolated. This exact
lookup also absorbs and retires a post-cut journal from a straggling v1
terminal process before comparing publication authority. Drain
and upgrade every process sharing one custody directory together; mixed
versions are not a supported availability mode, although the journal/format
cut fails closed instead of forgetting evidence. Custom storage adapters must
advertise `partitionOwnership: "partitioned-v2"` and implement the gate owner's
independent `withPartition(...)`, paged `scanPartitions(...)`, exact-revision
`remove(...)`, and both-file `retire(...)` operations. A v1 or
single-global-mutex adapter is
refused.

Contract's durable client store is a separate coordinated protocol. Its current
format 6 makes the terminally-unbound anti-rebind marker mandatory and migrates
format 5 deletion-only. Drain and upgrade every process or browser context
sharing one physical client-store key together; upgrading only the Agent
custody directory does not make a mixed-version client-store writer safe.

Start app boot with `health()`. For a `dev`-mode app, follow it with
`ensureApp({ schema, functions, seed, routes })`. Ensure is idempotent: it
provisions only missing/mismatched artifacts and seeds only empty tables.

For sessions artifacts, configure `adminToken` and select the privileged
request explicitly:

```js fragment reason="generated manifests and seed are app inputs"
await client.ensureApp({
  intent: 'provision',
  requestedMode: 'sessions',
  schema,
  functions,
  seed,
  routes,
});
```

The client sends that variant through its admin transport. Missing credentials
are an authorization error; matching hashes do not bypass the gate. A fresh
mode transition requires the server restart named by its staged-mode response.
The explicit variant validates and installs `routes` against the same candidate
schema/functions pair. On a cross-mode provision the routes stay staged with
that pair and become active only after the required restart; same-mode
sessions provisioning installs them in the same coordinated operation. Never
reset as a mount side effect.

### Versioned seed lifecycle is capability-gated

A generated `seed.artifact.json` uses the predecessor-unknown v1 family:
`ensureVersionedSeed`, `previewVersionedSeed`,
`resetInstallVersionedSeed`, and `clearVersionedSeed`. Each method first reads
the target capability manifest and refuses
`SNAPBACK_CLIENT_SEED_PROTOCOL_UNSUPPORTED` when the matching
`versioned_seed_install_v1` or `versioned_seed_reset_v1` assertion is absent.
It never retries through legacy `ensureApp({seed})`, `reset(seed)`, or
`seed(seed)`.

The predecessor-backed executable local gate is complete, so local and remote
SQLite targets advertise those ids with `experimental` maturity while LLP 0109
remains in Review. Artifacts must acknowledge that maturity; hosted
compiled-seed custody remains a GAP. Preview is AdminWrite + NonProd even
though it is read-only; reset-install and clear reuse the ordinary coordinated
app reset and require an exact `{state:"absent"}` or
`{state:"present",value:<UUIDv7>}` predecessor stream.

## Call ordinary functions

`query(ref, { args, userId, readSet })`,
`mutate(ref, { args, userId, readSet, ... })`, and
`action(ref, { args, userId, readSet })` accept a generated function reference
or name. In sessions mode the server accepts no caller-selected identity—the
coordinator repeats the session bearer and the server resolves authority.

**Always nest function arguments under the `args` key.** Fields beside `args`
are call options such as `userId`, `readSet`, or `connectionId`; putting a
function argument at that outer level does not pass it to the function. The
client's compiled reference-type fixture uses the same shape for ordinary and
live calls:

<!-- since: 0.1.18 -->

```ts source=packages/snapback-client/exact-reference-types.fixture.ts fragment="generated query, mutation, and live-query call shapes"
client.query(listTodos, { args: { owner: 'ada' } }).then((output) => {
  output.rows[0]?.title.toUpperCase();
});
client.mutate(createTodo, { args: { title: 'ship it' } }).then((output) => {
  // @ts-expect-error mutate outcomes must be narrowed before settled fields are read.
  output.result;
  if (output.status === 'settled') {
    output.result.toUpperCase();
  } else {
    output.clientMutationId.toUpperCase();
    output.sequence.toFixed();
    const presentation: 'installed' | 'withheld' | 'unavailable' = output.presentation;
    void presentation;
  }
});
client.liveQuery(listTodos, {
  connectionId: 'fixture',
  args: { owner: 'ada' },
  onUpdate(rows) {
    rows?.[0]?.title.toUpperCase();
  },
});
```

`mutate()` resolves `MutationDispatchOutcome<Result>`. The settled branch is
the existing raw `MutationOutput` with `status: 'settled'` added, so fields
such as `result`, `version`, and `receipt` remain at top level after narrowing.
The queued branch appears only when the foreground attempt is relinquished and
the durable record remains replayable; it carries `status: 'queued'`, the
durable id and sequence, and a point-in-time `presentation`. For a generated
`local-executable` mutation affecting an active generated live query, the
ordinary path derives and installs the operation from owner IR, so this is
normally `installed`; incomplete reads or `server-only` IR remain inspectable
in `handle.optimisticPresentation.queuedOnly` with no fabricated row effect.
Automatic table-write projection currently requires owner-proved
table-complete query coverage; filtered or limited membership attaches a
pending-only view and reports the same `queuedOnly` state rather than guessing.
A plan that writes the query table but reads another table is withheld with
`SNAPBACK_OPTIMISTIC_CROSS_TABLE_REPLAY_UNPROVEN`; this version does not skip
earlier cross-table writes and then project against an invalid store. It is pending settlement, not
success and not an error. Narrow on `status`; the former `queued: true`
compatibility alias was removed after its deprecation window.

`liveQuery()` exposes projected `rows`, canonical `authoritativeRows`, and an
`optimisticPresentation` discriminator (`none | predicted |
pending-without-prediction`). Durable generated operations reconstruct the
same provisional presentation after restart and rebase in local sequence order
over later canonical delivery. Durable records restored from prior processes
sort before current-process layers; durable and ephemeral calls made in the
same process share their invocation order. While projected rows are visible,
`answerClass` is `optimistic` even when the canonical base's `freshness`
remains `current`; pending intent with no safe row prediction reports
`pending-without-prediction`, including through pause and reconnect republishes.
`authoritativeRows` and `authoritativeAnswerClass` expose that canonical fact.
Prediction never becomes authority.

A settled bridge retires only after a non-retained authoritative delivery both
reaches its settlement version and completely reflects its writes. Logical-ID
mapping must match every mint's site and occurrence exactly; missing,
duplicate, or colliding mappings fail closed. An unrelated later delivery does
not retire the bridge. A single-table handle requires reflection of every
write to its observed table; successful settlement and the complete logical-ID
map cover writes to unobserved tables. Canonical ID mappings also rewrite exact
string leaves in reference values while surviving layers rebase. Authorization
delete, denial, quarantine, and error
boundaries close the automatic view synchronously so a pending read-free
insert cannot repaint protected rows.

Observe the durable identity separately with
`mutationStatus(clientMutationId)` or
`subscribeMutation(clientMutationId, listener)`. The disposition union is
`pending | settled | failed | stranded | quarantined | resultGone | unknown`.
The subscription delivers the current disposition asynchronously and then
transitions; reads and subscriptions do not consume retained settlement or
change ACK eligibility. `unknown` means there is no durable record and licenses
no settlement inference. Only `markMutationSettlementsConsumed()` owns the
existing consumption cut.

`outboxStatus()` adds `oldestPendingAtMs`, `drainMode`
(`auto | manual | none`), `drainPhase`
(`idle | waiting-barrier | replaying | backoff | paused`), `lastAttemptAtMs`,
`nextRetryAtMs`, and a payload-free `blockedReason` beside the existing
disposition counts and `replaying` fact. A qualified durable outbox starts one
automatic controller after client readiness and owns it through `close()`.
It scans restored work, establishes a fresh resync/readiness barrier before
replay, honors writer and captured-custody fences, retries transient failures
on capped backoff, and wakes on store, connectivity, writer, and authority
transitions. Set constructor policy `outboxDrain: 'manual'` when the host owns
scheduling; `false` is rejected so the policy stays aligned with React's
`auto | manual` vocabulary. Manual mode remains observable through
`client.outboxDrainPolicy`, `outboxStatus().drainMode`, and diagnostics, while
`replayQueuedMutations()`/`controller.drainNow()` retain every safety gate.
`startOutboxDrain()` remains the advanced compatibility entry and joins the
single store controller rather than creating a competing replay owner. For
clients sharing the same store object, the earliest active automatic
participant owns transport; if none is automatic, the earliest active manual
participant owns it. `close()` stops that engine before ownership transfers to
the next participant, which establishes a fresh barrier. Separate handles for
one durable domain still serialize replay through the store writer lock.

Generated references carry their closed operation argument schema. The client
validates it before network I/O for query, mutation, action, live subscribe,
and authorized-lease calls; missing, extra, nested-type, and unsafe-integer
arguments fail with `SNAPBACK_ARGUMENT_VALIDATION_FAILED`. This is an early
client diagnostic, not a replacement for server validation. A legacy string
name has no generated schema and retains its untyped behavior.

A reference generated from a complete sessions artifact pair also carries the
exact schema/function generation. The client sends it on every call family and
the server compares it atomically with function selection. A deploy between
artifact discovery and dispatch returns HTTP 409
`SNAPBACK_ARTIFACT_IDENTITY_MISMATCH` with
`details.subcause: "generation"`; refetch generated artifacts before retrying.
Successful sessions responses expose the server-derived pair at
`facts.activeGeneration`. String names and older references carry no assertion
and remain unchecked for compatibility.

`search(ref, ...)` and `vectorSearch(ref, ...)` are the retrieval calls over
generated search-plan references; their argument grammar, cursors, and
digest facts are owned by
[text search](../backend/text-search.md) and
[vector search](../backend/vector-search.md).

Mutation responses carry `result`, `changed_count`, `version`, and a
terminal receipt. The client records receipts before returning or rethrowing;
read them with `receipts()` or subscribe with `onReceipt(listener)`.

For the exact HTTP 409 `SNAPBACK_AUTH_RESERVATION_STALE` refusal whose closed
details say `retryable: true`, `retryStrategy: "short-jitter"`, and
`effectCommitted: false`, `mutate()` retries the unchanged complete operation
within its bounded client budget. Construction options
`reservationRetryMaxAttempts` and
`reservationRetryJitterMilliseconds: [minimum, maximum]` configure that
budget. `reservationRetryDiagnostics()` and
`onReservationRetryDiagnostic` expose structured scheduled, settled, and
exhausted attempt evidence. No other status or ambiguous/committed outcome is
automatically retried. The retry episode is pinned to the first attempt's
authority/carrier generation: an overlapping logout, user switch, or bearer
replacement fails with `SNAPBACK_CLIENT_AUTHORITY_STALE` and never replays the
old arguments as the successor.

Asset-bearing generated **commands** need no React provider:
`createCommandClient(client)` (the root also exports the
`SnapbackCommandClient` class) is the LLP 0180 command owner over a bare
`SnapbackClient`, and `commandClient.start(app.commands.<name>, inputs)`
returns the same phased command task documented in
[application surfaces](./surfaces.md#run-a-command-and-read-its-truthful-outcome).
`useSnapbackCommand` and `provider.surface(...)` compose this same owner
rather than a second one.

Command inputs are flat: ordinary arguments stay at the top level and the
descriptor-owned media field receives the supported asset source. Do not wrap
them in `{ args: ... }`, which is the low-level ordinary mutation wire shape.
Both authoring profiles generate the same command descriptor and input type;
the profile difference ends before this client call.

<!-- since: 0.1.21 -->

## Generated reference kinds and legal verbs

Generated function references are nominally distinct `QueryRef`,
`LiveQueryRef`, `MutationRef`, and `ActionRef` values. Generated command
descriptors are `CommandRef` values with the runtime discriminator
`asset-bearing-command.v1`. The current legal surface is closed:

| Reference kind | Legal headless verb | Meaning |
| --- | --- | --- |
| `QueryRef` | `query()` or `liveQuery()` | One authoritative read, or the existing live-subscription compatibility path. |
| `LiveQueryRef` | `query()` or `liveQuery()` | One-shot read or authoritative snapshot followed by updates. |
| `MutationRef` | `mutate()` | Dispatch; a queued result is pending, not settled. |
| `ActionRef` | `action()` | One online action response. |
| `CommandRef` | `commandClient.start()` | One process-local command task over its ordinary mutation and optional asset transfer. |

TypeScript rejects cross-kind calls. JavaScript, stale generated modules, and
other skewed callers receive
`SNAPBACK_CLIENT_REFERENCE_KIND_MISMATCH` before auth discovery, store
preparation, command-task creation, or transport. Its structured details name
`receivedKind`, the verb's `acceptedKinds`, the received kind's `correctVerb`,
and this guide anchor. Legacy string names remain untyped compatibility input
because they carry no kind discriminator. Structured diagnostics are always
available through `diagnosticsChannel()`; the default console projection is
attached only under a positive development/HMR signal.

Codegen writes `client-lifecycle.v1.json` beside the other generated
artifacts. It is currently a developer-tooling, regenerable-cache artifact:
no rollout-1 runtime consumer requires a committed copy. The artifact and
generated JSDoc come from the same lifecycle table and bind every operation's
semantic id, implementation and contract hashes, auth requirement, required
capabilities, legal verbs, freshness, retention, and guide anchor to the
generated build.

Mutation dispatch and settlement remain separate. Durable dispositions are
exactly `pending | settled | failed | stranded | quarantined | resultGone |
unknown`; do not infer another state from promise completion. Live handles use
connection states `connecting | live | polling | stale | disconnected` and
stop publishing after disposal. Command tasks progress through `preparing |
transferring | committing` and terminate as `succeeded | failed | cancelled |
ambiguous`.

Resource keys combine reference semantic identity, canonical argument
contract and bytes, authority partition, normalized lifecycle options, and
build identity. A later class-M handle may expose `snapshotVersion`; when it
does, that value means the authorized principal/query `viewRevision`, never a
raw row version, app commit, or storage snapshot. Rollout 1 does not add that
handle or any new client verb.

## Subscribe to durable state

`liveQuery(ref, options)` is the author-facing composite. It performs the
snapshot-with-subscribe operation and returns a handle with `rows`,
`version`, `connection`, `poll()`, `dispose()`, and `settled()`:

```js source=demos/todo/tests/acceptance/headless.mjs
    const handle = await db.liveQuery(api.listTodos, { connectionId: 'client_a', userId: ADA });
    assertEqual(handle.rows.length, 3, 'snapshot rows');
```

On a qualified Node-file or browser IndexedDB store, mounting a generated
public-exact `LiveQuery` automatically requests durable retention. Codegen and
the host derive that class from `auth: 'public'` plus the closed single-table
plan; application `authorityIndependent`, `retainable`, and `persistResume`
options are not required. A fresh client can then expose proof-verified rows as
`freshness: 'retained'` while the server is unreachable. Opaque handlers,
unproved or protected queries, and memory storage retain their existing
explicit/refusal behavior. Expo is not included in this carrier claim. Use
`registerQuery(..., { retentionRequest: 'durable' })` only when background
demand must outlive every mounted handle.

**Transport default:** omitting `transport` selects manual polling. The handle
updates only when the caller invokes `poll()`; it does not become push-driven
because an `onUpdate` callback is present. Use `transport: 'stream'` for managed
WebSocket push; the manager multiplexes
all durable and ephemeral consumers sharing a `connectionId`. Consume
`onUpdate`, `onConnectionChange`, subscription events, and authorization
callbacks instead of reading socket internals. Always dispose the handle.
High-level handle retirement is idempotent across ordinary disposal, repeated
disposal, logout, and terminal authority loss. If the server confirms that
this handle's exact subscription generation is already absent, lifecycle
cleanup returns the typed
`SNAPBACK_LIVE_SUBSCRIPTION_ALREADY_RETIRED` outcome and does not send another
server effect. The same local-only outcome applies after this query's own
terminal authorization deletion, whose exact server subscription and fence
have already been retired. The low-level public `unsubscribeLive` method remains strict:
foreign ids and ownership/session mismatches are errors, not idempotent
success. `dispose()` performs local teardown synchronously and its returned
task is the sole server-side-retirement await for the handle. Typed ownership,
session, and network failures surface through that task. UI unmount code may
safely ignore it; acceptance and operations code should await it when those
failures matter. `settled()` separately drains the fresh-subscribe tail, pause
release, and best-effort cleanup tail. It does not await disposal; after calling
`dispose()`, await that returned task—not `settled()`—to confirm server-side
retirement.

`subscriptionId` is a read-only view of the handle's internally owned
generation, so application code cannot substitute a foreign id into the
idempotent path.

On the first actual `poll()` cycle of each manual-poll handle, the client dev
channel emits `SNAPBACK_CLIENT_LIVE_QUERY_MANUAL_POLL`. It names
`transport: 'stream'` so an accidental slow path is visible without changing
the conservative default. Explicit polling remains valid for headless owners
that deliberately control every drain; inspect the structured event through
`client.diagnosticsChannel()`.

The managed stream sends application ping frames every five seconds and forces
reconnect only after its 15-second freshness budget is missed. A quiet socket
is not stale merely because no data rows changed. Mobile hosts map observable
lifecycle to `await handle.pause()` and `await handle.resume()`: pause releases
demand and quiesces transport; resume obtains a fresh subscription snapshot.
Do this once in the provider/framework binding, not in every view. See
[framework bindings](./framework-bindings.md).

The lower-level `subscribeLive` / `unsubscribeLive`, `openLiveStream`,
`liveStreamManager`, and drain methods exist for adapters and acceptance
harnesses. App UI code normally uses `liveQuery`.

Generated live references pin that same generation for the subscription
lifetime. A sessions deployment sends `resync_required` with reason
`SNAPBACK_ARTIFACT_IDENTITY_MISMATCH`; the managed handle fresh-subscribes with
its pinned reference and remains refused until the caller installs/refetches
the successor artifacts and establishes from that reference. If the successor
removed the function, the fresh attempt reports `SNAPBACK_UNKNOWN_FUNCTION`
instead.

## Project live state into a framework-neutral external store

Import `createExternalQueryStore`, `createExternalQueryStoreRegistry`,
`externalStoreIdentity`, `ExternalQueryScope`, and
`SNAPBACK_EXTERNAL_STORE_PROTOCOL` from `@expo/snapback-client/external-store` when
building a framework or generated UI adapter.

The registry owns logical stores above physical `liveQuery` handles. Its key is
the exact protocol token plus canonical provider/query/authority/args identity.
Same-key sibling consumers share one upstream attempt, updates, errors, and
connection state; each `subscribe` cleanup remains independent, and the last
listener disposes the handle. Different keys remain isolated. Late handles and
stale-generation deliveries are fenced and inspected rather than republished.

`ExternalQueryScope` groups independently keyed stores behind one replaceable
Vanilla view generation. Renewing a scope disposes every predecessor binding;
closing it is terminal and idempotent. Prefer it over an app-authored
generation counter. React apps should normally consume the thin
[`@expo/snapback-react` adapter](./react.md), which projects the same store through
`useSyncExternalStore`.

When a generated route group needs one-commit boot, call
`binding.prepareQueryGroup(groupRef, params)` before mount. That helper is a
strict projection over the headless client's existing register-mode
`fetchBundle` owner: it validates the closed response and keeps rows,
registrations, resume receipts, namespaces, authorization projections, the
connection handle, and grant in private client custody. Two route shapes receive a
generated register reference: all-`LiveQuery` routes (format 1) and format-2
`mixed-route.v2` routes mixing `Query` and `LiveQuery` children, whose
register-mode `fetchBundle` request additionally binds
`formatVersion: 2`, `profile: 'mixed-route.v2'`, and the generated
`planHash`. In both shapes `$param` targets must be strings and search-plan
children are excluded; the broader read-bundle route grammar still
supports server-decoded numeric and boolean parameters. The provider publishes
registered rows only after the stream returns a positive server readiness
witness. Only absence of the target-owned `registered_bundle_boot_v1`
capability can produce an author-enabled `fallbackToLive` result. It has
`boot: null` and is an ordinary live group, not a degraded single-commit claim;
all bundle request failures refuse. A frame racing a still-lazy child marks
that registration dirty and requires a fresh superseding subscription before
the child can publish.

Providers must declare `externalStoreProtocol: "snapback.external-store.v1"`.
If a resolved handle also declares a protocol, an incompatible token publishes
`SNAPBACK_EXTERNAL_STORE_INCOMPATIBLE` and disposes that handle. The external
store is lifecycle/state ownership, not a second transport
or cache: generated Snapback refs and `SnapbackClient.liveQuery` still own the
actual query.

For the connection manager, authority-settlement, inspection, and teardown
sequence around this registry, use the
[provider lifecycle recipe](../recipes/provider-lifecycle.md). In particular,
do not mint a fresh `connectionId` per cell or query.

## Subscribe to ephemeral state

`subscribeEphemeral(ref, { connectionId, scope, ... })` returns an overlay
whose `currentEntries()`, `onChange`, `publish`, `delete`, and
`dispose` methods implement the snapshot/delta/expiry contract.
The `connectionId` argument is a readable, client-local label used to share a
grant and socket. It is not wire identity. `overlay.grantedConnectionId` is
the exact opaque id used by the successful subscribe and therefore the key of
this overlay's connection-owned entry. Those strings may happen to match when
the local server adopts an unclaimed suggestion, but collision or mint-only
containment makes them diverge. Low-level adapters that construct raw frames
must obtain `(await client.connectionGrant(label)).id`; never put the readable
label in a `connection_id` wire field.
`publishEphemeral`, `deleteEphemeral`, and `unsubscribeEphemeral` are the
lower-level transport operations. See the
[presence recipe](../recipes/presence-cursors.md) for the paved feature and
[ephemeral-state reference](../realtime/ephemeral-state.md) for the complete
declaration, overlay, and recovery contract.

Framework adapters that must own a complete room lifecycle use
`startEphemeralRoom(admittedDefinition, scope)`. Its handle owns subscribe,
grant refresh, overlay, reconnect/resync, and cleanup, and exposes
`started()`, idempotent `dispose()`, bounded `settled()`, the granted identity,
and level-triggered snapshots. Ordinary React code should use
[`useSnapbackPresence`](./react.md) instead. `localResourceInspection(ids)` is
an acceptance-only finite-count view of local managers, grants, lane
consumers, socket demand, timers, and listeners; it is not application state
or an authorization API.

## Enter and leave session authority

Protected writes can be intentionally suspended while this authority owner
retires a predecessor and proves a successor. The
[auth-transition write recipe](../recipes/auth-transition-writes.md) separates
queueable background intent from fenced foreground gestures and gives the
required handling for `SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED`.

The session entry points are:

- `authRequestCode(email)` and `authExchange({ challengeId, code })`;
- `authRefresh()` and `authLogout()`;
- `authSession({ force })` for the exact server/mode/authority projection;
- `close()` to terminally drain the client's outbox, auth, and realtime
  ownership (`closeAuth()` remains a compatibility alias):
  it unregisters the transport participant, aborts active controllers, closes
  raw/managed live streams (including a forgotten live handle), releases local
  connection-grant and lane demand, and releases a store resolved by the
  default persistence ladder. The operation is idempotent and awaitable; an
  injected `rqsStore` remains caller-owned;
- `currentAuthorityDescriptor()` and `currentAuthorizationScope()` for
  adapter fences and the blessed **who I am** / **am I signed in**
  identity read — after boot or restore, call
  `await client.currentAuthorizationScope()` and read
  `principalScope.userId` ([Ask who I am](../auth/sessions-and-principals.md#ask-who-i-am-am-i-signed-in)).
  `authSession()` remains the mode/authority projection, not that identity
  read. `AuthCoordinator.settledView()` is the coordinator's lower-level
  equivalent, not the app whoami;
- `registerAuthBarrierParticipant(participant)` for a state owner that must
  quiesce, blank, durably clear/quarantine, and resume with the coordinator.

`authLogout()` returns `null` only for an exact empty 204. The logout request
keeps ownership of that response while its own live terminal event blanks the
captured predecessor; a peer-installed successor is preserved and makes the
call stale instead of being reported as logout success. Non-transient custody
diagnostics remain exact.

`setBearerToken` deliberately refuses a synchronous bearer change: it cannot
hide predecessor rows, release durable demand, and close old grants before
returning. An external-bearer client instead uses
`await replaceBearerToken(nextBearer)`. That async custody transition pauses
and unsubscribes every protected live handle, blanks predecessor rows, closes
old transports and grants, installs the successor, then fresh-subscribes the
handles. Passing `null` clears custody and leaves them blank/paused (parked:
the next non-null transition fresh-subscribes them). A successor the server
denies settles the transition rather than rejecting it: the denial becomes
the handle's frozen `authorizationDenial` fact and an `authorization_denied`
`onUpdate` delivery, the handle stays parked for the next transition, and
only genuine lifecycle breakage (transport loss, broken callbacks) rejects
with an `AggregateError`. Prefer
`createExternalSessionClient` for construction so the exact auth offers cannot
be forgotten. Neither method bypasses an `AuthCoordinator`.
`captureAuthority` / `authorityCaptureFor` are adapter-level stale-work
fences. `authorizedLeaseQuery` is the only lease-renewal query path;
`acknowledgeAuthorizationInvalidation` closes the live authorization barrier.

Contract resume and ephemeral reconnect generations fail closed if their
safe-integer identity space is exhausted. The affected boundary or room is
blanked and permanently detached with
`SNAPBACK_CONTRACT_LIFECYCLE_GENERATION_EXHAUSTED`; dispose remains safe and
idempotent, but recovery requires constructing a new client process/surface
rather than retrying the terminal instance.

### Keep auth commit participants synchronous and non-reentrant

<!-- diagnostic-primary: SNAPBACK_CLIENT_AUTH_COMMIT_REENTRANT -->

`SNAPBACK_CLIENT_AUTH_COMMIT_REENTRANT` means an auth-barrier participant called
back into the same authority owner while its commit callback was running.
Participant callbacks must finish synchronously: blank, clear, or publish only
their own already-prepared state there. Move client/auth/provider work outside
the callback, await the original authority transition, and then start a fresh
operation against its settled authority. This client rule is identical for
Explicit and Familiar generated references.

If an ordinary provider or hook surfaces the code without an author-owned
`compareAndCommit` callback, preserve the diagnostic and authority-transition
evidence as a product defect. Do not weaken protected rows or replace the
failed path with public reads; recreating the affected client owner is bounded
containment, not proof that the underlying reentrancy is repaired.

## Complete public method inventory

This is the complete `SnapbackClient` public surface; methods are grouped by
intent so source additions cannot hide as “advanced” APIs:

| Area | Methods |
| --- | --- |
| Construction/static helpers | `constructor`, `createExternalSessionClient`, `AgentAuthorityFence`, `SnapbackClient.auth`, `SnapbackClient.roomPermission`, `SnapbackClient.mintBundleBootKey` |
| Discovery | `health`, `inspect` |
| App/admin lifecycle | `ensureApp`, `loadSchema`, `loadFunctions`, `ensureEphemeralCollections`, `reset`, `seed`, `cronTick`, `ensureVersionedSeed`, `previewVersionedSeed`, `resetInstallVersionedSeed`, `clearVersionedSeed` |
| Function calls | `query`, `search`, `vectorSearch`, `authorizedLeaseQuery`, `mutate`, `run`, `action`, `acknowledgeMutations` |
| Route bundles | `fetchBundle` |
| Durable live | `liveQuery`, `startLiveQuery`, `subscribeLive`, `unsubscribeLive`, `openLiveStream`, `liveStreamManager`, `acknowledgeAuthorizationInvalidation` |
| Offline queue and settlement | `outboxStatus`, `subscribeOutbox`, `outboxDiagnostics` (getter), `startOutboxDrain`, `replayQueuedMutations`, `mutationStatus`, `subscribeMutation`, `acknowledgeResultGoneMutations`, `adoptQueuedMutations`, `settledMutations`, `markMutationSettlementsConsumed` |
| Offline quarantine and stranded intents | `quarantinedMutations`, `reenterQuarantinedMutations`, `strandedMutations`, `discardStrandedMutations`, `reRecordStrandedMutation` |
| Local store runtime | `storePolicyInspection`, `registerQuery`, `evaluateLocalResultTransform`, `releaseQueryRegistration` |
| Optimistic mutation view | `createOptimisticMutationView` |
| Ephemeral | `subscribeEphemeral`, `startEphemeralRoom`, `publishEphemeral`, `deleteEphemeral`, `unsubscribeEphemeral`, `registerEphemeralRepublisher` |
| Connections/drains | `connectionGrant`, `refreshConnectionGrant`, `disconnect`, `releaseConnection`, `drainEnvelopes`, `drainConnection`, `drainUpdates`, `registerDurableConsumer`, `registerEphemeralConsumer` |
| Framework bindings | `prepareReactBinding` |
| Acceptance inspection | `localResourceInspection` |
| Receipts and retry evidence | `recordReceipt`, `receipts`, `onReceipt`, `reservationRetryDiagnostics` |
| Session/auth | `authSession`, `authRequestCode`, `authExchange`, `authRefresh`, `authLogout`, `close`, `closeAuth`, `setBearerToken`, `replaceBearerToken`, `replaceAgentCredential`, `clearAuthSession`, `currentAuthorityDescriptor`, `currentAuthorizationScope`, `authTerminalStatus`, `subscribeAuthTerminal`, `registerAuthBarrierParticipant` |
| Auth adapter/coordinator seam | `captureAuthority`, `authorityCaptureFor`, `isAuthorityCaptureCurrent`, `allocateLiveQueryNamespace`, `registerAuthMaterialization`, `commitAuthorityPublication`, `commitSenderSocketNonce`, `handleTerminalAuthLoss`, `liveStreamProtocolsFor` |

`run` is the primary one-shot action verb: it unwraps success to the plain
typed result and rejects application/protocol refusals with
`SnapbackDiagnosticError` — the same public error class `query` and `mutate`
throw, caught with the exported `isSnapbackDiagnosticError` guard. `action`
keeps returning the raw `{ ok, ... }` envelope for one compatibility release
and emits a one-shot development deprecation pointing at `run`. Queued
dispatch is not an exception: it stays a resolved `{ status: 'queued' }`
union.

The quarantine/stranded family projects the durable offline queue's terminal
custody states: `quarantinedMutations()` lists payload-free tombstones for
server-replay refusals, `reenterQuarantinedMutations()` moves the whole
quarantine back to pending after successor artifacts load,
`strandedMutations()` lists the rerecordable intents owned by the current
re-attested principal, `discardStrandedMutations(ids)` deletes selected ones,
and `reRecordStrandedMutation(id, options)` re-records one under a fresh
queued identity — semantics in
[offline retention](../sync/offline-and-retention.md#replay-and-settle-without-guessing).
The local store runtime methods load the LLP 0166 full-profile store module
on demand: `registerQuery`/`releaseQueryRegistration`
[record and release a durable local-store query registration without a live handle](../sync/offline-and-retention.md#keep-a-generated-query-registered-without-a-live-handle),
`evaluateLocalResultTransform`
[evaluates a generated result-transform plan over proof-verified retained rows](../sync/offline-and-retention.md#evaluate-an-owner-reclassified-retained-result),
and `storePolicyInspection` is the value-free retention/policy inspection for
one authority partition. `createOptimisticMutationView` remains the explicit
compatibility rebase view for hosts that genuinely own a separate
authoritative-row composition. The ordinary generated `liveQuery()` path
creates its materialization-scoped view automatically. For the generated-insert
typed provisional-identity wrapper, logical-mint mapping, and ambiguous-retry
composition, follow the
[optimistic-create recipe](../recipes/optimistic-create.md).

Members whose names start with `__` (for example
`__registerExternalBearerHandle`) are internal composition seams between the
client and its own arms, not API, and are deliberately excluded. The overlay
returned by `subscribeEphemeral` and the live handle returned by
`liveQuery` are separate owned objects with their own methods and disposal
lifecycle; they are not additional client methods.

## Anti-patterns

- **Do not hand-wire fetch calls to app-data routes.** Use this arm so
  authority, diagnostics, receipts, and connection grants stay consistent.
- **Do not use admin lifecycle methods from ordinary UI events.** Provision
  idempotently at boot; reserve reset/tick/load primitives for dev/ops/tests.
- **Do not treat `openLiveStream` as the ordinary subscription API.** Use
  `liveQuery({ transport: 'stream' })` unless writing an adapter.
- **Do not treat the readable connection label as the granted wire id.** Use
  the overlay/grant authority fact for connection-owned keys and raw frames.
- **Do not reuse a connection id across unrelated custody/lifecycle owners.**
- **Do not forget `dispose()` / `close()`.** Handles, overlays,
  coordinator participants, and default-resolved persistence stores own
  resources.

---

<!-- snapback-guide-source: guide/clients/app-cli.md -->
---
title: The artifact-driven app CLI
id: clients.app-cli
order: 2
audience: agent-first
capabilities: [clients.app-cli]
authorities: [llp/0062-generated-app-cli-and-code-mode.rfc.md, llp/0146-agentic-authoring-affordances.rfc.md, llp/0150-agent-token-acquisition.rfc.md, llp/0204-app-external-surfaces.rfc.md, packages/snapback-app-cli/index.mjs, packages/snapback-app-cli/cli.mjs, packages/snapback-app-cli/oauth.mjs, packages/snapback-app-cli/digest.mjs, packages/snapback-app-cli/agent-digest.schema.json, packages/snapback-app-cli/auth.mjs, packages/snapback-app-cli/code-mode.mjs, packages/snapback-app-cli/code-mode-ibex.mjs, packages/snapback-app-cli/schema-interpreter.mjs, packages/snapback-app-cli/ibex-bundle.mjs, packages/snapback-app-cli/result-core.mjs, packages/snapback-client/app-data.mjs, scripts/build-app-bound-executable]
examples: [packages/snapback-app-cli/package.test.mjs, packages/snapback-app-cli/auth.test.mjs, packages/snapback-app-cli/code-mode.test.mjs, packages/snapback-app-cli/code-mode-ibex.test.mjs, packages/snapback-app-cli/schema-interpreter.test.mjs, packages/snapback-app-cli/ibex-bundle.test.mjs, packages/snapback-app-cli/cli.test.mjs, packages/snapback-app-cli/digest.test.mjs, demos/todo/snapback/generated]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:81f4c4ce553e40209fd74b935585cd0a515e72808971f218a178f62cc1f0aa34
---

# The artifact-driven app CLI

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

`@expo/snapback-app-cli` gives a Snapback application an agent-facing terminal
surface without executing application source. It reads generated artifacts or
the server-composed API envelope as inert data, validates the current target
descriptor, and exposes the generic `snapback-app` command. Calls carry the
five-part generated identity so a deploy between discovery and dispatch
refuses rather than running against different code.

The local phase-1 engine is shipped. Phase 2 has an app-bound Ibex builder,
embedded coordinator, and literal executable proof on qualified macOS arm64
and Linux x86_64 GLIBC 2.35 tuples. Its host-portable lifecycle and acceptance
matrix is complete on both, including signal-first grace, exact frame
admission, strict settlement, resource classification, deterministic cleanup,
value-free audits, static Linux Fetch/WebSocket networking, and a
producer-free clean-consumer proof. The capability remains partial because
hosted targets do not advertise it and public inspection still lacks the
dynamic observations described below.

## Discover the app surface

Use generated artifacts against a development target:

```sh
snapback-app --artifacts demos/todo/snapback/generated introspect
```

Or omit `--artifacts` against a sessions target that serves
`/app-api/current` and content-addressed `/app-api/envelope/{sha256}`. The
engine re-verifies JCS bytes, member digests, content address, app identity,
and projection correspondence itself before the surface can shape a call. The
bounded cache serves offline `introspect` and `types`; it never authorizes an
offline call.

The local loader joins `artifacts.json`, `functions.manifest.json`, and present
operation argument schemas, requires one `appId`, and reports every stable id,
name, kind, auth requirement, and schema. A mismatch refuses with
`SNAPBACK_APP_CLI_ARTIFACT_IDENTITY_MISMATCH`; an unknown function reports the
available manifest names. Discovery never imports `api.mjs`, a handler bundle,
or server-provided JavaScript.

## Pull a bounded agent digest

`introspect` emits `snapback.agent-digest.v1`: a stable, value-free document
with a static section keyed by `envelopeHash` and a dynamic section keyed by
the returned `digestCursor`. Pass that cursor back on the next call:

```sh
snapback-app --server http://127.0.0.1:3000 --artifacts ./snapback/generated introspect --budget-bytes 32768 --budget-items 256
snapback-app --server http://127.0.0.1:3000 --artifacts ./snapback/generated introspect --changed-since 'sbad1.…'
```

The static section contains artifact identities, table summaries, operation
signatures and contracts, and capability gaps in key order. Its cursor carries
the prior item hashes, so one changed schema item can produce one changed
item without retained server state. A bare envelope hash remains accepted:
when it matches, the static delta is empty and the dynamic section is still
sent whole.

The dynamic v0 is deliberately coarse. It always re-emits its complete
available observation section and reports
`coarse-resolution-v0-no-observation-retention`; cursors minted by v0 do not
expire and Snapback retains no prior observation manifest. Unknown or
structurally expired cursors return a named full-digest degradation, never an
empty success. Budgets apply to canonical JSON bytes and item count. Every
omission carries an elision marker naming the section, omitted count, and the
flags to increase.

This projection never includes row values, call arguments, result payloads,
credential material, or raw diagnostic messages/details. The public app-data
inspection surface does not currently expose per-table row counts or D1
conformance observations, so those dynamic items carry explicit unavailable
reasons. Local artifacts use a deterministic
`local-generated-static-projection` identity when there is no served API
envelope; that is not represented as a served-envelope claim.

## Choose authority explicitly

Anonymous is always the default, even if session or agent material exists in
the environment. Select a lane deliberately:

```sh
snapback-app --server http://127.0.0.1:3000 --artifacts ./snapback/generated --principal dev --dev-user user_123 call listNotes
snapback-app --server http://127.0.0.1:3000 --principal session --session-bearer-file /absolute/private/session call listNotes
snapback-app --server http://127.0.0.1:3000 --principal agent --agent-profile /absolute/private/agent-profile.json call listNotes
```

`--principal auto` is opt-in inventory, not precedence: no source means
anonymous, exactly one source is selected, and multiple sources refuse. A live
malformed or stale source is terminal and never falls back. `whoami` and
`introspect` report the source, never secret material.

The dev lane adds the caller-selected user id to the legacy dev request body;
a sessions-mode server refuses it. Human sessions adopt a bearer supplied by a
trusted external broker through the non-custodial LLP 0096 client seam: the CLI
does not persist or refresh it. Session files and agent profiles are bounded,
owner-owned, single-link mode-0600 files below non-writable real ancestors.
Credentialed commands require POSIX ownership/mode semantics.

The only client-side authorization predictions are target capability and
anonymous-to-`authenticated`. Every role, grant scope, optional-user rule, and
application refusal remains server-authoritative.

<!-- since: 0.1.16 -->

## Log in through the external OAuth facade

For first contact, pass only the app URL. With no verb, the CLI fetches the
served envelope and prints the app id, envelope digest, exposed function count,
available verbs, and the login command:

```sh
snapback-app https://example.snapback.app
```

`login` discovers the app's authorization server, dynamically registers one
public client, and runs authorization code with PKCE S256. It always prints the
authorize URL; open that URL in a browser where the app user is already signed
in. The consent page is the approval surface.

```sh
snapback-app --server http://127.0.0.1:3000 login
```

The first login selects an ephemeral `127.0.0.1` callback port and caches that
exact redirect with the DCR `client_id`. Later logins reuse the registration and
try to bind the same port. `--no-browser`, or a port that cannot be rebound,
uses the same printed authorize URL and asks you to paste the returned callback
URL or short-lived code:

```sh
snapback-app --server http://127.0.0.1:3000 login --no-browser
```

The scope default is deterministic. The CLI chooses the first advertised
bundle named `read` or ending in a read segment (for example `items.read`),
then the first bundle whose declared functions are all queries/live queries,
then the first advertised bundle. Override it with comma-separated bundle
names:

```sh
snapback-app --server http://127.0.0.1:3000 login --scopes items.read,calendar.read
```

The target-keyed directory under `~/.snapback/app-cli/oauth/` is mode 0700.
`oauth-public-client.json` caches the non-secret public registration and
`oauth-bearer-token.json` honestly stores the bearer; both are mode 0600. The
CLI prints the bearer file path and absolute expiry, never the token. Facade
tokens expire after 15 minutes and have no refresh token, so repeat `login`
after expiry. If discovery is absent, enable `api.oauth.enabled` with the
explicit `api.oauth.bearer: true` weakening, or use the native `pair` path.

## Pair and invoke an agent safely

Provision the durable `sbac_` credential outside the repository, then supply a
pairing challenge on stdin or in a private file. It is never an argv or
environment value:

```sh
snapback-app --server http://127.0.0.1:3000 --artifacts ./snapback/generated pair --request request_123 --pairing-code-file /absolute/private/code --credential-file /absolute/private/agent-credential --profile-out /absolute/private/agent-profile.json --scopes-json '[{"tier":"query"}]'
```

Agent credentials are restricted to literal loopback origins and a loopback
socket peer; redirects are terminal. The profile persists only the durable
authority tuple and a credential reference. Each invocation acquires a
cross-process slot from the target-advertised token cap, mints a short-TTL
token, re-attests the complete actor/effective/credential-generation/grant
tuple, and releases the exact token on settlement. A long-running subscription
renews from the server-relative lifetime, cuts and resubscribes through the
client authority fence, then releases the predecessor. Release retries once;
TTL is the crash-safe backstop. Pairing releases its first poll token
immediately.

## Call a function

`call` accepts a stable id or exported name and validates JSON arguments before
dispatch:

```sh
snapback-app --server http://127.0.0.1:3000 --artifacts ./snapback/generated --args-json '{"page":2}' call listNotes
```

Non-TTY single results are JSON. The semantic core is the Rust-owned shared
app-data result envelope; server diagnostic codes and attribution survive
without free-text details. The frozen exits are 0 success, 2 usage, 3 auth, 4
not found, 5 function error, 6 transport, 7 artifact identity, 8 version
admission, 9 timeout, 10 script error, and 11 resource ceiling.

`call` on a live query returns its authoritative current snapshot. Use
`subscribe` when later changes matter. The default prints the current snapshot,
waits for the first JCS-distinct change, prints it, and exits; `--watch` emits
deduplicated JSONL until a signal or timeout:

```sh
snapback-app --server http://127.0.0.1:3000 --artifacts ./snapback/generated --args-json '{"team":"red"}' subscribe activeGames
snapback-app --server http://127.0.0.1:3000 --artifacts ./snapback/generated --watch subscribe activeGames
```

## Run a local TypeScript analysis

`run` evaluates one local `.ts`/`.js` file, or `-` for stdin. The
credential-owning parent performs every app call; the child receives a frozen
`api`, `snapback.function(stableId)`, `args`, `signal`, console/timers, and no
bearer, target URL, inherited environment, filesystem helper, or fetch global:

```sh
snapback-app --server http://127.0.0.1:3000 --artifacts ./snapback/generated run analysis.ts -- customer_123
snapback-app --server http://127.0.0.1:3000 --artifacts ./snapback/generated types --out .snapback-types
```

The output directory receives `api.d.ts` for the descriptor surface and a
merged `code-mode.d.ts` for the injected code-mode globals and callable app
bindings.

The language profile is a single erasable-TypeScript module with top-level
await. Runtime imports, dynamic imports, `import.meta`, enums, namespaces, and
parameter properties refuse. The awaited default export is the only stdout
value and must satisfy the strict JSON profile. Calls cross a versioned,
bounded broker with per-call and whole-run timeouts; stderr audit records carry
function ids, safe codes, attribution, and counters but no intermediate
values. Valid hazardous names such as `then` lose their property alias and
remain callable only through `snapback.function(id)`.

The Node child-process split is a credential non-transmission contract, not a
hostile-code sandbox. A Node `vm` escape has the invoking OS user's authority;
run only scripts trusted at that level. The app-bound Ibex checkpoint keeps the
same broker shape while running the admitted script in a separate restricted
Hermes runtime with no ambient filesystem, network, environment, subprocess,
clock/randomness, import, or dynamic-code authority.

## Build the experimental app-bound executable

Release producers can build from an app-bound Ibex release kit and pin the
app's normalized HTTPS origin, app id, engine compatibility identity,
publisher key identity, and reproducible recipe digest:

```sh
scripts/build-app-bound-executable --ibex /opt/ibex-app-release/ibex --origin https://example.snapback.app --app-id example --engine-compatibility sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA --publisher-key-id release-key-1 --recipe-digest sha256-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA --output ./example
```

The builder inspects the result and refuses unless its Stub V4 contract reports
the requested binding. Qualified outputs are literal single files with no Node,
npm tree, Hermes framework, shared library, catalog, or policy sidecar beside
them. Their command shape is:

```sh
./example introspect
./example call createTodo --args-json '{"text":"Buy milk"}'
./example run analysis.ts
```

`--server`, `--app`, and `--artifacts` are unavailable in this mode: the
executable admits only its embedded app identity. The current API envelope is
dynamic data fetched from that origin, so ordinary function and schema deploys
do not alter the fixed binding. Rebuilds are intended only for that binding,
the trusted engine/runtime, policy/protocol, platform, or release provenance;
the comprehensive §7 disclosure, ceiling, lifecycle, race, dependency, and
relocation matrix is green on qualified macOS arm64 and Linux x86_64 GLIBC
2.35. Unsupported producer tuples refuse instead of emitting a wrapper or
sidecar approximation. Qualification establishes the producer and executable
contract; it does not by itself create or promise a public download channel.

## Run the packaged agent journey

`runPackagedAgentJourney(...)` remains the library acceptance seam:

1. discover the generated function manifest;
2. present a user-minted pairing code and exact requested scopes;
3. mint a scoped token after approval;
4. put that token in `AgentAuthorityFence` and verify the service-principal
   handshake;
5. invoke a mutation;
6. establish a connection grant and live subscription;
7. query to verify the committed state;
8. release the exact scoped carrier.

The returned result includes redacted grant/scope facts and operation results,
never credential or token plaintext. Use the lower-level `pairAgent`,
`mintAgentToken`, `invokeAppFunction`, and `subscribeAppFunction` exports when a
coordinator owns the approval pause or needs multiple calls. Two further
library exports round out that seam: `loadAppArtifacts(directory)` loads and
identity-validates a generated artifact directory into the inert surface the
other calls consume, and `startAppFunctionLive(client, artifacts, name,
options)` opens a **managed** live-query handle over a declared live query
through `client.startLiveQuery` (where `subscribeAppFunction` performs the
one-shot low-level subscribe). For agent auth
semantics and durable daemon custody, read
[Agent principals](../auth/agent-principals.md).

## Anti-patterns

- Do not import generated `api.mjs` merely to discover functions.
- Do not guess a checkout or artifact directory.
- Do not pass admin credentials to the app CLI.
- Do not return a scoped bearer in JSON, logs, or diagnostic details.
- Do not pass a pairing code on argv or persist a scoped token in an agent
  profile.
- Do not infer agent safety from a hostname; the phase-1 lane requires a
  literal loopback origin and peer.
- Do not infer a public release channel from producer qualification; publish
  an app-bound executable only through a release process that preserves its
  binding and provenance.
- Do not describe the Node package as the app-bound one-file executable; they
  remain distinct products with different trust and distribution postures.

---

<!-- snapback-guide-source: guide/clients/react.md -->
---
title: The React client
id: clients.react
order: 2
audience: agent-first
capabilities: [clients.react, clients.dev-diagnostics]
authorities: [llp/0012-headless-integration-contract.spec.md, llp/0059-session-projection-and-client-barrier.spec.md, llp/0064-native-client-surfaces.rfc.md, llp/0090-resumable-query-snapshots.rfc.md, llp/0095-client-lifecycle-and-conformance.spec.md, llp/0108-inline-handlers-and-result-contracts.spec.md, llp/0114-first-class-react-and-query-groups.spec.md, llp/0107-react-presence-and-optimistic-lifecycle.spec.md, llp/0112-generated-query-group-bundle-adoption.spec.md, llp/0133-local-settlement.spec.md, llp/0144-declared-app-refusal-codes.rfc.md, llp/0145-client-bundle-architecture.research.md, llp/0155-local-sync-product-direction.rfc.md, llp/0157-composition-algebra-and-completeness.spec.md, llp/0218-outbox-settlement-contract.rfc.md, llp/0219-client-dev-diagnostics-channel.rfc.md, llp/0238-explicit-client-lifecycles.rfc.md, llp/0247-ordinary-client-normalization-and-recovery.rfc.md, llp/0258-first-party-application-auth-bootstrap.rfc.md, llp/0270-local-first-client-defaults.rfc.md, llp/0277-coterie-clique-run-observations.research.md, packages/snapback-client/app-client.mjs, packages/snapback-client/canonical-client-value.mjs, packages/snapback-client/index.d.mts, packages/snapback-client/reference-kinds.mjs, packages/snapback-client/react-binding.mjs, packages/snapback-contract/result-contract-validator.mjs, packages/snapback-react/auth-bootstrap.test.mjs, packages/snapback-react/auth-blocked-resource.test.mjs, packages/snapback-react/optional-user-auth-transition.test.mjs, packages/snapback-react/core.mjs, packages/snapback-react/full-capabilities.mjs, packages/snapback-react/implementation.mjs, packages/snapback-react/index.mjs, packages/snapback-react/index.d.mts, packages/snapback-react/generated-optimistic-default.test.mjs, packages/snapback-react/exact-result-types.fixture.ts, packages/snapback-react/optimistic-create-types.fixture.ts, packages/snapback-codegen/client-lifecycle.mjs, packages/snapback-codegen/client-lifecycle.test.mjs, packages/snapback-client/client-diagnostics.mjs]
examples: [packages/snapback-cli/templates/react, demos/chirp, demos/signal-desk/src/backends/snapback.ts, demos/signal-desk/tests/react.mjs, demos/signal-desk/acceptance/results/react-presence.v1.json, demos/messaging-snapback/src/lib/useTyping.ts, demos/_kit/tests/provider-live-conformance.mjs, packages/snapback-react/binding-development-sync.test.mjs, packages/snapback-react/package.test.mjs, packages/snapback-react/optimistic.test.mjs, packages/snapback-react/optimistic-create.test.mjs, packages/snapback-react/presence.test.mjs, packages/snapback-react/offline.test.mjs, packages/snapback-react/exact-result-types.fixture.ts, packages/snapback-react/optimistic-create-types.fixture.ts, packages/snapback-react/skip-sentinel-types.fixture.ts, packages/snapback-react/dev-diagnostics.test.mjs, packages/snapback-react/dev-diagnostics-acceptance.test.mjs]
status: current
targets: [local]
maturity: shipped
authoring-profiles: []
reviewed: 2026-08-28
reviewed-authorities-digest: sha256:0bf525eefc1725690714e40e0774d30a0419725bf3f18807c70314edc840dc59
---

# The React client

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

`@expo/snapback-react` supplies a prepared provider, exact generated-reference
inference, shared single and grouped live queries, optimistic mutations,
managed presence, and connection state through React's `useSyncExternalStore`
contract. The provider owns canonical query and room identity, Strict Mode
replay, late-handle disposal, auth custody blanking, expiry/heartbeat work, and
cleanup. Components do not open live handles in `useEffect`, add a second
query cache, or manage presence intervals.

<!-- since: 0.1.23 -->
## Add first-party application auth

> **Node multi-persona harnesses need explicit partitions.** Repeating
> `createSnapbackAppClient` does not create a new custody context when both
> calls select the implicit default `storagePartition`; personas can share one
> login. Use the [multi-persona client recipe](../recipes/multi-persona-clients.md)
> and assign one stable partition per actor/worker.

When the generated app declares an application auth bootstrap, use
`createSnapbackAppClient`, pass that owner to `<SnapbackProvider
appClient={...}>`, and read `useSnapbackCurrentPrincipal()` plus
`useSnapbackAuth()`. The complete runnable journey — generated admission,
anonymous `ready`, password signup/sign-in, one-time recovery custody, reload,
sign-out, and user switch — lives on
[Email and password](../auth/passwords.md#sign-up-then-sign-in).

Do not add an application `AuthCoordinator`, bearer setter, or parallel user
cache on that path. The prepared-binding/provider form below remains the
advanced composition seam for a shell that deliberately owns its client; the
[browser auth recipe](../recipes/browser-auth.md) documents the external-broker
case.

## Prepare a provider for advanced composition

Prepare the connected deployment before rendering, then construct the
provider from that immutable binding:

```ts fragment reason="application composition varies by renderer and generated artifact imports"
const binding = await client.prepareReactBinding({
  generatedManifest: app,
  developmentSync: {
    onStateChange(state) {
      setBootState(state);
    },
  },
});
const provider = createSnapbackReactProvider(binding);

root.render(
  <SnapbackProvider provider={provider}>
    <App />
  </SnapbackProvider>,
);
```

When something breaks behind these hooks, open the
[admin console](../operating/admin-console.md) before writing another probe:
`snapback admin --ready-file .snapback/dev.ready.json` opens the shipped
browser debugger for Data, Functions, Realtime, Errors, and Logs against the
same running backend — check it before falling back to `curl`, raw host
operations, or a one-off verification script.

Use the generated `snapback.app.v1` descriptor exported as `app` by
`generated/api.mjs`; it carries the same complete references components pass
to hooks, including ephemeral collections. Preparation verifies app,
deployment, auth-mode, schema, function-catalog, result contracts, ephemeral
declarations, and capability identity. The provider borrows the client;
`provider.dispose()` drains provider-owned
subscriptions, rooms, stores, listeners, timers, connection grant, socket
demand, and its auth-barrier participant.

The provider also owns the host **app-lifecycle seam**: `await
provider.pause()` releases demand and quiesces every provider-owned
subscription and room, and `await provider.resume()` re-establishes them.
The pair rides the same registry operations as the auth barrier with an
independent reason bit, so a host resume cannot race an authority
transition. Bind host lifecycle once at the provider boundary — the Expo
shell drives exactly these two methods from `AppState`
([React Expo](./react-expo.md)); see
[framework bindings](./framework-bindings.md) for the transition table.
Components never pause individual hooks.

Preparation also works process-cold offline: a successful online
preparation persists a digest-bound **binding receipt** into the client's
persisted RQS store, and when a later prepare's inspect/session fetch fails
by connectivity (server unreachable — never a server-answered refusal), the
same admission re-runs against the persisted identity for a byte-identical
generated manifest. The binding names its provenance as
`binding.source: 'deployment' | 'persisted-receipt'`, so an offline cold
boot reaches a provider that renders retained rows (see
[offline retention](../sync/offline-and-retention.md)). A drifted generated
manifest never adopts the receipt.

Whether that receipt is actually on disk for the next boot depends on the
persisted store carrier:

| Carrier | Receipt persisted by online preparation | Offline cold boot reaches `source: 'persisted-receipt'` | Witness |
| --- | --- | --- | --- |
| Browser IndexedDB + Web Locks (browser default) | Yes — the commit defers until this tab's writer election settles (before 2026-08-06 a boot-time election race silently dropped it) | Yes | `packages/snapback-react/cold-boot-binding-indexeddb.test.mjs` (Node simulation: fake IndexedDB plus a Web Locks double); the real-Chrome repro in `demos/warble` remains a manual witness |
| Expo / registered file store | Yes — the file arm settles writer election before its writer check | Yes, proven for a fresh client in the same process; a physical-device process-kill witness is still open (`issues/20260806-expo-file-carrier-process-kill-witness.md`) | `demos/relay-room-bakeoff/snapback-expo/tests/offline-acceptance.mjs` |
| Memory fallback | In-memory only — nothing survives the process | No — a process-cold boot has neither receipt nor rows | `packages/snapback-react/cold-boot-binding.test.mjs` (two sessions over one memory store in one process) |

A tab that is not the elected writer defers its receipt commit until it is
elected (the freshest `savedAt` wins at flush time); a terminally refused
commit warns `SNAPBACK_REACT_BINDING_RECEIPT_NOT_PERSISTED` instead of
dropping the receipt silently.

During an ordinary local edit/restart cycle, Metro or Vite may load generated
artifacts one backend generation ahead. After a live inspection proves both
the exact local-dev target and `dev` auth mode, preparation automatically
retries complete admission for up to 10 seconds and reports
`developmentSync` state as `waiting | ready | timed-out`. Render
`state.message` as the root product copy (`Updating local backend…` while
waiting). If it times out, keep `state.diagnostic` and `state.actions` behind
developer details; the rejected Error's primary message is human-facing while
its stable code remains `SNAPBACK_REACT_BINDING_MISMATCH`.

Retries never construct a provider early and never use the offline receipt:
only a later live inspection that admits the complete generated manifest can
finish the loop. A brief connectivity gap during that already-proved local
window remains recoverable. Hosted, sessions, unknown, and server-refusal
contexts stay immediate and loud. Set `developmentSync: false` when a local
tool or test deliberately needs the original immediate mismatch behavior;
otherwise the bounded retry is automatic even when no callback is supplied.

The same dev loop has a post-mount sibling: Metro or Vite HMR can hot-replace
the generated api module while the mounted `SnapbackProvider` keeps the
binding admitted from the previous generation. In a positively identified
development environment (Metro's `__DEV__`, a bundler HMR host, or
`NODE_ENV === 'development'` — never mere absence of production markers), a
regenerated same-app reference presented to hooks becomes a provider-boundary
invalidation instead of a crash: the provider re-proves the whole new
generation against the live deployment and swaps admission atomically.
Unchanged queries keep their data throughout; changed queries show a brief
`pending` frame, then subscribe under the new contract; a mutation invoked
during the window settles after the swap. If the rebind cannot complete
(backend never serves the new generation, or routes/ephemeral declarations
changed), the provider logs one `SNAPBACK_REACT_HMR_REBIND_FAILED` diagnostic
and triggers a controlled dev reload (`developmentHmr.onReloadRequired`
overrides the default `DevSettings.reload`/`location.reload`). Foreign or
stale references and production builds keep the strict
`SNAPBACK_REACT_REFERENCE_INVALID` throw — recovery never weakens admission.
Regression witness: `packages/snapback-react/hmr-generation-handoff.test.mjs`;
governing design: LLP 0114 (mounted-provider HMR generation handoff).

<!-- since: 0.1.19 -->

## Keep query-only application bundles narrow

The package root is the Full compatibility composition: it includes generated
application surfaces, synchronous command tasks, and asset hooks even when a
particular component imports only the provider and query hook. If an
application does not use those capability families, select the static core
entry at every React import site:

```ts fragment reason="application imports and generated references vary by project"
import {
  SnapbackProvider,
  createSnapbackReactProvider,
  useSnapbackMutation,
  useSnapbackOptimisticCreate,
  useSnapbackQuery,
} from '@expo/snapback-react/core';
```

This is a packaging selection, not another React state owner. The core
provider uses the same prepared binding, query/group registry, optimistic
layers, presence rooms, outbox state, auth barrier, and cleanup protocol as
the root. It deliberately does not export `useSurface`, command hooks,
imperative commands, asset hooks, or `SnapbackAssetImage`, and its provider
does not have `surface`, `assets`, or command-task inspection members.
`useSnapbackOptimisticCreate` is part of core because it projects the existing
provider-owned query/outbox state rather than selecting the command/asset
capability.

Keep importing from `@expo/snapback-react` when the application uses an
[application surface](./surfaces.md), command task, or asset projection. Those
APIs remain synchronous and unchanged on the root; the core entry does not
replace them with lazy proxies.

<!-- since: 0.1.21 -->

## Pass each hook the reference kind it owns

`useSnapbackQuery` accepts a generated `LiveQueryRef`; `useSnapbackMutation`
and `useSnapbackSettledMutation` accept a generated `MutationRef`; and
`useSnapbackCommand` accepts a generated `CommandRef`. The nominal brands make
cross-kind TypeScript calls fail even when two operations happen to have the
same argument and result shape. The generated reference JSDoc lists the legal
headless verbs and React hooks, auth requirement, required capabilities,
freshness and retention meaning, semantic identity, and the build-bound guide
anchor.

`useSnapbackQuery` remains the current exported live-query hook name. The
clearer `useSnapbackLiveQuery` spelling is only a planned compatibility alias:
rollout 1 does not emit it. The current name has no removal date; removal can
be considered only in a declared major version after stage-2 usage
measurement. No one-shot `QueryRef` hook and no future watch, mutation-handle,
or action-handle hook ships in this rollout.

For imperative calls below a hook, the headless client enforces the same
matrix before transport and reports
`SNAPBACK_CLIENT_REFERENCE_KIND_MISMATCH`; see
[generated reference kinds and legal verbs](./headless.md#generated-reference-kinds-and-legal-verbs).

## Bind a generated query

Pass a generated operation reference and its exact arguments. The reference
supplies both argument and result types, so there is no result generic to fill
in or override:

```ts source=packages/snapback-react/exact-result-types.fixture.ts
const query = useSnapbackQuery(todos, { owner: 'ada' });
if (query.status === 'ready' || query.status === 'refreshing') {
  query.data[0]?.title.toUpperCase();
}
```

The generated [`QueryState` fact type](../reference/expo-snapback-react.md#symbol-querystate-8e4feba927)
is the declaration-exact contract and carries the same stable identity
returned by `snapback guide QueryState`.

`useSnapbackQuery` returns:

- `status`: `pending | ready | refreshing | error | skipped | blocked` — a
  protected read is `blocked` with `reason: "authentication-required"` while
  signed out and `reason: "authentication-not-settled"` while signing in or
  signing out. Both states carry `transitionOwner: "auth-coordinator"`; they
  never oscillate or retry. A later settled sign-in rebuilds a fresh instance
  across the authority barrier. Revocation and successor-establishment failure
  project `status: "error"` with the same `transitionOwner` (also present in
  `error.details`) and the terminal or `SNAPBACK_AUTH_TRANSITION_FAILED` code;
- `data`: immutable result rows only for `ready` or `refreshing`, otherwise
  `undefined`;
- `connection`: `idle | connecting | live | polling | stale | disconnected |
  closed | error`;
- `error`: a structured diagnostic for `error`, otherwise `null`;
- `freshness`: `unknown | retained | current` — `retained` rows came from
  the persisted cache (an offline cold boot) and are never presented as
  settled: a retained frame keeps `status: 'refreshing'` even on a live
  connection until the authoritative answer makes it `current`. A fourth
  value, `'snapshot'`, is emitted only by the read-only children of a
  mixed-route query group (paired with `status: 'ready'` and
  `connection: 'idle'` — see [Read a query group](#read-a-query-group));
  switch on all four when rendering freshness exhaustively;
- `retention`: the headless handle's refuse-with-clarity retainability fact
  (`{ retainable, code, reason, store }`, `null` until classified) — see
  [offline retention](../sync/offline-and-retention.md). On a qualified
  IndexedDB or Node-file store, a mounted owner-admitted public-exact query
  requests durable retention by default; protected and unproved queries keep
  their existing explicit/refusal behavior.

Same-reference, same-argument siblings under one provider share one store and
one upstream subscription while retaining independent React consumers.
Different provider objects, complete generated references, canonical
arguments, or authority identities do not share it. Keep the provider mounted
across signin and logout: its LLP 0059 participant blanks the predecessor
synchronously and starts a fresh protected query under the settled successor.
An application key/remount is neither required nor desirable; remounting only
recreates ownership the provider already coordinates.

When one screen composes several reads plus mutations, commands, or
presence, prefer the generated **application surface** — `useSurface` on
[application surfaces](./surfaces.md) — over hand-wiring a stack of
`useSnapbackQuery` calls (its
[first anti-pattern](./surfaces.md#anti-patterns) is exactly that
composition). The low-level hook remains right for reads outside a surface's
closed grammar; both share the same canonical stores.

> **Coming from Convex/Supabase?** Convex's `useQuery` is automatically
> reactive client-side; Snapback separates the live-query declaration
> (backend) from the subscribing hook (client) — see
> [Protected live CRUD, end to end](../recipes/coming-from-convex-and-supabase.md#protected-live-crud)
> for the complete slice, including the server-side auth scoping `useQuery`
> alone doesn't give you, and
> [Reactive queries: useQuery vs. declare-then-subscribe](../recipes/coming-from-convex-and-supabase.md#reactive-queries)
> for a code-shape comparison plus a real dual-backend app running the same
> app against both.

## Read a query group

When the group is also a declared route bundle, use its generated reference.
Prepare it before mount so the LLP 0090 register-mode owner takes every
initial snapshot and creates every live registration at one commit:

```ts fragment reason="route and parameter names come from the generated application API"
const workspaceGroup = await binding.prepareQueryGroup(
  groups['/workspace/:incidentId'],
  { incidentId },
  { fallbackToLive: true },
);
const provider = createSnapbackReactProvider(binding, {
  preparedGroup: workspaceGroup,
});

// Inside the provider:
const workspace = useSnapbackQueries(workspaceGroup);
```

The generated reference closes the child refs, argument mappings, string route
parameters, app, and definition digest. The prepared group is opaque: its
`$param` mappings target string args only; numeric/boolean parameter routes
remain available through ordinary read bundles but do not receive a registered
group reference. Literal numeric/boolean args are fine. The prepared group's
public entries contain safe generated identity, never rows, subscription ids,
resume receipts, authorization projections, namespaces, grants, or a
connection handle, and the private transferred owner is not reachable through
provider properties. The provider publishes registered rows only after
positive server-confirmed socket attach. On a successful registered boot,
`workspace.boot` records the one initial
`{commitVersion, generation, versionStream, attachDeadline}` and each canonical
child store adopts its registration without an ordinary prime/subscribe race.
That field is initial provenance only; later child deltas are independently
live.

A generated format-2 `mixed-route.v2` group may include both `LiveQuery` and
ordinary `Query` children. The hook shape stays the same, with two additional
provenance facts: each result reports `bootDelivery` as `registered-live` or
`read-only`, and `workspace.boot` reports `profile`, `weakest`,
`liveChildren`, and `readOnlyChildren`. Live children adopt their bundle
registrations normally. A read-only child is a static snapshot store with
`freshness: "snapshot"` and `connection: "idle"`; it does not prime or start
a live query later. The group's aggregate connection is the weakest honest
state (`idle`) even while its live siblings individually report `live`.

Fallback is intentionally narrow. Only a target whose served capability
manifest lacks experimental `registered_bundle_boot_v1` can produce
`source: "live-fallback"` when the author set `fallbackToLive: true`.
Authentication, authorization, integrity, limit, timeout, and malformed
bundle failures still refuse. If a valid registered preparation reaches its
attach deadline before provider adoption, the provider reports
`source: "live-recovery"`, `reason: "attach-deadline-expired"`, and
`boot: null`; it discards the expired rows and opens ordinary fresh live
subscriptions.

A lazy child is also fail-closed: if its registered subscription receives a
delta before that child store adopts it, the provider reports
`source: "live-recovery"`, `reason: "unadopted-delta"`, and `boot: null`.
First demand opens a fresh subscription that supersedes the dirty registration
instead of exposing the older bundle rows.

For view-local group membership that is not a route bundle, pass the existing
typed object map directly:

```ts fragment reason="view-local group membership is application-specific"
const filters = useSnapbackQueries({
  incidents: { ref: api.listIncidents, args: {} },
  tasks: { ref: api.tasksForIncident, args: { incidentId } },
  comments: { ref: api.commentsForIncident, args: showComments ? {} : skip },
});
```

Groups contain 1–64 entries. Each non-skipped child counts as one consumer and
one live subscription unless it shares an existing canonical store. Changing
one entry preserves unrelated entry snapshots. Validation and cap admission
are transactional: a refused update leaves the previous group attached.
If the group is really one screen's resource composition, declare it as an
[application surface](./surfaces.md) instead of growing a hand-maintained
entry map. `observeSnapbackQueries(provider, entries, listener)` is this
hook's framework-neutral twin for acceptance adapters.

## Run a mutation

<!-- since: 0.1.18 -->

The default `useSnapbackMutation` function resolves a discriminated union.
The settled branch wraps the generated, LLP 0101-validated result as
`{ status: 'settled', result }`; the queued branch reports
`{ status: 'queued', clientMutationId, sequence, presentation }`. Queueing is
the foreground relinquishment cut: accepted intent is durable and replayable,
but it is still pending settlement. Narrow before reading either branch:

The React facade resolves a truthful union. A settled dispatch returns
`{ status: 'settled', result }`; accepted durable intent returns
`{ status: 'queued', clientMutationId, sequence, presentation }`. The queued
branch means **pending settlement**, not server refusal, and never carries an
`appCode`. Keep pending UI in that branch. Roll back only when the server
returned a declared application refusal carrying an `appCode`:

```ts fragment reason="mutation names, pending-state shape, and refusal copy come from the application"
try {
  const outcome = await saveTask(input);
  if (outcome.status === 'queued') {
    keepPendingTask(input.intentKey, outcome.clientMutationId);
    return;
  }
  clearPendingTask(input.intentKey, outcome.result);
} catch (error) {
  const appCode = (error as { diagnostic?: { details?: { appCode?: unknown } } })
    .diagnostic?.details?.appCode;
  if (typeof appCode === 'string') {
    rollbackPendingTask(input.intentKey);
    showDeclaredRefusal(appCode);
    return;
  }
});
const createRequired = useSnapbackMutation(createTodo, { queue: false });
createRequired({ title: 'connectivity required' }).then((id) => id.toUpperCase());
const createSettled = useSnapbackSettledMutation(createTodo);
createSettled({ title: 'settled convenience' }).then((id) => id.toUpperCase());
```

For generated `local-executable` mutations, this ordinary hook is also the
default optimistic path. The client derives the affected materialization,
required reads, and operation from generated IR; React (and Expo, which uses
this same provider carrier) paints it immediately, replays durable layers on
restart, and rebases them in local sequence order. Query state exposes
`optimisticPresentation` for `predicted` versus
`pending-without-prediction`. Missing required reads and `server-only` IR stay
pending in `optimisticPresentation.queuedOnly` without inventing a row effect.
The current table-write projector requires owner-proved table-complete query
coverage; filtered or limited membership gets the same inspectable
pending-only state until a compatible query-projection evaluator exists.
Cross-table-dependent plans are withheld with
`SNAPBACK_OPTIMISTIC_CROSS_TABLE_REPLAY_UNPROVEN` rather than replayed against
a store missing earlier writes from another table.

Projected query state is explicitly predictive: `answerClass` is `optimistic`
while the generated layer is visible, even when `freshness: 'current'` still
describes the canonical base. Consumers that need authority inspect
`authoritativeRows` or the headless handle's `authoritativeAnswerClass`, not
the projected `data`. Pending intent without a safe row prediction reports
`answerClass: 'pending-without-prediction'`; both presentation classes survive
pause, stale-socket, resume, and reconnect republishes. Durable records restored
from prior processes precede current-process layers, while durable and ephemeral
calls within one process retain invocation order. Settlement retirement requires
complete reflection of the observed table's writes and exact, non-duplicated
logical-ID mapping for the whole plan; unobserved-table writes rely on that
settlement record rather than an unavailable handle reflection. Canonical ID
mappings rewrite reference-valued string leaves in surviving layers. An unrelated
later snapshot does not retire a layer. Every authorization deletion, denial,
quarantine, or error closes the automatic projection before React can render
protected prediction.

An app-authored `optimistic.update`/`isAuthoritative` pair is an explicit
compatibility escape hatch. When supplied, it owns that call and generated
projection is not installed underneath it:

```ts fragment reason="mutation and query fields come from the generated application API"
const intendedDone = !task.done; // captured from the row this component rendered
const toggleTask = useSnapbackMutation(api.toggleTask, {
  optimistic: {
    query: api.allTasks,
    args: {},
    update: (tasks) =>
      tasks.map((row) => row.id === task.id ? { ...row, done: intendedDone } : row),
    isAuthoritative: (tasks, result) =>
      tasks.some((row) => row.id === result.id && row.done === result.done),
  },
});
```

An app-authored layer is installed only over the provider's already-current
authoritative query store and is validated against the generated result
contract before network work. Overlapping attempts rebase in invocation order.
Any rejected mutation call removes that attempt's built-in optimistic layer
and recomputes over the newest authoritative base. Accepted durable intent is
not a rejection: when `presentation === 'installed'`, the provider retains the
layer and follows the durable mutation disposition until settlement, refusal,
or a custody state retires it; `withheld` and `unavailable` make the absence of
that built-in presentation explicit. An HTTP response validates and settles
the mutation promise, but is not itself live-query authority;
`isAuthoritative`, when present, retires that layer only after a matching
validated live delivery. There are at most 256 pending optimistic layers per
store.

`update` is a **replayable projection**, not an action: it is recomputed over
every newer authoritative base, so capture the intended outcome outside the
reducer and set it (as `intendedDone` above) rather than toggling or
incrementing the incoming row, which re-runs the user action on rebase. For
the full toggle-plus-counter shape — atomic `liked`/`likeCount` projection,
complete-receipt matching across partial deliveries, response/query ordering,
and the one-canonical-store rule when the same record renders on several
query surfaces — use
[the optimistic toggle recipe](../recipes/optimistic-toggle.md).

For the common "set these fields on this row" shape, spread
`projectRecordFields(recordId, fields)` into the optimistic options instead
of hand-writing the pair: it derives an idempotent capture-and-set `update`
and the complete-receipt `isAuthoritative` from one declaration. In
development, hand-written reducers are checked at admission — a reducer
whose result diverges when replayed over its own output logs one
`SNAPBACK_REACT_OPTIMISTIC_REPLAY_DIVERGENT` warning per (mutation, query)
site; production builds skip the check.

## Optimistically create a row the server will name

Use `useSnapbackOptimisticCreate` as the explicit typed-entity compatibility
surface when one locally executable generated `Insert` needs its
canonical/provisional union and `select` boundary. Ordinary
`useSnapbackMutation` already paints that insert in the query store.
The hook returns `{ query, create }`: `query` has the ordinary
`pending | ready | refreshing | error` state axis, while its ready data is a
canonical/provisional entity union. The provider owns the durable optimistic
view, canonical rebases, authority partition, Strict Mode/HMR sharing, and
cleanup.

```ts source=packages/snapback-react/optimistic-create-types.fixture.ts
const calendar = useSnapbackOptimisticCreate(api.reserve, {
  query: api.schedule,
  args: {},
  select: (entities) => entities
    .filter((entity) => entity.fields.slotKey === 'slot-a')
    .sort((left, right) => left.fields.resourceKey.localeCompare(right.fields.resourceKey)),
});
```

`select` is the explicit presentation boundary for filtering, ordering,
counts, and relationships. It receives canonical and provisional entities in
one list, so a provisional row follows the same application projection rather
than living in a parallel pending sidecar. A relationship can close over a
map from another complete query; a count is simply the selected array's
length.

Each entity carries a top-level `kind` discriminant. A canonical branch has a
generated `Id<Table>` and the complete server row. A provisional branch has a
generated `ProvisionalId<Table>` backed by the durable `clientMutationId`, and
its `fields` omit `_id`, `_version`, `_createdAt`, and `_updatedAt`. The
evaluator's speculative row mint is private and cannot leak into application
state:

```ts source=packages/snapback-react/optimistic-create-types.fixture.ts
  for (const entity of calendar.query.data) {
    if (entity.kind === 'canonical') {
      requireCanonicalReservation(entity.identity.id);
      entity.fields._version.toFixed();
    } else {
      const provisional: ProvisionalId<'reservations'> = entity.identity.id;
      provisional.toUpperCase();
      entity.fields.title.toUpperCase();
      // @ts-expect-error provisional intent identity cannot flow as a canonical row id.
      requireCanonicalReservation(provisional);
      // @ts-expect-error server-authored row version is absent on provisional fields.
      entity.fields._version;
    }
  }
```

Call `create` with the generated mutation's exact arguments. The one generated
IR operation drives both local prediction and server authority; do not supply
a second reducer. This insert-shaped path does not run the generic
append-reducer replay advisory.

```ts source=packages/snapback-react/optimistic-create-types.fixture.ts
calendar.create({
  idempotencyKey: 'typed-fixture',
  resourceKey: 'room-00',
  slotKey: 'slot-a',
  ownerId: 'alice',
  title: 'Planning',
  now: 1_787_000_000_000,
}).then((outcome) => {
  if (outcome.status === 'settled') requireCanonicalReservation(outcome.result);
  else outcome.clientMutationId.toUpperCase();
});
```

On a declared rejection, only that mutation's durable layer retires and newer
layers replay. On success, the provisional entity bridges until authoritative
delivery consumes the settlement's logical-mint `idMap`; response-first and
query-first delivery therefore converge without a canonical-plus-provisional
duplicate. If `create` resolves the queued branch
(`{status: 'queued'}` — accepted durable intent, LLP 0218), keep rendering the
provisional entity: durable replay retains the exact `clientMutationId`, and
the provider recovers the retained settlement and `idMap` after replay.

The hook accepts only a generated local-executable mutation containing exactly
one `Insert` into the document query's table. Other shapes refuse with
`SNAPBACK_REACT_OPTIMISTIC_CREATE_INSERT_REQUIRED`; use the ordinary
`useSnapbackMutation` optimistic projection for updates, or the lower-level
`SnapbackClient.createOptimisticMutationView` escape hatch for a composition
that genuinely needs direct headless control. See the complete
[optimistic-create recipe](../recipes/optimistic-create.md).

## Show stable application errors through rollback

When a mutation is rejected for a *domain* reason (a locked card, a taken
seat), do not parse the failure message. A handler that throws a bare
`Error` surfaces as the platform code `SNAPBACK_HANDLER_FAILED`, and its
message text is deliberately not a stable public contract. Declare the
domain codes on the backend instead and throw with `ctx.refuse` — see
[declared application refusals](../backend/mutations.md#consume-the-structured-result).
The rejection then arrives typed: the mutation promise rejects with
`SNAPBACK_APP_REFUSAL` carrying the declared `appCode` and `appDetails` in
its diagnostic details, while the optimistic layer for that attempt — and
only that layer — is removed and every newer layer recomputes over the
authoritative base:

```ts fragment reason="refusal codes and copy come from the application's declared refusals"
import { projectAppRefusal } from '@expo/snapback-client';

try {
  await reserveSlot({ slotKey, resourceId });
} catch (error) {
  const refusal = projectAppRefusal(error);
  if (refusal?.appCode === 'SLOT_TAKEN') {
    showSlotTakenBanner(slotKey); // stable declared code, not message text
  } else {
    throw error;
  }
}
```

The declared code is safe to key product copy on precisely because the host
admits it only when the invoked function declared it; an undeclared or forged
code folds to `SNAPBACK_HANDLER_FAILED` and drops the app payload, so
internal exception text never becomes UI copy by accident.

## Publish and observe ephemeral presence

<!-- diagnostic-primary: SNAPBACK_REACT_PRESENCE_ACTION_CONFLICT -->

`SNAPBACK_REACT_PRESENCE_ACTION_CONFLICT` means one hook tried to own presence
both declaratively and imperatively. Choose exactly one mode: pass a non-skipped
`value` and let the provider publish it, or pass `value: skip` and use the
returned `publish`/`delete` actions. Do not call imperative actions from a
non-skip declarative consumer. Explicit and Familiar collections share this
React lifecycle.

`useSnapbackPresence` is the React hook for generated **ephemeral**
collections — including presence, typing indicators, and cursors. Pass a
generated connection-keyed ephemeral reference. A non-skipped value is
declarative managed intent: the provider publishes it after the authoritative
room snapshot and refreshes it within the generated TTL and rate limits. The
[ephemeral-state reference](../realtime/ephemeral-state.md#stop-publishing-when-activity-goes-idle)
transcludes the messaging demo's conversation-scoped typing hook, including
observer-mode `publish`/`delete`; there is no separate
`useSnapbackEphemeral` hook.

```ts fragment reason="presence fields come from the generated ephemeral declaration"
const presence = useSnapbackPresence(ephemeral.incidentPresence, {
  scope: { incidentId },
  value: {
    userId: persona.id,
    name: persona.name,
    color: persona.color,
    viewing: 'incident',
  },
  ttlMs: 4_000,
});

if (presence.status === 'ready' || presence.status === 'stale') {
  renderViewers(presence.entries);
}
```

Equal provider/reference/scope consumers share one headless room, overlay,
listener, and heartbeat. Their managed values and TTLs must agree. Use
`value: skip` for an observer; only observers may call `publish` and `delete`
imperatively. Managed TTL is 500 ms through the collection's generated
maximum, and scope/value contracts, payload size, sustained rate, burst rate,
and React-local room/consumer/publisher caps refuse before invalid work.

The closed state is `pending | resyncing | ready | stale | error |
unsupported`. Only `ready` is authoritative. `stale` retains same-authority
entries only to their server-stamped monotonic expiry; predecessor authority
entries are blanked. Presence is never persisted, hydrated, or counted as a
durable mutation. This first-class surface is deliberately local-target only;
a hosted binding returns `unsupported` without starting a room or socket.

<!-- since: 0.1.16 -->

## Use inline hook inputs without subscription churn

Content-equal inline objects are safe on this source checkout:
`useSnapbackQuery(ref, { label })` retains its descriptor and committed
subscription across unrelated renders, while a fresh but content-equal
`useSnapbackPresence` scope/value retains its room lease and managed publish
intent. `skip` and development-generation handoff descriptors keep their
existing behavior.

On 0.1.15 and earlier, memoize or hoist **both** query args and presence
scope/value. Do not treat the old identity churn as merely wasteful: combining
fresh query args with a fresh managed presence value can form a
render/resubscribe/publish loop that saturates the browser main thread until
clicks stop landing, with no hook diagnostic identifying the storm.

<!-- since: 0.1.25 -->

The imported `skip` sentinel keeps its type through ordinary `useMemo`
inference, so conditional presence or query options need no explicit return
annotation or generic argument:

```ts source=packages/snapback-react/skip-sentinel-types.fixture.ts
const presenceOptions = useMemo(() => ({
  scope: { conversationId },
  value: observingOnly ? skip : { userHandle: 'ada', name: 'Ada' },
  ttlMs: 4_000,
}), [conversationId, observingOnly]);

// No explicit annotation or generic argument should be needed to preserve the
// sentinel through ordinary React memoization.
useSnapbackPresence(typing, presenceOptions);
```

Library wrappers that accept the same choice can name it as `SkipOr<Value>`;
`SkipSentinel` is the sentinel-only type. Neither type adds a runtime export.

`observeSnapbackPresence(provider, reference, options, listener)` is the
framework-neutral twin (the same pattern as `observeSnapbackOutbox` below).
A component that actively produces an ephemeral value outside managed
presence registers with `useEphemeralRepublisher(reference, callback)` — the
React wrapper over the client's `registerEphemeralRepublisher` that re-asks
the mounted producer for its value after an authority replacement blanks the
room; disposal follows the component lifecycle.

<!-- since: 0.1.19 -->

## Inspect client dev diagnostics

In a positively identified development build, each `useSnapbackQuery` hook
instance warns with `SNAPBACK_REACT_SUBSCRIPTION_CHURN` after eight committed
descriptor-identity transitions inside two seconds. The equivalent presence
producer uses `SNAPBACK_REACT_PRESENCE_PUBLISH_CHURN` for changing scope/value
descriptors. Same-descriptor Strict Mode resubscribe and the query HMR
generation handoff do not count. Fresh content-equal args, scopes, and values
never count: content keying is the correctness fix. If the warning fires,
memoize or hoist the genuinely changing input and verify that its value should
really change. The warning names the generated reference and the call site
captured when that hook instance was created.

`useSnapbackDiagnostics()` returns the bound client's exact frozen channel
snapshot: bounded `events`, separately keyed `activeConditions`, and
`counters`. `observeSnapbackDiagnostics(provider, listener)` is the
framework-neutral twin; it calls the listener immediately, then on channel
changes, and its returned object exposes `snapshot()` and `dispose()`. For a
headless host, read the same object from `client.diagnosticsChannel()`; see
[client-side dev diagnostics](../operating/diagnostics.md#inspect-client-side-dev-diagnostics).

Queued mutations use that same channel. The client emits canonical
`SNAPBACK_OFFLINE_MUTATION_QUEUED`; React also emits
`SNAPBACK_REACT_MUTATION_QUEUED` as a compatibility projection with the same
durable mutation id. The default dev reporter deduplicates the pair into one
canonical console line. If the same durable queue head has not advanced after
30 seconds, `SNAPBACK_REACT_MUTATION_QUEUE_WEDGED` appears as an active
condition and one console line. The client-owned drain runs automatically by
default; the provider configures it while mounted. Use `outboxDrain="manual"`
only when the host deliberately owns the cadence. Request a safety-gated cycle through
`useSnapbackOutbox().drainNow()` (or the headless client's
`replayQueuedMutations()`). Diagnostics only observe that machinery.

## Render connection state honestly

`useSnapbackConnection()` observes the provider-wide weakest connection state
and active-subscription count without creating demand. Render `connecting`,
`live`, `polling`, `stale`, and `disconnected` as distinct facts. Retained data
under `refreshing` is useful but is not proof that the transport is currently
live.

The provider admits at most 256 cached query stores, 1,024 committed query
consumers, and 64 simultaneous server subscriptions. A saturated replacement
can supersede exactly one predecessor only when the updating group uniquely
owns it; shared or multi-entry saturated replacement refuses without changing
the old group.

This is an Online projection. It does not claim local handler execution or
Parity merely because it can retain data while a connection is stale.

## Render offline facts honestly

For the product-shaped retained-conversation/outbox/composer composition, use
the [messaging convergence recipe](../recipes/messaging-convergence.md#keep-a-retained-thread-outbox-and-composer-honest).
It keeps eligibility, freshness, connectivity, queued intent, and composer
readiness as separate facts instead of turning an offline label into authority.

The hooks project the headless client's own offline facts — they surface,
never invent. For a mounted declarative public-exact query, codegen and the
host derive admission; `useSnapbackQuery` requests retention automatically,
without `authorityIndependent`, `retainable`, or `persistResume` application
options. An offline cold boot of an admitted query renders its persisted rows
with `freshness: 'retained'` and `status: 'refreshing'` (never `'ready'`),
holding the `stale` connection axis, and settles to `freshness: 'current'` when
the authoritative answer arrives:

```js source=packages/snapback-react/offline.test.mjs
  await act(async () => {
    handle.seedRetained(RETAINED_ROWS);
    handle.surviveOffline();
    await flush();
  });
  assert.equal(latest.freshness, 'retained');
  assert.equal(latest.status, 'refreshing');
  assert.equal(latest.connection, 'stale');
  assert.equal(latest.retention?.retainable, true);
```

This default is limited to public exact facts on a qualified durable carrier.
Protected queries retain only through their existing explicit lease-backed
path; opaque handlers, unproved plans, and memory storage refuse rather than
rendering stored bytes. Expo does not inherit this carrier claim yet.

For a durable writer store, `SnapbackProvider` configures the client's platform
drain and defaults `outboxDrain="auto"`. It wakes on queued relinquishment, restored
connectivity, provider resume/foreground, writer acquisition, and custody or
authority replacement. Set `outboxDrain="manual"` only when a host owns the
schedule; the safety controller remains installed and `drainNow()` is still
barrier- and custody-gated. `outboxDrainOptions` passes carrier scheduling and
online-event seams to the headless controller. Provider teardown restores the
client's constructor policy; `client.close()` stops the lifecycle. Strict
Mode/HMR share at most one live controller per durable store.

`useSnapbackOutbox()` projects the durable queued-intent state
([`SnapbackOutboxState` exact type](../reference/expo-snapback-react.md#symbol-snapbackoutboxstate-904e9d7007),
LLP 0043 M2). Its complete field list:

- `status`: `loading | ready` — the projection's own read axis;
- `supported`: whether the bound client has a durable queue at all;
- `pending`: queued intents awaiting replay;
- `failed`: intents whose replay terminally failed;
- `stranded`: rerecordable intents parked by a same-principal authority
  replacement, recovered explicitly via the client's stranded family;
- `quarantined`: intents refused by server replay and held as payload-free
  tombstones until successor artifacts re-enter them;
- `resultGone`: intents whose terminal outcome is known (committed or
  refused) but whose result payload expired before it could be read — never
  re-executed, held until the application discards them;
- `depth`: the sum of every visible disposition count;
- `replaying`: whether the single-flight drain is currently running;
- `oldestPendingAtMs`: enqueue time of the oldest pending intent, or `null`;
- `drainPhase`: `idle | waiting-barrier | replaying | backoff | paused`;
- `lastAttemptAtMs` and `nextRetryAtMs`: drain-attempt/backoff timing, or
  `null`;
- `blockedReason`: the payload-free writer, barrier, custody, authority, or
  terminal-disposition reason preventing progress, or `null`.

The handle adds `drainNow()` to request one controller cycle; `replay()` is a
deprecated alias. It also exposes `mutationStatus(clientMutationId)` and the
custody affordances `strandedMutations`, `discardStrandedMutations`,
`reRecordStrandedMutation`, `quarantinedMutations`,
`reenterQuarantinedMutations`, and `acknowledgeResultGoneMutations`. The
package test exercises the projection and recovery surface directly:

```js source=packages/snapback-react/offline.test.mjs
    affordances = {
      mutationStatus: await latest.mutationStatus('m4'),
      stranded: await latest.strandedMutations(),
      reRecorded: await latest.reRecordStrandedMutation('m5'),
      quarantined: await latest.quarantinedMutations(),
      discarded: await latest.discardStrandedMutations(['m5']),
      reentered: await latest.reenterQuarantinedMutations(),
      acknowledged: await latest.acknowledgeResultGoneMutations(['m4']),
    };
```

plus a `drainNow()` action that requests one cycle from the client-owned
drain controller (`replay()` remains a deprecated alias). The controller runs
automatically by default; `outboxDrain="manual"` keeps the controller and
disables only automatic scheduling. The stranded/quarantine semantics and their
recovery methods are on
[offline retention](../sync/offline-and-retention.md#replay-and-settle-without-guessing)
(and its
[migration-quarantine boundary](../sync/offline-and-retention.md#migration-boundaries-quarantine-dont-fail)).
Render a queued-changes badge from it next to
retained rows. The canonical frame remains labeled retained; generated
pending operations reproject only when local-read admission proves their
inputs, and otherwise surface `pending-without-prediction`. A client without the projection seam
refuses with `SNAPBACK_REACT_OUTBOX_UNSUPPORTED` instead of reporting a
false empty queue. `observeSnapbackOutbox(provider, listener)` is the
framework-neutral twin for acceptance adapters.

An app-authored compatibility reducer still requires a **current
authoritative** store: installing it over a retained-only frame refuses with
`SNAPBACK_REACT_OPTIMISTIC_STORE_MISSING`. Generated IR uses the headless
read-admission result instead of weakening that compatibility rule.

The retained Signal Desk receipt at
`demos/signal-desk/acceptance/results/react-presence.v1.json` proves two
independent WebSocket clients, TTL expiry, disconnect deletion, durable-version
separation, optimistic rebase/matcher ordering, SSR zero demand, hosted
no-work refusal, and exact provider/client/server cleanup with zero skips.

## Anti-patterns

- **Do not construct a provider from an unprepared client.** Await
  `prepareReactBinding` before rendering.
- **Do not rebuild live ownership with `useEffect` and `useState`.** That
  reintroduces Strict Mode, sibling-sharing, and teardown races.
- **Do not key by `JSON.stringify(args)` in component code.** Pass args and
  generated references to the hook; the canonical identity contract owns them.
- **Do not add a parallel React query cache.** The external store is the shared
  current-value-plus-subscription seam.
- **Do not call Online local-first or Parity.** Those classes require the
  retained execution/replay proofs in LLP 0012 and LLP 0064.
- **Do not pass string names from components.** Pass generated query and
  mutation references admitted by the prepared binding.
- **Do not add a caller-selected row/result generic around a generated
  reference.** Fix the function's result contract and regenerate the API.
- **Do not treat a mutation HTTP response as live-query authority.** Use the
  subsequent validated live delivery to retire optimistic state.
- **Do not add a component-local delta to a count a live query already
  supplies.** The authoritative increment arrives independently and
  double-counts; project the change optimistically over the query store
  instead ([optimistic toggle recipe](../recipes/optimistic-toggle.md)).
- **Do not toggle or increment inside an optimistic `update`.** The
  projection replays during rebase; capture the intended outcome and set it.
- **Do not forge a provisional row ID to make an optimistic create
  typecheck.** The branded generated ID is the server's to mint; keep the
  provisional item in a pending sidecar under an app-local intent key.
- **Do not parse `SNAPBACK_HANDLER_FAILED` message text for domain
  rejections.** Declare the code in the function's `refusals`, throw with
  `ctx.refuse`, and switch on the structured `appCode`.
- **Do not create presence heartbeat intervals in application code.** Pass
  managed intent to `useSnapbackPresence`; the provider owns admission,
  refresh, disconnect, and teardown.

---

<!-- snapback-guide-source: guide/clients/surfaces.md -->
---
title: Application surfaces
id: clients.surfaces
order: 2
audience: agent-first
capabilities: [clients.surfaces]
authorities: [llp/0179-generated-app-descriptor-and-surfaces.rfc.md, llp/0180-asset-bearing-client-commands.rfc.md, llp/0181-zero-configuration-expo.rfc.md, llp/0114-first-class-react-and-query-groups.spec.md, llp/0176-expo-messaging-golden-path.plan.md, llp/0210-asset-upload-dx-closure.rfc.md, packages/snapback-codegen/define.mjs, packages/snapback-codegen/index.mjs, packages/snapback-client/commands.mjs, packages/snapback-client/react-binding.mjs, packages/snapback-expo/asset-source.mjs, packages/snapback-react/index.mjs, packages/snapback-react/index.d.mts]
examples: [packages/snapback-codegen/app-descriptor.test.mjs, packages/snapback-react/surface.test.mjs, packages/snapback-react/commands.test.mjs, packages/snapback-client/commands.test.mjs, packages/snapback-react/fixtures/conversation/app/snapback/generated/app.descriptor.json, packages/snapback-react/fixtures/conversation/app/snapback/generated/app.d.ts, demos/expo-golden-path-fixture/snapback/functions.mjs, demos/expo-golden-path-fixture/snapback/surface-model.mjs, demos/expo-golden-path-fixture/src/screens/chat-screen.tsx, demos/expo-golden-path-fixture/tests/g2-falsification.mjs, demos/expo-golden-path-fixture/tests/g3-command.mjs]
status: current
targets: [local]
maturity: partial
since: 0.1.11
reviewed: 2026-08-25
reviewed-authorities-digest: sha256:3f24f88bcfb4bd7cf6c24c2b6fe7631c261188320c7c430eaf9978a660573079
---

# Application surfaces

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

An **application surface** is one generated, parameterized composition of the
reads, ordinary mutations, asset-bearing commands, raw asset intents, and
presence lanes that belong to a resource or screen. Declare it on the backend
with `defineSurface`; bind it in React with `useSurface`, or use
`observeSnapbackSurface` and `provider.surface(...)` without React. This is the
vocabulary split to keep in mind: backend searches use **surface declaration**
and `defineSurface`, while client searches use **screen surface**,
`useSurface`, and `observeSnapbackSurface`.

A surface composes existing generated references. It adds no endpoint, cache,
authorization layer, query language, or presence implementation. The low-level
[React hooks](./react.md) remain available and share the same owners.

## Declare one asset-bearing command

Use `defineCommand` for the closed LLP 0180 composition: exactly one ordinary
mutation plus zero or one asset input. The call inputs are derived rather than
declared again. Every mutation argument remains an ordinary command input
except the mapped `mutationArg`, which the asset task supplies after it
finalizes. An optional asset makes text-only and one-image sends branches of
the same typed call.

```js source=demos/expo-golden-path-fixture/snapback/functions.mjs
export const send = defineCommand({
  mutation: sendMessage,
  assets: {
    image: {
      intent: messageImageUpload,
      optional: true,
      mutationArg: 'image',
    },
  },
});
```

The composed mutation is still the sole application-row and asset-attachment
commit. The command adds no server endpoint or transaction, and it does not
change the upload intent's policy or ownership rules.

<!-- since: 0.1.16 -->

### Map required and optional assets safely

Command asset requiredness may narrow the ordinary mutation without changing
the mutation's own callable contract:

| Command child | Mutation argument | Result |
| --- | --- | --- |
| Required (`optional: false`) | Optional `v.assetRef` for the same upload intent | Admitted. The generated command requires the asset and always supplies it; direct mutation callers may still omit the argument. |
| Optional (`optional: true`) | Required `v.assetRef` | Refused. A text-only command branch would invoke the mutation without a required argument. |

The admitted direction is useful for a dedicated `sendPhoto` command over a
shared mutation that also supports a direct text-only call. The generated
command input is required, but the mutation handler must still treat the
argument as optional because other callers retain the wider mutation
contract.

The unsafe inverse refuses at generation with
`SNAPBACK_COMMAND_ASSET_MAPPING_INCOMPATIBLE`. Its diagnostic names both
repairs: **make the command child required**, or **make the mutation argument
optional** with `v.optional(v.assetRef(...))`. Do not weaken a required command
just to match an optional mutation argument; required-child → optional-argument
is the admitted narrowing.

## Declare a surface for one screen

Import `defineSurface`, `bind`, `param`, and `input` from
`@expo/snapback-codegen/define`. The Expo golden-path backend declares its
conversation once and binds `conversationId` through every scoped child:

```js source=demos/expo-golden-path-fixture/snapback/functions.mjs
export const conversation = defineSurface({
  params: { conversationId: v.id('conversations') },
  reads: {
    users: bind(users, {}),
    details: bind(conversationDetails, { conversationId: param('conversationId') }),
    memberships: bind(membershipsForConversation, { conversationId: param('conversationId') }),
    messages: bind(messagesForConversation, { conversationId: param('conversationId') }),
    reactions: bind(reactionsForConversation, { conversationId: param('conversationId') }),
  },
  mutations: {
    // @ref LLP 0176#g2--conversation-surface — keep the generated member at
    // the accepted north-star spelling while the underlying function remains
    // the ordinary addReaction mutation.
    react: bind(addReaction, {
      conversationId: param('conversationId'),
      messageId: input('messageId'),
      userId: input('userId'),
      emoji: input('emoji'),
    }),
    sendText: bind(sendText, {
      conversationId: param('conversationId'),
      senderId: input('senderId'),
      text: input('text'),
    }),
    sendReply: bind(sendReply, {
      conversationId: param('conversationId'),
      senderId: input('senderId'),
      text: input('text'),
      replyToId: input('replyToId'),
    }),
    removeReaction: bind(removeReaction, {
      reactionId: input('reactionId'),
    }),
    sendImage: bind(sendImage, {
      conversationId: param('conversationId'),
      senderId: input('senderId'),
      assetId: input('assetId'),
      caption: input('caption'),
      replyToId: input('replyToId'),
    }),
  },
  commands: {
    // This seeded Relay-shaped test persona binds Ada as the visible app-data
    // sender. Ordinary Sessions authority remains separate and is still
    // independently required by both the upload intent and mutation.
    send: bind(send, {
      conversationId: param('conversationId'),
      senderId: 'user_ada',
      body: input('body'),
      image: input('image'),
      failAfterFinalize: false,
    }),
  },
  assets: {
    image: bind(messageImageUpload, {}),
  },
  presence: {
    typing: bind(typing, {
      scope: { conversationId: param('conversationId') },
    }),
  },
});
```

The declaration has six named fields:

- `params` declares up to eight portable validators. `param('name')`
  substitutes one of those values into a child binding.
- `reads`, `mutations`, `assets`, and `presence` bind locally authored
  generated references. `input('name')` leaves a mutation or asset value for
  the eventual caller.
- `commands` binds an exported `defineCommand` descriptor without treating it
  as a mutation. Its caller supplies only unbound ordinary and asset-source
  inputs.

A binding leaf may be `param(name)`, `input(name)`, or a portable scalar
literal (`null`, string, boolean, or finite number). An object-shaped target
may instead receive one bounded **flat scope record**, such as
`{ scope: { conversationId: param('conversationId') } }`; its values use the
same leaves. It is not a general object-construction escape hatch.

The grammar is deliberately closed: no callbacks, conditionals, loops,
computed fields, inheritance, nested surfaces, or result transforms. Put
composition outside that algebra in application code or extend the subsystem
that owns the missing operation. Binding a resource id selects scope; every
child still performs its own existing authorization.

Surface member names are authored projection names, not rewrites of the
underlying operation. The example deliberately exposes `mutations.react`
while its reference remains the ordinary `addReaction` mutation, giving the
screen its resource-shaped vocabulary without hiding the inspected target.

## Inspect what generation emits

Codegen places every admitted declaration under the generated
`snapback.app.v1` descriptor's `surfaces` node. Each surface records its
parameter contracts and complete `reads`, `mutations`, `commands`, `assets`,
and `presence` maps. Every member records its generated reference, the complete
target-to-`param`/`input`/literal binding map, and an `inputs` map containing
only values the caller still supplies.

The codegen acceptance test makes that distinction explicit:

```js source=packages/snapback-codegen/app-descriptor.test.mjs
  assert.deepEqual(descriptor.surfaces.items.mutations.create.bindings, {
    group: { kind: 'param', name: 'group' },
    title: { kind: 'input', name: 'title' },
  });
  assert.deepEqual(Object.keys(descriptor.surfaces.items.mutations.create.inputs), ['title']);
```

The tracked React fixture's
[descriptor JSON](repo:packages/snapback-react/fixtures/conversation/app/snapback/generated/app.descriptor.json)
is the portable inspection artifact. Its
[`app.d.ts`](repo:packages/snapback-react/fixtures/conversation/app/snapback/generated/app.d.ts)
turns the same `inputs` map into the member's call type: for example,
`addReaction` accepts `messageId`, `userId`, and `emoji`, but not the already
bound `conversationId`. The separate `provider-bindings.d.ts` continues to
describe the underlying raw mutation's complete arguments; the omission is a
property of the generated surface member, not a mutation-signature rewrite.

Do not ask a caller for a bound parameter again. The complete descriptor
mapping remains available to inspection and auth review even though the
surface callable type omits it.

An optional input you omit is omitted from the composed operation payload —
the binding never materializes `key: undefined`; passing `undefined`
explicitly is refused before any network work.

## Run a command and read its truthful outcome

Call a bound command through `surface.commands.<name>(inputs)`, or obtain the
same owner directly with `useSnapbackCommand(app.commands.<name>)` — without
React, `invokeSnapbackCommand(provider, app.commands.<name>, inputs)` from
`@expo/snapback-react`, or `createCommandClient(client)` over a bare
`SnapbackClient` with no provider at all
([the headless client](./headless.md#call-ordinary-functions)). All of these
return one stable command task. The task snapshot derives these phases from its
existing asset-task and mutation-attempt children:

| Phase | Fact |
| --- | --- |
| `preparing` | Inputs and the captured authority cohort are being checked. |
| `transferring` | The existing asset task is reserving, transferring, or finalizing. Absent for text-only calls. |
| `committing` | The one ordinary mutation has been invoked. |
| `succeeded` | Mutation settlement proved the application commit. |
| `failed` | A trust boundary proved refusal or failure. |
| `ambiguous` | Mutation invocation began, but no commit/refusal proof arrived. |
| `cancelled` | Cancellation completed before mutation invocation. |

`task.done` resolves to `committed`, `failed`, `ambiguous`, `cancelled`, or the
`notRetryable` result of an invalid retry. It rejects only for local input or
source validation before network work starts. Retrying a failed or ambiguous
task returns a successor generation and preserves the mutation attempt
identity needed to reconcile a possibly committed attempt.

Finalized bytes are not a rollback receipt. If the mutation fails after
finalization, the terminal task retains the ready asset child and reports
residue with `unattached: 'authoritative' | 'inferred' | 'unknown'`. Current
LLP 0044 child facts do not prove global non-attachment, so a proved
same-authority mutation refusal is `inferred`; missing settlement or authority
replacement is `unknown`. Cleanup remains the declared LLP 0044 lifecycle
policy.

Cancellation before the mutation cancels the asset child when one exists.
Cancellation after mutation invocation is `ambiguous`, never a fabricated
rollback. Authority replacement does not adopt a task into the successor
principal; each retry revalidates its captured cohort.

### Expo ImagePicker input

Inside `SnapbackExpoProvider`, pass an `expo-image-picker` asset directly to
the bound command. Text-only and image send are branches of one typed call:

```tsx source=demos/expo-golden-path-fixture/src/screens/chat-screen.tsx
      const outcome = await observeCommand(
        conversation.commands.send({ ...(body ? { body } : {}), image: picked }),
        'picked-image',
      );
```

The Expo provider owns picker-URI conversion, binary transport, integrity, and
ordinary-session custody registration; the screen owns only picker UX and
task rendering. The adapter supports `content://`, `ph://`, and `file://` in
the live process. It does not add background, restart, offline, or
attempt-grant semantics.

## Consume the surface from React

Pass the generated surface reference, its exact parameter object, and optional
presence publish values to `useSurface`. The real Expo screen uses both compact
render data and the rich child state:

```tsx source=demos/expo-golden-path-fixture/src/screens/chat-screen.tsx
  const conversation = useSurface(
    app.surfaces.conversation,
    { conversationId },
    { presence: { typing: draft.trim() || proofEnabled ? { displayName: PERSONA_NAMES[activeUserId] ?? 'Someone' } : skip } },
  );
  const connection = useSnapbackConnection();
  const outbox = useSnapbackOutbox();
  const { details, memberships, messages, reactions, users } = conversation.state;
  const activeUser = conversation.data.users?.find((user) => user._id === activeUserId);
  const userById = useMemo(() => new Map((conversation.data.users ?? []).map((user) => [user._id, user])), [conversation.data.users]);
  const messageById = useMemo(() => new Map((conversation.data.messages ?? []).map((message) => [message._id, message])), [conversation.data.messages]);
  const typingNames = [...new Set(conversation.presence.typing.members
    .filter((entry) => entry.key !== conversation.presence.typing.selfKey)
    .map((entry) => entry.value.displayName))];
```

The snapshot exposes six member namespaces plus its descriptor:

- `data.<read>` is exactly `state.<read>.data`. It is the compact row/value
  projection and is `undefined`, never a fabricated `[]`, while that child is
  pending, skipped, or errored.
- `state.<read>` is the complete LLP 0114 query snapshot: `status`
  (`pending | ready | refreshing | error | skipped`), `data`, `error`,
  `freshness` (`unknown | retained | current`), `connection`, and the
  `retention` fact.
- `mutations.<name>(inputs)` is a typed ordinary mutation callable. Its input
  contains only the generated member's unbound inputs.
- `commands.<name>(inputs)` returns the existing command task. It composes the
  existing asset and ordinary mutation owners without entering the mutations
  namespace.
- `presence.<name>` is the existing per-room presence state with `entries`
  re-exported as `members`; status, connection, diagnostic, `selfKey`, and
  room actions remain available.
- `assets.<name>` exposes the existing raw asset-task seam (`reference` and
  `start`) for workflows that do not fit the closed command grammar.
- `descriptor` is the exact admitted generated surface reference.

`skip` from `@expo/snapback-react` opts one presence member out of publishing
without dropping its read-side room. A declared presence member missing from
the options object also defaults to `skip`. Presence self identity is derived
from the adopted session and connection. A publish payload containing its own
`userId` refuses locally with
`SNAPBACK_REACT_SURFACE_PRESENCE_IDENTITY_INPUT`; publish only the collection's
non-identity value fields.

## Observe the same surface without React

Use `bindSnapbackSurface(provider, surface, params, options)` or its provider
alias `provider.surface(...)` when another framework owns rendering. The
listener convenience is
`observeSnapbackSurface(provider, surface, params, options, listener)`.
The returned owner provides:

- `snapshot()` for the same `data`/`state`/`mutations`/`commands`/`presence`/
  `assets`/`descriptor` projection;
- `reads.<name>.snapshot()` and `reads.<name>.subscribe(listener)` for one
  child;
- `mutations.<name>(inputs)`, `commands.<name>(inputs)`, and
  `assets.<name>.start(...)`;
- `update(params, options)` to retarget that bound owner; and
- `dispose()` for all of its owned edges.

This is one owner shared with the low-level hooks, not a second subscription
layer. The package test binds a low-level query and a surface to the same
reference and arguments, then asserts object identity:

```js source=packages/snapback-react/surface.test.mjs
assert.strictEqual(
  surface.snapshot().state.messages,
  lowLevel.snapshot().queries.messages,
  'surface and low-level reads observe the exact same LLP 0114 store snapshot',
);
assert.strictEqual(surface.snapshot().data.messages, surface.snapshot().state.messages.data);
```

Mixing `useSurface`, `useSnapbackQuery`, and `observeSnapbackQueries` for the
same provider/reference/arguments therefore shares the same store snapshot and
upstream subscription. Equivalent presence joins the same canonical room.

## Change parameters without leaking predecessor state

A headless `update(params, options)` prepares the successor read descriptors
and presence rooms before releasing each predecessor room and lease exactly
once. Compact data becomes `undefined` across the handoff instead of showing
rows from the old scope:

```js source=packages/snapback-react/surface.test.mjs
surface.update(
  { conversationId: 'conversation-two' },
  { presence: { typing: { displayName: 'Ada' } } },
);
assert.equal(surface.snapshot().data.messages, undefined, 'parameter replacement cannot leak predecessor rows');
await flush();
assert.equal(surface.snapshot().data.messages[0].conversationId, 'conversation-two');
assert.equal(directMessages.at(-1).data[0].conversationId, 'conversation-two');
assert.deepEqual(client.metrics().rooms, [
  { conversationId: 'conversation-one' },
  { conversationId: 'conversation-two' },
]);
assert.equal(provider.inspection().presenceStores, 1, 'predecessor room is released after successor adoption');
```

With `useSurface`, a React render whose params change creates a successor
binding and retires the predecessor generation. A mutation callable captured
from that predecessor cannot act for the successor:

```js source=packages/snapback-react/surface.test.mjs
assert.throws(
  () => predecessorMutation({ messageId: 'stale-message', userId: 'user-ada', emoji: '⛔' }),
  (error) => error?.code === 'SNAPBACK_REACT_SURFACE_GENERATION_STALE',
  'a captured mutation callable cannot act for a retired parameter generation',
);
```

Read mutation callables from the current hook result instead of retaining one
across a parameter change. Provider disposal and authority replacement apply
the same generation fences and blank predecessor compact data.

## Stay within the generation budgets

Codegen enforces these exact ceilings before it emits a surface:

| Ceiling | Maximum | Counted unit |
| --- | ---: | --- |
| `SURFACE_MAX_PER_APP` | 32 | Surfaces in one app |
| `SURFACE_MAX_PARAMS` | 8 | Parameters on one surface |
| `SURFACE_MAX_MEMBERS` | 24 | Reads + mutations + commands + assets + presence on one surface |
| `SURFACE_MAX_MEMBER_BINDINGS` | 32 | Binding leaves on one member |
| `SURFACE_MAX_SCOPE_RECORD_FIELDS` | 8 | Fields in one flat scope record |

Exceeding any ceiling fails generation with
`SNAPBACK_SURFACE_BUDGET_EXCEEDED`; it never truncates the descriptor. The
limits keep a surface resource-shaped instead of recreating one global app
store.

The portable descriptor validator also measures the complete canonical UTF-8
document against the existing 16 MiB generation-protocol ceiling, and the
binding grammar permits only one flat object-keyed scope level. LLP 0179 leaves
the initial product-level descriptor-byte and binding-depth budgets as an open
question, so S2 does not invent tighter numeric ceilings.

## Act on every surface refusal

Generation-time `SNAPBACK_SURFACE_*` refusals are:

| Code | Trigger |
| --- | --- |
| `SNAPBACK_SURFACE_BUDGET_EXCEEDED` | An app, parameter list, member set, member binding, or scope record exceeds the ceiling above. |
| `SNAPBACK_SURFACE_INVALID_IDENTIFIER` | A surface export, parameter, or member name is not a portable non-reserved identifier. |
| `SNAPBACK_SURFACE_PARAMETER_UNKNOWN` | `param(name)` names no declared surface parameter. |
| `SNAPBACK_SURFACE_PARAMETER_TYPE_MISMATCH` | A parameter or portable literal does not match the target validator, or a parameter validator is invalid. |
| `SNAPBACK_SURFACE_INPUT_UNKNOWN` | A binding names no target argument, or a scope record names no target field. |
| `SNAPBACK_SURFACE_REQUIRED_INPUT_UNBOUND` | A required target argument or required scope field has no binding. |
| `SNAPBACK_SURFACE_REFERENCE_UNKNOWN` | The bound definition is not one exported generated app member. |
| `SNAPBACK_SURFACE_BINDING_AMBIGUOUS` | A definition has multiple export identities or one `input(name)` is bound more than once. |
| `SNAPBACK_SURFACE_BINDING_UNPORTABLE` | A binding uses nested/object construction outside one flat object-shaped target, or a literal is not portable JSON. |
| `SNAPBACK_SURFACE_AUTH_BINDING_REFUSED` | Application data attempts to bind a `Principal`; surface scope is not authority. |
| `SNAPBACK_SURFACE_MEMBER_CLASS_UNSUPPORTED` | A member has the wrong reference class, `input()` appears on an unsupported member, or the target is in the wrong namespace. |

Command declarations refuse at generation with their own stable codes. Every
one names the offending command and carries structured details; none of them
truncates or partially emits the descriptor:

| Code | Trigger |
| --- | --- |
| `SNAPBACK_COMMAND_INVALID_IDENTIFIER` | The command export name is not a portable non-reserved identifier. |
| `SNAPBACK_COMMAND_MUTATION_CARDINALITY_INVALID` | `mutation` is absent, `null`, or an array — v1 requires exactly one ordinary mutation. Details carry `mutations`. |
| `SNAPBACK_COMMAND_MUTATION_UNKNOWN` | The mutation target is not one generated ordinary mutation, or is missing from the generated mutation namespace. |
| `SNAPBACK_COMMAND_MAPPING_AMBIGUOUS` | The mutation or the asset intent has multiple generated export identities. |
| `SNAPBACK_COMMAND_MULTI_ASSET_UNSUPPORTED` | More than one asset input — v1 admits at most one. |
| `SNAPBACK_COMMAND_ASSET_INTENT_UNKNOWN` | `intent` resolves to no generated upload intent. |
| `SNAPBACK_COMMAND_ASSET_INTENT_ARGS_UNSUPPORTED` | The upload intent declares its own argument map; v1 commands do not carry a second one. |
| `SNAPBACK_COMMAND_ASSET_MAPPING_INCOMPATIBLE` | `mutationArg` is not a `v.assetRef({ upload: <this intent> })`, or an optional child maps to a required argument. A required child over an optional argument is admitted. |
| `SNAPBACK_COMMAND_INPUT_COLLISION` | The asset input name collides with a different ordinary mutation input. |
| `SNAPBACK_COMMAND_AUTHORITY_INPUT_REFUSED` | An ordinary input would inject an authority `Principal`. |

A running command task reports its own `SNAPBACK_COMMAND_*` diagnostics. These
are outcome facts, not authoring errors — branch on the code, and read
`status` for what it says about the server:

| Code | Terminal status | What it asserts |
| --- | --- | --- |
| `SNAPBACK_COMMAND_ASSET_FAILED` | `failed` | The asset child never finalized, so the mutation was never invoked. No residue. |
| `SNAPBACK_COMMAND_AUTHORITY_REPLACED` | `failed` | The captured authority cohort was replaced before invocation. The task is not adopted into the successor principal. |
| `SNAPBACK_COMMAND_MUTATION_FAILED` | `failed` | A trust boundary proved refusal — a receipt, a 401/403, an authorization diagnostic, or an explicit `effectCommitted: false`. |
| `SNAPBACK_COMMAND_MUTATION_AMBIGUOUS` | `ambiguous` | Invocation began and no settlement proof arrived. Anything short of proof lands here by design; the client never upgrades a guess to a refusal. |
| `SNAPBACK_COMMAND_CANCELLED` | `cancelled` | Cancellation completed before invocation; the asset child was cancelled where its state permitted. |
| `SNAPBACK_COMMAND_CANCELLED_DURING_COMMIT` | `ambiguous` | Local interest stopped after invocation. Never reported as `cancelled` — the server outcome is unknown. |
| `SNAPBACK_COMMAND_NOT_RETRYABLE` | (outcome only) | `retry()` on a committed, cleanly cancelled, or non-terminal task. The returned task carries the predecessor's terminal snapshot unchanged. |

`SNAPBACK_REACT_COMMAND_INVALID` refuses a command reference that is not the
complete generated command admitted by this prepared binding.

Client-time `SNAPBACK_REACT_SURFACE_*` refusals are:

| Code | Trigger |
| --- | --- |
| `SNAPBACK_REACT_SURFACE_INVALID` | The reference is not the complete generated surface admitted by this prepared binding, or a generated binding kind cannot be projected. |
| `SNAPBACK_REACT_SURFACE_PARAMS_INVALID` | Params are not an object or their keys do not exactly match the generated declaration. |
| `SNAPBACK_REACT_SURFACE_OPTIONS_INVALID` | Options are not the closed `{ presence }` object, or they name an unknown presence member. |
| `SNAPBACK_REACT_SURFACE_INPUT_INVALID` | A mutation or command's unbound inputs are missing/unknown, or an asset call omits `file` or adds an unknown call field. |
| `SNAPBACK_REACT_SURFACE_PRESENCE_IDENTITY_INPUT` | A non-skipped presence publish payload carries `userId`. |
| `SNAPBACK_REACT_SURFACE_GENERATION_STALE` | A mutation or asset callable belongs to a retired or disposed React surface generation. |

Treat the stable code as the branch key and its structured details as the
repair context; do not match message text.

## Render a cold retained boot

Descriptor-mode online preparation persists a compact admitted deployment
projection through LLP 0114's existing binding receipt and RQS store. On a
fresh offline client, the byte-identical descriptor reconstructs the admitted
function, RQS, ephemeral-policy, surface, and capability view before the
provider exists. The real-runtime acceptance proves the surface then renders
the retained rows through both projections:

```js source=demos/expo-golden-path-fixture/tests/g2-falsification.mjs
  await suite.check('descriptor cold boot renders retained message history through the surface', async () => {
    assert(await coldStore.loadReactBindingReceipt(), 'the exact binding receipt is present before cold preparation');
    const binding = await offline.prepareReactBinding({ generatedManifest: app });
    assert.equal(binding.source, 'persisted-receipt');
    offlineProvider = createSnapbackReactProvider(binding, { connectionId: 'g2-offline' });
    offlineSurface = observeSnapbackSurface(
      offlineProvider,
      app.surfaces.conversation,
      { conversationId: 'conversation_engine_room' },
      { presence: { typing: skip } },
      () => {},
    );
    await eventually(() => offlineSurface.snapshot().state.messages.freshness === 'retained');
    const snapshot = offlineSurface.snapshot();
    assert.equal(snapshot.data.messages.length, 3);
    assert.strictEqual(snapshot.data.messages, snapshot.state.messages.data);
    assert.equal(snapshot.state.messages.status, 'refreshing');
    assert.equal(snapshot.state.messages.connection, 'stale');
  });
```

The honest retained frame is `freshness: 'retained'`,
`status: 'refreshing'`, and `connection: 'stale'` until an authoritative
answer arrives. Surfaces add no cache, receipt format, retained-row copy, or
boot lifecycle of their own. A memory-only store still cannot survive a
process-cold boot; use the carrier rules on [the React client page](./react.md)
and [offline retention](../sync/offline-and-retention.md).

## Stay inside the v1 boundary

Commands admit only the closed online v1 shape: one ordinary mutation, zero or
one transient structural asset source, no callbacks or branching, and no
durable restart/offline custody. They do not admit multiple assets, attempt
grants, anonymous claim-on-attach, picker/content-URI adaptation, or generic
workflows. Use the ordinary `mutations` namespace and raw `assets` task seam
when the operation does not fit that grammar.

V1 also does not admit nested surfaces, inheritance, dynamic member creation,
one surface calling another, callbacks, or hidden result transformation. Reuse
happens through the existing generated references and their canonical owners.
The current proof is local-target only; no hosted application-surface claim is
made here.

## Anti-patterns

- **Do not hand-wire five `useSnapbackQuery` calls plus a presence hook when
  one generated composition exists.** [Declare the application surface](#declare-a-surface-for-one-screen)
  and [consume it with `useSurface`](#consume-the-surface-from-react); use
  low-level hooks only for composition outside the surface's closed grammar.
- **Do not pass a bound parameter again as a mutation input.** Inspect the
  generated member's reduced call type and
  [supply only its unbound inputs](#inspect-what-generation-emits).
- **Do not smuggle `userId` into a presence payload.**
  [Publish only non-identity collection values](#consume-the-surface-from-react);
  the session/connection owner supplies self identity.
- **Do not hold a `useSurface` mutation callable across a parameter change.**
  [Read it from the current generation](#change-parameters-without-leaking-predecessor-state)
  so a retired callable cannot act under successor scope.
- **Do not treat a finalized upload as an atomic send.** Use the
  [command outcome and residue facts](#run-a-command-and-read-its-truthful-outcome),
  and keep the raw asset and ordinary mutation children visible when a commit
  fails or becomes ambiguous.
- **Do not mirror mutation optionality mechanically onto a command child.** A
  [required child may deliberately narrow an optional mutation argument](#map-required-and-optional-assets-safely);
  only the unsafe optional-child → required-argument direction refuses.

---

<!-- snapback-guide-source: guide/clients/swift.md -->
---
title: Swift client
id: clients.swift
order: 2
audience: agent-first
capabilities: [clients.swift]
authorities: [llp/0064-native-client-surfaces.rfc.md, llp/0093-client-protocol-and-native-clients.rfc.md, llp/0095-client-lifecycle-and-conformance.spec.md, llp/0096-auth-profiles-for-protocol-clients.spec.md, clients/swift/SnapbackClient/Package.swift, clients/swift/SnapbackClient/Sources/SnapbackClient/SnapbackClient.swift]
examples: [clients/swift/SnapbackClient]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-03
reviewed-authorities-digest: sha256:bb3cab052a509303eae2f0d0656d35af210deaa8c6a1e8c479704348b29be69f
---

# Swift client

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

`clients/swift/SnapbackClient` is the first non-JavaScript proving client. It
is structured as a SwiftPM library for macOS 13+ and iOS 16+ and claims
`poll/local` and `live/local` when built and tested inside this repository. It
does not yet claim external dependency consumption, `live/hosted`, offline
`Parity`, or sender-constrained native custody.

## Dependency declaration — not supported

There is no supported SwiftPM dependency declaration for this client. The
repository root has no `Package.swift`, no consumable tagged package release,
and the conformance tests intentionally read the repository-owned fixture
corpus through `SNAPBACK_REPO_ROOT`. Do not add
`.package(url: "https://github.com/expo/snapback", ...)` to an application:
SwiftPM cannot resolve the nested proving package from that repository URL.

Use this client only from the in-repository package path. Publishing a tagged
mirror or moving a manifest to a consumable package root would be a separate
distribution change with its own fixture-resource and release evidence.

## Construct a client

Create `SnapbackClient.Configuration(baseURL:)`. For sessions mode, set
`sessionBearer` to a genuine Snapback session obtained through email-code auth
or the [supported external identity-broker seam](../auth/native-apps.md).
The client then:

- carries the bearer only in `Authorization`;
- offers `auth/rr` and `auth/live` at every exact boundary;
- omits caller-selected `userId` body auth;
- creates a stable authorization namespace per live query; and
- retries only HTTP 409 `SNAPBACK_AUTH_RESERVATION_STALE`, with a configurable
  40-attempt short-jitter budget.

Never package the server's admin token or impersonation capability in the app.

## Subscribe and receive every row lane

Call `openConnection()`, then `subscribe(function:args:)`. Start either
`startDrainLoop()` or `openLiveStream()`. `onUpdate` receives ordinary
replace/delta rows and authorization-invalidation snapshots through the same
callback.

Ordinary replace/delta lanes use a strict increasing data-version guard.
Authorization invalidation has its own exact scope/revision/ticket fence: a
first-seen satisfying snapshot can replace rows at the same data version, and
only an identical already-applied ticket is acknowledged again without
reapplying. Missing snapshot resolutions quarantine and blank the old
materialization. A `terminalDelete` resolution destroys rows, persists the
terminal fence, publishes the blank state, and ACKs without resubscribing.

## Bind app lifecycle

Call `pauseForBackground()` from the app's background/inactive transition. It
releases subscription demand, stops polling and heartbeat work, and closes the
socket while retaining the desired query specifications. Call
`resumeAfterForeground()` after the app becomes active; it reattaches the lane
and obtains fresh snapshots before resuming live publication.

If the server reports `SNAPBACK_CONNECTION_TOKEN_INVALID` after idle reaping
or grant expiry, the client discards that grant and quiesces its transports.
The next foreground attempt opens a fresh grant and re-establishes every
desired subscription; it never loops on the refused token.

These are platform-neutral methods. A SwiftUI host can map `scenePhase` to
them; UIKit can map the corresponding application notifications. Do not put
reconnect logic in individual views.

## Verify changes

From the repository root, run:

```sh
SNAPBACK_REPO_ROOT="$PWD" swift test --package-path clients/swift/SnapbackClient
```

The suite replays the committed conformance corpus and adds client-specific
coverage for invalidation apply-before-ack (including equal data versions),
terminal deletion, exact duplicate redelivery, foreground grant-loss recovery,
body-auth omission, and reservation retry exhaustion/eventual success. This is
an in-repository proof command, not a consumed-package test claim.

## Support status

Swift is the maintained proving client in this repository, not a published or
URL-consumable dependency. Kotlin and Dart implementations produced during the
Partitime clean-room run are reference evidence, not committed or published
first-party artifacts. Do not tell users to depend on any of these clients
until their packaging, ownership, and CI gates land; the
[capability index](../capabilities.md) keeps that gap explicit.

## Anti-patterns

- Do not embed admin or impersonation secrets in a native bundle.
- Do not set `userId` in sessions-mode bodies.
- Do not reconnect without fresh subscription snapshots.
- Do not ACK an unapplied authorization snapshot.
- Do not claim hosted or sender-constrained native auth from local bearer
  evidence.

---

<!-- snapback-guide-source: guide/clients/react-expo.md -->
---
title: React Expo Online clients
id: clients.react-expo
order: 3
audience: agent-first
capabilities: [clients.react-expo]
authorities: [llp/0012-headless-integration-contract.spec.md, llp/0017-admin-console-inspection-surface.rfc.md, llp/0041-packaged-dev-loop.rfc.md, llp/0064-native-client-surfaces.rfc.md, llp/0114-first-class-react-and-query-groups.spec.md, llp/0176-expo-messaging-golden-path.plan.md, llp/0181-zero-configuration-expo.rfc.md, llp/0258-first-party-application-auth-bootstrap.rfc.md, llp/0262-dev-identity-custody-capability.rfc.md, llp/0297-client-canonicalization-budgets.research.md, llp/0299-supervised-listener-port-plan.spec.md, llp/0300-snapback-is-a-url.rfc.md, llp/0301-url-first-dev-lifecycle.spec.md, llp/0302-declared-dev-client-binding.spec.md, packages/snapback-cli/index.mjs, packages/snapback-cli/expo-dev.mjs, packages/snapback-cli/templates/expo-chat/App.tsx, packages/snapback-client/app-client.mjs, packages/snapback-client/canonical-client-value.mjs, packages/snapback-client/index.mjs, packages/snapback-client/react-binding.mjs, packages/snapback-client/rqs-store-default.mjs, packages/snapback-client/rqs-store-expo.mjs, packages/snapback-codegen/index.mjs, packages/snapback-expo/app-binding.mjs, packages/snapback-expo/asset-source.mjs, packages/snapback-expo/config-plugin.cjs, packages/snapback-expo/index.mjs, packages/snapback-expo/provider-auth-bootstrap.test.mjs, packages/snapback-expo/provider.mjs, packages/snapback-expo/supervised-binding-cache.mjs, packages/snapback-expo/supervised-environment.mjs, packages/snapback-react/index.mjs, scripts/install-local-snapback-packages.mjs, demos/partiful-matrix/tests/acceptance/native-react-expo.mjs, demos/tandem-expo-bakeoff/snapback/scripts/dev-backend.mjs, demos/tandem-expo-bakeoff/snapback/src/backend.tsx, demos/_kit/eas-stage-build.mjs]
examples: [demos/expo-golden-path-fixture, demos/expo-golden-path-fixture/receipts/20260806-g1-ios-simulator.md, demos/expo-golden-path-fixture/receipts/20260806-g1-android-emulator.md, demos/expo-golden-path-fixture/receipts/20260806-g4-external-summary.md, demos/expo-golden-path-fixture/receipts/physical-device-online-checklist.md, demos/partiful-matrix/native/react-expo, packages/snapback-cli/expo-device-forwarding.test.mjs, packages/snapback-cli/expo-bootstrap-exchange.test.mjs, packages/snapback-cli/expo-dev-loop.test.mjs, packages/snapback-expo/asset-source.test.mjs, packages/snapback-expo/supervised-offline-fallback.test.mjs, packages/snapback-client/webcrypto-fallback.test.mjs, packages/snapback-expo/provider.test.mjs, packages/snapback-react/webcrypto-fallback.test.mjs, packages/snapback-react/cold-boot-binding.test.mjs, packages/snapback-client/rqs-store-expo.test.mjs, packages/snapback-client/rqs-resume-expo.test.mjs, scripts/local-source-package-closure.test.mjs, demos/rn-durable-store-witness/probe-App.tsx, demos/tandem-expo-bakeoff/snapback/src/backend.tsx, demos/tandem-expo-bakeoff/scripts/build-ios-dev-client, demos/_kit/tests/repo-layout-unit.mjs, benchmarks/lanes/native-simulator.md]
status: current
targets: [local]
maturity: shipped
authoring-profiles: [explicit, familiar]
reviewed: 2026-08-28
reviewed-authorities-digest: sha256:b351212b2a21b7376273a3bd54f4cba612bb851646eb4056f2721d27f9b9e5d3
---

# React Expo Online clients

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

React Native/Expo uses `@expo/snapback-expo` as the environment facade over
the same `@expo/snapback-client` and `@expo/snapback-react` owners used by
React web. The facade consumes the generated `snapback.app.v1` descriptor,
admits a separate environment binding, projects boot state, and delegates the
provider and hooks documented on [the React client page](./react.md). It is an
**Online** surface: queries and mutations run against a reachable Snapback
backend. It does not execute handlers locally and therefore does not claim
local-first behavior or Parity.

Everything on the React page applies here — this page covers only what is
different on the RN carrier: the boot path, the crypto prerequisites, the
store consequence, queue refusal, and reconnect honesty. In particular,
optimistic mutations work unchanged: for a like/favorite button backed by a
live feed, use [the optimistic toggle recipe](../recipes/optimistic-toggle.md)
rather than component state plus a local counter delta.

## Start the URL-first development loop

The ordinary local loop has two caller-owned processes. Start the backend
first so it can print and, in the shipped templates, write the URL:

```sh
# Terminal 1: backend; --write-env maintains one marked block in .env.local
bun run dev
```

Then start the bundler yourself:

```sh
# Terminal 2: Expo/Metro or Vite
bun run dev:client
```

The backend lifecycle depends on how this `snapback dev` invocation acquired
it. When a ready descriptor already exists, the CLI **attaches** and SIGTERM
ends only that attachment; the pre-existing backend keeps running. When no
ready descriptor exists, the CLI spawns a **managed** backend and SIGTERM
stops that backend during cleanup. To stop an attached backend explicitly,
use its ready descriptor:

```sh
snapback stop --ready-file .snapback/dev.ready.json
snapback dev
```

Both `snapback stop` and `snapback restart` are administrator-gated server
self-stop operations. On an ordinary local server the CLI discovers the
owner-only auto-minted administrator token, so the command usually needs no
explicit token; if that carrier is unavailable, keep the dev loop in the
foreground and stop it with Ctrl-C. If you do not stop an attached backend, the next `bun run dev`
validates the live descriptor and attaches to the same daemon. This is
intentional: an attaching CLI must not kill a server it did not spawn.

The application reads exactly one bundler-native variable and passes it as
the provider/client `url`: Expo/Metro uses
`EXPO_PUBLIC_SNAPBACK_URL`, Vite uses `VITE_SNAPBACK_URL`, and a headless
Node client uses `SNAPBACK_URL`. The library does not read the environment.
The Expo template shows the complete app-owned handoff:

```tsx source=packages/snapback-cli/templates/expo-chat/App.tsx
    <SnapbackExpoProvider app={app} url={process.env.EXPO_PUBLIC_SNAPBACK_URL} fallback={(state: ExpoBootState) => <BootFallback state={state} />}>
```

Bundlers inline public environment values when they start. If the backend
rewrites `.env.local` after Metro or Vite is already running, stop and restart
the bundler; hot reload cannot see the new URL. The provider performs a
credential-free identity discovery before signup, login, or any credentialed
request, and repeats it for every new connection episode. If another app or
backend generation has taken the same URL, it fails closed with
`SNAPBACK_APP_BINDING_IDENTITY_MISMATCH`, names both identities, and sends no
application credential to the replacement.

For persistence-sensitive browser lanes, keep the browser origin stable too:
pin Vite with `vite --port <port> --strictPort` or Metro with
`expo start --port <port>`. A changed bundler port does not lose backend data,
but browser-origin-scoped bearer storage and IndexedDB appear fresh and the
user must sign in again.

The URL printed for the host is not reachable as host loopback from an Android
emulator. Copy the printed `androidEmulatorUrl` value manually — the managed
`.env.local` block leaves its `10.0.2.2` spelling commented — set
`EXPO_PUBLIC_SNAPBACK_URL` to it, and restart Metro. Do not uncomment that line
inside the managed block. The supervised appendix below remains the optional
one-command path when you want Snapback to own Metro, listener enumeration,
and Android `adb reverse` setup.

When migrating from the old supervised-only shape, remove leftover
`SNAPBACK_DEV_CLIENT_PORT` and `SNAPBACK_DEV_BOOTSTRAP_PORT` variables before
plain `bun run dev`. Those pins name absent supervisor-owned processes, so
plain development deliberately refuses them with
`SNAPBACK_CLI_ARGUMENT_INVALID`.

## Keep the generated `app` under the 4,096-node ceiling

The generated `app` function catalog — especially `app.api.queries` — shares
the `CanonicalClientValueV1` identity budget used during React/Expo provider
construction. The format charges one node for the root and every array entry
or object-field value; object keys do not add nodes. Its `maxNodes` ceiling is
4,096. Above that ceiling, provider construction can refuse with
`SNAPBACK_REACT_ARGS_INVALID` before the app reaches ready, which can look like
a blank boot screen when the fallback does not surface the refusal.

`snapback generate` projects the generated query, mutation, and command-bound
mutation export through the canonical owner's real traversal. It emits
`SNAPBACK_CODEGEN_REACT_EXPORT_NODE_BUDGET_EXCEEDED` with the measured node
count and the 4,096 ceiling when the projected catalog is too large. This is a
warning, because a generated descriptor can still be used outside the current
React store-identity path; treat it as a required repair before Expo boot.

The cheap authoring repairs are:

- Do not export unused table queries.
- Collapse pagination variants such as `listMessages` and
  `listMessagesBefore` into one query with an optional `before` argument.

Do not raise the shared budget or hand-edit generated output. Both Explicit
and Familiar authoring produce the same generated client shape and use the
same repair.

<!-- since: 0.1.23 -->
## Add first-party application auth

Pass the generated `app` to `SnapbackExpoProvider`. When its generated
`authBootstrap` requires `auth.application-bootstrap.v1`, the provider opts
into the common application client and exposes `useSnapbackAuth()` plus
`useSnapbackCurrentPrincipal()` over that one owner. Follow the complete
[password application-auth journey](../auth/passwords.md#sign-up-then-sign-in)
for anonymous `ready`, signup and its one-time recovery projection, sign-in,
restoration, sign-out, and user switch.

### Sign in with Apple or Google

`snapback auth enable apple google` writes the providers into the app's own auth
declaration. After `snapback generate`, `snapback dev --expo` supervises a
shared development broker on the same loopback origin the client already
discovers, and `SnapbackExpoProvider` builds the matching Adapter automatically:
there is no second terminal, no broker origin to configure, and no
`EXPO_PUBLIC_*` variable to set. The app then calls
`auth.signIn({ provider: 'apple' })` and nothing else changes when it later
moves to its own credentials.

The Adapter needs `expo-web-browser` and `expo-linking`, which this package does
not depend on. An app that enables a provider installs them; one that never does
acquires neither, and a missing module is a named refusal rather than a bundler
error. Return targets are derived from the supervised client port, so Expo Go
receives the callback with **no app-owned native build**.

The identities are hermetic rehearsal identities issued by the local
supervisor. They are not Apple or Google logins, they are app-scoped, and they
cannot enter a staging or production deployment. See
[Sign in with Apple or Google in development](../auth/native-apps.md#sign-in-with-apple-or-google-in-development)
for the readiness rules, the frozen-Adapter contract, and what moving to
app-owned credentials changes.

Expo web has the shipped browser durable-custody evidence. Both native OS
paths ship at the exact iOS/Android + `single-runtime` tuples on their
separate Phase-2 receipts in the published 0.1.24 closure (first publish
recorded in
[the closed custody first-publish gate](repo:issues/closed/20260816-custody-first-publish-gate.md)). The iOS proof is
share-sheet-kind-only; the built/embedded Notification Service Extension and
`simctl push` service-stage invocation remain nonclaims. The cross-platform
disposable template therefore remains
`volatile-explicit` without claiming process-death restoration. Keep the
[native threat-model page](../auth/native-apps.md) and
[target-honesty page](../auth/targets.md) in view before changing that policy.

## Install the published Expo path

<!-- since: 0.1.11 -->

For a **new** Expo app, start from the Expo-native `expo-chat` template
instead of assembling packages by hand. In an empty directory nothing is
installed yet, so use a command that carries its own package identity:

```sh
npm create snapback-app my-app
# equivalently: npx --yes create-snapback-app my-app
#               bun create snapback-app my-app
#               pnpm create snapback-app my-app
# scoped CLI spelling, same scaffolder:
#   npx --yes @expo/snapback-cli@0.1.29 new my-app --template expo-chat
```

`expo-chat` is `create-snapback-app`'s default template, so `--template` is
optional here; it ships the conventional `snapback/` backend and the root
file-store/crypto registration described below already wired.

Do **not** reach for the bare `npx snapback new …` spelling before the CLI is
installed. `npx` resolves the unscoped registry name `snapback`, which belongs
to an unrelated third-party package with no `bin`, and the failure is
`npm error could not determine executable to run` — an error that names
neither Snapback nor the package it actually downloaded. The bare `snapback`
bin is correct only once `@expo/snapback-cli` is a dependency of the project
you are standing in, as it is in the existing-app flow below.

When adding Snapback to an **existing** standalone Expo 57 app, install the
package roots that the app imports plus the legacy file-store, random, and
picker modules used by the template. Install the five Snapback roots
together so the lock holds one coherent version vector — the newest
published closure is the checked-in record in
[`published-closure.json`](../published-closure.json):

```sh
npx expo install \
  @expo/snapback-cli@0.1.29 \
  @expo/snapback-client@0.1.29 \
  @expo/snapback-codegen@0.1.29 \
  @expo/snapback-expo@0.1.29 \
  @expo/snapback-react@0.1.29 \
  expo-file-system expo-crypto expo-image-picker
```

Use `npx expo install` for the Expo modules; never hand-write or copy an
`expo-file-system` constraint. Expo module versions follow the app's SDK, and
a plausible mismatched version can resolve cleanly while exposing a different
file API. In plain JavaScript that mismatch may appear only when the durable
store tries to publish a rename, leaving the app apparently healthy but on no
working file-backed persistence path. The Expo installer selects the
SDK-compatible versions.

Do not add `@expo/snapback-contract` directly; the client/codegen packages
own their exact Contract edge. Keep one coherent version vector in the lock,
with no `file:`, `link:`, workspace, override, or checkout path. If the app
will register for push notifications, the client's
`@expo/snapback-client/push-installation-expo` subpath is the Expo carrier
for installation storage — see
[Expo push notifications](../backend/expo-push.md).

The CLI has no backend-only initializer — `snapback new` creates a whole
project — so when adding Snapback to an existing blank Expo app, create the
packaged React scaffold in a clean sibling directory and copy its
conventional `snapback/` child into the Expo root before authoring and
generating:

```sh
npx snapback new ../snapback-backend-scaffold --template react
cp -R ../snapback-backend-scaffold/snapback ./snapback
npx snapback generate snapback --json
```

This is the published workflow proved by the external G4 repository. A
`snapback init` command does exist and is published, but no published version
adopts either shape `create-expo-app` ships today — the pristine
`blank-typescript` `tsconfig.json` omits `include`, and the default Router
template puts routes under `src/app/` — so the sibling ceremony remains the
paved path until a publication carries the fix (LLP 0261, 2026-08-24
amendment).

A blank Expo TypeScript scaffold includes the whole tree. Snapback's generated
directory also carries provider-neutral Contract source projections that are
not Expo runtime inputs — a broad `include` pulls them into the app typecheck,
where their `@exact/contract/exports` imports fail as an unresolvable module
(that specifier is a generated-projection edge, not a package to install) —
so keep the app check on entrypoints plus generated declarations:

```json fragment reason="external Expo typecheck boundary proved by the G4 receipt"
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": { "strict": true },
  "include": ["App.tsx", "index.ts", "snapback/generated/*.d.ts"]
}
```

This is a typecheck boundary, not permission to hide errors in the imported
descriptor declarations; `npx tsc --noEmit` must still pass.

## Install the Expo facade from this source checkout

For an Expo app nested anywhere under this checkout, run one command from the
Snapback repository root:

```sh
node scripts/install-local-snapback-packages.mjs <expo-app-directory>
```

The command discovers the complete internal runtime closure from the checkout
manifests, packs those exact source packages into the app's generated
`.snapback/local-source-packages/` directory, points the Expo, client, and React
roots plus every top-level override at those local tarballs, and runs the Bun
version pinned by this repository. Commit the app's resulting `package.json`
and `bun.lock`; rerun the same command with `--frozen-lockfile` in CI or after
deleting `node_modules`. The command regenerates the local tarballs before each
install, so do not edit them by hand; treat that directory as generated (and
ignore it in the app's source-control rules). Keep it present when invoking the
out-of-checkout EAS staging helper below so the staged app can cold-install
without reaching back into the repository.

The tarball filenames are content-addressed. On a clean clone, the tracked
manifest and lock may name predecessor archives that are correctly absent from
the ignored directory; rerunning the helper rotates only its own local paths
and integrity records while retaining every unrelated locked package. Do not
work around a missing predecessor archive by deleting `bun.lock` or allowing
Bun to regenerate the registry graph.

Do not add `@expo/snapback-contract` as a direct app dependency and do not
hand-maintain one-off overrides. A local client keeps its own exact Contract
edge, and a nested app is outside the repository workspace, so Bun otherwise
falls through to the registry and can either fail or mix checkout code with a
different published generation. Direct directory links also leave runtime
resolution dependent on symlink behavior; the app-local tarballs install as
ordinary materialized packages and travel with the existing EAS staging copy.
The helper keeps the entire Snapback runtime closure local. Registry installs
remain a separate workflow: use only the published package versions and no
source paths or local overrides there.

For image messages, use the authenticated
[Expo ImagePicker command recipe](../backend/assets.md#send-one-expo-imagepicker-image-with-an-ordinary-session).
It passes the picker asset directly to the typed command and keeps the native
source adapter, upload task, asset id, and attachment sequence behind the
provider-owned client. A client with no real session cannot finish the
multi-request upload under any intent auth mode.

To render the uploaded image, hand `useSnapbackAssetImage`'s `src` straight
to a plain `<Image>` — see
[Render the uploaded image in a plain `<Image>`](../backend/assets.md#render-the-uploaded-image-in-a-plain-image).
Do not build delivery URLs by hand: that section states the URL-selection
rule (most-permissive delivery the asset's policy grants), how the hook
holds the rendition-publication race, and the sessions-mode strict-delivery
diagnostic for images that would otherwise render empty.

## Debug the backend before writing another probe

The generated [admin console](../operating/admin-console.md) is the shipped
browser debugger for an Expo/React backend. Open it while `snapback dev` is
running to browse Data, run and inspect Functions, see Realtime delivery,
and read Errors, Logs, Capabilities, and the build-matched Guide:

```sh
snapback admin --ready-file .snapback/dev.ready.json
```

Use the actual ready-file path printed by your dev process. The console is an
operator surface, not part of the Expo bundle; the command derives a browser
credential without exposing the master admin token. Check it before falling
back to `curl`, raw host operations, or a one-off verification script.

## Appendix: Run the supervised Expo development loop

Use this optional path when Snapback should own Metro, its bootstrap exchange,
listener enumeration, and Android `adb reverse` setup. If a harness owns the
backend or client process instead, stay on the URL-first path above or use the
[fixed-origin attach recipe](../recipes/fixed-origin-development.md); do not
wrap an independently owned listener in the supervised `--expo` loop.

<!-- since: 0.1.10 -->

> **Closure-version boundaries.** State these by closure version, not by
> "current" — the newest published closure is the checked-in record in
> [`published-closure.json`](../published-closure.json). The dated 0.1.10
> [external-consumer G4 proof](repo:demos/expo-golden-path-fixture/receipts/20260806-g4-external-summary.md)
> found a runtime-capability and ImagePicker-closure mismatch; 0.1.11
> repairs both. Two further boundaries hold at exactly 0.1.11: current adb
> may label selected reverse rules with a transport token such as
> `host-16`, which the 0.1.11 supervisor rejects, and EAS CLI cannot
> resolve the package-root config-plugin entry. Closures 0.1.12 and newer
> carry both repairs (verified against the published registry bytes).
> Release exports up to and including 0.1.12 retain the supervised
> bootstrap path, origin-symbol vocabulary, and development host literals;
> 0.1.13 and newer gate that vocabulary behind Metro's production
> transform. The LLP 0176 G4 distribution gate itself stays open until a
> successor-closure ceremony rerun lands its receipts
> ([the G4 ticket](repo:issues/closed/20260806-guide-gap-g4-live-0110-external-vector.md)).
> Do not patch `node_modules` or mix source and registry packages to hide a
> boundary on an older closure.

This supervised boot has three application-visible pieces: the config-plugin
entry, the generated `app`, and `SnapbackExpoProvider`. On web Metro receives
two distinct environment variables: `EXPO_PUBLIC_SNAPBACK_URL` is the backend
data/auth origin, while `EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN` is the
control-plane rendezvous. The rendezvous remains the binding source and wins
over the configured URL, so the older no-URL composition remains valid here
([LLP 0181 §Config plugin](repo:llp/0181-zero-configuration-expo.rfc.md#config-plugin),
[LLP 0181 §Provider](repo:llp/0181-zero-configuration-expo.rfc.md#provider)).
The working fixture's plugin entry is:

```json source=demos/expo-golden-path-fixture/app.json
    "plugins": ["@expo/snapback-expo"],
```

On 0.1.12 and newer that same root spelling is also what EAS CLI wants: the
package root publishes a CommonJS conditional export resolving to the config
plugin, so `eas init` and EAS project linking accept `"@expo/snapback-expo"`
with no workaround. Only on 0.1.11 exactly does EAS's resolver find no root
target — `expo config` still accepts it there — and only there do you need the
always-exported subpath instead:

```json fragment reason="0.1.11-only EAS compatibility spelling proved by the G4 receipt"
    "plugins": ["@expo/snapback-expo/app.plugin"]
```

The subpath is retained on every newer closure, so it stays valid; it is no
longer required.

Its application root mounts the provider with the generated descriptor and an
optional boot-state fallback, still with no URL or binding prop:

```tsx source=demos/expo-golden-path-fixture/App.tsx
export default function App() {
  return (
    <SnapbackExpoProvider app={app} fallback={(state: ExpoBootState) => <BootFallback state={state} />}>
      <G2DemoProvider><G2Screens /></G2DemoProvider>
    </SnapbackExpoProvider>
  );
}
```

The packaged provider owns one custody identity and intentionally exposes no
per-call `userId`. That means a **dev-auth, multi-persona switcher does not
compose with `SnapbackExpoProvider`**: dev auth is client-asserted, but the
provider has nowhere safe to put a different acting user for each call. Use
sessions mode and adopt a separate ordinary session for each test persona when
the app needs product-shaped multi-persona behavior. The checkpoint-era
`useSnapbackQuery({ provider, query, userId })` bridge in an older demo is a
test-era workaround, not the packaged path.

The supervised web loop does not mint at startup, and the provider does not
adopt a supervised session by default. It reaches anonymous `ready`, where
ordinary password signup/sign-in uses the injected backend URL. Pass
`adoptSupervisedSession` only when a test explicitly wants the on-demand
supervised mint. Explicit browser adopters receive separate sessions for the
same default principal, so signing out one tab does not expire another; a
two-user proof should instead use ordinary password entry with separate custody
per context. `snapback auth dev-session` likewise remains an explicit operator
tool, never a template-consumed app session.

The mint POST admits browser callers only from an exact supervisor-admitted
`Origin`. Native fetch may omit `Origin`, so an originless POST is admitted only
when its timing-safe per-boot `correlationId` matches; a present wrong `Origin`
is always refused.

From an Expo app whose backend is the conventional `snapback/` child, select
the supervised carrier explicitly (iOS remains the default when the platform
flag is omitted):

```sh
snapback dev snapback --expo --expo-platform ios
snapback dev snapback --expo --expo-platform android
snapback dev snapback --expo --expo-platform web
```

<!-- since: 0.1.26 -->

### Pin or range the supervised ports

Without flags, the backend scans `4287–4387` upward while the supervisor
allocates `client`, `bootstrap`, then web-only `metro` downward. On a quiet
host that means the same ports every morning: backend `4287`, client `4387`,
bootstrap `4386`, and web Metro `4385`.

Use `--port`, `--client-port`, and `--bootstrap-port` for exact pins, or
`--port-range <lo>-<hi>` to constrain every unpinned owner. Pins may sit
inside or outside the range.

| Flag | Environment equivalent |
| --- | --- |
| `--port` | `SNAPBACK_DEV_PORT` |
| `--client-port` | `SNAPBACK_DEV_CLIENT_PORT` |
| `--bootstrap-port` | `SNAPBACK_DEV_BOOTSTRAP_PORT` |
| `--port-range` | `SNAPBACK_DEV_PORT_RANGE` |

Flags win over environment values. Supervisor-owned pins (`--client-port` and
`--bootstrap-port`) are strict: an occupied pin refuses with
`SNAPBACK_DEV_PORT_UNAVAILABLE`. The backend pin (`--port`) retains the
receipt-verified `SNAPBACK_DEV_FIXED_PORT_STALE_LISTENER` refusal only when the
port accepts connections. A leftover ready descriptor whose pinned port refuses
the connection at probe time instead yields
`SNAPBACK_DEV_FIXED_PORT_STALE_DESCRIPTOR` and names the descriptor to remove
before starting fresh. A timeout or other socket error preserves the descriptor
and yields `SNAPBACK_DEV_SERVER_ATTACH_FAILED`. A range with no remaining
candidate refuses with `SNAPBACK_DEV_PORT_RANGE_EXHAUSTED`. Neither occupied-port
path adopts or signals the holder.

Final readiness, `expo-supervisor.json`, and `inspection()` expose `portPlan`
with each owner, selected port, range/pin source, and flag/environment
provenance. A receipt-verified existing backend is recorded with `attached`
provenance; if a flag- or environment-declared range excludes its port, attach
refuses with `SNAPBACK_DEV_ATTACH_PORT_OUT_OF_RANGE`. To admit extra tunnel or
forwarded origins without allocating their ports, merge them through
`SNAPBACK_DEV_AUTH_ORIGINS`.

Ignore both local-state forms before copying, staging, or archiving the app;
the sibling restore lock records an absolute target-instance reservation and
is not portable between hosts:

```gitignore
.snapback/
*.snapback.restore.lock
```

Every scaffold template ships both rules, so an app started from
`npm create snapback-app` already has them; add them by hand only when
retrofitting an existing Expo app.

Use `--expo-dir`, a positional backend directory, `--email`, or
`--android-serial` only when the project layout or selected emulator requires
it; the fixture README gives the full source-checkout commands
([runnable fixture](repo:demos/expo-golden-path-fixture/README.md)).

### Know what the supervisor owns

One supervisor starts or adopts the exact backend generation, starts Metro,
issues an expiring `source: "supervised-dev"` binding, offers the admitted
on-demand ordinary-session mint, and verifies the backend, Metro, and bootstrap
listeners before reporting readiness. It also owns signal forwarding and
reclaims the backend, Metro, bootstrap exchange, binding material, and port
forwards on exit
([LLP 0181 §Supervised development baseline](repo:llp/0181-zero-configuration-expo.rfc.md#supervised-development-baseline),
[`runExpoDev`](repo:packages/snapback-cli/expo-dev.mjs)).

For detached control, use the three planes in order: the token-gated HTTP route
at `exchangeOrigin + controlPath` from `.snapback/expo-supervisor.json` when
the managed ready descriptor names a usable owner-only admin-token file; the
descriptor's owner-bound `controlSocket` when HTTP has no managed token; then
interactive or newline-delimited JSON stdin when it remains readable. The
three planes serialize lifecycle mutations through one dispatcher; do not
signal a process by pattern. A headless `--json` launch
refuses with `SNAPBACK_DEV_CONTROL_CHANNEL_UNAVAILABLE` only when authenticated
HTTP, the socket, and stdin are all unavailable. `/dev/null`, a closed pipe,
and an empty regular-file redirect are unavailable stdin carriers; a non-empty
regular file may carry newline-delimited JSON commands, including
`stop-children`. That verb leaves the CLI owner alive, so a later
`reload-metro` on that owner respawns Metro.
The exact request shapes, HTTP and socket responses, and stale/foreign refusal
rules are in
[Control a detached Expo dev supervisor](../operating/agent-controls.md#control-a-detached-expo-dev-supervisor).

When a watched backend edit reaches `generated-and-loaded`, the supervisor
reads the successor `app.descriptor.json` and remints the binding for that exact
descriptor identity while keeping the same supervisor generation and route.
The next bootstrap exchange therefore admits the new generated client without
restarting `snapback dev --expo`; the dev-loop test changes `functions.mjs`,
boots that successor digest, and calls it against the still-running backend.

`--expo` and `--client-command` are different lifecycle arms. The generic arm
runs the command in the caller's environment; it does not install
`EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN` or publish the supervised bootstrap
exchange. Therefore this plausible command is not equivalent to the web
selection above:

```sh shell-check=skip class="anti-pattern" reason="deliberately unsupported generic-arm example contains nested Expo flags"
snapback dev snapback --client . --client-command "expo start --web"
```

A recognizable `expo start` routed this way emits
`SNAPBACK_DEV_EXPO_SUPERVISOR_BYPASSED` with the exact supported alternative.
Use the generic arm for independently configured clients; use `--expo` whenever
`SnapbackExpoProvider` should discover the supervisor without an app-authored
origin.

### Recover when supervised Metro exits

<!-- diagnostic-primary: SNAPBACK_EXPO_METRO_EXITED -->

`SNAPBACK_EXPO_METRO_EXITED` means the owned Metro child terminated; inspect
its reported cause, exit code or signal, and Metro stderr before restarting it.
If stderr names `ENOENT` below `.snapback/generations/.tmp-*`, exclude
`.snapback/generations` from Metro's crawl with `resolver.blockList`; current
Expo chat and media-feed template configs already carry that exclusion, so
preserve it when retrofitting or replacing `metro.config.*`. Then use the
owner's `reload-metro` control instead of killing processes by pattern. The
transient directory and recovery are authoring-profile independent.

When Metro's file watching is inert — the project under a watcher-blind root such as `/private/tmp`, or `CI` truthy in the effective Metro environment of a bundler you started yourself — the supervised readiness stream carries one advisory `SNAPBACK_EXPO_METRO_WATCH_INERT` event naming the condition and the fix, so a stale bundle is not misread as an application bug. The supervised `--expo` loop strips `CI` from its owned Metro child (the supervised loop is a watch loop by contract), so a headless controller with `CI=1` no longer disables watching there. On unsupervised `snapback dev` invocations that own their client (`--client-command`), the same code is still printed as an advisory, not a refusal, when the CLI process has a truthy `CI`: if you start Metro or Expo yourself, do not inherit `CI=1`; unset `CI` or pass `CI=0`.

Metro receives the credential-free rendezvous origin and, on web, the backend
data/auth origin as `EXPO_PUBLIC_SNAPBACK_URL`. At runtime the Expo facade
performs a `GET /_snapback/expo/v1/bootstrap` with `cache: "no-store"`; the
loopback-only response carries the expiring binding and an unavailable
authority marker. Explicit supervised adoption makes a second, on-demand
authority request, which returns either an ordinary session or a structured
refusal. The exchange has the supervisor's lifetime and is reclaimed with the
other children
([LLP 0181 §Delivery E1, "E1 carrier disposition"](repo:llp/0181-zero-configuration-expo.rfc.md#e1--simulatoremulator-loop),
[supervised environment](repo:packages/snapback-expo/supervised-environment.mjs)).
LLP 0181's E1 acceptance requires the bearer to remain absent from the named
static/public surfaces; the retained receipt JSONL scans additionally establish
its absence from the readiness stream. Neither fact proves confidentiality or
peer authentication against another local process.

Dev-mode client assertion has a second, separate per-boot `sbdev_` capability.
For supervised iOS simulators and Android emulator/USB targets, the supervisor
reads `devIdentityCapabilityFile`, issues a one-shot startup-nonce-bound
checkout nonce through the native-only launch channel, and the Expo facade
redeems it into private client custody. The nonce and bearer are removed from
Metro and Expo web environments; Expo web receives no capability through the
browser bootstrap and needs a relay-stamping front for dev identity, while its
ordinary supervised sessions path is unaffected. LLP 0262 stage 2 still
accepts an absent capability with the server's once-per-boot warning naming the
committed enforcement flip; a presented invalid capability is refused now,
and enforcement waits for the acceptance suite to witness every supported
carrier.

### Settle the backend into Sessions mode before explicit adoption

The on-demand mint inherits the native `auth.mintSession` precondition: the
app must already be settled and available in Sessions mode. The fixture does
this in its [schema](repo:demos/expo-golden-path-fixture/snapback/schema.mjs).
Settle Sessions mode before relying on either anonymous password-ready web
boot or explicit adoption. With Sessions mode, default web boot reaches
anonymous `ready`; without it, an explicit `adoptSupervisedSession` request
reports `authority-required` with the native diagnostic. See
[Sessions and principals](../auth/sessions-and-principals.md)
for the mode transition, and [LLP 0181 §Provider](repo:llp/0181-zero-configuration-expo.rfc.md#provider)
for the provider state contract.

### Diagnose a binding identity mismatch

`SNAPBACK_APP_BINDING_IDENTITY_MISMATCH` means the imported
`AppDescriptor` and the delivered `AppBinding` name different descriptor
identities. Diagnose which transition produced the split before choosing a
recovery:

- A **same-owner successor** is the known case where the backend reports
  `startup-successor-activated` but the running Expo extra still names that
  owner's predecessor descriptor. This is a **product bug**, not a
  wrong-backend refusal. Do not pkill by process name, and do not present a
  restart as the paved recovery. Until Track A's in-process recook lands,
  **owner restart against the same sqlite is a fallback**, not the paved path;
  preserve and reopen that owner's same SQLite store.
- A foreign backend, stale supervisor, or unmatched predecessor remains an
  identity mismatch with no recook. Stop only an older supervisor whose
  ownership you have identified, regenerate the conventional
  `snapback/generated/` app from the backend you intend to run, and let the
  active supervisor observe its `generated-and-loaded` event.

In either case, do not overwrite the identity, construct a second descriptor
in application code, or weaken admission. The refusal must continue to prevent
a client generated for one backend shape from being bound to another.

### Choose simulator, emulator, or USB routing

| Carrier | Route selected by the supervised baseline | What stays loopback-only |
| --- | --- | --- |
| Expo web | Same-host loopback; `--expo-platform web` starts Expo with `--web` and injects the bootstrap origin before bundling. | Backend, Metro/web, and bootstrap exchange. |
| iOS simulator | Same-host loopback; the binding and Expo origin use `127.0.0.1`. | Backend, Metro, and bootstrap exchange. |
| Android emulator | Preferred: one verified `adb reverse` rule for each of the backend, Metro, and bootstrap ports, so the app still addresses `127.0.0.1`. Fallback: the emulator-only `10.0.2.2` host alias under `routing: "port-forward"`. | Every host listener. The fallback is routing posture, not permission to bind on LAN. |
| Android USB device | Select the exact USB serial with `--android-serial`. The supervisor classifies the `adb devices -l` row, rejects TCP/IP/mDNS adb, and installs/verifies/removes the same three `adb -s <serial> reverse` rules under `routing: "port-forward"`. | Every host listener. The USB mechanism is headless-proven; its live LLP 0064 Online receipt is pending. |
| iOS USB device | `--ios-udid` enumerates physical devices with `xcrun devicectl` and rejects network transports. The current command then refuses with `SNAPBACK_EXPO_IOS_USB_REVERSE_FORWARD_UNAVAILABLE`: `devicectl` 518.33 has no TCP forward, while `iproxy` forwards Mac-to-device, the wrong direction for device loopback-to-Mac. | No listener or forward is created. A device-side bridge or a new author-approved posture is still required. |
| Tunnelled Metro plus tunnelled backend (**not a carrier**) | No supervised route is selected. A tunnel adds reachability; it does not admit the Metro asset path, the backend target, or their composition. | Nothing is newly guaranteed loopback-only: a front can make a loopback listener remotely reachable while the server still sees its loopback bind. Treat this as an unsupported workaround, per [Targets — a public tunnel does not make the loopback server production-ready](../auth/targets.md#a-public-tunnel-does-not-make-the-loopback-server-production-ready). |

The separate `source: "hosted-development"` binding arm represents only a
development bundle pointing at an already-admitted hosted HTTPS backend. It
does not admit, create, or supervise the Metro/development-asset carrier, so a
tunnel does not become a carrier by being paired with that arm. Admission
refuses `localhost`/`.localhost` names, IPv4 `127/8`, IPv6 `::1`, RFC 1918 and
link-local IP literals, IPv6 link-local/ULA literals, and unspecified addresses
such as `0.0.0.0`, `[::]`, and IPv4-mapped `[::ffff:0:0]`, plus the deprecated
IPv4-compatible IPv6 `::/96` block. This is deliberately not a DNS
private-network classifier: DNS-named origins that resolve privately remain
outside the client arm's guarantees while carrier ruling 6 is open.

Declare each already-admitted hosted development origin and its public receipt
identity in the closed `hostedDevelopmentTargets` array in
`snapback/codegen.policy.json`, then regenerate. Codegen derives the app,
schema, functions, and HTTPS routing fields and installs the frozen target set
and target-bound receipt predicate non-enumerably on the generated `app`.
Omitting the array emits an empty set that admits no hosted target; stale
generated modules with no admission record fail integrity validation. The
receipt is provenance, not an application bearer or other secret.

The raw `createSnapbackAppClient` constructor does not accept a receipt string
as proof. Import `app` from the codegen-emitted binding module, call
`admitAppBindingV1(candidate, app)`, then pass the exact returned binding object
to the constructor. Admission takes the hosted-target set and receipt predicate
only from that generated `app` export; loading the descriptor JSON or passing
caller-chosen replacements refuses. No raw parameterized admission helper is
exported from the client package; the Expo handshake is package-private.
The handshake takes one plain frozen snapshot before its receipt predicate can
await; target matching, verification, marking, and transport all use that
snapshot, so a live getter cannot swap the origin after verification. Cloning,
serializing, reconstructing, or hand-building the returned binding drops its
in-process admission and refuses before any request is made.
`SnapbackExpoProvider` performs this handshake for its resolved environment
binding.

This is a process-local client contract, not an unforgeable JavaScript security
boundary. It binds callers that use the application's generated artifact path;
same-process code that manufactures its own module record or bypasses the
generated client path is outside this arm's threat model.

These routes and their cleanup are the closed iOS/Android branches in the
[supervisor](repo:packages/snapback-cli/expo-dev.mjs),
[LLP 0181 §iOS simulator](repo:llp/0181-zero-configuration-expo.rfc.md#ios-simulator),
and
[LLP 0181 §Android emulator](repo:llp/0181-zero-configuration-expo.rfc.md#android-emulator).
The final readiness event reports `device.serial` and `device.class` alongside
the unchanged binding `source: "supervised-dev"`; Android USB remains
`bindingRouting: "port-forward"`. Device selection is exact and ambiguity
refuses rather than allowing adb to choose whichever target happens to be
first.

Closure 0.1.11 exactly has one current-adb compatibility boundary: a
selected-device `adb reverse --list` row may begin with a transport token
such as `host-16` instead of echoing `emulator-5554`. The 0.1.11 supervisor
mistakes that token for the selected serial and refuses after installing its
rules, so an unmodified 0.1.11 Android supervised run on an affected adb
fails with `SNAPBACK_EXPO_ADB_REVERSE_FAILED`. Closures 0.1.12 and newer
treat the already `adb -s <serial>`-scoped listing as belonging to the
selected device and verify its device/host port pairs independently of the
transport label.

Supervised binding admission tolerates at most 60 seconds of the host issuer's
clock running ahead of the simulator/emulator clock. Expiry remains strict; a
larger skew refuses with `SNAPBACK_APP_BINDING_NOT_YET_VALID`, in which case
fix the clocks and restart the supervisor.

### Run the supervised loop on Expo web

Run `snapback dev snapback --expo --expo-platform web` to serve the Expo
**web** carrier without app-authored proxies or shims. The selection launches
Expo with `--web`; unlike pressing `w` in an independently started Metro
process, it establishes the supervised bootstrap first. Three
package-level paves make this work; each keeps its existing security or
custody boundary:

For both Explicit and Familiar apps, React Native Web has a renderer boundary
that Snapback cannot repair: it drops `accessibilityValue` instead of projecting
it to `aria-valuetext`, and an `<Image>` can become a CSS-background descendant
rather than a semantic image element. When those semantics matter, project the
same app state into an app-owned web accessibility layer — for example,
`aria-valuetext` for a value and an image role plus equivalent label or alt text
for imagery. Keeping that projection synchronized is the application's job
because it expresses product meaning across the RNW renderer; the drop is not a
Snapback data, transport, or client-runtime bug.

- **The bootstrap exchange serves CORS to loopback browser origins only.**
  A page served from `http://localhost:<port>` (Metro web) can complete the
  `GET /_snapback/expo/v1/bootstrap` cross-origin: the exchange echoes
  admitted `Origin` values with `Vary: Origin` and answers `OPTIONS`
  preflight, scoped exactly like the local dev CORS lane in
  [`crates/snapback-server/src/server.rs`](repo:crates/snapback-server/src/server.rs). Origin admission stays the
  boundary — non-loopback origins are never echoed, and the listener itself
  stays loopback-bound
  ([`startBootstrapExchange`](repo:packages/snapback-cli/expo-dev.mjs),
  [CORS coverage](repo:packages/snapback-cli/expo-bootstrap-exchange.test.mjs)).
- **AppState resolution is web-safe by default.** The provider resolves its
  lifecycle source through the conditional `#app-state` module: real React
  Native keeps the deep `react-native/Libraries/AppState` import, web
  resolves `AppState` from `react-native-web`, and hosts with neither refuse
  with `SNAPBACK_EXPO_COMPATIBILITY_UNSUPPORTED`. The
  `createSupervisedExpoEnvironment({ appState })` / `resolveAppState`
  injection remains the override for advanced shells.
- **The picker asset adapter accepts browser sources.** A web
  `expo-image-picker` selection — a `blob:` URI, an asset carrying a `File`,
  or a direct `File`/`Blob` — reaches the same structural-Blob upload source
  as the native `content://`/`ph://`/`file://` branches
  ([adapter tests](repo:packages/snapback-expo/asset-source.test.mjs)).

On web the client store resolves the browser IndexedDB arm (see
[the React client page](./react.md)); `registerExpoFileSystemRqsFiles` is a
native-only registration. Calling it at module scope on web throws before
React mounts and leaves a white screen, so the platform guard below is
required. These paves are proven at
package level (CORS, resolution, and adapter tests named above), and the
diary 0068 web lanes collected the end-to-end Expo-web supervised receipt
from the published packages
([`issues/closed/20260807-supervised-expo-web-carrier-unpaved.md`](repo:issues/closed/20260807-supervised-expo-web-carrier-unpaved.md)).

### Keep the proof boundary visible

The runnable example is
[`demos/expo-golden-path-fixture`](repo:demos/expo-golden-path-fixture/README.md).
Its independent
[iOS simulator receipt](repo:demos/expo-golden-path-fixture/receipts/20260806-g1-ios-simulator.md)
and
[Android emulator receipt](repo:demos/expo-golden-path-fixture/receipts/20260806-g1-android-emulator.md)
prove provider readiness, ordinary Sessions authority, a seeded live query,
an ordinary mutation returning through that query, loopback listener
enumeration, and complete supervisor cleanup. Together they complete the LLP
0176 G1 simulator/emulator exit.

This supervised loop still makes **no LLP 0064 physical-device claim**. The
Android USB mechanism has shipped with fake-inventory, exact forward,
verification, rollback/removal, and readiness-shape tests, but no live device
receipt exists. The iOS USB mechanism is not shipped: the tooling probe ruled
out `devicectl` and `iproxy` for the required reverse direction. The
[manual Online receipt checklist](repo:demos/expo-golden-path-fixture/receipts/physical-device-online-checklist.md)
keeps both facts explicit and must not be cited as a receipt. LAN/tunnel edges
remain separately gated; release bindings and per-OS release acceptance use
the separate path later on this page
([LLP 0181 §Real devices in the baseline](repo:llp/0181-zero-configuration-expo.rfc.md#real-devices-in-the-baseline),
[LLP 0181 §Release binding](repo:llp/0181-zero-configuration-expo.rfc.md#release-binding)).
Tests and advanced multi-target shells may inject a
`SnapbackExpoEnvironmentV1`, but its binding still passes the same
source-specific admission.

## Use the low-level provider when you own environment wiring

A native app carries an adopted external bearer (see
[auth/native-apps](../auth/native-apps.md) for how a trusted broker mints it —
never embed admin authority in the app). A shell that bypasses
`SnapbackExpoProvider` owns origin propagation too. The selected target's
ready descriptor or a stack-owned broker/configuration carrier must supply the
origin; never retain an incidental fixed fallback. Tandem's tested local
broker returns the selected public origin with the ordinary bearer:

```tsx source=demos/tandem-expo-bakeoff/snapback/src/backend.tsx
      const brokerPayload = await brokerResponse.json() as { bearerToken?: string; serverOrigin?: string; error?: string };
      if (!brokerResponse.ok || !brokerPayload.bearerToken || !brokerPayload.serverOrigin) {
        throw new Error(brokerPayload.error ?? 'The local Tandem identity broker refused session entry.');
      }
      activeServerOrigin = brokerPayload.serverOrigin;
      const client = createExternalSessionClient(brokerPayload.serverOrigin, { bearerToken: brokerPayload.bearerToken });
      const binding = await client.prepareReactBinding({
        generatedManifest: { schema, functions, capabilityManifest },
      });
```

The broker source derives `serverOrigin` from the same selected runtime target
that minted the session. A ready-file-driven harness uses
`readyDescriptor.serverUrl` for the same reason. The generated
`snapback.app.v1` descriptor is the preferred binding input [the React
page](./react.md) teaches; the older
`{ schema, functions, capabilityManifest }` manifest carrier remains
admitted for compatibility.

If the selected origin is unreachable and no persisted binding receipt can be
admitted, `prepareReactBinding` rejects with
`SNAPBACK_REACT_BINDING_ORIGIN_UNREACHABLE`. Its diagnostic details carry
`phase: "application-binding-preparation"` plus `attemptedOrigin`, so a UI can
separate backend reachability from credential rejection without parsing
`Failed to fetch`. Server-answered auth refusals keep their original code and
are never wrapped as connectivity.

The first preparation needs the server reachable (deployment verification).
After one successful online preparation over a registered durable store, an
offline relaunch re-admits against the persisted binding receipt
(`binding.source: 'persisted-receipt'`) — see the per-carrier matrix on
[the React client page](./react.md). Over the default in-memory fallback
nothing survives the process, so a cold offline boot cannot prepare — see
the store consequence below.

Components then use the ordinary generated-reference hook — reference plus
exact arguments (or `skip`), never a string name, a `userId`, or an
`authority` field. Identity comes from the client's custody, not from hook
arguments:

```ts source=packages/snapback-react/exact-result-types.fixture.ts
const query = useSnapbackQuery(todos, { owner: 'ada' });
if (query.status === 'ready' || query.status === 'refreshing') {
  query.data[0]?.title.toUpperCase();
}
```

`useSnapbackConnection()`, `useSnapbackMutation`, `useSnapbackQueries`, and
`useSnapbackOutbox` work as on web. The provider declares the exact
`snapback.external-store.v1` compatibility token; a different token refuses
before application data is published.

## Crypto prerequisites (React Native ships no WebCrypto)

Hermes provides no `globalThis.crypto`. The packaged client's boot path is
carrier-safe without polyfills:

- **Binding digests** (`prepareReactBinding` manifest/contract hashes) fall
  back to the parity-tested pure-JS SHA-256 when `crypto.subtle` is absent.
- **Auth storage-partition digests** use the provider-owned, hashing-only
  `expo-crypto` adapter on iOS and Android. The provider passes canonical UTF-8
  bytes to SHA-256 and never asks the application to install a crypto global.
- **Process-local labels** (provider ids, optimistic-layer ids, mutation ids,
  and storeless active-query bookkeeping) fall back to time+sequence
  uniqueness.

So a fresh Expo app on this path reaches a ready provider and a live query
with zero consumer polyfills.

Native auth keeps digest resolution and execution diagnosable. A missing or
unlinked `expo-crypto` native module refuses with
`SNAPBACK_AUTH_BOOTSTRAP_DIGEST_MODULE_UNAVAILABLE`; a module that resolves but
cannot return exactly 32 SHA-256 bytes refuses with
`SNAPBACK_AUTH_BOOTSTRAP_DIGEST_FAILED`. Neither refusal says anything about
secure randomness.

**Security-bearing random identity is never synthesized.** Surfaces that
mint unpredictable identity — seed operation ids, bundle-boot/register-mode
idempotency keys, sender-constrained proof ids, and the local store's handle
key and cross-context registration ids — require a native RNG. The optional
default store reports `reason: "secure-random-unavailable"` and stays disabled
when none is available; this does not prevent the Online client from
connecting. Explicit security-bearing operations refuse with one named,
actionable code:

```js source=packages/snapback-client/webcrypto-fallback.test.mjs
  assert.throws(
    () => newSeedOperationIdV1(),
    (error) => error?.code === 'SNAPBACK_CLIENT_WEBCRYPTO_RNG_MISSING'
      && /expo-crypto/u.test(error.message),
    'seed operation identity names the missing RNG and the polyfill path',
  );
```

To use those surfaces on RN, provide native secure randomness before
constructing the client. Expo apps can hand `expo-crypto` directly to the
store registration as shown below, without mutating `globalThis`; a global
polyfill also works. The provider's hashing-only adapter deliberately does not
forward `getRandomValues`, so successful auth boot cannot satisfy or mask this
separate requirement. Bare RN can use `react-native-get-random-values`.

## The store: useful relaunch persistence, but no durable queue claim yet

The client package never imports `expo-file-system` (Metro statically
resolves every literal specifier reachable from the root, so a platform
import would break non-Expo consumers). Instead the app hands the module in
**once, at the root, before constructing any client**:

Import `Platform` from `react-native`, then use the same guarded registration
the shipped `expo-chat` template carries:

```tsx source=packages/snapback-cli/templates/expo-chat/App.tsx
if (Platform.OS !== 'web') {
  registerExpoFileSystemRqsFiles(FileSystem, { crypto: Crypto });
}
```

The `expo-chat` scaffold (`snapback new --template expo-chat`) ships this root
registration with the `expo-crypto` and `expo-file-system` dependencies wired.

After that root registration, the default persistence ladder (explicit option → env
kill switch → browser IndexedDB → **React Native registered files** → node
filesystem → in-memory) resolves the on-device file arm for every client on
this carrier: `client.rqsStoreInfo` reports
`{ source: 'default', implementation: 'file', durable: false, reason:
'native-files-no-power-loss-cut' }`, blobs live
under the app's document container (`Paths.document/snapback-rqs/`, one
blob per server origin), and at-rest protection is the OS container plus
platform disk encryption (LLP 0090 Q4 posture — no client-side encryption
is claimed). `durable: false` is the honest LLP 0043 publication-boundary
fact, not "nothing persists": Expo's synchronous File/Directory API exposes
no fsync-style cut, so the adapter declares `powerLossDurable: false` while
the store still survives ordinary relaunch (the Node filesystem arm, which
has that cut, reports `durable: true`). Without the registration the ladder
stays in-memory when secure randomness is available, with the actionable fact
`{ implementation: 'memory', durable: false, reason:
'no-native-files-registered' }`. Without secure randomness it disables the
optional store with `{ implementation: null, durable: false, reason:
'secure-random-unavailable' }`. Neither degradation blocks Online queries;
do not claim retention over either one.

What the registered file arm enables (proven on the iOS simulator against a
release Hermes build — `demos/rn-durable-store-witness/`):

- **Cold-boot retained render** for queries that declared `rqsEligible`
  retention (see [offline retention](../sync/offline-and-retention.md)):
  relaunching offline renders the persisted rows with
  `freshness: 'retained'` under an honest non-live connection fact.
  Protected (authority-scoped) queries are never cold-retained on this arm
  and their `handle.retention` names the refusal.
- **No restart-safe queue claim:** the file adapter cannot publish mutation
  settlement durably, so automatic queueing stays disabled. Explicit
  `queue: true` refuses instead of weakening LLP 0043's custody cut.

`SnapbackExpoProvider` now carries the no-ceremony Expo SQLite acquisition
path and accepts `rqsStore` for explicit injection or `null` opt-out. At this
code landing its packaged publication manifest is empty. On iOS and Android,
an app without an already-registered legacy file carrier therefore reports
`{ source: 'default', implementation: 'memory', durable: false, reason:
'expo-sqlite-carrier-pending-qualification' }`. A registered legacy carrier
remains unchanged. Real-device iOS and Android receipts must land before any
target row can report `expo-sqlite`/`durable: true`; simulator and Node runs
are supporting evidence only.

Offline cold boot of the hook path follows the binding-receipt fallback on
this carrier: a prior successful online preparation over the registered file
store persists the digest-bound receipt, and an offline relaunch prepares
from it (`binding.source: 'persisted-receipt'`) and renders the retained
rows through the hooks. The fresh-client witness is
`demos/relay-room-bakeoff/snapback-expo/tests/offline-acceptance.mjs`; a
physical-device process-kill witness is still open
(`issues/20260806-expo-file-carrier-process-kill-witness.md`).

The **supervised** provider takes the same fallback on a cold boot with the
supervisor unreachable. A successful supervised adoption caches the
non-secret binding and public authority facts (never the bearer) in a
development-only cache
([supervised binding cache](repo:packages/snapback-expo/supervised-binding-cache.mjs)
— `localStorage` on web, an `expo-file-system` document file on device).
When the bootstrap exchange then fails at cold boot
(`SNAPBACK_EXPO_BOOTSTRAP_UNAVAILABLE`), the environment re-presents that
cached binding through the unchanged full admission — an expired binding
still refuses with `SNAPBACK_APP_BINDING_EXPIRED` and its
restart-the-supervisor remediation — and a tokenless client then prepares
from the digest-bound receipt exactly as above. The boot's ready state names
the provenance honestly: `state.preparation.source` is
`'persisted-receipt'` on this lane (`'deployment'` when live), authority
facts are the retained last-known public facts, and protected reads still
refuse offline. No matching cache or receipt keeps the original
bootstrap-unavailable refusal. Witness:
[supervised offline fallback test](repo:packages/snapback-expo/supervised-offline-fallback.test.mjs).

### Reproduce a supervised cold boot with bare Metro

The supervisor normally puts its credential-free bootstrap origin into the
Metro process before Metro builds the application bundle:

```js source=packages/snapback-cli/expo-dev.mjs fragment="supervisor origin injected into Metro's environment"
    EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN: bootstrapOrigin,
```

That environment value is the switch that makes the provider attempt the
supervised exchange and, when that exact exchange is unreachable, consider
the cached-binding fallback. It is public loopback routing, not a bearer. To
exercise the cold-offline path outside the supervisor:

1. Start `snapback dev ./snapback --expo`, launch the app, and wait for both a
   ready provider and the retained query you intend to witness. That warm run
   persists the public supervised binding cache and the separate digest-bound
   client receipt.
2. While the supervisor is still running, capture `exchangeOrigin` from
   `.snapback/expo-supervisor.json` in a second terminal:

   ```sh
   export SNAPBACK_OFFLINE_ORIGIN="$(node -e \
     "process.stdout.write(JSON.parse(require('node:fs').readFileSync('.snapback/expo-supervisor.json')).exchangeOrigin)")"
   ```

3. Stop the supervisor. Its close path removes
   `.snapback/expo-supervisor.json` and reclaims the managed backend, Metro,
   bootstrap exchange, transient binding/session material, and any Android
   port forwards. The development-only public binding cache and client receipt
   deliberately remain in the app's store.
4. Start a new bare Metro process with the captured, now-unreachable origin in
   its environment, then cold-launch the app:

   ```sh
   EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN="$SNAPBACK_OFFLINE_ORIGIN" \
     npx --no-install expo start --localhost --clear
   ```

The variable must be present **when Metro creates the bundle**. Adding it after
Metro starts, or only to the shell that launches the simulator, does not change
an already-built JavaScript bundle; stop and restart Metro with the variable.
Do not substitute an arbitrary dead URL: the provider admits only the captured
device-local HTTP origin shape.

On success, boot is ready with `state.preparation.source ===
'persisted-receipt'` and retained public rows remain non-live. An absent cache
or receipt still returns `SNAPBACK_EXPO_BOOTSTRAP_UNAVAILABLE`; an expired
cached binding still returns `SNAPBACK_APP_BINDING_EXPIRED`; and protected
reads never become available merely because public retained rows did.

Flush on background (the LLP 0091 step-5 lifecycle wiring): persistence is
debounced, so have the shell flush pending resume state when the app leaves
the foreground:

```ts fragment reason="app lifecycle composition varies by shell; flushResumeState itself is exercised by the on-device witness and the resume suites"
AppState.addEventListener('change', (state) => {
  if (state !== 'active') void liveHandle.flushResumeState();
});
```

Two sharp edges, stated plainly:

- **Construct one client for the app, not one per operation.** The on-device
  store is single-writer per origin. If a shell deliberately replaces the
  client, `await client.closeAuth()` performs final cleanup and releases a
  store resolved by the default ladder before the successor is constructed.
  A store passed through `rqsStore` remains caller-owned and must be closed by
  that caller.
- For bare React Native (no expo-file-system), implement the ten-method
  files adapter (including `syncDirectory` and the `powerLossDurable`
  declaration) against `createFileRqsResumeStore` yourself, or inject a
  store per client via the `rqsStore` option
  (`createExpoRqsResumeStore({ fileSystem })` is the packaged convenience
  for Expo modules).

## The restart-safe offline queue is not yet available on this carrier

The default memory store is volatile, and the registered Expo file store
reports `durable: false`; neither one engages LLP 0043 M2 restart-safe queue
custody. Explicit `queue: true` on either current fallback raises
`SNAPBACK_OFFLINE_QUEUE_DURABILITY_REQUIRED` instead of accepting an intent it
cannot publish durably. Transport failures are still classified by dispatch
provenance (including Expo's plain-`Error` fetch rejection), but only an
explicitly injected store whose durability contract is qualified can admit
the queue; server-answered refusals and caller aborts never queue. See
[offline and retention](../sync/offline-and-retention.md) for the mechanics
and `useSnapbackOutbox()` for rendering the queued state.

## Prove one operating-system tuple at a time

Run the profile gate with an explicit OS and receipt:

```sh
node demos/partiful-matrix/tests/acceptance/native-react-expo.mjs \
  --platform ios \
  --receipt demos/partiful-matrix/acceptance/results/step2-react-expo-ios.json
```

The OS-specific receipt must prove all seven LLP 0064 facts:

1. release carrier build and emulator/device launch;
2. generated-function initial authoritative data;
3. optimistic pending followed by authoritative settlement;
4. authority rotation followed by a fresh query;
5. background and foreground lifecycle events;
6. retained prior rows while offline, then authoritative reconnect; and
7. release-artifact exclusion of Snapback server code.

Android acceptance uses `adb reverse`; iOS acceptance launches the release app
in the selected simulator and backgrounds it by launching Settings through
`simctl`. Both bridge to a loopback development server and witness collector.
That is test infrastructure, not a production endpoint design and not
permission to expose development auth on a non-loopback listener. Each OS must
run its own build, lifecycle, reconnect, and artifact-exclusion checks; neither
receipt can substitute for the other.

## Run a headless iOS simulator proof

Use a dedicated simulator and `xcrun simctl` throughout; opening
Simulator.app is unnecessary. Record the UDID, runtime version, app bundle
digest, and every command in the receipt so the screenshot is evidence for one
exact LLP 0064 tuple rather than a generic iOS claim.

### Pre-approve the deep-link scheme with `plistlib`

The first custom-scheme open raises the iOS `Open in "<app>"?` confirmation.
A real user answers it once, but no headless `simctl` command can. The URL
never reaches the app, so an unattended witness otherwise times out without a
useful diagnostic.

Pre-approve only the dedicated test simulator, while it is **shut down**.
`plutil -replace` is the wrong tool here: it interprets the dots in
`com.apple.CoreSimulator.CoreSimulatorBridge-->{scheme}` as a key path instead
of one literal dictionary key. Python's `plistlib` assigns the literal key:

```sh
export UDID="<simulator-udid>"
export APP_SCHEME="myapp"
export APP_BUNDLE_ID="com.example.myapp"
export APPROVAL_PLIST="$HOME/Library/Developer/CoreSimulator/Devices/$UDID/data/Library/Preferences/com.apple.launchservices.schemeapproval.plist"

xcrun simctl shutdown "$UDID" 2>/dev/null || true
python3 - <<'PY'
import os
import plistlib
from pathlib import Path

path = Path(os.environ['APPROVAL_PLIST'])
path.parent.mkdir(parents=True, exist_ok=True)
if path.exists():
    with path.open('rb') as source:
        preferences = plistlib.load(source)
else:
    preferences = {}
key = f"com.apple.CoreSimulator.CoreSimulatorBridge-->{os.environ['APP_SCHEME']}"
preferences[key] = os.environ['APP_BUNDLE_ID']
temporary = path.with_suffix(path.suffix + '.tmp')
with temporary.open('wb') as destination:
    plistlib.dump(preferences, destination, fmt=plistlib.FMT_BINARY)
temporary.replace(path)
PY
```

Keep the scheme registration in app config (`expo.scheme`). For Expo Go, the
corresponding pair is scheme `exp` and bundle id `host.exp.Exponent`; for a
development or release build, use that app's own scheme and bundle id. This
pre-approval is test infrastructure, not an application entitlement or a
production bypass.

### Boot, install, dismiss Expo Go onboarding, launch, and capture

Booting, installing, launching, and taking screenshots can all remain
headless:

```sh
export APP_PATH="/absolute/path/to/MyApp.app"
export EVIDENCE_DIR="/absolute/path/to/evidence"

mkdir -p "$EVIDENCE_DIR"
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b
xcrun simctl install "$UDID" "$APP_PATH"
xcrun simctl launch --terminate-running-process "$UDID" "$APP_BUNDLE_ID"
xcrun simctl io "$UDID" screenshot "$EVIDENCE_DIR/boot.png"
```

When the carrier is Expo Go, install it first and dismiss its first-run sheet
before launch; otherwise the sheet can cover the app and consume the first
interaction:

```sh
xcrun simctl spawn "$UDID" defaults write host.exp.Exponent \
  EXDevMenuIsOnboardingFinished -bool YES
```

Run that command after Expo Go is installed and before its first launch. It is
not needed for a standalone development or release app.

### Use deep links as a tap-less drive channel

`simctl openurl` is reliable once the scheme is approved:

```sh
xcrun simctl openurl "$UDID" \
  "myapp://proof/send-message?fixture=hello-1"
xcrun simctl io "$UDID" screenshot "$EVIDENCE_DIR/message-sent.png"
```

For an unattended proof build, route a small closed set of `proof/*` URLs from
the ordinary React Native `Linking` listener to the same actions the UI invokes
(send, navigate, background-test setup), then emit the normal in-app/server
witness. A record id arriving in any deep-link or route URL is untyped: admit
it into the generated branded id type with `admitSnapbackId(table, value)`
from `@expo/snapback-client` (wire-grammar admission only — it deliberately
does not claim the row exists) instead of casting. Do not let the drive channel call private backend seams, skip
authority, or declare success by receiving the URL alone. Keep secrets out of
URLs, gate the channel to the proof build, and pair every drive command with an
independent observation or screenshot. Invitation/share URLs remain real
product flows; the `proof/*` convention is only a tap-less test director.

Finally, prefer the newest admitted runtime and record it. The iOS 26.3
simulator has a CoreText defect that can render astral emoji as tofu even when
the semantic string is correct; iOS 26.5 renders the same emoji correctly.
Treat a 26.3-only glyph difference as environment evidence, not a Snapback
data corruption claim.

## Handle native reconnect honestly

React Native WebSockets may emit `error` without the browser-style follow-up
`close`. The shared stream manager treats that error as connection loss,
refreshes the connection grant, and re-enters through a fresh
snapshot-with-subscribe. During the gap, keep the prior rows visible under a
`stale` or disconnected connection fact; never relabel them live.

`bindSnapbackAppLifecycle(AppState, handle)` from `@expo/snapback-client`
(re-exported by `@expo/snapback-react`) serializes AppState changes onto
anything with `pause()`/`resume()` methods — a **headless**
`client.liveQuery` handle you opened yourself, or the React provider itself,
which exposes exactly that app-lifecycle seam at provider granularity
(`provider.pause()` / `provider.resume()`;
[the React client page](./react.md)). `SnapbackExpoProvider` already binds
AppState to those provider methods internally, so on the supervised path do
not add a second AppState binding — leave the provider attached and let the
stream manager's reconnect own transport recovery. A custom shell that owns
its environment wiring binds host lifecycle once at the provider boundary
([framework bindings](./framework-bindings.md)).

A token-resume re-establishment can complete **rowlessly**: the HTTP
acknowledgement names the new subscription while the authoritative
`current_as_of` or replay frame travels on the durable socket. Either transport
may arrive first. The client buffers the bounded pre-ack durable window,
installs the response's subscription ID, and replays only matching frames in
arrival order. During that window, persisted rows remain `retained` and the
held server-minted token continues to prove `retention.retainable`; the durable
completion advances them to `current` and refreshes both the token and the
retention fact. If the bound overflows, the client discards the unproved prefix
and performs one tokenless fresh-snapshot resubscribe instead of claiming
current state.

This ordering rule is carrier-independent, but RN reconnect timing exposed the
original defect. The shared memory/Expo resume suite covers WebSocket
completion overtaking the HTTP response and overflow recovery. The earlier
~2s Expo reconnect-loop investigation is resolved under
`issues/closed/20260801-0137-a1expo-f7-rn-connection-cycles.md`; it is no longer
a current limitation.

## Build an EAS dev client for an app nested inside this repository

`eas build` resolves its project root at the nearest **Git root**, not the
nearest Expo app. Run it from an app nested inside this monorepo (a
`demos/<bakeoff>/<arm>`, an internal prototype) and it archives and uploads
the entire Snapback checkout — the Rust runtime, `vendor/ibex`, every other
demo, and all workspace `node_modules` — a multi-minute upload for a
kilobyte-scale app. `.easignore` and `EAS_NO_VCS=1` do **not** change that
root resolution; this reproduced independently in two bakeoffs
(`demos/tandem-expo-bakeoff`, `demos/relay-room-bakeoff`), and no first-party
nested-root configuration is documented for it. The supported pattern is to
**stage the app outside the checkout and build from the staged copy**, which
both bakeoffs converged on and the kit now paves:

```sh
# Stage <app-dir> into an out-of-checkout temp directory, bun install there,
# and run `eas build` from the staged copy (paid EAS service).
node demos/_kit/eas-stage-build.mjs demos/tandem-expo-bakeoff/snapback/native-shell \
  --platform ios --profile development

# Free preflight: stage and report only (file count, size, staged path kept
# for inspection); never installs dependencies or contacts EAS.
node demos/_kit/eas-stage-build.mjs <app-dir> --stage-only
```

The helper excludes `node_modules`, `.expo`, `.git`, `dist`/`dist-*`,
`.snapback`, and the sibling restore lock at every depth, refuses any staging
directory that is still inside a Git checkout, and keeps the small native
"shell" pattern workable: the shell carries only
native dependencies and EAS config while loading the product bundle from the
parent Metro server (see
[repo:demos/tandem-expo-bakeoff/scripts/build-ios-dev-client](repo:demos/tandem-expo-bakeoff/scripts/build-ios-dev-client)
for an arm-selection wrapper). Staging behavior is unit-verified by
[repo:demos/_kit/tests/repo-layout-unit.mjs](repo:demos/_kit/tests/repo-layout-unit.mjs);
the EAS build itself is an external paid service and is not CI-verified.

## Anti-patterns

- **Do not pass `userId`/`authority` to hooks or use the string-name object
  form.** The checkpoint-era `useSnapbackQuery({ provider, query, userId })`
  bridge teaches dev-mode client-asserted identity; the packaged surface is
  the generated-reference hook under a provider whose client owns custody.
- **Do not build a dev-auth multi-persona app on the packaged provider.** Use
  sessions and one adopted session per persona; the legacy per-call-user bridge
  is not the supported composition.
- **Do not route `expo start` through `--client-command` when the app expects
  supervised boot.** Select `--expo --expo-platform web`; the generic arm does
  not inject or publish the bootstrap exchange.
- **Do not give `createExternalSessionClient` a fixed dev-port fallback.** A
  custom broker/client shell owns origin propagation and must use its selected
  ready descriptor or stack-owned configuration carrier.
- **Do not polyfill RNG with `Math.random`.** When
  `SNAPBACK_CLIENT_WEBCRYPTO_RNG_MISSING` names a missing primitive, install
  a real RNG polyfill (`expo-crypto`).
- **Do not claim cold-boot retention without the registered file
  store.** Unregistered, the store is in-memory; either way
  `client.rqsStoreInfo` is the honest fact to render — including its
  `durable: false` power-loss caveat on this carrier.
- **Do not transfer evidence between operating systems.** Native evidence is
  per immutable surface/OS profile.
- **Do not call Online local-first or Parity.** No local handler execution is
  claimed.
- **Do not bundle the Snapback server into the carrier.** Native packages
  contain public generated client artifacts only.
- **Do not ship emulator port bridging as endpoint security.** It is local
  acceptance infrastructure only.
- **Do not run `eas build` directly from an app nested in this checkout, and
  do not try to fix it with `.easignore`.** EAS archives the whole monorepo
  from the Git root either way; stage outside the checkout with
  `demos/_kit/eas-stage-build.mjs` (see the nested-build section above).

---

<!-- snapback-guide-source: guide/clients/framework-bindings.md -->
---
title: Framework bindings
id: clients.framework-bindings
order: 8
audience: agent-first
capabilities: [clients.framework-bindings]
authorities: [llp/0012-headless-integration-contract.spec.md, llp/0034-contract-source-seam-provider-side.rfc.md, llp/0053-authorization-invalidation.rfc.md, llp/0064-native-client-surfaces.rfc.md, packages/snapback-client/external-store.mjs, packages/snapback-client/index.mjs, packages/snapback-react/index.mjs]
examples: [demos/partiful-matrix/surfaces/vanilla]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:ef95f794e1201fad76046e3f04ccc1fd42a1a5326f23d9cc8c32b9639755ed6d
---

# Framework bindings

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

A query hook is the small part. The [React](./react.md) and
[Contract](./contract-adapter.md) bindings ship today; no
first-party Vue, Svelte, or Solid package is claimed. Those systems can
adapt “current rows plus subscribe” in well under 100 lines. A valuable
Snapback binding centralizes the lifecycle and failure behavior that otherwise
fails silently.

This page also owns the map of the **framework-neutral seam layer** — the
twins that let a non-React shell reach every React capability. On the
provider: `observeSnapbackQueries`, `observeSnapbackPresence`,
`observeSnapbackOutbox` ([React page](./react.md)) and
`observeSnapbackSurface`/`provider.surface(...)`
([surfaces](./surfaces.md#observe-the-same-surface-without-react)); actions:
`invokeSnapbackMutation` and `invokeSnapbackCommand`
([React page](./react.md#run-a-mutation)). Below the provider entirely:
`createCommandClient` over a bare client and the Micro entry-point family
([headless client](./headless.md)).

## Build on the external store

Use `snapback.external-store.v1` from `@expo/snapback-client/external-store`.
It owns canonical query identity, same-key sibling sharing, late-handle
resolution, stale-generation fencing, error/connection snapshots, optimistic
settlement, refcounts, and final disposal
([the headless client's external-store contract](./headless.md#project-live-state-into-a-framework-neutral-external-store)).
Project that store into the framework's native subscription primitive.

Do not add a second query cache, socket owner, or mutation settlement model.

## Own the hard transitions

A binding must cover:

| Transition | Required behavior |
| --- | --- |
| identity changes | retire predecessor scope, synchronously blank protected rows, subscribe under successor authority |
| socket loss | surface stale/connecting state, obtain a fresh grant when needed, fresh subscribe with supersession |
| background | call the provider handle's `pause()`; release demand and quiesce retries |
| foreground | call `resume()`; reconcile authority, reconnect, and fresh-subscribe |
| invalidation | publish the atomic replacement only after version guard; ACK after apply |
| transient reservation conflict | retry only the exact typed refusal within the client budget |
| terminal auth | expose an error state and blank predecessor materialization before callbacks resume |
| scope disposal | release every handle even if an observer throws |

High-level handle disposal is idempotent after its own logout or terminal
authority retirement. Keep that exact-handle behavior in the binding; do not
catch arbitrary low-level `unsubscribeLive` errors, because foreign ids and
ownership/session mismatches remain fail-closed. View unmount may ignore the
returned cleanup task after synchronous local teardown; lifecycle tests and
operational cleanup should await it so genuine typed failures stay visible.

The headless JS handle already supplies `pause()`, `resume()`, `dispose()`,
connection events, and error state. Native clients expose equivalent
provider-level lifecycle hooks. Bind host lifecycle once at the provider
boundary, not in every component.

## Keep errors as state

A rejected setup promise is not enough: after initial render, reconnect,
authorization, and server diagnostics are ongoing state. The framework
projection should expose rows, connection phase, and the latest structured
error together. Preserve the diagnostic code; do not reduce it to a boolean.

## Test the binding, not its syntax

The acceptance suite should prove identity rotation, background/foreground,
socket-loss re-grant, version regression refusal, typed retry, observer-throw
cleanup, and final unmount disposal. A hook unit test that only receives one
row update does not establish a useful binding.

## Anti-patterns

- Do not publish a framework package whose only value is a query hook.
- Do not let view mount/unmount own server demand directly.
- Do not preserve predecessor rows across an authority change.
- Do not swallow structured diagnostics into console logging.
- Do not reconnect a socket without re-establishing its subscriptions.

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
| Expo / registered file store | Yes — the file arm settles writer election before its writer check | Yes, proven for a fresh client in the same process; a physical-device process-kill witness is still open (`issues/shelved/20260806-expo-file-carrier-process-kill-witness.md`) | `demos/relay-room-bakeoff/snapback-expo/tests/offline-acceptance.mjs` |
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

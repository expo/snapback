---
title: The React client
id: clients.react
order: 2
audience: agent-first
capabilities: [clients.react]
authorities: [llp/0012-headless-integration-contract.spec.md, llp/0064-native-client-surfaces.rfc.md, llp/0090-resumable-query-snapshots.rfc.md, llp/0108-inline-handlers-and-result-contracts.spec.md, llp/0114-first-class-react-and-query-groups.spec.md, llp/0107-react-presence-and-optimistic-lifecycle.spec.md, llp/0112-generated-query-group-bundle-adoption.spec.md, llp/0157-composition-algebra-and-completeness.spec.md, packages/snapback-client/canonical-client-value.mjs, packages/snapback-client/react-binding.mjs, packages/snapback-contract/result-contract-validator.mjs, packages/snapback-react/index.mjs, packages/snapback-react/index.d.mts, packages/snapback-react/exact-result-types.fixture.ts]
examples: [packages/snapback-cli/templates/react, demos/chirp, demos/signal-desk/src/backends/snapback.ts, demos/signal-desk/tests/react.mjs, demos/signal-desk/acceptance/results/react-presence.v1.json, demos/messaging-snapback/src/lib/useTyping.ts, packages/snapback-react/binding-development-sync.test.mjs, packages/snapback-react/package.test.mjs, packages/snapback-react/optimistic.test.mjs, packages/snapback-react/presence.test.mjs, packages/snapback-react/offline.test.mjs, packages/snapback-react/exact-result-types.fixture.ts]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-08
reviewed-commit: dcc3bd2a6192f5b6c9964786e9e5e0cdd185c219
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

Prepare the connected deployment before rendering, then construct a provider
from that immutable binding:

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

- `status`: `pending | ready | refreshing | error | skipped`;
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
  [offline retention](../sync/offline-and-retention.md) for the opt-in that
  makes a query retainable.

Same-reference, same-argument siblings under one provider share one store and
one upstream subscription while retaining independent React consumers.
Different provider objects, complete generated references, or canonical
arguments stay isolated.

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

```ts fragment reason="mutation names and fields come from the application schema"
const addTask = useSnapbackMutation(api.addTask);
const taskId = await addTask({ incidentId, body: 'Check headers' });
```

The returned function infers exact arguments and the unwrapped result from the
generated mutation reference. Runtime refusals reject with Snapback's
structured diagnostic. Without React,
`invokeSnapbackMutation(provider, ref, args, { optimistic })` runs the exact
hook-path admission and mutation, and
`invokeSnapbackCommand(provider, commandRef, inputs)` starts a generated
[command task](./surfaces.md#run-a-command-and-read-its-truthful-outcome)
over the same provider-owned command client. The hooks for asset-bearing
commands (`useSnapbackCommand`) and whole-screen compositions (`useSurface`)
live on [application surfaces](./surfaces.md).

For a mutation whose optimistic projection updates a currently authoritative
live query, declare that projection beside the hook:

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

The optimistic layer is installed only over the provider's already-current
authoritative query store and is validated against the generated result
contract before network work. Overlapping attempts rebase in invocation order.
Rejection removes only its own layer and recomputes over the newest
authoritative base. An HTTP response validates and settles the mutation
promise, but is not itself live-query authority; `isAuthoritative`, when
present, retires that layer only after a matching validated live delivery.
There are at most 256 pending optimistic layers per store.

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

The `optimistic:` projection **updates rows that already exist** in the
authoritative store. It cannot fabricate a new row for a create mutation
whose canonical `_id` the server mints: the projected rows are validated
against the generated result contract, and the row identity is a branded
generated ID that only the server produces — TypeScript refuses a forged
provisional ID, and that refusal is deliberate (a fake ID could leak into
mutation arguments and durable state). When a **genuine** external id
arrives through an untyped boundary — a route param, a deep-link token —
admit it with `admitSnapbackId(table, value)` from `@expo/snapback-client`
rather than casting: it proves only the bounded wire grammar and
deliberately claims nothing about row existence. An append-shaped reducer
(`rows => [...rows, capturedRow]`) is also not idempotent over its own
output, so it trips the development replay advisory above.

The current paved shape is a **component-local pending sidecar keyed by an
app-generated intent key** — never a forged row ID:

```tsx fragment reason="illustrative pending-sidecar shape; row fields come from the application schema"
let intentSequence = 0; // module-local; the key needs uniqueness, not unpredictability
const [pending, setPending] = useState<Array<{ intentKey: string; title: string }>>([]);
const createTask = useSnapbackMutation(api.createTask);

async function submit(title: string) {
  const intentKey = `intent-${Date.now()}-${intentSequence++}`; // app-local presentation key only
  setPending((rows) => [...rows, { intentKey, title }]);
  try {
    await createTask({ title });
  } finally {
    // Success or rejection: remove exactly this pending item. The canonical
    // row (with its server-minted ID) arrives by live delivery.
    setPending((rows) => rows.filter((row) => row.intentKey !== intentKey));
  }
}
```

The time+sequence key is carrier-safe: `crypto.randomUUID()` also works on
web, but Hermes ships no `globalThis.crypto`
([React Expo crypto prerequisites](./react-expo.md#crypto-prerequisites-react-native-ships-no-webcrypto)),
and a presentation-only key needs no unpredictability.

Render the pending items beside the query rows, marked as unsettled. On
rejection, only the corresponding pending item disappears; on success the
authoritative row replaces it through the ordinary live update. This is the
smallest hook-native shape when a pending item does not need to participate in
query filtering, ordering, counts, or relationships.

This is honestly less composable than a provider-owned optimistic insert: the
pending row does not participate in the query store's filtering, sorting, or
counting. When the create **does** need those semantics, the shipped
framework-neutral generated-IR path uses
`SnapbackClient.createOptimisticMutationView`, durable protocol intent
identity, and the server's logical-mint map without forging a canonical id;
follow the CI-verified
[optimistic-create recipe](../recipes/optimistic-create.md). That path is
lower-level than this provider/hook.

A first-class typed intent-ID optimistic create directly in the provider's
canonical query store — reconciling one intent to one canonical row under
ambiguous retry — remains an explicit GAP
(`clients.optimistic-create` in the [capability index](../capabilities.md);
issue
[20260808-first-class-react-optimistic-create](repo:issues/20260808-first-class-react-optimistic-create.md)).

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
try {
  await reserveSlot({ slotKey, resourceId });
} catch (error) {
  const diagnostic = (error as { diagnostic?: { code?: string; details?: { appCode?: string } } }).diagnostic;
  if (diagnostic?.code === 'SNAPBACK_APP_REFUSAL' && diagnostic.details?.appCode === 'SLOT_TAKEN') {
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

`useSnapbackPresence` is the React hook for generated **ephemeral**
collections — including presence, typing indicators, and cursors. Pass a
generated connection-keyed ephemeral reference. A non-skipped value is
declarative managed intent: the provider publishes it after the authoritative
room snapshot and refreshes it within the generated TTL and rate limits. The
[ephemeral-state reference](../realtime/ephemeral-state.md#find-the-react-hook-from-ephemeral-vocabulary)
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

`observeSnapbackPresence(provider, reference, options, listener)` is the
framework-neutral twin (the same pattern as `observeSnapbackOutbox` below).
A component that actively produces an ephemeral value outside managed
presence registers with `useEphemeralRepublisher(reference, callback)` — the
React wrapper over the client's `registerEphemeralRepublisher` that re-asks
the mounted producer for its value after an authority replacement blanks the
room; disposal follows the component lifecycle.

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

The hooks project the headless client's own offline facts — they surface,
never invent. An offline cold boot of a retainable query renders its
persisted rows with `freshness: 'retained'` and `status: 'refreshing'`
(never `'ready'`), holding the `stale` connection axis, and settles to
`freshness: 'current'` when the authoritative answer arrives:

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
- `replaying`: whether the single-flight drain is currently running;

plus a `replay()` action that drains through the client's single-flight
`replayQueuedMutations()`. The stranded/quarantine semantics and their
recovery methods are on
[offline retention](../sync/offline-and-retention.md#replay-and-settle-without-guessing)
(and its
[migration-quarantine boundary](../sync/offline-and-retention.md#migration-boundaries-quarantine-dont-fail)).
Render a queued-changes badge from it next to
retained rows — the retained rows themselves stay **pre-intent** (this arm
runs no local execution, so queued writes are never fabricated into the
frame; LLP 0090 D3's rendering note). A client without the projection seam
refuses with `SNAPBACK_REACT_OUTBOX_UNSUPPORTED` instead of reporting a
false empty queue. `observeSnapbackOutbox(provider, listener)` is the
framework-neutral twin for acceptance adapters.

An optimistic mutation projection still requires a **current authoritative**
store: installing an optimistic layer over a retained-only frame refuses
with `SNAPBACK_REACT_OPTIMISTIC_STORE_MISSING`.

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

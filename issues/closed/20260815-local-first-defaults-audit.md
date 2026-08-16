# Audit: make local perceived performance the default client posture

**Opened:** 2026-08-15 · **Severity:** P3 program audit ·
**Source:** author performance-direction ruling 2026-08-15

Direction: persisted query facts, automatic optimistic reducers, offline
outbox settlement, and local query evaluation should be the DEFAULT across
React, Expo, and native clients — not opt-in capabilities. InstantDB is the
benchmark: if the UI paints correctly in under a frame, a 70 ms vs 120 ms
server settlement difference matters much less.

Snapback already ships pieces of this (optimistic rebase, outbox settlement,
materialization store, external store, local read admission — see
`guide/reference/expo-snapback-client--*.md`). The gap is *defaultness* and
coverage, not existence.

Ask: audit each client arm (React, Expo, Swift, headless) against the four
capabilities; produce a matrix of exists/default/opt-in/missing; file one
follow-up per gap where making it the default is safe, and an RFC where the
default change has semantic consequences (e.g. local evaluation divergence
vs LLP 0209 §8 server/local agreement). Cross-reference LLP 0190 (D3 seams)
— retained facts and local replicas are D3's rungs and this audit should not
fork that ownership.

Related: LLP 0190, LLP 0209 §8, guide client reference pages, LLP 0198
(strategic frame: Instant-like immediate/offline UX as a headline property).

## Audit (2026-08-16)

This audit treats a capability as **default** only when an ordinary client on
a qualified carrier receives the behavior without selecting a different hook,
setting a capability flag, or starting a controller. Fail-closed owner,
authority, completeness, and carrier admission are prerequisites, not opt-ins.
A default store alone therefore does not make its query facts default.

| Client arm | Persisted query facts | Automatic optimistic reducers | Offline outbox settlement | Local query evaluation |
| --- | --- | --- | --- | --- |
| React | **exists, opt-in** | **partial** — automatic for one generated `Insert`; general path is app-authored | **exists+default** on a qualified durable writer store when the target advertises `offline_mutation_replay` | **partial** — owner-gated result transforms only |
| Expo | **exists, opt-in** — ordinary relaunch only; first-party file carrier is not power-loss-qualified | **partial** — same narrow React generated-`Insert` path | **partial** — shared queue/drain exists, but the first-party carrier fails its durability gate | **partial** — API exists, but the first-party carrier is explicitly unadmitted |
| Swift | **missing** | **missing** | **missing** | **missing** |
| Headless | **exists, opt-in** | **partial** — generated operation exists, but presentation requires an explicit view | **exists, opt-in** — queueing defaults on; lifecycle drain does not | **partial** — explicit owner-gated result transforms only |

### Evidence by cell

#### React

- **Persisted query facts — exists, opt-in.** The client resolves IndexedDB in
  browsers by default (`rqsStore: undefined`) and `persistResume` defaults to
  `true` in `packages/snapback-client/index.mjs`; the ladder and opt-outs are
  documented in `guide/sync/offline-and-retention.md`. Query admission is
  nevertheless explicitly opt-in: public declarative queries use
  `defineLiveQuery({ auth: 'public', authorityIndependent: true, ... })`,
  protected generated queries use `retainable: true`, and demand that must
  survive without a mounted handle uses
  `client.registerQuery(ref, { registrationId: '...', retentionRequest: 'durable', ... })`.
  The guide says
  an app otherwise gets “ZERO offline retention.”
- **Automatic optimistic reducers — partial.** The special
  `useSnapbackOptimisticCreate(ref, { query, args, select })` surface derives
  the local operation, but only for exactly one locally executable generated
  `Insert` into the queried table (`guide/clients/react.md` and
  `packages/snapback-react/implementation.mjs`). Ordinary
  `useSnapbackMutation` still needs the app-authored
  `optimistic: { query, args, update, isAuthoritative }` option, optionally
  shortened with `projectRecordFields(...)` (`guide/clients/react.md`).
- **Offline outbox settlement — exists+default on a qualified durable writer
  store.** `offlineQueue: 'auto'` and per-call `queue: 'auto'` are constructor
  and mutation defaults in `packages/snapback-client/index.mjs`.
  `SnapbackProvider` defaults `outboxDrain="auto"` and owns the controller in
  `packages/snapback-react/implementation.mjs`; the exact manual escape hatch
  is `outboxDrain="manual"` (`guide/clients/react.md`; LLP 0218 §4.3). The
  implementation correctly refuses queue custody when the store is not a
  durable writer or the target does not advertise `offline_mutation_replay`,
  so “default” is conditional on both safety prerequisites.
- **Local query evaluation — partial.** The shipped entry point is
  `client.evaluateLocalResultTransform(generatedReference, {
  transformPlan })`, admitted only when the owner-issued reference carries
  retention class `result-transform-snapshot-v1`
  (`guide/sync/offline-and-retention.md`,
  `packages/snapback-client/result-transform.d.mts`, and
  `packages/snapback-client/index.mjs`). It filters/orders/limits a
  proof-verified retained result; it never evaluates the query's source-row
  plan and has no default React query-hook path.

#### Expo

- **Persisted query facts — exists, opt-in, with an ordinary-relaunch
  ceiling.** Apps must call
  `registerExpoFileSystemRqsFiles(FileSystem, { crypto: Crypto })` before
  constructing the client, then opt individual queries in through the same
  `authorityIndependent: true`, `retainable: true`, or
  `retentionRequest: 'durable'` surfaces as React
  (`guide/clients/react-expo.md` and
  `guide/sync/offline-and-retention.md`). The shipped adapter in
  `packages/snapback-client/rqs-store-expo.mjs` declares
  `powerLossDurable: false`; the resolved fact is
  `{ implementation: 'file', durable: false, reason:
  'native-files-no-power-loss-cut' }`. It retains ordinary relaunch data, but
  does not earn a power-loss durability claim.
- **Automatic optimistic reducers — partial.** Expo rides the React provider
  and hooks (`packages/snapback-expo/provider.mjs`). Therefore it has the same
  exact opt-in hook, `useSnapbackOptimisticCreate(...)`, and the same
  single-generated-`Insert` ceiling; other mutations require
  `useSnapbackMutation(..., { optimistic: ... })`
  (`guide/clients/react.md`).
- **Offline outbox settlement — partial.** `SnapbackExpoProvider` defaults
  `outboxDrain="auto"` in `packages/snapback-expo/provider.mjs`, and the shared
  client contains queue/replay machinery. But
  `packages/snapback-client/index.mjs` requires
  `store.durability().durable === true`; the first-party Expo adapter always
  reports `false`. On the ordinary `queue: 'auto'` path,
  `#offlineQueueStore(false)` returns `null`, the client declines local
  custody, and the original network failure remains caller-visible.
  `SNAPBACK_OFFLINE_QUEUE_DURABILITY_REQUIRED` is raised only by required
  paths such as explicit `queue: true`. Registering the adapter is therefore
  not an opt-in that unlocks settlement. Only injecting a separately qualified
  custom `rqsStore` into the underlying `SnapbackClient` can currently cross
  the gate; there is no first-party qualified Expo option.
- **Local query evaluation — partial.** Expo receives the shared
  `evaluateLocalResultTransform(...)` method, but
  `guide/sync/offline-and-retention.md` explicitly lists the current
  non-durable Expo carrier among the
  `SNAPBACK_LOCAL_EVALUATION_UNADMITTED` refusals. A separately qualified
  custom `rqsStore`, owner-issued `result-transform-snapshot-v1` reference,
  and explicit method call are required; the stock arm cannot answer locally.

#### Swift

- **Persisted query facts — missing.** `guide/clients/swift.md` says the
  in-repository SwiftPM proving client claims only `poll/local` and
  `live/local`, not offline `Parity`. Its `StateMachine.seedRetainedRead(...)`
  model in
  `clients/swift/SnapbackClient/Sources/SnapbackClient/StateMachine.swift` is
  process memory used for protocol conformance; there is no persistent store,
  cold-start load, or public retained-query API.
- **Automatic optimistic reducers — missing.** The public
  `SnapbackClient.mutate(...)` in
  `clients/swift/SnapbackClient/Sources/SnapbackClient/SnapbackClient.swift`
  is a direct HTTP request and carries no generated mutation evaluator,
  optimistic layer, or rebase view.
- **Offline outbox settlement — missing.** The Swift method named
  `drainOnce()` drains the server's realtime delivery outbox for a live
  connection; it is not a client mutation queue. The fixture-facing
  `seedReplayQueue(...)`/`noteMutationSettled(...)` state in
  `StateMachine.swift` is not wired to mutation persistence or reconnect
  replay.
- **Local query evaluation — missing.** Swift's `query(...)` is a server POST,
  and `guide/clients/swift.md` claims no offline parity or local-store
  evaluator. Here `poll/local` and `live/local` describe a client talking to a
  local Snapback target, not queries evaluated on the device.

#### Headless

- **Persisted query facts — exists, opt-in.** The same
  `SnapbackClient` default ladder supplies browser IndexedDB or Node durable
  files (`packages/snapback-client/rqs-store-default.mjs`), but the exact
  per-query opt-ins remain `authorityIndependent: true`, `retainable: true`,
  or `client.registerQuery(ref, { registrationId: '...', retentionRequest: 'durable' })`
  (`guide/sync/offline-and-retention.md`).
- **Automatic optimistic reducers — partial.** Generated local-executable IR
  automatically carries an `optimisticOperation` in
  `packages/snapback-client/generated-mutation-ir.mjs`, but headless
  `mutate()` reports a queued operation with `presentation: 'withheld'`.
  Applications must explicitly call
  `client.createOptimisticMutationView({ authoritativeRows, connected })` and
  consume that view (`guide/clients/headless.md` and
  `packages/snapback-client/index.mjs`). The public client resolves the outbox
  store internally; the two-argument `(outboxStore, options)` form belongs
  only to the internal store runtime. That is machinery, not a default reducer
  attached to query results.
- **Offline outbox settlement — exists, opt-in.** Durable queueing defaults to
  `offlineQueue: 'auto'`/`queue: 'auto'`, but a non-React host must call
  `client.startOutboxDrain()` once per client/store lifecycle and stop the
  returned controller at teardown (`guide/clients/headless.md` and
  `packages/snapback-client/index.mjs`). The controller's
  `{ automatic: false }` option disables scheduling after it is installed; it
  does not remove the initial lifecycle opt-in.
- **Local query evaluation — partial.** Headless exposes the same explicit
  `client.evaluateLocalResultTransform(...)` owner-gated surface
  (`guide/clients/headless.md`). It has the same retained-result-only ceiling,
  `result-transform-snapshot-v1` admission, and IndexedDB/Node-file carrier
  restriction described above; it is not a general or default local query
  evaluator.

### Ownership and consequence finding

LLP 0190 §3.1 already owns retained-fact admission and local evaluation; its
Stages D3.2–D3.8 remain the execution ladder. This audit does not create a
parallel read-side design. LLP 0209 §8 supplies the D2–D3 agreement boundary:
one IR evaluated on server and client must produce byte-identical results and
completeness labels or return `unknown`, and live deltas are not
replica-applicable until D3 defines continuity, predecessor, and gap-to-replace
rules.

An RFC is required. Default local evaluation, protected retention, automatic
optimistic presentation, durable mobile custody, and automatic headless replay
all have real semantic consequences. LLP 0270 decides the cross-arm default
posture and delegates the mechanisms to LLP 0190, LLP 0209, LLP 0155/0129,
LLP 0166, and LLP 0218.

---

**Resolved 2026-08-16.** Audit complete (matrix above, verified cell-by-cell
by a dual-family review loop — artifacts in
`llp/reviews/0270-local-first-client-defaults.*`). Seven gap tickets filed
(`issues/20260816-default-retained-query-facts-js-clients.md`,
`…-default-generated-optimistic-projection.md`,
`…-default-headless-outbox-settlement.md`,
`…-qualify-expo-local-first-carrier.md`,
`…-complete-d3-default-local-query-evaluation.md`,
`…-swift-local-first-read-path.md`, `…-swift-local-first-write-path.md`).
The default posture RFC is `llp/0270-local-first-client-defaults.rfc.md`
(Draft, v0.2); acceptance is the author's call.

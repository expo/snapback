<!-- Generated sync section flat projection by scripts/generate-guide-manifest.mjs. Never hand-edit. -->

---

<!-- snapback-guide-source: guide/sync/offline-and-retention.md -->
---
title: Offline retention and mutation replay
id: sync.offline-and-retention
order: 1
audience: agent-first
capabilities: [backend.single-table-v1, sync.offline, sync.offline-js-arm, sync.offline-js-arm-protected, sync.offline-js-arm-sessions, sync.local-persistent-store, clients.outbox-drain, clients.dev-diagnostics]
authorities: [llp/0043-offline-replay-retention.rfc.md, llp/0052-contract-update-economy-and-host-state.rfc.md, llp/0055-agent-principals-and-scoped-grants.rfc.md, llp/0090-resumable-query-snapshots.rfc.md, llp/0107-react-presence-and-optimistic-lifecycle.spec.md, llp/0110-bounded-children-and-activity-patterns.spec.md, llp/0129-local-first-program.plan.md, llp/0133-local-settlement.spec.md, llp/0135-sequence-allocation-and-snapshot-batch.spec.md, llp/0157-composition-algebra-and-completeness.spec.md, llp/0166-local-persistent-store.spec.md, llp/0218-outbox-settlement-contract.rfc.md, src/local-persistent-store-publication.v1.json, packages/snapback-codegen/index.mjs, packages/snapback-client/local-read-admission.mjs, packages/snapback-client/materialization-bridge.mjs, packages/snapback-client/protected-query-retention.mjs, packages/snapback-client/react-binding.mjs, packages/snapback-client/assets.mjs, tests/acceptance/local-store-carrier-exit-v1.mjs, packages/snapback-contract/index.mjs, packages/snapback-contract/offline-replay.test.mjs, packages/snapback-client/index.mjs, packages/snapback-client/external-store.mjs, packages/snapback-client/external-store.test.mjs, packages/snapback-client/outbox-shared.mjs, packages/snapback-client/outbox-store.test.mjs, packages/snapback-client/outbox-drain.test.mjs, packages/snapback-client/rqs-resume.test.mjs, packages/snapback-react/implementation.mjs, packages/snapback-react/index.mjs, packages/snapback-react/offline.test.mjs, packages/snapback-expo/supervised-environment.mjs, demos/browser-local-first/tests/acceptance/browser-public-witness.mjs, demos/warble/snapback/functions.mjs, demos/warble/tests/acceptance/offline-local-first.mjs, llp/0219-client-dev-diagnostics-channel.rfc.md, packages/snapback-client/client-diagnostics.mjs]
examples: [demos/triage-graph, demos/card-game, demos/todo-v2/surfaces/contract, demos/public-dashboard, demos/warble, demos/browser-local-first, packages/snapback-contract/agent-authority-contract.test.mjs, packages/snapback-react/offline.test.mjs, packages/snapback-client/rqs-resume.test.mjs, tests/acceptance/desktop-sidecar-v1.mjs, packages/snapback-react/dev-diagnostics-acceptance.test.mjs, packages/snapback-client/client-diagnostics.test.mjs]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-10
reviewed-authorities-digest: sha256:8247e5bbf4236ef656eecd9f697afa2060fe506b082669a611b15f23af3f7a86
---

# Offline retention and mutation replay

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

> **Published-package availability.** Since `@expo/snapback-*@0.1.11`,
> public-package builds advertise `single_table_v1` when the runtime package's
> packaged-store qualification receipt is present (shipped inside the package
> per the 2026-08-06 LLP 0110/0166 amendment): the platform cold-retention
> path this page teaches works from a plain npm install. Contributor-source
> builds advertise it via the store publication carrier as before.

The Contract adapter can retain the last authoritative query snapshot, render
derived optimistic changes while offline, and replay a durable mutation outbox
in order after reconnect. It reports this as `Parity` only when every
required proof is present; otherwise the surface stays honestly `Online`.

## Route by workload shape: which retention mechanism is yours?

This page covers four retention mechanisms with different survival rules —
the resume channel (public platform cold retention), lease-bounded protected
retention, programmatic registrations, and the materialization store. Pick by
the shape of the query you want to
survive, not by trying mechanisms until one stops refusing. The eligibility
constraints come first because they decide the whole route.

**Platform cold retention (`rqsEligible`) — the constraints, before any
example.** A live query cold-retains on the JS arm only when ALL of these
hold:

- it is a **declarative** `defineLiveQuery` over **one table**
  (`defineJsLiveQuery` handlers are never eligible — an opaque handler
  cannot carry the closed-inputs proof);
- it declares **both** `auth: 'public'` and `authorityIndependent: true`
  (in a sessions-mode app, a query without both is authority-scoped by
  default and classifies `SNAPBACK_RETENTION_NOT_RETAINABLE` — this is the
  natural shape of a private chat query, and it is the usual reason a chat
  app sees no retention);
- its plan reads no membership, `authUserId()`, time, or randomness inputs.

**Explicit args do not break eligibility.** An args-filtered query — for
example chat messages filtered by `eq('conversationId',
arg('conversationId'))` — satisfies the proof exactly like its args-less
sibling: `arg(...)` values are query identity, not ambient authority, and
each `(query, args)` pair persists its own retained entry. This is
receipt-proven, not aspirational: the public-dashboard witness below
subscribes with `args: { dashboardId: 'ops' }` and asserts
`retainable: true` plus a minted resume token, and the same args-filtered
shape was re-verified 2026-08-07 against the published `0.1.12` packages in
both dev and sessions modes. If your args-filtered query classifies
retention `none`, the missing declarations or an ineligible plan — never
the args — are the cause, and the handle's `retention.reason` names which
layer refused.

| Workload shape | Route | Survival rules |
| --- | --- | --- |
| Public single-table live query, args-less **or** filtered by explicit `arg(...)` | Platform retention: declare `auth: 'public'` + `authorityIndependent: true` ([opt-in section](#opt-a-live-query-into-cold-retention-rqseligible)) | Persisted per `(query, args)` in the client store; fresh client re-renders it `freshness: 'retained'`, backend unreachable included; subscribe demand is volatile (dispose releases it); a non-empty outbox withholds resume — retained pre-intent render, full resync first |
| Public data queried through many argument values, one retained payload wanted | Client-side filter over an args-less (or coarser-keyed) retained query ([viewer-facts section](#retain-public-viewer-facts-by-argument-not-authority)) | Same as platform retention, with one entry instead of one per argument value; derive the per-key fact from canonical rows on the client |
| Protected generated live query — the natural private-chat shape under sessions | Declare `retainable: true`; the JS and Contract arms use lease-backed custody ([authorized leases](../auth/protecting-data.md#authorized-leases-bound-unreachable-honest-clients)) | Rows render retained only under a valid `AuthorizedLease`; merely offering the lease protocol does not promote non-retainable queries or call its endpoint. Equality with the client deadline is expired, and invalid/mismatched custody is transactionally deleted before exposure. The JS package proves a fresh-client cold handoff; the independent real-process restart witness remains a GAP |
| Owner-scoped generated relational composite | LLP 0166 materialization store + hydration bridge ([store section](#render-retained-rows-proof-validated-after-relaunch-the-materialization-bridge)) | Proof-revalidated `authoritative`/`retained` relaunch answers; demand comes from registrations — a live handle is an `active` registration reaped at restart, `registerQuery` with `retentionRequest: 'durable'` survives restart |
| Demand that must survive a restart with no mounted handle | `registerQuery` programmatic durable registration ([registration section](#keep-a-generated-query-registered-without-a-live-handle)) | Durable across restarts; owner-admitted — a non-retainable query refuses instead of silently dropping durability; release is idempotent |
| Snapshot-batch composite (`snapshot-batch.v1`/`v2`) | None — deliberately volatile, retention `none` | Payload removed at the next writer maintenance pass; never infer renderability from stored bytes |

Two dead-ends the maze invites, named so you can skip them:
`composition-activation-prepare` is step 1 of the controlled store recipe
below, not a general retention lever — it activates the generated artifact
graph for the bridge and changes nothing about `rqsEligible`
classification. And materialization/registration writes are store-writer
operations: a context without store ownership refuses with
`SNAPBACK_RQS_STORE_NOT_WRITER` rather than retaining silently, so run
registration from the store-owning client, not from a second casual client
over the same directory.

## The JS/React arm: default persistence and the offline queue

Since LLP 0129 Phase 0, `@expo/snapback-client` (and the LLP 0114 React hooks
riding it) persists its cache **by default**: the client resolves an
IndexedDB store in browsers, a durable file store on node, and an in-memory
fallback elsewhere, reporting the resolved implementation and durability on
`client.rqsStoreInfo` (pass `rqsStore: null` or set
`SNAPBACK_CLIENT_RQS_STORE=off` to opt out).

### Branch on a persisted binding receipt at offline cold boot

`prepareReactBinding` may return a ready binding with
`source: 'persisted-receipt'` when transport-provenance connectivity failure
prevents fresh negotiation and the generated manifest is byte-identical to
the stored receipt. That is a successful offline cold-boot branch, not a
binding failure. Render the retained/offline presentation and let the client
renegotiate when connectivity returns:

```ts fragment reason="Application-specific boot UI around the shipped persisted-receipt discriminator."
const binding = await client.prepareReactBinding({ generatedManifest });
if (binding.source === 'persisted-receipt') {
  showOfflineBanner();
}
```

The fallback does not accept a changed manifest, an HTTP refusal, or an
unproven generic error. Do not catch `SNAPBACK_APP_BINDING_UNAVAILABLE` and
manufacture this state yourself.

### Retained asset references do not retain image bytes

Retained rows persist asset references and text, but the first-party asset
client does not persist rendition bytes. Its issued-URL cache is in memory;
after process death or a cold offline launch, an `<Image>` backed only by that
URL may be unavailable even while the row renders as `retained`.

Design an explicit offline placeholder and retry when the network returns. If
product policy permits, an app may own a bounded on-device byte cache, but the
app must also own its expiry, quota, logout wipe, and revocation behavior.
Snapback currently provides no privacy- or revocation-aware offline image-byte
cache, so do not describe that workaround as platform retention.

Two mechanics make an offline **proof** trial-and-error if you do not know
them, so know them before you kill a client or export a bundle:

- **Retained rows persist on a debounce, not on the write.** The client
  schedules a trailing 1 s persist after a change, capped at 10 s of
  continuous change (`RQS_PERSIST_DEBOUNCE_MS` / `RQS_PERSIST_MAX_DELAY_MS` in
  [the client](repo:packages/snapback-client/index.mjs)). A client killed
  inside that window loses the rows, and the relaunch honestly renders
  nothing — which reads like a retention bug and is not one. There is no
  public flush-now call; the only forced flush is on hide, where the client
  persists immediately on `pagehide` and on `visibilitychange` to `hidden`. In
  a browser proof, dispatch one of those before the kill; on Node, wait out
  the window.
- **A production export removes the supervised binding lane.** The supervised
  Expo carrier's endpoint vocabulary is gated behind
  `process.env.NODE_ENV !== 'production'` so Metro's production transform
  prunes it (the release-export repair described on
  [the React Expo page](../clients/react-expo.md)). An
  `EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN` baked into a production
  `expo export` therefore silently disappears and `resolveBinding` fails with
  `SNAPBACK_APP_BINDING_UNAVAILABLE`. Prove offline behavior from a
  development-condition build, or bind explicitly, rather than from a release
  export that has had the lane pruned out from under it.

The implementation surface includes all three carriers. LLP 0155 Stage 0 now
has a standards-real **store-substrate** harness at
`demos/zero-bakeoff/stage0/browser/run.mjs`: it drives the shipped IndexedDB
store in system Chrome, kills the owned browser process group with `SIGKILL`,
relaunches the same profile, verifies the stored entry, and proves two-tab Web
Locks writer/refusal/takeover behavior. That is real carrier-mechanism evidence
with no Snapback server or React surface. The **browser public witness** at
`demos/browser-local-first/tests/acceptance/browser-public-witness.mjs`
(2026-08-07, receipt retained at
`tests/acceptance/fixtures/browser-lane/browser-public-witness.2026-08-07.v1.json`)
closes the former end-to-end browser GAP
(`issues/closed/20260801-guide-gap-js-arm-browser-indexeddb-proof.md`): a
generated React todo app served through the `@expo/snapback-vite` relay in
system Chrome, against the real runtime binary, proves in the browser carrier
retained/current labeling across whole-process `SIGKILL` and same-profile
relaunch with authority unreachable (retained state is never presented as
current), the durable outbox with full-resync-before-replay by event
ordinals, ordered exactly-once settlement including an exact duplicate
redelivery republishing the stored settlement with zero dispatch,
independent-observer convergence, same-process full-page SPA reconstruction,
bounded render/effect counts, and the then-current protected refusal with
nothing persisted. The authenticated/authorized retention-and-replay
conjunction is not part of that historical browser witness. Package-level
lease custody now proves a fresh client instance accepting retained protected
rows while the endpoint is unreachable; a separate real-process restart
witness remains on the lease-custody ticket
(`issues/20260731-js-arm-lease-custody-and-sessions-outbox.md`).

The retained
`demos/public-dashboard/tests/acceptance/offline-local-first.mjs` witness runs
headlessly on Node and forces the file store; it remains the Node-carrier
proof of the same contracts. The headless witness proves:

- **Retained render for the rqsEligible subset on the Node/file
  carrier, by a fresh client instance in the same process.** (Not a
  "cold boot": the witness closes one client and constructs another
  without restarting the process. No full client-process restart is
  proven on any carrier — see the GAP ticket above.) A fresh client —
  including with the backend unreachable — renders the persisted rows of
  authority-independent live queries first, marked
  `freshness: 'retained'`, then settles to `'current'` on reconnect
  (LLP 0090 Channel B). Non-`rqsEligible` queries are NOT retainable: the
  handle's `retention` fact names the refusal
  (`SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE`) instead of silently acting
  local-first. Protected/auth-scoped and opaque queries still report
  `SNAPBACK_RETENTION_NOT_RETAINABLE` when the generated lease shape or
  negotiated sessions/lease protocols are absent. With those proofs present,
  `packages/snapback-client/rqs-resume.test.mjs` establishes the exact live
  namespace, performs a fresh full `authorizedLeaseQuery`, closes the first
  client, and proves a fresh client instance renders the retained rows while
  fetch is unreachable. The same suite pins valid display, equality expiry,
  hash/binding mismatch refusal, and delete-before-read in the IndexedDB carrier.
- **A durable LLP 0043 M2 outbox.** A mutation refused by connectivity is
  queued durably under a client-minted `clientMutationId` (protocol-lane
  identity) with a monotonic local sequence, and resolves the queued dispatch
  branch with `status: 'queued'`, that identity and sequence, and the arm's
  point-in-time `presentation` fact. Connectivity is classified
  by transport provenance — the fetch dispatch itself rejected, so no HTTP
  status, diagnostic, or receipt exists — independent of the rejection's
  constructor (undici throws `TypeError`; Expo/RN fetch rejects a plain
  `Error`). Caller-owned aborts/timeouts and anything the server answered
  never queue.
- **The target settlement ledger is a prerequisite, not an assumption.** The
  local SQLite target positively advertises `offline_mutation_replay` in its
  `/inspect` capability manifest because it atomically settles and republishes
  a replayed `clientMutationId`. `queue: 'auto'` behaves as `queue: false` for
  any target that does not advertise that capability (or whose manifest cannot
  be inspected): an ambiguous transport failure surfaces and nothing is
  enqueued. Explicit `queue: true` and a non-empty
  `replayQueuedMutations()` drain instead refuse with
  `SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED`, leaving existing intent
  pending. In particular, the current Cloudflare proof does not have this
  ledger; accepting mutations there does not make durable replay safe.
- **Per-record sessions and agent custody.** A settled authority fence adds
  the exact server-issued `authorityDescriptor`, server-proven
  `principalScope`, and durable fence lineage to the queued record; no bearer,
  sender key/nonce, DPoP material, token id, carrier generation, or lease is
  persisted. A same-principal replacement session strands pending and failed
  records for explicit `strandedMutations()` / discard / re-record-as-new-id
  recovery. Logout, user switch, auth-mode change, or authorization-stream
  change deletes predecessor pending/failed/stranded bytes before the
  successor is published and records only a diagnostic count. An unsettled or
  terminal fence leaves records untouched and makes the drain inadmissible.
  The real-server witness is
  `demos/card-game/tests/acceptance/offline-sessions-custody.mjs`.
- **Ordered exactly-once replay.** After reconnect completes a fresh
  authoritative snapshot (full resync first — LLP 0008 §Mutation Replay),
  the client drains the queue in sequence order; the server's settlement
  ledger returns the original result on duplicate delivery. (A content-refused
  replay is dropped and marked failed, visible in `outboxRecords()`;
  `SNAPBACK_AUTH_STALE_RESULT` instead becomes terminal `stranded` custody. The
  store transition and the client wiring that maps a server refusal onto it
  are covered by `packages/snapback-client/outbox-store.test.mjs`; the
  ordered drain itself is proven end-to-end in the browser carrier by the
  browser public witness.)
- **Lane-L reconciliation substrate, without local execution.** A composing
  layer may enqueue a synthetic `re-derive` intent with an LLP 0133 mint-claim
  ledger. The server response's private `idMap` atomically rewrites exact
  matching string leaves in not-yet-submitted successors; an unmapped or
  rejected mint marks leaf-visible dependents terminally failed with
  `SNAPBACK_SPECULATIVE_ID_UNRESOLVED`, including transitive dependents. The
  actual submission slot rechecks the predecessor fence. Exact copied strings
  rewrite too, while ids embedded in longer strings are not detected — the
  deliberate leaf-equality floor until typed-id declarations graduate it.
  The external query-store seam passes the same private map to an
  authoritative-row matcher and otherwise retains its first-delivery-after-
  confirmation fallback. This is settlement/reconciliation machinery only:
  the JS arm still runs no local mutation executor, captures no speculative
  runtime answers, and makes no `Parity` claim.
- **No `Parity` claim.** This arm runs no local execution, so the queued
  path is Online-class retention/replay under LLP 0043's proof rule. A
  relaunch with pending intent still renders the retained rows — marked
  `retained`, **pre-intent** (the queued writes are not overlaid; there is
  no local execution to derive them), with `handle.pendingIntentsAtSeed`
  naming the queued count — while the resume token is withheld: reconnect
  takes full resync, then ordered replay (LLP 0090's outbox rule and its
  2026-08-01 rendering note). Render the queued-changes state next to the
  retained rows from `client.outboxStatus()` (React:
  `useSnapbackOutbox()`), never by faking the rows themselves.

### Keep a queued React mutation pending

<!-- since: 0.1.16 -->

The headless client resolves a durably enqueued dispatch with
`{ queued: true, clientMutationId, sequence }`. The React facade resolves that
same accepted intent as
`{ status: 'queued', clientMutationId, sequence, presentation }`; the other
union branch is `{ status: 'settled', result }`. Queued is pending settlement,
not a server refusal, and has no `appCode`. An installed optimistic layer
survives enqueue and follows the durable disposition through the
provider-owned status channel. A `withheld` or `unavailable` presentation is
explicitly not installed, so keep any application-owned pending presentation
visible. Roll it back only for a server refusal whose diagnostic carries a
declared `appCode`:

```ts fragment reason="pending presentation and refusal copy are application-specific"
try {
  const outcome = await mutate(input);
  if (outcome.status === 'queued') {
    keepPending(input.intentKey, outcome.clientMutationId);
    return;
  }
  clearPending(input.intentKey, outcome.result);
} catch (error) {
  const appCode = (error as { diagnostic?: { details?: { appCode?: unknown } } })
    .diagnostic?.details?.appCode;
  if (typeof appCode === 'string') {
    rollbackPending(input.intentKey);
    showDeclaredRefusal(appCode);
    return;
  }
  throw error;
}
```

<!-- since: 0.1.19 -->

At the P3 relinquishment-to-queued cut, the client emits the canonical
`SNAPBACK_OFFLINE_MUTATION_QUEUED` channel event. React's
`SNAPBACK_REACT_MUTATION_QUEUED` is a compatibility projection carrying the
same `clientMutationId`; the default dev reporter deduplicates the pair into
one canonical console line. This is diagnostic delivery only: it does not
alter the resolved union, optimistic-layer custody, or provider-owned drain.

After 30 seconds without durable queue-head advance, the client channel sets
`SNAPBACK_REACT_MUTATION_QUEUE_WEDGED` as an active condition keyed by that
head's `clientMutationId` and sequence. It carries queue depth, head status,
oldest-pending age when known, transport provenance when known, and the current
recovery path. A failed drain clears nothing. When the durable head advances,
the old condition clears and the successor gets a fresh 30-second window. A
`result-gone` head remains active even with no pending replay work because it
still blocks its successor; recover with the explicit
`client.acknowledgeResultGoneMutations([clientMutationId])` cut. The condition
comes from durable outbox notifications, never inference from bounded event
history.

The provider-owned controller drains automatically by default and reacts to
the P3 wake sources. `outboxDrain="manual"` disables scheduling, not the
controller. Request a safety-gated cycle through
`useSnapbackOutbox().drainNow()` or call `client.replayQueuedMutations()` in a
headless host. The [replay and settlement rules](#replay-and-settle-without-guessing)
remain authoritative; diagnostics never infer settlement or reorder replay.

<!-- since: 0.1.15 -->

The replay path preserves the original `clientMutationId`. A local mutation
handler that needs a replay-stable key for a durable effect intent can project
the corresponding server identity through
[`ctx.mutation.settlement()`](../backend/mutations.md#derive-a-replay-stable-effect-key);
do not substitute a fresh runtime id or perform the external effect inside the
mutation transaction.

**Queueing requires writer custody of the durable store.** The client store
is single-writer: the first client over a store directory (or IndexedDB
identity) acquires writer ownership, and a second client over the same
store — another process, or a second casually constructed client in the same
process — is a *reader*. A reader can still render retained rows and see
pending intent, but a mutation that must queue refuses with
`SNAPBACK_OUTBOX_NOT_WRITER` ("this context does not hold single-writer
ownership of the client store; the mutation was not queued") rather than
silently queueing into a store it does not own. One deliberate degradation
exists: a generated declarative mutation with the default `queue: 'auto'`
falls back to ordinary server-delegated dispatch when it hits the non-writer
refusal (LLP 0155's server-only admission rule) — it does not queue, and it
does not fail while the server is reachable. Separately, a client whose
queue custody is unavailable — `offlineQueue: false`, or only the volatile
memory store — refuses an explicit `queue: true` with
`SNAPBACK_OFFLINE_QUEUE_DISABLED` before any network dispatch. Run mutations
that must queue from the store-owning client; this is the outbox twin of the
`SNAPBACK_RQS_STORE_NOT_WRITER` rule the materialization section names for
registrations.

```js source=packages/snapback-client/outbox-store.test.mjs
  // Offline: fetch refuses at the transport (TypeError, like undici).
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  const queued = await client.mutate('createThing', { args: { title: 'offline' } });
  assert.equal(queued.status, 'queued');
  assert.equal(queued.queued, true);
  assert.equal(queued.presentation, 'withheld');
```

## Preserve pending work across a desktop sidecar swap

The desktop sidecar is the explicit exception to default per-origin store
selection. Because each candidate starts on a new ephemeral port, an ordinary
fresh client would resolve another default file-store blob. The embedding app
instead owns one durable file store for the canonical sidecar database domain
and injects that same store into predecessor, candidate, and rollback clients.
Do not generalize this to arbitrary servers: the default isolation rule is a
safety boundary.

After candidate nonce attestation, construct the fresh client with the
candidate URL and shared store, complete an application-owned full-snapshot
barrier, then call `adoptQueuedMutations`. The checked API requires the captured
`clientStoreId` and exact artifact generation; it also checks writer custody,
candidate `/inspect`, and every pending record generation before replay. Its
receipt reports authoritative before/after dispositions and terminal deltas.
The sidecar commits only at zero remaining, no stop, and no new failed,
quarantined, or result-gone record.

Replay keeps the original `clientMutationId`; the candidate client's `baseUrl`
supplies the new origin. The shared SQLite `_snapback_client_mutations` row is
the exactly-once authority, so a predecessor commit whose response was lost is
republished rather than applied twice. Startup nonce, port, and pid are
attachment evidence, not duplicate identity.

This is a pending-work-preserving stop/start swap. The predecessor is stopped
before the candidate starts, so it does not provide zero-request-downtime. A
stable front door or overlapping runtime ownership is separate work.

```js source=packages/snapback-client/outbox-store.test.mjs
  const outcome = await client.replayQueuedMutations();
  assert.deepEqual(
    { replayed: outcome.replayed, failed: outcome.failed, remaining: outcome.remaining },
    { replayed: 2, failed: 0, remaining: 0 },
  );
  assert.deepEqual(
    delivered.map((body) => body.clientMutationId),
    [queued.clientMutationId, queuedUpdate.clientMutationId],
    'replay is ordered by sequence and keeps the minted durable identity',
  );
```

## Render retained rows proof-validated after relaunch (the materialization bridge)

Since the LLP 0166 store and its hydration bridge landed, an owner-scoped
**generated relational query** can come back from disk on a completely fresh
client — server unreachable — as an `authoritative` answer, because the
stored fragments were installed only after server-side completeness-proof
and lease validation. This is the strongest retained-render path on the
JS arm and it is receipt-proven end to end by
[`tests/acceptance/local-store-carrier-exit-v1.mjs`](repo:tests/acceptance/local-store-carrier-exit-v1.mjs)
(run in the local proof; the retained 2026-08-06 refresh measured **17 PASS /
0 GAP / 0 SKIPPED** — `carrier-exit.2026-08-06.v1.json` — after the
`snapshot-batch.v2` implementation, the frozen cross-language `sbsb2`
vectors, and the fresh Fleet Observatory footprint/hydration witness all
landed 2026-08-06 (LLP 0157 v0.11), closing Move 1 without promoting
Experimental maturity or adding any hosted or public-package claim; the
mixed authoring surface itself is taught under
[snapshot batches](../backend/snapshot-batches.md)).

Evidence scope, stated precisely: local target, Node process, file carrier,
owner-scoped generated relational queries. It is not a browser-restart
proof (that GAP is tracked separately, see the JS-arm section above), and
it is not a hosted claim.

### What is retainable, and what deliberately is not

- **Owner-scoped generated relational queries** (`defineRelationalQuery`
  composites) — retainable: their materializations carry qmk1 identity,
  a completeness proof, and lease custody, so a fresh client may re-render
  them offline as `authoritative` / `retained`.
- **Host-derived `single_table_v1@1` live queries** — retainable through
  `rqs-authority-independent-snapshot-v1`: the generated function carries the
  experimental capability requirement, and the contributor-source local
  target publishes it through the exact LLP 0110/0166 carrier. This is Arm A:
  `authorizedLeaseHash` stays `null`, and no `AuthorizedLease` is consumed.
  Ordered or limited results remain whole-result `live_replace`; class
  membership is derived from the public, ambient-free single-table plan and
  cannot be asserted by the author.
- **Snapshot-batch composites** (`snapshot-batch.v1` and the mixed
  `snapshot-batch.v2`) — deliberately
  volatile: retention is `none`. Final release pins that class, so the next
  writer maintenance pass removes payload immediately; the compacted
  instance-bookkeeping stub may remain. A `none` registration never acquires
  payload-retaining release grace. Do not read a stored record's presence as
  renderability — the answer classes below are the only authority.

### The controlled local recipe

1. Prepare and regenerate the trusted activation (the generated artifact
   graph is the **only** activation source the bridge trusts):

```sh
snapback composition-activation-prepare --db app.db \
  --generated demos/your-app/snapback/generated --deployment-id dev
node demos/_kit/codegen.mjs demos/your-app/snapback
```

2. Establish under sessions with a persistent store and `persistResume`,
   then render live — the handle reports the answer classes directly:

```js source=tests/acceptance/local-store-carrier-exit-v1.mjs
    const live = await firstClient.liveQuery(generatedApi.api.booksWithAuthors, {
      connectionId: 'carrier-exit-retained-render-live',
      persistResume: true,
    });
    assert.deepEqual(live.rows, [{ title: 'proof-backed', authorName: 'Ada' }]);
    assert.equal(live.answerClass, 'authoritative');
    assert.equal(live.freshness, 'current');
    assert.equal(live.retention.retainable, true);
```

3. Stop the server, construct a **fresh client** over the same store
   directory, and re-render — the bridge revalidates proof and lease
   custody before it will call the stored rows authoritative:

```js source=tests/acceptance/local-store-carrier-exit-v1.mjs
    assert.deepEqual(relaunched.rows, [{ title: 'proof-backed', authorName: 'Ada' }]);
    assert.equal(relaunched.answerClass, 'authoritative');
    assert.equal(relaunched.freshness, 'retained');
```

### Answer classes control offline rendering

The store's answer table (LLP 0166 §D4) is the honesty contract; render
decisions key off `answerClass` + `freshness`, never off "bytes exist":

| `answerClass` | Meaning | Render offline? |
| --- | --- | --- |
| `authoritative` (`freshness: current`) | Live, connected, proof-backed | Yes |
| `authoritative` (`freshness: retained`) | Relaunch answer whose proof and applicable retention custody revalidated (lease-backed for protected relational results; no-lease Arm A for `single_table_v1`) | Yes, marked retained |
| `labeled-retained` | Rows retained but authority could not be revalidated | Only with an explicit degraded label |
| `unknown` | Store cannot classify (no proof, no custody) | No — treat as no data |
| `refused` | Policy or authorization refused the read | No — surface the refusal |

The `single_table_v1@1` authority-independent arm is the qmk1 authoritative
row with `authorizedLeaseHash: null`: a valid proof, witness, current instance
fence, class binding, and trusted activation are still required, but no lease
is required or implied. Every failure follows the corresponding qmk1 row.

Inspect custody separately from answer authority with
`StorePolicyInspectionV1`. Every address has exactly one retaining reason:
`registrations`, `release-grace`, `safety-blocker`, or
`instance-bookkeeping` (plus the explicit grandfathered legacy class). Active
registrations are volatile and are reaped at restart; programmatic durable
registrations survive. In the Triage churn proof, the one programmatic Inbox
registration retains the only payload while all 20 disposed `none` queries are
compacted bookkeeping stubs after an explicitly driven maintenance pass.

### Keep a generated query registered without a live handle

Active live queries still register demand automatically — subscribing is the
`active` registration, and disposing the handle releases it. For demand that
must survive a process restart without a mounted handle, use the public
programmatic API. The application owns a stable, store-scoped
`registrationId`; Snapback derives the qmk1 address and authority partition
from the generated reference and current owner snapshot:

```ts source=demos/triage-graph/src/retained-registration.ts
  const result = await (client as RegistrationClient).registerQuery(reference, {
    registrationId: 'triage-graph-retained-inbox-v1',
    args: {},
    label: 'triage-graph-retained-inbox',
    requestedScope: { kind: 'page', input: { kind: 'first' } },
    retentionRequest: 'durable',
    idleTtlClass: 'default',
  });
  if (result.outcome.kind === 'refused') throw new Error(result.outcome.code);
  return result;
```

`registerQuery` returns the exact `RegisterOutcomeV1` envelope and works from
both writer and qualified non-writer contexts. Registration is durable, but
retention is still owner-admitted: a non-retainable generated query refuses
rather than silently dropping the durability request. Release with
`client.releaseQueryRegistration(registrationId)`; repeated releases are
idempotent and return a `released` outcome. Never author a materialization
address or authority-partition digest yourself.

### Evaluate an owner-reclassified retained result

The public `@expo/snapback-client/result-transform` subpath exposes the closed
`result-transform.v1` evaluator and its pinned ship-gate identity. The client
entry point is `client.evaluateLocalResultTransform(generatedReference,
options)`. It reads only the reference's proof-verified retained result bytes;
it never runs the query's source-row plan locally.

This is deliberately owner-gated. The generated reference must carry the
server-issued `result-transform-snapshot-v1` retention class, which rotates the
plan hash and qmk1 address. Unreclassified plans, memory storage, and the
current non-durable Expo carrier refuse with
`SNAPBACK_LOCAL_EVALUATION_UNADMITTED` before inspecting the transform. The
claiming carrier contexts are browser IndexedDB and Node/file.

Carrier claims are executable rather than inferred. The dedicated S8 suite
(`packages/snapback-client/carrier-capability-honesty.test.mjs`) checks that
IndexedDB and Node/file report durable and admit `durable-fragments-v1`, while
memory and the current Expo adapter report volatile and refuse the same request
with `SNAPBACK_MATERIALIZATION_STORAGE_PROFILE_GAP` naming
`durable_fragments_v1`. An older IndexedDB opener receives `VersionError`
against v3; a future file blob is preserved in place and refused with
`SNAPBACK_RQS_STORE_CORRUPT`.

## Opt a live query into cold retention (`rqsEligible`)

Cold retention is **per-query and opt-in by declaration** — a Snapback app
gets ZERO offline retention until at least one live query declares
eligibility. The default is refuse-with-clarity, not silent persistence: in
a sessions-mode app even a plain declarative live query over a table with no
private rows is authority-scoped by default, its handle reports
`retention: { retainable: false, code: 'SNAPBACK_RETENTION_NOT_RETAINABLE' }`,
and nothing ever persists — so the cold-boot claims above silently never
engage until you declare the opt-in below.

The opt-in is two declaration facts on a **declarative** live query
(`defineLiveQuery`):

- `auth: 'public'` — the query is invocable without a resolved user;
- `authorityIndependent: true` — the trusted declaration that the complete
  result, for the same database state and explicit arguments, is identical for
  every caller. Codegen accepts it only on a public, ambient-free plan; it is
  refused on queries with `authScopeField`, `membership`, `authUserId()`
  filters, or time/randomness reads.

From those facts plus the closed-inputs proof (single-table plan whose read
summary equals the plan's table), the server derives the `rqsEligible`
predicate and mints resume tokens — there is no authored `rqsEligible`
field, and a query failing the proof is simply not eligible, never a load
error (LLP 0090). The same predicate now derives LLP 0157's
`single_table_v1@1` node class; codegen adds that experimental target
requirement automatically, while multi-node composition remains closed and
the 1,024 examined-entry refusal applies only during QMK establishment. The
eligible query in the public-dashboard demo:

```js source=demos/public-dashboard/snapback/functions.mjs
export const dashboardMetrics = defineLiveQuery({
  table: 'metrics',
  args: { dashboardId: v.string() },
  filter: [eq('dashboardId', arg('dashboardId'))],
  order: [asc('label')],
  index: 'by_dashboard',
  auth: 'public',
  authorityIndependent: true,
  publicInline: true,
});
```

(`publicInline: true` is the separate snapshot-inlining disclosure
permission for HTML boot — see
[snapshot bundles](../realtime/snapshot-bundles.md) — and is **not**
required for retention.)

### Retain public viewer facts by argument, not authority

`authorityIndependent` does **not** require one result for every possible
argument value. Explicit `arg(...)` values are part of the query identity, not
ambient authority, so a caller-selected viewer key can still qualify when the
rest of the plan satisfies the proof:

- `eq('userHandle', arg('handle'))` can be `rqsEligible` and cold-retained;
- `eq('userHandle', authUserId())` depends on server authority and is never
  `rqsEligible`. The refusal CODE is mode-dependent: an authorization scope
  is minted only by a sessions-mode server, so under sessions mode the
  subscription classifies `SNAPBACK_RETENTION_NOT_RETAINABLE`, while under
  dev custody (where no subscription ever carries a scope) the same
  declaration truthfully reports `SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE`.
  Either way nothing persists. (An `authUserId()` filter also refuses an
  anonymous sessions caller outright with `SNAPBACK_AUTH_USER_MISSING`; a
  plain non-`authorityIndependent` public query is the anonymous-admissible
  shape that exhibits the sessions-mode `NOT_RETAINABLE` classification —
  see `demos/browser-local-first/snapback/functions.mjs` `todosFeed`.)

For a public social feed, split the data into two retainable live queries:
keep posts and their public `likeCount` in the timeline, keep public like rows
in a viewer-keyed query, and derive `liked` from that second query on the
client. Warble uses this declaration:

```js source=demos/warble/snapback/functions.mjs
export const myLikes = defineLiveQuery({
  table: 'likes',
  args: { handle: v.string() },
  filter: [eq('userHandle', arg('handle'))],
  index: 'by_user',
  auth: 'public',
  authorityIndependent: true,
});
```

Its acceptance suite proves that both the timeline and `myLikes` render from
retained storage with the backend stopped. The client computes the viewer fact
from canonical query data, for example
`new Set(likes.data?.map((like) => like.postId)).has(post._id)`; it does not
copy the boolean into component state.

This pattern is a data-layout technique, **not an authorization boundary**.
The caller controls `handle`, so any caller can request any handle's rows. Use
it only for facts that are genuinely public, such as likes and public
reactions. Private viewer data must stay server-scoped (for example with
`authUserId()`) and use a generated query's `retainable: true`,
`AuthorizedLease`-backed path described in
[protecting data](../auth/protecting-data.md#authorized-leases-bound-unreachable-honest-clients);
do not make private rows public merely to avoid lease custody.

Existing legacy RQS entries are not rewritten merely because the class is now
active. LLP 0090 grandfathers those bytes. While connected, adoption either
proves the exact legacy identity or performs a fresh sync, then switches into
QMK custody in one atomic same-domain transaction. It never relabels in place,
never adopts while offline, and never drops pending outbox intent.

The handle tells you whether the opt-in took: `handle.retention` is the
refuse-with-clarity classification, and an eligible query holds a
server-minted resume token:

```js source=demos/public-dashboard/tests/acceptance/offline-local-first.mjs
    assertEqual(handleA.freshness, 'current', 'fresh subscribe is authoritative');
    assert(handleA.retention?.retainable === true, 'eligible query classified retainable');
    assert(handleA.rqsResume?.token, 'server minted a resume token');
```

A query that does not qualify names why instead of silently acting online:

```js source=demos/public-dashboard/tests/acceptance/offline-local-first.mjs
      assertEqual(feed.retention?.retainable, false, 'refused retainability');
      assertEqual(feed.retention?.code, 'SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE', 'refusal code');
```

The refusal codes: `SNAPBACK_RETENTION_NOT_RETAINABLE` (authority-scoped —
protected retention is the lease machinery's, below),
`SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE` (the server minted no token: not an
authority-independent closed-inputs declarative query), and
`SNAPBACK_RETENTION_STORE_DISABLED` (eligible, but this client opted out of
persistence). For `SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE`, the fact's `reason`
names which eligibility layer refused, derived from the generated
reference's retention classification: the declaration never opted in (no
retention class — missing `auth: 'public'`/`authorityIndependent`, a JS
handler, or a non-single-table plan), the class is volatile by design
(snapshot batches, non-retainable composites), or the declaration is
eligible but this target did not activate the class.

The authority-scoped refusal remains receipt-pinned when the generated lease
shape or negotiated protocol is absent — the handle names the LLP 0053
boundary and the store stays empty:

```js source=packages/snapback-client/rqs-resume.test.mjs
  assert.equal(
    handle.retention?.retainable,
    false,
    'auth-scoped rows without the lease protocol are not retainable',
  );
  assert.equal(
    handle.retention?.code,
    'SNAPBACK_RETENTION_NOT_RETAINABLE',
    'the refusal names the LLP 0053 retainability invariant, not a generic ineligibility',
  );
```

That test deliberately uses a string query reference and omits the authorized
lease protocol. It proves fail-closed behavior, not a universal ban on
protected JS retention.

Two neighbors that are **not** this opt-in:

- `defineJsLiveQuery` handlers are never `rqsEligible` — an opaque JS
  handler cannot carry the closed-inputs proof, so JS live queries stay
  online-only on this arm regardless of `auth`.
- `retainable: true` is the *lease-class* opt-in — AuthorizedLease-backed
  retention of protected, user-scoped generated results under LLP 0053's
  custody rules (see
  [protecting data](../auth/protecting-data.md#authorized-leases-bound-unreachable-honest-clients)).
  It is not an override: missing generated activation identity, durable store
  ownership, or sessions/lease protocol support still refuses retention.

## Enable the complete client-store contract

Pass a durable `clientStore` (localStorage on web; memory only for tests) and
a complete retained identity: app id, database id, target-profile id, and
version-stream id. The generated Contract data manifest must claim
`offlineReplay`, and every mutation exposed by the surface must carry its
generated declarative plan — plan presence is the replayability predicate.
Whether an optimistic overlay is derived from that plan is a separate axis:
a sequence-withheld mutation is replayable with no overlay at all (see the
withholding rule below).

If any identity or replay proof is missing, queued writes and retention are
disabled instead of being rebound to a guessed backend. A changed artifact or
authority scope quarantines/deletes the old privacy-bearing state before the
new scope can inspect it.

For `AgentAuthorityFence`, the durable authority key is a canonical SHA-256
identity over the actor, credential id and generation, and grant id. Token id,
bearer bytes, and carrier generation are deliberately excluded: rotating a
token for that same tuple can replay its existing queue, while changing any
durable tuple coordinate advances the authority epoch and deletes predecessor
work. Every replay still resolves and validates a current scoped token before
the server acts. Agent authority does not enable retained service-principal
reads in v1.

Production CLI and daemon replay requires both a durable Contract
`clientStore` and a filesystem-backed `AgentAuthorityFence`; the in-memory
custody adapter is test-only. Construct the Contract surface before manually
synchronizing the fence. Surface construction registers the physical store as
a barrier participant before it performs the strict server handshake, so a
restart that finds an interrupted `clearing` transition replays that store's
epoch-bound deletion before custody can settle. Reversing that order can leave
predecessor queue data outside the recovered authority barrier and is refused
by the supported construction path.

The surface re-synchronizes durable custody before client-store reads,
retained publication, enqueue/acknowledgement, and final replay dispatch. A
missed process-local or BroadcastChannel wakeup therefore cannot expose or
settle predecessor rows and queued writes under a peer successor. The visible
surface blanks at the authority cut; durable predecessor work remains owned by
the barrier until its exact deletion/transition settles rather than being
silently acknowledged or discarded.

Terminal replay is explicit, not inferred from a null browser principal scope
(Agent successors also have no browser principal scope). An exact-current
nonterminal Agent successor preserves its already-committed store bytes. An
exact-current terminal replay verifies or reapplies deletion. If terminal B
finds that shared primary custody now belongs to A, Snapback leaves A's primary
row and any A-keyed local store untouched, but purges and unbinds a local store
still keyed to B so stale retained/queued B data cannot survive behind the
terminal witness.

Client-store write generations do not wrap. The maximum safe integer is
reserved for the terminal privacy cut; an already-exhausted bound store exposes
no retained or queued data even if durable replacement fails. A clean marker at
that final identity can be replayed without another write, but requires explicit
store replacement before any successor bind.

## Boot from retained rows honestly

An online boot publishes and stores the authoritative snapshot. If a later
boot cannot reach the same backend, the adapter may publish those retained
rows with `retained() === true` and connection `'stale'`:

```js source=packages/snapback-contract/offline-replay.test.mjs
// New store + new adapter instance models an app reload. The live request
// fails, retained rows boot stale, and the durable create overlay re-applies.
const secondStore = createMemorySnapbackClientStore({ state: sharedState });
const second = await makeSurface(secondStore);
assert.equal(second.retained(), true);
assert.equal(second.connection(), 'stale');
assert.equal(second.boundary.current('todos')[0]._id, todoId);
```

A first run with no retained snapshot fails with the original network error.
Retained data is never relabeled `live`.

For sessions-mode private rows, ordinary retention is insufficient. The server
must issue an authorized lease and the store must delete rows exactly at its
deadline. The JS arm durably reserves the request start before network I/O,
reuses the live query's exact client-store/query/query-instance namespace,
commits rows plus witness plus lease atomically after a fresh full query, and
on cold read validates the structural lease bindings, exact-byte hash,
activation, authority, and derived deadline. Equality with the deadline is
expired; a mismatch or rollback deletes the record in the same transaction
before returning no rows. That stricter subset is taught in
[protecting data](../auth/protecting-data.md#authorized-leases-bound-unreachable-honest-clients).

## Queue one deterministic mutation identity

Before an offline optimistic change becomes visible, the store durably
allocates:

- an opaque `clientMutationId`;
- a monotonic local sequence (ordering never comes from wall-clock time);
- the function and canonical arguments;
- the authority/artifact scope;
- one deterministic `ctxLedger` containing generated time/id answers.

The derived optimistic overlay consumes the **same** ledger, so a replayed
insert uses the id the UI already rendered. (A withheld sequence mutation
mints this ledger with no overlay consumer — see the withholding rule
below.) If durable enqueue fails, the optimistic change is rolled back
before any server contact.

The test queues create → toggle → delete and proves durable ordering:

```js source=packages/snapback-contract/offline-replay.test.mjs
const queued = await secondStore.pendingMutations();
assert.deepEqual(queued.map((entry) => entry.function), [
  'createTodo',
  'setCompleted',
  'deleteTodo',
]);
assert.deepEqual(queued.map((entry) => entry.sequence), [1, 2, 3]);
```

## Replay and settle without guessing

Reconnect delivers records in sequence with the original mutation id, ledger,
and authority descriptor. The server settles that id atomically with the data
commit. If a response is lost after commit, redelivery returns the stored
result rather than applying the mutation twice:

```js source=packages/snapback-contract/offline-replay.test.mjs
const replay = await second.reconnect();
assert.deepEqual(replay, { replayed: 3, failed: 0 });
assert.deepEqual(client.state.applied, ['createTodo', 'setCompleted', 'deleteTodo']);
assert.deepEqual(client.state.rows, []);
assert.equal(second.pendingCount(), 0);
```

Before returning an authoritative result, the client atomically changes the
durable record from replayable `pending` to non-replayable `settled`, retaining
the complete response and adding its auth-tagged acknowledgement obligation in
the same store transaction. The file arm flushes bytes and synchronizes the
parent directory after its atomic rename. If that write cannot commit, the result is not
published, is not marked failed, and the original id remains replayable. On
relaunch, read `client.settledMutations()` before new work and either call
`markMutationSettlementsConsumed(ids)` to make those results piggyback-ACK
eligible or send `acknowledgeMutations(...)` directly. Until then, automatic
ACK delivery cannot delete the recovery copy. In authenticated mode recovery
first re-attests the current session and returns only settlements from that
exact server-echoed authority cohort; predecessor results remain opaque in the
store until their authority returns. A typed content refusal is a visible
terminal `failed` record and is never acknowledged as the current id; an
authority-stale replay result is terminal `stranded` and rerecordable, while a
receipt-less outcome stays pending.

The client removes the retained settlement and ACK together only after the
server proves it processed the acknowledgement. A later mutation normally
piggybacks same-authority ACKs; `client.acknowledgeMutations(...)` is the
standalone completion path for one-shot or otherwise quiet callers. A
Snapback-origin terminal receipt proves the origin saw a piggyback ACK stage.
A receipt-less proxy/network failure proves neither, so both records remain
durable for retry. Process stdout alone is not this recovery boundary: use a
durable RQS store (the Node default is file-backed), or explicitly opt out of
queue custody and its guarantee.

ACK records are scoped by user and, when supplied, the server-issued authority
instance echoed on every successful mutation response. That settlement
descriptor is stored separately from the immutable descriptor captured with
the original request, so enrichment cannot change its replay identity.
Piggyback selects only
the current cohort and only results explicitly marked consumed. For standalone session or
service-principal completion, pass that record's `authorityDescriptor`; the
server compares it before GC and the client removes only matching local
proofs. An authority change therefore retains the predecessor proof rather
than leaking its id into, or deleting it under, the successor. A volatile
memory fallback reports `durable: false`, does not auto-queue, and refuses
`queue: true` with `SNAPBACK_OFFLINE_QUEUE_DISABLED` before network
dispatch. The current Expo file adapter makes the
same conservative report because its File/Directory API exposes no fsync cut
and has a non-atomic compatibility replacement; it can cache RQS rows but does
not own durable settlement publication.

Deploying a bundle that removes or renames the mutation does not strand an
already committed result. Until ACK, the server can recover it through the
exact current-authority-bound settlement identity without dispatching removed
code. After ACK garbage collection, the same call follows ordinary function
selection and returns `SNAPBACK_UNKNOWN_FUNCTION`.

## Migration boundaries: quarantine, don't fail

A schema publication can refuse a replay with one of two stable codes, and
neither is a mutation failure — the surface quarantines the write instead of
settling it `failed`, and exposes the state for rendering via
`surface.migrationBoundary()` (`null` in normal operation):

- `SNAPBACK_MIGRATION_RESYNC_REQUIRED` — the record's read baseline predates
  a successor-only publication and its row changed. The record stays
  pending; the next `reconnect()` resyncs first, re-presents the **same**
  `clientMutationId` with baselines refreshed from the successor snapshot,
  and the server settles it exactly once.
- `SNAPBACK_MIGRATION_UPGRADE_REQUIRED` — this client's artifacts predate a
  successor-only publication. The state is stable for the lifetime of the
  artifact-bound surface: the queue stays intact, nothing retries blindly,
  and the app can render "update required".

```js source=packages/snapback-contract/migration-quarantine.test.mjs
  // Quarantine, not failure: the record is still pending, nothing entered
  // the failed ledger, and the boundary state is app-renderable.
  assert.equal(surface.pendingCount(), 1);
  assert.deepEqual(await surface.failedMutations(), []);
  const boundary = surface.migrationBoundary();
  assert.equal(boundary?.kind, 'resync-required');
  assert.equal(boundary?.code, 'SNAPBACK_MIGRATION_RESYNC_REQUIRED');
```

Across the artifact upgrade itself, payload custody follows the client
store's privacy boundary: a write authored under predecessor artifacts is
never blindly replayed under successor artifacts — the successor surface
receives an explicit redacted `SNAPBACK_CLIENT_ARTIFACT_STALE` entry in
`failedMutations()` (identity preserved, args discarded) for the app to
re-enter, while the server keeps the refused `clientMutationId` fresh.

## Derive, then reconcile optimistic rows

Declarative mutation plans produce the local overlay; avoid a second handwritten
reducer. Server rows remain authoritative:

- success reconciles the optimistic wave with the committed result;
- a structured rejection removes/rebases the prediction and exposes the
  diagnostic;
- a connectivity ambiguity keeps the durable record and marks the surface
  stale;
- an artifact or authority change clears/quarantines old rows and writes before
  publishing the successor scope.

One declared exception: a generated sequence write-with-activity mutation is
marked `atomicOptimisticWithholding` and derives **no** overlay — fresh or
restored after relaunch (LLP 0043's LLP 0135 fold: the client may not guess,
locally allocate, or show the unaffected subset of a sequence-projected
changeset). The intent still queues durably and replays: enqueue pre-mints
the plan's fixed host row-id ledger (the activity row, plus the source row
for an insert source) without evaluating `AllocateSequence`, and rows appear
only from authoritative delivery after settlement returns the allocation.
The sequence surface itself is unpublished substrate — see
[scoped sequences](../backend/sequences.md).

```js source=packages/snapback-contract/offline-replay.test.mjs
  assert.equal(queuedResult.queued, true);
  assert.equal(
    withheldOnline.boundary.current('todos')[0].completed,
    false,
    'fresh atomic withholding queues intent without presenting app reducer rows',
  );
```

## Anti-patterns

- **Do not call a surface Parity because it has localStorage.** The manifest,
  identities, derivable plans, store, and authority fences must all agree.
- **Do not generate a fresh protocol mutation id on replay.** Lane Q reuses
  its deterministic ctx ledger; lane L keeps that protocol identity while the
  server re-derives application ids/time and returns the private id map.
- **Do not drop a queued write on a receipt-less 502.** The origin outcome is
  ambiguous.
- **Do not serve retained rows as live.** Render the stale connection axis.
- **Do not cache authorized rows outside the lease-aware store.** Use the
  authorized-retention path or keep the surface online-only.
- **Do not key an agent outbox by token id.** Tokens are live carriers; the
  server-issued descriptor and durable grant tuple own replay identity.
- **Do not fake an optimistic row for a withheld sequence mutation.**
  Sequence-projected placement is settlement's answer; render the queued
  state, never a guessed allocation or the changeset's unaffected subset.

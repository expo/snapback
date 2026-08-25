# LLP 0034: Contract Source Seam, Provider Side — Live Transports, Receipts, Manifest v2, and Conformance

**Type:** RFC
**Status:** Accepted
**Systems:** Live Queries, Ephemeral, Codegen, Server, Client Kit, Conformance, Contract Integration
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-01
**Revised:** 2026-08-25 (§10.7 pins render-first retry to the shared client
transport-provenance classifier on both preflight and surface/live-subscribe
construction; a diagnostic code alone and every answered HTTP failure,
including a proxy 5xx, remain terminal)
**Revised:** 2026-08-11 (draft §11 proposes an additive, iterator-owned headless `watchQuery` observation API after Diary 0075 repeated live-handle model friction; the amendment is pending author ratification. **Its first review returned NOT READY** — `llp/reviews/0034-s11-watchquery-amendment.claude.md`, 3 blocking. Correction to this header's original wording: §11 does **not** leave every Accepted requirement untouched — its acceptance item 4 would amend §10.11's shared-demand Constraint and flip a currently-green battery assertion. See §11's status note.)
**Revised:** 2026-08-10 (§10.11 records the keyed-surface ephemeral link family and the D-8 host-independent verdict: shared ephemeral demand withholds keyed durable retirement, so independent teardown requires separate connection ids; also records construction-time unsupported-client refusal, authority-barrier wiring swap, and deliberate keyed `forceEphemeralState` omission). 2026-08-03 (LLP 0109 acceptance reconciliation: §10.10 records the explicit versioned-seed exception boundary — the legacy untagged/`provision` seed-if-empty lane keeps its exact settled semantics and never writes versioned identity, versioned installation is a separate closed family that never routes through seed-if-empty, and legacy success/skip is never retroactive identity evidence). 2026-07-24 (LLP 0090 cluster-0F amendment to §2.4: token-resume still enters through a fresh `subscribe_live` and the resume token only seeds it — no cross-socket continuation, `resume_live` and the reattach route unchanged — but for resume-capable subscribers "snapshot-with-subscribe" becomes "maybe-`CurrentAsOf`-with-subscribe" per 0090's D1.3 admission ladder, with the no-prime-race property carried by 0090's atomic answer-and-register rule; tokenless, non-`rqsEligible`, and auth-scoped subscriptions keep rev-2 behavior verbatim). 2026-07-17 (connection-keyed `self` and `sourceClientId` are explicitly based on the opaque granted wire id; a readable kit connection label is not lease identity). 2026-07-17 (receipt outcome closure: a confirmed mutation receipt requires a portable non-null durable snapshot version; only a rejected mutation whose cursor read failed may carry null, and the generated schema now rejects the impossible confirmed/null pair). 2026-07-13 (ENG-24595: split `/app/ensure` into a closed legacy/attest/provision family; made explicit provisioning AdminWrite plus non-prod before hashes or effects; and retained the untagged form only as settled v0-dev compatibility). 2026-07-12 (ENG-24494/ENG-24495: subscription-event observers join the isolated observational lane and disposal is reentrant/finally-safe; synchronous optimistic reducer failures retire their op, restore authoritative rows, and surface as tracked typed rejections). 2026-07-12 (current-socket readiness reconciliation: a hosted pre-persistence socket/session refusal triggers a bounded, generation-scoped ping/pong readiness proof and only then a retry; per-handle lifecycle cancellation is isolated from shared probes, fresh subscribes serialize before capturing supersession, send failures enter immediate socket loss, and generic/ambiguous failures are never replayed, while successful local socketless subscribe retains HTTP poll fallback). 2026-07-12 (ENG-24371 follow-up: each individually disposed pre-attach query/ephemeral subscription cancels and settles its own waiter, and low-level surface disposal closes already-attached forwarding subscriptions, including synchronous-delivery reentrancy). 2026-07-12 (ENG-24377: multi-live bindings omitted from `liveQueries` now surface a typed unconfigured error instead of successful empty data). 2026-07-12 (ENG-24370: generated Contract manifests now derive their receipt claim from the shipped adapter capability and conformance-gate the claim against the observed surface). 2026-07-12 (ENG-24371: render-first disposal now settles queued writes and active backoff, and observational callbacks cannot strand attachment). 2026-07-02 (OQ1 resolved — row diffs ship as an additive `live_delta` wire kind for the analyzable HostPlan subset, closing DK-3's op-log-delta leg on the M3 evidence; server + client + tests landed, LLP 0008 §Decision DK-3 governs). 2026-07-01 (rev 2 — LLP 0005 review incorporation, one GPT (Codex/gpt-5.5) + one fresh-context Claude (Opus 4.8) review, artifacts in `llp/reviews/0034-contract-source-seam-provider-side.{gpt,claude}.md`, run blind to each other and convergent. Load-bearing corrections: **added D0** — the connection axis requires a server keepalive that does not exist (the stream sends nothing when idle and no-ops Ping/Pong), so "wiring, not server work" was oversold; **collapsed the version story to the existing global durable commit version** (rev 1's "updates are unnumbered" was false — every `live_replace` already carries it) and specified the ephemeral `(scopeEpoch, entryVersion)` mapping, deleting the invented per-subscription sequence; **split receipts into provider-populated vs adapter-stitched keys** with an inbound-correlation convention (several 0284 §2.6 keys are Exact-runtime concepts a provider cannot originate); **rewrote reconnect around reality** — socket close disposes durable subscriptions server-side, so reconnect is always a fresh `subscribe_live`, and `resume_live` is permission-epoch-driven retain/resnapshot with no version replay; corrected D3's baseline (in-tree, ephemeral collections project only as `ephemeralCollectionReference` — the query/mutation presence pair exists only in the off-tree graffiti worktree, so the ephemeral kind is net-new emission, simpler than a migration); re-grounded presence proofs on `cursors-web`; rewrote D4 as three concrete boot edits plus the AdminWrite-vs-profile distinction; promoted old OQ6 to a stated fact (ephemeral has no resume path; it always re-snapshots); reframed OQ1 (the server already pushes full replacement rows — a poke would be a regression); added the durable-over-ephemeral drain-priority invariant, the permission-epoch receipt reason, the §5 ownership table, DO-hibernation and key-mode identity OQs. Accepted same day by the author's decision, the round's blocking concerns being resolved in this revision. rev 1 — initial draft)
**Related:** Exact LLP 0284 (Contract Source Seam, rev 3 — the interface this implements; its acceptance gates on this document), Exact LLP 0263 (Contract Data Bindings — the manifest/adapter surface), Exact LLP 0278 (Verification Depth — §D consumes the receipts specified here; D2 is the provider home for its OQ2), Exact LLP 0281 (Transient Reactivity Lane — rated `publish` compiles against the budget facts D3 emits), Exact LLP 0275 (the realtime gap report), LLP 0013 (Ephemeral Realtime State — the shipped subsystem D1/D3 expose), LLP 0008 (Local-First Sync and Realtime), LLP 0011 (Auth and Permissions — permission epochs), LLP 0012 (Headless Integration Contract), LLP 0014 (Cloudflare Strategy — OQ5's hibernation semantics), LLP 0020 (Core Authoring Surface), LLP 0021 (Contract/Exact Integration Hardening — the program this lands in), LLP 0025 (Web Cursor Presence Demo — the idempotent-ensure lineage), LLP 0026 (Ephemeral Backend Abstraction), LLP 0027 / LLP 0029 (All Aboard demo + gap closure — the first proof's home), LLP 0031 (Server Route Taxonomy — D4's gating home), LLP 0032 (Decision and Implementation Hardening), LLP 0090 (Resumable Query Snapshots — source of the dated §2.4 amendment: token-seeded fresh subscribe, maybe-`CurrentAsOf`-with-subscribe), diaries 0001 (snapshot-with-subscribe praised), 0004 (provider-conformance lineage), 0006 (graffiti acceptance — landed as demos/graffiti via ENG-22219, §10.4), 0008 (All Aboard glue); **reviews:** `llp/reviews/0034-contract-source-seam-provider-side.{gpt,claude}.md`

---

## Summary

Exact LLP 0284 (rev 3) defines what it means for a Contract data binding to
be *live* — durable `query` push, the `ephemeral` presence map, a connection
axis, receipts, and provider-owned bootstrap — and assigns the provider half
to Snapback. This document is that half: the named deliverables, grounded in
what already ships.

The honest starting position is strong — with one correction from review.
The ephemeral subsystem is complete and Accepted (LLP 0013: TTL/lease,
latest-state coalescing, token-bucket publish budgets, connection-owned
cleanup — `crates/snapback/src/ephemeral.rs`). `subscribe_live` already returns the
authoritative initial snapshot in the same response as the subscription id
(`crates/snapback/src/local.rs:596-600`). A live WebSocket (`GET
/live/{connection_id}/stream`) already carries ephemeral push to real
browsers (cursors-web) and durable full-row updates to headless tests — the
server even re-runs queries on mutation and pushes `live_replace` rows with
a global commit version attached (`crates/snapback/src/local.rs:1247-1262`). The
inspect-before-provision boot (`ensure_collections`,
`crates/snapback/src/ephemeral.rs:716-770`, LLP 0025 lineage) already exists for ephemeral
collections. **But it is not all wiring:** the stream has no liveness signal
at all (idle sockets send nothing; Ping/Pong are no-ops, `crates/snapback/src/server.rs:641`),
so the connection axis needs one small piece of real server work — named
below as D0.

Deliverables:

- **D0 — a liveness signal (server; precondition).** Real Ping/Pong handling
  or a periodic keepalive frame, plus a numerically-defined freshness
  budget. Everything in the connection axis hangs off this.
- **D1 — durable push reaches a browser.** No browser surface consumes the
  live socket for durable rows today; All Aboard polls the HTTP outbox
  (`liveQuery().poll()`, 1500 ms). D1 wires the existing socket as the
  browser durable transport — consuming the `live_replace` rows the server
  already pushes — with fresh-subscribe reconnect and the Exact
  connection-axis mapping.
- **D2 — receipts.** MutationReceipt / SubscriptionReceipt per Exact LLP
  0284 §2.6, with an explicit provider-populated vs adapter-stitched key
  split, the existing global commit version as the version fact, and a
  permission-epoch resubscribe reason.
- **D3 — manifest v2 + the ephemeral descriptor kind.** Codegen emits
  `subscription: 'initial-snapshot' | 'none'` today; 0284 §2.4's
  per-descriptor liveness/cost facts are added with an emit-both
  cross-check. The Contract-facing ephemeral descriptor pair is **net-new
  emission** from the existing `ephemeralCollectionReference` (nothing
  Contract-facing exists in-tree to migrate).
- **D4 — bootstrap by blast radius.** Three concrete boot edits (remove
  destructive `reset()` from mount; inspect-first provision; seed-if-empty)
  plus a positive environment/profile capability distinct from the existing
  `AdminWrite` auth policy.
- **D5 — conformance names the checks.** The two-session suites exist as
  demo acceptance (todo, todo-v2, cursors-web); 0284 §5.2's checks become
  named, reusable provider-conformance assertions, including permission-epoch
  and multi-connection cases.

D0+D1+D3 unblock the All Aboard first proof (Exact LLP 0284 §5.3: the cron
delta reaches the browser through generated bindings; `main.ts`'s
`liveQuery` + poll pump and the `store.mjs` container delete — **entangled
with D4's boot edits, which land together**). D2 unblocks Exact LLP 0278 §D.
Exact 0284's acceptance is gated on this document.

## 1. Obligations, mapped to what exists

| Exact 0284 § | Obligation | Here today | Deliverable |
|---|---|---|---|
| §2.1 rule 1 | snapshot-with-subscribe, one operation | ✅ `subscribe_live` returns `{subscription_id, snapshot, permission_epochs}` (`crates/snapback/src/local.rs:596-600`) | D5 names the atomicity check |
| §2.1 rule 3 | declared degradation, static ↔ runtime agreement | partial — transports exist; nothing reports which is in effect | D1 + D2 |
| §2.1 rule 4 | background/foreground = provider policy | ❌ | D1 (§2.4 lifecycle) |
| §2.2 | connection axis (`connecting/live/polling/stale/disconnected`) | ❌ — and no liveness signal exists (`crates/snapback/src/server.rs:625-660`; Ping/Pong no-op at `:641`) | **D0** + D1 §2.3 mapping |
| §2.4 | manifest v2 per-descriptor facts | partial — `subscription` field emitted (`demos/_kit/codegen.mjs:149,183`) | D3 |
| §2.5 | `EphemeralMapCell` metadata (`updatedAt`/`expiresAt`/`sourceClientId`/`self`) | runtime facts exist server-side (LLP 0013) but are not surfaced per entry | D1 + D3 |
| §2.5.1 | delivered-rate observability against `maxDeltaRateHz` | partial — `coalesced_updates` diagnostic (`crates/snapback/src/ephemeral.rs:1278`) | D2 + D5 |
| §2.6 | receipts with normative correlation keys | ❌ (durable payloads already carry the global commit version, `crates/snapback/src/local.rs:1261` — the version fact exists; the receipt surface does not) | D2 |
| §2.7 | bootstrap split by blast radius | partial — `ensure_collections` + identity guard (`crates/snapback/src/ephemeral.rs:703-770`); but All Aboard's boot still calls destructive `reset()` on every load | D4 |
| §5.2 | provider conformance additions | partial — demo acceptance suites | D5 |

## 2. D0 + D1 — a liveness signal, then durable push to the browser

**Fact base (corrected in rev 2):** the server already streams a
connection's outbox over WebSocket (`GET /live/{connection_id}/stream`,
`crates/snapback/src/server.rs:58`), already re-runs affected queries on mutation and pushes
**full replacement rows** (`LiveUpdate{kind:"live_replace", rows, version}`,
`crates/snapback/src/local.rs:1247-1262`), and the kit already opens the socket
(`openLiveStream`, `demos/_kit/client.mjs:164-207`) — but only headless Node
tests use it for durable rows; every browser surface polls. cursors-web
already uses the same socket for ephemeral push. So the wire shape is
decided (full-row replace; a client-side poke-and-refetch would *add* a
round trip) and most of D1 is kit/adapter work — **except D0, which is real
server work the connection axis cannot exist without.**

### 2.1 D0 — the liveness signal (server precondition)

The stream loop drains every 25 ms but sends nothing on an idle-healthy
socket and explicitly ignores Ping/Pong (`crates/snapback/src/server.rs:625-660`, `:641`).
A browser therefore cannot distinguish `live` from a dead-but-open socket
until TCP timeout. D0 adds the smaller of:

- proper Ping→Pong handling (client pings on `heartbeatIntervalMs`; server
  responds), or
- a server-sent keepalive frame when nothing else has been sent for
  `heartbeatIntervalMs`.

**Freshness budget, defined numerically:** `heartbeatIntervalMs` (default
10 000), staleness multiplier `k` (default 3 — no signal for
`k × heartbeatIntervalMs` while a retry/backoff is in progress ⇒ `stale`),
`pollCadenceMs` (default 1 500 — the poll-lane budget). The constants live
in one place in the kit next to the connection-state machine, and the
implementation documents which D0 variant it chose.

### 2.2 One socket, both lanes — with the priority invariant

A connection opens at most one live socket, carrying durable `live_replace`
updates and ephemeral push (the multiplexing the socket already does for
ephemeral extends to durable). HTTP outbox drain remains the declared poll
fallback — same data, declared cadence. **Invariant (LLP 0013, restated):
durable traffic keeps scheduling priority over ephemeral on the shared
socket** — the per-connection outbox already maintains separate bounded
durable and resync lanes (`crates/snapback/src/ephemeral.rs:517-518`); the merge must
preserve that drain order, verified under D5's flood check. No SSE lane
unless a deployment target forbids WebSockets (OQ2).

### 2.3 Connection-axis mapping (kit-derived policy over D0 signals)

The Exact adapter derives 0284 §2.2's `DataConnection` from these provider
events and the D0 budget:

| Provider state | Connection value |
|---|---|
| socket connecting / initial subscribe in flight | `connecting` |
| socket open, subscription established, liveness signal within budget | `live` |
| no socket; HTTP drain timer active at declared cadence | `polling` |
| liveness/poll overdue past `k ×` budget while retry/backoff is in progress | `stale` |
| socket closed and no retry scheduled; drain stopped | `disconnected` |

Build-time transport diagnostics and `SubscriptionReceipt.transport` MUST
agree (0284 §2.1 rule 3).

### 2.4 Reconnect and lifecycle (rewritten in rev 2 — matches the code)

- **Reconnect is always a fresh `subscribe_live`.** Socket close disposes
  the connection's durable subscriptions server-side (`live_stream` calls
  `disconnect` on close, `crates/snapback/src/server.rs:658`; `disconnect` removes them,
  `crates/snapback/src/local.rs:857`) — there is nothing to resume across a dropped socket.
  Fresh subscribe is snapshot-with-subscribe, so no prime race by
  construction; the adapter emits `resubscribed` with
  `reason: 'reconnect'`. A subscription-survival grace window is future
  work, not v1. The server registers the stream task at upgrade
  completion, before any frame, so the kit treats **every** death of a
  constructed socket — including one that never fired client `open`
  (handshake-window death: stalled 101, connect-budget force-close) — as
  requiring the fresh subscribe (ENG-23428); a redundant subscribe is
  safe because it explicitly supersedes its own predecessor, while a
  skipped one strands the handle fake-healthy on a destroyed outbox.
- **`resume_live` is a same-socket repoint, not a reconnect mechanism.** It
  takes `{subscription_id, connection_id, auth, recorded_permission_epochs}`
  — no versions — and returns `mode: 'retained' | 'resnapshot'` driven by
  permission epochs (`crates/snapback/src/local.rs:650-690`). There is no version-based
  delta replay anywhere in resume.
- **Resync triggers are resubscribe triggers.** Outbox overflow
  (`MAX_OUTBOX_BACKLOG`, `crates/snapback/src/ephemeral.rs:191`) collapses the queue to a
  sticky resync signal; permission changes enqueue `resync_required`
  (`crates/snapback/src/local.rs:1404`). Both drive a fresh `subscribe_live` and a
  `resubscribed` receipt with `reason: 'overflow' | 'permission-epoch'`.
  Because the overflow sentinel is one-shot per episode (pushes are dropped
  while overflowed; the flag resets only on drain), a `resync_required`
  consumed while another resubscribe is already in flight is recorded as a
  demand — the in-flight run loops one more fresh subscribe once its POST
  resolves, and the in-flight subscribe does not clear the outstanding need
  (ENG-23429; `demos/_kit/tests/regression-midflight-resync.mjs`).
- **Ephemeral never resumes (promoted from OQ to fact):** `resume_live`
  operates only on durable live-query subscriptions; ephemeral reconnect
  always re-snapshots through the resync lane. Under `stale`/`disconnected`
  the ephemeral map freezes per Exact 0284 §2.5; per-entry `expiresAt` lets
  UIs age entries locally.
- **Background/foreground (0284 §2.1 rule 4):** the kit exposes
  pause/resume; pausing closes or quiesces the socket, resuming re-enters
  through fresh subscribe + `resubscribed`. Policy is a provider/kit fact,
  not app code.

**Dated amendment (2026-07-24, LLP 0090 — token-resume seeds the fresh
subscribe; "snapshot-with-subscribe" becomes
"maybe-`CurrentAsOf`-with-subscribe").**
[LLP 0090](./0090-resumable-query-snapshots.rfc.md) (Accepted) adds
token-based resume without changing this section's entry point: reconnect and
relaunch **still enter through a fresh `subscribe_live`**, and the resume
token only *seeds* that subscribe (an optional `resumeFromToken` on the same
operation). Nothing becomes a cross-socket continuation — `resume_live`
remains a same-socket repoint with no version replay, the `POST
/live/{name}/resume` reattach route remains the subscription-id liveness
mechanism, and every death of a constructed socket still requires the fresh
subscribe with explicit supersession. What the amendment revises is the
response shape this section could previously state unconditionally: for a
**resume-capable subscriber** (one presenting a token for an `rqsEligible`
query), "fresh subscribe is snapshot-with-subscribe" becomes
**"maybe-`CurrentAsOf`-with-subscribe"** — the subscribe is answered by the
first applicable rung of 0090's D1.3 admission ladder: a `CurrentAsOf`
envelope (unchanged proof: fresh token, current head version, no rows),
delta replay ending in a fresh token, or the always-correct fresh
`LiveReplace`. The no-prime-race property survives because 0090's atomicity
rule establishes the answer and the live registration under one arm-specific
serialization cut, not because the answer always carries the snapshot rows.
Subscribers presenting no token, non-`rqsEligible` queries, and every
auth-scoped subscription keep the rev-2 behavior above verbatim (fresh
snapshot on every non-live resume, per LLP 0053 and 0090's Authorization
scope); ephemeral still never resumes.

## 3. D2 — receipts (rewritten in rev 2)

### 3.1 One version, not two

Rev 1 proposed a new per-subscription sequence on the false premise that
updates are unnumbered. In fact every durable snapshot and `live_replace`
already carries the **global durable commit version**
(`crates/snapback/src/local.rs:1261`; `crates/snapback/src/storage.rs` `current_version()` reading
`_snapback_version`). That version *is* `snapshotVersion` /
`lastDeltaVersion` for durable receipts — monotonic, shared across snapshot
and deltas, nothing new invented. For ephemeral, the stored compound
`(scopeEpoch, entryVersion)` (LLP 0013) maps as: `snapshotVersion =
entryVersion`, valid **within** a `scopeEpoch`; an epoch bump is a
resubscription boundary (`resubscribed` receipt), so monotonicity holds
within every receipt-visible window; `scopeEpoch` rides in the
snapback-namespaced payload.

A confirmed mutation receipt always carries that exact durable commit version
as a non-null portable integer. A rejected mutation carries the current durable
cursor when it can be read; it may carry `snapshotVersion: null` only when the
cursor read itself failed. Null therefore means “no safe durable observation,”
never a successful commit at an invented or unknown version.

### 3.2 Provider-populated vs adapter-stitched (the ownership split)

Several Exact 0284 §2.6 keys are Exact-runtime concepts a provider cannot
originate. The split, which is also the provider-side home for Exact 0284
OQ2 / 0278 OQ2:

| Key | Origin |
|---|---|
| `mutationId`, `outcome`, `rollbackReason`, `affectedTables` (explicit-unknown when the function declares no writes), `snapshotVersion`, `degradation`, `scope`, `transport`, `event`, `reason` | **Provider** (server/kit) |
| `actionInvocationId`, `optimisticWaveId`, `rootId`, `bindingIds` | **Adapter-stitched**: the Exact adapter passes an opaque correlation object into `mutate()` / subscribe; the provider echoes it verbatim on the receipt; the adapter completes the join |

`SubscriptionReceipt.event` is `'established' | 'resubscribed' | 'disposed'`
with `reason: 'reconnect' | 'overflow' | 'permission-epoch'` on
resubscription. Delivered ephemeral rate (the `coalesced_updates`
diagnostic, `crates/snapback/src/ephemeral.rs:1278`) becomes a receipt-visible fact so
conformance can check delivered rate ≤ `maxDeltaRateHz` (0284 §2.5.1).

### 3.3 Privacy

Opaque correlation ids (mutation ids, subscription ids, echoed correlation
objects) are receipt-legal. User/session-identifying ids are excluded or
hashed; ephemeral payload *values* (names, coordinates) never appear in
receipts or server logs — Exact 0278 §3's discipline applied server-side.

## 4. D3 — manifest v2 and the ephemeral descriptor kind (baseline corrected)

`demos/_kit/codegen.mjs` today: per-query
`subscription: 'initial-snapshot' | 'none'` (`:149,183` — `'change-only'`
is never emitted by this provider; Exact 0284 §2.4's row for it is N/A
here); four manifests written (`:420-427`); Contract descriptor modules
emitted **for durable functions only** (`renderContractModules`,
`:1059-1093`); ephemeral collections project **only** as
`ephemeralCollectionReference` in `api.mjs`/`api.d.ts` (`:982-998`,
`:1021-1036`) — no Contract-facing ephemeral module exists in-tree. (The
`boardCursors.query.ts` + `boardCursorsPublish.mutation.ts` pair cited by
Exact-side documents lives in the off-tree graffiti worktree, not here.)

Changes:

- **Durable facts (emit-both + cross-check):** per-query `mode` (`'live'`
  for LiveQuery defs, `'snapshot'` otherwise), `livePush` (true once
  D0+D1 land for the deployment), `initialSnapshot`
  (`subscription === 'initial-snapshot'`), `defaultLive: true` for
  LiveQuery (per-definition opt-out), `pollCadenceMs` (floor, default
  1 500). The legacy `subscription` field keeps being emitted; **codegen
  fails if old and new fields disagree.** `manifestVersion` bumps
  additively.
- **Ephemeral descriptor kind (net-new emission, not a migration):**
  codegen iterates ephemeral collections and emits, per collection,
  `<name>.ephemeral.ts` (read descriptor: `entries` typing from `keyMode` /
  `scopeFields` / value schema; TTL facts; `maxDeltaRateHz` from
  `dispatch_ms` — 33 ms ≈ 30 Hz; `coalesce: true`) and `<name>.publish.ts`
  (write descriptor: `sustained_hz`, `burst`, byte caps — the budget facts
  Exact LLP 0281's rated `publish rate=N` compiles against), plus
  `.contract-meta.ts` sidecars matching the durable modules' shape. Until
  Exact ships the `ephemeral` binding, emission sits behind a codegen flag
  so no unconsumable imports appear in demos. Because nothing Contract-facing
  exists to keep in sync, the ephemeral kind needs **no** dual-emit
  cross-check. The Exact-side consumption change (new import-descriptor
  kinds at the 0263 §4.2 / LLP 0183 seam) is named Exact work.
- **Identity per key mode:** for connection-keyed collections,
  `sourceClientId` = the publishing connection's opaque granted wire id and
  `self` means the entry key equals this overlay's granted wire id. The
  app-facing kit `connectionId` is a readable registry label and is not a
  lease key; an initial dev suggestion may be adopted verbatim, while a live
  collision or mint-only containment makes the two values diverge.
  For session- and user-keyed modes (shared lease across tabs),
  `sourceClientId` = the lease key and `self` = "this client holds the
  lease" — defined per key mode in the generated descriptor (OQ6 refines
  the multi-tab edge).

## 5. D4 — bootstrap by blast radius (rewritten as concrete edits)

Two distinct mechanisms, not one: the **existing `AdminWrite` auth policy**
(`crates/snapback/src/server.rs:165-167`, LLP 0031) — which is deliberately open on
loopback without a token — and a **new positive environment/profile
capability** (dev/demo/test) that D4 introduces. Auth answers "may this
principal?"; the profile answers "is this operation appropriate in this
environment?". Destructive operations require both.

The concrete edits (using All Aboard as the exemplar — its boot currently
calls a destructive `client.reset()` on every page load,
`demos/all-aboard/surfaces/contract/main.ts:113`, which is exactly the
multi-window clobber 0284 §2.7 forbids and profile-gating alone does not
fix):

1. **Remove `reset()` from the mount path.** Mount lifecycle = connect,
   health, inspect-only provisioning check ("is this backend provisioned
   for this manifest?") — extending the `ensure_collections` inspect-first
   pattern (`crates/snapback/src/ephemeral.rs:716-770`) to schema and functions as one
   idempotent call.
2. **Provision + seed become inspect-first and environment-gated:**
   `apply_schema` / function push / seed run only when inspection says
   they're needed, only under the profile capability, idempotently, with
   visible diagnostics. Seed becomes **seed-if-empty**, never
   reset-then-seed.
3. **Destructive reset is an explicit admin/test operation**, never
   reachable from mount lifecycle, enforced route-level (LLP 0031 route
   classes) — with the loopback-open question decided in OQ7.

**These edits are entangled with the first proof** (the same `main.ts`
whose poll pump deletes) and land together.

## 6. D5 — conformance and the first proof (re-grounded)

Named provider-conformance checks, extending the todo-v2
`provider-conformance.mjs` + two-session headless lineage (diary 0004;
todo v1's durable two-session + WebSocket cursor suite; **cursors-web** is
the in-tree presence demo — the graffiti suite's cursor-flood check is
off-tree lineage to re-land, not shipped code):

1. **Snapshot-with-subscribe atomicity** — one response carries
   subscription id + snapshot.
2. **Stream-delivered durable update** — client A mutates over HTTP; client
   B (subscribed via stream, not polling) receives `live_replace` without
   polling.
3. **Connection-axis transitions** — kill the socket: `live → stale →
   disconnected` (or fallback to `polling`) per §2.3's mapping and D0's
   budget; restore: fresh subscribe + `resubscribed` receipt and data
   converges.
4. **Receipt monotonicity** — the global commit version is non-decreasing
   across snapshot and updates per binding; ephemeral `updatedAt` monotonic
   per key within a `scopeEpoch`.
5. **Permission-epoch resubscribe** — subscribe, change a permission,
   assert `resync_required` surfaces as `resubscribed` with
   `reason: 'permission-epoch'` and stale rows are replaced by the fresh
   snapshot.
6. **Multi-connection identity** — two tabs, same user: one socket dies,
   the other stays `live`; connection-owned ephemeral `self`/`sourceClientId`
   remain distinct (key-mode rules, §4).
7. **Durable-over-ephemeral priority under flood** — a cursor flood does
   not starve durable updates on the shared socket (drain-order invariant,
   §2.2).
8. **Codegen migration cross-check** — old/new manifest fields agree; a
   deliberately-broken definition fails.

**Ownership table for Exact 0284 §5 "Done means"** (per review — who owns
what; nothing double-assigned):

| 0284 §5 item | Snapback | Exact | Demo owner |
|---|---|---|---|
| 1 manifest v2 + cross-check | D3 | manifest v2 acceptance (0284 §2.4 types) | — |
| 2 conformance green | D5 checks 1–8 | — | todo / todo-v2 / cursors-web |
| 3 All Aboard server-authored delta; pump + store delete | D0+D1+D3 (+D4 boot edits) | adapter consumes live cells + connection axis (0284 §2.2) | all-aboard (LLP 0029) |
| 4 two-client presence | D1+D3 ephemeral read path | `ephemeral` binding (0284 §2.5 — later) | cursors-web |
| 5 receipts inspectable, joined to action log | D2 provider core | adapter stitching + agent surface (0284 §2.6 / 0278) | — |
| 6 degraded example exercised | D3 facts + D2 transport receipt | compiler diagnostic (0284 §2.8) + loop-closure classification (0278 §5) | any poll-backed demo |

**All Aboard runs first:** it has no dependency on Exact LLP 0281 or
pointer events, and its D4 boot edits ship in the same change as the pump
deletion.

## 7. Non-goals

- **No Contract grammar or slot semantics** — Exact LLP 0284 owns the
  authoring surface; this document never defines syntax.
- **No IVM** — Exact LLP 0207's stop-loss stands; the shipped
  re-run-on-mutation full-row-replace stays the durable update shape (row
  diffs are a bandwidth optimization, OQ1).
- **No new realtime protocol** — the existing live socket + HTTP drain are
  the transports; D0 adds a liveness signal *within* them; SSE only if a
  target forbids WS (OQ2).
- **No auth redesign** — identity and permission epochs stay LLP 0011;
  D2/D4 surface and gate, they do not redefine.
- **No second manifest family** — `contract-data.manifest.json` is
  extended in place with the cross-check (Exact 0284 §4).

## 8. Open questions

1. ~~**Row diffs, ever?**~~ **Resolved 2026-07-02 — yes, as `live_delta`.**
   "Measure before designing" was done as LLP 0032 M3
   ([LLP 0035](../llp/0035-local-target-benchmarks.research.md) §M3): once
   DK-4 (warm VM) made fan-out row-bound, whole-result `live_replace` still
   capped live delivery at ~5–6 affected subscribers/commit, and a
   matcher-computed op-log delta was ~5 200× cheaper (a fixture-derived
   figure since superseded — LLP 0035's 2026-07-21 note). So row-level diffs
   shipped as an **additive `live_delta` wire kind** beside `live_replace`
   (the fallback and default), for the analyzable subset — an unordered
   single-table filtered **HostPlan** query, where the predicate is the whole
   query so a predicate-derived delta is sound. Ibex queries (which may
   transform results in JS beyond their captured predicate) and
   ordered/limited windows keep `live_replace`. Server: `notify_live_subscriptions`
   + `compute_live_delta` (`crates/snapback/src/live_matcher.rs`), membership maintained by
   applying ops with a debug-build convergence assertion; client:
   `applyDurable` in `demos/_kit/client.mjs`. Governed by
   [LLP 0008](../llp/0008-local-first-sync-and-realtime.rfc.md) §Decision DK-3;
   this closes DK-3's op-log-delta leg. **Remaining under this question:**
   extending deltas to Ibex passthrough queries needs a handler-purity
   guarantee (the demos are Ibex today, so they fall back to replace);
   windowed (ordered/limited) deltas need boundary maintenance (the matcher
   has the primitives). Both are future work, not blockers.
2. **SSE fallback** — does any deployment target forbid long-lived
   WebSockets and force an SSE lane?
3. **D0 shape** — Ping→Pong vs server keepalive frame; final
   `heartbeatIntervalMs`/`k` after soak (defaults in §2.1).
4. **Receipt retention** — in-memory ring per connection vs durable log;
   what post-hoc verification and bug reports need vs the privacy posture.
5. **Connection-axis semantics under Cloudflare DO hibernation** (LLP
   0014/0013): a hibernating Durable Object has no drain loop or heartbeat
   cadence — does hibernation always surface as `stale`/resync, and is
   that acceptable for the hosted target?
6. **Multi-tab identity for session/user-keyed collections** — §4's
   per-key-mode rule covers the common cases; does a lease held across
   tabs need a sub-identity for `self`?
7. **Loopback-open** — does `AdminWrite`'s open-on-loopback posture stay
   (dev convenience) once the profile capability exists, or does the
   profile flag replace it?
8. **`defaultLive` rollout** — true for every LiveQuery descriptor from day
   one, or All Aboard's target query first and widen after soak? (Lean:
   ship true; the §2.1 budget and D5 check 7 are the guardrails.)

## 9. Status

Accepted (2026-07-01, author's decision). One LLP 0005 review round
complete — GPT (Codex/gpt-5.5) + fresh-context Claude (Opus 4.8), blind to
each other, artifacts in `llp/reviews/`; both recommended
revise-and-stay-Draft pending three blocking corrections (the D0 liveness
precondition, the one-version story, the receipt ownership split), all
incorporated in rev 2 along with the grounding fixes (reconnect reality,
D3 baseline, D4 boot edits, cursors-web re-grounding). Deliverable order:
D3+D0+D1 (unblocks the All Aboard proof, Exact 0277 §5.1 row 4), then D2
(unblocks Exact 0278 §D), with D4/D5 alongside — D4's boot edits land with
the first proof. Implementation of D0/D1/D3/D5 is in flight on branch
`csw/llp-0034-d1-d3` at the time of acceptance.

The §11 headless observation amendment added on 2026-08-11 is separately
**Draft and pending author ratification**. The Accepted transport, lifecycle,
and Contract obligations above remain authoritative; §11 authorizes neither an
API nor implementation until its open questions are decided and the amendment
is ratified.

## 10. ImplNotes (2026-07-01, from the D0/D1/D3/D5 implementation)

Recorded from the first implementation pass (branch `csw/llp-0034-d1-d3`;
cargo 97/97, all demo acceptance suites green, new
`demos/_kit/tests/provider-live-conformance.mjs` 7/7):

- **D0 shape decided (OQ3):** an app-level `{"type":"ping"}` →
  `{"kind":"pong"}` envelope on the live socket (`live_ping`, registered
  per LLP 0031). Protocol-level Ping/Pong was not viable: browser/undici
  WebSocket JS cannot send protocol pings. Constants as shipped:
  `LIVE_HEARTBEAT_INTERVAL_MS = 5000` (not §2.1's provisional 10 000),
  budget `k = 3`, reconnect backoff `250ms × 2ⁿ` capped at 10 s,
  `DEFAULT_POLL_CADENCE_MS = 1500` — documented beside the
  connection-state machine in `demos/_kit/client.mjs`.
- **Connection-axis refinements to §2.3's table:** socket loss with poll
  fallback enabled goes directly `live → polling` (the declared-cadence
  drain is a healthy declared transport, not a degradation); `stale` is
  reserved for budget-missed-while-retrying (fallback disabled, poll
  failures during fallback, or an open-but-silent socket past budget —
  which force-closes and reconnects); `disconnected` (= no retry
  scheduled, matching Exact 0284's definition) is reached via
  dispose/pause, not retry exhaustion, because the kit retries with capped
  backoff while demand exists.
- **Overflow resync is connection-wide**, not per-subscription
  (`OutboundQueue::overflow` carries no `subscription_id`), unlike
  permission/fanout resyncs — §2.4's resubscribe triggers operate at
  connection scope for overflow.
- **Zombie subscriptions (D2-adjacent work, named):** there is no
  `unsubscribe_live` endpoint; in-band resync recovery re-subscribes
  fresh, so a superseded subscription keeps fanning out server-side until
  connection teardown/reap. Subscription GC or an unsubscribe operation
  belongs with D2. *(Closed in D2 — §10.2: explicit client-named
  supersession + `unsubscribe_live`; the server never infers identity.)*
- **Exact-side v2 pin confirmed (§6 ownership table, item 1):** Exact's
  shipped conformance hard-pins `manifestVersion === 1`, so the adapter
  temporarily hands the runtime the v2 document declared as v1 with
  `providerManifestVersion: 2` riding along — deleted when Exact's
  manifest-v2 acceptance lands (implemented on the Exact side in the same
  integration window).
- **OQ8 decided:** `defaultLive: true` shipped for LiveQuery descriptors;
  the opt-out is `defineLiveQuery({ defaultLive: false })`.
- **D5 checks 2 (TTL expiry deletion) and 5 (delivered-rate ≤
  `maxDeltaRateHz`)** remain open pending D2 receipts, as scoped.

### 10.1 Implementation review round + first proof (2026-07-02)

An independent adversarial review of the implementation branch (verdict:
merge-after-fixes; its reproducer probes are preserved as regression
tests) produced five pre-merge fixes, all landed:

1. **Generation-guarded `live_stream` teardown** — a late-dying
   superseded socket can no longer destroy the reconnected session's
   subscriptions and delivery waker (previously masked forever by
   stateless ping). Consequence: an overlapping reconnect now keeps its
   subscriptions; superseded-subscription GC remains the D2-adjacent gap.
   Extended by ENG-23425: the guard now covers the *drain*, not just
   teardown — the per-connection outbox is keyed by connection id alone,
   so a superseded task that kept draining (its 30 s safety-net tick, or
   a stale wake permit) stole the new socket's queued messages into the
   dead half-open socket. The delivery loop checks
   `DeliveryNotifier::is_current` before every drain and exits when
   superseded, leaving the outbox to the socket that owns it.
   Extended again by ENG-23426: the ownership check is now atomic with
   the destructive act. The original guard was check-then-act —
   `unregister` passed, then the task awaited the global write mutex
   (unbounded, behind any slow write) before `disconnect`, so a
   reconnect that registered and re-subscribed inside that await got its
   fresh subscriptions, ephemeral registrations, and outbox wiped by the
   stalled task. Teardown now acquires the mutex *first* and unregisters
   under it, which closes the durable window (a fresh `subscribe_live`
   serializes behind the same mutex, and a reconnect registers its
   socket before re-subscribing, so a fresh durable subscription implies
   a registration the unregister then fails on); the ephemeral wipe runs
   off that mutex, so `disconnect_guarded` re-verifies
   `DeliveryNotifier::is_registered` under each room/outbox lock as it
   wipes and aborts the moment the id is reclaimed (a reconnect's
   subscribe needs the very lock the checking step holds); on abort it
   re-indexes the unvisited rooms into the ENG-23348 reverse index so
   the connection's eventual final disconnect still reaches them. The
   reaper and the admin disconnect route keep the unconditional wipe.
   **Revised 2026-07-16:** the mutex-first/guarded-wipe implementation above is
   now historical. It composed the global Local writer with notifier and
   ephemeral shard locks and admitted a reverse edge against authenticated
   live publication. Ordinary socket close now atomically replaces the exact
   notifier generation with a teardown claim while temporarily suspending its
   still-reusable registry grant; after releasing registry/notifier locks it
   runs whole-id ephemeral cleanup, Local-only topology cleanup, and a final
   exact-fence purge before clearing the claim. A stale generation cannot
   acquire that ownership. Admin disconnect and idle maintenance instead
   remove the exact grant (and enable mint-only containment) before spawning
   owned notifier → ephemeral → Local → exact-purge cleanup; the old bearer is
   invalid before the admin route can acknowledge success. Direct-library
   combined disconnect/reaper methods remain compatibility seams only outside
   the managed Local write scope, with a debug/test assertion enforcing that
   boundary.
   The former registration-order residual is closed: a pre-socket durable
   subscribe must win the exact registry act before suspension and is then
   either finalized before cleanup or terminalized by it; a subscribe that
   loses the suspension cut is refused without a Local effect.
2. **Honest resubscribe** — `live` is claimed only when a subscribe
   actually lands; failures surface, retry on bounded backoff, and every
   drain tick re-enters the fresh subscribe while needed (covers the
   destroyed-outbox-drains-empty polling variant).
3. **In-flight optimistic rows survive concurrent `live_replace`** — the
   adapter re-applies pending optimistic reducers on every server-rows
   write (interim mechanism until D2 receipts). The re-apply has a dual
   hazard (ENG-23385): server rows arriving during the window may already
   *contain* the mutation's committed row (the server can commit and fan
   out before the `mutate()` response resolves — the client's own
   `live_replace` racing the HTTP response, or a concurrent mutation's
   reconcile), so a naive insert reducer appends a duplicate optimistic
   copy for the rest of the window. Optimistic reducers are therefore
   spec'd **idempotent**: id-keyed update/delete reducers already are;
   insert reducers must skip appending when a committed match is present.
   The adapter records each op's `baseVersion` (the server rows' max
   durable `_version` when the mutation fired) and passes it in the
   reducer context so an insert reducer can distinguish its own landed
   commit (a matching committed row *newer* than `baseVersion`) from a
   pre-existing look-alike row.
4. **Path-independent generated hashes** — handler sources hash by
   manifest-relative path; the conformance cross-check generates into a
   temp copy and gained a real freshness guard (regen inputsHash must
   equal committed).
5. **`establish()`/`resume()` detach the stream manager on subscribe
   failure** (previously leaked socket + heartbeat + reconnect loop).

Regression tests:
`demos/_kit/tests/regression-{reconnect-nuke,fake-live,optimistic-clobber}.mjs`.
Review residuals, open: §6.5 (permission-epoch resubscribe) and §6.6
(multi-connection identity) conformance checks are not yet written; the
full cursor-flood variant of §6.7 is open (the one-socket-both-lanes
ground check exists); cross-lane destructive drains (durable
`drainUpdates` discards ephemeral envelopes and vice versa) is a kit
footgun to resolve when one connection combines both lanes outside the
adapter.

**First proof complete (Exact 0284 §5 items 1–3):** All Aboard runs on
the paved path — `store.mjs`, the `client.liveQuery` + 1500 ms poll pump,
and the boot-path `client.reset()` are deleted; boot is inspect-first and
seed-if-empty; `liveTrainStatus` + `feedState` are live-bound over one
shared socket; the `stale rows` arm was verified against a live server
kill (last-known board + "Reconnecting" note, recovery to `live`); the
browser suite asserts the cron-authored delta reaches the browser with no
pump and that a second window's boot provisions nothing and does not
disturb the first (the LLP 0275 C4 footgun, closed). Item 4's provider
half is proven (two-client presence in the conformance suite); the
Contract `ephemeral` binding remains Exact-side future work; items 5–6
pend D2. Friction for the record: **bun-vite cannot proxy WebSocket
upgrades** (vite 8.0.16 under `bun --bun`: the tunnel hangs open — demos
talk to Snapback directly at a vite-`define`d origin, the cursors-web
pattern; an ecosystem landmine for any Exact surface proxying a provider
socket through the dev server); `connecting` must be **budget-bounded**
(a swallowed upgrade previously produced permanent `connecting` with
fallback never engaging — fixed with a connect budget); the adapter's
`validateBindingSet` wrongly demanded query bindings for Actions (fixed —
conformance fixtures should include an action-bearing manifest); D4
residual server work: a true seed-without-reset server path and the
positive environment-profile capability.

### 10.2 D2 + ephemeral integration rounds (2026-07-02)

**D2 delivered** (ENG-22478; adversarially reviewed — 11 findings, 8 fixed
pre-merge, 3 claim corrections; six probe-derived regression tests now
gated in `verify-local-proof`):

- **Explicit supersession replaces inferred GC.** §3/§10.1's
  "superseded-subscription GC" shipped briefly as server-inferred
  (connection+function+args+principal) matching — the review proved that
  starves a second *legitimate* identical subscriber, silently, under a
  `live` connection. The protocol is now explicit: the kit names its
  predecessor (`LiveSubscribeInput.supersedes`) only on its own
  reconnect/resync paths; the server disposes exactly that id
  (same-connection + same-owner checks; unknown ids no-op); plain
  duplicate subscribes coexist. `unsubscribe_live`
  (`POST /live/{name}/unsubscribe`) + dispose-wiring close the
  unmount-while-connected zombie.
- **Receipts.** MutationReceipt from the mutation choke point
  (provider-core fields; `rollbackReason` is the diagnostic code only;
  `affectedTables` explicit-`null` when undeclared; verbatim correlation
  echo capped at 4 KB with a truncation marker; `transport` adopted into
  Exact 0284 §2.6). SubscriptionReceipt full field set with required
  `scope`. **Ring keying:** mutation receipts live in a *global* ring
  (`HandlerInput` has no connection identity and the provider never
  interprets correlation); per-connection rings hold subscription
  lifecycle; `GET /_snapback/api/receipts` (SystemApi/AdminRead) serves
  both plus `ephemeralDelivery` facts. Disconnect-time disposal receipts
  carry `snapshotVersion: null` — the teardown lane is rusqlite-free
  under the L7 exec guard. Mutation receipts use a narrower closure: confirmed
  requires a non-null durable version, while rejected may use null only when
  its cursor read failed; the generated JSON Schema rejects confirmed/null.
- **Scope epochs are real:** a monotonic backend counter survives room
  recreation; `replace_collections`/`reset_runtime_state` retire rooms
  through resync signals, so an epoch bump is an actual resubscription
  boundary (§3.1 now holds as written).
- **Lane registry:** durable socket frames route through the same
  per-connection lane registry as HTTP drains (single delivery,
  mixed-transport regression) — the §10.1 cross-lane footgun fix, taken
  the code route; overlays filter by room identity. Both fan-out choke
  points isolate each consumer invocation (ENG-23391, extending review
  fix G's receipt-listener rule): `GET /outbox/:id` is a destructive
  drain, so a throwing app callback must never discard the envelopes
  dequeued behind it (including a `resync_required` sentinel), and a
  socket-path throw must not escape the async message listener as an
  unhandled rejection. A durable payload that fails to decode surfaces
  as a `SNAPBACK_ENVELOPE_DECODE_FAILED` diagnostic on the drain result
  instead of aborting the batch.
- **`maxDeltaRateHz` re-scoped (correcting §2.1/D3's premise):** L8's
  event-driven delivery removed the 33 ms dispatch window, so the fact
  now means the *coalescing bound for drain-paced consumers*; the
  enforced ceilings are the publish token bucket and latest-state
  coalescing. A hard delivery-side ceiling on the socket path would be
  new server work — named, not scheduled. The delivered-rate conformance
  check is framed to what it measures; §6.5 is scoped to reason plumbing
  (row-level permission semantics are LLP 0011 land).

**Ephemeral integration delivered** (ENG-22479 provider half; reviewed —
merge-after-fixes, all four applied with a 4/4 regression suite):

- Codegen emits the descriptor kind on by default: manifest queries
  entry with `ephemeral: true` + keyMode/scopeFields/TTL/rate facts,
  `<name>.ephemeral.ts`, `<name>.publish.ts` (budget facts;
  mutation-shaped callable until Exact 0281), contract-meta sidecars;
  cross-check + adapter validators cover the kind.
- The adapter's `buildEphemeralWiring` feeds Exact's boundary provider
  (its force plane used, not reinvented) through shared
  per-(collection, scope) overlays with in-flight dedup;
  `sourceClientId` = lease key and `self` per key mode (Session/Custom
  degrade to false — OQ6 refinement stands); TTL-expired entries prune
  at emit on a healthy connection with a one-shot expiry re-emit timer
  (Exact 0284 §2.5's rule holds on quiet rooms; freeze-at-last-known
  stays reserved for degraded connections); resync retries on bounded
  backoff presenting `stale` while unsubscribed; dispose guards every
  await. **The adapter passes Exact's hardened conformance gate,
  including all five ephemeral probes and both force-plane pins.**
- **Exact 0284 §5 item 4 is proven:** cursors-web gained a Contract
  surface beside the untouched DOM one — client B's cursor reaches
  client A's `ephemeral` *binding* through generated bindings alone
  (two-window acceptance 4/4, including forced-ghost local-only and
  dispose-restore). The imperative overlay's deletion remains Exact
  0281 stage-0's budget. Item 5 is proven at the provider+adapter
  halves (receipts joined by correlation; Exact-runtime
  `actionInvocationId`/`optimisticWaveId` stitching pends LLP
  0231/0278). Item 6's provider half is proven (degraded-example
  conformance); its compiler-diagnostic half pends the LLP 0194
  amendment (Exact 0284 §8).

**Follow-ups named, not scheduled:** per-scope forcing (forces are
name-scoped across scopes today); an idle-room teardown policy before
app scale (scoped rooms accumulate one live server subscription per
room visited until surface dispose); generated ephemeral value shapes
are decorative (no member checking — durable rows do get
`shape_unknown_member`); `exact.pin.json` drift is warning-only unless
`EXACT_PIN_STRICT=1`; one idempotent ensure-everything server call (the
D4 seed-without-reset + profile-capability residual) so Contract
presence surfaces don't each carry a provision-if-missing boot branch.
*(Four of these shipped as ENG-22527 — see §10.3; per-scope forcing and
strict-by-default pin checking remain open.)*

### 10.3 Operational follow-ups (2026-07-02, ENG-22527)

Four of the follow-ups above are now scheduled work, delivered on this
round (the remaining two — per-scope forcing and strict-by-default pin
checking — stay named-not-scheduled):

- **One idempotent ensure-everything call.** `POST /app/ensure` inspects
  `schemaHash`/`bundleHash`, provisions only the missing halves,
  seeds only when every seed target table is empty, and never resets —
  D4's mount-lifecycle doctrine as one server-side op. Every demo boot
  (cursors-web both surfaces, all-aboard, todo, todo-v2) now makes the
  single `client.ensureApp(...)` call; the per-surface
  provision-if-missing branches (~56 lines) are deleted. Provisioning
  is gated by the new positive profile capability: `SNAPBACK_PROFILE`
  (`dev|demo|test|prod`; default dev on loopback binds, prod otherwise),
  with destructive ops requiring AdminWrite AND a non-prod profile
  (`SNAPBACK_PROFILE_FORBIDS`, 403). Gated ensure halves report
  `"gated"` rather than erroring, so inspection stays always-allowed.
  **Auth closure (ENG-24595):** that last compatibility behavior now belongs
  only to the closed, untagged v0-dev request. The explicit
  `{ intent: "attest" }` variant is the Public v1-sessions identity-only
  comparison and rejects manifests, seed, mode material, and unknown fields.
  The explicit `{ intent: "provision" }` variant requires AdminWrite in every
  auth mode plus the non-prod profile before any loaded-hash comparison or
  effect; matching content never weakens the gate. The central selector also
  evaluates requested, active, and desired mode facts: legacy requires settled
  dev, Public attest requires a settled matching mode, and privileged provision
  remains the correction/re-stage branch. The active/desired values are an
  explicit runtime seam here; LLP 0039 item 4 owns persisting and consuming the
  staged mode pre-bind.
- **Typed ephemeral value shapes.** Generated `.ephemeral` contract-meta
  now emits the real value shape (`<Name>Entry` with a typed `value`
  member built from the collection's validator fields) instead of the
  decorative `unknown`. The compiler half of the gap remains on the
  Exact side: `analyze.ts` populates `queryResultTypes` only for
  `descriptor?.kind === 'query'`, so `c.value.nosuchfield` on an
  ephemeral binding still produces no `shape_unknown_member` — reported
  precisely for the ENG-22526 track (Exact 0284 §8).
- **Idle-room teardown policy.** The adapter now lingers an
  observerless (collection, scope) overlay for
  `EPHEMERAL_IDLE_LINGER_MS` (30 s; `ephemeralIdleLingerMs` surface
  option) and then tears it down: best-effort
  `POST /ephemeral/unsubscribe` (new op — `unsubscribe_live` is
  durable-lane only; this removes just the subscriber registration,
  never published entries, and receipts
  `disposed/unsubscribed` into the connection ring), overlay disposed
  and cache dropped on settle. Rebind within the window cancels and
  reuses; rebind after expiry waits out the in-flight teardown and
  subscribes fresh (registration identity is (room, connectionId) — a
  late unsubscribe must never remove a fresh registration). Ordering
  is load-bearing: the teardown dispatches the unsubscribe BEFORE
  dropping its `manager.onState` demand, because dropping the last
  demand closes the shared socket and the server's disconnect cleanup
  would remove every registration on the connection first
  (nondeterministic receipts, sibling rooms silently unregistered) —
  found by the linger regression pair now gated in
  `regression-ephemeral-wiring.mjs`. Surface dispose skips the linger.
- **Liveness facts into sidecars.** Generated contract-meta now carries
  the Exact 0284 §2.4 fact names (`mode`, `livePush`,
  `initialSnapshot`, `pollCadenceMs`, `transport`, `ephemeral`) per
  binding, for the exact-side ENG-22526 consumption track.

### 10.4 Graffiti wall port (2026-07-03, ENG-22219)

The collaborative graffiti wall (`demos/graffiti/`; Diary 0006) is the first
surface to combine, in one `.contract`, everything this seam shipped: a
durable live `query` binding (board-scoped `listCells` over the shared
stream), the generated `ephemeral` binding (`boardCursors.ephemeral.ts`),
and the authored rated `publish` line (Exact LLP 0281) against the D3
publish-budget facts. One adapter gap surfaced and was closed additively:

- **Scoped live queries in multi-query mode.** `createSnapbackContractSurface`
  multi-live mode subscribed every named query with empty args (fine for All
  Aboard's zero-arg descriptors, unusable for a board-scoped wall). A
  `liveQueries` entry now accepts `{ name, args }` alongside bare names;
  the subscription binds with the validated args and everything else
  (boundary key, connection axis, correlation) is unchanged.

  The honest invariant (adversarial-review hardening, same round): the
  configured entry's args are the ONLY args that reach the server — one
  subscription per query name, established at surface creation, validated
  server-side at subscribe. **Binding-site args are not consulted on the
  multi-live read path.** Two guard rails keep that from becoming silent
  wrong-data: duplicate `liveQueries` names are rejected at creation with
  `SNAPBACK_CONTRACT_LIVEQUERY_DUPLICATE` (the handles and boundary are
  keyed by name, so a duplicate would clobber its sibling), and a binding
  whose args deep-differ from the configured entry's records
  `SNAPBACK_CONTRACT_LIVEQUERY_ARGS_MISMATCH` in the surface diagnostics
  plus a dev warning — it is still served the configured scope's rows, but
  never silently. This is now named **legacy boot-scoped mode**, retained for
  published-runtime compatibility and gated by
  `regression-multilive-scoped.mjs`; it is no longer the platform ceiling.

#### Dynamic keyed query scopes

Accepted 2026-07-20 for LLP 0063 Step 1.

`keyedQueryScopes: true` is the accepted additive mode. In this mode
`liveQueries` is only a descriptor allowlist. An object's historical `args`
member is ignored, and every generated binding's args are the authoritative
server args. Exact's runtime owns the logical key `(opaque authority
partition, stable descriptor identity, compatibility token, canonical args)`,
same-key attempt sharing, independent binding refcounts, and logical
generation fencing. Snapback owns one physical `liveQuery` attempt per Exact
logical subscription, transport reconnect, and disposal of a handle that
resolves after its binding is gone.

An authority-barrier quiesce rotates the opaque partition synchronously. Exact
first fences and clears predecessor entries; Snapback holds successor physical
opens until the barrier resumes with its new user and authority capture. Thus
same-user reauthentication, anonymous/authenticated changes, tenant/root
changes, and provider reconfiguration never preserve logical identity merely
because query args happen to match. Mutation dispatch is rejected while the
provider is quiesced. The dynamic mode currently requires live push and does
not claim retained/offline behavior; those are later profile gates, not silent
fallbacks.

The differential gate is
`demos/partiful-matrix/tests/acceptance/step1-keyed-scopes.mjs`: it imports
Exact's adversarial oracle and adds the real Snapback provider seam, including
canonical same-key sharing, different-scope and different-provider isolation,
late predecessor suppression, authority rotation, structured invalid-args
refusal, and HMR/root teardown.

The capability-scoped packaging paths are also first-class. A runtime that
exposes partition rotation may construct `createKeyedSnapbackContractProvider`
directly from `@snapback/contract/keyed-provider`; it runs generated-artifact
coherence checks when artifact identity is present and exposes Exact-compatible
broadcast/scoped `forceQueryState` controls without allocating a physical
transport while a scope is forced. The published Exact 0.1.2 runtime predates
that partition API, so Partitime's stable-package arm instead uses
`@snapback/contract/online-surface`: a lean extraction of the legacy preopened,
boot-scoped multi-live semantics, including artifact validation, connection
drivability, Exact's force plane, server-authoritative mutations, and disposal.
It does not pretend to offer binding-time scope identity.

Neither capability-scoped path replaces the full surface's authority
participant. A client with `authCoordinator`, `agentAuthority`, retained state,
or offline replay still enters through `createSnapbackContractSurface`, which
owns boot, quiesce, partition rotation where supported, and resume.

The demo's row-shape acceptance check also confirms the §10.3 note about the
Exact-side ephemeral `queryResultTypes` gap in practice: `shape_unknown_member`
fires through helper-declared shapes (the surface mirrors the generated
`BoardCursorsEntry`/`Value` shapes in its `data.contract-meta.ts`), not through
the `ephemeral` binding itself — still an ENG-22526 (Exact 0284 §8) item.

### 10.5 Construction failure releases everything already established (2026-07-06, ENG-23383)

The kit already guaranteed that a failed `liveQuery()` leaves nothing running
(§2.4's "fails loudly" contract); the adapter now guarantees the same for
`createSnapbackContractSurface` as a whole. The receipt listener attaches
before any fallible work, and multi-live mode establishes one live handle per
`liveQueries` entry sequentially — so a validation throw, a rejected
subscribe (including mid-loop, stranding earlier entries' handles), or a
failed prewarm used to leak on every app-level retry: accumulated receipt
listeners (callbacks firing N times per receipt) plus orphaned handles whose
shared-stream demand never drops, leaving the manager reconnecting forever
and the server fanning out to a connection nobody drains. Both construction
paths now clean up on any failure — dispose the handles established so far,
dispose the ephemeral wiring, detach the receipt listener — before the error
(diagnostics intact) surfaces. Gated by
`packages/snapback-contract/surface-construction-failure.test.mjs` (plain
node, mock client/runtime).

### 10.6 Multi-live mode honors the poll/reconcile opt-out (2026-07-07, ENG-23386)

`livePush: false` — or a client without `liveQuery()` — is D1's documented
opt-out: "poll/reconcile only". Single-query mode always honored it (one
`client.query` snapshot plus reconcile-on-mutate); multi-live mode did not —
with `wantLivePush` false it skipped the subscribe loop, left every
non-ephemeral cell `[]`, and its `persistMutation` never reconciled, so every
binding served permanently empty *ready* data while mutations silently
committed server-side. Multi-live mode now matches the single-mode contract:
each configured `liveQueries` entry seeds from a `client.query` snapshot with
its configured args, and every mutation reconciles all configured entries
from fresh snapshots. A reconcile failure after a committed mutation is
diagnosed as `SNAPBACK_CONTRACT_RECONCILE_FAILED` (not a mutation failure)
and propagates. Non-configured queries no longer get boundary cells: if a
generated binding consumes one, the provider emits an error cell carrying
`SNAPBACK_CONTRACT_QUERY_UNCONFIGURED`, so omitted surface configuration can
never masquerade as a successful empty database. The push path is otherwise
unchanged (no polling; fan-out owns the boundary). Gated by
`packages/snapback-contract/multi-live-poll-reconcile.test.mjs` (plain node,
mock client/runtime).


### 10.7 Render-first surface mode (2026-07-09, ENG-23736)

The adapter treated the connection as a precondition: construction awaited
every live snapshot-with-subscribe before returning links, and the generated
per-binding modules throw when links are read before configuration — so an
app that wants a useful first paint from bundled/deterministic data (All
Aboard's board-first startup, ENG-23727) had to hand-roll a forwarding-links
shim. That shim is now the package's render-first mode
(`packages/snapback-contract/render-first.mjs`):
`createRenderFirstSnapbackContractSurface(options)` returns synchronously —
query links hand the runtime forwarding handles that stay silent (binding
holds `pending`, the `.contract`'s `loading` arm renders), mutation links
queue, ephemeral map links stay silent — while connection, an app-supplied
`connect` preflight (health/ensure; D4 stays app-owned), and subscription
establishment run in the background on capped backoff (1s doubling to 15s).
Bindings go live in place when the real surface attaches. A failure retries
forever behind the app's bundled-data UI (`onRetry` hook per attempt) only
when the shared client classifier proves transport-connectivity loss: fetch
dispatch produced no Response (`fetchDispatchFailed`, with the guarded
`TypeError` compatibility arm). The same decision covers both the app-supplied
`connect` preflight and surface construction/live subscription establishment.
A diagnostic code alone is not provenance, and an HTTP response — including a
proxy-origin 5xx with `SNAPBACK_HTTP_ERROR` — is terminal because transport
succeeded and the answer is ambiguous. Terminal failures reject `attached`
immediately with no retry, but the handle still returns mountable links so the
app paints either way. A dispose racing a late-succeeding construction disposes
the fresh surface rather than leaking it (the §10.5 posture).
Gated by `packages/snapback-contract/render-first.test.mjs`; All Aboard's
`deferred-links.ts` shim is deleted in favor of this mode.

ENG-24371 closes the other side of that lifecycle: disposal before attach
rejects every queued mutation/publish with
`SNAPBACK_CONTRACT_SURFACE_DISPOSED`, settles an active retry sleep so its
async loop can terminate, and suppresses further retries. Query/ephemeral
subscriptions keep their pending/silent presentation but release their
internal attach waiters. This applies to each subscription's own dispose, not
only whole-surface disposal: repeated offline mount/unmount cycles leave the
pending attach set empty and settle their private promises before attachment.
Disposing the low-level deferred primitive after attachment also closes every
retained inner query/ephemeral forwarding subscription. If an inner subscribe
delivers synchronously and that callback re-enters disposal before the handle
is returned, the newly returned handle is closed immediately. Teardown attempts
all forwarders in insertion order even when one throws, settles remaining
waiters, releases the attached surface, and only then reports the ordered
failures as `SNAPBACK_CONTRACT_SURFACE_DISPOSAL_FAILED`.
`onRetry` and first-delivery callbacks are
observational and isolated — throwing app instrumentation cannot strand
`attached` or starve a data delivery.

### 10.8 Hosted stream establishment reconciles through current-socket readiness (2026-07-12)

The hosted route hardening in LLP 0040 requires every HTTP live subscription
to bind to the current authenticated WebSocket session. The shared kit starts
the socket upgrade and snapshot-with-subscribe POST concurrently so the local
target can still establish a socketless subscription and use its declared HTTP
poll fallback when WebSockets are blocked. On the hosted target, however, a
fast POST can reach the coordinator before the upgrade handler records the
session and receive `SNAPBACK_CONNECTION_SOCKET_REQUIRED`, even though the
socket opens a moment later.

The reconciliation is deliberately status-and-diagnostic-specific. Only a
`409` response carrying
`SNAPBACK_CONNECTION_SOCKET_REQUIRED` and
`SNAPBACK_CONNECTION_SESSION_REPLACED` may trigger a retry: both coordinator
paths return before a subscription row is persisted. The kit then proves the
current managed-socket generation with a correlated ping/pong, bounded by the
stream freshness budget, and retries after that proof. Raw browser `open` is
not sufficient across targets because a local upgrade callback can still be
registering its delivery task. The manager shares one in-flight readiness
probe across parallel bindings, but each binding awaits through its own
lifecycle-cancelable wrapper. Passive readiness observation does not count as
socket demand: pausing or disposing the final binding closes the manager and
settles its wait immediately, while canceling one of several parallel bindings
does not cancel their shared proof. A synchronous send failure enters the same
immediate loss/reconnect transition as socket close. State observers are
isolated so throwing app instrumentation cannot starve the internal readiness
observer. The probe rejects on terminal manager close or outer timeout and
cannot accept a stale generation's pong because non-current socket frames are
ignored; ordinary socket loss carries the bounded wait onto its replacement.

Every generic network error, timeout, 5xx response, and other diagnostic stays
ambiguous and is surfaced without replay. Successful local socketless subscribe
does not enter the readiness path, preserving poll fallback. The two permitted
replays are a hard cap (three POST attempts total). Reconnect, resync, resume,
and fallback fresh-subscribe work is serialized per handle, with lifecycle
validity checked before every POST and after every await. Each operation
captures `supersedes` only after acquiring that queue, so concurrent lifecycle
demands form one explicit predecessor chain instead of sibling subscriptions;
a late HTTP success after pause/dispose is retired immediately. If an attempt
fails, its queue generation advances before the FIFO tail is released, so
already-queued same-lifecycle work is cancelled before its first POST instead
of replaying an ambiguous predecessor with the same `supersedes` value.

The deterministic kit regression checks initial and pause/resume reconciliation,
send failure, no-pong replacement, stale-generation pong rejection, exact retry
cap, per-caller pause/dispose cancellation, resume/reconnect serialization,
throwing observer isolation, generic-error no-replay, parallel bindings, and
local socketless fallback. The All Aboard Miniflare acceptance is the hosted
end-to-end proof against the socket-required coordinator.

### 10.9 Observational callbacks and failed optimistic work cannot own lifecycle (2026-07-12)

ENG-24494 closes the remaining receipt-observer escape hatch in the shared kit.
`onSubscriptionEvent` now uses the same isolated delivery choke point as
connection, update, and retained receipt listeners. Disposal marks one
reentrant teardown in progress, preserves established-before-disposed receipt
ordering, and attempts unregister, stream detach, terminal transition, and
server unsubscribe even if an internal step fails. An app callback that throws
or calls `dispose()` again can no longer reject successful establishment,
recurse through disposal, or strand the provider consumer.

ENG-24495 applies the same ownership rule to optimistic presentation. The
adapter inserts an optimistic op only for the duration of a successful initial
prediction. If the app reducer or derived-ledger evaluation throws
synchronously, the adapter removes the op before any queue/transport work,
rewrites the boundary from authoritative rows, emits
`SNAPBACK_CONTRACT_OPTIMISTIC_REDUCER_FAILED`, and returns a tracked rejected
promise. Later live rows never re-run that failed reducer. Provider lifecycle
and server truth therefore remain independent from app presentation failures.

### 10.10 Versioned seed evolution: the explicit exception boundary (2026-08-03 dated amendment, LLP 0109 acceptance)

Accepted LLP 0109 (author acceptance 2026-08-03, decision sitting #2
extension, `issues/20260803-author-decision-sitting-2.md`) makes the D4
seed-if-empty doctrine's compatibility boundary explicit:

- The untagged v0-dev ensure and the explicit `provision` intent keep the
  exact settled semantics recorded here — seed only when **every** seed
  target table is empty (`seeded`), otherwise `skipped-nonempty` (a
  partially populated legacy target still collapses to `skipped-nonempty`
  for wire compatibility), `gated` under the profile gate without scanning,
  `skipped-absent` when no seed is supplied — and never write a versioned
  `SeedIdentityV1` or versioned seed receipt.
- Versioned installation is a separate closed family (LLP 0109's
  `app.seed.*` carriers), not a new behavior of these requests. It sees
  real per-target occupancy: data seeded or skipped by the legacy lane is
  *untracked* to it and refuses rather than adopts, and legacy success or
  skip is never retroactive identity evidence.
- A legacy reset over a versioned instance clears the versioned identity in
  the destructive transaction and leaves any raw legacy seed untracked; no
  legacy operation can create, preserve across a reset, or silently advance
  versioned identity.

Seed-if-empty therefore remains the settled compatibility lane, with
versioned evolution as the explicit, separately carried exception on top of
it.

### 10.11 Keyed Contract surfaces serve the ephemeral link family (2026-08-10)

The additive `keyedQueryScopes: true` mode now composes the complete generated
ephemeral family beside its durable keyed links. Its provider accepts the same
boundary-source map as Exact's ordinary boundary provider and implements
`subscribeEphemeral`, while ephemeral descriptor names remain outside the
durable query allowlist and the surface continues to own `<name>` and
`<name>Publish` link construction. The surface prewarms and disposes the shared
wiring, exposes the existing source-start/prewarm probes, and swaps mounted
ephemeral bindings across the authority barrier with the same blank, prepare,
prewarm, fenced-expose, and sessions-mode `authorityIndependent` rule as the
multi-live path.

A keyed surface refuses construction with
`SNAPBACK_CONTRACT_EPHEMERAL_UNSUPPORTED` when the required ephemeral
collections (or every manifest-declared ephemeral collection when none is
required explicitly) cannot be served because the client lacks the ephemeral
subscription/live-stream machinery. The diagnostic names both bindings in
each missing link family. Ephemeral names in `requiredQueries` are therefore
checked against wiring support rather than the durable `liveQueries`
allowlist. The §10.5 whole-attempt cleanup rule applies to this refusal after
authority or receipt resources have already been established.

The keyed provider deliberately does **not** implement
`forceEphemeralState` in this change. Exact's local-only forcing semantics stay
available on the ordinary boundary-provider path; the keyed omission is an
explicit, greppable capability gap rather than an accidental partial
implementation.

**The ephemeral lane takes its own connection.** The first implementation gave
both lanes the surface's connection id, on the reasoning that the multi-live
surface already shares one. That is wrong under re-keying: with an ephemeral
consumer holding demand on the durable connection, a disposed keyed binding's
subscription is never unregistered server-side. The pointing-room
contract-browser arm caught it — four live subscriptions after a room switch
(both predecessors plus both successors), unchanged at 45 s, with the UI half
entirely correct. A same-host bisect over the same binary and packages isolated
it to the presence of the ephemeral consumer on that connection, and not to the
link wrappers, the provider's `subscribeEphemeral`, or the participant rewrite;
separate connections restore the expected pair-per-scope.

The keyed surface therefore mints a dedicated ephemeral connection id, stable
across authority transitions, and the durable lane keeps the surface's own.
The host-independent LLP 0189 D-8 harness in
`tests/acceptance/axis-parity-harness.mjs` settles the composition rule at the
raw wire and server-registration boundary: an isolated keyed durable binding
unregisters when disposed, but a binding sharing its `connectionId` with an
ephemeral consumer emits no unsubscribe request, remains in `admin.inspect()`,
and receives the next commit's `authorization_invalidation` frame after its
Contract binding was disposed. Only release of the final shared connection
demand closes the socket and reaps that registration.

**Constraint:** consumers that require independent durable re-key or disposal
MUST NOT share that durable connection id with an ephemeral demand holder.
Sharing is sound only when every durable registration's lifetime is
coextensive with the shared connection lifetime; the current multi-live path
meets that narrower condition because it does not independently re-key those
durable subscriptions. This is why the keyed surface keeps separate
connections. The battery suite holds both topology outcomes and replaces the
former browser/host-dependent detector; the resolved evidence is retained in
`issues/closed/20260810-durable-unsubscribe-withheld-behind-shared-connection-demand.md`.

## 11. Draft amendment: iterator-owned headless live observation (2026-08-11)

**Amendment status:** Draft; pending author ratification. This section proposes
an additive client surface. It does not describe shipped behavior.

**Review status (2026-08-11): NOT READY.** The first review —
`llp/reviews/0034-s11-watchquery-amendment.claude.md` — returned 3 blocking,
6 material, 5 minor concerns, and found the proposed *shape* (cold,
single-consumer, latest-value-coalescing async iterable) sound while judging
the evidence base, the acceptance bar, and the cleanup rule not ratifiable as
written. Three corrections it verified against code, recorded here so this
section does not assert them uncorrected:

1. **This amendment does change an Accepted requirement.** Acceptance item 4
   below would amend §10.11's shared-demand Constraint and flip
   `tests/acceptance/axis-parity-harness.mjs:497`, which asserts
   `stillRegistered === true` and whose own comment says that if the assertion
   flips, §10.11 says the keyed surface should return to one connection.
2. **"dispose that handle and await its settlement" does not map onto shipped
   primitives.** `handle.settled()` awaits `cleanupTail`, which `dispose()`
   never feeds — `dispose()` parks its unsubscribe in `disposalTask`. Separately
   `LiveQueryHandle.dispose()` is declared `void` while the implementation
   returns that task; filed as
   `issues/20260811-livequeryhandle-dispose-typed-void-returns-promise.md`.
3. **The LLP 0187 citation is inverted.** The `.rows` vs `.current` item appears
   in that RFC's "What routed correctly — the control group" section as a case
   of accurate types *rescuing* a wrong model.

The four open questions at the end of this section remain the ratification
gate; the review's recommended answers dissent from the draft on questions 3
and 4. Nothing here is settled until the author rules.

### Evidence and problem

The low-level `SnapbackClient.liveQuery()` surface is accurate but easy to
model incorrectly from its name. It returns a promise for one mutable
`LiveQueryHandle`: the authoritative or retained current value lives at
`.rows`; explicit poll mode advances through `.poll()`; stream mode updates
the same handle and may call observers; and the caller owns `.dispose()`.
Provider code has a second, deliberately different `startLiveQuery()` wrapper
whose not-yet-established handle lives at `.current`.

The types and Guide document those facts. They have nevertheless produced two
independent wrong mental models:

- LLP 0187 records `.rows` versus `.current` confusion that accurate type
  declarations rescued; and
- Diary 0075 initially treated the promise-resolved `liveQuery()` handle as an
  async iterator, then corrected the proof after reading the Guide.

The second case is not a Guide gap. It is evidence that the common headless
intent — “observe this query until I stop” — lacks a surface whose ownership
and control-flow shape match ordinary JavaScript. Repeating more handle prose
does not remove that API-model translation.

### Proposed decision

Add a high-level `client.watchQuery()` async-iterable surface. Keep
`liveQuery()` and `startLiveQuery()` unchanged for compatibility and for
callers that need direct handle/provider lifecycle control. Do **not** make
`LiveQueryHandle` itself async iterable in the first slice: a handle may
already have callback observers and an independently owned lifetime, so
`break` would have ambiguous authority to dispose it.

The intended common form is:

```ts
for await (const snapshot of client.watchQuery(api.recentTriumphs, {
  args: { limit: 10 },
})) {
  render(snapshot.rows);
}
```

The generated-reference overload preserves the exact argument and result
types. A declaration sketch, not yet frozen public spelling:

```ts
export interface LiveQueryWatchSnapshot<Rows> {
  readonly rows: Rows;
  readonly version: number;
  readonly connection: 'connecting' | 'live' | 'polling' | 'stale' | 'disconnected';
  readonly freshness: 'retained' | 'current' | null;
  readonly authorizationDenial: LiveQueryAuthorizationDenial | null;
  readonly reason: 'initial' | 'update' | 'connection' | 'authorization' | 'resubscribed';
}

watchQuery<Ref extends FunctionRef<'Query' | 'LiveQuery'>>(
  ref: Ref,
  options?: {
    readonly args?: FunctionArgs<Ref>;
    readonly userId?: string;
    readonly connectionId?: string;
    readonly transport?: 'stream' | 'poll';
    readonly pollCadenceMs?: number;
    readonly fallbackToPoll?: boolean;
    readonly signal?: AbortSignal;
  },
): AsyncIterable<LiveQueryWatchSnapshot<FunctionResult<Ref>>>;
```

### Observation semantics

`watchQuery()` is a cold, single-consumer async iterable:

1. Calling it allocates no socket, subscription, timer, or retained-store
   writer. The first `next()` establishes the underlying live query.
2. The first yield is the first renderable snapshot. If retained state is
   legitimately renderable before current authority arrives, it may yield as
   `freshness: 'retained'`; the later authoritative answer yields again even
   when its rows compare equal.
3. Later yields represent current state, not transport events. Row changes,
   freshness/authorization boundaries, resubscription, and observable
   connection transitions may produce a new immutable snapshot.
4. The iterable has a bounded latest-value slot, not an event-log queue. A slow
   consumer may skip intermediate row replacements or deltas and must receive
   the newest converged state. Authorization blank/denial state replaces any
   queued more-authorized state; coalescing may never resurrect rows retired by
   a later authority boundary.
5. Mutation settlement still does not imply that the iterator already yielded
   its matching state; LLP 0200's scheduled fan-out rule is unchanged.
6. A transient socket loss, poll fallback, resubscribe, or
   `CurrentAsOf` answer does not terminate the iterator. A terminal
   establishment/authorization/runtime failure rejects `next()` with the
   existing stable diagnostic and begins cleanup.

This is a state observer, not a lossless audit stream. Consumers that need
every receipt or transport frame keep using the existing receipt/observer
surfaces.

### Lifecycle and connection ownership

The iterator owns exactly one underlying handle. `return()` (including a
`break` from `for await`), `throw()`, an abort signal, or a terminal failure
must dispose that handle and await its settlement before the iterator reports
cleanup complete. Disposal is idempotent. An iterable may be consumed only
once; a second iterator acquisition refuses rather than creating hidden
sibling subscriptions.

Omitting `connectionId` uses one client-owned readable connection label so
ordinary watches multiplex over the managed socket. That label remains local
plumbing, never granted wire identity or authorization evidence. An explicit
label continues to support deliberate connection topology.

Shared socket demand must not weaken iterator ownership. §10.11 proves that
today a durable registration can remain server-side when another consumer
keeps the same connection alive. The `watchQuery()` acceptance bar therefore
requires explicit retirement of its exact durable subscription on iterator
cleanup even while a sibling watch or ephemeral consumer retains socket
demand. Allocating a new connection per watch would make cleanup easier but
would discard the one-socket multiplexing design and is not the proposed
default.

### Compatibility and routing

- `liveQuery()` keeps its existing promise-to-handle result, poll default,
  callbacks, mutable `.rows`, and caller-owned disposal.
- `startLiveQuery()` remains the cancellable provider-registration seam with
  `.current`, `started()`, `dispose()`, and `settled()`.
- `watchQuery()` defaults to stream observation with the existing honest poll
  fallback. Explicit `transport: 'poll'` runs the cadence internally; it does
  not require the consumer to call `.poll()` between iterator steps.
- The headless Guide should lead with `watchQuery()` for sequential
  observation and route to `liveQuery()` when a caller needs current-state
  inspection, manual polling, pause/resume, callbacks, or connection receipts.
- Generated API references and the package declaration surface must make the
  common loop typecheck without casts. No generated app wrapper or second
  manifest family is introduced.

The first slice does not add an `openLiveQuery()` alias or deprecate
`liveQuery()`. Naming migration can be reconsidered after usage evidence; the
additive observation surface addresses the demonstrated mistake without
creating a second compatibility program.

### Acceptance

1. A typed generated-reference test proves exact args and yielded row types,
   plus negative cases for wrong arguments and non-row results.
2. A real headless test receives the initial snapshot, observes a later
   cross-client mutation, breaks, and leaves no live registration or timer.
3. Early break, thrown loop body, abort-before-establishment,
   abort-during-establishment, abort-after-yield, and repeated cleanup all
   settle without an unhandled rejection.
4. Cleanup retires the exact server subscription while a sibling durable or
   ephemeral consumer keeps the same managed connection alive.
5. A slow-consumer test drives more updates than the queue bound, proves
   bounded memory/latest-state coalescing, and ends at the authoritative rows
   and version.
6. Authorization quarantine/denial tests prove that queued older rows cannot
   follow the blank or denial snapshot.
7. Reconnect, resync-required, token-seeded `CurrentAsOf`, and poll fallback
   preserve one iterator identity and converge without duplicate server
   registrations.
8. Existing `liveQuery()` and `startLiveQuery()` behavior/type suites remain
   unchanged and green.
9. A clean external npm fixture runs the iterator form against published
   package declarations; the Guide snippet is executable evidence, not prose
   alone.

### Open questions for ratification

1. Is `watchQuery` the final verb, or does `observeQuery` better distinguish
   current-state observation from an event stream? The draft recommends
   `watchQuery` because it matches the control-flow intent and avoids another
   “subscribe returns what?” noun split.
2. Should connection-only transitions yield snapshots when rows and freshness
   are unchanged? The draft says yes so a sequential consumer can render stale
   and disconnected state without installing a second observer.
3. Does post-establishment terminal authorization denial yield one final
   denied snapshot and then remain observable, or yield it and complete? The
   existing handle freezes the denial for rendering; parity suggests remain
   open until disposal or later authority replacement.
4. Is one client-owned default connection label safe for every client custody
   transition, or must the default roll with a narrower existing connection
   epoch? The readable label must never become the opaque granted wire id.

Ratification should resolve these four questions, request an LLP 0005-scaled
review because lifecycle cleanup crosses the §10.11 shared-demand boundary,
and only then authorize implementation.

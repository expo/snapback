# LLP 0034: Contract Source Seam, Provider Side — Live Transports, Receipts, Manifest v2, and Conformance

**Type:** RFC
**Status:** Accepted
**Systems:** Live Queries, Ephemeral, Codegen, Server, Client Kit, Conformance, Contract Integration
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-01
**Revised:** 2026-07-01 (rev 2 — LLP 0005 review incorporation, one GPT (Codex/gpt-5.5) + one fresh-context Claude (Opus 4.8) review, artifacts in `llp/reviews/0034-contract-source-seam-provider-side.{gpt,claude}.md`, run blind to each other and convergent. Load-bearing corrections: **added D0** — the connection axis requires a server keepalive that does not exist (the stream sends nothing when idle and no-ops Ping/Pong), so "wiring, not server work" was oversold; **collapsed the version story to the existing global durable commit version** (rev 1's "updates are unnumbered" was false — every `live_replace` already carries it) and specified the ephemeral `(scopeEpoch, entryVersion)` mapping, deleting the invented per-subscription sequence; **split receipts into provider-populated vs adapter-stitched keys** with an inbound-correlation convention (several 0284 §2.6 keys are Exact-runtime concepts a provider cannot originate); **rewrote reconnect around reality** — socket close disposes durable subscriptions server-side, so reconnect is always a fresh `subscribe_live`, and `resume_live` is permission-epoch-driven retain/resnapshot with no version replay; corrected D3's baseline (in-tree, ephemeral collections project only as `ephemeralCollectionReference` — the query/mutation presence pair exists only in the off-tree graffiti worktree, so the ephemeral kind is net-new emission, simpler than a migration); re-grounded presence proofs on `cursors-web`; rewrote D4 as three concrete boot edits plus the AdminWrite-vs-profile distinction; promoted old OQ6 to a stated fact (ephemeral has no resume path; it always re-snapshots); reframed OQ1 (the server already pushes full replacement rows — a poke would be a regression); added the durable-over-ephemeral drain-priority invariant, the permission-epoch receipt reason, the §5 ownership table, DO-hibernation and key-mode identity OQs. Accepted same day by the author's decision, the round's blocking concerns being resolved in this revision. rev 1 — initial draft)
**Related:** Exact LLP 0284 (Contract Source Seam, rev 3 — the interface this implements; its acceptance gates on this document), Exact LLP 0263 (Contract Data Bindings — the manifest/adapter surface), Exact LLP 0278 (Verification Depth — §D consumes the receipts specified here; D2 is the provider home for its OQ2), Exact LLP 0281 (Transient Reactivity Lane — rated `publish` compiles against the budget facts D3 emits), Exact LLP 0275 (the realtime gap report), LLP 0013 (Ephemeral Realtime State — the shipped subsystem D1/D3 expose), LLP 0008 (Local-First Sync and Realtime), LLP 0011 (Auth and Permissions — permission epochs), LLP 0012 (Headless Integration Contract), LLP 0014 (Cloudflare Strategy — OQ5's hibernation semantics), LLP 0020 (Core Authoring Surface), LLP 0021 (Contract/Exact Integration Hardening — the program this lands in), LLP 0025 (Web Cursor Presence Demo — the idempotent-ensure lineage), LLP 0026 (Ephemeral Backend Abstraction), LLP 0027 / LLP 0029 (All Aboard demo + gap closure — the first proof's home), LLP 0031 (Server Route Taxonomy — D4's gating home), LLP 0032 (Decision and Implementation Hardening), diaries 0001 (snapshot-with-subscribe praised), 0004 (provider-conformance lineage), 0006 (graffiti acceptance — off-tree worktree), 0008 (All Aboard glue); **reviews:** `llp/reviews/0034-contract-source-seam-provider-side.{gpt,claude}.md`

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
cleanup — `src/ephemeral.rs`). `subscribe_live` already returns the
authoritative initial snapshot in the same response as the subscription id
(`src/local.rs:596-600`). A live WebSocket (`GET
/live/{connection_id}/stream`) already carries ephemeral push to real
browsers (cursors-web) and durable full-row updates to headless tests — the
server even re-runs queries on mutation and pushes `live_replace` rows with
a global commit version attached (`src/local.rs:1247-1262`). The
inspect-before-provision boot (`ensure_collections`,
`src/ephemeral.rs:716-770`, LLP 0025 lineage) already exists for ephemeral
collections. **But it is not all wiring:** the stream has no liveness signal
at all (idle sockets send nothing; Ping/Pong are no-ops, `src/server.rs:641`),
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
| §2.1 rule 1 | snapshot-with-subscribe, one operation | ✅ `subscribe_live` returns `{subscription_id, snapshot, permission_epochs}` (`src/local.rs:596-600`) | D5 names the atomicity check |
| §2.1 rule 3 | declared degradation, static ↔ runtime agreement | partial — transports exist; nothing reports which is in effect | D1 + D2 |
| §2.1 rule 4 | background/foreground = provider policy | ❌ | D1 (§2.4 lifecycle) |
| §2.2 | connection axis (`connecting/live/polling/stale/disconnected`) | ❌ — and no liveness signal exists (`src/server.rs:625-660`; Ping/Pong no-op at `:641`) | **D0** + D1 §2.3 mapping |
| §2.4 | manifest v2 per-descriptor facts | partial — `subscription` field emitted (`demos/_kit/codegen.mjs:149,183`) | D3 |
| §2.5 | `EphemeralMapCell` metadata (`updatedAt`/`expiresAt`/`sourceClientId`/`self`) | runtime facts exist server-side (LLP 0013) but are not surfaced per entry | D1 + D3 |
| §2.5.1 | delivered-rate observability against `maxDeltaRateHz` | partial — `coalesced_updates` diagnostic (`src/ephemeral.rs:1278`) | D2 + D5 |
| §2.6 | receipts with normative correlation keys | ❌ (durable payloads already carry the global commit version, `src/local.rs:1261` — the version fact exists; the receipt surface does not) | D2 |
| §2.7 | bootstrap split by blast radius | partial — `ensure_collections` + identity guard (`src/ephemeral.rs:703-770`); but All Aboard's boot still calls destructive `reset()` on every load | D4 |
| §5.2 | provider conformance additions | partial — demo acceptance suites | D5 |

## 2. D0 + D1 — a liveness signal, then durable push to the browser

**Fact base (corrected in rev 2):** the server already streams a
connection's outbox over WebSocket (`GET /live/{connection_id}/stream`,
`src/server.rs:58`), already re-runs affected queries on mutation and pushes
**full replacement rows** (`LiveUpdate{kind:"live_replace", rows, version}`,
`src/local.rs:1247-1262`), and the kit already opens the socket
(`openLiveStream`, `demos/_kit/client.mjs:164-207`) — but only headless Node
tests use it for durable rows; every browser surface polls. cursors-web
already uses the same socket for ephemeral push. So the wire shape is
decided (full-row replace; a client-side poke-and-refetch would *add* a
round trip) and most of D1 is kit/adapter work — **except D0, which is real
server work the connection axis cannot exist without.**

### 2.1 D0 — the liveness signal (server precondition)

The stream loop drains every 25 ms but sends nothing on an idle-healthy
socket and explicitly ignores Ping/Pong (`src/server.rs:625-660`, `:641`).
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
durable and resync lanes (`src/ephemeral.rs:517-518`); the merge must
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
  `disconnect` on close, `src/server.rs:658`; `disconnect` removes them,
  `src/local.rs:857`) — there is nothing to resume across a dropped socket.
  Fresh subscribe is snapshot-with-subscribe, so no prime race by
  construction; the adapter emits `resubscribed` with
  `reason: 'reconnect'`. A subscription-survival grace window is future
  work, not v1.
- **`resume_live` is a same-socket repoint, not a reconnect mechanism.** It
  takes `{subscription_id, connection_id, auth, recorded_permission_epochs}`
  — no versions — and returns `mode: 'retained' | 'resnapshot'` driven by
  permission epochs (`src/local.rs:650-690`). There is no version-based
  delta replay anywhere in resume.
- **Resync triggers are resubscribe triggers.** Outbox overflow
  (`MAX_OUTBOX_BACKLOG`, `src/ephemeral.rs:191`) collapses the queue to a
  sticky resync signal; permission changes enqueue `resync_required`
  (`src/local.rs:1404`). Both drive a fresh `subscribe_live` and a
  `resubscribed` receipt with `reason: 'overflow' | 'permission-epoch'`.
- **Ephemeral never resumes (promoted from OQ to fact):** `resume_live`
  operates only on durable live-query subscriptions; ephemeral reconnect
  always re-snapshots through the resync lane. Under `stale`/`disconnected`
  the ephemeral map freezes per Exact 0284 §2.5; per-entry `expiresAt` lets
  UIs age entries locally.
- **Background/foreground (0284 §2.1 rule 4):** the kit exposes
  pause/resume; pausing closes or quiesces the socket, resuming re-enters
  through fresh subscribe + `resubscribed`. Policy is a provider/kit fact,
  not app code.

## 3. D2 — receipts (rewritten in rev 2)

### 3.1 One version, not two

Rev 1 proposed a new per-subscription sequence on the false premise that
updates are unnumbered. In fact every durable snapshot and `live_replace`
already carries the **global durable commit version**
(`src/local.rs:1261`; `src/storage.rs` `current_version()` reading
`_snapback_version`). That version *is* `snapshotVersion` /
`lastDeltaVersion` for durable receipts — monotonic, shared across snapshot
and deltas, nothing new invented. For ephemeral, the stored compound
`(scopeEpoch, entryVersion)` (LLP 0013) maps as: `snapshotVersion =
entryVersion`, valid **within** a `scopeEpoch`; an epoch bump is a
resubscription boundary (`resubscribed` receipt), so monotonicity holds
within every receipt-visible window; `scopeEpoch` rides in the
snapback-namespaced payload.

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
diagnostic, `src/ephemeral.rs:1278`) becomes a receipt-visible fact so
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
  `sourceClientId` = publishing connection and `self` = "my connection."
  For session- and user-keyed modes (shared lease across tabs),
  `sourceClientId` = the lease key and `self` = "this client holds the
  lease" — defined per key mode in the generated descriptor (OQ6 refines
  the multi-tab edge).

## 5. D4 — bootstrap by blast radius (rewritten as concrete edits)

Two distinct mechanisms, not one: the **existing `AdminWrite` auth policy**
(`src/server.rs:165-167`, LLP 0031) — which is deliberately open on
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
   pattern (`src/ephemeral.rs:716-770`) to schema and functions as one
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

1. **Row diffs, ever?** The shipped shape is full-row `live_replace`;
   row-level diffs would be a pure bandwidth optimization for large result
   sets. Measure before designing (reframed in rev 2 — a poke lane is off
   the table; it would regress the round trip the current code avoids).
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

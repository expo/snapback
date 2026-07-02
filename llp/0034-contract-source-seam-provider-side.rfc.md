# LLP 0034: Contract Source Seam, Provider Side — Live Transports, Receipts, Manifest v2, and Conformance

**Type:** RFC
**Status:** Draft
**Systems:** Live Queries, Ephemeral, Codegen, Server, Client Kit, Conformance, Contract Integration
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-01
**Revised:** 2026-07-01
**Related:** Exact LLP 0284 (Contract Source Seam, rev 3 — the interface this implements; its acceptance gates on this document), Exact LLP 0263 (Contract Data Bindings — the manifest/adapter surface), Exact LLP 0278 (Verification Depth — §D consumes the receipts specified here), Exact LLP 0281 (Transient Reactivity Lane — rated `publish` compiles against the budget facts D3 emits), Exact LLP 0275 (the graffiti gap report), LLP 0013 (Ephemeral Realtime State — the shipped subsystem D1/D3 expose), LLP 0008 (Local-First Sync and Realtime), LLP 0012 (Headless Integration Contract), LLP 0020 (Core Authoring Surface), LLP 0021 (Contract/Exact Integration Hardening — the program this lands in), LLP 0025 (Web Cursor Presence Demo — the idempotent-ensure lineage), LLP 0026 (Ephemeral Backend Abstraction), LLP 0027 / LLP 0029 (All Aboard demo + gap closure — the first proof's home), LLP 0031 (Server Route Taxonomy — D4's gating home), LLP 0032 (Decision and Implementation Hardening), diaries 0001 (snapshot-with-subscribe praised), 0004 (provider-conformance lineage), 0006 (graffiti acceptance), 0008 (All Aboard glue)

---

## Summary

Exact LLP 0284 (rev 3) defines what it means for a Contract data binding to
be *live* — durable `query` push, the `ephemeral` presence map, a connection
axis, receipts, and provider-owned bootstrap — and assigns the provider half
to Snapback. This document is that half: the named deliverables, grounded in
what already ships.

The honest starting position is strong. The ephemeral subsystem is complete
and Accepted (LLP 0013: TTL/lease, latest-state coalescing, token-bucket
publish budgets, connection-owned cleanup — `src/ephemeral.rs`).
`subscribe_live` already returns the authoritative initial snapshot in the
same response as the subscription id (`src/local.rs:596-600`; the seam diary
0001 praised, now normative in Exact LLP 0284 §2.1 rule 1). A live WebSocket
(`GET /live/{connection_id}/stream`) already carries ephemeral push to real
browsers (cursors-web) and durable deltas to headless tests. The
inspect-before-provision boot (`ensure_collections`,
`src/ephemeral.rs:716-770`, LLP 0025 lineage) already exists for ephemeral
collections.

What is genuinely missing, in five deliverables:

- **D1 — durable push reaches a browser.** No browser surface consumes the
  live socket for durable rows today; All Aboard polls the HTTP outbox
  (`liveQuery().poll()`, 1500 ms). D1 wires the existing socket as the
  browser durable transport with a reconnect/resume story and the Exact
  connection-axis mapping.
- **D2 — receipts.** MutationReceipt / SubscriptionReceipt per Exact LLP
  0284 §2.6 do not exist as a surface. D2 emits them with the normative
  correlation keys and monotonic versions.
- **D3 — manifest v2 + ephemeral descriptor kinds.** Codegen emits
  `subscription: 'initial-snapshot' | 'none'` today; 0284 §2.4's
  per-descriptor liveness/cost facts and the `*.ephemeral.ts` /
  `*.publish.ts` descriptor pair do not exist. Presence pairs are generated
  as plain query+mutation.
- **D4 — bootstrap by blast radius.** The ephemeral ensure path exists;
  schema/function provisioning and seed are still callable from every page
  load. D4 extends inspect-first to the whole boot and gates destructive
  operations server-side.
- **D5 — conformance names the checks.** The two-session suites exist as
  demo acceptance (todo, todo-v2, graffiti); 0284 §5.2's checks become
  named, reusable provider-conformance assertions.

D1 + D3 unblock the All Aboard first proof (Exact LLP 0284 §5.3: the cron
delta reaches the browser through generated bindings; `main.ts`'s
`liveQuery` + poll pump and the `store.mjs` container delete). D2 unblocks
Exact LLP 0278 §D. Exact 0284's acceptance is gated on this document.

## 1. Obligations, mapped to what exists

| Exact 0284 § | Obligation | Here today | Deliverable |
|---|---|---|---|
| §2.1 rule 1 | snapshot-with-subscribe, one operation | ✅ `subscribe_live` returns `{subscription_id, snapshot, permission_epochs}` (`src/local.rs:596-600`); `resume_live` exists (`:604`) | D5 names the atomicity check |
| §2.1 rule 3 | declared degradation, static ↔ runtime agreement | partial — transports exist; nothing reports which is in effect | D1 + D2 |
| §2.1 rule 4 | background/foreground = provider policy | ❌ | D1 (lifecycle §2.3) |
| §2.2 | connection axis (`connecting/live/polling/stale/disconnected`) | ❌ (no transport-state surface) | D1 §2.2 mapping |
| §2.4 | manifest v2 per-descriptor facts | partial — `subscription` field emitted (`demos/_kit/codegen.mjs:149,183`) | D3 |
| §2.5 | `EphemeralMapCell` metadata (`updatedAt`/`expiresAt`/`sourceClientId`/`self`) | runtime facts exist server-side (LLP 0013) but are not surfaced per entry | D1 + D3 |
| §2.5.1 | delivered-rate observability against `maxDeltaRateHz` | partial — `coalesced_updates` diagnostic (`src/ephemeral.rs:1277`) | D2 + D5 |
| §2.6 | receipts with normative correlation keys | ❌ | D2 |
| §2.7 | bootstrap split by blast radius | partial — `ensure_collections` + identity guard (`src/ephemeral.rs:703-770`) | D4 |
| §5.2 | provider conformance additions | partial — demo acceptance suites | D5 |

## 2. D1 — durable push to the browser

**Fact base:** the server already streams a connection's outbox over
WebSocket (`GET /live/{connection_id}/stream`, `src/server.rs:58`), and the
kit already opens it (`openLiveStream`, `demos/_kit/client.mjs:164-207`) —
but only headless Node tests use it for durable rows
(`demos/todo/tests/acceptance/headless.mjs`); every browser surface polls
(`GET /outbox/{connection_id}`). cursors-web already uses the same socket
for ephemeral push. **D1 is therefore kit/adapter wiring plus lifecycle
semantics, not a new server transport.**

### 2.1 One socket, both lanes

A connection opens at most one live socket. It carries durable deltas and
ephemeral push (the multiplexing the socket already does for ephemeral
messages extends to the durable outbox). HTTP outbox drain remains the
declared poll fallback — same data, declared cadence. No SSE lane unless a
deployment target forbids WebSockets (OQ2).

### 2.2 Connection-axis mapping (normative)

The Exact adapter derives 0284 §2.2's `DataConnection` from these provider
events:

| Provider state | Connection value |
|---|---|
| socket connecting / initial subscribe in flight | `connecting` |
| socket open, subscription established, heartbeat within budget | `live` |
| no socket; HTTP drain timer active at declared cadence | `polling` |
| freshness budget missed (heartbeat/poll overdue by the descriptor's budget) while retry/backoff is in progress | `stale` |
| socket closed and no retry scheduled; drain stopped | `disconnected` |

The freshness budget is a descriptor fact (D3: `pollCadenceMs` floor for
poll; heartbeat interval × k for push — defaults set here, overridable per
collection). Build-time transport diagnostics and
`SubscriptionReceipt.transport` MUST agree (0284 §2.1 rule 3).

### 2.3 Reconnect, resume, and lifecycle

- Reconnect resumes via `resume_live` with the last-seen versions; if the
  outbox overflowed (`MAX_OUTBOX_BACKLOG`, `src/ephemeral.rs:191` — the
  queue collapses to a resync signal), the provider re-snapshots through the
  same snapshot-with-subscribe path — never a prime race — and emits a
  `resubscribed` receipt.
- Background/foreground (0284 §2.1 rule 4): the kit exposes pause/resume;
  pausing closes or quiesces the socket, resuming re-enters through
  `resubscribed` + fresh snapshot. Policy (pause vs keep-alive) is a
  provider/kit fact, not app code.
- Ephemeral entries during degraded connection follow Exact 0284 §2.5: the
  map freezes; the connection axis is the trust signal; per-entry
  `expiresAt` lets UIs age entries locally.

## 3. D2 — receipts

Emit both receipt families with Exact LLP 0284 §2.6's verifier-facing keys
**verbatim** (they are interface-normative there; this document owns their
provider mapping). Snapback-specific payload extensions live under a
namespaced `snapback` field — this is the provider half of Exact 0278 OQ2 /
0284 OQ2's ownership split.

Provider mapping:

- `mutationId` — the server operation id for the function invocation.
- `affectedTables` — from the function's declared writes
  (`functions.manifest.json`); a function without declared writes yields an
  explicitly-unknown receipt, never a silently-empty one (Exact 0263's
  `mutates`-honesty rule).
- `snapshotVersion` / `lastDeltaVersion` — a per-subscription monotonic
  delta sequence, assigned where the outbox enqueues (new; today updates are
  unnumbered). One version story across snapshot, deltas, and resync (OQ3).
- `SubscriptionReceipt.scope` — the binding's routing/scope args (e.g.
  `roomId` from `EphemeralCollectionReference.scopeFields`); scope identity
  is required by 0284 §2.6.
- Surfacing: mutation responses carry their MutationReceipt; subscription
  events (`established` / `resubscribed` / `disposed`) ride the live-socket
  and drain envelopes; the kit hands both to the Exact adapter and the
  agent/debug surface.
- Ephemeral delivered-rate: the existing `coalesced_updates` diagnostic
  becomes a receipt-visible fact so conformance can check delivered rate ≤
  `maxDeltaRateHz` (0284 §2.5.1's observable budget).
- **Privacy:** presence payloads (names, coordinates, client ids) are
  PII-bearing per Exact 0278 §3 — receipts carry versions and ids, never
  ephemeral payload values; server logs likewise.

## 4. D3 — manifest v2 and the ephemeral descriptor pair

`demos/_kit/codegen.mjs` (which already emits
`contract-data.manifest.json` with per-query
`subscription: 'initial-snapshot' | 'none'`, and per-function
`*.query.ts` / `*.mutation.ts` descriptors) gains the 0284 §2.4 fields:

- `mode` (`'live'` for `LiveQuery` definitions, `'snapshot'` otherwise),
  `livePush` (true once D1 lands for that deployment), `initialSnapshot`,
  `defaultLive` (true for LiveQuery; overridable per definition for chatty
  tables), `pollCadenceMs` (provider floor; the demos' current 1500 ms is
  the starting default), `maxDeltaRateHz` / `coalesce` (from the ephemeral
  collection's `dispatch_ms` — 33 ms ≈ 30 Hz — and latest-state semantics),
  `receipts: 'mutation+subscription'` once D2 lands.
- The legacy `subscription` field keeps being emitted during migration
  (0284 §2.4's emit-both rule), plus a **migration cross-check**: codegen
  fails if old and new fields disagree.

**Ephemeral descriptor kind (the migration Exact 0284 §3 names):** an
ephemeral collection stops projecting as a plain query+mutation pair
(today: `boardCursors.query.ts` + `boardCursorsPublish.mutation.ts`) and
emits a typed pair:

- `<name>.ephemeral.ts` — the read descriptor: `entries` typing derived
  from `EphemeralCollectionReference` (`keyMode`, `scopeFields`,
  `routingFields`, value schema), TTL facts (`defaultTtlMs`, `maxTtlMs`),
  and delivery mode. Entry metadata maps: `updatedAt`/`expiresAt` from the
  server clock + lease; `sourceClientId` from the publishing connection;
  `self` computed client-side against the binding's own connection id.
  **This answers 0284's connection-identity question: the Snapback
  connection owns cleanup (LLP 0013's `disconnect()` semantics), and that
  identity is what surfaces as `sourceClientId`.**
- `<name>.publish.ts` — the write descriptor carrying the budget facts
  (`sustained_hz`, `burst`, byte caps) that Exact LLP 0281's rated
  `publish rate=N` compiles against: author rate above the provider budget
  is a build-time contradiction, not a runtime surprise. Until 0281 stage 0
  lands, the same descriptor remains callable as today's mutation-shaped
  publish (Exact 0284 §5.4's read-side-first proof depends on this).

## 5. D4 — bootstrap by blast radius, server-enforced

The ephemeral half exists: `replace_collections` no-ops on identical
definitions (`src/ephemeral.rs:703-708`, @ref LLP 0025) and
`ensure_collections` inspects without clearing
(`POST /ephemeral/collections/ensure`). D4 completes 0284 §2.7:

- **Mount lifecycle (always allowed):** connect, health, and inspect-only
  provisioning checks — for schema and functions too, not just ephemeral
  collections ("is this backend provisioned for this manifest?" as one
  idempotent call).
- **Provision + seed (environment-gated):** `apply_schema` /
  `loadFunctions` / seed become profile-gated (dev/demo/test), idempotent,
  and diagnostic-emitting. Today All Aboard's browser boot calls
  loadSchema/loadFunctions/reset/seed on every page load — exactly the
  demo-fixture behavior 0284's reviewers flagged; it moves behind the gate.
- **Destructive reset (admin/test only):** `reset_runtime_state` and
  friends are never reachable from mount lifecycle; enforcement is
  route-level (LLP 0031's taxonomy), not client convention.

## 6. D5 — conformance and the first proof

Named provider-conformance checks, extending the todo-v2
`provider-conformance.mjs` + two-session headless lineage (diaries 0004,
0006; todo v1's durable two-session + WebSocket cursor suite):

1. **Snapshot-with-subscribe atomicity** — snapshot and subscription id in
   one response; no window where a delta can be missed (Exact 0284 §5.2).
2. **TTL expiry deletion** — an expired entry leaves `entries` and is never
   re-exposed.
3. **Connection-axis transitions** — kill the socket: `live → stale →
   disconnected` per §2.2's mapping; restore: `resubscribed` receipt + fresh
   snapshot; fall back to drain: `polling`.
4. **Receipt monotonicity** — versions non-decreasing per binding;
   `updatedAt` monotonic per ephemeral key.
5. **Delivered rate ≤ `maxDeltaRateHz`** under a publish flood (the
   graffiti suite's cursor-flood check, promoted).
6. **Two-client durable + two-client presence** — client B's write/cursor
   reaches client A through the paved path.

**First-proof mapping (Exact 0284 §5, "Done means"):** items 1–2 land here
(D3 manifest + D5 checks); item 3 (All Aboard cron delta, delete `main.ts`'s
`liveQuery`+poll pump and `store.mjs`) needs D1+D3 plus the Exact-side
adapter and is the first thing to run end-to-end — LLP 0029 is its
demo-side home; item 4 (two-client presence, graffiti pump deletes) needs
D1+D3 read-side only; items 5–6 need D2. All Aboard runs first: it has no
dependency on Exact LLP 0281 or pointer events.

## 7. Non-goals

- **No Contract grammar or slot semantics** — Exact LLP 0284 owns the
  authoring surface; this document never defines syntax.
- **No IVM** — Exact LLP 0207's stop-loss stands; coarse
  re-run/notification stays correct behind the subscription boundary.
- **No new realtime protocol** — the existing live socket + HTTP drain are
  the transports; SSE only if a target forbids WS (OQ2).
- **No auth redesign** — identity stays LLP 0011; D2/D3 only *surface*
  connection identity already owned there.
- **No second manifest family** — `contract-data.manifest.json` is
  extended in place with the cross-check; a parallel manifest is a design
  failure (Exact 0284 §4).

## 8. Open questions

1. **Durable delta wire shape** — replay row-level deltas on the socket, or
   a "re-run this subscription" poke with the rows fetched via the existing
   query path? (Coarse poke is 0207-consistent and simplest; deltas save a
   round trip. Lean: poke first, measure.)
2. **SSE fallback** — does any deployment target (LLP 0014 Cloudflare
   posture) forbid long-lived WebSockets and force an SSE lane?
3. **One version story** — reconcile `schemaVersion`/`bundleHash` with the
   new per-subscription delta sequence so `snapshotVersion` means one thing
   in receipts, resume, and conformance.
4. **Receipt retention** — in-memory ring per connection vs durable log;
   what do post-hoc verification and bug reports need, and what does the
   privacy posture allow?
5. **`defaultLive` default** — true for every LiveQuery descriptor from day
   one, or opt-in per collection until D1 soak is done?
6. **Ephemeral resume** — does `resume_live` cover ephemeral subscriptions,
   or do they always re-snapshot through the resync lane (LLP 0013's
   existing answer suggests the latter — confirm and name it)?

## 9. Status

Draft. The provider-side companion Exact LLP 0284 rev 3 names as its
acceptance gate. Deliverable order: D3+D1 (unblocks the All Aboard proof,
Exact 0277 §5.1 row 4), then D2 (unblocks Exact 0278 §D), with D4/D5
alongside. Review per LLP 0005 at the author's chosen intensity; acceptance
is the author's call.

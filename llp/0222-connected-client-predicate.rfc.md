# LLP 0222: Connected-client freshness predicate

**Type:** RFC
**Status:** Draft
**Systems:** Realtime, Server runtime, Handler surface, Notifications, Codegen
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-10
**Revised:** 2026-08-10 (a — initial draft, synthesized from the Clique P2
pilot evidence and a GPT-5.6-sol design consultation)
**Related:** LLP 0008 (local-first sync and realtime — owns the managed
WebSocket lane this predicate observes), LLP 0013 (ephemeral realtime state —
the boundary this deliberately does not cross), LLP 0143 (Expo push seam —
the immediate consumer), LLP 0045 (notifications outbox — where guaranteed
channel arbitration would live instead), LLP 0028 (cron — the action
execution class), LLP 0053 (authorization invalidation — grant/generation
identity the witness index keys on), LLP 0201 (Clique benchmark plan),
`benchmarks/records/2026-08-09-social-messenger-p2-pilot.md` (B7 evidence),
`issues/20260809-connected-client-predicate.md` (evidence ticket),
`guide/capabilities.md` (rows backend.notifications, backend.expo-push-seam,
realtime.live-queries)

## Summary

In the Clique P2 pilot, all three lanes — Snapback, Convex, and Supabase —
hand-built the same thing for the push milestone: a durable heartbeat table
plus a freshness threshold, solely to answer "does this principal have a
connected client right now, so we can skip the push?"
(`issues/20260809-connected-client-predicate.md`). B7 (push) scored
58/58/55 — a three-way tie waiting to be broken
(`benchmarks/records/2026-08-09-social-messenger-p2-pilot.md`). The
duplication is galling for Snapback specifically: the server already holds
authenticated connection grants, managed-WebSocket liveness with a published
freshness budget (`LIVE_HEARTBEAT_INTERVAL_MS = 5_000`,
`LIVE_FRESHNESS_BUDGET_MS = 15_000`; `guide/realtime/live-queries.md`
"Connection state an author can observe"), and ephemeral connection
ownership — but exposes none of it to server application code. Neither
competitor has such a primitive either (pilot F6), so a truthful, narrow
surface here is a genuine differentiator.

This RFC adds one action-only host operation:

```ts
ctx.realtime.hasFreshClient({ principalId: string }): Promise<boolean>
```

It is an **advisory freshness observation** backed directly by authenticated
transport state — not principal data, not app-presence-derived, not a
user-writable flag.

## Options considered

**A — Action-only fresh-client predicate** (chosen). Small, general,
additive; backed by transport truth the server already holds. Tradeoffs:
observation and push remain racy (a client can vanish right after `true`),
and it does not conveniently filter each member of a host-resolved group
audience — callers of membership-audience push must resolve recipients
themselves to filter per-principal.

**B — Push-integrated suppression** (`ctx.push.send({ ...,
suppressWhenFreshClient: true })`), filtering the resolved audience inside
the host near reservation time. Best fit for membership audiences and
harder to misuse as an online-status oracle, but it carries substantial
semantic baggage: the push ledger needs a `suppressedFresh` outcome,
`targetCount` and zero-target semantics need revision, the
observation-to-transmit race survives anyway, and it welds realtime routing
policy into an Expo seam explicitly designed to be absorbed later by
first-class notifications (LLP 0143 §D2; LLP 0045).

**C — Connectedness fact on principals** (`principal.connected` or a
queryable system field). Looks composable but conflicts with the data
model: socket transitions produce no durable commits or versions, so
ordinary and live queries would return a fact their invalidation contract
cannot keep current. It also creates an ambient privacy surface (retention,
export) and dresses transient multi-device state up as principal data.

**D — Derive from ephemeral presence** (require a user-keyed ephemeral
collection, read it from handlers). Reintroduces exactly the pilot's
app-authored heartbeat plumbing, makes the answer client-published rather
than transport-attested, and violates LLP 0013's deliberate boundaries:
server-side ephemeral reads are off the paved path and transient state must
not govern durable behavior (LLP 0013 §Relationship to durable sync,
§App API boundary).

## Decision

Ship Option A: `ctx.realtime.hasFreshClient`, action-only, session-mode,
capability-gated.

**The A-vs-B call was close** and is recorded here so the follow-on gate is
legible. B fits the immediate push seam better — `ctx.push.send` resolves
membership audiences inside the host, where per-recipient filtering is
natural. A wins as the *first* landing because it is additive and reusable,
changes no Expo ledger semantics, and does not prematurely turn LLP 0045's
design-only notifications policy into provider-seam behavior. **Gate:** seam
integration (Option B's `suppressWhenFreshClient`, with a ledgered
`suppressedFresh` outcome) is a follow-on RFC, opened only on demonstrated
need for per-recipient filtering of host-resolved group audiences — e.g. a
benchmark or production app whose push volume is predominantly
membership-audience sends and whose hand-rolled recipient resolution is
measurably the pain.

Actions are the right execution boundary: they are already
non-transactional and side-effectful, and cron plus durable-job work
execute as actions (LLP 0028 §Execution: the action class; LLP 0070). A
mutation wanting conditional push transactionally enqueues an action; that
action observes freshness immediately before `ctx.push.send`. Exposing the
predicate to mutations or queries would invite durable branching on
transient state — the precise hazard LLP 0013 names.

Naming is part of the contract. Not `isConnected`: "fresh client" is what
the server can truthfully attest. No connection count, no `lastSeenAt` —
unnecessary for routing, and they increase fingerprinting risk and invite
app-defined thresholds.

## Design detail

### Semantics (pinned)

- `true` iff at least one current, session-authenticated **managed
  WebSocket** for the principal is registered and has produced a
  client-originated signal within the fixed server freshness budget.
- V1 budget: **15 seconds**, matching the shipped client default (5 s
  heartbeat × 3, `guide/realtime/live-queries.md`). The budget is fixed and
  published in the capability manifest, never caller-controlled — clients
  configured with slower heartbeats (`stream.heartbeatIntervalMs` is
  overridable) will flap `false`, and that is the documented behavior.
- **Multi-device is existential**: any fresh tab/device/session ⇒ `true`.
- Known close, revocation, supersession, or grant retirement removes the
  witness immediately; there is no post-close grace. An *undetected*
  half-open socket may read `true` for at most 15 s after its last inbound
  signal.
- `false` means "the server holds no fresh witness," **not** "the user is
  offline." Explicit non-promises: nothing about foreground state, visible
  UI, notification permission, human attention, future reachability,
  durability of the observation, or whether the next live frame arrives.
- Poll-only clients count as `false` in v1; counting a recent HTTP request
  would silently mutate the contract into "recently seen."
- Anonymous and service principals are excluded (session-mode only).

### Implementation sketch (repo-verified)

- New `src/connected_clients.rs`: a bounded process-local witness index
  keyed by exact socket identity `(connectionId, grantId,
  socketGeneration)`, with reverse-principal and expiry indexes. Wire it in
  `src/server.rs` alongside the existing socket lifecycle: register after
  `DeliveryNotifier::register_bound` (src/server.rs:26948); initialize on
  successful authenticated attachment; refresh **only** from
  client-originated frames; remove on exact teardown, terminalization,
  revocation, reset, and grant retirement. Two explicit non-sources:
  `ConnectionRegistry` membership (src/server.rs:3775) is not connectivity —
  grants deliberately survive ordinary socket close (LLP 0053) — and
  `last_use_ms` is polluted by server-side acts and outbound delivery.
  Expiry uses monotonic host time, not `ctx.runtime.now()` (cron's trusted
  clock may be bound to nominal schedule time, LLP 0028).
- Host op `realtime.hasFreshClient` on `IbexActionHost` and the detached
  action host (`src/runtime.rs` ~1252); the lookup takes neither SQLite nor
  `LocalSnapback`.
- Generated surface: an action-only `RealtimeContext` on `ActionContextBase`
  (`packages/snapback-codegen/ctx.d.mts` ~267), emitted by
  `packages/snapback-codegen/index.mjs` (~11364, beside the existing
  conditional `GeneratedPush` slot) only when the selected target reports
  the capability; action implementation plus query/mutation refusal stubs in
  `packages/snapback-harness/ctx-bootstrap.js` (~898, following the
  `ctx.jobs` mode-gated stub pattern with a stable `SNAPBACK_*` code).
- Capability manifest row `realtime.connected-client-predicate` with
  `semanticsVersion`, `freshnessBudgetMs: 15000`, `transport:
  "managed-websocket"`. Multi-instance/hosted targets report **Missing**
  until one authority (or a shared index) can aggregate all connections for
  a principal — a process-local false negative must not be advertised as
  global truth. Unsupported targets refuse with a stable unavailable
  diagnostic; `false` is never a silent capability fallback.

### Compatibility

No database or push-ledger migration; `ctx.push.send` unchanged. Handlers
observe one derived fact and never receive socket handles, preserving
LLP 0008's adapter-owned-lifecycle constraint (§Dated constraints,
2026-07-23). Process restart clears all witnesses; reconnecting clients
repopulate. LLP 0013 gets a clarifying paragraph: this is a
transport-registry observation, not an ephemeral-collection read.

## Phases

1. **Runtime witness index** — `connected_clients.rs` + server wiring +
   host op. Proof: Rust acceptance covering multi-device existential
   behavior, exact 15 s expiry, immediate known-close/revocation removal,
   stale-generation fencing, anonymous/service exclusion, restart clearing,
   bounded high-churn memory, and zero durable-version advancement.
2. **Generated surface + refusal stubs** — codegen, harness bootstrap,
   capability manifest row. Proof: codegen snapshot tests; harness tests for
   action/cron/durable-job availability, mutation/query refusal code, and
   the unavailable diagnostic on non-reporting targets.
3. **Docs + closure** — amend LLP 0008 (predicate + no-app-owned-lifecycle
   compat note), add the enqueue-action-observe-send recipe cross-reference
   to LLP 0143 (no ledger change), the LLP 0013 clarification, capability
   index + live-queries guide rows; close
   `issues/20260809-connected-client-predicate.md`. Proof:
   `node scripts/check-guide.mjs` + `./ref-check --verbose` green.
4. **Validation against the motivating evidence** — re-run the Clique push
   milestone (or its acceptance slice) on the predicate instead of the
   heartbeat table. Proof: heartbeat schema deleted from the lane app; B7
   friction delta recorded in the diary. Feeds the Option B gate.

## Open questions

- **OQ1 — Hosted authority.** What is the aggregation story for
  multi-instance targets (single principal-routing authority vs. shared
  index)? Until answered the capability stays Missing there, which caps the
  differentiator claim at local/single-instance postures.
- **OQ2 — Poll transport.** If pilot/production value turns out to depend
  materially on poll-only clients (e.g. web fallbacks), the
  managed-WebSocket-only contract is too narrow; widening it is a
  `semanticsVersion` bump, not a silent redefinition.
- **OQ3 — Race posture.** The observation-to-send race makes this API
  unsuitable for correctness-critical "exactly one of live or push"
  delivery. If that requirement materializes, it belongs in LLP 0045's
  durable notification-intent lifecycle, not in a fatter predicate — is
  that boundary worth a normative note in 0045 now or at its next revision?

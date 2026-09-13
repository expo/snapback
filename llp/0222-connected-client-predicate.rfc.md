# LLP 0222: Connected-client freshness predicate

**Type:** RFC
**Status:** Implemented
**Systems:** Realtime, Server runtime, Handler surface, Notifications, Codegen
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-10
**Revised:** 2026-08-10 (Review → Implemented — accepted on the author's
standing in-session direction after loop completion, and marked Implemented
because the full-scope predicate shipped on main (af13e07f4) per the author
ruling recorded in the evidence ticket; final loop verdicts bind revision
(c), the (d) reconciliation tail is unreviewed and disclosed; the shipped
semanticsVersion: 2 is authoritative, confirming the loop's call.)
**Revised:** 2026-08-10 (a — initial draft, synthesized from the Clique P2
pilot evidence and a GPT-5.6-sol design consultation)
**Revised:** 2026-08-10 (b — Draft → Review at llp-super-refine loop start,
the one authorized transition; sub-orchestrated loop)
**Revised:** 2026-08-10 (c — round 1 revision addressing both reviews,
`llp/reviews/0222-connected-client-predicate.{claude,gpt-5}.md`: pinned
transport-authority-only removal + reset survival, poll-default transport
fact, LLP 0143 trigger-mode composition, privacy/authorization posture,
`semanticsVersion: 1` enforcement + codegen emission input, strict
`< budget` boundary, client-budget non-promise, dev-auth-mode refusal;
Summary/citation corrections; symbol-based code anchors)
**Revised:** 2026-08-10 (d — **UNREVIEWED** final loop revision, post-dating
the round 2 reviews it addresses: absorbs the author ruling of 2026-08-10
recorded in `issues/20260809-connected-client-predicate.md` — full scope,
enabled by default, no conservative v1 fence — per both round 2 reviews'
converged MATERIAL findings: the shipped contract counts
authenticated-poll clients (`semanticsVersion: 2`), hosted aggregation
pinned in-scope (Phase 5), dev-auth-mode targets support the predicate,
OQ1–OQ3 converted to resolved rulings, the LLP 0045 note moved into
Phase 3 as immediate work; reconciled with the full-scope implementation
landing af13e07f4; plus the
round 2 MINORs — attachment-as-first-signal, anonymous/service observable
pinned to `false`, conditional codegen-slot wording, reset rebinding
clause, trust-argument rewording, 0143 §D0/§D6 citation)
**Related:** LLP 0008 (local-first sync and realtime — owns the live
transports this predicate observes), LLP 0013 (ephemeral realtime state —
the boundary this deliberately does not cross), LLP 0143 (Expo push seam —
the immediate consumer), LLP 0045 (notifications outbox — where guaranteed
channel arbitration would live instead), LLP 0028 (cron — the action
execution class), LLP 0070 (durable jobs — the other action-class executor),
LLP 0031 (server route taxonomy — connection-capability grants, whose
survival across socket close the witness must not inherit), LLP 0053
(authorization invalidation — grant/generation
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
58/58/55 — effectively undifferentiated (builder self-assessments,
calibration-only;
`benchmarks/records/2026-08-09-social-messenger-p2-pilot.md`). The
duplication is galling for Snapback specifically: the server already holds
the raw material — authenticated connection grants, client-originated frames
on managed WebSockets, ephemeral connection ownership — and the shipped
client kit publishes the freshness constants the server-side witness can
mirror (`LIVE_HEARTBEAT_INTERVAL_MS = 5_000`,
`LIVE_FRESHNESS_BUDGET_MS = 15_000`; `guide/realtime/live-queries.md`
"Connection state an author can observe") — but the server exposes none of
it to application code. Neither
competitor has such a primitive either (pilot F6), so a truthful surface
here is a genuine differentiator.

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
and it composes with per-recipient filtering only where the caller already
holds an authorized, bounded principal set — host-resolved membership
audiences in the deferred trigger mode admit no per-recipient narrowing at
all (see Decision, "Trigger-mode composition").

**B — Push-integrated suppression** (`ctx.push.send({ ...,
suppressWhenFreshClient: true })`), filtering the resolved audience inside
the host near reservation time. Best fit for membership audiences and
harder to misuse as an online-status oracle, but it carries substantial
semantic baggage: the push ledger needs a `suppressedFresh` outcome,
`targetCount` and zero-target semantics need revision, the
observation-to-transmit race survives anyway, and it welds realtime routing
policy into an Expo seam explicitly designed to be absorbed later by
first-class notifications (LLP 0143 §D0 and §D6 for the absorption scope,
§D2 for the send-lane integration point; LLP 0045).

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

Ship Option A: `ctx.realtime.hasFreshClient`, action-only,
capability-manifest-described, **enabled by default everywhere the runtime
runs**.

**Author ruling absorbed (2026-08-10,
`issues/20260809-connected-client-predicate.md`).** Proceed at full scope;
implement the whole surface at once and ship it enabled by default — no
conservative v1 fence. Problems surfaced by the maximal implementation are
worked through as tickets, not fenced out of scope in advance. Applied
here: the shipped contract counts authenticated-poll clients as fresh (not
only managed WebSockets), hosted/multi-instance aggregation is in-scope
work (Phase 5) rather than a standing Missing posture, dev-auth-mode
targets support the predicate, and the LLP 0045 arbitration note lands now
(Phase 3). The ruling leaves the four recorded design decisions intact:
the primitive stays action-only, transport-attested, advisory with a fixed
published budget, and Option B stays behind its gate.

**Implementation record (2026-08-10).** Landed at full scope, enabled by
default, in `af13e07f4` (witness registry, poll widening, action-only
host op with `SNAPBACK_CONNECTED_CLIENT_PREDICATE_UNAVAILABLE` refusal,
manifest row at `semanticsVersion: 2`, the LLP 0008/0013/0143 amendments,
and the ruled LLP 0045 normative note). Phases 1–3 below therefore record
the shipped shape and its proof obligations; Phase 4 (motivating-evidence
validation) and Phase 5 (hosted aggregation) remain open work.

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
measurably the pain. The deferred-mode inexpressibility pinned below is
itself part of the evidence that gate watches.

**Trigger-mode composition (pinned).** LLP 0143's audience vocabulary
bounds what v1 filtering can express. Per-recipient filtering works where
the calling action already holds an authorized, bounded principal set:
immediate sends and the cron/system lane's explicitly bounded principal
arrays (LLP 0143 §Implementation question 8). Deferred mutation-produced
sends admit **membership resolvers only** — raw principal arrays refuse
there — so a deferred action cannot enumerate a membership audience, filter
it, and send the narrowed list; deferred mode supports **whole-intent skip
only** (natural for 1:1 conversations, the mutation passing the sole
recipient's principalId as job args). Per-recipient filtering of
host-resolved membership audiences stays inexpressible under Option A —
exactly the demand signal for the Option B gate above.

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

- `true` iff at least one current, authenticated **live transport binding**
  for the principal — a managed WebSocket or the authenticated poll lane —
  has produced a client-originated signal within the fixed server
  freshness budget (strictly: signal age `< 15_000` ms at observation; the
  equality point is expired, and Phase 1 tests pin the same boundary).
  Successful authenticated attachment counts as the first qualifying
  signal; thereafter client-originated frames and poll-lane acts refresh
  the witness.
- **Live transports only, both of them.** Managed-WebSocket frames and
  **session-authenticated connection-scoped poll-lane acts** (the WebSocket
  upgrade request itself excluded, so a known socket close can never leave
  an upgrade-request witness behind) are witness signals — `'poll'` is the
  shipped default transport (default cadence
  `DEFAULT_POLL_CADENCE_MS = 1_500`, well inside the budget), so
  default-configured clients read `true` while active, per the author
  ruling's truthful-for-real-clients requirement. HTTP requests outside the
  authenticated connection scope (ordinary queries, mutations, uploads) are
  **not** signals: "fresh client" means an attached live client, not
  "recently seen."
- V1 budget: **15 seconds**, matching the shipped client default (5 s
  heartbeat × 3, `guide/realtime/live-queries.md`). The budget is fixed and
  published in the capability manifest, never caller-controlled — clients
  configured with slower heartbeats (`stream.heartbeatIntervalMs` is
  overridable) or poll cadences beyond the budget will flap `false`, and
  that is the documented behavior.
- **Multi-device is existential**: any fresh tab/device/session ⇒ `true`.
- **Removal is transport-authority-scoped.** Known socket close,
  supersession, and any event ending the socket's transport authority —
  session/credential revocation or expiry, connection-grant revocation or
  retirement (LLP 0053 generation identity; LLP 0031 grant lifecycle) —
  remove the exact witness immediately; no post-close grace.
  Application-level permission or membership revocation does **not** remove
  a witness unless it also ends transport authority: losing a group must
  not make a still-connected principal read `false` globally. Poll-backed
  witnesses follow the same rule: subscription teardown or loss of the
  authenticating authority removes them; otherwise they lapse by budget. An
  *undetected* half-open socket (or silently abandoned poll client) may
  read `true` for at most 15 s after its last inbound signal.
- **`app.reset` does not clear witnesses.** Reset drops subscriptions but
  deliberately leaves the socket connected and re-snapshotting (LLP 0008
  §Resync sentinels, ENG-23333): the witness survives, and it is removed
  only when a reset path actually terminalizes the transport. If reset
  rotates socket identity, the rotated identity registers a fresh witness
  at its authenticated attach and supersession removes the old one —
  freshness never transfers between socket identities.
- `false` means "the server holds no fresh witness," **not** "the user is
  offline." Explicit non-promises: nothing about foreground state, visible
  UI, notification permission, human attention, future reachability,
  durability of the observation, whether the next live frame arrives, or
  the client's own view of connection health — a client with a custom
  `stream.freshnessBudgetMs` may consider its connection stale while the
  server still holds a fresh witness, and vice versa.
- A `fallbackToPoll` degradation therefore keeps reading `true`: the
  degraded client's authenticated poll fetches are still witness signals
  (`guide/realtime/live-queries.md` §Subscribe).
- Anonymous and service principals never hold witnesses; probing one
  **answers `false`** (a truthful no-witness observation, not a capability
  fallback — refusal is reserved for targets that lack the capability).

### Privacy and authorization posture (pinned)

LLP 0013 §Authorization and privacy is normative here: global online status
is privacy-sensitive and must not be exposed by default. This predicate is
a **server-code-only routing input**, not a presence feature. V1 performs
no caller↔subject authorization check — action code may probe any session
principal — because the caller is trusted server code at the same trust
level as server code that could declare and hold `ctx.push.send`; a
relationship check would be theater at that trust level. The obligation sits on
projection, not observation: re-exposing the boolean as user-visible
presence (e.g. a client-callable `isUserOnline(userId)` action) is **off
the paved path** — it rebuilds the global-presence surface LLP 0013
refuses; scoped ephemeral presence remains the user-facing answer, and
handlers must authorize any user-visible projection. The Phase 3 guide row
and recipe carry this warning. No count, no `lastSeenAt`, no per-device
breakdown: the fingerprinting surface stays one bit per probe.

### Implementation sketch (repo-verified)

- New `crates/snapback/src/connected_clients.rs`: a bounded per-authority witness index
  keyed by exact transport-binding identity `(connectionId, grantId,
  socketGeneration)` (poll witnesses key on their subscription's
  connection-grant identity), with reverse-principal and expiry indexes.
  Wire it in `crates/snapback/src/server.rs` alongside the existing lifecycle: register
  after `DeliveryNotifier::register_bound` in the live-stream attach path
  and in the authenticated live-poll fetch path (symbol
  anchors, not line numbers — main moves too fast for the latter);
  initialize on successful authenticated attachment; refresh **only** from
  client-originated frames and live-poll fetches; remove per the pinned
  semantics — exact
  teardown, terminalization, and transport-authority-ending events only,
  never `app.reset` alone, never application permission changes. Two
  explicit non-sources: `ConnectionRegistry` membership is not
  connectivity — connection grants deliberately survive ordinary socket
  close so the kit can reconnect (LLP 0031 §Connection capability grants;
  LLP 0053 supplies the generation identity) — and `last_use_ms` is
  polluted by server-side acts and outbound delivery.
  Expiry uses monotonic host time, not `ctx.runtime.now()` (cron's trusted
  clock may be bound to nominal schedule time, LLP 0028).
- Host op `realtime.hasFreshClient` on `IbexActionHost` and the detached
  action host (`crates/snapback/src/runtime.rs`); the lookup takes neither SQLite nor
  `LocalSnapback`.
- Generated surface: an action-only `RealtimeContext` emitted as a
  **conditional `ActionContext` intersection slot parallel to
  `GeneratedPush`** — not an unconditional member of `ActionContextBase`,
  which would leak the type onto non-reporting targets
  (`packages/snapback-codegen/ctx.d.mts`,
  `packages/snapback-codegen/index.mjs`). The emission input is the **selected target's
  capability manifest** — a deliberate divergence from `GeneratedPush`,
  whose gate is the app's push declaration; there is no app declaration for
  this ambient predicate, and the target-dependence of the generated
  artifact is accepted and recorded (digest-verified codegen outputs
  already bind the selected target). Action implementation plus
  query/mutation refusal stubs land in
  `packages/snapback-harness/ctx-bootstrap.js`, following the `ctx.jobs`
  mode-gated stub pattern with a stable `SNAPBACK_*` code.
- Capability manifest row `realtime.connected-client-predicate`
  (manifest key `connectedClientPredicate`) with `semanticsVersion: 2`,
  `freshnessBudgetMs: 15000`, `transport: ["managed-websocket",
  "authenticated-poll"]`, `aggregationMode: "single-authority-routing"`,
  `authorityScope: "app-instance-process"` — version 2 **is** the shipped
  widened contract (version 1 was the never-shipped WebSocket-only draft
  semantics); the transport list is a published fact, not a negotiation
  surface. The local target advertises the capability unconditionally.
  **Version enforcement:** codegen and the harness admit only semantics
  versions they support — a missing or unsupported `semanticsVersion`
  omits the generated surface and refuses at runtime, so a future semantic
  change can never silently alter the shipped truth conditions. **Auth
  modes:** dev/impersonation targets support the predicate — their
  principals bind to transport authority through the same authenticated
  attachments — with mode-specific proofs; only anonymous/service
  principals are per-principal `false` as pinned above. **Hosted:**
  multi-instance aggregation is in-scope work (Phase 5; completion design
  filed as `issues/shelved/20260810-connected-client-hosted-aggregation.md`); a
  hosted target honestly reports the capability Missing only in the
  interim before that lands, because a single-authority false negative
  must not be advertised as global truth. Targets without the capability
  refuse with the stable diagnostic
  `SNAPBACK_CONNECTED_CLIENT_PREDICATE_UNAVAILABLE`; `false` is never a
  silent capability fallback.

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
   behavior, strict `< 15_000` ms expiry at the boundary, immediate removal
   on known close and transport-authority loss (including session/grant
   expiry and partial multi-session revocation — one device revoked, the
   other stays `true`), witness survival across `app.reset` with a
   connected socket, no removal on application permission change,
   stale-generation fencing, poll-witness registration/refresh/expiry
   (attachment counts as the first signal; default-cadence client stays
   `true`; over-budget cadence flaps `false`), anonymous/service probes
   answering `false`, restart clearing,
   bounded high-churn memory, and zero durable-version advancement.
2. **Generated surface + refusal stubs** — codegen, harness bootstrap,
   capability manifest row. Proof: codegen snapshot tests (including
   omission on a target without the capability and on an unsupported
   `semanticsVersion`); harness tests for action/cron/durable-job
   availability, mutation/query refusal code, dev-auth-mode availability,
   and the unavailable diagnostic on non-reporting targets.
3. **Docs + closure** — amend LLP 0008 (predicate + no-app-owned-lifecycle
   compat note); add the enqueue-action-observe-send recipe cross-reference
   to LLP 0143 (no ledger change) with the trigger-mode composition table
   and the privacy warning; the LLP 0013 clarification; **the LLP 0045
   normative note now, per the ruling** ("not for exactly-once
   live-vs-push arbitration; that belongs to LLP 0045's durable
   notification-intent lifecycle"); capability index + live-queries guide
   rows; close `issues/20260809-connected-client-predicate.md`. Proof:
   `node scripts/check-guide.mjs` + `./ref-check --verbose` green.
4. **Validation against the motivating evidence** — re-run the Clique push
   milestone (or its acceptance slice) on the predicate instead of the
   heartbeat table, with default-configured (poll) clients — the shipped
   default is the validation shape — scoped to an audience/trigger form v1
   admits (the 1:1 conversation whole-intent skip, or a bounded
   principal-array lane). Proof: heartbeat schema deleted from the lane
   app; B7 friction delta recorded in the diary. Feeds the Option B gate.
5. **Hosted aggregation** — complete the multi-instance story under the
   shipped `single-authority-routing` scope: witnesses live with one
   authority per app instance today (`authorityScope:
   "app-instance-process"`), and the hosted completion design — how
   probes and witnesses meet when principals span instances — is filed as
   `issues/shelved/20260810-connected-client-hosted-aggregation.md`. Hosted
   targets report the capability once wired; problems surfaced land as
   tickets per the ruling. Proof: a two-instance acceptance showing
   existential truth across instances and budget-bounded staleness.

## Open questions

All three original open questions were **resolved by the author ruling of
2026-08-10** recorded in `issues/20260809-connected-client-predicate.md`
and folded in at revision d. (This section heading is load-bearing:
implementation `@ref`s cite `LLP 0222#open-questions` for the ruled
transport widening.)

- **OQ1 — Hosted authority: resolved.** Attempt the aggregation story
  rather than standing on Missing; Phase 5 work under the shipped
  single-authority-routing scope, completion design in
  `issues/shelved/20260810-connected-client-hosted-aggregation.md`. Missing
  remains only as the honest interim report before that lands on a hosted
  target.
- **OQ2 — Poll transport: resolved.** The shipped contract
  (`semanticsVersion: 2`) counts authenticated-poll clients — the shipped
  default transport — so the predicate is truthful for real clients;
  `semanticsVersion` discipline governs any future change.
- **OQ3 — Race posture: resolved.** The normative boundary note lands in
  LLP 0045 now (Phase 3), not at its next revision.

# LLP 0167: Network condition profiles

**Type:** RFC
**Status:** Implemented
**Systems:** Server, Runtime, Cloudflare arm, Admin console, Agent experience,
Developer experience, Acceptance testing
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-04
**Revised:** 2026-08-05 (v1.3 — OQ5 resolved by the shipped guide surface
under LLP 0184 Phase 0); 2026-08-05 (v1.2 — OQ3 implemented: Rust activation now
consumes LLP 0158's boot-validated derived-instance identity as the sole
hosted exception, while Cloudflare uses the dedicated
`SNAPBACK_DERIVED_INSTANCE_ID` deployment binding without enabling
`SNAPBACK_TESTING`; both arms carry the expanded fail-closed refusal matrix.);
2026-08-04 (v1.1 — Implemented. Author rulings: OQ2 ratified
(`debug.*` family), OQ4 ratified (subscription-stage seam folded,
nested-commit seam kept as a capped documented micro-seam), OQ3 ruled by
adopted recommendation (fork-only hosted exception + dedicated Cloudflare
classification binding; implementation ticketed). Both arms, all four
control surfaces, and the Latency Kanban acceptance anchor are built;
residue is tracked in the capability GAP.); 2026-08-04 (v1.0 — Accepted by the author at super-refine
close. Content identical to v0.4; the final dual-family round verdicts
bind to v0.3 and the v0.4 in-delta fixes are author-reviewed only, as
disclosed in Revision history.)
**Related:** LLP 0010 (deterministic harness, sleep ban), LLP 0017 (admin
console authority model), LLP 0024 (host-ops operation table), LLP 0042
(MCP projection), LLP 0043 (offline replay), LLP 0054 (transport-scheduler
research), LLP 0093 (client protocol; wire marker), LLP 0107 (optimistic
lifecycle), LLP 0129 (local-first program), LLP 0138 (Zero/Replicache
bakeoff), LLP 0146 (agentic affordances, D6 ordering seams), LLP 0154
(observability), LLP 0155 (local sync product direction), LLP 0158
(instance forking)

## Summary

Snapback should be able to serve responses under a **named network
condition profile** — added wall-clock latency on its egress lanes — as a
first-class, server-side seam that can be toggled at startup, by an agent
through host-ops/MCP, and interactively from a Developer panel in the admin
console. Profiles make local-first behavior *testable and demonstrable*:
optimistic overlays, in-flight settlement, outbox replay, and live-query
convergence only show their character when the authoritative server is
slow, and today Snapback has no honest way to make it slow.

The corpus already declares profile *names* for this — the
`networkProfiles` block (`normal` / `optimistic` / `offlineStretch`) in the
bakeoff environment manifest
(`demos/zero-bakeoff/protocol/environment.v1.json`), which LLP 0129 and
LLP 0138 require frozen acceptance manifests to cite. No code reads that
block today. This RFC gives real, server-implemented semantics to the
names it can honestly own (`normal`, `optimistic`) and defines its own
field vocabulary; it does **not** adopt `offlineStretch` (see Boundary).
It also owns versioning the environment manifest schema to the vocabulary
actually built, so manifests and implementation cannot drift apart again.

## Motivation

Three concrete forcing functions, in descending order of embarrassment:

1. **The Latency Kanban bakeoff arms do not measure the same thing.** The
   Zero arm injects its 1,000 ms authoritative latency inside its own push
   endpoint (`demos/zero-bakeoff/apps/latency-kanban/zero/api.ts` —
   `startApi(databaseURL, latencyMs = 1000)`). The Snapback arm fakes it by
   sleeping in the *test client* before calling `client.mutate`
   (`demos/zero-bakeoff/apps/latency-kanban/snapback/tests/acceptance.mjs`,
   `delayedMove()`). Client-side sleep never exercises Snapback's real
   in-flight paths — pending-mutation overlays, settlement ordering, rebase
   under a slow authoritative ack (LLP 0107) — so the comparison is
   structurally flattering and the interesting code goes untested. LLP 0155
   names Latency Kanban as an acceptance-gate witness and requires local
   latency, server ack, and observer convergence to be measured separately;
   that separation is not honest while the delay lives in the test script.

2. **Local-first demos need a visible slow mode.** "It feels instant" is
   only legible next to "and here is the same app with a 2-second server."
   A toggle an agent or a human can flip mid-session — without rebuilding
   or proxying — is the cheapest way to show optimistic UX working, and to
   reproduce latency-sensitive bugs interactively.

3. **The only existing delay seams are invisible one-arm test hacks.** The
   Cloudflare coordinator carries two env-gated, test-only knobs behind
   `SNAPBACK_TESTING === '1'` (`cloudflare/src/coordinator.js`):
   `SNAPBACK_TEST_SUBSCRIPTION_STAGE_DELAY_MS` (capped at 1,000 ms) and
   `SNAPBACK_TEST_NESTED_COMMIT_DELAY_MS` (applies the raw env value,
   uncapped). The Rust server has nothing at all. There is no shared
   vocabulary, no agent surface, no console surface, and no marker on
   affected responses.

### Why server-side

Latency injected anywhere other than the server's response path tests a
different system. A client-side sleep (the current bakeoff workaround)
leaves the client's in-flight machinery idle. An external proxy (`toxiproxy`
et al.) adds a dependency, cannot distinguish Snapback's lanes (mutation ack
vs. live delta vs. query), and is invisible to Snapback's own diagnostics.
A server-side seam at named egress boundaries delays *real* responses on
*real* connections, exercises every client code path, and can be reported
honestly by the server itself.

## Design

### Profile model

A **network condition profile** is a named, typed bundle of wall-clock
delay parameters applied to server egress:

```jsonc
{
  "name": "optimistic",
  "mutationAckDelayMs": 1000,      // delay before a mutation ack is written
  "liveDeltaDelayMs": 1000,        // delay before a live frame is flushed
  "queryResponseDelayMs": 0,       // delay before a query response is written
  "jitterMs": 0                    // optional uniform jitter, FIFO-preserving
}
```

Built-in profiles: `normal` (all zeros — the identity profile),
`optimistic` (1,000 ms on **both** the mutation-ack and live-delta lanes —
the coordinated, post-commit rendering of the manifest's 1,000 ms
authoritative-mutation latency; see Observation semantics), and
`demo-slow` (pinned: 2,000 ms on all three lanes, 250 ms jitter — the
interactive-demonstration profile).
Custom profiles may be supplied inline wherever a profile name is
accepted, subject to the same activation rules as named ones.

### Observation semantics — what a delay means

This seam perturbs **observation, never state**. Delay attaches to the
three egress lanes — the mutation-ack write, the live-delta flush, and
the query-response write — in both arms (Rust server and Cloudflare
coordinator), as a **two-phase, deadline-based release**, never an inline
sleep at the write site:

1. **Prepare under existing authority.** When an egress item becomes
   ready (post-handler, post-commit), the arm prepares it exactly as
   today — serialized bytes, per-connection position, profile snapshot
   (see Honesty) — and stamps a release deadline. Deadlines are
   **commit-relative**: every item carrying one commit (its mutation ack,
   every live frame derived from it) is stamped `commit time + lane delay
   (+ jitter)`, not "enqueue moment + delay," so equal lane delays give
   an ack and its deltas one shared deadline rather than a race between
   independent timers started at different enqueue points. Query
   responses stamp from result readiness — as does any mutation response
   that carries no commit (a refusal, a rejection, a successful no-op):
   no commit means the reference point is result readiness. Jitter is
   sampled **once per commit**, and that one sample is added to every
   deadline in the commit's egress group (per-response for
   result-readiness items), so jitter widens the envelope without ever
   splitting a shared deadline.
2. **Wait outside every lock.** All wall-clock waiting happens after the
   invocation, instance, commit, and storage serialization authorities
   are released — on the Cloudflare arm, outside the coordinator's
   `runExclusive` tail, which stays occupied until the handler's promise
   settles and would otherwise stall later commit admission. Delay must
   never become additive by stacking sequential waits inside the commit
   path (no ack delay queued behind an awaited fanout).

Commit timing, commit ordering, settlement, and server-internal
interleavings are unchanged by any profile. Request-side
(pre-handler) delay is **explicitly out of scope**: delaying when a
mutation *commits* changes multi-client settlement interleavings, which is
state perturbation — the province of LLP 0146 D6's ordering seams and
LLP 0054's unratified transport scheduler, not of this RFC.

**Implementation clarification (2026-08-04) — HTTP lanes are per-request.**
The Rust arm applies query-response and mutation-ack deadlines independently
to each HTTP request, not as a monotone sequence attached to the underlying
TCP connection. Supported HTTP/1.1 clients have one in-flight request per
connection; HTTP pipelining is not a supported client observation surface, so
the per-connection clamp required for durable live-frame queues does not apply
to these HTTP lanes.

Consequences, stated so nobody discovers them in a demo:

- **Per-connection FIFO is preserved, always — as pipeline latency.**
  Deadlines are clamped monotone per connection (an item's deadline is at
  least its predecessor's), so a later frame never overtakes an earlier
  one, jitter varies deadlines only within the monotone clamp, and a
  burst of N frames shifts once by the lane delay rather than draining at
  N × delay head-of-line service. (Reordering is a D6-class perturbation
  this RFC disclaims.)
- **Asymmetric lane delays change cross-client observation order.** With
  ack delayed and deltas not, an observer — or the actor's own live
  subscription — can see a commit before the actor's ack arrives. That is
  a real network condition (slow return path) and is deliberately
  expressible, but it is an *observation* ordering, never a state change.
  The built-in `optimistic` avoids it by giving an ack and its deltas one
  shared commit-relative deadline; residual cross-connection skew at a
  shared deadline is scheduler noise — bounded in acceptance as noise,
  never an enqueue-order artifact — and otherwise out of contract (real
  networks offer no cross-connection ordering either).
- **Bakeoff equivalence is client-observable, not internal.** Zero injects
  *before* commit; this seam injects *after*. The arms therefore do not
  share an internal boundary, and the RFC does not claim they do. The
  comparability contract is the **client-observable envelope**: under the
  manifest-named profile, actor-observed ack latency and observer-observed
  delta latency land within each axis's declared window — the profile's
  floor plus a manifest-declared tolerance, so a 30-second observation
  cannot pass a 1-second profile — in both arms. The versioned manifest
  schema this RFC owns carries the shared profile values, the per-axis
  tolerances, and, per arm, the injection point relative to commit.

Delays are bounded: a hard per-response ceiling (proposed: 30,000 ms)
prevents a typo'd profile from manufacturing an unresponsive server that
is indistinguishable from a hang. A profile exceeding the ceiling is
refused with `SNAPBACK_NETWORK_PROFILE_DELAY_CEILING`, never clamped.

The two existing `SNAPBACK_TEST_*_DELAY_MS` coordinator seams should be
reimplemented as internal consumers of this mechanism or explicitly
documented as remaining test-only micro-seams (OQ4); they must not become
a second, divergent vocabulary.

### Authority: one activation chokepoint

Every surface that can select a profile — startup env, admin API,
host-ops, MCP, console — routes through **one activation gate**, which
enforces, fail-closed:

- **Hosted refusal with the fork-only exception.** A non-`normal` profile
  is refused wherever the instance serves hosted/production traffic unless
  the target carries LLP 0158's explicit derived-instance identity, keyed
  to each arm's *authoritative deployment classification*, never an
  inferable hint. On Rust, `AppState.hosted_serving` remains the explicit
  hosted-serving fact and `AppState.derived_instance_identity` is captured
  from the fork lineage already validated at database boot against its mint
  receipt and fork-local sidecars; neither fact is synthesized from request
  metadata. A primary hosted tuple refuses; the otherwise-identical tuple
  with derived identity is the sole hosted allowance. `ServerProfile`
  (`Dev|Demo|Test|Prod`, fail-closed to `Prod`) remains a conjunctive policy:
  explicit or defaulted `Prod` refuses even for a derived instance. Local
  non-`Prod` instances retain their existing allowance. On Cloudflare, the
  exact `SNAPBACK_TESTING === '1'` class remains non-hosted and may not also
  claim derived identity. A hosted derived deployment instead carries the
  dedicated canonical fork-id binding `SNAPBACK_DERIVED_INSTANCE_ID`; it may
  leave `SNAPBACK_TESTING` absent or set its exact false value, so perturbation
  authority does not unlock test-only functions. Primary hosted, incomplete,
  malformed, and contradictory tuples refuse. The stable code for every
  surface, including startup env, is `SNAPBACK_NETWORK_PROFILE_FORBIDDEN`.
- **The ceiling** (above), at activation time.
- **Provenance capture.** Activation records source (env, API, host-ops,
  MCP, console), principal where known, and timestamp.

Surface-specific rules:

1. **Startup config/env** — `SNAPBACK_NETWORK_PROFILE=optimistic` (or a
   JSON literal) for harnesses and scripted demos. An env-selected profile
   is startup configuration: it survives restarts *by design*, is subject
   to the hosted refusal like every other source, and is announced in the
   readiness/startup output.
2. **Admin API** — `GET/PUT /_snapback/api/debug/network-profile`. `GET`
   is `RoutePolicy::AdminRead`; `PUT` is `RoutePolicy::AdminWrite`, under
   the same shared operation authorizer as other admin writes. A
   runtime-set profile (API, host-ops, MCP, console) is **not
   persisted**: restart returns the server to `normal` or the env value —
   so a *runtime-set* slow profile cannot outlive its session.
3. **Host-ops + MCP** — two operations in the LLP 0024 table (proposed OQ2
   ruling dated 2026-08-04, subject to author veto:
   `debug.networkProfileGet`, AdminRead-class, and
   `debug.networkProfileSet`, AdminWrite-class), each
   registered with its profile requirement under the per-operation policy
   model, plus thin MCP projections per LLP 0042. Precedent to be honest
   about: the connection-disconnect control is an existing *admin-gated
   HTTP* runtime perturbation (`/_snapback/api/connections/{id}/
   disconnect`) — it is not in the 0024 operation table or the MCP tool
   set, so hoisting a perturbation into host-ops/MCP is new with this RFC
   and is part of why OQ2's namespace question deserves a deliberate
   answer.
4. **Admin console Developer panel** — a new surface, proposed here as an
   amendment to LLP 0017 (the console currently has *no* settings/toggle
   infrastructure — every existing control is navigation or a one-shot
   action). The panel shows the active profile and provenance, offers the
   built-in profiles plus a custom form, and inherits hosted behavior from
   the activation gate rather than console-specific policy: on a hosted
   target the panel renders read-only refusal, in the same class as raw
   engine access ("local-only, disabled by default, explicit future hosted
   policy").

### Honesty requirements

A perturbed server must say so, everywhere it speaks — and all reporting
must describe the *same* profile the delay actually used:

- **Snapshot rule.** The effective profile (name, fields, provenance) is
  captured immutably at each response/frame's delay-admission point; that
  snapshot drives the delay, the marker, and the telemetry record for that
  response. A concurrent toggle changes subsequent responses, never the
  reporting of in-flight ones.
- **Response marker.** Every response served under a non-`normal` profile
  carries a marker naming the profile: a `snapback-network-profile`
  response header on HTTP paths (CORS-exposed so browser harnesses can
  assert on it), and on the socket a frame annotation carried through the
  LLP 0093 client-protocol surface — live envelopes are schema-generated
  wire types, so the annotation lands as a versioned protocol/fixture
  change, not ad-hoc metadata.
- **Console banner.** While a non-`normal` profile is active, the admin
  console shows a persistent banner on every surface, not just the
  Developer panel. A forgotten toggle should be impossible to miss.
- **Observability attribution** — proposed here as an amendment to LLP
  0154, parallel to the 0017 one: telemetry records the active profile
  snapshot with any latency measurement taken under it, so injected delay
  can never pollute a performance baseline unattributed. The bakeoff
  environment manifest's `performanceRule` ("only same-machine,
  same-fixture, same-profile samples are comparative") becomes machine-
  checkable.
- **Startup line.** A server starting with a non-`normal` profile logs it
  in the readiness output.

### Reconciling with the LLP 0010 sleep ban

LLP 0010 bans `setTimeout`/sleep in tests: "if a test needs to sleep, the
harness is missing a capability." This RFC takes the position that the ban
governs *test code*, and this seam is the missing *harness capability* the
ban points at — but the reconciliation must be explicit:

- The **deterministic message-level harness** (LLP 0010, LLP 0146 D6) keeps
  its virtual-time/ordering controls and does not adopt wall-clock
  profiles. Where a deterministic test needs "slow ack," it uses the D6
  withhold/deliver seam, which expresses the same ordering without wall
  time.
- **Wall-clock profiles are for the surfaces that are already wall-clock:**
  interactive demos, the admin console, agent-driven exploratory testing,
  and acceptance/bakeoff suites whose frozen manifests *declare* a named
  profile (LLP 0129 and LLP 0138 already require this). A suite that runs
  under a non-`normal` profile is marked as latency-bearing and budgets its
  runtime accordingly; the Latency Kanban suite already pays this cost
  today, just dishonestly in the client.
- Test code still never sleeps. It declares a profile and asserts on
  markers and settlement facts.

### Boundary against neighboring documents

- **LLP 0146 D6 (ordering seams).** D6 owns *ordering and connectivity*:
  deliver/withhold a frame, disconnect/reconnect, advance trusted time,
  drop a mutation response. This RFC owns *wall-clock delay of otherwise
  unchanged, per-connection in-order responses* and deliberately claims
  nothing else — no drop, no reorder, no duplication, no request-side
  delay (LLP 0054's full transport scheduler remains unratified research).
  The two compose: a scenario can declare a profile and use D6 seams.
- **`offlineStretch` is not adopted.** The manifest names it, but offline
  is a connectivity condition, not an egress latency, and nothing in this
  registry can execute it: it belongs to the harness/scenario layer —
  disconnect-class seams (D6) plus the existing admin disconnect route,
  which today performs immediate teardown only. It stays a manifest-level
  scenario condition owned there; carrying an inert name in this registry
  would repeat the exact declared-but-unread drift this RFC exists to end.
- **LLP 0154 (observability).** 0154 measures latency; this RFC
  manufactures it, and reports itself to 0154 (attribution above). Its
  "routes are the contract, CLI/MCP thin clients, console one more client"
  structure is copied here deliberately.
- **LLP 0158 (instance forking).** A derived/forked instance is the natural
  safe place to run a perturbed server against production-shaped data; the
  hosted-policy question (OQ3) may resolve to "hosted allows profiles on
  forks only."

## Acceptance

- The Latency Kanban Snapback arm passes with its client-side `sleep`
  deleted and the manifest-named profile applied server-side, and both
  arms satisfy the client-observable envelope: actor-observed ack latency
  and observer-observed delta latency land within each axis's declared
  floor-plus-tolerance window, with each arm's manifest stating its
  injection point relative to commit. The environment manifest schema is
  versioned to this RFC's vocabulary (shared profile values, per-axis
  tolerances, per-arm injection points) as part of the same change.
- Under `optimistic`, commit facts (versions, settlement order — a
  timestamp-free projection; row timestamps necessarily differ across
  runs) are identical to a `normal` run of the same open-loop fixture
  (scripted arrivals — a request schedule that does not react to response
  timing) — observation moved, state did not. *Clarification
  (2026-08-04, implementation):* for the CONCURRENT portion of an
  open-loop corpus, which commit version lands on which racing request
  is kernel arrival scheduling — nondeterministic even between two
  `normal` runs — so the canonical projection compares per-request
  effects, the consumed version multiset, and final rows; sequential
  (paced) operations still settle in issue order and compare exactly.
- Under identical open-loop arrivals, commit admission order under a
  non-`normal` profile matches `normal`, commit throughput matches within
  a manifest-declared tolerance over a declared measurement interval, and
  a direct witness shows later commits admitted before earlier release
  deadlines expire — proving the wall-clock wait happens outside the
  invocation/instance/commit/storage serialization authorities (on
  Cloudflare, outside `runExclusive`) and ack delay is never additive
  behind an awaited fanout.
- Per-connection frame order is preserved under nonzero `jitterMs`, and a
  frame burst shifts once by the lane delay rather than multiplying it
  (pipeline, not head-of-line service); with equal lane delays, observed
  delta-before-ack skew for one commit is bounded to scheduler noise.
- An agent can, through host-ops (and MCP): read the active profile, set
  `demo-slow`, observe a mutation ack arrive late while the optimistic
  overlay renders immediately, and restore `normal` — all with structured
  envelopes and no process restart.
- The admin console Developer panel can toggle profiles under the admin
  write authorizer, and the banner is visible on every console surface
  while a non-`normal` profile is active.
- Every delayed response carries the profile marker (header CORS-exposed;
  socket annotation via the LLP 0093 protocol surface), and marker,
  delay, and telemetry for one response always describe one snapshot.
- Restarting the server clears any runtime-set profile; an env-set profile
  is re-announced in readiness output.
- The classification matrix is exercised arm by arm, for startup env and
  runtime set alike: Rust local non-`Prod` allows; `Prod` (explicit or
  defaulted) refuses; a primary with `hosted_serving` present refuses; the
  otherwise-identical hosted tuple with boot-validated derived identity
  allows; missing or contradictory classification refuses. Cloudflare
  `SNAPBACK_TESTING === '1'` allows as the non-hosted class; primary hosted
  refuses; hosted with a canonical `SNAPBACK_DERIVED_INSTANCE_ID` allows;
  missing, malformed, and test-plus-derived classifications refuse — every
  refusal with `SNAPBACK_NETWORK_PROFILE_FORBIDDEN`. A
  ceiling-exceeding profile is refused with
  `SNAPBACK_NETWORK_PROFILE_DELAY_CEILING`, not clamped.
- Rejected and no-op mutation responses are delayed from result
  readiness — the non-commit deadline basis is exercised, not assumed.
- `normal` is a true identity: with it active, the seam adds no measurable
  overhead and no markers.

## Open questions

- **OQ1 — Field vocabulary.** Are the three lane delays plus jitter enough
  for v1, or do named consumers need per-connection targeting (delay one
  client, not all) from the start? Per-connection scoping is strictly more
  useful for multi-client convergence demos but complicates the console
  surface. (Request-side delay is not an open question — it is out of
  scope by the observation-not-state rule.)
- **OQ2 — Operation namespace. RESOLVED (author-ratified 2026-08-04):**
  runtime perturbation operations form the new `debug.*` family, beginning
  with `debug.networkProfileGet` and `debug.networkProfileSet`; future
  perturbation ops (D6 seams, fault injection) join through their own
  reviewed LLP 0024 table amendments.
- **OQ3 — Fork exception. RESOLVED (2026-08-04; author adopted the
  recommended ruling without strong preference — revisitable):** hosted
  targets allow a non-`normal` profile only on LLP 0158 forks/derived
  instances, which carry explicit derived identity and contained blast
  radius; primary hosted instances refuse unconditionally. The Cloudflare
  arm gets a dedicated deployment-classification binding tied to derived
  identity rather than piggybacking `SNAPBACK_TESTING` (which also
  unlocks test-only functions). **Implemented 2026-08-05:** Rust consumes
  the exact boot-validated LLP 0158 identity through `AppState`; Cloudflare
  consumes `SNAPBACK_DERIVED_INSTANCE_ID` while leaving all
  `SNAPBACK_TESTING` gates independent. The interim unconditional hosted
  refusal is retired in favor of this fork-only exception.
- **OQ4 — Coordinator test seams. RESOLVED (author-ratified 2026-08-04,
  as implemented):** `SNAPBACK_TEST_SUBSCRIPTION_STAGE_DELAY_MS` is folded
  into the profile mechanism's live-delta lane (still `SNAPBACK_TESTING`-
  gated, historical 1,000 ms clamp retained, marker emitted);
  `SNAPBACK_TEST_NESTED_COMMIT_DELAY_MS` stays a documented test-only
  micro-seam outside the egress model — it delays an internal stage, which
  the observation-not-state rule excludes — now under the 30,000 ms cap
  discipline.
- **OQ5 — Guide surface. RESOLVED (2026-08-05):** ship the guide page now
  rather than retaining the GAP because the acceptance corpus had already
  passed when this decision was made. LLP 0184 Phase 0 item 2 executes the
  ruling: [`guide/operating/network-profiles.md`](../guide/operating/network-profiles.md)
  now teaches the complete operating surface, and the
  `operating.network-profiles` row in the
  [capability index](../guide/capabilities.md) is `shipped`.

## Implementation record

- 2026-08-04 — Rust-arm core landed with this note: profile model and
  built-ins, one fail-closed activation gate (env + admin API), two-phase
  commit-relative deadline release on all three lanes with monotone
  per-connection clamp on live durable queues, once-per-commit jitter,
  HTTP marker (CORS-exposed) + telemetry snapshot, startup announcement,
  refusal codes classified in the reviewed diagnostic table; capability
  row `operating.network-profiles` is `partial`. Deferred with tickets:
  socket frame marker via LLP 0093 wire types
  (`issues/20260804-0167-live-wire-network-profile-marker.md`) and the
  remaining corpus/stages — Cloudflare arm, bakeoff swap, and console panel
  (`issues/20260804-0167-remaining-acceptance-corpus.md`).
- 2026-08-04 — host-ops/CLI/control-plane MCP toggle surface landed under the
  vetoable OQ2 proposal: registered `debug.networkProfileGet` (`AdminRead`)
  and `debug.networkProfileSet` (`AdminWrite`), both returning
  `hostOpsResult`; set calls the same `AppState::activate_network_profile`
  gate as admin PUT. Rust `snapback mcp` remains resource-only; the tools live
  on LLP 0042's shipped `snapback mcp-control` surface.
- 2026-08-05 — OQ3 landed. The Rust authority captures LLP 0158's exact fork
  identity during trusted `AppState` construction from the database-open
  proof and admits it as the only hosted non-`Prod` exception. The Cloudflare
  coordinator accepts a canonical `SNAPBACK_DERIVED_INSTANCE_ID` deployment
  binding as the hosted-derived class without setting `SNAPBACK_TESTING`.
  Unit/acceptance matrices cover local, explicit/defaulted `Prod`, primary
  hosted, hosted derived, missing, malformed, and contradictory facts for env
  and runtime selection.
- 2026-08-05 — LLP 0184 Phase 0 item 2 shipped the dedicated network-profile
  guide page and flipped `operating.network-profiles` from `partial`/GAP to
  `shipped` after the acceptance corpus passed.

## Revision history

- v0.4 (2026-08-04) — **unreviewed** post-round-3 fixes for codex
  in-delta MATERIALs (final round verdicts bind to v0.3, sha256
  `5294657d50d519429270ebdac9f7b831b0c94de7291cc4de4514528a9db04d23`):
  result-readiness deadline basis for non-commit mutation responses;
  once-per-commit jitter sampling; open-loop-bounded throughput criterion
  with tolerance, interval, and deadline witness; arm-by-arm refusal
  matrix; plus fable clarifications (defaulted `Prod` refuses;
  timestamp-free commit-fact projection; `SNAPBACK_TESTING` conflation
  noted in OQ3).
- v0.3 (2026-08-04) — round-2 delta response: delay redefined as
  commit-relative two-phase release (prepare under existing serialization
  authority, wait outside every lock, monotone per-connection deadlines);
  hosted refusal rebound from `ServerProfile` to authoritative deployment
  classification per arm (`hosted_serving` on Rust, `SNAPBACK_TESTING`
  deployment class on Cloudflare, refuse on missing/contradictory);
  client-observable envelope gains per-axis tolerance windows and the
  arm-injection-point manifest schema; `demo-slow` pinned; state-unchanged
  acceptance qualified to open-loop fixtures.
- v0.2 (2026-08-04) — round-1 dual-family review response: observation
  semantics pinned (commit never delayed; coordinated `optimistic`;
  client-observable envelope replaces the false same-boundary claim vs.
  Zero); `offlineStretch` removed from the registry; hosted policy
  consolidated to one fail-closed activation chokepoint with named refusal
  codes; ops split get/set under the operation authorizer; jitter
  constrained to FIFO; names-only manifest adoption with schema versioning
  owned; capped-knob claim, disconnect precedent, 0154 amendment, and LLP
  0093 marker path corrected.
- v0.1 (2026-08-04) — initial draft; set to Review at super-refine loop
  start.

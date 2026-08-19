# LLP 0040: Cloudflare narrow proof

**Type:** RFC
**Status:** Draft
**Systems:** Deployment, Runtime, Storage, Sync, Realtime, Security, Developer experience, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-07
**Revised:** 2026-08-18 (LLP 0276 crate-path relocation); 2026-08-03 (LLP 0109 acceptance: dated amendment extending the compiled-seed invariant to versioned `SeedArtifactV1` identity — caller bytes attest, only exact-identity compiled bytes write, and the hosted arm stays a declared conformance GAP that advertises neither versioned-seed capability). 2026-08-01 (live fan-out now conservatively considers every subscribed live-query function on every non-empty commit, closing the under-declared/unwitnessed-read false-negative while retaining indexed durable-registry selection and equal-shape query grouping; All Aboard pins the two-table regression). 2026-07-17 (the pinned Node 24.18.0 protocol-hardening proof now uses an `Expect: 100-continue` header-only exchange for oversized uploads, preserving the real-loopback Content-Length fast path without starting a reset-prone uploader or retrying); 2026-07-12 (ENG-24341–ENG-24369 / ENG-24387–ENG-24388 final review: subscription rows/args and both legacy/total sockets have enforced manifest-advertised ceilings; foundational schema drift remains diagnosable/resettable; deploy health is pinned to Cloudflare's exact Worker-version metadata after code deploy and a post-secret final deploy. Earlier:
whole-codebase review hardening closes hosted provisioning, schema/index,
action/cron, secret, realtime-session, request-decoding, reset/migration,
deployment-identity, config-operations, bootstrap, and cache-hygiene gaps; see
§Whole-codebase review hardening); 2026-07-11 (ENG-23840 / ENG-23841 operational closeout: the
Cloudflare account token is active with Workers and analytics access, one
safely persisted admin token passed both proof gateways, and a deliberate
All Aboard no-subscriber run produced five zero-demand observations plus a
settled pure two-hour interval whose Adaptive analytics contained no rows and
summarized to observed-zero request and execution estimates; detailed evidence,
sampling limits, and telemetry caveats are
recorded in LLP 0050. ENG-23849's deployed platform-limit confirmation remains
unrun); 2026-07-08 (ENG-23640: the decisive real-Cloudflare evidence is
recorded — first real deploy + run of the notes pair, 11/11; a genuine
platform eviction observed via the new `/health` `objectBoot` marker and
survived by the still-connected hibernating subscriber; per-script
observed-zero estimates over both idle windows; §As-built gains
§Real-Cloudflare evidence, the
remote runner gains the `/evict` + platform-eviction legs and a real
analytics billing read via the new `billing-windows.mjs`; §Status narrows the
accepted-proof gap to the percentile benchmark report, max-subscribers, and
contention measurements); 2026-07-07 (seventh revision same day, ENG-23628 / LLP 0049
Phase 0: the proof gains the deploy-time app selector — the app bundle is no
longer hardcoded; the `snapback-app` module alias (wrangler `alias` in each
deploy config, esbuild alias in the Miniflare harness) resolves to exactly
one checked-in bundle, `app/notes.app.js` or `app/all-aboard.app.js`. The
notes bundle, its wrangler configs, its 36-check Miniflare acceptance, and
its protocol are UNCHANGED and remain this RFC's pinned regression fixture;
All Aboard deploys as separate Workers (`snapback-all-aboard-proof` /
`-handler`) with gateway-served same-origin static assets, host-side
deterministic seeding, and a kit wire-protocol layer (connection grants,
`/query/:name`, `/live/:name/subscribe`, `/live/:id/stream`, empty
`/outbox/:id` by declared design) so the generated Contract surface runs on
this target — see LLP 0049. Sixth revision same day: GPT-5 re-review applied —
negative evidence split out of the accepted-proof checklist so the
non-hibernating branch cannot produce an accepted proof; snapshot-before-delta
and reconnect-diagnostic acceptance added with the Phase 0 reconnect scope
pinned (structured resnapshot required, retained-version resume may stay a
declared gap); alarm retry dropped from Phase 0 measurements; benchmark
fixtures required next to fan-out/latency numbers; at least one
real-Cloudflare eviction run required for wake/rehydrate evidence. Fifth
revision same day: the durable-store flip
ratified by Charlie and strengthened to everything-on-Durable-Objects — D1
leaves the plan's later phases too; the control plane is a registry object,
LLP 0014 §Resolution. Fourth revision same day: DK-5 twin decided and
split out as LLP 0048 — this proof consumes the twin's V8 handler harness,
built and conformance-proven locally before the first deploy; acceptance
gains the single-sourced-harness gate. Third revision same day: GPT-5
cross-family review
applied — see `reviews/0040-cloudflare-narrow-proof.gpt-5.md`: hibernation is
now a MUST, with a non-hibernating result defined as negative evidence that
blocks LLP 0014's Phase 1 gate; storage-backed subscription rehydration pinned
and tested; the handler/host seam pinned to the generated async `ctx` surface
with reach-through denial tested; the Miniflare/real-Cloudflare evidence split
stated and OQ1 narrowed; frozen-time measurement rule carried in. Second
revision same day: durable-store decision reopened by the author against the
full-plan sketch and re-resolved — app rows move from D1 to the coordinator
Durable Object's SQLite storage, profile id `cloudflare-do-sqlite-v8`,
deploy-time bundle compilation pinned, D1 reassigned to the platform control
plane; proposed, pending Charlie's ratification — see LLP 0014 §Resolution.
Earlier same day: cross-family review revisions, ratified by Charlie — see
`reviews/0040-cloudflare-narrow-proof.claude.md`: Profile A decided with a
revisit trigger, 0014 validation requirements restored, hibernation and cost
measurements added, V8-handler requirement pinned; initial same day)
**Related:** LLP 0000, LLP 0003, LLP 0007, LLP 0008, LLP 0009, LLP 0010, LLP 0014, LLP 0018, LLP 0028, LLP 0032, LLP 0035, LLP 0038, LLP 0046, LLP 0047, LLP 0048, LLP 0049, LLP 0050

## Summary

This RFC defines the first Cloudflare proof that is small enough to build and
strong enough to test Snapback's scale-to-zero thesis. It is a proof, not a full
Cloudflare product. It executes LLP 0032 X3. Its start fired the DK-5 revisit
trigger, and the twin is now decided and built as
[LLP 0048](./0048-v8-conformance-twin.rfc.md)
([LLP 0009](./0009-code-execution-security.rfc.md) §Decision DK-5,
re-decision): this proof deploys the same V8 handler harness the twin proves
locally first, and the capability report's computed limit fields land on that
first V8 runtime.

The proof runs one generated Snapback app on Cloudflare with:

- a Worker HTTP/WebSocket gateway;
- one Durable Object as the app coordinator and version authority;
- durable app rows in that same Durable Object's embedded SQLite storage;
- a V8 handler runtime executing at least one real JS handler;
- WebSocket Hibernation holding every server-held socket;
- one query, one mutation, and one live subscription;
- explicit capability reporting for every missing feature.

## Motivation

[LLP 0014](./0014-cloudflare-strategy.rfc.md) names Cloudflare as Snapback's
second standard target, but the repository has no Cloudflare code. That leaves
"scale to zero" as a local idle measurement plus a deployment hypothesis.

The next useful evidence is not a complete target. It is a narrow target that
forces the hard seams:

- V8 execution instead of Ibex/Hermes;
- no local polling tailer;
- one per-app commit-version authority;
- WebSocket ownership in Durable Objects;
- SQLite-in-Durable-Object storage behavior under Snapback's write contract;
- platform-shaped capability gaps.

## Design

### Target shape

The first proof stores app rows in the coordinator Durable Object's embedded
SQLite storage (ratified by Charlie, 2026-07-07, reopening and replacing the
same-day Profile A pin after the full-plan sketch; the complete rationale
lives in [LLP 0014](./0014-cloudflare-strategy.rfc.md) §Resolution —
everything on Durable Objects):

- Worker routes HTTP and WebSocket requests.
- Durable Object owns the app instance, connection registry, live subscriptions,
  and commit-version allocation.
- The same object's SQLite storage holds app tables, system tables, and the
  change journal.
- The mutation path executes in V8 and commits through the Durable Object.
- The live path pushes from the mutation commit, not from a timer.

Rationale for Durable Object SQLite over D1 as the app-row store: the commit
becomes one local SQLite transaction — version allocation, row writes, and
journal append together — so LLP 0007's gap-free visibility property holds by
construction, exactly as on the local target, with no two-store commit to
reconcile (D1-backed rows put the DK-2 version counter and the data in
different stores, or move the counter into D1 batches and inherit
ambiguous-failure recovery the end state does not want). It is the same SQLite
dialect as the canonical target, so LLP 0007's single-sourced type
normalization and query semantics carry over unchanged; D1 storage would buy
no Postgres translation evidence — [LLP 0046](./0046-postgres-graduation-path.rfc.md)
owns that leg, and D1 is SQLite too. D1 is not in the plan at all — the
ratified resolution puts the later control plane on a registry Durable Object
as well (LLP 0014 §Resolution) — so it survives only as the named fallback
here. **Revisit trigger:** if the proof's measurements show object SQLite cannot satisfy the
write contract or its platform limits bind in practice (the 2 MB row/BLOB cap,
PITR/export insufficiency, or storage pricing at measured workloads), the
D1-store shape (0014 Profile A) reopens before any second Cloudflare
investment — noting that the 10 GB ceiling is identical on D1, so outgrowing
it is answered by graduation, not by Profile A.

This intentionally chooses a simple single authority before sharding. If one
object becomes the bottleneck, that is a measured result, not a design failure.

The proposed target profile id is `cloudflare-do-sqlite-v8`, following the
`local-dev-sqlite-ibex` convention; its capability manifest must validate
against a generated JSON Schema, matching the existing `schemas/` drift gate.

### Hibernation and subscription state

The proof holds every server-held socket through the WebSocket Hibernation
API (`acceptWebSocket` on the object state, not `ws.accept()`). Hibernation is
the mechanism behind the connected-idle half of the scale-to-zero thesis
(LLP 0014 §Platform Facts), not an optimization to evaluate later. Three
pinned consequences, carried from LLP 0014 §One-way doors 4–5 into this
slice:

- the subscription registry (query identity, args, cursor, connection id) is
  storage-backed from the first commit; per-socket attachments carry only
  connection identity and auth epoch, within the 16 KB attachment cap;
- a woken object rehydrates live subscriptions from persisted rows — no
  in-memory registry may be load-bearing across eviction;
- the object uses no `setTimeout`/`setInterval` (they prevent hibernation);
  the proof needs no alarm, and if one appears it follows 0014's
  one-alarm-per-object dispatcher rule.

If hibernation proves unworkable for Snapback's subscription model, the
measurement report still lands — as **negative evidence**: it blocks
LLP 0014's Phase 1 gate until a hibernating design works, and the proof is
not accepted on the strength of an always-pinned coordinator.

### App subset

The proof supports only the smallest meaningful app:

- schema load at deploy time, validated by stable schema/bundle hashes (the
  0014 requirement — stale or mismatched artifacts are a structured failure,
  not a silent serve);
- the app bundle compiled into the deployed Worker at deploy time — the
  deployed Workers runtime forbids dynamic code evaluation (`eval`/`new
  Function`), so the local load-bundle-at-runtime model cannot port; runtime
  bundle loading returns only as a Workers-for-Platforms capability in
  LLP 0014's hosted phases, and the capability manifest reports code hot-load
  as missing;
- one JS mutation handler executing in V8 — a host-plan-only mutation would
  leave the proof's first forced seam (V8 execution) unexercised, so at least
  one real handler is required; a host-plan mutation may exist alongside it;
- one single-table query;
- one live subscription with authoritative initial snapshot;
- one generated client running from a browser test, consuming the same
  generated artifacts the local target accepts — any divergence is
  capability-explained, per 0014's validation requirements;
- deterministic reset/seed for the acceptance suite, or the profile declares
  the exact unsupported gap.

V8 handlers receive no ambient Worker powers: no free `fetch`, no env, no
bindings — the same host-mediated capability posture as the local target
([LLP 0009](./0009-code-execution-security.rfc.md)), verified by an
ambient-power denial test. Note the mechanism this forces on Workers: `fetch`
and friends are *globals* in an isolate, so the proof must actively remove or
shadow them at module init, not merely decline to pass bindings; the
platform-enforced version of this posture arrives with Workers for Platforms
in the hosted phases ([LLP 0047](./0047-hosted-execution-limits.rfc.md)).

The same posture applies inward: handlers reach storage and host facilities
only through the generated async `ctx` surface — never direct Durable Object
storage handles, Worker env, or module-global host objects — so the seam
stays RPC-shaped and Phase 3 can move execution into user Workers without
changing the app-facing contract (LLP 0014 §One-way doors 3). Sharing the
coordinator's isolate is allowed in Phase 0; the constraint is the shape of
the surface, not the process boundary. The denial test therefore probes both
directions: ambient globals (`fetch`, env, bindings) and direct host-object
reach-through (Durable Object storage handles, module globals).

The harness implementing all of this — global-strip at module init, `ctx`
marshaling, the tagged completion envelope — is
[LLP 0048](./0048-v8-conformance-twin.rfc.md)'s artifact, single-sourced with
the twin and conformance-proven locally before this proof's first deploy.

Offline replay, auth, assets, notifications, cron, multiple apps per deployment,
and hosted marketplace behavior remain capability gaps.

### Version contract

The Durable Object is the version authority for the app stream. Every committed
mutation allocates the next version and writes all affected rows as one logical
changeset — version allocation, row writes, and change-journal append commit in
one local SQLite transaction. The stored representation must allow a subscriber
to receive either:

- the atomic pushed delta from the commit path; or
- a fresh authoritative snapshot after reconnect/resync.

The proof must not rely on comparing versions across apps or Durable Objects.

Reconnect diagnostics follow 0014 §Connection Ownership: the client can tell
whether it resumed the same object, moved to a replacement object, or needs a
fresh snapshot, and the connection key is visible in diagnostics.

### Idle economics

The proof's reason to exist is the scale-to-zero *economics* claim, so idle is
measured in dollars, not just CPU:

- **Idle with no connections:** does the deployment incur any billable usage
  over a quiet window?
- **Idle with a connected live subscriber:** a Durable Object with an open
  WebSocket stays pinned — and billable — unless the proof uses the WebSocket
  Hibernation API. The proof **must** hold sockets through the Hibernation API
  and measure this window hibernating; a non-hibernating measurement may be
  reported only as the negative-evidence outcome defined in §Hibernation and
  subscription state, never as the accepted result.

Cloudflare's cost/usage counters — requests, duration (GB-s), rows
read/written, and stored bytes — are recorded for both idle windows; "steady
compute drops to zero" is only evidence if the billing surface agrees.

### Capability report

The Cloudflare proof must emit a target capability manifest distinct from
`local-dev-sqlite-ibex`. Missing features are product facts, not TODO comments.

At minimum the report must declare:

- supported runtime engine;
- storage engine/profile;
- syncable query subset;
- live transport;
- resource limits that are enforced, advisory, or missing (computed on the
  real runtime, per DK-5);
- unsupported features such as offline replay, assets, notifications, and
  external auth until they are real on the target.

### Measurements

The proof exists to measure:

- cold start and first request latency;
- idle behavior — both idle windows above, with billable usage;
- mutation latency;
- initial snapshot latency;
- live update latency;
- reconnect behavior;
- post-eviction wake and subscription rehydration behavior;
- maximum practical subscribers for the supported query shape;
- Durable Object storage and CPU-limit contention and failure diagnostics
  (row/statement caps, overload). The proof introduces no alarm, so
  alarm-retry semantics stay out of Phase 0 — LLP 0028's Cloudflare mapping
  owns them when cron arrives.

Method note: these numbers are **not comparable** to
[LLP 0035](./0035-local-target-benchmarks.research.md)'s, which are in-process
and compute-isolated; Cloudflare numbers are network-inclusive and
region-dependent. The report states its own method (percentiles, cold vs warm,
region, client location), emits machine-readable JSON like the local harness,
and lands as a Research LLP. Timing is taken at clients or across I/O
boundaries: `Date.now()` does not advance during synchronous execution in the
Workers runtime (LLP 0014 §One-way doors 9), so same-turn synchronous deltas
inside the object are not valid measurements. Fan-out and latency numbers are
reported next to their benchmark fixture — query predicate, snapshot size,
delta payload, write rate, connection count, hibernated versus awake state,
rows read/written, and per-message request costs — and are labeled as
evidence for the supported query subset only, never a general Cloudflare
fan-out claim (the non-goals forbid one).

Evidence split: the local/Miniflare suite is a regression surface only. Idle
economics, hibernation and eviction behavior, billing counters, placement, and
platform limits require real Cloudflare runs — Miniflare delivers hibernation
events but never actually evicts the object and has no billing surface, so it
cannot produce the proof's decisive evidence.

## Non-goals

- Production multi-tenant hosted Snapback.
- Cloudflare profile selection for every workload.
- R2 assets, Queues, full cron, or notifications.
- D1 anywhere — not in the proof, and per the ratified LLP 0014 §Resolution
  not in the later phases either (the control plane is a registry Durable
  Object); D1 persists only as the named fallback in this document's revisit
  trigger and §Resolution's control-plane trigger.
- Sharded Durable Object topology.
- Postgres graduation.
- Claiming general Cloudflare support from the proof alone.

## Acceptance

These bullets define the **accepted proof**. The negative-evidence outcome
(§Hibernation and subscription state) may land as a measurement report, but
it does not satisfy this list and leaves LLP 0014's Phase 1 gate closed — an
accepted LLP 0040 cannot be produced by the non-hibernating branch.

- A checked-in wrangler/deploy config deploys the demo with a single command or
  documented CI surrogate.
- A browser client can query, mutate, subscribe, disconnect, and resubscribe.
- A cold-start subscription delivers the authoritative initial snapshot
  before any delta — ordering asserted by the test, not assumed.
- Reconnect diagnostics distinguish same-object resume, replacement object,
  and forced resnapshot (0014 §Connection Ownership); the proof exercises the
  structured-resnapshot path end to end. Retained-version resume beyond it
  may remain a declared capability gap.
- At least one mutation executes a JS handler in V8, and an ambient-power test
  shows handlers cannot reach `fetch`/env/bindings nor direct Durable Object
  storage handles or module-global host objects without a granted capability —
  handlers touch the host only through the generated async `ctx` surface.
- Server-held sockets use the WebSocket Hibernation API, and settled analytics
  over the connected-idle window observes a zero Worker-duration estimate.
- After the object's in-memory state is discarded — real eviction on
  Cloudflare, or a forced in-place reinitialization in the CI surrogate — a
  committed mutation still reaches the still-connected subscriber:
  subscription rehydration from persisted rows is tested, not assumed. The
  accepted proof includes at least one real-Cloudflare eviction run recorded
  in the measurement report; the surrogate covers regression thereafter.
- The deployed handler harness is the same single-sourced artifact
  [LLP 0048](./0048-v8-conformance-twin.rfc.md) proves locally, and the
  twin's conformance gate passed before the first real deploy.
- Schema and bundle hashes are validated at load; a stale artifact is a
  structured failure.
- The same generated artifacts are accepted locally and on Cloudflare, or every
  divergence is capability-explained.
- A mutation reaches a live subscriber without polling storage on an interval.
- The app's commit versions are gap-free within the app stream.
- Reset/seed works for the acceptance suite, or the profile declares the gap.
- The capability manifest is served, validates against its generated JSON
  Schema, and names the missing features honestly.
- The benchmark report records cold-start, mutation, snapshot, live,
  reconnect, and wake/rehydration measurements, plus both idle windows with
  billable-usage counters, measured with the Hibernation API in use — and
  every fan-out or latency number carries its benchmark fixture
  (§Measurements).

## Open Questions

- The Miniflare/real-Cloudflare evidence split is pinned in §Measurements
  (Miniflare cannot produce the decisive evidence). What remains open is only
  the CI cadence: may the day-to-day acceptance suite run Miniflare-only,
  with real-Cloudflare evidence runs scheduled or manual rather than
  per-change?
- Beyond the contention/overload diagnostics 0014 already requires, which
  additional failure modes deserve stable `SNAPBACK_*` codes before the proof
  counts as useful evidence?

## As-built (2026-07-07; real-Cloudflare evidence run 2026-07-08)

The proof is built, passes its full behavioral checklist under the local
Miniflare surrogate, and — as of 2026-07-08 (ENG-23640) — has produced the
decisive real-Cloudflare evidence: a genuine platform eviction observed and
survived mid-subscription, and billing-surface observed-zero estimates over both idle windows
(see §Real-Cloudflare evidence below). What landed in `cloudflare/`:

- **Worker + Durable Object target.** A gateway Worker (`src/gateway.js`)
  routes HTTP/WebSocket to one app coordinator Durable Object
  (`src/coordinator.js`). The coordinator owns app tables, the DK-2 version
  counter, the change journal, and the storage-backed subscription registry in
  one embedded SQLite database; a mutation commits version + rows + journal in
  one `storage.transactionSync`, so gap-free visibility holds by construction.
- **V8 handler execution, faithfully isolated.** Handlers run in a *separate*,
  globally stripped isolate — the single-sourced LLP 0048 harness Worker
  (`src/handler-worker.js`) with the app bundle compiled in at deploy time —
  reached over the async, RPC-shaped `ctx` seam. The coordinator serves the
  `ctx` host calls (`src/host-ops.js`, the JS analogue of the Rust op table);
  the handler isolate has no ambient authority and no Durable Object storage
  handle. The two-direction ambient-power denial is asserted against the
  *deployed* handler, not just the twin.
- **WebSocket Hibernation.** Every server-held socket is accepted via
  `acceptWebSocket`; the per-socket attachment carries only connection id and
  auth epoch, and the subscription registry lives in SQLite, so a woken or
  freshly-evicted object rehydrates from rows. The object uses no
  `setTimeout`/`setInterval`; the live path pushes from the commit.
- **Capability manifest.** `CapabilityManifest::cloudflare_do_sqlite_v8`
  (emitted by `crates/snapback-conformance/src/bin/snapback-cf-manifest.rs`) serves
  `cloudflare-do-sqlite-v8`, validates against the generated JSON Schema, and
  names the missing features honestly — `code_hot_load` (deploy-time bundling,
  no runtime eval), ephemeral realtime, cron, external auth, assets,
  notifications, offline replay, retained-version resume, multi-app, and
  hosted marketplace.
- **Acceptance + measurements.** `cloudflare/test/acceptance.mjs` (Miniflare)
  passes its full checklist — **41/41 as of 2026-07-08**, grown from the
  original 16 by the review-hardening batch and the ENG-23606 null-semantics
  parity checks (the suite prints its own count):
  query, mutate, subscribe, disconnect, resubscribe; snapshot-before-delta
  ordering; gap-free versions; the on-target ambient denial;
  push-from-commit live delivery; and the eviction-surrogate rehydration
  path. `cloudflare/test/measure.mjs` records mutation, snapshot,
  live-update, and fan-out latency next to each benchmark fixture (all
  Miniflare-local, explicitly non-comparable to LLP 0035 and to real
  Cloudflare). A checked-in `deploy.sh` deploys both Workers with one command,
  `scripts/cf-check-compat` guards the single-sourced compat pins,
  `cloudflare/test/acceptance.remote.mjs` is the real-Cloudflare runner
  (eviction legs, idle windows, in-run billing read), and
  `cloudflare/test/billing-windows.mjs` reads the GraphQL analytics billing
  counters for any window/script set (also standalone, with hourly
  bucketing).

### Real-Cloudflare evidence (2026-07-08, ENG-23640)

First real deploy + run of the notes pair, against
`https://snapback-notes-proof.ccheever-0f6.workers.dev` (the expired-token
blocker ended with ENG-23632's refreshed token). Runner:
`acceptance.remote.mjs`, `SNAPBACK_IDLE_WINDOW_MS=600000`. Result: **11/11**,
`platformEvictionObserved: true`.

- **Real platform eviction, observed and survived.** `/health` exposes an
  `objectBoot` marker that is fresh per in-memory coordinator instance.
  Across the 10-minute connected-hibernating idle window the marker changed
  (`109544c2…` → `5c7f074c…`): Cloudflare genuinely evicted the hibernating
  object while the subscriber's socket stayed open. The next committed
  mutation reached that still-connected subscriber — subscription
  rehydration from persisted rows on a *real* eviction, not the surrogate.
  The forced `/evict` leg also passed on the same deployment
  (`post-eviction commit reaches the still-connected subscriber`).
- **Connected-hibernating idle settles to an observed-zero estimate.** Settled per-script analytics
  over the pure interior of the idle window (22:47:30–22:55:30Z):
  `snapback-notes-proof` + `snapback-notes-handler` returned no rows, summarized
  as **0 estimated Worker requests, 0 estimated Worker execution GB-s, and 0
  estimated Durable Object requests**. (The adjacent
  window correctly shows the run's own setup/wake traffic — 8 requests,
  3.82 GB-s — so the observed zeros are settled data, not attribution lag.)
- **No-connection idle settles to an observed-zero estimate.** After the run closed its socket the
  deployment sat untouched; settled per-script analytics over
  22:57:00–23:55:00Z (58 min) returned no rows for either script, summarized
  as **0 estimated requests, 0 estimated Worker execution GB-s, and 0 estimated
  Durable Object requests**.
- **Cold start / first request: 53 ms** (client-measured `GET /health`,
  us-west client, first request of the run against a freshly deployed
  gateway; single sample, method per §Measurements).
- **Method caveat:** `durableObjectsPeriodicGroups` (activeTime, WebSocket
  message counts) carries no script identity on the GraphQL surface, so its
  rows are account-wide; during these windows the account's concurrently
  deployed All Aboard demo (LLP 0049) dominates that dataset. The
  per-script Workers/DO-invocation datasets above are the notes-proof
  evidence; the account-wide activeTime is reported in the diary for
  completeness, not attributed to the notes deployment.

#### Operational residue closeout (2026-07-11–12, ENG-23840 / ENG-23841)

Separate from this RFC's accepted-proof checklist, the two operational
residues it tracked are now closed. ENG-23840 restored the Cloudflare account
credential path: the replacement account token authenticated with Workers and
analytics access, and one safely persisted admin token passed the admin gates
on both deployed proof gateways. No credential path or value is part of the
evidence record.

ENG-23841 then ran All Aboard's deliberate no-subscriber window. Five status
observations from `2026-07-11T23:32:13Z` through `23:32:44Z` all reported
zero demand; the final observation defines the disarm boundary. The
post-window observation at `2026-07-12T01:39:47Z` reported
`inactive:no-demand`, demand `0`,
`nextRun: null`, and `lastRun: null`. The controls read at
`2026-07-12T02:28:06Z` and the final quiet re-read at
`2026-07-12T02:43:38Z` over the pure interval
`2026-07-11T23:37:44Z`–`2026-07-12T01:37:44Z` returned `errors: []` and empty
raw Workers, Durable Object request, periodic, and storage arrays. The reader
summarized the script-attributed request datasets to **0 estimated Worker
requests, 0 estimated Worker execution GB-s, and 0 estimated Durable Object requests**;
the account-wide periodic query observed 0 µs active time. Non-zero controls on
both sides and coverage of all three All Aboard scripts across the
script-attributed dataset union distinguish sparse zero-row reporting from a
broken query. Cloudflare Adaptive datasets may be sampled, so empty quiet rows
without a sample interval are an observed-zero estimate, not an absolute event
or invoice guarantee. Datasets without script identity remain account-wide,
and storage had no positive control. The full method, controls, sampling limit,
and storage caveat are recorded in
[LLP 0050](./0050-cloudflare-proof-remote-benchmarks.research.md)
§All Aboard no-subscriber idle evidence and the machine-readable artifact is
`cloudflare/generated/measurements.remote.idle.2026-07-12.json`.

**Remaining against the accepted-proof checklist:** none measured — the
percentile benchmark report, maximum-practical-subscribers, and DO
contention/overload measurements landed 2026-07-09 (ENG-23713) as
[LLP 0050](./0050-cloudflare-proof-remote-benchmarks.research.md), from the
new real-deployment runner `cloudflare/test/measure.remote.mjs`
(machine-readable artifact in `cloudflare/generated/`). The decisive items —
real eviction with the Hibernation API in use and both idle-window billing
counters — were recorded 2026-07-08 above. Two diagnostics gaps the
measurements exposed (oversized writes surface a raw platform HTML 500
instead of a `SNAPBACK_*` envelope; burst-shed `SNAPBACK_HANDLER_FAILED` —
the platform's subrequest-depth limit — carries no overload/retryable
discrimination) were locally hardened in ENG-23849: serialized rows are
checked against the manifest-owned 2 MB cap inside the commit transaction,
and the coordinator mutex now resets its Promise tail when idle and admits a
bounded queue below Cloudflare's 32-invocation service-binding chain limit.
Both proof and kit protocols return structured `SNAPBACK_VALUE_TOO_LARGE`
(non-retryable) or `SNAPBACK_OVERLOADED` (retryable with backoff) results.
The Miniflare regression is 50/50, including a 32-way bounded burst with
unique gap-free commit versions; that is not a real-platform limit proof.
ENG-23840 restored the credential path on 2026-07-11–12. Redeploy and remote
burst/oversize confirmation remain unrun under ENG-23849; they are no longer
blocked on credentials.

## Review hardening (2026-07-07, ENG-23574–ENG-23593)

The review of the as-built proof surfaced a batch of correctness and security
gaps; all are fixed and regression-pinned by the Miniflare acceptance suite:

- **Admin surface** (ENG-23587): `/reset` and `/evict` are POST-only and
  gated on a `SNAPBACK_ADMIN_TOKEN` shared secret (the `/host-call` token
  pattern), failing closed when no token is configured. `deploy.sh` sets the
  secret from the environment; the handler Worker carries
  `workers_dev: false` so `/invoke` has no public route.
- **Isolation honesty** (ENG-23575): Durable Objects interleave requests at
  awaits, so every invocation-bearing entry point (query, mutation,
  subscribe) is serialized behind a coordinator-local mutex; `/host-call`
  stays outside it. The manifest now claims
  `coordinator-serialized-invocations`, not the local target's
  read-set-validation mode (captured reads are recorded, not yet validated).
- **Version contract** (ENG-23583): the commit advances `_snapback_version`
  only when the effective changeset is non-empty — patches on missing rows,
  empty-values patches, and deletes of missing rows are commit no-ops,
  matching `crates/snapback/src/storage.rs`.
- **Fan-out delivery** (ENG-23576): `fanOut` is awaited by the mutation
  response; floating post-response work is not a delivery contract on real
  Workers. Push failures are diagnostics, never mutation failures.
- **Host-op parity** (ENG-23582): the JS op table now mirrors
  `crates/snapback/src/runtime.rs` point-for-point — patch-on-missing stays a miss, query
  overlays re-fetch full stored rows, the overlay stamps the frozen handler
  clock, and point reads are captured on patch/delete.
- **Schema boundary** (ENG-23578): handler-provided table names pass a
  manifest-derived allowlist (plus identifier gate) before reaching SQL
  identifier position; field names are identifier-gated in `fieldExpr`;
  every value rides a bind parameter. Unknown tables fail with
  `SNAPBACK_UNKNOWN_TABLE`; manifest-declared fields and indexes are enforced
  with dedicated unknown-field/index diagnostics.
- **Envelope taxonomy** (ENG-23586): the coordinator decodes handler
  envelopes through the shared `packages/snapback-harness/envelope.mjs`,
  which mirrors `handler_envelope_code` in `crates/snapback/src/runtime.rs`, and fails
  closed when the harness reports `rejectionDetectionSupported: false` —
  the same refusal as `crates/snapback/src/workerd_exec.rs`. Rejection reasons ride
  `details.rejections`.
- **Platform-limit envelopes** (ENG-23849): row JSON is byte-checked against
  the generated capability manifest's `runtimeFacts.maxRowBytes` inside the
  same transaction as rows/version/journal, so rejection rolls every staged
  write back. The invocation mutex no longer retains an eternal cross-request
  Promise chain: it starts directly in a fresh request context when idle and
  caps pending work at 16, below Workers' 32-invocation service-binding chain
  limit. Excess work returns `SNAPBACK_OVERLOADED` with retry/backoff details;
  oversized writes return `SNAPBACK_VALUE_TOO_LARGE` with actual and limit
  bytes. Gateway and coordinator classify platform exceptions through one
  shared boundary, while unrelated handler failures still fail as handler
  failures.

## Whole-codebase review hardening (2026-07-12, ENG-24341–ENG-24369 / ENG-24387–ENG-24388)

The second review treated the proof as a hosted system rather than only a
demonstration path. The resulting contracts are now executable regressions:

- `/app/ensure` never consumes caller seed bytes. Production initialization
  requires the compiled client-manifest identity and always applies the
  compiled seed; an adversarial clean-object race cannot pre-seed or block the
  legitimate initializer.
- Inserts, patches, seeds, and derived writes share manifest validation for
  required/type/unknown/protected-system-field rules. Declared expression
  indexes are definition-reconciled (fields/order/uniqueness, not name-only)
  and `withIndex` is validated; identity is checked before app DDL, internal
  subscription selection is indexed. Fan-out now selects every live-query
  function conservatively, then uses bounded indexed queries to fetch only
  functions with active durable subscriptions and groups equal
  function/argument shapes into one re-query. This deliberately pays
  false-positive delivery work rather than letting an incomplete declaration
  suppress an update; captured-read persistence may recover precision later
  without changing the correctness rule.
- Every JSON body streams through one bounded, fatal-UTF-8 object parser. The
  gateway no longer buffers an unbounded body first, and syntax, media type,
  empty body, shape, UTF-8, and size failures return stable 4xx diagnostics
  without invoking handlers.
- Action timeouts own an abandonment flag that fences every later host call and
  the final nested-mutation commit. Testing actions and override arguments are
  absent from the production dispatch surface, public actions have bounded
  admission, and function kind is checked at every route/nested boundary. App
  reset advances a generation, aborts active action fetches, and checks the
  generation again at each nested commit.
- Secret handles carry immutable invocation-scoped opaque ids. Host fetch
  resolves only the current action's private capability map, never returns a
  substituted URL, bounds upstream bodies, and scrubs raw, normalized,
  URL/form-encoded (including double encoding), and full/partial JSON Unicode
  escapes across mixed-case BMP and astral encodings.
- Cron claims distinguish terminal results from live leases. Expired claims
  recover, and scheduled nested-mutation results are recorded atomically with
  the app commit under the stable claim key, closing the
  commit-before-claim-finish double-commit window. The strict-next nominal math
  is pinned at exact boundaries and after long downtime. Admin manual run-now
  remains a one-shot action and allocates no recoverable claim/replay rows;
  scheduled/manual completions also generation-check reset before recreating
  any finish/last-run/nominal state.
- Subscription schema migration is versioned and transactional, so current
  wakes do no rewrite, and legacy rows are bounds-checked before any migration
  copy. Kit sockets have durable session ids: only the newest overlapping
  socket receives frames, and reconnect proactively closes obsolete physical
  sockets without letting close lag soften the per-connection or global cap.
  An over-limit hibernation registry inherited from an older deployment is
  closed in full and produces a recoverable structured refusal until drained.
  HTTP subscribe requires a current socket, every row/message/demand check is
  session-bound, and old socketless migration rows are reaped. Subscription
  row count, per-connection rows, canonical argument bytes, legacy proof
  sockets, per-grant sockets, and total sockets all have exact advertised hard
  ceilings; persistence rechecks admission at its transaction boundary.
  Hosted grants use route-safe bounded ids, a hard durable cap, and an idle
  lease. Query-string WebSocket credentials are refused; subprotocol and
  explicit-header transport remain.
- Reset validates first and clears rows/version/journal/runtime metadata/seed
  in one transaction. That commit is the response linearization point;
  recoverable post-commit alarm cleanup cannot produce a false rollback 500.
  It rebuilds the known current system/app schema, removes retired owned
  `app_*` tables, and remains reachable after stale deployment metadata,
  index-build failure, or an unknown future subscription version.
- Deployment identities come from esbuild's transitive gateway/handler input
  graph plus normalized Wrangler compatibility/binding configs. The generated
  identity gate therefore changes with Cloudflare-only handler, schema, host
  contract, or compatibility edits. Mixed-state bootstrap touches only
  confirmed-missing Workers and re-probes attempted failures to prove their
  absence. Existing workers snapshot their full active traffic set and restore
  it on any later failure, with the gateway as the final compatibility
  cutover. Admin secret writes are activations, so the final binding/health
  proof runs after them; admin state is reported only as verified absent,
  verified/preserved present, or unknown. Wrangler caches are ignored and
  rejected by the compatibility/hygiene gate. `/health` carries Cloudflare's
  platform-issued Worker version id. The controller parses the exact `Current
  Version ID` from each gateway deploy and waits for that id—not merely any
  changed id—to own 100% traffic before probing it. Legacy secret commands do
  not return an authoritative version id, so a real secret mutation is followed
  by one final gateway deploy whose reported id is activated and probed. An
  older or concurrently deployed healthy full-binding version cannot commit
  the deploy.

## Fresh-review proof hardening (2026-07-12, ENG-24498–ENG-24501)

- The canonical local proof now invokes one manifest-driven Cloudflare runner.
  It pins an exact set of suite ids and completion checks and explicitly
  classifies every Cloudflare test file; remote evidence, measurement-only
  scripts, helpers, and the conformance child protocol remain named outside the
  non-remote gate.
- Deploy and guided config mutation resolve only the exact Wrangler version
  named by the committed Cloudflare pin and `bun.lock`, installed under this
  repository. The preflight runs before any remote mutation or secret stdin;
  `npx` and ambient executables are absent from those paths.
- Config status reads and the Wrangler child share one overall deadline.
  Never-responding HTTP and a hung child produce stable unknown/pending
  diagnostics with recovery guidance rather than exceeding the advertised
  timeout.
- Cloudflare cron completion terminalizes the claim, writes the last-run
  summary, advances the nominal, and prunes terminal history in one Durable
  Object SQLite transaction. A new post-terminal fault proves rollback and
  recovery without a duplicate app commit or missing summary.

### Proof-runtime preflight (2026-07-14, ENG-24454)

The Miniflare surface is validated only on the Node major pinned in
`.node-version` (currently 24.x; the exact patch is the ENG-24513 authority). On
an unsupported major — observed on Node 25.9.0 — the first real-loopback
`/action/refreshFeed` request in `acceptance.security-hardening.mjs`
intermittently fails with `read ECONNRESET`. That is a Miniflare/Node
transport-lifecycle race, not an action-semantic failure, and it must not be
papered over: an action retry would hide a genuine transport regression behind
the same code path.

The local proof therefore preflights its runtime rather than fixing the
transport (the deeper fix is upstream-shaped and out of scope here):

- `cloudflare/test/proof-runtime.mjs` compares the active Node major against the
  `.node-version` major (read, never hardcoded) and, on a mismatch, fails closed
  with `SNAPBACK_CLOUDFLARE_PROOF_NODE_UNSUPPORTED` and an actionable diagnostic
  directing the runner to the pinned Node. Support is exact-major equality;
  patch/minor drift stays the separate concern of
  `scripts/check-toolchain-authority.mjs`.
- `startProof` (harness) calls the preflight before standing up Miniflare, so a
  directly-run suite refuses closed instead of resetting mid-proof.
  `local-suite.mjs` runs it once up front so the whole gate refuses with one
  diagnostic before spawning any child on the same interpreter.
- `proof-runtime-preflight.mjs` is a gate suite that unit-tests the
  version-comparison logic and diagnostic with injected version strings, so the
  logic is asserted independent of the interpreter it runs under. The manifest's
  pinned suite count moves from 19 to 20. `package.json` `engines.node` declares
  `24.x` as a compatibility signal, not the CI authority.

The pinned Node 24.18.0 runtime also exposed a narrower local-client race in
the protocol-hardening matrix. The parser correctly rejects a declared 4.1 MB
body from `Content-Length` before reading the upload, but the real-loopback
Node client can still be writing that body when workerd returns 413 and closes
the request. Reading the already-started response then intermittently fails
with `EPIPE` or `ECONNRESET` instead of exposing the JSON diagnostic. The
oversized-upload cases now use Node's HTTP client with the exact declared
length and `Expect: 100-continue`: they send only headers, require workerd's
final 413, and fail if the server asks them to begin uploading. This retains
the real-loopback Content-Length fast path and is not a retry. Production keeps
the bounded early rejection, the exact diagnostic and no-side-effect
assertions are unchanged, and any first transport failure still fails the
proof.

## Dated amendment: compiled versioned-seed identity (2026-08-03, LLP 0109 acceptance)

Accepted LLP 0109 (author acceptance 2026-08-03, decision sitting #2
extension, `issues/20260803-author-decision-sitting-2.md`) extends this
proof's compiled-seed invariant to versioned artifact identity. On hosted
targets the rule above — `/app/ensure` never consumes caller seed bytes —
remains authoritative for versioned installation: caller bytes may *attest*
the requested `(appId, seedVersion, seedDigest)` identity but are never the
production write source. The clean compiled release contains one
`SeedArtifactV1`; the coordinator recomputes and requires exact
app/version/digest/table identity, then applies only those compiled bytes.
Malicious or mismatched caller content, release rollback, and a concurrent
clean-object race refuse without falling back to caller or legacy seed.

As of this amendment the hosted arm implements none of the versioned
family: it is the conformance manifest's one declared machine-readable GAP
row (`tests/conformance/versioned-seed-v1.manifest.json`) and must not
advertise `versioned_seed_install_v1` or `versioned_seed_reset_v1` until
every applicable matrix row passes (LLP 0109 §15.5/§16.6). The hosted
`kitEnsureApp` deploy-identity-compare + seed-if-empty behavior recorded by
LLP 0094 is unchanged.

## Status

Draft (as-built sections landed 2026-07-07; review-hardening batch
ENG-23574–ENG-23593 the same day; real-Cloudflare evidence run 2026-07-08,
ENG-23640; percentile/max-subscribers/contention report landed 2026-07-09,
ENG-23713 → [LLP 0050](./0050-cloudflare-proof-remote-benchmarks.research.md)).
The behavioral proof is complete under the Miniflare regression surface, the
decisive real-Cloudflare evidence is recorded in §Real-Cloudflare evidence
(genuine platform eviction observed and survived with the Hibernation API in
use; per-script observed-zero estimates over both idle windows), and the measurement
checklist is now fully populated. **Every §Acceptance bullet has recorded
evidence; moving this document to Accepted is the author's ratification
call.** Residue tracked outside the checklist is reconciled as of 2026-07-12:
ENG-23840 restored the account/API and safely persisted admin credential paths;
ENG-23841 completed the deliberate All Aboard no-subscriber window with direct
idle-to-zero evidence (an LLP 0028/0049 claim, not part of this proof's
acceptance); and ENG-23849's two diagnostics gaps remain locally
regression-pinned while their deployed burst/oversize confirmation is unrun.

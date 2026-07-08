# LLP 0040: Cloudflare narrow proof

**Type:** RFC
**Status:** Draft
**Systems:** Deployment, Runtime, Storage, Sync, Realtime, Security, Developer experience, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-07
**Revised:** 2026-07-07 (seventh revision same day, ENG-23628 / LLP 0049
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
**Related:** LLP 0000, LLP 0003, LLP 0007, LLP 0008, LLP 0009, LLP 0010, LLP 0014, LLP 0018, LLP 0028, LLP 0032, LLP 0035, LLP 0038, LLP 0046, LLP 0047, LLP 0048, LLP 0049

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
- Server-held sockets use the WebSocket Hibernation API, and the
  connected-idle window accrues no duration charges on the billing counters.
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

## As-built (2026-07-07)

The proof is built and passes its full behavioral checklist under the local
Miniflare surrogate; the decisive real-Cloudflare evidence is staged but
**not yet run — the repo owner's Cloudflare API token is expired**, so idle
economics, real eviction, cold start, placement, and billing counters remain
pending a fresh token. What landed in `cloudflare/`:

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
  (emitted by `src/bin/snapback-cf-manifest.rs`) serves
  `cloudflare-do-sqlite-v8`, validates against the generated JSON Schema, and
  names the missing features honestly — `code_hot_load` (deploy-time bundling,
  no runtime eval), ephemeral realtime, cron, external auth, assets,
  notifications, offline replay, retained-version resume, multi-app, and
  hosted marketplace.
- **Acceptance + measurements.** `cloudflare/test/acceptance.mjs` (Miniflare)
  passes **16/16**: query, mutate, subscribe, disconnect, resubscribe;
  snapshot-before-delta ordering; gap-free versions; the on-target ambient
  denial; push-from-commit live delivery; and the eviction-surrogate
  rehydration path. `cloudflare/test/measure.mjs` records mutation, snapshot,
  live-update, and fan-out latency next to each benchmark fixture (all
  Miniflare-local, explicitly non-comparable to LLP 0035 and to real
  Cloudflare). A checked-in `deploy.sh` deploys both Workers with one command,
  `scripts/cf-check-compat` guards the single-sourced compat pins, and
  `cloudflare/test/acceptance.remote.mjs` is the staged real-Cloudflare runner
  that produces the deploy-only evidence (idle-window billing, real eviction)
  once a token is available.

**Open against the accepted-proof checklist:** the accepted proof requires at
least one real-Cloudflare eviction run and the two idle-window billing
counters, measured with the Hibernation API in use. Those are the items the
Miniflare surrogate structurally cannot produce (§Measurements evidence
split); they gate on a valid API token, not on further build work. Everything
else on the checklist is demonstrated locally.

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
  matching `src/storage.rs`.
- **Fan-out delivery** (ENG-23576): `fanOut` is awaited by the mutation
  response; floating post-response work is not a delivery contract on real
  Workers. Push failures are diagnostics, never mutation failures.
- **Host-op parity** (ENG-23582): the JS op table now mirrors
  `src/runtime.rs` point-for-point — patch-on-missing stays a miss, query
  overlays re-fetch full stored rows, the overlay stamps the frozen handler
  clock, and point reads are captured on patch/delete.
- **Schema boundary** (ENG-23578): handler-provided table names pass a
  manifest-derived allowlist (plus identifier gate) before reaching SQL
  identifier position; field names are identifier-gated in `fieldExpr`;
  every value rides a bind parameter. Unknown tables fail with
  `SNAPBACK_HANDLER_HOST_CALL_INVALID`.
- **Envelope taxonomy** (ENG-23586): the coordinator decodes handler
  envelopes through the shared `packages/snapback-harness/envelope.mjs`,
  which mirrors `handler_envelope_code` in `src/runtime.rs`, and fails
  closed when the harness reports `rejectionDetectionSupported: false` —
  the same refusal as `src/workerd_exec.rs`. Rejection reasons ride
  `details.rejections`.

## Status

Draft (as-built sections landed 2026-07-07; review-hardening batch
ENG-23574–ENG-23593 landed the same day). The behavioral proof is complete
under the Miniflare regression surface and deploy-ready; acceptance as a
*proof* awaits the real-Cloudflare eviction and idle-billing runs, which are
blocked only on a valid Cloudflare API token.

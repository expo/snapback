# LLP 0050: Cloudflare proof remote benchmarks

**Type:** Research
**Status:** Draft
**Systems:** Deployment, Runtime, Storage, Realtime, Performance, Testing
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-09
**Revised:** 2026-07-11 (ENG-23840 restored the Cloudflare account/admin
credential paths; ENG-23841 recorded direct All Aboard no-subscriber
idle-to-zero evidence as a settled observed-zero estimate with non-zero
controls and an explicit Adaptive-sampling limit;
ENG-23849's deployed platform-limit confirmation remains unrun); 2026-07-09
(ENG-23849 local platform-limit hardening)
**Related:** LLP 0014, LLP 0028, LLP 0035, LLP 0040, LLP 0048, LLP 0049

## Summary

This is the percentile benchmark report [LLP 0040](./0040-cloudflare-narrow-proof.rfc.md)
§Measurements requires for the accepted proof: client-timed latency
distributions for mutation, initial snapshot, live update, and
reconnect/resubscribe against the **real** deployed notes proof
(`snapback-notes-proof`), plus the maximum-practical-subscribers ladder and
the storage/overload contention probes. The runner is
`cloudflare/test/measure.remote.mjs`; the fixture-bearing artifacts are
`cloudflare/generated/measurements.remote.2026-07-09.json` (run 1) and
`…/measurements.remote.followups.2026-07-09.jsonl` (the gentle-pacing
ladder, the 64-way burst, and the oversized-value failure shape).

**Headlines.** Against a p50 network floor of ~56 ms (client SF Bay Area →
SJC colo): a V8 mutation commits in **p50 93 ms / p95 103 ms** (~37 ms over
the floor), a 100-row authoritative snapshot arrives **p50 90 ms** after
subscribe on an open socket, a committed mutation reaches a live subscriber
in **p50 103 ms** end to end, and a full client reconnect (new WebSocket +
subscribe + resnapshot) costs **p50 219 ms**. Fan-out is effectively flat
through **400 concurrent hibernating subscribers** — per-socket delivery
p95 154 ms at 25, 155 ms at 100, **191 ms at 400**, zero losses — so the
single client, not the coordinator, is where this measurement stopped; the
single-authority bottleneck LLP 0040 §Target shape reserved judgment for
did not appear at this scale. The failure modes live elsewhere: under
concurrent mutation *bursts* the coordinator stays correct (unique,
gap-free versions) but sheds load hard — 3/32 at 32-way, **42/64 at
64-way** — with `SNAPBACK_HANDLER_FAILED: "Subrequest depth limit
exceeded"` (a Workers platform limit surfacing through the
gateway→coordinator→handler chain), and oversized-value writes above the
platform's 2 MB cap fail as an **unstructured Cloudflare HTML 500**, not a
`SNAPBACK_*` envelope (the coordinator survives; objectBoot unchanged).
Both filed as ENG-23849.

## Method

Per LLP 0040 §Measurements: all timing is client-side `performance.now()`
around real network calls (same-turn synchronous deltas inside the object
are not valid measurements on Workers); percentiles over stated-n samples;
every number sits next to its benchmark fixture; numbers are
network-inclusive and region-dependent, **not comparable** to
[LLP 0035](./0035-local-target-benchmarks.research.md) (in-process) nor to
`measure.mjs` (Miniflare-local, no placement/cold-start signal).

- **Deployment:** `https://snapback-notes-proof.ccheever-0f6.workers.dev`,
  the LLP 0040 pinned regression fixture (notes app, V8 handler isolate,
  hibernating WebSockets, coordinator-serialized invocations), deployed rev
  of 2026-07-09 01:30Z.
- **Client:** single Node v25 process, San Francisco Bay Area
  residential/dev network, macOS arm64; edge colo observed via `cf-ray`:
  **SJC**. Run window 2026-07-09 07:21–07:22Z, warm deployment (no
  cold-start claim in this report; LLP 0040 §Real-Cloudflare evidence
  carries the 53 ms cold-start sample).
- **Fixture posture:** fresh per-run boards (`bench-<runId>` …) — no
  `/reset` (the admin token was unavailable, see §Credential caveat), so the
  run accretes rows on the fixture deployment and states each metric's row
  counts explicitly. Sample sizes: mutation n=100, snapshot n=50, live n=50,
  reconnect n=30, health floor n=30.

## Latency distributions (2026-07-09, run `ilqlnx`)

| metric | fixture | p50 | p90 | p95 | p99 | max | n |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| HTTP round-trip floor | `GET /health`, no storage touch | 55.9 | 66.4 | 168.8 | 249.3 | 250.6 | 30 |
| Mutation | `addNote` (V8, 1 insert, sequential) | 93.3 | 100.3 | 102.8 | 170.2 | 224.9 | 100 |
| Initial snapshot | `listNotes eq boardId`, 100 rows, subscribe on open socket | 89.8 | 174.7 | 213.9 | 238.7 | 242.2 | 50 |
| Live update | commit → `live_replace`, 1 subscriber, 20→70 rows | 102.6 | 114.8 | 136.3 | 161.9 | 173.9 | 50 |
| Reconnect (total) | new WS + subscribe + resnapshot, 100 rows | 218.9 | 324.6 | 464.0 | 661.0 | 720.3 | 30 |
| … ws connect leg | | 129.6 | 143.8 | 289.5 | 570.2 | 636.5 | 30 |
| … subscribe→snapshot leg | | 91.5 | 114.4 | 172.5 | 231.7 | 255.7 | 30 |

All values ms. Notes:

- The mutation path costs ~37 ms over the network floor at p50 — gateway →
  coordinator DO → handler isolate RPC → one-transaction commit → response.
- `live_replace` re-sends the full supported subset; growing the board
  20→70 rows across the run moved the metric's halves by ~2 ms (first-half
  p50 101.1, second-half 105.5), i.e. payload growth is visible but minor at
  this snapshot size.
- Reconnect is dominated by WebSocket establishment (p50 ~130 ms), not the
  resnapshot (p50 ~91 ms — indistinguishable from a fresh subscribe). This
  is the structured-resnapshot path the acceptance suite pins; retained-version
  resume stays a declared capability gap (LLP 0040 §Acceptance).

## Maximum practical subscribers (supported query shape)

Criterion, stated up front: the largest ladder rung with **zero**
connect/subscribe/delivery failures and per-socket delivery p95 ≤ 2000 ms;
single client process, connect concurrency 25, delivery timeout 30 s.
Fixture: `listNotes` on a 1-row board; one broadcast mutation per rung.

| subscribers | connected | connect failures | delivery p50 | delivery p95 | all delivered |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 0 | 152.6 | 152.6 | 152.6 |
| 10 | 10 | 0 | 145.1 | 146.6 | 147.7 |
| 25 | 25 | 0 | 152.0 | 153.7 | 162.7 |
| 50 | 45 | 5 | 664.4 | 666.3 | 671.0 |

On this first pass only the 25-rung passed the stated criterion — but the
50-rung's failures were a **client artifact**, proven by a rerun with
connect concurrency 8 instead of 25 (fresh board, same deployment, same
one-mutation-per-rung fixture):

| subscribers (gentle pacing) | connected | connect errors | delivery p50 | delivery p95 | delivery max | lost |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 50 | 50 | 0 | 150 | 150 | 152 | 0 |
| 100 | 100 | 0 | 153 | 155 | 155 | 0 |
| 200 | 200 | 0 | 177 | 179 | 204 | 0 |
| 400 | 400 | 0 | 188 | 191 | 196 | 0 |

**Result: ≥ 400 subscribers** meet the criterion once the client connects at
a civilized pace; per-socket delivery grows only ~40 ms from 50→400
(≈0.1 ms/socket of visible per-send cost), and the run-1 "4.4× step at 50"
disappears entirely — it was contention with the client's own in-flight
connect storm, not server fan-out cost. The coordinator's practical
subscriber ceiling for this query shape was **not reached** by a single
client process at 400 sockets; pushing further needs a multi-client rig
(noted as an open extension, not a gap in this report's claim). Labeled per
LLP 0040 §Measurements: evidence for the supported single-table query
subset only, never a general Cloudflare fan-out claim.

## Contention and overload probes

- **Concurrent mutation burst (`addNote`):** at 32-way, wall clock 1155 ms;
  per-mutation p50 629 ms / p95 1133 ms (queueing behind
  `coordinator-serialized-invocations`); committed versions stayed **unique
  and gap-free** (span 614→642) and 3/32 invocations failed. A 64-way
  follow-up shed **42/64**, every failure the stable outer code
  `SNAPBACK_HANDLER_FAILED` with the platform message *"Subrequest depth
  limit exceeded. This request recursed through Workers too many times"* —
  the gateway→coordinator→handler chain hits a Workers platform limit under
  parallel load (mechanism worth investigating: parallel, not recursive,
  requests should not deepen a chain). Correctness held again (span
  662→683, gap-free for the 22 commits). The code carries no
  overload/retryable discrimination — ENG-23849.
- **Oversized value (platform 2 MB per-value cap):** a **1 MB** string field
  commits fine (558 ms, version advanced). A **2.5 MB** value fails as
  **HTTP 500 `text/html`** — the raw Cloudflare error page, a JSON parse
  failure at the client, not a structured `SNAPBACK_*` envelope. The
  coordinator does **not** restart (`/health` objectBoot identical before
  and after), so this is an unhandled error path, not a crash — ENG-23849.
- The app subset has no multi-row mutation handler, so statement-cap /
  row-scan contention beyond the above is not exercisable against the pinned
  fixture without a redeploy; noted as a declared fixture limit rather than
  measured silence.

## Diagnostics gaps filed

Both in **ENG-23849**:

1. Oversized writes should fail closed with a stable `SNAPBACK_*` code (the
   gateway/coordinator should map the platform limit to the envelope
   taxonomy of LLP 0040 §Review hardening) instead of the raw HTML 500.
2. Burst-shed `SNAPBACK_HANDLER_FAILED` responses carry no
   retryable/overload discrimination — a caller cannot tell "back off and
   retry" from "your handler is broken" — and the subrequest-depth
   mechanism under parallel load deserves an investigation of its own.

### ENG-23849 local hardening follow-up (2026-07-09)

The code-side follow-up is implemented and regression-pinned without
rewriting the historical remote observations above:

- the commit path serializes each prospective row once, measures its UTF-8
  bytes against the capability manifest's `runtimeFacts.maxRowBytes`, and
  throws a typed `SNAPBACK_VALUE_TOO_LARGE` from inside the existing
  row/version/journal transaction. The proof protocol returns JSON with the
  platform, 2 MB limit, actual bytes, and `retryable: false`; the kit protocol
  returns the same diagnostic with HTTP 413. The acceptance test proves the
  version does not advance and the next valid mutation succeeds;
- the coordinator's serialized-invocation tail now returns to `null` when the
  queue drains, so the next request begins in its own request context instead
  of extending an eternal Promise lineage. Admission is bounded at 16 pending
  invocations (below Workers' documented 32-invocation service-binding chain
  limit); excess work receives `SNAPBACK_OVERLOADED`, HTTP 503 on the kit
  wire, `retryable: true`, and explicit backoff details;
- gateway, coordinator, and handler-return paths share one Cloudflare
  platform classifier. The measured *"Subrequest depth limit exceeded"*
  message maps to overload, while an unrelated app exception remains
  `SNAPBACK_HANDLER_FAILED`.

Local evidence: `node cloudflare/test/acceptance.mjs` passes **50/50**. Its
32-way burst commits a gap-free subset and classifies every shed request as
retryable admission overload; deterministic proof/kit saturation seams pin
both envelope shapes. Per LLP 0040's evidence split, Miniflare cannot prove
the real service-binding depth behavior. A deployed 32/64-way burst plus
1 MB/2.5 MB value rerun is still required. ENG-23840 restored deploy and
admin credentials on 2026-07-11–12, so the ENG-23849 remote confirmation is
now unrun residue rather than credential-blocked; the old remote
distributions above remain the only real-platform observation.

## Credential caveat (2026-07-09)

This run used only the public surface: the Cloudflare API token on this
machine was revoked/expired and the last `SNAPBACK_ADMIN_TOKEN` rotation was
not persisted (ENG-23840), so `/reset` (fixture cleanup), forced `/evict`
legs, and **all analytics/billing reads** were unavailable. The idle-window
billing evidence recorded in LLP 0040 §Real-Cloudflare evidence (2026-07-08)
is unaffected; the deliberate All Aboard no-subscriber window remains open
as ENG-23841 (this session observed `demand: 4` — the deployment was watched
throughout, the same "watched app is never idle" condition diary 0012
recorded).

That paragraph remains a dated fact about the 2026-07-09 benchmark run. It is
not the current operator state: ENG-23840 restored an active Cloudflare
account token with Workers and account-analytics access on 2026-07-11–12, and
one safely persisted admin token passed the admin gates on both deployed proof
gateways. The credential value and its persistence path are intentionally not
part of this report.

## All Aboard no-subscriber idle evidence (2026-07-11–12)

ENG-23841 supplies the direct All Aboard evidence that the 2026-07-09 caveat
left open. The
[machine-readable record](../cloudflare/generated/measurements.remote.idle.2026-07-12.json)
pins the deployed Worker version IDs, reset and liveness witnesses, raw rows,
sampling probe, and non-secret collection templates; the source commit was not
retained by the deployed-version listing and is explicitly unknown. Recompute
its timing, totals, controls, and caveats with
`node cloudflare/test/validate-idle-measurement.mjs`.

- **Demand was absent at every retained observation.** Five status observations from
  `2026-07-11T23:32:13Z` through `23:32:44Z` all reported zero demand; the
  final observation defines the disarm boundary. The post-window observation
  at `2026-07-12T01:39:47Z` reported
  `inactive:no-demand`, demand `0`, `nextRun: null`, and `lastRun: null`.
- **The pure idle interval settled to an observed-zero estimate.** The controls
  read at `2026-07-12T02:28:06Z` and the final quiet re-read at
  `2026-07-12T02:43:38Z`, comfortably after the interval ended, covered
  `2026-07-11T23:37:44Z`–`2026-07-12T01:37:44Z` and returned `errors: []`.
  Its raw `workersInvocations`, `durableObjectInvocations`,
  `durableObjectPeriodic`, and `durableObjectStorage` arrays were all empty.
  The request-dataset summaries were **0 estimated Worker requests, 0 estimated Worker
  execution GB-s, and 0 estimated Durable Object requests**; the account-wide
  periodic query observed 0 µs of Durable Object active time.
- **Controls prove the read path.** The pre-window control recorded **11
  Worker requests, 0.240013125 GB-s, and 2,675 estimated Durable Object requests**;
  the post-window control recorded **3 Worker requests, 0.2347815 GB-s, and
  245 estimated Durable Object requests** in Cloudflare's
  `durableObjectsInvocationsAdaptiveGroups` dataset. Across the
  script-attributed dataset union, the
  controls represent all three deployed All Aboard scripts: gateway, handler,
  and action handler. Worker rows covered the gateway; the Durable Object
  request rows supplied the other script identities.

Cloudflare's analytics datasets are sparse: a settled zero-usage interval can
be represented by no rows, not rows whose sums are explicit zeroes. The empty
quiet arrays therefore become evidence only together with `errors: []`, the
non-zero controls on both sides, the post-window scheduler state, and all-three-
script coverage across the appropriate dataset union. The two request datasets
are Adaptive: [Cloudflare documents that Adaptive GraphQL nodes may use
adaptive sampling](https://developers.cloudflare.com/analytics/graphql-api/sampling/).
The quiet interval emitted no rows and therefore no `sampleInterval` or
confidence value; it supports a controlled observed-zero estimate, not an
absolute assertion that no event occurred or an invoice guarantee. A
supplemental control probe retained `avg.sampleInterval`: Worker rows were 1,
handler/action-handler Durable Object rows were 1, and gateway Durable Object
rows were approximately 1.73 before and 1.61 after the window.

Worker and Durable Object request rows carry script identity.
`durableObjectsPeriodicGroups`
and `durableObjectsStorageGroups` do not, so those arrays are account-wide;
their emptiness is account-wide silence for the interval, not attribution to
one script. The periodic array supports the account-wide observed 0 µs active
time. Storage had no positive row before, during, or after the interval, so its
empty array is telemetry absence only — it does **not** establish zero stored
bytes, zero storage usage, or deletion of the deployment's durable data. This
is direct evidence for LLP 0049's demand-armed All Aboard
shape and closes ENG-23841; it does not broaden LLP 0040's notes-proof
acceptance claim.

## Status

Draft (initial numbers and ENG-23849 local hardening 2026-07-09; ENG-23840
credential restoration and ENG-23841 All Aboard idle evidence 2026-07-11–12).
This report
closes the percentile benchmark, max-practical-subscribers, and
contention/overload items that LLP 0040 §Status listed as separating the proof
from acceptance; whether the proof is now **Accepted** is the author's
ratification call on LLP 0040 itself. The structured-limit fix is locally
verified but its ENG-23849 remote confirmation remains unrun; ENG-23840 has
removed the credential blocker.

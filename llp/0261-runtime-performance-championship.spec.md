# LLP 0261: Runtime performance championship contract

**Type:** Spec
**Status:** Draft
**Systems:** Performance, Benchmarks, Live queries, Local-first sync, Offline
replay, Auth, Storage, Deployment, Competitive evaluation, Publishing
**Author:** Codex gpt-5.6-sol (commissioned by Charlie Cheever 2026-08-15;
orchestrated by Claude Fable 5)
**Date:** 2026-08-15
**Revised:** 2026-08-15 (v0.2 — two-review revision; reviewers: Codex family
and Grok family)
**Revised:** 2026-08-15 (v0.1 — initial commissioned draft)
**Related:** LLP 0000 (scale-to-zero and scale-up direction), LLP 0186 and
`benchmarks/protocol.md` (agent-authoring instrument whose reusable run norms
are cited here, but whose subject is distinct), LLP 0189 (verification cadence
and claim gating), LLP 0197 (competitive benchmark publication), LLP 0198
(surpass-Convex authoring plan and outstanding claims), LLP 0200 (live
evaluation scheduling and settlement), LLP 0201 (Clique benchmark), LLP 0209
(bounded live graph profile),
`issues/20260808-live-query-reevaluation-cost-at-scale.md`,
`issues/20260809-mutate-stage-turn-cost-bisect.md`,
`demos/zerobugs/control/scripts/run-oq4-arm.sh`,
`demos/zerobugs/control/scripts/run-p1-ab.sh`

## 0. Charter and position

Snapback needs a continuous runtime-performance championship: a versioned
measurement contract that produces latency-versus-throughput curves,
correctness receipts, and comparable cost records across releases, deployment
targets, and competing systems. Its product purpose is to test four separate
parts of the direction in LLP 0000: almost no cost at idle, immediate and
offline client behavior, coherent reactive queries, and a measured graduation
path from the small SQLite target to Postgres and cell-shaped deployment
targets. This document defines the instrument; it does not assert that any of
those comparative claims has been earned.

This is not `benchmarks/protocol.md`. That protocol is LLP 0186 W1's
**agent-authoring bakeoff**: a cold coding agent receives a brief and its wall
clock, tokens, tool use, and correction loops are measured. This Spec measures
the behavior and cost of a running application under offered load. It reuses
the protocol's norms for repetitions, variance honesty, environment pinning,
and one machine record per run; LLP 0197 rule 2 supplies counterbalancing. It
does not reuse the cold context, no-steering, same-brief timing, or token-
accounting construct.
Likewise, LLP 0201 D2's scale replay is a viability gate over an agent-built
Clique artifact under unmatched deployment postures; LLP 0201 expressly says
it is not a comparative speed statistic. The championship is the matched-
posture comparative instrument that work leaves outstanding.

The championship is measured-basis-first:

1. every chart is computed from recorded events and correctness receipts;
2. every latency family has its own start and stop event and is published
   separately;
3. rate-driven offered load is an independent variable, not reconstructed from
   successful throughput, while replay uses a frozen backlog completion axis;
4. durability, authority, result semantics, and convergence obligations are
   equalized before systems are compared; and
5. a number from one configuration is evidence only for that exact
   system/target × region × workload × dataset × authority × observer × load
   cell.

Seven warm samples, one hot-store run, or a settle-gated loop can diagnose a
shape. None is a championship curve or a comparative claim.

## 1. Measured basis and the present instrument boundary

The current evidence is valuable but narrower than this contract.

### 1.1 What is measured today

LLP 0209 §1 records N=1 shape evidence at the 5,549,113-row Zerobugs store.
One auth-scoped 1,000-row-window evaluation measured p50 863 ms and max 3.6 s;
six observers delivered roughly 61–68 MB of replace-frame bytes. Matcher
precision was already high on that inventory, while six same-principal
subscriptions cost approximately the same as six mixed-authority
subscriptions, exposing about 6× same-principal sharing headroom. LLP 0200
§6a records that moving evaluation off the commit turn improved the six-
observer burst but did not meet its original settlement target; evaluation
turn cost and scheduling remained visible. These are dated, N=1 shape facts,
not standing magnitude or competitor claims.

The committed harness does provide a useful seed:

- `run-oq4-arm.sh` creates an APFS clone of the existing 5.5M-row pristine
  database, launches one local Snapback binary, enables client and server
  JSONL traces, and runs `diag-hot-stream.mts`. It admits fixed,
  settle-gated, and sustained arrival modes; observer counts `0`, `1`, or
  `6`; authority partitions `same` or `mixed`; coalescing on/off; an optional
  authority-transition fixture; and additional diagnostic flags.
- `same` creates distinct sessions for the same deterministic `crew-admin`
  principal. `mixed` at six observers is five distinct authenticated actors
  plus one anonymous observer. It is not the three-arm authority matrix in
  §3: in particular, it combines public and per-principal observations in
  one cell.
- The hot diagnostic uses a fixed 16-operation mutation inventory, 1,000-row
  `issueListV2` windows, client-side `performance.now()` events, correlated
  `clientMutationId`s, and final per-observer version observations. The
  sustained default is one attempted mutation every 250 ms for 120 seconds.
- The server trace records the actual Snapback pipeline: a `commit` event
  stamped immediately after storage `COMMIT` returns (today
  `commit_durable_ms == commit_ack_ms`), `handler_result_ready`,
  `http_response_written`, evaluation events, watermark events, matcher
  decisions, coalescing, and authorization fences.
- `analyze-oq4.mts` joins client and server events by mutation identity and
  reports client settle, durable-to-result, durable-to-response, first/last
  observer convergence, evaluation, byte, matcher, coalescer, and authority-
  lane summaries. Its general distribution is min/p50/p90/max; p95 is added
  only for fence and restoration distributions. It does not produce p95/p99
  latency-versus-offered-load curves.
- `run-p1-ab.sh` invokes six serial diagnostic arms: mixed six-observer
  burst coalescing on/off, a zero-observer burst, mixed six-observer
  sustained, zero-observer sustained, and a scheduler-disabled legacy burst.
  It writes ad hoc `/tmp` logs and continues to the remaining arm after an
  arm failure. It is not an N≥3 runner or a schema-valid record publisher.

### 1.2 What does not exist yet

The committed scripts do not provide regional load generators, identical
cross-system fixtures, competitor adapters, observer counts 10/100/1,000,
separate public/same-principal/per-principal cells, the 1K or 100K tiers,
optimistic-render timestamps, reconnect or offline-replay choreography,
open-loop load discovery and frozen load grids, p95/p99 curve publication,
cost collection, idle billing witnesses, N≥3 repetition orchestration, or an
LLP 0189 qualification record. The hard-coded local fixture/overlay custody
and APFS clone mechanism are also not portable to remote generators or
competitor stores.

The championship grows from the current event vocabulary, mutation inventory,
5.5M-row fixture, and correctness oracles. It does not replace them with an
unrelated benchmark. Diagnostic A/B flags remain useful engineering arms but
are not axes in a default competitor chart.

## 2. Metric families and exact clocks

### 2.1 Event identity and clock discipline

Every logical operation receives one collision-resistant `operationId` before
the load generator releases it. The same identity appears in the client
trace, server/provider receipt where available, durable settlement record,
and every observer oracle. A run records these events:

| Event | Definition |
| --- | --- |
| `T0 intent` | The regional generator's monotonic timestamp immediately before it invokes the public client operation. Queue wait inside the generator is excluded only if separately recorded as missed schedule; library, rendering, transport, and backend time are included. |
| `Tpaint` | The first renderer commit visible to the instrumented application in which the operation's exact optimistic effect is present. Reducer completion, state assignment, or a scheduled render is not paint. |
| `Tack` | The system's commit-ack boundary for an applied mutation: the authoritative write and its exactly-once settlement identity, when required by the arm, have crossed the declared durable commit boundary. For current local Snapback this is the `commit` trace stamped immediately after SQLite `COMMIT` returns; the trace currently gives `commit_durable_ms` and `commit_ack_ms` the same value. |
| `Tsettle` | The initiating client receives and publishes the terminal authoritative result or typed refusal. When the arm claims durable client/outbox custody, the stop is the later of response receipt and the atomic local store transition that makes the full result crash-recoverable; queue admission alone never qualifies. |
| `Tconv(o,V)` | The first observer-clock instant after observer `o` processes a subscription watermark `W >= V`, applies all content carried by or ordered before `W` before releasing the optimistic layer, and the semantic oracle confirms that the observer-visible result equals `AuthorizedProjection(o, PostState(W))`. `V` is the mutation's committed version; `W` and the oracle version are retained in the receipt. Content application alone is not a stop event. |

`PostState(W)` is the version-indexed authoritative state produced by
deterministically replaying the adapter's accepted-commit ledger through the
exact system version `W`; `AuthorizedProjection` applies the frozen query and
observer authority effective at `W`. The adapter retains the ledger inputs and
oracle digest needed to recompute that value. Final-run state or a state from
some other version cannot substitute for it.

End-to-end values use generator/observer monotonic clocks. Server-only events
such as `Tack` are projected into the generator epoch only through a recorded
clock-calibration exchange before and after each run. Offset, drift, and the
maximum uncertainty bound are fields in the run record. A point whose clock
uncertainty exceeds the smaller of 1 ms or 5% of the reported latency is
`clock-ineligible` for cross-host ordering; its within-process service legs
may still be diagnostic. No subtraction of unrelated wall clocks is allowed.

Every event records an `observationClass`: `client-observed`,
`documented-provider-receipt`, or `internal-diagnostic`. Cross-system charts
compare a family only when observation classes and durability meanings match.
If a competitor exposes no equivalent commit boundary, `Tack` is unavailable
for diagnostics and that system is ineligible for a claim-bearing mutation
comparison until its public adapter can measure the boundary; `Tack` is never
inferred from a later response. If one public response is both the documented
commit acknowledgement and settlement, both events may have the same observed
timestamp, explicitly, rather than being silently collapsed into one metric.

### 2.2 The four latency families

For an operation issued at `T0`, the championship reports four distinct
families:

1. **Optimistic paint:** `Lpaint = Tpaint - T0`. This is user-perceived local
   immediacy. It is reported only for an operation with a declared optimistic
   projection and a render oracle. A non-optimistic operation is `not-
   applicable`, not an infinite or zero sample.
2. **Commit acknowledgement:** `Lack = Tack - T0`. This is authoritative
   durable acceptance, not HTTP request receipt, local queue custody, handler
   return, or observer delivery. Refusals have no `Tack`; their terminal
   latency is reported in a separate refusal distribution.
3. **Settlement:** `Lsettle = Tsettle - T0`. This is the caller's terminal
   authoritative outcome. The component `Tsettle - Tack` is also reported so
   response serialization, network egress, and durable client consumption do
   not disappear inside the end-to-end number. LLP 0200 §2.1 defines its
   server-side settlement boundary as the mutate response (result or refusal)
   being written to the caller; the client stop here includes the remaining
   transport and any declared durable-consumption cut.
4. **Observer convergence:** `Lconv(o) = Tconv(o,V) - T0`. Each observer is a
   sample with its authority identity retained. For each mutation the record
   also reports `Lconv-all = max_o Lconv(o)`, first-observer convergence, and
   `Tconv(o) - Tsettle`. Per-observer and all-observer distributions are
   separate charts. Per LLP 0200 §2.1 and §2.3, latest-value delivery may elide
   the exact state at `V`: a watermark `W > V` is convergence for `V`, but the
   oracle checks the authorized post-state at exactly `W`, never the post-state
   at `V`. A matcher skip may therefore converge through `current_as_of(W)`.
   Watermark advancement without the version-matched semantic oracle, or an
   oracle match without the watermark, is not convergence.

The four families may correlate and their event ordering is checked, but they
are never substituted for one another. In particular:

- optimistic paint does not prove dispatch, commit, or eventual success;
- a local `queued`/`accepted` result is neither commit acknowledgement nor
  settlement;
- Snapback commit acknowledgement is durable today, but it is not client
  settlement;
- settlement does not imply live delivery after LLP 0200 Phase 1; and
- a frame callback does not prove convergence without its committed version,
  authorization posture, and semantic result.

The record contains the event tuple as well as derived durations. A publisher
must be able to recompute every percentile from it.

### 2.3 Reconnect, offline replay, reads, and censored outcomes

Every mutation-bearing hot-write and offline-replay arm records all four
applicable families. The other workload families add named metrics without
renaming them into one of the four:

- **Indexed reads and bounded joins/windows:** request-to-complete-result
  latency, time to first byte where streaming applies, rows/bytes examined and
  returned, and semantic-oracle success. A live window opened for subsequent
  writes participates in the convergence family; the initial read does not
  fabricate commit or settlement samples.
- **Reconnect:** forced-disconnect-to-transport-ready,
  disconnect-to-resubscription-accepted, and disconnect-to-authoritative-
  convergence at a frozen target version. Reconnect attempts, full-resnapshot
  fallbacks, bytes, and missed obligations are recorded.
- **Offline replay:** the record retains both total user age (`Tevent - T0`)
  and active replay latency from `Treplay-eligible`, the instant the fixed
  offline dwell ends and the client has completed the required resync-to-
  current barrier. Backlog size and original client sequence are fixed arm
  inputs. Optimistic paint is measured at original intent; ack, settlement,
  and convergence are measured both from original intent and from replay
  eligibility. Replay is a fixed-backlog scenario, not an offered-rate curve:
  its reproducible x-axis is elapsed monotonic time since `Treplay-eligible`,
  and its curves show the cumulative count and fraction reaching ack,
  settlement, and required observer convergence. A queued result is never
  called settled.

Timeouts, connection loss, unexpected refusals, wrong results, and missing
observer convergence are first-class outcomes. They remain in success/error
and censoring counts; a timeout is not replaced by the timeout duration in a
successful-latency percentile. Curves always show both latency conditional on
success and the unconditional outcome rate.

## 3. The arm matrix

### 3.1 Full championship axes

The logical matrix is:

`system/target × generator region × load shape × observers × authority × dataset × workload`

The author-required axes are fixed as follows:

| Axis | Required arms |
| --- | --- |
| Load shape | For rate-driven families, a preregistered open-loop grid from low load through overload with at least six nonzero rates. Offline replay instead uses the fixed backlog depth/client count and elapsed-time completion axis defined below. |
| Observer fan-out | 1, 10, 100, and 1,000 observers. A read-only point arm may use 0 and record convergence as not applicable. |
| Authorization shape | `public`, `same-principal`, and `per-principal`. |
| Dataset tier | 1K, 100K, and 5.5M rows; the large tier's canonical count is 5,549,113 unless a successor manifest explicitly supersedes the Zerobugs hot-diag baseline. |
| Workload family | indexed point reads; bounded joins/windows; hot writes; reconnect; offline replay. |

These dimensions are orthogonal in the record even when a scheduled wave runs
only selected cells. Observer count never stands in for authority shape, and
dataset size never stands in for load shape.

The authority arms mean:

- `public`: every query/mutation in the measured path is declared public and
  no authenticated principal is installed;
- `same-principal`: every observer is a distinct client/session for one
  principal and identical canonical arguments; this is the sharing-headroom
  shape measured by the current OQ4 `same` arm; and
- `per-principal`: every observer has a distinct principal and the fixture
  causes at least one result difference per principal. Merely issuing
  different bearer tokens over public or identical results does not qualify.

Each dataset is generated from one deterministic logical manifest with stable
seed, row counts by table, relationship cardinalities, hot-key set, index
definitions, serialized digest, and invariant oracle. Target adapters may use
native bulk loading, but the verified end state and logical indexes must
match. Store size, index-build time, and compaction/analyze state are recorded;
they are not silently charged to request latency.

### 3.2 Workload definitions

The frozen workload manifest supplies exact operations, arguments, result
oracles, and mixes. The v1 families have these bounds:

1. **Indexed point reads:** deterministic pseudorandom keys over the complete
   tier, with a frozen hit/miss ratio and no single hot key dominating the
   cache. The query must use the declared logical index on every system.
2. **Bounded joins/windows:** a stable, cursor-addressed result window with a
   declared maximum of 1,000 root rows and frozen to-one/to-many relation
   bounds. The Zerobugs `issueListV2` shape is the first large-tier seed;
   competitor adapters must return the same logical projection and ordering.
3. **Hot writes:** an open-loop, deterministic mixture of writes that hit and
   miss observed query dependencies, with the triggering partition declared.
   Applied writes form the headline distributions. Expected application
   refusals, if retained as a control, are a separately labeled mix and never
   improve applied-write latency.
4. **Reconnect:** after a steady-state read/write interval, the harness cuts
   the observer transport at a predetermined schedule while writes continue,
   then measures resume versus resnapshot and exact convergence. The cut is at
   the client network boundary, not a graceful unsubscribe.
5. **Offline replay:** clients enter a verified offline state, enqueue a
   frozen backlog (the manifest includes 1/10/100-intent depths and conflict
   placement), remain offline for a fixed dwell, reconnect, resync, and replay
   in client sequence. At the shared `Treplay-eligible` barrier the complete
   backlog becomes eligible at once; the harness imposes no synthetic pacing
   or settle gate, and the public client replay algorithm determines actual
   dispatch concurrency. The record pins client count, per-client backlog,
   ordering, algorithm/version, and dispatch timestamps. Exactly-once
   settlement, typed conflicts, no optimistic flicker, and final observer
   equality are invariant checks.

### 3.3 Minimum viable subset

The full cross-product is not a day-one requirement. It is 180 non-load cells
per system/target/region before load points and repetitions, and demanding it
up front would prevent the instrument from beginning. The **minimum viable
subset (MVS)** is the following selected-cell wave:

| Cell | Workload | Dataset | Authority | Observers |
| --- | --- | ---: | --- | ---: |
| MVS-R1 | indexed point reads | 100K | public | 0 |
| MVS-W1 | bounded 1,000-row window plus hot writes | 5.5M | same-principal | 1 |
| MVS-W2 | bounded 1,000-row window plus hot writes | 5.5M | per-principal | 10 |
| MVS-O1 | offline replay, 100-intent backlog | 1K | same-principal | 1 |

It also includes one idle-cost witness at 1K and one at 5.5M. Each rate-driven
performance cell uses at least six frozen common offered-load points. MVS-O1
is one fixed-backlog scenario: one client, 100 intents, one simultaneous
eligibility barrier, and settlement/convergence completion curves over elapsed
time; it is exempt from the rate grid. Every cell uses N≥3 independent
repetitions. The MVS runs from one pinned generator region against Snapback and
at least one preregistered comparator. A Snapback-only calibration may precede
it, but is not the MVS and cannot produce a championship claim.

The MVS deliberately postpones reconnect, public hot writes, fan-out 100 and
1,000, same-principal fan-out above one, per-principal fan-out above ten, and
most dataset/workload combinations. Those remain required full-contract rows,
not optional future ideas. The first post-MVS expansion must add reconnect and
the 100-observer hot-write cells; the 1,000-observer arm is a separately
scheduled capacity wave so it cannot make the first useful curve wait.

## 4. Load curves and health

### 4.1 Discover, then freeze rate grids and replay scenarios

A non-claim pilot may range-find each rate-driven workload on the weakest
expected system.
Before claim-bearing repetitions begin, the comparison record freezes one
common offered-load grid for all systems in that cell. The grid is normally
geometric, contains at least six nonzero rates, includes a low-load point, and
continues through at least one unhealthy point. A system-specific higher tail
may be appended, but cross-system ordering uses common points only.

Load generation is open-loop. Operations are released according to the frozen
arrival schedule whether prior operations settled or not. A settle-gated run
is diagnostic and cannot become a throughput curve because it reduces offered
load when the system slows. The record distinguishes scheduled, released,
accepted, committed, settled, converged, refused, failed, timed out, and
dropped counts. Generator lateness and coordinated-omission correction are
reported; a generator that cannot release at least 99% of scheduled operations
within its declared tolerance invalidates the point.

Offline replay is exempt from the offered-rate grid. Before repetitions, the
comparison freezes backlog depth, client count, simultaneous eligibility
barrier, public replay algorithm/version, and drain timeout for each replay
scenario. Each repetition publishes cumulative ack, settlement, convergence,
refusal, failure, and remaining-backlog curves against elapsed time since
`Treplay-eligible`, plus the time to full expected settlement and convergence.

At every rate-driven offered-load point, and for every applicable family, each
repetition reports sample count, p50, p95, and p99. It retains enough raw
events or a mergeable lossless histogram to recompute them. A p99 point with
fewer than 1,000 eligible samples is labeled `insufficient-tail` and cannot
support a p99 descriptive claim; it remains visible. Repetition samples are
not pooled to hide run variance: the chart shows every run's percentile and
the median and range across repetitions. Replay charts likewise show every
repetition rather than pooling completion events.

### 4.2 Healthy p95 and maximum healthy offered load

Every workload manifest preregisters absolute p95 ceilings for each applicable
headline family. The first calibration may propose them; no cost or product
claim may use a ceiling selected after results are visible. LLP 0200's prior
p50 hypotheses are evidence for sizing, not substitutes for these p95
ceilings.

The expected terminal class is fixed by arm before execution. It is the
conjunction of every applicable milestone, not whichever one arrives first:

- an applied optimistic mutation requires `Tpaint`, `Tack`, applied-result
  `Tsettle`, and `Tconv(o,V)` for every required observer; a non-optimistic
  mutation omits only `Tpaint`;
- a manifest-authorized refusal or offline conflict requires the typed
  `Tsettle` and correct optimistic reconciliation, and has no fabricated
  `Tack` or per-operation convergence milestone because it did not commit;
- an initial read requires a complete semantic-oracle match; a live read with
  subsequent writes additionally requires every applicable write convergence;
- reconnect requires transport-ready, resubscription accepted, and
  convergence for every required observer at the frozen target version; and
- offline replay requires the per-intent applied/refusal terminal class above,
  exactly once, followed by full-backlog final-state equality and convergence
  for every required observer.

The manifest may mark a milestone not applicable only by these arm rules; it
may not do so after seeing results. At any claim-bearing arm where convergence
is applicable, one missing `Tconv(o,V)` at the drain deadline makes the
repetition unhealthy. It remains a missing-convergence outcome and is never an
excluded or latency-censored sample.

An offered-load point is **healthy** only when every repetition satisfies all
of the following:

- every applicable p95 is at or below its frozen ceiling;
- at least 99.9% of scheduled operations reach the expected terminal class,
  with zero correctness, authorization, durability, ordering, exactly-once,
  or observer-oracle violations;
- no operation is silently dropped and the generator-release condition holds;
- the pending queue drains within the frozen post-load drain window, with no
  monotonically growing backlog disguised by the measurement cutoff; and
- no timeout, OOM, resync loop, fail-open authority state, or unplanned target
  autoscaling limit changes the configured posture.

A fixed-backlog replay scenario is healthy under the same applicable rules,
with the offered-rate and generator-release clauses omitted: every intent must
reach its expected terminal class exactly once and every required observer and
the final state must converge by the frozen drain deadline. It has no
`lambda*`; failure to finish is the unhealthy result.

`lambda*` is the highest common offered-load point that is healthy. A cost
record calls it a maximum only if the next common point is unhealthy. If the
grid ends while healthy, the result is a lower bound (`lambda* >= x`); if a
higher point becomes healthy again after an unhealthy point, the curve is
unstable and no single maximum is claimed until repeated with a refined grid.

### 4.3 Preregistered cross-system ordering statistic

This Spec freezes the ordering rule; a later claim record records its inputs
and result but does not choose a statistic after seeing them. A latency
ordering always names one family (for example, “faster p95 settlement” or
“faster p95 all-observer convergence”); bare “faster” across mixed families is
not allowed. For rate-driven cells, the primary point is `lambda-order`, the
highest frozen common offered-load point healthy for every compared system.
For fixed-backlog replay, the primary value is elapsed time from
`Treplay-eligible` until every expected settlement and required convergence
has completed. No system-specific tail or alternate favorable point may
replace the primary point.

For systems A and B, pair repetitions by frozen repetition ordinal, schedule
seed, and counterbalance block. For latency, each pair contributes
`r_i = p95_A_i / p95_B_i`; replay uses the analogous ratio of full-completion
times. The point estimate is `median(r_i)`. Its uncertainty interval is the
two-sided 95% percentile interval from 10,000 paired, run-level bootstrap
resamples, using the first 64 bits of
`SHA-256(comparison-manifest-digest || metric-family || primary-point)` as the
random seed. N≥8 valid pairs are required. A may be called faster than B only
when the interval's upper bound is below `0.95`, committing to at least a 5%
reduction after uncertainty. A broad “faster across the healthy range” claim
must pass that same rule at every frozen common point healthy for all compared
systems; otherwise the claim names `lambda-order` and discloses reversals.

## 5. Run mechanics

### 5.1 Regional generators and environment pinning

All systems in a comparison cell are driven by the same immutable generator
image, workload/fixture digests, machine class, client implementation version,
network family, and generator region. Runs are serial within a comparison set;
system order is counterbalanced across repetitions using LLP 0197 rule 2. A
multi-region wave repeats the complete cell
from each predeclared region. Results from different regions are never pooled
into one latency distribution.

The target region, provider, deployment topology, storage class, replication
factor, consistency/durability settings, CPU/memory limits, autoscaling bounds,
connection pooling, runtime/client versions, and all non-secret configuration
are frozen in the run manifest. Generator and target costs are separate. The
generator is overprovisioned and its CPU, memory, event-loop/scheduler lag,
socket errors, and egress are recorded so client saturation cannot be mistaken
for backend saturation.

### 5.2 Warmup and measurement windows

Every point uses a preregistered warmup, measurement, and drain sequence.
Defaults for the first calibration are:

1. restore a fresh verified dataset image and establish the exact observer
   population;
2. run five minutes of the point's offered load, with at least 500 completed
   operations, as warmup;
3. measure for at least ten minutes and until every headline family has 1,000
   eligible samples, subject to a preregistered maximum point duration; and
4. stop arrivals and observe the queue until empty or the frozen drain timeout.

Those defaults apply to rate-driven points. A replay repetition instead
restores the fixture, enqueues the frozen intents during the offline dwell,
performs the resync barrier, starts measurement at `Treplay-eligible`, and
observes until full completion or its frozen drain timeout; no replay is spent
as warmup.

Warmup events are retained and labeled, not deleted. A wave may revise these
defaults after calibration, but freezes the rule before claim runs and applies
it to every system. Cache posture is an explicit configuration: cold-start,
warm process/cold data, and steady-state warm are different cells. No manual
cache priming is allowed outside the declared warmup.

### 5.3 Repetitions, variance, and quiet hosts

N≥3 independent repetitions per complete configuration are required before a
curve can support a published magnitude claim. Each repetition restores the
fixture and deployment state specified by the manifest. Per
`benchmarks/protocol.md`, every constituent value, median, and range is
reported. N≥8 remains the floor for a variance claim, a regression
attribution, or a cross-system ordering such as “faster”; N≥3 may establish
the dated descriptive curve without that stronger language. Cross-system
latency ordering additionally must satisfy §4.3; N≥8 by itself is not an
ordering verdict.

Self-hosted targets run on a dedicated quiet host: no builds, tests, indexing
jobs, backups, interactive browser/simulator work, or other benchmark lanes;
power mode and thermal posture are fixed; background CPU, disk, memory
pressure, and throttling are recorded. The run refuses before warmup when
predeclared host thresholds are exceeded. Managed targets cannot promise a
quiet host; provider status, placement, scaling events, and throttling are
recorded, repetitions are counterbalanced, and an unfavorable run is not
discarded absent a predeclared environment-failure rule.

### 5.4 One record per run

Every repetition writes one schema-valid immutable record plus referenced raw
artifacts. At minimum it contains:

- system/target and published version, source revision for diagnostics,
  deployment manifest, generator image and region;
- complete axis cell, offered-load schedule or fixed replay scenario, workload
  and fixture digests, random seeds, warmup/measurement/drain intervals;
- event/histogram artifacts for all latency families, clock calibration and
  uncertainty, throughput/outcome/backlog/resource series;
- per-observer authority and convergence receipts, final invariant manifest,
  and every correctness failure;
- billed/metered resource facts, price-book snapshot, credits excluded, and
  cost derivation;
- run status and predeclared exclusion reason if invalid; and
- claim-scope inputs and content digests needed by §8.

Failed, timed-out, overloaded, and invalid runs stay in the wave ledger. A
replacement run is additive and cites the failed attempt; it never erases it.

## 6. Competitor comparison rules

### 6.1 Equal durability and correctness

The benchmark compares outcomes, not favorable defaults. Before a comparative
cell runs, its parity manifest states and verifies:

- the same logical schema, indexes, dataset, operation mix, result bounds,
  ordering, and authorization outcomes;
- the same acknowledgement guarantee. A durable write is compared only with a
  write whose acknowledgement survives the declared crash/failover boundary;
  fire-and-forget, memory-only queue admission, asynchronous durability, or a
  weaker replication mode is a different posture and cannot enter the chart;
- the same transaction/uniqueness/exactly-once obligations required by the
  workload, including duplicate `operationId` recovery for offline replay;
- the same observer correctness and terminal convergence oracle. Polling,
  invalidation, and push may differ, but a system may not win by omitting
  observers, weakening freshness, dropping intermediate obligations that the
  outcome requires, or returning a smaller projection; and
- the same auth shape. Client-supplied identity, public rows behind nominally
  different tokens, or a fail-open cache does not satisfy a per-principal arm.

If systems cannot offer equal guarantees, publish separate posture tables.
Do not normalize a weaker guarantee with prose or a numeric adjustment.

### 6.2 Published-surface fence analog

A public comparative claim uses only released binaries/packages, documented
public APIs, official deployment controls, and generally available service
tiers available to an external user at the recorded snapshot. Snapback does
not use a source checkout, unpublished flag, private admin endpoint, or patched
runtime in that lane; competitors receive the same constraint and may use
their official documented accelerators. Exact versions and aids are disclosed.

Source-checkout Snapback runs, private provider telemetry, and experimental
instrumentation remain useful diagnostic lanes. They are labeled
`diagnostic-only` and cannot supply a cross-system headline. A public
measurement mode may expose correlated timing receipts, but it must ship as
part of the recorded published surface and impose measured, disclosed overhead
on every affected Snapback point. A competitor metric requiring a different
observation class is shown separately.

Deployment posture is part of the cell. A local Snapback binary and a hosted
competitor development service do not support an absolute latency ordering,
the same limit LLP 0201 D2 records for O5. A matched comparison pins region,
durability/replication, resource envelope, and lifecycle posture as closely as
the products allow; remaining asymmetries appear on the chart. The benchmark
may still show each product's recommended posture, but labels it a posture
comparison rather than an engine ranking.

### 6.3 Neutral adapters and validation

Each system adapter implements the same logical workload and emits the common
event/receipt schema. It may use idiomatic official SDK mechanisms, but may not
precompute expected answers in the generator, bypass the product path normal
users take, or add a bespoke cache to one lane only. Adapter code and mapping
notes publish with the instrument. Before performance measurement, a neutral
checker runs the same positive, negative-auth, duplicate, reconnect, and final-
state corpus against every adapter. A failed parity check blocks comparison;
it does not become a slow or zero sample.

## 7. Cost measurement

### 7.1 Cost at maximum and common load

Every rate-driven comparison reports two cuts: **respective maxima**, with
each system measured at its own `lambda*`, and **common load**, with every
system measured at `lambda-cost`, the highest frozen common offered-load point
healthy for all compared systems. Each cut reports:

1. actual attributable target dollars per measured hour and normalized target
   dollars per one million successfully settled operations (and deliveries
   where fan-out is material);
2. all-in dollars, actual and normalized, comprising target, generator, and
   required client-side computation; and
3. the complete resource/billing composition: compute, database/storage,
   replicas, requests, egress, load balancer/gateway, fixed plan allocation,
   and required support/minimum spend.

All-in cost includes product-required work wherever the system places it:
local queries, optimistic reduction, outbox/replay, conflict resolution,
sync-frame processing, and decompression cannot disappear because they run in
the generator or client arm. Common benchmark-only orchestration and oracle
work may cancel only when its implementation and measured resource use are the
same within the frozen tolerance; otherwise it is included. When direct dollar
metering is unavailable, the record prices measured CPU time, memory, energy,
or device/instance occupancy with the pinned public machine-hour or amortized-
device rule. An unaccounted material work-placement difference blocks a cost
ordering claim.

Credits, trials, negotiated discounts, and free-tier balances do not reduce the
normalized price; the record uses the pinned public price book and separately
shows actual cash charge when available. Autoscaling systems include the
steady resource level reached during measurement and the scale-down tail
caused by the run. Flat monthly capacity is allocated conservatively at the
full required tier unless a preregistered, reusable allocation rule says
otherwise.

Unqualified “cheaper” means lower all-in normalized cost at `lambda-cost`,
under equal outcomes, and must pass §4.3's paired median-ratio, 95% interval,
N≥8, and 5% minimum-effect rule with cost substituted for latency. Target-only
language says “lower target infrastructure cost.” A respective-maxima result
must say “lower total cost at each system's respective maximum” and cannot
support unqualified “cheaper” because the loads differ; its all-in table still
publishes beside the common-load table. Fixed-backlog replay publishes the
same target/all-in split for the identical frozen scenario and has no
maximum-load cut.

A system with no observed unhealthy point reports its respective-maxima cut at
a lower-bound load, not “cost at maximum.” A system that violates correctness
has no healthy-load cost for that cell.

### 7.2 Cost at idle

Idle is a first-class arm, not offered load rounded toward zero. After the
declared dataset is loaded and the target reaches its documented idle state,
the generator sends no application requests, opens no observers, and runs no
synthetic keepalive for a continuous 24-hour witness. Provider-required
control-plane probes are recorded separately. Report:

- actual metered dollars over the witness and projected dollars per 30-day
  month;
- compute/request cost, persistent storage/backup cost, network/load-balancer
  floor, and fixed plan/minimum-spend cost separately;
- resident resources or provisioned capacity that remain allocated;
- scale-down duration and the next-operation cold/wake latency distribution;
  and
- dataset tier and retained bytes, because “compute scales to zero” does not
  mean stored data is free.

An empty telemetry result is not automatically zero. The record needs a
documented meter, its sampling/rounding limits, adjacent positive controls,
and the relevant billing statement or price derivation. For an always-on
self-hosted machine, idle cost includes the allocable machine price (and power
when measured); it is not reported as $0 because the process performed no CPU
work. The headline scale-to-zero table shows total idle dollars and the
compute/request component side by side.

## 8. Publication, cadence, and claim gating

### 8.1 Continuous cadence

The championship has three cadences:

- a fast engineering canary on affected runtime/client changes, allowed to use
  a reduced diagnostic subset and never published as the championship;
- a scheduled MVS wave on each qualified Snapback publication or at least
  monthly while the surface is changing; and
- rotating full-matrix waves that cover every required row over a declared
  epoch, rather than attempting the complete cross-product on every commit.

The coverage ledger names the last qualified record for every cell and marks
missing, stale, failed, and never-built cells explicitly. “Continuous” means a
maintained cadence and visible freshness, not that all 180 cells run at once.

### 8.2 Checked publication

The publisher reads only schema-valid run records and referenced receipts. For
each rate-driven common load point it renders p50/p95/p99 curves for every
applicable latency family, every constituent repetition, median/range across
repetitions, outcome rates, throughput, and the health ceiling. For replay it
renders the fixed-backlog elapsed-time completion curves and full-completion
values from §4.1. Optimistic paint, commit acknowledgement, settlement, per-
observer convergence, and all-observer convergence never share one unlabeled
“latency” series. Cost publication includes the respective-maxima and common-
load target/all-in tables (or the common replay scenario) and the idle witness.

The publication includes the full instrument, workload/fixture manifests,
adapter code, environment/deployment pins, price book, run matrix, raw or
lossless histogram records, correctness receipts, exclusions, and rerun
instructions, subject to LLP 0197's safe redaction boundary. All systems'
failed and unfavorable runs are present. Hand-transcribed charts or selected
best runs are not publication sources.

### 8.3 LLP 0189 compatibility

Every published claim is an LLP 0189 snapshot whose claim chain retains the
qualification commit `C`, scoped digest, receipts, review heads, and named-
author acceptance. The named author accepts the claim text and the semantic-
role scope classification. The digest covers, at minimum:

- the runtime/implementation of the claimed Snapback capability, including
  required client-side product work, plus exact comparator versions and
  deployment posture;
- generator region and every exercised LLP 0189 D-8 cell axis;
- workload, fixture, adapters, authorization/post-state oracles, health
  ceilings, price book and cost calculus, and their semantics-affecting inputs;
- run records and correctness/cost receipts used by the checked publisher;
- all checkers and publisher code that define or affect the claim's semantics,
  including percentile, histogram, aggregation, uncertainty, health,
  comparison, and chart-selection helpers; and
- claim text, comparison class, and the §4.3/§7.1 rule outputs.

This is LLP 0189 D-4 semantic-role scoping: a semantic checker or helper stays
in the digest even when it is wave-shared. Only runners, metrology, or fixtures
that neither define nor affect claim semantics may leave, and only when the
same change names a registered drift gate that genuinely recomputes a value
against a committed frozen record. A content-hash pin regenerated alongside an
edit is presence, not coverage.

Publication is blocked until (a) the scoped evidence is green for exactly the
claim and (b), per LLP 0189 D-6, the newest eligible complete battery is green
on the claim-relevant gates derived from that scope. The battery revision must
contain `C`, a newer eligible red controls over an older green, and a run older
than two scheduled periods is ineligible. Unrelated battery reds do not block,
but their tickets are named in the publication record. These are publication
preconditions, not a post-publication appeal to fix-forward.

A later change to a scoped Snapback surface, comparator version, adapter or
oracle semantics, fixture, threshold, region, aggregation/cost rule, or
publication helper makes the claim requalification-due; unrelated `main`
movement does not. A material competitor release makes the comparison
historical until its next natural wave. A later claim-relevant battery red is
ticketed and shown against the standing snapshot under LLP 0189 D-1/D-3; it is
not silently ignored or used to rewrite the original qualification.

Claim language is no broader than the evidence. N≥3 can publish a dated curve
and magnitude at named cells. “Faster,” “cheaper,” “best,” or “champion” is an
ordering claim and requires the §4.3 statistic (and §7.1 common-load/all-in rule
for cost), N≥8 in the compared configurations, matched posture, equal
guarantees, and the records applicable to the phrase. A 5.5M same-principal
hot-write result says nothing about 1,000 per-principal observers, another
region, reconnect, Postgres, or a cell target.

Existing OQ4/Phase-1 records remain historical measured basis. They do not
acquire championship status retroactively.

## 9. Implementation growth from the committed harness

The first implementation should extend in this order:

1. define the common run-record/event schemas and a checked p50/p95/p99 curve
   publisher; adapt the OQ4 client/server traces without losing their existing
   fields;
2. add renderer-level optimistic timestamps, durable client-settlement events,
   semantic per-observer convergence receipts, clock calibration, open-loop
   load grids, fixed-backlog completion curves, and N≥3 orchestration to the
   Snapback adapter;
3. replace local path/APFS assumptions with deterministic 1K/100K/5.5M
   fixture manifests and target-specific verified loaders while retaining the
   existing 5.5M clone as the local fast path;
4. split authority into public/same-principal/per-principal and generalize
   observer populations to 1/10/100/1,000 without changing result semantics;
5. add indexed-read, reconnect, and offline-replay choreography and oracles;
6. add cost/idle collectors and regional generator images; and
7. implement one comparator adapter, pass the parity corpus, run the MVS, then
   expand coverage in the order in §3.3.

Each stage may land diagnostic evidence, but the championship name applies
only once the MVS has at least two parity-qualified systems, complete records,
and the checked publisher.

## 10. Open questions

1. **Initial p95 ceilings.** Which absolute p95 budgets define “healthy” for
   each workload and regional class? They must be author-ratified or frozen by
   a delegated product owner before the first claim wave; calibration cannot
   choose them after seeing winners.
2. **First competitor roster.** Should the MVS adapter target Convex first,
   InstantDB first, or require both? The strategic comparison names both, but
   the minimum instrument needs only one comparator to prove parity and
   publication mechanics.
3. **Matched hosted posture.** Which Snapback deployment is eligible for the
   first hosted comparison, and what replication/failover guarantee is the
   common durability floor? Until this is answered, local-versus-hosted
   results remain posture-labeled and cannot rank absolute latency.
4. **Regional set.** Which regions constitute the first epoch, and which is
   the canonical region for MVS cadence? One region is enough to validate the
   instrument, not a global-latency claim.
5. **Public commit-ack observability.** Should Snapback ship a bounded public
   timing-receipt mode, or should commit-ack remain a diagnostic family while
   comparative publication uses only systems with equivalent documented
   provider receipts? The answer must preserve the published-surface fence.
6. **Graduation arms.** At what readiness point do Snapback Postgres and cell
   targets enter the required rotation, and which cells are the no-rewrite
   graduation proof? Their absence must remain a coverage GAP until then.

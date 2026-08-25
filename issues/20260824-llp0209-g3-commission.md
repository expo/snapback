# Commission LLP 0209 G3 — memoization and delta lanes (the next rung on the latency floor)

**Opened:** 2026-08-24 · **Ruling:** author (Charlie Cheever, 2026-08-24
session goal): complete the G3 delta lanes, the measurement tail, and
eventual capability publication; sbs-orchestrate roster · **Owner seam:**
LLP 0209 §6, §7, §9 · **Prerequisite:** the G2 program record (LLP 0209
v0.9 dated note 2026-08-25; `issues/closed/20260824-llp0209-g2-commission.md`)
· **Parent evidence anchor:**
`issues/20260808-live-query-reevaluation-cost-at-scale.md`

## Charter (from LLP 0209 §6/§7, made concrete by the G2 artifacts)

G2 removed the wake-imprecision multiplier: admitted graphs execute with
per-node captured dependencies and the conservative-fallback rate is 0 on
the corpus replay. What remains of the structural floor is the evaluation
turn itself, multiplied by subscriber count and wake rate. G3 attacks both
factors with the two rungs LLP 0209 already specifies:

- **Rung 3 (§6): same-authority-partition memoization.** Within one serving
  process/generation, the scheduler memoizes evaluation results keyed by
  the owner-computed tuple **(graph materialization identity, authority
  partition identity, `authorizationVersion`, `evaluationCut`)**. N
  same-key subscriptions consume one evaluation turn. Invalidation is the
  matcher (a wake retires the entry), an `authorizationVersion` advance
  retires every older-version entry, and authority-instance transitions
  fence per LLP 0200 §2.4 — no TTL, no second coherence protocol. Memo
  storage is bounded (declared entry-count and byte budgets; eviction =
  re-evaluation). A memo hit skips the *turn*, never the delivery or its
  witnessed-shrink/obligation accounting. E-3 measures ~6× headroom on the
  same-partition six-observer shape.
- **Rung 4 (§7): per-node-kind delta lanes extending DK-3.** Eligibility
  grows node kind by node kind, never generically: root windows
  (boundary-aware classification from the captured first/last sort keys and
  completeness bit; boundary displacement without a provable replacement
  row falls back to replace), equality to-one (row-keyed patch of the
  projected parent field), bounded to-many (parent-indexed
  insert/remove/update within the declared fanout bound; overflow falls
  back). Semi-joins stay pinned to replace fail-closed (LLP 0056's
  certified-evaluator condition); principal-bound nodes are
  partition-of-one by construction; search-membership is never
  delta-maintained here. A graph's delta eligibility is the conjunction of
  its nodes' — one ineligible node pins the whole graph to replace. Every
  admitted rule ships its own debug-build convergence assertion
  (delta-maintained result must equal fresh evaluation — the DK-3/L4
  parity pattern) and conformance rows. Deltas ride the data-driven lane
  only; authority transitions are never delta-maintained; a resynced
  subscription pins to replace; delta frames carry the same
  resolution-ticket and watermark obligations as any frame, stamped with
  (materialization identity, partition, authorizationVersion,
  evaluationCut) per §8 — and are **not** claimed replica-applicable
  (OQ-6 stays open).

**Bound amendment obligation (§2.6):** `maxMaintainedWritesPerMutation` is
declared 0 from G0; G3 must amend it from real mutation observations
**before** any maintenance write happens, through the LLP 0267 owner path
the G2-C amendment used.

**LLP 0268 sequencing honesty:** compact *shared* delta distribution is
0268 B2 and sequences alongside this gate, but 0268 B1 remains gated on
`issues/20260824-g0-bcast-bounds-large-hot-observations.md`. G3 implements
no broadcast classifier, registry, shared group state, or shared delta
distributor; its per-subscription delta frames and identity stamps are the
interface 0268 later consumes.

**D2-H3 (exit hypothesis):** on the delta-eligible corpus shapes, every
emitted delta frame is byte-convergent with fresh evaluation (convergence
assertions green across the corpus replay and scheduler cases), memoization
collapses N same-key subscriptions to one evaluation turn with
per-delivery accounting intact, and no ineligible shape ever receives a
delta frame. Instrument: the corpus replay plus the preserved spike
harness; N≥3 per `benchmarks/protocol.md` before any published claim.
Serving stays behind `SNAPBACK_GRAPH_EXEC_DISABLED` and the test-support
capability gate; no publication or capability claim is part of this
commission (LLP 0183 §D2 untouched).

## Deliverables

1. **G3-A — scheduler memoization (§6).** The memo beside the pending-frame
   structures keyed by the §6 tuple; matcher-driven retirement;
   authorization-version retirement; fence interaction per LLP 0200 §2.4
   unchanged; declared entry/byte bounds with oldest-first eviction;
   per-delivery obligations preserved on memo hits; scheduler-case and
   corpus evidence (N-subscriber same-key case showing one evaluation turn,
   retirement-on-wake case, version-retirement case, fence case); memo
   stats on the inspect surface.
2. **G3-B — delta rules for the three admitted node kinds (§7).** Root
   windows, equality to-one, bounded to-many; eligibility conjunction with
   fail-closed pins (semi-join, search, resync, authority lane); the graph
   delta wire kind extending the DK-3 `live_delta` lane with §8 identity
   stamps; per-rule convergence assertions; conformance rows for every
   rule including fallback triggers (boundary displacement, fanout
   overflow, ineligible-node pin); `maxMaintainedWritesPerMutation`
   observed and amended via the LLP 0267 owner path before maintenance
   writes; per-node ledger extended with delta/replace/fallback decisions.
3. **G3-C — measurement and record.** Corpus-replay evidence for D2-H3;
   spike-harness A/B arm (graph delta/memo path vs. landed G2 path) on the
   Zerobugs shapes; the LLP 0209 §9 G3 dated exit note draft; commission
   closure. The published-claim battery (N≥3, large/hot arms, zb5-hot
   A/B) stays owned by the measurement tail
   (`issues/20260824-g0-bcast-bounds-large-hot-observations.md` carries
   the large/hot instrument pins).

## Lane plan

sbs-orchestrate roster (codex gpt-5.6-sol xhigh implements; codex +
grok-4.6 xhigh review blind; orchestrator triages/rules/lands). Sliced:
**G3-A** → **G3-B** → **G3-C**, each review-gated and landed per
LLP 0232/0189. G3-A and G3-B touch the same scheduler/matcher seams as
live serving; every slice keeps the corpus byte-exact and the existing
relational/opaque paths untouched.

## Status

- 2026-08-24 — commissioned; packet landed.
- 2026-08-24 — **G3-A LANDED** (`69e5fee9d` + fix round `6a370fdc7`; dual-family READY at r2; records `llp/reviews/0209-g3-a.*`; spec v0.10 dated note). Review-forced narrowings: first-page/empty-ledger sharing, authority-context retirement, full retained-payload byte charging, G3-A-labeled observations (G2-C freeze untouched). Remaining: G3-B (delta rules), G3-C (measurement + record).

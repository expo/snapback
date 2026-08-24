# Commission LLP 0209 G2 — graph execution and per-node affected-read precision

**Opened:** 2026-08-24 · **Ruling:** author (Charlie Cheever, 2026-08-24
session): commission G2 now, full dispatch, sbs-orchestrate roster ·
**Owner seam:** LLP 0209 §5, §9 G2 · **Prerequisite:** the G0 exit
(LLP 0209 v0.6, ratified v0.7) · **Parent evidence anchor:**
`issues/20260808-live-query-reevaluation-cost-at-scale.md`

## Charter (from LLP 0209 §9, made concrete by the G0 artifacts)

Admitted graphs **execute server-side** with **per-node captured
dependencies** feeding the existing matcher; the match/skip/fallback
decision ledger reports **per node kind**. This is the first rung that
touches the latency floor: after LLP 0200, settle is bounded by turn
count × ~1 s opaque re-evaluation turns; G2 gives admitted shapes an
executor whose wakes are per-node precise, and it is the prerequisite of
G3's delta lanes.

**D2-H2 (exit hypothesis, unchanged from §9):** on the graph corpus,
wake precision is at least the single-table baseline — conservative-
fallback rate ≈ 0 and no table-granular full-graph wakes for commits
provably disjoint at a node — with correctness pinned by the conformance
corpus. Instrument: the preserved spike harness + the zb5-hot gate;
N≥3 per `benchmarks/protocol.md` before any published claim.

## Deliverables

1. **The graph evaluator** (engine, `crates/snapback-engine` +
   `snapback-kernel` storage seams): executes `GraphQueryPlanV1` per the
   §2 semantics — preorder node evaluation, per-parent child ranges with
   the `take + 1` lookahead, projection per the lexical scope rules,
   completeness labels per §4, the four refusal registers live
   (evaluation-time register now executable), byte-identical results at
   one (materialization, partition, authorizationVersion, evaluationCut)
   tuple. The **conformance corpus is the oracle**: every executable
   corpus case (oracle cases, paired worlds, allowDeny, refusals) passes
   through the real evaluator; the graph result byte-matches the frozen
   expected rows/labels.
2. **Per-node dependency capture live** (§5.1): the evaluator emits
   `CapturedReadKind::GraphNode` vectors; the matcher consumes them —
   the fail-closed `ConservativeFallback` arm is replaced by per-node
   matching; the ledger gains per-node-kind counters on the stats
   surface.
3. **Physical bound observation** (discharges the `[G2 measures]` tags):
   `StructuralWorkV1` observations from real execution; LLP 0267
   observed-value consumption begins; the provisional analytical
   declarations are validated or amended with evidence (0267-owner
   amendment for the 512 `maxIndexRanges` absolute — the corpus's
   1,025-consultation list shape is the evidence).
4. **The four sidecar case kinds become executable** where they need
   only the evaluator (`authorityTransition`, `mixedCommit`; audience/
   scope kinds may still need the 0268 prover — record precisely which).
5. **The empty-child demand arm** (`issues/20260823-graph-empty-child-demand-window-vector.md`)
   and the codegen/Rust parity edges
   (`issues/20260823-graph-codegen-rust-admission-parity-gaps.md`) close.
6. **Serving integration behind a kill switch**: admitted graph
   subscriptions execute on the graph path with
   `SNAPBACK_GRAPH_EXEC_DISABLED=1` as the A/B control arm; the shipped
   opaque handlers remain the default serving path until D2-H2 is met —
   no published capability claim (LLP 0183 §D2's gate untouched).
7. **Measurement**: the spike-harness A/B arm on the Zerobugs shapes and
   a zb5-hot rerun request; per-node ledger evidence for D2-H2.

## Lane plan

sbs-orchestrate roster (codex gpt-5.6-sol xhigh implements; codex +
grok-4.6 xhigh review blind; orchestrator triages/rules/lands). Sliced:
**G2-A** evaluator core against the corpus oracle (no matcher change) →
**G2-B** dependency capture + matcher consumption + ledger →
**G2-C** bound observation, sidecar kinds, serving integration + A/B
measurement. Each slice review-gated and landed per LLP 0232/0189.

## Status

- 2026-08-24 — commissioned; packet landed; G2-A dispatch follows.

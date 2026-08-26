# LLP 0209 arc, lane C2 — codex review record (D2 two-way windows)

**Change:** two-way window executable conformance + authenticated server-held ledger lineage (landed on main as the series `297cfcf76`/`94ca1e3ca`/`212735724` with the follow-up corpus-authority canonicalization `0b140beb3`, 2026-08-25; pre-rebase lane SHAs `9cd114fe8..e968a907a`)
**Reviewer:** codex gpt-5.6-sol, xhigh, read-only, blind on full rounds
**Orchestrator:** Claude Fable 5 (session 01VKza4iiZ918TtDxobNDvvy), ticket `issues/closed/20260825-llp0209-d2-two-way-windows-executable.md`
**Provenance:** every review below was actually received from the named model; verbatim per round.

## Verdict ledger

| Round | Reviewed | Verdict |
| --- | --- | --- |
| r1 | C2 series | VERDICT: NOT READY (3 MATERIAL) |
| r2 | fix round 1 delta | VERDICT: NOT READY (1 MATERIAL) |
| r3 | fix round 2 delta (targeted) | VERDICT: READY |

Post-landing note: the ten-test corpus red the landing chain initially masked was forensically attributed to G2-C-era synthetic principals meeting the later auth projection tightening (`2d75ff7206`), pre-existing both `35bd19287` and this series; repaired identity-only by `0b140beb3` (records in `issues/closed/20260825-graph-corpus-red-auth-projection-tightening.md`).

## r1

Found 3 material evidence gaps.

### Findings

- MATERIAL — The bounded backward cases do not use C1’s mechanical, case-local disposition derivation. The freezer derives dispositions from raw-versus-normalized rows at [freeze-graph-g0-corpus.mjs:2062](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c2-two-way/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:2062), but both bounded cases instead copy the full eight-row walk’s disposition at [freeze-graph-g0-corpus.mjs:2274](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c2-two-way/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:2274). The exclusive artifact therefore carries an eight-row normalized disposition whose only reordered pair is `matrix-a`/`matrix-b` [corpus.v1.json:46988](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c2-two-way/tests/conformance/graph/corpus.v1.json:46988), while its actual result contains neither row [corpus.v1.json:47153](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c2-two-way/tests/conformance/graph/corpus.v1.json:47153). No bounded raw-oracle traversal establishes either row-set parity or whether normalization occurred. This can hide a tie-dependent inclusive/exclusive skip and contradicts the ticket’s disposition claim.

- MATERIAL — Child page-two routing is not discriminated per parent. `childWindow` always creates exactly one child interval [freeze-graph-g0-corpus.mjs:2100](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c2-two-way/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:2100), both child walks resume the same single detail issue [freeze-graph-g0-corpus.mjs:2382](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c2-two-way/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:2382), and the assertion inspects only `ranges.first()` [graph_corpus_v1.rs:8490](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c2-two-way/crates/snapback/tests/graph_corpus_v1.rs:8490). An evaluator that chooses child intervals positionally, reuses the first parent’s continuation for every parent, or associates page two with the wrong parent would remain green. That does not discharge LLP 0209’s keyed per-parent vector requirement at [LLP 0209:1322](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c2-two-way/llp/0209-live-graph-profile.spec.md:1322).

- MATERIAL — No case proves continuation identity against a fresh evaluation that happens to agree. Every resume supplies the correct previous ledger [graph_corpus_v1.rs:8570](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c2-two-way/crates/snapback/tests/graph_corpus_v1.rs:8570); there is no crossed materialization, direction, parent, or demand-vector ledger. More importantly, the carried ledger contains only node ID and counters [graph_evaluator.rs:99](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c2-two-way/crates/snapback-engine/src/graph_evaluator.rs:99), while validation checks only vector length/order and node IDs [graph_evaluator.rs:2645](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c2-two-way/crates/snapback-engine/src/graph_evaluator.rs:2645). Thus an implementation accepting any same-node ledger, copying its counters, and freshly evaluating page two would pass. This falls short of the Spec’s authenticated lineage key [LLP 0209:1350](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c2-two-way/llp/0209-live-graph-profile.spec.md:1350).

- MINOR — The ticket says “32 exact evaluator observations” [ticket:15](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c2-two-way/issues/20260825-llp0209-d2-two-way-windows-executable.md:15), but the artifact contains 31 evaluator observations plus one served-only live-replacement observation [two-way-window-observations.v1.json:3593](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c2-two-way/tests/conformance/graph/two-way-window-observations.v1.json:3593).

### Required answers and refuted risks

- (j) Least constrained: child two-page resume. With one parent, page-two parent-interval drift or positional interval selection stays green.
- (k) No case proves continuation identity. Cumulative counters prove that supplied ledger values were consumed, not that their originating materialization/demand identity was authenticated.

- REFUTED-RISK — No-duplicates/skips evidence is stronger than set equality. Each concatenated walk exact-compares its ordered physical vector, without deduplication, and root walks additionally assert uniqueness [graph_corpus_v1.rs:8868](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c2-two-way/crates/snapback/tests/graph_corpus_v1.rs:8868). Child walks also exact-compare the concatenated ordered vector [graph_corpus_v1.rs:8977](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c2-two-way/crates/snapback/tests/graph_corpus_v1.rs:8977). Replaying page one, duplicating rows, or reversing the physical tie would fail.

- REFUTED-RISK — NULL coverage is discriminating: nullable ordering puts two NULL rows last in both directions, while the `Lt` case excludes them in SQL and requires matcher `None`/unknown [graph_corpus_v1.rs:8606](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c2-two-way/crates/snapback/tests/graph_corpus_v1.rs:8606).

- REFUTED-RISK — The 32-observation artifact digest independently recomputes to the stored value, and ordinary runs reconstruct and exact-compare the complete artifact [graph_corpus_v1.rs:8997](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c2-two-way/crates/snapback/tests/graph_corpus_v1.rs:8997).

- REFUTED-RISK — The served `resultLength` caveat is honest. The evaluator asserts its explicit length [graph_corpus_v1.rs:8472](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c2-two-way/crates/snapback/tests/graph_corpus_v1.rs:8472), while the served path exact-compares the complete snapshot row vector [graph_corpus_v1.rs:8669](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c2-two-way/crates/snapback/tests/graph_corpus_v1.rs:8669), making served length directly derivable.

- REFUTED-RISK — Existing corpus values and field order remained unchanged apart from appended query carriers and `twoWayWindows`; sealed artifacts, the D1 control oracle, and delta-disposition artifact are byte-identical. The backward live case also requires `live_replace` [graph_corpus_v1.rs:8757](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c2-two-way/crates/snapback/tests/graph_corpus_v1.rs:8757).

VERDICT: NOT READY (3 MATERIAL)
## r2 — fix round 1 delta

One MATERIAL finding remains.

1. **MATERIAL — lineage “authentication” is caller-forgeable.** `GraphServingDemandV1` exposes `priorWindowLedgerLineages` through normal deserialization ([graph_evaluator.rs](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c2-two-way/crates/snapback-engine/src/graph_evaluator.rs:39)). Ingress accepts those records and attaches them to caller-supplied counters ([engine.rs](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c2-two-way/crates/snapback-engine/src/local/engine.rs:41385)). Validation merely recomputes an unkeyed SHA-256 over caller-controlled lineage fields; ledger counters are not included ([graph_evaluator.rs](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c2-two-way/crates/snapback-engine/src/graph_evaluator.rs:2686)). Consequently, a fresh non-superseding request can synthesize a matching lineage and reset cumulative counters, bypassing window bounds. Server rebinding is only enforced when a valid prior subscription is supplied via `supersedes` ([engine.rs](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c2-two-way/crates/snapback-engine/src/local/engine.rs:22662)). The lineage must either remain entirely outside caller-controlled serialization or use a server-authenticated token binding the counters and complete identity.

Closure audit:

- **F1 closed.** Each inclusive/exclusive bounded case independently invokes the raw handler, applies that case’s decoded endpoints, and derives its own disposition from its own raw and normalized rows ([freeze-graph-g0-corpus.mjs](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c2-two-way/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:2276)). The executable test validates each bounded case’s own physical rows ([graph_corpus_v1.rs](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c2-two-way/crates/snapback/tests/graph_corpus_v1.rs:9421)).
- **F2 closed.** The fixture uses two parents with distinct child sets, advances one keyed interval, proves the untouched parent still evaluates its first interval, and rejects a crossed cursor as `SNAPBACK_GRAPH_CURSOR_UNBOUND` ([graph_corpus_v1.rs](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c2-two-way/crates/snapback/tests/graph_corpus_v1.rs:6770)). That matches LLP 0209’s cursor/lineage register, not its malformed-window-vector arm ([LLP 0209](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c2-two-way/llp/0209-live-graph-profile.spec.md:1218)).
- **F3 partially closed.** The implementation rebuilds genuine plan, instance, and materialization-context identities—not merely structural shape—and the crossed materialization/direction/demand tests are sound ([graph_evaluator.rs](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c2-two-way/crates/snapback-engine/src/graph_evaluator.rs:2702), [graph_corpus_v1.rs](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c2-two-way/crates/snapback/tests/graph_corpus_v1.rs:7006)). Existing evaluator and served continuations remain compatible through retained in-memory lineage and supersession rebinding. However, the trust-boundary defect above means authentication itself is not closed.
- **F4 closed.** The record now accurately says “31 exact evaluator observations plus 1 served-only live replacement” ([issue record](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c2-two-way/issues/20260825-llp0209-d2-two-way-windows-executable.md:15)).

Verification: `git diff --check` passed; the focused eight-test continuation/two-way matrix passed, including every existing graph-corpus continuation test. The broader 52-test run showed no failures before being stopped during the long repeated delta-disposition test. Worktree remained clean.

VERDICT: NOT READY (1 MATERIAL)
## r3 — fix round 2 delta

No MATERIAL findings.

- Lineage is private, non-Serde, and has no caller reconstruction/attachment path.
- Registration, live rerun, forced replacement, supersession, and test-support continuation tests passed.
- Missing retained custody correctly returns `SNAPBACK_GRAPH_CURSOR_UNBOUND`.
- The regression recreates every pre-fix lineage field and the exact unkeyed JCS/SHA-256 hash before presenting it.
- Working tree remained clean.

VERDICT: READY
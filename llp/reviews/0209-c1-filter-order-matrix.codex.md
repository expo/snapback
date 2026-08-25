# LLP 0209 arc, lane C1 — codex review record (D2 filter/order matrix)

**Change:** the §D2 filter/order matrix + semi-join attestation fix (landed on main as the series ending `bfb45a821`, 2026-08-25; pre-rebase lane SHAs `6333b15bc..3c3abc27b`)
**Reviewer:** codex gpt-5.6-sol, xhigh, read-only, blind on full rounds
**Orchestrator:** Claude Fable 5 (session 01VKza4iiZ918TtDxobNDvvy), ticket `issues/closed/20260825-llp0209-d2-filter-order-matrix.md`
**Provenance:** every review below was actually received from the named model; verbatim per round.

## Verdict ledger

| Round | Reviewed | Verdict |
| --- | --- | --- |
| r1 | C1 series | VERDICT: NOT READY (2 MATERIAL) |
| r2 | fix round 1 delta | VERDICT: NOT READY (1 MATERIAL) |
| r3 | fix round 2 delta (targeted) | VERDICT: READY |

## r1

Two material gaps remain. The matrix largely behaves as claimed, but the semi-join attestation fix is incomplete for projected-existence queries, and the combined-filter fixture does not independently constrain combined semantics.

## Findings

**MATERIAL — The semi-join attestation fix incorrectly narrows projected-existence parents.**

The evaluator distinguishes predicate-only semi-joins from semi-joins whose existence value is projected. It narrows the parent population only when `projected_as_existence` is false: [graph_evaluator.rs:2047](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/crates/snapback-engine/src/graph_evaluator.rs:2047), [graph_evaluator.rs:2050](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/crates/snapback-engine/src/graph_evaluator.rs:2050).

The new attester does not make that distinction. After every non-empty `ExistsSemiJoin`, it unconditionally replaces the parent output with `retained_parents`: [live_matcher.rs:1266](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/crates/snapback-kernel/src/live_matcher.rs:1266), [live_matcher.rs:1312](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/crates/snapback-kernel/src/live_matcher.rs:1312), [live_matcher.rs:1315](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/crates/snapback-kernel/src/live_matcher.rs:1315).

Consequently, a valid query that projects an `exists` value and then reads another sibling relation can capture sibling facts for unmatched parents, while attestation expects facts only for matched parents. Registration then fails with an exact-parent-fact mismatch. Because registration precedes successful subscription establishment, this is a fail-closed served-path availability defect, not a wrong-result or wrong-wake defect: [engine.rs:42973](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/crates/snapback-engine/src/local/engine.rs:42973).

The fix should mirror `projection_references_exists` and narrow the attestation population only for predicate-only semi-joins. A projected-existence-plus-later-sibling regression case is needed.

**MATERIAL — The combined-filter case is observationally equivalent to all-label-only.**

Both cases freeze the same two expected rows: [freeze-graph-g0-corpus.mjs:1761](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:1761), [freeze-graph-g0-corpus.mjs:1767](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:1767).

In the fixture, only public issues `a` and `b` have both selected labels: [filter-order-fixture.v1.json:267](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/tests/conformance/graph/filter-order-fixture.v1.json:267). The alpha-only and beta-only issues are excluded by all-label alone, while the cross-project decoy has no label memberships. Thus every public row rejected by open/creator/assignee/project in the combined case is already rejected by all-label.

An implementation that applies all-label but silently drops every root filter whenever a non-empty semi-join is present would remain green—including hidden-world byte equality and the title-update live test. Add public both-label decoys that separately violate open, creator, assignee, and pinned project.

**MINOR — The order cases do not distinguish physical `_id` from logical source ID as the tie-breaker.**

Normalization maps logical issue IDs to physical issue `_id` and applies `_id ASC`: [freeze-graph-g0-corpus.mjs:419](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:419). But the tied fixture rows order their physical IDs and logical source IDs identically: [filter-order-fixture.v1.json:87](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/tests/conformance/graph/filter-order-fixture.v1.json:87), [filter-order-fixture.v1.json:185](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/tests/conformance/graph/filter-order-fixture.v1.json:185).

The cases catch the known direction-multiplied descending tie, but an implementation using `sourceIssueID ASC` or another co-sorted ID would pass.

## Semi-join defect assessment

The pre-fix attester validated the semi-join membership facts but retained the stale, full parent population. The evaluator had already narrowed predicate-only semi-joins before capturing later sibling facts. Therefore a non-empty predicate semi-join followed by another relation produced fewer captured sibling facts than attestation expected and failed registration.

It could not produce wrong results or false-negative wakes through the landed served path: registration fails before the subscription is established. At most, equivalent over-capture outside that guarded route would cause unnecessary wakes. The regression preserves existing matcher dispositions and ledger counts; those sealed artifacts are byte-identical.

## Required answers

**(j)** The combined-filter axis is least constrained. Root-filter conjunction can be ignored whenever the all-label semi-join is active, yet all current frozen observations remain green. The tie-break axis has the secondary weakness described above.

**(k)** The semi-join fix is not load-bearing for any pre-existing corpus case. Existing selected-label invocations use an empty label list, making `all` vacuously retain every parent—for example [graph_corpus_v1.rs:2695](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/crates/snapback/tests/graph_corpus_v1.rs:2695) and [graph_corpus_v1.rs:2766](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/crates/snapback/tests/graph_corpus_v1.rs:2766). Its absence therefore explains no previously frozen disposition. It is load-bearing only for the new non-empty all-label case.

## Refuted risks

- **REFUTED-RISK — All-label is any-of.** The oracle uses `every`, and alpha-only/beta-only public rows would expose any-of behavior: [functions.mjs:3187](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/demos/zerobugs/control/snapback/functions.mjs:3187).
- **REFUTED-RISK — Rows were hand-authored.** The freezer executes the real opaque handler and derives expected rows from its output: [freeze-graph-g0-corpus.mjs:1801](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:1801), [freeze-graph-g0-corpus.mjs:1829](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:1829).
- **REFUTED-RISK — Hidden rows affect emitted bytes.** Both worlds are frozen and compared exactly: [freeze-graph-g0-corpus.mjs:1868](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:1868).
- **REFUTED-RISK — Descending normalization changed the oracle.** The raw oracle digest/order remains recorded, while only the expected comparison order is normalized. The D1 control function has no semantic diff.
- **REFUTED-RISK — Existing corpus or sealed artifacts changed.** Existing corpus rows remain byte-identical; the three specified sealed artifacts and the G3-A observation artifact are untouched. G3 delta/memo eligibility is unchanged.
- **REFUTED-RISK — Wrong placement.** Query/schema/function changes are in the corpus-local `tests/conformance/graph/zerobugs` copy. There is no semantic change to `demos/zerobugs/control/snapback/functions.mjs`.
- **REFUTED-RISK — Missing served replacement coverage.** All nine variants are exercised in both worlds through attested registration, direct matching, and a served title replacement: [graph_corpus_v1.rs:8151](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/crates/snapback/tests/graph_corpus_v1.rs:8151), [graph_corpus_v1.rs:8288](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/crates/snapback/tests/graph_corpus_v1.rs:8288).

VERDICT: NOT READY (2 MATERIAL)
## r2 — fix round 1 delta

One MATERIAL finding:

- F3 exposes an unrecorded oracle normalization. The freezer always reorders tied rows by physical `_id` ([freeze-graph-g0-corpus.mjs:476](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:476)), but labels only descending cases as normalized ([freeze-graph-g0-corpus.mjs:1963](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:1963)). Consequently, `modified asc` claims `comparison:"exact"` while its raw `matrix-a,matrix-b` tie becomes normalized `matrix-b,matrix-a` ([corpus.v1.json:13665](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/tests/conformance/graph/corpus.v1.json:13665)); `created asc` has the same contradiction ([corpus.v1.json:18443](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/tests/conformance/graph/corpus.v1.json:18443)). Their canonical field maps also still claim `exact-id-order` ([corpus.v1.json:13462](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/tests/conformance/graph/corpus.v1.json:13462)). LLP 0209 requires cases without an authorized normalization disposition to compare exactly ([LLP 0209:2955](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/llp/0209-live-graph-profile.spec.md:2955)). Thus the expected rows are correct for graph ordering, but the frozen oracle-attestation claim is false.

Other closures:

- F1 closes correctly. Projected existence is detected recursively ([live_matcher.rs:826](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/crates/snapback-kernel/src/live_matcher.rs:826)); only that form preserves the parent population, while predicate-only semi-joins still overwrite it with retained parents ([live_matcher.rs:1329](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/crates/snapback-kernel/src/live_matcher.rs:1329)). The regression uses `subscribe_live` ([engine.rs:1197](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/crates/snapback-engine/src/local/tests/engine.rs:1197)), whose serving path evaluates and then invokes dependency registration ([engine.rs:42924](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/crates/snapback-engine/src/local/engine.rs:42924), [engine.rs:42973](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/crates/snapback-engine/src/local/engine.rs:42973)). It therefore exercises the previously failing establishment path.
- F2 closes. Each public BOTH-label decoy violates exactly one of project/open/creator/assignee ([freeze-graph-g0-corpus.mjs:318](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:318), [freeze-graph-g0-corpus.mjs:441](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:441)), and every case asserts inclusion exactly when that conjunct is inactive ([freeze-graph-g0-corpus.mjs:1867](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:1867)).
- Structural JSON comparison found no spillover into older corpus cases: only `filterOrderMatrix` and the top-level digest changed. The decoys intentionally change eight matrix cases; the combined case retains the same two-row set.
- The physical/logical inversion itself is now real and asserted ([freeze-graph-g0-corpus.mjs:435](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c1-filter-matrix/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:435)); the MATERIAL issue is its dishonest comparison disposition.

Read-only checks passed: query-generation freshness, inventories, `ref-check` (0 errors), and `git diff --check`. Rust tests were not rebuilt because the read-only sandbox forbids target/temp writes.

VERDICT: NOT READY (1 MATERIAL)
## r3 — fix round 2 delta

No MATERIAL findings.

- Disposition is mechanically derived from positional raw-vs-normalized order comparison, independent of direction.
- Exactly three cases require normalization; six remain exact. Vocabulary matches LLP 0209’s closed set.
- All 137 `resultBytes`/`orderedRootIds` fields are byte-identical across revisions.
- Syntax and diff checks pass; workspace unchanged.

VERDICT: READY
# LLP 0209 G0 Stage B3 — codex review record

**Change:** Zerobugs graph declarations, graph conformance corpus, fixture-derived bounds, G0 exit draft (landed on main as the series ending `40e76924c`, 2026-08-23)
**Reviewer:** codex gpt-5.6-sol, xhigh, read-only, blind to the other family each round
**Orchestrator:** Claude Fable 5 (session snapback-44), under `issues/20260823-llp0209-g0-commission.md`
**Provenance:** every review below was actually received from the named model; verbatim text per round.

## Verdict ledger

| Round | Reviewed | Verdict |
| --- | --- | --- |
| r1 | B3 source | VERDICT: NOT READY (10 MATERIAL) |
| r2 | fix round 1 | VERDICT: NOT READY (6 MATERIAL) |
| r3 | fix round 2 | VERDICT: NOT READY (4 MATERIAL) |
| r4 | targeted codex re-check 1 (grok READY standing) | VERDICT: READY |

## r1 — B3 source

Not ready: I found 10 MATERIAL defects and one MINOR defect.

### MATERIAL

1. **Label arrays do not follow the oracle’s ordering.**  
   Evidence: all three declarations order membership edges by `labelID ASC` ([queries.mjs:31](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/tests/conformance/graph/zerobugs/queries.mjs:31), also lines 126 and 202), while the control sorts returned labels by `name`, then `id` ([functions.mjs:2814](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/snapback/functions.mjs:2814), [functions.mjs:2878](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/snapback/functions.mjs:2878)). The freezer copies the oracle order unchanged ([freeze-graph-g0-corpus.mjs:351](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:351)); a concrete normal-fixture issue has oracle order `Design Needed, reflect, user-reported`, versus graph order `reflect, user-reported, Design Needed`.  
   Fix: materialize/order by the oracle label-name key, or freeze the affected full row shapes as refusals.

2. **The field maps hide row-shape mismatches, which §9 expressly forbids.**  
   Evidence: the `issueDetail` map excludes result-bearing emoji, comment creator, and comment emoji branches because the admitted graph omits them ([freeze-graph-g0-corpus.mjs:275](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:275)). LLP 0209 says only envelope fields may be excluded and rows the grammar cannot reproduce must be refusal cases ([LLP 0209:2985](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/llp/0209-live-graph-profile.spec.md:2985)).  
   Fix: remove row-bearing exclusions and declare/execute stable refusals for the complete oracle row shapes, or extend the graph declarations until every mapped row is reproducible.

3. **The exact forward list cases use the wrong tie identity.**  
   Evidence: the graph declares only `modified DESC` ([queries.mjs:22](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/tests/conformance/graph/zerobugs/queries.mjs:22)), so its implicit tie is physical `_id`; the control ties on `sourceIssueID` in the same direction ([functions.mjs:2824](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/snapback/functions.mjs:2824)). The normal fixture contains 69 tied-modified groups and demonstrable differing physical/source order, but both forward cases claim exact order without divergence. The backward case’s physical-id normalization is correctly implemented ([freeze-graph-g0-corpus.mjs:566](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:566)); the defect is the unnormalized forward cases.  
   Fix: declare `sourceIssueID` as the explicit secondary order component, or obtain a contract change and mark every affected case with a permitted divergence.

4. **Comments cursor discrimination is untested, and authoritative misses are translated incorrectly.**  
   Evidence: the corpus has only five oracle cases—three normal cases and two list pagination cases ([graph_corpus_v1.rs:456](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback/tests/graph_corpus_v1.rs:456)). It contains no `issueDetail` incomplete/non-null continuation, incomplete/null refusal, or authoritative-miss case. Moreover, `envelope.value?.commentsCursor !== null` is true when `value` is null because `undefined !== null` ([freeze-graph-g0-corpus.mjs:457](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:457)), creating a continuation on a zero-row miss.  
   Fix: require `value !== null && commentsCursor !== null`; add executable continuation, bound-refusal, and authoritative-miss detail cases.

5. **The paired-world fixture identities and falsification coverage are invalid.**  
   Evidence: the actual absent world is the loaded policy-extension tables with one slice removed ([freeze-graph-g0-corpus.mjs:856](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:856)), but it is serialized as `normal-seed-v1` ([freeze-graph-g0-corpus.mjs:870](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:870)). Five of six slices cannot affect the chosen `listIssueByID` invocation, and the required issue-label/provider-membership overlays are absent. The runner only compares the freezer’s two digests and the hidden-table names ([graph_corpus_v1.rs:679](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback/tests/graph_corpus_v1.rs:679)); it does not reconstruct either world.  
   Fix: freeze corpus-local present/absent fixtures that differ only by the named slice, verify all other inputs byte-for-byte, and add result-relevant label/search membership pairs.

6. **Five executable case kinds are illegally marked pending and are not backed by LLP 0268 carriers.**  
   Evidence: `allowDeny`, `audienceParity`, `scopeMismatch`, `authorityTransition`, and `mixedCommit` are emitted with `pending:"G2"` ([freeze-graph-g0-corpus.mjs:590](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:590)); `pending` is not part of the closed §3.4 union ([LLP 0209:1938](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/llp/0209-live-graph-profile.spec.md:1938)). Every attached plan is actually query-shaped with `base-not-class-1` ([corpus.v1.json:52](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/tests/conformance/graph/corpus.v1.json:52)), yet `scopeMismatch` claims `scope-unbound`. The test explicitly blesses the non-contractual pending state ([graph_corpus_v1.rs:1028](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback/tests/graph_corpus_v1.rs:1028)).  
   Fix: provide real broadcast/counterfeit/query-shaped carriers with host-recomputed certificates and execute all seven kinds; remove `pending`.

7. **Logical bounds are not derived from the required normal/large/hot maxima.**  
   Evidence: comment fanout uses normal maximum 21 while explicitly deferring the large maximum ([freeze-graph-g0-corpus.mjs:667](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:667)); byte bounds use only normal oracle bytes ([freeze-graph-g0-corpus.mjs:685](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:685)); list `maxWindowPages` uses all one million generated rows rather than pages needed to exhaust a named filtered interval ([freeze-graph-g0-corpus.mjs:669](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:669)). This contradicts §2.6’s exact maximum requirements ([LLP 0209:1667](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/llp/0209-live-graph-profile.spec.md:1667)).  
   Fix: freeze the actual large/hot per-parent, interval, and serialized-result maxima, select documented headroom over those maxima, and regenerate dependent rollups.

8. **The G0 exit observations are not `GraphG0ExitObservationV1` records.**  
   Evidence: large/hot cells contain only `format`, fixture, plan hash, `pending`, and command ([freeze-graph-g0-corpus.mjs:927](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:927)), omitting required group count, fanout, and group measurements ([LLP 0209:1693](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/llp/0209-live-graph-profile.spec.md:1693)). Even the normal `groupStateBytes` measures a JSON object containing three numeric summaries, not retained group state ([freeze-graph-g0-corpus.mjs:917](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:917)). The Rust test deliberately skips required-field validation for six cells ([graph_corpus_v1.rs:1078](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback/tests/graph_corpus_v1.rs:1078)).  
   Fix: record all nine exact observation rows and measure actual serialized result, dependency, and retained group state.

9. **The runner does not host-reconstruct the authority partition identity.**  
   Evidence: it rebuilds graph instance and materialization identities but merely shape-checks `{kind, principal}` for the partition ([graph_corpus_v1.rs:60](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback/tests/graph_corpus_v1.rs:60)). The freezer hashes that raw object directly ([freeze-graph-g0-corpus.mjs:534](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:534)), rather than the required plan/class-2/class-3 partition preimage. Thus completeness tuples can be internally self-consistent while binding the wrong partition hash.  
   Fix: serialize the full partition preimage, rebuild it through the Rust identity helper, and compare the resulting hash with every node/composition proof tuple.

10. **The exit draft claims completion that the artifacts do not show.**  
    Evidence: rows 3, 6, 7, and 8 are marked complete ([G0-EXIT-DRAFT.md:21](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/tests/conformance/graph/G0-EXIT-DRAFT.md:21)), despite the invalid paired worlds, missing comment/large checks, incomplete bounds/observations, and pending non-carrier broadcast cases above. Its nine LLP 0268 mappings ([G0-EXIT-DRAFT.md:35](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/tests/conformance/graph/G0-EXIT-DRAFT.md:35)) are labels pointing mostly at the same query-shaped record, not the §3.3 carriers required by Stage B row 8 ([LLP 0209:3015](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/llp/0209-live-graph-profile.spec.md:3015)).  
    Fix: mark rows 3/6/7/8 incomplete, remove the ratification claim, and regenerate the draft only after the required evidence exists.

### MINOR

- [G0-EXIT-DRAFT.md:8](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/tests/conformance/graph/G0-EXIT-DRAFT.md:8) still calls B3 an “uncommitted worktree,” although HEAD is the B3 commit. Fix: replace it with `682d09b86` and the final evidence pointer.

### REFUTED-RISK

- The serving control is untouched, and the HEAD delta contains no evaluator or matcher change.
- All three normalized graph plan identities are host-reconstructed successfully; the available current `graph_corpus_v1` test binary passed all 10 tests.
- The backward descending-tie normalization correctly resolves `sourceIssueID` through `issueListRead` to physical IDs and is the only case correctly carrying `oracleDivergence:"direction-tie-break"`.
- The analytical physical sums and rollups match the §2.6 formulas; the failure is their unsupported fixture inputs, not arithmetic.
- The three new tickets accurately describe their cited admission-parity, zero-child-window, and descending-tie evidence.
- The freezer’s `Date.now()` is only an import cache-buster and does not enter output.

### Direct answers

1. **Freezer determinism:** Yes, for fixed inputs, by source inspection. Canonicalization and ordering are deterministic, the date field is fixed, and independently recomputed corpus/bounds digests match the frozen values. A full `--check` rerun could not complete because this review sandbox denies `mkdtemp` with `EPERM`, so empirical byte-for-byte rerun confirmation remains unavailable here.

2. **Corpus digest coverage:** Yes. The freezer hashes the canonical whole corpus before adding `contentDigest` ([freeze-graph-g0-corpus.mjs:938](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:938)); the Rust test removes only that field and recomputes it ([graph_corpus_v1.rs:423](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback/tests/graph_corpus_v1.rs:423)). It covers every case and all case content.

3. **Weakest seam:** The freezer and Rust corpus test primarily prove self-consistency of freezer-authored data, not equivalence between the declared graph and the opaque oracle. The freezer manufactures mapped expected rows, completeness proofs, broadcast outcomes, and observations; the runner then validates their hashes and shapes without executing the graph, reconstructing the fixture worlds, or rebuilding every outer identity. That seam allows green tests alongside wrong label/root order, missing cursor discriminators, synthetic broadcast cases, and unsupported measurements.

VERDICT: NOT READY (10 MATERIAL)

## r2 — fix round 1

## Round-1 dispositions

- **K1 — FIXED.** `comments` declares `created DESC` at [queries.mjs:125](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/tests/conformance/graph/zerobugs/queries.mjs:125); equal-created rows are normalized by physical `_id ASC` at [freeze-graph-g0-corpus.mjs:627](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:627), with a child-scoped divergence at [corpus.v1.json:18203](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/tests/conformance/graph/corpus.v1.json:18203), asserted by Rust at [graph_corpus_v1.rs:665](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback/tests/graph_corpus_v1.rs:665).

- **K2 — FIXED.** Mapped label arrays sort through source-to-physical label identity at [freeze-graph-g0-corpus.mjs:353](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:353); all three declarations use `labelID ASC`, and Rust verifies every mapped row at [graph_corpus_v1.rs:580](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback/tests/graph_corpus_v1.rs:580). Name-ordered through-shapes remain refused.

- **K3 — FIXED-BUT-INTRODUCED.** List roots now declare `modified DESC, sourceIssueID DESC` at [queries.mjs:19](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/tests/conformance/graph/zerobugs/queries.mjs:19); all 69 tie groups are frozen with zero residual implicit ties and exact order checks at [graph_corpus_v1.rs:647](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback/tests/graph_corpus_v1.rs:647). However, the associated ticket still describes the removed divergence; see M6.

- **K4 — PARTIAL.** Null-safe `(status, reason, when)` discrimination, authoritative miss, and exhaustive exercised/unexercised translation bookkeeping are present at [graph_corpus_v1.rs:790](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback/tests/graph_corpus_v1.rs:790) and [graph_corpus_v1.rs:821](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback/tests/graph_corpus_v1.rs:821). The purported detail continuation is not resumed (M2), and the materialized cost refusal has the wrong result form (M3).

- **K5 — PARTIAL.** Six independently identified fixture pairs, their digests, non-slice byte identity, and declared-class coverage are constructed at [freeze-graph-g0-corpus.mjs:1167](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:1167) and checked at [graph_corpus_v1.rs:869](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback/tests/graph_corpus_v1.rs:869). They are not valid authority-equivalence proofs because the graph policy does not hide the named internal rows (M1), and the detail-root pair has an impossible child demand vector (M4).

- **K6 — FIXED.** Each paired invocation’s materialization and full authority-partition preimages are host-reconstructed, and every node/composition proof is bound to those hashes at [graph_corpus_v1.rs:1249](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback/tests/graph_corpus_v1.rs:1249).

- **K7 — FIXED.** The five G2-only kinds live in the independently digested closed artifact at [broadcast-cases.g2-pending.v1.json:1](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/tests/conformance/graph/broadcast-cases.g2-pending.v1.json:1). Rust validates their exact per-kind structure without evaluation at [graph_corpus_v1.rs:1039](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback/tests/graph_corpus_v1.rs:1039), and executable cases contain no `pending` field at [graph_corpus_v1.rs:1501](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback/tests/graph_corpus_v1.rs:1501).

- **K8 — FIXED.** No MEAN-derived declarations were found. Logical fields cite maxima, provisional large/hot fields carry pinned zb5 commands, `maxWindowPages` uses the filtered interval, and physical fields follow the analytical `[G2 measures]` formulas. These are checked at [graph_corpus_v1.rs:1365](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback/tests/graph_corpus_v1.rs:1365). M1 requires regeneration after the authority mirror is corrected, but I found no independent arithmetic/formula defect.

- **K9 — FIXED.** The freezer measures the serialized mapped result, captured dependency vector, and memo-entry-equivalent group state at [freeze-graph-g0-corpus.mjs:1292](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:1292). Rust checks all typed fields and byte counts, while large/hot remain six explicit gaps, at [graph_corpus_v1.rs:1574](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback/tests/graph_corpus_v1.rs:1574).

- **K10 — PARTIAL.** Stage-B rows and the seven explicitly unsatisfied 0268 labels are generally under-claimed at [G0-EXIT-DRAFT.md:17](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/tests/conformance/graph/G0-EXIT-DRAFT.md:17). But `G0-BCAST-CLASS` is unsupported (M1), and the claimed “executable continuation” at [G0-EXIT-DRAFT.md:119](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/tests/conformance/graph/G0-EXIT-DRAFT.md:119) is false (M2).

## Findings

1. **MATERIAL — The graph declarations do not implement the oracle’s crew-or-public authority policy.** Both `issue` and `issueListRead` are declared `public-read` at [schema.mjs:29](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/tests/conformance/graph/zerobugs/schema.mjs:29) and [schema.mjs:83](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/tests/conformance/graph/zerobugs/schema.mjs:83); the list root filters only by project at [queries.mjs:19](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/tests/conformance/graph/zerobugs/queries.mjs:19). The serving oracle explicitly removes internal roots for ordinary principals at [functions.mjs:3156](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/snapback/functions.mjs:3156). The frozen fixture contains an internal row in that project at [paired-world-fixtures.v1.json:2863](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/tests/conformance/graph/paired-world-fixtures.v1.json:2863), while the mapped list expectation contains only 516 rows at [corpus.v1.json:2952](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/tests/conformance/graph/corpus.v1.json:2952). The label-edge pairs make this especially concrete: adding a selected-label edge to the internal root changes the declared graph’s reads while remaining hidden only to the oracle at [freeze-graph-g0-corpus.mjs:1177](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:1177). Consequently the paired proofs, mapped list/detail rows, and `G0-BCAST-CLASS: SATISFIED` claim are unsound. **Fix:** encode an admissible authority predicate/classification matching crew-or-public, regenerate all cases/bounds/observations, and mark `G0-BCAST-CLASS` not satisfied until the corrected pairs pass.

2. **MATERIAL — The detail continuation is a flag fixture, not an executable continuation.** The freezer adds 51 comments but invokes only `issueDetail` once at [freeze-graph-g0-corpus.mjs:1032](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:1032). Without `nextResult`, the mapper freezes `[]` at [freeze-graph-g0-corpus.mjs:480](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:480), producing `hasMore:true` with an empty next page at [corpus.v1.json:18535](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/tests/conformance/graph/corpus.v1.json:18535). Rust checks only the flags for detail, unlike its non-empty list-resume check at [graph_corpus_v1.rs:700](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback/tests/graph_corpus_v1.rs:700). **Fix:** invoke `commentsPage` with the returned cursor and matching direction, freeze its mapped rows/invocation, and require non-empty same-order next-page parity in Rust.

3. **MATERIAL — The cost-bound refusal contradicts the closed materialized-refusal form.** LLP 0209 requires `resultBytes:null`, empty roots, length zero, and a top-level refusal reason for a refused result at [LLP 0209:2003](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/llp/0209-live-graph-profile.spec.md:2003). The corpus instead records `graphCompleteness:"refused"` while retaining a non-null mapped issue row and `resultLength:1` at [corpus.v1.json:18823](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/tests/conformance/graph/corpus.v1.json:18823). **Fix:** emit the closed null-byte/empty-row materialized refusal with `SNAPBACK_QUERY_COST_BOUND_EXCEEDED`, retain the refused proofs, and deserialize/assert the typed expected-result union in Rust.

4. **MATERIAL — The missing-root detail pair mints an impossible child interval.** `windowVector` creates one child interval for every demand node and uses `sourceIssueID` as the physical parent key at [freeze-graph-g0-corpus.mjs:506](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:506). The frozen pair therefore demands comments for `{table:"issue", id:"zbav1_internal_issue"}` at [corpus.v1.json:22847](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/tests/conformance/graph/corpus.v1.json:22847), even though the actual physical issue ID differs and the same case’s proof says the comments node evaluated zero ranges at [corpus.v1.json:23009](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/tests/conformance/graph/corpus.v1.json:23009). **Fix:** first define/admit the ruled zero-parent demand representation, then freeze an empty child vector consistent with the zero-root proof; do not substitute a source ID for a physical row key.

5. **MATERIAL — The empty-child-demand ticket falsely describes the landed evidence.** It says B3 avoided `issueDetail` and “does not mint a fake parent or interval” at [20260823-graph-empty-child-demand-window-vector.md:16](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/issues/20260823-graph-empty-child-demand-window-vector.md:16), directly contradicted by M4. **Fix:** update the ticket with the current failing pair and make its acceptance criteria the prerequisite for that pair.

6. **MATERIAL — The descending-tie ticket’s corpus evidence is stale.** It claims the list case carries `oracleDivergence` and normalizes tied groups at [20260823-zerobugs-control-descending-tiebreak-deviation.md:22](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/issues/20260823-zerobugs-control-descending-tiebreak-deviation.md:22). Round 1 now declares `sourceIssueID` as an explicit secondary, records no divergence, and asserts zero residual groups. **Fix:** update the ticket to distinguish the still-existing generic control comparator deviation from the now-exact B3 list declaration/case.

- **MINOR —** The exit draft still calls B3 “this uncommitted worktree” at [G0-EXIT-DRAFT.md:8](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/tests/conformance/graph/G0-EXIT-DRAFT.md:8). Replace it with the eventual landed SHA.

- **REFUTED-RISK —** The codegen/Rust parity ticket accurately reflects a remaining general compiler gap at [20260823-graph-codegen-rust-admission-parity-gaps.md:10](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/issues/20260823-graph-codegen-rust-admission-parity-gaps.md:10). The three corpus carriers themselves deserialize and host-reconstruct at [graph_corpus_v1.rs:514](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback/tests/graph_corpus_v1.rs:514).

- **REFUTED-RISK —** Serving control is untouched: HEAD and HEAD~1 have identical SHA-256 `39fdfd303ad5e02259f79b4cad243838f44608c9c1877fbd27d6e97452867fa4`. No evaluator or matcher file changed.

## Determinism, digest, and weakest seam

1. **Freezer determinism:** Yes, with an environment caveat. Native `--check` could not allocate its codegen temporary directory at [freeze-graph-g0-corpus.mjs:127](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:127) in this read-only sandbox. An in-memory replay using the frozen host-reconstructed carriers reran the control handlers and exactly matched all four serialized artifacts; independent digest recomputation also matched all four frozen digests. The `Date.now()` value is only an import cache-buster and is not serialized.

2. **Corpus digest coverage:** Yes for the complete executable G0 corpus. The digest is computed over the canonical whole object at [freeze-graph-g0-corpus.mjs:1371](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:1371), and Rust removes only `contentDigest` before recomputing it at [graph_corpus_v1.rs:514](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback/tests/graph_corpus_v1.rs:514). Paired worlds bind their external fixture digests; the intentionally out-of-union G2-pending file has its own digest.

3. **Weakest seam:** The weakest seam is semantic equivalence between the opaque oracle and the declared graph. The freezer executes only the control handler, while Rust chiefly proves that frozen plans, hashes, identities, labels, and proofs are internally self-consistent. Neither side evaluates the declaration against the fixture’s actual authority and demand semantics. That gap allowed a public-read declaration to masquerade as crew-or-public, a zero-root proof to coexist with a fabricated child interval, and a “continuation” with no resumed rows—all while the 10 Rust tests passed.

`cargo test -p snapback --test graph_corpus_v1`: **10 passed, 0 failed**.

VERDICT: NOT READY (6 MATERIAL)

## r3 — fix round 2

## Findings

### MATERIAL 1 — `pairedWorld` semantics were expanded beyond the v0.5 grammar

The freezer now emits `expectedRelation: "different"` and `absentExpect`, including a detail pair that changes an issue title rather than adding/removing a hidden row ([freeze-graph-g0-corpus.mjs:1221](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:1221), [freeze-graph-g0-corpus.mjs:1335](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:1335)). The runner accepts either equal or different results and checks only the declared changed IDs ([graph_corpus_v1.rs:1020](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback/tests/graph_corpus_v1.rs:1020), [graph_corpus_v1.rs:1138](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback/tests/graph_corpus_v1.rs:1138)).

LLP 0209 §3.4 defines `pairedWorld` as the hidden-row non-interference proof: worlds differ only by hidden rows and results must exact-match. The new fields and “different” relation are not part of that closed record.

Fix: retain `pairedWorld` for exact hidden-row non-interference and express class-2 activation using an existing contract-compliant executable kind, or revise v0.5 before extending the grammar.

### MATERIAL 2 — Class-2 scope identities are principal-minted, not owner-reconstructed

The freezer hashes `{principal, nodeId, declarationId, args}` to create each class-2 `scopeIdentity` ([freeze-graph-g0-corpus.mjs:589](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:589)). The Rust runner checks only that the identity is nonzero and attached to the expected node/declaration/policy; it never independently reconstructs the owner-defined partition-equivalence scope ([graph_corpus_v1.rs:233](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback/tests/graph_corpus_v1.rs:233)).

Consequently, identical graph arguments under ordinary and crew principals receive different class-2 identities merely because the raw principal differs. That does not prove LLP 0209’s class-2 partition equivalence and leaves `G0-BCAST-IDENTITY` unsupported.

Fix: add a corpus owner resolver that maps the frozen role/permission facts to the normalized policy-equivalence scope, and have the runner independently recompute and exact-check it. Raw principal identity must not enter the class-2 scope preimage unless declared by the owner.

### MATERIAL 3 — Direction-tie divergence uses the wrong contract carrier and field-map rule

The freezer records a plural auxiliary structure, `oracleDivergences: [{ graphNodeId, kind: "direction-tie-break" }]` ([freeze-graph-g0-corpus.mjs:1157](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:1157)). The runner explicitly requires singular `oracleDivergence` to be absent and accepts the plural field instead ([graph_corpus_v1.rs:730](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback/tests/graph_corpus_v1.rs:730), [graph_corpus_v1.rs:778](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback/tests/graph_corpus_v1.rs:778)). The detail field map remains `exact-id-order`, rather than §3.4’s required `exact-after-id-tiebreak-normalization` for the affected comments order ([freeze-graph-g0-corpus.mjs:259](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:259)).

The underlying normalization is otherwise sensible: it resolves source comment IDs to physical `_id` values and reorders only equal-`createdAt` groups ([freeze-graph-g0-corpus.mjs:662](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:662)).

Fix: emit the singular `oracleDivergence: "direction-tie-break"`, attach the specified comparison rule to the comments-order field map, and have the runner independently validate row-set equality and physical-ID normalization only within tied groups.

### MATERIAL 4 — The exit draft prematurely labels bound decisions “RATIFIED”

The draft correctly says that it is uncommitted and does not itself perform G0 exit ([G0-EXIT-DRAFT.md:8](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/tests/conformance/graph/G0-EXIT-DRAFT.md:8)), but later labels the 16-label edge, result bounds, and zero maintained-write candidates as `RATIFIED` ([G0-EXIT-DRAFT.md:65](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/tests/conformance/graph/G0-EXIT-DRAFT.md:65)). LLP 0209’s Exit section reserves those decisions for author ratification in v0.6.

Fix: label them derived/provisional candidates pending author ratification, then promote them only in the final owner-authored v0.6 exit note.

## Round-2 dispositions

- **L1 — FIXED-BUT-INTRODUCED.** `issue` and `issueListRead` now both declare `permissionBacking(["visibility"])` ([schema.mjs:40](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/tests/conformance/graph/zerobugs/schema.mjs:40), [schema.mjs:93](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/tests/conformance/graph/zerobugs/schema.mjs:93)), and class-2 pairs now flip output. But MATERIAL 1 changes the closed `pairedWorld` semantics, while MATERIAL 2 means the partition identities are not actually owner/host reconstructed.

- **L2 — FIXED.** Detail continuation is resumed through `commentsPage`, with raw and field-mapped nonempty next-page rows frozen ([freeze-graph-g0-corpus.mjs:1004](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:1004), [freeze-graph-g0-corpus.mjs:1079](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:1079)). The runner compares the rows and requires them to be nonempty ([graph_corpus_v1.rs:732](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback/tests/graph_corpus_v1.rs:732)).

- **L3 — FIXED.** Cost-bound refusal is closed: `resultBytes` and digest are null, roots are empty, length is zero, continuation is absent, and the top-level reason is `SNAPBACK_QUERY_COST_BOUND_EXCEEDED` ([freeze-graph-g0-corpus.mjs:486](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:486), [graph_corpus_v1.rs:800](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback/tests/graph_corpus_v1.rs:800)).

- **L4 — FIXED.** Child intervals come only from evaluated physical issue parent keys ([freeze-graph-g0-corpus.mjs:525](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:525)); the hidden-root pair records an empty vector and the precise B1 blocker, which the runner checks without changing the B1 type ([graph_corpus_v1.rs:180](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback/tests/graph_corpus_v1.rs:180), [graph_corpus_v1.rs:1049](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback/tests/graph_corpus_v1.rs:1049)).

- **L5 — FIXED.** Comments use `ceil(21 / 1024) = 1`, explicitly provisional, with lineage and rollup recomputed from the declared page size ([queries.mjs:184](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/tests/conformance/graph/zerobugs/queries.mjs:184), [bound-derivation.v1.json:725](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/tests/conformance/graph/bound-derivation.v1.json:725)). The physical totals match §2.6: detail scan/ranges `1067/26`, child `1025/1`, rollup `2092/27`.

- **L6 — FIXED.** All three tickets accurately describe HEAD evidence: the empty-child B1 limitation, live descending-tie behavior, and remaining general codegen-parity gaps.

- **L7 — PARTIAL.** The draft now marks `G0-BCAST-CLASS` not satisfied and no longer claims an unresumed continuation. MATERIAL 2–4 still leave identity, tie-normalization, and ratification claims unsupported.

## B2 codegen hunk

The B2 change makes each node inherit recursively accumulated class-2 policy inputs from its parent, deduplicated by declaration, kind, and identity ([graph-query.mjs:1105](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.mjs:1105)). B3 needed this because the crew-or-public permission backing makes otherwise public descendants authority-dependent through their parent.

It does not weaken B2 refusal or parity guarantees: the effective class remains the maximum of local and inherited requirements, requests below that class are still rejected, and class-2 nodes still require nonempty policy inputs ([graph-query.mjs:1119](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.mjs:1119)). No evaluator or matcher changed.

## Oracle and artifact checks

Spot checks of comments cursor discrimination, complete label edges, list visibility, descending ties, and cost refusal otherwise agree with the serving control. Label completeness still depends on the 1,024-edge fetch, and tie normalization uses physical comment IDs only inside equal-time groups.

The serving control is untouched. No executable evaluator or matcher was modified. The pending G2 records retain their required structural fields and are honestly marked non-executable. I found no separate MINOR findings.

`cargo test -p snapback --test graph_corpus_v1` passed all 10 tests. Targeted Node authority tests and the freezer’s `--check` rerun could not start because this read-only sandbox rejected Node temporary-directory creation with `EPERM`, including under `/tmp` and `target`.

The freezer appears deterministic by construction: stable iteration/canonicalization, fixed derived timestamp, and exact comparison of all four generated artifacts ([freeze-graph-g0-corpus.mjs:1474](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:1474)). I could not empirically certify rerun equality in this sandbox.

The corpus digest covers the complete `corpus.v1.json` object except its own `contentDigest`; the runner removes that field and hashes everything else ([graph_corpus_v1.rs:592](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback/tests/graph_corpus_v1.rs:592)). It is not transitive over the external pending-G2 file, which has its own digest.

The weakest seam is authority-partition evidence: codegen now propagates the right proof-input structure, but the freezer still invents scope identities from raw principals and the runner trusts them. That can mask an equivalence-partition bug while letting class-2 coverage be credited from a single root mutation. The corpus needs an owner-equivalence resolver plus an independent host reconstruction check before its broadcast identity evidence is persuasive.

VERDICT: NOT READY (4 MATERIAL)

## r4 — targeted codex re-check 1 (grok READY standing)

M1 PASS — five paired worlds are hidden-row-only, differ solely by the named slice, and exact-match oracle/results; `expectedRelation`/`absentExpect` are absent. `demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:1353`, `crates/snapback/tests/graph_corpus_v1.rs:1291`
M2 PASS — class-2 hashes consume normalized role/permission facts, not raw principal; Rust independently recomputes them and asserts same-class equality/different-class inequality. Denied `allowDeny` bytes, digest, status, reason, and empty items are oracle-frozen. `demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:187`, `demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:1330`, `demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:1472`, `crates/snapback/tests/graph_corpus_v1.rs:428`, `crates/snapback/tests/graph_corpus_v1.rs:1522`
M3 PASS — exactly one singular `oracleDivergence` uses the comments-node comparison, and normalization sorts only equal-`createdAt` groups by physical ID while preserving the exact row set. `tests/conformance/graph/corpus.v1.json:19344`, `tests/conformance/graph/corpus.v1.json:19424`, `demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:767`, `crates/snapback/tests/graph_corpus_v1.rs:973`
M4 PASS — every former `RATIFIED` entry is now labeled “derived — provisional, pending author ratification (v0.6)”; no `RATIFIED` token remains. `tests/conformance/graph/G0-EXIT-DRAFT.md:62`
VERDICT: READY

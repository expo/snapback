# LLP 0209 arc, lane C1 — grok review record (D2 filter/order matrix)

**Change:** the §D2 filter/order matrix + semi-join attestation fix (landed on main as the series ending `bfb45a821`, 2026-08-25)
**Reviewer:** grok-4.6, xhigh, blind
**Orchestrator:** Claude Fable 5 (session 01VKza4iiZ918TtDxobNDvvy)
**Provenance:** the review below was actually received from the named model; verbatim (including streamed narration). Grok binds READY at r1; the r2/r3 deltas (both-label decoys, tie-fixture inversion, disposition honesty) were verified by the codex rounds in the sibling record.

## r1 — VERDICT: READY

I'll review the three-commit series against the charter and LLP 0209, starting with the governing docs, the diff, and the semi-join attestation fix.Next I’ll pull LLP 0209, the commit series, and the sealed-artifact diffs so the review is grounded in the actual change.The first commit also regenerated guide/diagnostics; I’ll inspect that alongside the matcher fix and LLP 0209’s matrix sections.I’ll read the matcher around parent-population updates, then the freezer, fixture, and corpus-test wiring.The attestation walk order and freezer/oracle wiring look load-bearing; I’ll inspect those next, plus LLP §5 and the corpus tests.# LLP 0209 D2 filter/order matrix — independent review

Scope: `6333b15bc` → `fc2667596` → `33f49bc6d` (`git diff 6333b15bc^..33f49bc6d`). Blind to the other reviewer. Read-only.

---

## (a) Semi-join attestation — `6333b15bc`

**Exact defect.** Served registration reconstructs each child’s parent set from `outputs[parent]` while walking `normalized_plan.nodes` in declaration order (`live_matcher.rs:1036–1046`). The evaluator does the same walk (`graph_evaluator.rs:2947–2961`). For the copied list shape, that order is:

1. `listRoot` window (project-filtered, **not** label-filtered)
2. `issueRow` / `labelEdges` / `labelRow` against the **full** window
3. `selectedLabels` (`exists-semi-join`, `mode: "all"`)
4. `viewState` (principal-bound sibling of the root)

The evaluator already shrinks the parent population after an unprojected semi-join (`graph_evaluator.rs:2050–2074`). Frozen labels-all proofs show that split in data: `n1` has 5 parent rows, `n2` has 5 ranges, `n4` has 5 membership facts with bits `[true, true, false, false, false]`, `n5` has **2** principal rows (`issueListRead_matrix_a/b` only).

Pre-fix, `attest_membership_fact` returned `()` and never wrote back. `viewState` therefore ran `exact_parent_fact_set` against the stale 5-row root (`live_matcher.rs:607–621`) while the evaluator had emitted 2 facts → `DemandIdentityMismatch` (`parent-key-set`). Empty `selectedLabelIDs` hides it: `mode: All` with zero probes retains every parent (`live_matcher.rs:820–823`, vacuous conjunction), so the overwrite is identity. That is why every previously frozen list case (`selectedLabelIDs: []`) stayed green.

**Fix correctness.** `attest_membership_fact` now returns whether the parent is retained (`Exists` iff `actual_matched == 1`; `All` iff `actual_matched == required_matches`, including empty-probe vacuity). The `ExistsSemiJoin` arm then replaces `outputs[parent_node_id]` with only those rows (`live_matcher.rs:1284–1315`). That matches the evaluator’s unprojected path and is what later siblings actually captured.

It is **complete for every admitted Zerobugs/matrix plan**: all nine variants copy the same node order; only `viewState` sits after the semi-join; no plan projects `{kind: "exists"}`. Direct-edge `all` probing (In → per-item Eq, JCS-canonical `BTreeMap`) matches `bind_declared_all_probe`.

**Not a wrong-result/wrong-wake bug in landed pre-fix code.** Registration failed closed. `evaluate_graph_query` was already correct. No subscription meant no wakes. Symptom is a **false served-registration refusal** for any `GraphQuery` with (1) unprojected `mode: "all"` and non-empty argument, and (2) a later sibling of that parent. Corpus-local `issueListV2` is exactly that shape (`queries.mjs:45–64`). On the experimental graph path this is a latent production attester defect; it does not explain any frozen skip/match/fallback.

**No disposition regression.** Empty-All overwrite is a no-op. `match-dispositions.v1.json` is byte-untouched (`totals.skip=245`, `match=16`, `conservativeFallback=0`). Existing `oracleCases` / `cases` / `queries` in `corpus.v1.json` are byte-identical to `6333b15bc^` except the new `filterOrderMatrix` object and `fixtures.filterOrderMatrix` pointer.

---

## (b) Matrix honesty

Nine generated static plans, frozen by the **canonical freezer** against the **control inline handler** (`freeze-graph-g0-corpus.mjs:2851–2856`, `3122`), not hand-authored rows.

| Variant | Fixture actually hits the axis? |
|---|---|
| Project + `modified` asc/desc | Yes. Matrix project + same-shape Zero decoy (`issue_matrix_zero_decoy`). `expectedRows: 5` vs the rest of `normal-seed-v1`. |
| Project + `created` asc/desc | Yes. Three-way `created=1900` tie (`a,b,e`). |
| Open | Yes, `open: true` → `{a,b,d}` (c/e closed). **`open: false` never passed.** |
| Creator | Yes, `aboodman` → `{a,b,c}` (d/e other creator). |
| Assignee | Yes, `pcorpet` → `{a,b,d}` (c/e omit `assigneeID`). |
| All-label | Yes. Two labels; `c` has only alpha, `d` only beta, `e` none → 2 rows. |
| Combined | Plan has all four root filters + non-empty labels. **Result set `{a,b}` is identical to labels-all and to open∧creator∧assignee.** `resultBytes` are byte-equal. |

Selectable orders: each declaration is a single field (`generate-filter-order-queries.mjs:10–34`); corpus-only indexes stop before `sourceIssueID` (`schema.mjs:97–114`); kernel appends `"_id" ASC` (`storage.rs:15145`). Every case asserts `tieGroups > 0` (`freeze-graph-g0-corpus.mjs:1813`). Frozen orders:

- modified desc **raw** `['matrix-b','matrix-a',…]` vs **norm** `['matrix-a','matrix-b',…]`
- created desc **raw** `['matrix-c','matrix-d','matrix-e','matrix-b','matrix-a']` vs **norm** `['matrix-c','matrix-d','matrix-a','matrix-b','matrix-e']`

That is a real desc-tie disagreement with the control, not a no-op rewrite.

Hidden worlds: hidden row matches every filter (open/creator/assignee/both labels, internal). Freezer `deepEqual`s present vs absent initial **and** replacement (`1868–1875`); the runner evaluates both worlds against the same frozen expect (`graph_corpus_v1.rs:8174–8186`). Occupancy is weak (`take` 1024 ≫ 5) but byte non-interference is actually executed.

Live replacement: each of the 9 has a served-path title patch of `issue_matrix_a` through `graphCorpusPatchIssue`, matcher `match`, served `live_replace` (`graph_corpus_v1.rs:8255–8382`). `a` is in every result. No case moves a row **across** a filter/order boundary.

Plans are admission-closed static copies of `issueListV2` (no client AST).

---

## (c) All-label = conjunction, not any-of

Control oracle: `labels.sets.every(set => set.has(row.issueID))` (`functions.mjs:3193`), one set per selected name (`3014–3041`). Unchanged.

Graph: `mode: "all"` + `labelID In selectedLabelIDs`, rebound to per-probe `Eq` (`live_matcher.rs:589–604`; evaluator `bind_declared_all_probe`).

The trap is in the fixture: `c` = alpha only, `d` = beta only. Any-of would be 4 rows. Frozen expect is 2 (`matrix-a`,`matrix-b`). Membership proof records five bits `[T,T,F,F,F]` — `c` and `d` are explicit misses. Freezer also asserts `expectedRows` against the live oracle before writing. A graph any-of would fail the Rust exact-compare; an oracle any-of would fail the freezer.

Does not distinguish conjunction from “exact label set” (no extra third label on `a`/`b`). Not required to catch any-of.

---

## (d) Descending tie normalization

Pinned rule: LLP 0007 / kernel `"_id" ASC` after declared components, both directions (`storage.rs:10073–10081`, `15145`). Control still multiplies the **whole** comparison, including the source-id tie, by direction (`functions.mjs:2824–2833`). `demos/zerobugs/control/snapback/functions.mjs` is **empty** in this diff — D1 oracle not edited.

Freezer normalization (`419–434`): primary field uses the requested direction; tie is `physical _id` `localeCompare` with **no** direction multiplier. Desc cases carry `comparison: 'exact-after-pinned-physical-id-tiebreak-normalization'` and the deviation-ticket pointer (`1897–1904`). Raw digest/order retained. ASC cases are `exact` because this fixture’s source IDs and physical ids agree on ASC (so raw == norm); expect is still the normalized oracle.

---

## (e) Additivity

`git diff 6333b15bc^..33f49bc6d -- tests/conformance/graph/served-observations.g2-c.v1.json tests/conformance/graph/0268-COMPLETION-DRAFT.md tests/conformance/graph/match-dispositions.v1.json` is empty. Same for `served-observations.g3-a.v1.json` and `delta-dispositions.v1.json`.

Existing corpus body (`queries`, `oracleCases`, `cases`, `evaluatorEdgeCases`, `g0ExitObservations`, …) is byte-identical; only `filterOrderMatrix` + `fixtures.filterOrderMatrix` + `contentDigest` change.

Matrix graphs are array-bearing list copies. G3 rung-1 keeps those on replace (`live_replace` is the frozen served disposition). Delta/memo artifacts untouched.

---

## (f) Placement

Semantic list shape lives in `tests/conformance/graph/zerobugs/{schema,functions,generate-filter-order-queries,filter-order-queries.generated}.mjs`. Canonical freezer is the existing control **script** (`demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs`), not the D1 app. `demos/zerobugs/control/snapback/functions.mjs` has no diff.

---

## (j) Least-constrained axis

**Combined.** `pc-combined-filter` and `pc-all-selected-labels-filter` freeze **identical** `resultBytes` and `orderedRootIds` (`['matrix-a','matrix-b']`). Open∧creator∧assignee on this fixture is also `{a,b}`. A combined plan that dropped open, creator, assignee, **or** the all-label semi-join would still return `{a,b}` and stay green. Combined still constrains “not the unfiltered five” (and project, via the rest of `normal-seed-v1` / the decoy), but it does not independently witness the AND of the four named filters.

Runner-up: **live replacement** never changes a filter or order key — only `issue_matrix_a.title`. A served path that failed to re-evaluate open/creator/assignee/labels after a membership-changing write would stay green.

---

## (k) Is the attester fix load-bearing for existing corpus?

**No.** Every pre-existing list/point invocation has `selectedLabelIDs: []`. Empty `All` retains all parents; the new writeback is identity. Previously frozen dispositions (including `match-dispositions.v1.json` 245/16/0) are not explained by this bug and would not have been `DemandIdentityMismatch`. The fix **is** load-bearing for **new** `pc-all-selected-labels-filter` and `pc-combined-filter` served registration (`n5` 2 facts vs `n0`/`n4` 5). The other seven new variants still pass empty labels and would register without it.

---

## Findings

### MATERIAL

None.

### MINOR

1. **Combined fixture does not uniquely constrain combined AND.** `freeze-graph-g0-corpus.mjs:1760–1774`; frozen `resultBytes` of `pc-combined-filter` == `pc-all-selected-labels-filter`. Dedicated open/creator/assignee/all-label cases still cover those axes.

2. **Open polarity is one-sided.** Only `open: true` (`1746–1748`). A compile-time `true` (ignoring the argument) would pass.

3. **Attester always narrows; evaluator only when `!projected_as_existence`.** `live_matcher.rs:1315` vs `graph_evaluator.rs:2047–2074`. No admitted plan projects `{kind:"exists"}`, so no current regression. An exists-projected semi-join with a later sibling would now false-refuse.

4. **Inventory side-effect:** `SNAPBACK_GRAPH_DEMAND_IDENTITY_TRACE` added to `packages/snapback-client/diagnostic-codes.d.mts:1892` because commit 1 regenerated diagnostics after touching `live_matcher.rs:214` (env var already existed at `6333b15bc^`). Not a filter-matrix semantic change; it is not a real refusal code.

### REFUTED-RISK

- **Wrong wakes/results in pre-fix served code.** Pre-fix path never registered. Evaluator results were already filtered. Extra `n1`/`n2` captures for later-filtered parents (conservative extra wakes) are evaluator order, not this attester bug, and are pre-existing for any non-empty all-label eval.
- **Oracle / `_id ASC` rule changed.** Control comparators untouched; kernel tie unchanged; freezer is an explicit post-oracle normalization with raw evidence retained.
- **Existing dispositions / G3 eligibility.** Sealed G2-C, G3-A, delta, 0268 draft, match ledger: empty diffs. Existing corpus rows byte-identical.
- **D1 control app semantic change.** `functions.mjs` empty diff. Matrix indexes are corpus-local (`schema.mjs:97–114`).
- **Hand-authored matrix rows.** Freezer invokes control `issueListV2` inline handler, maps through `expectedFromOracle`/`completeResult`, `--check`s the generator, and refuses to write if present≠absent or `expectedRows`/tie/decoy assertions fail.

---

Latent-production note (not a lane blocker): any live `GraphQuery` with this list shape and **non-empty** `selectedLabelIDs` could not subscribe before `6333b15bc`. Direct evaluation was fine. Worth a kernel note; it does not belong in `match-dispositions.v1.json`.

VERDICT: READY

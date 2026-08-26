# LLP 0209 arc, lane C2 — grok review record (D2 two-way windows)

**Change:** two-way window executable conformance (landed as `297cfcf76..212735724` + `0b140beb3`, 2026-08-25)
**Reviewer:** grok-4.6, xhigh, blind
**Orchestrator:** Claude Fable 5 (session 01VKza4iiZ918TtDxobNDvvy)
**Provenance:** the review below was actually received from the named model; verbatim (including streamed narration). Grok binds READY at r1; the r2/r3 deltas (case-local dispositions, multi-parent routing, server-held authenticated lineage) were verified by the codex rounds in the sibling record.

## r1 — VERDICT: READY

I'll review the two-commit series adversarially against the charter. First I'll load the review skill and the governing documents, then inspect the diff.The series is two commits on HEAD. Next I’ll collect the full diff, the governing LLP sections, and the new corpus/artifact files.Nine files, most of the bulk in frozen JSON. I’ll read the test runner, freezer, and the spec/disposition rules next.The runner is large; I’ll read the rest of the two-way helpers, then the freezer and corpus structure.I have the runner; next I’ll read the freezer’s two-way construction and the corpus/observation artifacts.I need C1’s disposition code, resume/identity checks, and whether existing corpus rows stayed byte-identical.The served observation API omits `resultLength`. Next I’ll inspect dispositions, NULL/tie fixtures, ledger continuation, and whether existing corpus rows stayed identical.Read-only review of `9cd114fe8` → `37f81f6cb` against LLP 0209 §2.1/§2.2/§2.4, C1’s mechanical disposition, and the P-C two-way charter.

## Overall

This lane does what the charter asked: it promotes two-way root/child continuation into executable evaluator + served-scheduler rows, freezes 32 observations, and leaves D1 / C1 cases / sealed G2 artifacts alone. Discrimination is generally real (wrong page-1 re-eval, wrong inclusive/exclusive bounds, NULL-last reversal, and selectable `_id` tie reversal all fail). The weakest coverage is the comments child (no created ties) and the served `resultLength` field (honest API hole, not a silent false proof).

## (a) Traversal correctness discrimination

**Backward first page.** Four selectable + two nullable declarations × backward page 1 exact-match `resultBytes`, `orderedRootIds`, physical ids, label/proof, and continuation (`graph_corpus_v1.rs:8464–8524`, `:8594–8603`). A walk that only reversed row order would miss the Matrix inverted pair: fixture `issue_matrix_a`/`source matrix-b` vs `issue_matrix_b`/`source matrix-a` (`filter-order-fixture.v1.json:28–37`), required `_id ASC` (`graph_corpus_v1.rs:8900–8913`), freezer tie `graphSortRows` never multiplies `_id` (`freeze-graph-g0-corpus.mjs:1395–1398`). **Would fail.**

**Forward/backward resume.** Page 2 is not a re-slice of page 1: exclusive lower is the last page-1 key, and the evaluator proof interval repeats it (`two-way-window-observations.v1.json:4129–4139`, freezer `freeze-graph-g0-corpus.mjs:2195–2198`). Re-evaluating page 1 would miss `orderedRootIds` / `physicalRootIds` / `resultBytes`. **Would fail.**

**Child two-page resume.** Same parentKey on both pages (`issue` / `issue_da43a7cfca272ba1c3f411ee`); page 2 lower is exclusive on the 11th comment. Concatenated physical ids exact-match a 21-row complete order. Ignoring the child continuation returns page 1’s 11 comments and fails. Parent-interval drift that emitted extra/missing comments fails `physicalChildIds` and frozen `nodeCompleteness`. `ranges.first()` (`graph_corpus_v1.rs:8490–8493`) is a weaker live probe, but the observation artifact pins the full proof vector.

**Forward→backward same-window.** Ticket text cites uniqueness + set equality (`graph_corpus_v1.rs:8880–8885`, `:8928–8934`). That pair would **not** catch a duplicated-then-deduped scramble **by itself**. The load-bearing check is the per-walk exact ordered compare to `expectedCompletePhysicalOrder` (`:8869–8878`). With that, dup-then-dedup and skips fail.

## (b) No duplicates/skips proof strength

**Strong per walk, weaker as stated cross-direction.**

Each walk concatenates page physical ids and exact-compares the ordered vector to the freezer’s `expectedCompletePhysicalOrder` (root `:8869–8878`, child `:8978–8987`). That is ordered equality, not set equality.

Cross-direction (`:8928–8934`, child `:8991–8995`) is only `BTreeSet` equality. The ticket’s “uniqueness plus set equality prove no skip” is weaker than the code actually runs.

## (c) Disposition honesty

C1’s mechanical rule is reused: `orderWasNormalized` iff `rawOrder[i] !== normalizedOrder[i]`, then pinned comparison + ticket, else `exact` (`freeze-graph-g0-corpus.mjs:2062–2088`). This is **not** a direction heuristic: modified-ASC **forward** is normalized (a/b swap) and modified-ASC **backward** is `exact`.

Selectable walks use the opaque list handler. Nullable walks honestly name `corpus-internal-null-order-oracle` because raw ≡ `graphSortRows` (`:2186–2188`) — always `exact` by construction.

**Gap:** both backward bounded cases **copy** the unbounded 8-row disposition (`:2274–2295`). Exclusive selected rows are `decoy-open, e, d, c` — the a/b swap is **outside** that window, but the case still carries `exact-after-pinned-physical-id-tiebreak-normalization`. Conservative over-claim, not a false `exact`.

The Rust runner only checks spelling + ticket (`graph_corpus_v1.rs:8801–8812`); it does not re-derive from `rawOrder` vs `normalizedOrder`. Freeze-time is the real gate.

## (d) NULL semantics

NULL-last is explicit and **not** multiplied by direction (`freeze-graph-g0-corpus.mjs:1388–1393`); `graphCompareValue`’s NULL-first (`:1375–1378`) is unreachable for mixed null/non-null. All four nullable walks assert the two null list-roots as a physical suffix (`graph_corpus_v1.rs:8886–8898`). SQLite-default NULL-first ASC would fail.

The two nulls are **omitted** `assigneeID` keys, not JSON `null` (`filter-order-fixture.v1.json:283–292`, `:306–315`).

`Lt '\uffff'` keeps every non-null and drops the two nulls (6 vs 8). SQL 3VL is proven by the result set. Matcher assertion is `row_matches_query_filters == None` (`graph_corpus_v1.rs:8628–8636`). That `None` is missing-field (`row.get()?`), **not** the `actual.is_null() → Some(false)` branch (`live_matcher.rs:3228–3230`). A JSON-null phantom (`scalar_rank(Null)=0 < bound`) is therefore not the fixture the matcher sees. SQL exclusion still holds.

## (e) Additivity

Compared `9cd114fe8^` vs `HEAD`:

| Section | Identical? |
| --- | --- |
| `oracleCases`, `cases`, `broadcastFixture`, `authorityOwner`, G0 observations | yes |
| `filterOrderMatrix.cases` (9 C1 rows) | yes |
| `filterOrderMatrix.queries` | **no** — 9 → 13 carriers |
| Existing generated list-variant bodies | yes |
| D1 `demos/zerobugs/control/snapback/functions.mjs` | not in diff |
| Sealed served/delta/bounds/broadcast artifacts | not in diff |
| Broadcast `inputsHash` pinned | `freeze-graph-g0-corpus.mjs:38–41`, `:595–598` |

`deltaEligibility: "unchanged-backward-not-eligible"` is frozen (`:2442`, test `:8829–8831`); the one mutation asserts `live_replace` (`graph_corpus_v1.rs:8757–8761`). No engine eligibility change in the diff.

## (f) Frozen observation artifact

`two-way-window-observations.v1.json`: format/version/scope, **32 unique ids** (12×2 root pages + 1 live replace + 2 bounded + 1 null-Lt + 2×2 child). Independent JCS+SHA-256 recomputes to `sha256:9286f384cd0234b716f03ddd4ab26f97db6f33a553f190e7ad863fcc46aa6d09`. Ordinary runs exact-compare the whole object (`graph_corpus_v1.rs:9012–9016`); freeze path is env-gated (`:9009`).

Internal consistency holds: page-2 modified-desc backward proof interval matches page-1 continuation; ledgers accumulate (`pages: 1→2`, `rootRows: 4→8` at `:3578–3587` vs `:4601–4610`).

## (g) Served `resultLength`

Honest hole, slightly oversold in the ticket.

`graph_serving_observation_for_test` **omits** `resultLength` (`engine.rs:13088–13114`). Initial/resume parity compares snapshot `.rows` and six observation fields **excluding** `resultLength` (`graph_corpus_v1.rs:8675–8705`). Evaluator `resultLength` is frozen from the evaluator (`:8472–8475`, `:8717`). Live-replacement copies the missing field as JSON `null` (`two-way-window-observations.v1.json:3604`).

That is not a silent length proof. Snapshot row equality is stronger than a length field for initial/resume. Child `resultLength` is the root (`1`), not the comments page size — child size is in `physicalChildIds` / `resultBytes`.

---

## Required answers

**(j) Least constrained scenario**

**`issueDetailTwoWay` comments two-page walk.** All 21 comments have unique `created` values, so a backward walk that reverses declared `created DESC` but uses `_id DESC` (or ignores the implicit tie) stays green. There is no child-level Matrix-style pair check. Cross-direction is only set equality (`graph_corpus_v1.rs:8991–8995`). This is **not** the G0 `issueDetail-comments-window-and-child-tie` fixture; that known created-tie is untested here. Disposition `exact` is honest given no ties (`freeze-graph-g0-corpus.mjs:2363–2379`, control `dir` inverted so primary order matches graph `created DESC`).

Wrong behavior that stays green: comments `_id DESC` within equal keys; also a served observation that lied about `resultLength`.

**(k) Continuation identity**

**Proven, not merely “same rows.”** Cite:

1. Demand identity rotates: page-2 `graphInstanceHash` differs from page-1; other materialization axes are identical (freezer `invocation()` hashes the full windows vector). Page-2 exclusive lower **is** page-1’s continuation key (`observations:4129–4139`).
2. Ledger lineage accumulates: evaluator + served pass `prior_window_ledgers` / `priorWindowLedgers` (`graph_corpus_v1.rs:8581`, `:8639–8648`); served `supersedes` the prior subscription (`:8708`). Frozen page-2 root ledger is `pages: 2, rootRows: 8` (`observations:4601–4610`) vs page-1 `pages: 1, rootRows: 4` (`:3578–3587`). Child lineage: `n2.pages: 2` while root `n0.pages` stays 1 (`:15539–15557`).
3. A **fresh** evaluation of the same exclusive window that happened to return the same rows would emit `pages: 1` and **fail** the ordinary-run artifact exact-compare (`graph_corpus_v1.rs:9012–9016`).

That is §2.4 continuation/demand identity, not accidental row agreement.

---

## Findings

### MINOR 1 — bounded cases inherit an 8-row disposition they did not earn
- File: `demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:2274`
- Exclusive backward selected physical ids omit the a/b tie pair, but `normalizationDisposition` is copied from the unbounded walk (`orderWasNormalized: true`). Violates “normalized iff **this** raw oracle order was reordered” in spirit; expected graph rows remain LLP-0007 order.

### MINOR 2 — C1 `filterOrderMatrix.queries` is not byte-identical
- File: `demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:51` and `:2047`
- C1 `cases` (9) are identical; `queries` grew 9→13 because `FILTER_ORDER_QUERY_NAMES` now includes the four D2 carriers, including `issueDetailTwoWay`. Catalog leak, not a C1 result change.

### MINOR 3 — matcher 3VL fixture is omitted-field, not JSON-null
- File: `crates/snapback/tests/graph_corpus_v1.rs:8628` with `tests/conformance/graph/filter-order-fixture.v1.json:283`
- `None` comes from `row.get("assigneeID")?`, not `filter_matches_expected`’s `actual.is_null()` arm (`live_matcher.rs:3228`). SQL still excludes the two NULL-ish rows. The DK-3 “NULL compares as Less” phantom is not the matcher input.

### MINOR 4 — served `resultLength` is a documented hole, and live-replace freezes `null`
- File: `crates/snapback-engine/src/local/engine.rs:13094` and `tests/conformance/graph/two-way-window-observations.v1.json:3604`
- Initial/resume exact-compare snapshot `.rows` (adequate). Ticket’s “derives resultLength from the snapshot vector” is not a numeric served field.

### MINOR 5 — runner does not re-derive C1 disposition
- File: `crates/snapback/tests/graph_corpus_v1.rs:8801`
- Accepts any backward row whose comparison is `exact` or the pinned name + ticket. `rawOrder`/`normalizedOrder` in the corpus are not checked on ordinary `cargo test`.

### MINOR 6 — child two-way does not exercise the known comments created-tie
- File: `demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:2370`
- 21 unique `created` values. `_id` tie-break on the demand-paged child is untested. Selectable **root** walks still carry the inverted Matrix pair.

### REFUTED-RISK
- **Reverse rows but not `_id` tie (roots):** freezer `graphSortRows` + exact complete physical order + explicit Matrix pair (`graph_corpus_v1.rs:8900–8913`).
- **Resume re-evals page 1:** page-2 rows, named-window proof, exclusive interval, and accumulated ledgers all change.
- **Forward→backward dup-then-dedup:** uniqueness on the concatenated walk plus ordered complete compare (set equality is extra, not the proof).
- **Child parent-interval drift:** same `parentKey` on both pages; observations freeze full `nodeCompleteness`.
- **Sealed artifacts / D1 oracle / C1 cases / memo+delta engine:** untouched except the additive queries catalog noted in MINOR 2.
- **Observation digest:** recomputed `sha256:9286f384…` matches the file.

No MATERIAL defects. The lane’s executable evidence is sufficient to close P-C “Two-way windows PARTIAL” once landed (LLP v0.11 matrix update correctly deferred).

VERDICT: READY

# LLP 0209 G0 Stage B3 — grok review record

**Change:** Zerobugs graph declarations, graph conformance corpus, fixture-derived bounds, G0 exit draft (landed on main as the series ending `40e76924c`, 2026-08-23)
**Reviewer:** grok-4.6, xhigh, read-only, blind to the other family each round
**Orchestrator:** Claude Fable 5 (session snapback-44), under `issues/20260823-llp0209-g0-commission.md`
**Provenance:** every review below was actually received from the named model; verbatim text per round.

## Verdict ledger

| Round | Reviewed | Verdict |
| --- | --- | --- |
| r1 | B3 source | VERDICT: NOT READY (4 MATERIAL) |
| r2 | fix round 1 | VERDICT: NOT READY (3 MATERIAL) |
| r3 | fix round 2 | VERDICT: READY |
| r4 | targeted codex re-check 1 (grok READY standing) | (not run — READY standing) |

## r1 — B3 source

I'll review LLP 0209 G0 Stage B3 as a read-only audit of HEAD against the spec, starting with the skill, the B3 commit, and the governing contract.HEAD is the B3 commit. Next I’ll load the review skill, LLP 0209 v0.5, and the Stage B3 artifacts.I’ll pull the spec sections that B3 must satisfy, then inspect the corpus, freezer, runner, and tickets against them.I’ll load the contract sections next, then parse the corpus, freezer, and runner against them.I’ll parse the corpus and bound tables next, then read the runner, freezer, and oracle field maps.I’ll inspect the frozen corpus against the oracle (comment/label order, field maps, paired worlds) and start the allowed tests.The B3 artifacts compile, host-reconstruct, and the freezer `--check` plus `graph_corpus_v1` (10/10) are green. The comparison contract is not. The freeze copies opaque-handler envelopes as `exact-declared-rows` without aligning child order to the admitted IR, and it puts a request-local `take=50` into a plan-hashed window bound.

`cargo test -p snapback --test graph_corpus_v1`: **10 passed**.  
`volta run --node 24.18.0 node demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs --check`: **PASS** (large CSV absent).

---

## MATERIAL

### 1. (a) `issueDetail` comments are frozen descending; the admitted node is ascending

The control oracle pages comments with `issueCommentsWindow(..., 50, 'desc')` (`demos/zerobugs/control/snapback/functions.mjs:3841`, comparator at `:2836`–`:2839`). The freeze then copies that array into expected rows (`demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:373`–`:375`).

The admitted node is:

```124:124:tests/conformance/graph/zerobugs/queries.mjs
    { nodeId: 'comments', kind: 'bounded-to-many', edgeName: 'comments', ... order: [graph.asc('created')], page: { kind: 'demand' } },
```

The frozen carrier keeps `order: [{ direction: 'Asc', field: 'created' }]`. On `issueDetail-normal` the 21 mapped comments are strictly created-desc, not asc. v1 can express the oracle (`graph.desc('created')`). This is not a grammar refusal; it is a declaration/oracle mismatch under `comparison: "exact-declared-rows"`. G2 executing the admitted node would not match the frozen expected rows.

**Fix:** Declare `graph.desc('created')` to match the oracle. If any equal-`created` group then disagrees on the LLP 0007 `_id ASC` tie-break (the control multiplies id by direction too), add a `direction-tie-break` disposition for that child — do not silently keep oracle order.

---

### 2. (a) Label arrays are frozen in `label.name` order; the admitted edge is `labelID` order

Oracle `issueLabelsGraph` sorts with `compareLabelRows(..., 'asc', false)` — name, then id (`functions.mjs:2814`–`:2821`, `:2895`). The freeze copies that order into `labels: [{label:{id,name}}]` (`freeze-graph-g0-corpus.mjs:354`).

Every admitted label edge is:

```31:36:tests/conformance/graph/zerobugs/queries.mjs
      accessIndex: 'by_issue_label', order: [graph.asc('labelID')],
      page: { kind: 'literal', direction: 'forward', lower: { kind: 'unbounded' }, upper: { kind: 'unbounded' }, take: 16 },
```

On `issueListV2-normal`, 139 items have ≥2 labels: **0** leave name order, **54** leave `label.id` order. The field map still lists `$.labels[*].label.id` / `$.labels[*].label.name` as `exact-declared-rows`. The full-shape refusal (`SNAPBACK_GRAPH_NODE_KIND_UNSUPPORTED` for a fake `bounded-through-many`) does not license pinning unreproducible name order on the *admitted* structural graph. Envelope exclusions must not hide a row-order mismatch (§9).

**Fix:** Before freezing expected rows, sort each mapped `labels` array by the graph order (`label.id` / `labelID`). Keep the name-ordered through-shape as the admission refusal. Do not compare oracle name order as the declared graph result.

---

### 3. (a)/(f) Five of six paired-world slices cannot falsify a wrong authority declaration

All six `pairedWorld` cases invoke `listIssueByID` with `sourceIssueID: "zbav1_internal_issue"` (`freeze-graph-g0-corpus.mjs:843`–`:874`). That target is internal; the ordinary principal’s oracle is not-found. All six freeze the **same** `oracleEvidence` digest `sha256:14104fa1…`.

The `listIssueByID` graph reads `issueListRead` / `issue` / `issueLabelRead` / `label` / selected-label membership / `viewState`. It does not read `comment`, `emoji`, `userPref`, or `issueNotifications`. Hiding those tables, or hiding `viewState` rows of an issue the query never hydrates, cannot change the not-found envelope. §3.4 required six policy-extension pairs that actually exercise those channels (internal root, protected comment, emoji through-path, other-principal view state, preference, notifications), plus a corpus-only `issueLabel` overlay that was never added.

`G0-EXIT-DRAFT.md` row 3 cites “six `policy-extension-v1` pairs” as authority evidence. The records exist; the proofs do not.

**Fix:** Keep the internal-issue pair as the missing-vs-invisible root. For `viewState`, query a **visible** public issue and hide another principal’s rows on *that* issue. Drop comment/emoji/pref/notification pairs until a graph that reads those tables can carry a legal demand vector (the empty-child ticket), or add a corpus graph that reads them without a demand child.

---

### 4. (c) Comments `maxWindowPages = 21` is `cap / take=50`, not a fixture/oracle page count

```570:572:tests/conformance/graph/bound-derivation.v1.json
                "maxWindowPages": {
                  "value": 21,
                  "derivation": "ceil(declared 1,024-comment parent cap / corpus demand take 50) = 21"
                },
```

Authored in `tests/conformance/graph/zerobugs/queries.mjs:183`. §2.6 sizes `maxWindowPages` as pages for the **oracle to exhaust the named interval at declared page size**, × H, min 1. The normal interval is 21 comments; the oracle page is 50 → `ceil(21/50) = 1`. F4 / the worked `issueDetail` example also say `take = 50` is request-local and **must not change any plan field**. `maxWindowPages` is plan-hashed. Using it inflates comments `maxWindowScannedRows` to `21 × 1025 = 21525` and the exit-draft rollup to `22 / 22,592 / 47` (`G0-EXIT-DRAFT.md:105`) instead of the one-page lineage in §2.6.

This is not a mean, but it is not derived from the stated fixture maximum either.

**Fix:** Set comments `maxWindowPages` from oracle exhaustion at the node’s plan cap (`maxChildrenPerParent = 1024` → 1 page for 21 comments), re-derive the six window fields and `windowRollup`, and keep `take=50` as request validation only.

---

## MINOR

- **`issueListV2.maxWindowPages = 977`** uses `1_000_000` store-wide issues / 1024, not the named `projectID` interval. The receipt has 100 projects; per-project max is unknown without CSV. Conservative, but not the §2.6 interval fact.
- **`maxResultBytes` / `maxPageResultBytes`** cite the opaque envelope (`517_010`) rather than mapped declared-graph bytes (`~436k` for the list). The 32 MiB ceiling is still an author-ratify portable boundary.
- **Spec table `emojiCompleteness` translation** is omitted; emoji is excluded as an unadmitted branch (`freeze-graph-g0-corpus.mjs:290`–`:294`). Honest for the admitted shape, not a byte-for-byte serialization of the §9 table.
- **`excludedReason` text** is paraphrased (`"aggregate duplicate; compose mapped node labels"` vs §9’s “compose the mapped node labels under §4.2”; the `bounded-child-window` row should keep its coalescing sentence).
- **`scopeMismatch` pending record** expects `reason: "scope-unbound"` on a class-3 plan whose live classification is `base-not-class-1` (declaration-order precedence, spec `:618`–`:624`). G2 would not emit `scope-unbound` for this carrier.
- **Exit draft** still says “this uncommitted worktree” (`G0-EXIT-DRAFT.md:8`) while `HEAD` is `682d09b86`.
- **Optional `assigneeID`** is in the oracle validator and never appears in the frozen envelopes; not listed as corresponding or excluded.
- **Freezer `existsSync(LARGE_ROOT)`** changes `bound-derivation.v1.json` if the gitignored CSV is present. Absent here, `--check` matches.
- **Comments `window` / 1,024-ceiling arms** are in the field map with the right `when` discriminators but have no frozen case (normal max 21 < handler page 50). Map is correct; coverage is not.
- **Through-shape refusal** is authored as illegal `kind: "bounded-through-many"` (`refusal-candidates.mjs:38`) to mint `SNAPBACK_GRAPH_NODE_KIND_UNSUPPORTED`. The gap is real (no result-bearing through ordered by `label.name`); the candidate is a stunt rather than a well-typed near-miss.

---

## REFUTED-RISK

- **(g) Serving control:** `demos/zerobugs/control/snapback/functions.mjs` is untouched vs `origin/main` (last change `d885c5a8`). Matcher/evaluator: no kernel/engine/sync/codegen edits in this commit; only `graph_corpus_v1.rs` plus corpus artifacts.
- **(b) Identity:** `zerobugs_declarations_admit_with_host_identities` reconstructs all three carriers. Roots get `page:{kind:"demand"}`; literal label pages have `direction/lower/upper/take`; nested projection `scopeNodeId` is the parent. B1 would not refuse these declarations.
- **Physical examined/ranges** match the §2.6 four-step function *given* the logical inputs (`issueListV2` 54,273 / 36,865; `issueDetail` 1,067 = `43+1024` / 26; `listIssueByID` 54 / 37). The defect is the comments page count feeding those products, not the consultation arithmetic.
- **Descending-tie case is correct:** `issueListV2-backward-tied-modified` carries `oracleDivergence: "direction-tie-break"`, field-map `exact-after-id-tiebreak-normalization`, resolves `sourceIssueID` through `issueListRead.issueID`, and re-sorts only equal-`modified` groups. First tied pair `1YV1…`/`QY0za…` becomes physical-id ascending (`issue_1b116…` < `issue_fbd1…`).
- **Comments cursor table** is serialized as required: `complete/any/any → complete`; `incomplete/non-null/non-empty → window`; `incomplete/null/empty → refused SNAPBACK_QUERY_COST_BOUND_EXCEEDED`. Labels use `value.commentsCursor` with `when.cursor: "any"` as §9’s required dotted path (exit-draft gap 5).
- **Search refusal** is the intended D6 `SNAPBACK_GRAPH_SEARCH_UNADMITTED`, not a grammar hole. Class 1/3 `authority.proof: null` matches `GraphNodeAuthorityV1`. Broadcast reason `base-not-class-1` is right for class-3 `viewState`.
- **(h) Tickets** match the tree: tie-break at `functions.mjs:2824`–`:2833`; empty child intervals fail `validate_graph_window_vector_v1` at `graph.rs:4794`; codegen/Rust parity describes the literal-page and projection-scope gaps B3 worked around.
- **(e) Pending G2 records** have the kind-required invocation/commit/expect fields. Evaluator-dependent kinds are pending as the draft states; they are not silently executable.

---

## Answers

**(i) Freezer deterministic?** In this worktree, yes: `--check` with `normal-seed-v1,large-seed42-v1,hot-recent-v1` reproduced the committed files and digests. `derivedAt` is a literal. The only host-dependent fork is `existsSync(demos/zerobugs/fixtures-local/large-seed42-v1)`, which would rewrite bound-derivation status/digest if the CSV were present.

**(ii) Corpus digest cover all case content?** Yes. `contentDigest` is SHA-256 of the JCS of the whole object minus `contentDigest` itself (`graph_corpus_v1.rs:425`–`:434`). That includes `queries`, `oracleCases`, `cases` (paired worlds, five pending G2 records, three refusals), `broadcastInputs`, and `g0ExitObservations`. The Rust test exact-matches `sha256:baf1636b6c0ead8956176a8510830c98f24b768000e3b02a326ab48cd12819f9`. Bound digest `sha256:62da3f6e7f1521d8755fac0c37af1c70b0927fe8d517ffbc97b562a2ba10d98a` is the same pattern.

**(iii) Weakest seam.** G0 never executes a graph, so the freeze treats opaque-handler JSON as the admitted result. That is how name-ordered labels survived a recorded through-node refusal, how 21 comments were frozen descending against an ascending node, and how six hidden-slice ids were stapled onto a single not-found point query. The Rust runner then only checks digest closure, translation-key shape, and host identity — all of which stay green while the comparison contract is already wrong for G2.

---

VERDICT: NOT READY (4 MATERIAL)

## r2 — fix round 1

I'll review the B3 fix-round delta against LLP 0209, starting with the contract, the HEAD vs HEAD~1 change set, and the K1–K10 dispositions.HEAD is the fix-round delta; I'll load LLP 0209 and the key file diffs next, then check the three tickets and serving-control untouched constraint.Serving control is untouched. Next I’ll read the LLP 0209 contract sections and the fix-round artifacts in parallel.I'll start the corpus test in the background and read the smaller diffs plus queries, freezer, runner, and exit draft.Physical bounds look consistent with §2.6. Next I’ll inspect the freezer, runner, bound derivation, and corpus cases, and start the allowed tests.Corpus has no `pending` keys. I'll extract case summaries and keep reading the freezer, runner, and bound-derivation.I'll review the B3 test file against the K2–K9 contract: first the current source and the HEAD~1 diff, then the governing LLP.I'll start by reading the listed artifacts, the HEAD~1 diff, and LLP 0209/0268 so I can recalculate every physical and logical bound against the formulas.I'll review the freezer against K1–K9 by reading the current file, its HEAD~1 diff, and the related contract/docs.The first 1000 lines are in; next I’ll pull the rest of the test, the B3 diff, and the K-contract wording.The freezer is large; I’ll keep reading from the truncated point and pull the HEAD~1 diff plus LLP 0209 contract sections.The derivation JSON was truncated; next I’ll pull the rest of it, the git diff, and LLP 0209 §2.6 plus the §9/0268 mapping.I have the freezer body; next I’ll pull the fix-round diff and the Stage B3/K-item contract language.I have the bound files; next I’ll read LLP 0209 §2.6 formulas, the §9 table, and the git diff so I can recompute each node.Comments `maxWindowPages: 21` looks suspicious against a 1,024 page size — I'll verify that derivation and the remaining freezer/runner logic.I’ll inspect corpus JSON, the partition helper, B1 admission, and the observation type so the K checks have concrete line evidence.Physical sums match the declared totals so far; I’ll verify the comments page-size story, corpus observations, and the three tickets against the actual evidence.Comments `maxWindowPages` is derived from take=50, which the spec treats as request-local. I’ll verify that against the freezer, oracle cases, and paired worlds.# G0 Stage B3 fix-round-1 review

Physical **examined / lookup / range** numbers for all three graphs match LLP 0209 §2.6’s four-step function and match `queries.mjs` / `bound-derivation.v1.json`. The remaining defect is **logical `maxWindowPages` for `issueDetail` comments**: 21 is `ceil(1024/50)`, not the obtainable filtered interval. That is coincidentally the same integer as the normal per-issue comment maximum (21). I could not run `git diff HEAD~1 HEAD` in this read-only session.

---

## 1. Physical bounds (recalculated)

Notation: `P` parent population, `C` `maxChildrenPerParent`, `Q` `maxItems` for `all`. Consultations × entries × `P` → `maxExaminedEntriesPerExecution`. `queryCost.maxIndexRanges` = every actual consultation. `queryCost.maxScannedRows` = Σ examined.

### `issueListV2` — **MATCH**

Root `P=1`, `maxRootRowsPerPage=1024`. Selected-label `all` excludes its own arg from `P`.

| Node | Kind | P | Consult / parent | Entries | Examined | Lookups | Ranges |
|---|---|---:|---|---:|---:|---:|---:|
| n0 listRoot | root range | 1 | 1 range | 1025 | **1025** | — | 1 |
| n1 issueRow | eq-to-one | 1024 | 1 unique | 1 | **1024** | 1024 | 1024 |
| n2 labelEdges | bounded-to-many `C=16` | 1024 | 1 range | 17 | **17408** | 1024 | 1024 |
| n3 labelRow | eq-to-one | 16384 | 1 unique | 1 | **16384** | 16384 | 16384 |
| n4 selectedLabels | direct `all`, `Q=16`, LIMIT 1 | 1024 | 16 probes | 1 | **16384** | 16384 | 16384 |
| n5 viewState | principal + binding | 1024 | 2 points | 1 | **2048** | 2048 | 2048 |

- `maxScannedRows` = 1025+1024+17408+16384+16384+2048 = **54273**
- `maxIndexRanges` = 1+1024+1024+16384+16384+2048 = **36865**
- Root demand lineage (pages=1): window scanned **54273**, ranges **36865**, root rows **1024**, result rows **1024**, result bytes **33554432**
- `windowRollup` = that single lineage

Matches `queries.mjs:96–111` and `bound-derivation.v1.json:105–189`.

### `issueDetail` — **MATCH given C_comments=1024 and pages=21**

Worked example in LLP 0209:1608–1615 with `C_comments=1024`: `43+1024=1067` scanned, **26** ranges.

| Node | Kind | P | Examined | Lookups | Ranges |
|---|---|---:|---:|---:|---:|
| n0 issueRoot | root, cap+1 | 1 | **2** | — | 1 |
| n1 assignee | eq-to-one (worst-case lookup) | 1 | **1** | 1 | 1 |
| n2 comments | bounded demand `C=1024` | 1 | **1025** | 1 | 1 |
| n3 creator | eq-to-one | 1 | **1** | 1 | 1 |
| n4 labelEdges | `C=16` | 1 | **17** | 1 | 1 |
| n5 labelRow | eq-to-one | 16 | **16** | 16 | 16 |
| n6 notification | principal + binding | 1 | **2** | 2 | 2 |
| n7 project | eq-to-one | 1 | **1** | 1 | 1 |
| n8 viewState | principal + binding | 1 | **2** | 2 | 2 |

- `maxScannedRows` = **1067**, `maxIndexRanges` = **26**
- Root lineage pages=1, subtree = whole graph: scanned **1067**, ranges **26**, root rows **1**, result rows **1**, bytes **8388608**
- Comments lineage is a **leaf** (no descendants): per-page 1025 examined / 1 range; ×21 → scanned **21525**, ranges **21**, root rows **0**, result rows **21** (= 21× top-level `resultRows=1`, not 21 comment rows), bytes **176160768** = 21×8388608
- `windowRollup`: pages **22**, ranges **47**, scanned **22592**, result rows **22**, root rows **1**, bytes **184549376**

Matches `queries.mjs:175–194` and `bound-derivation.v1.json:488–601`.

### `listIssueByID` — **MATCH**

Same topology as the list graph with `maxRootRowsPerPage=1`.

- examined: 2+1+17+16+16+2 = **54**
- ranges: 1+1+1+16+16+2 = **37**
- window (root only, pages=1): scanned **54**, ranges **37**, root/result rows **1**, bytes **1048576**

Matches `queries.mjs:235–252` and `bound-derivation.v1.json:924–1007`.

No mean was used in any physical product. Direct `all` correctly uses LIMIT 1 entries, not `C+1`.

---

## 2. Logical bounds

zb5-large (v4):

`ZBUGS_LARGE_FIXTURE_ROOT=demos/zerobugs/fixtures-local/large-seed42-v1 ZBUGS_ATTEMPT=v4 volta run --node 24.18.0 node demos/zerobugs/control/tests/acceptance/gates/zb5-large.mjs`

zb5-hot (v11): same root, `ZBUGS_ATTEMPT=v11` … `zb5-hot.mjs`

| Field | Source fact | H | Declared | Provisional | zb5 |
|---|---|---|---:|---|---|
| **issueListV2** `maxResultRows` / `maxRootRowsPerPage` | hot W=1000 (also cites normal 516) | 1.024 | 1024 | yes | hot |
| **issueListV2** `maxWindowPages` | `ceil(max(516, 1000)/1024)=1` (not 1e6 receipt) | implicit 1 | 1 | yes | large |
| **issueListV2** `maxResultBytes` / `maxPageResultBytes` | normal mapped **436163** | 33554432/436163 (32 MiB) | 33554432 | yes | large |
| **issueListV2** `maxArgumentItems` | 1 scalar + 16 labels | 1 | 17 | no | — |
| label `maxChildrenPerParent` | max(normal 5, generator 3)=**5** | 3.2 | 16 | no | — |
| selected-label `maxItems` / expansion | authored collection | 1 | 16 | no | — |
| **issueDetail** `maxResultRows` | point root | 1 | 1 | no | — |
| **issueDetail** `maxResultBytes` / `maxPageResultBytes` | normal **20261** | 8388608/20261 (8 MiB) | 8388608 | yes | large |
| **issueDetail** `maxArgumentItems` | 1 scalar | 1 | 1 | no | — |
| comments `maxChildrenPerParent` | control refuses at 1024; normal max **21**; large no per-issue ceiling | not recorded as max×H | 1024 | yes | large |
| comments **`maxWindowPages=21`** | **`ceil(1024 / take 50)`**, not fixture 21 | none | 21 | **no in derivationTable** | — |
| **listIssueByID** `maxResultRows` | point root | 1 | 1 | no | — |
| **listIssueByID** `maxResultBytes` / `maxPageResultBytes` | normal **6479** | 1048576/6479 (1 MiB) | 1048576 | yes | large |
| **listIssueByID** `maxArgumentItems` | 1+16 | 1 | 17 | no | — |
| all `maxMaintainedWritesPerMutation` | G0 has no writes | — | 0 | no | — |
| `maxEvaluationTurnMs` / `maxObservers` / `maxDistinctEvaluationGroups` / `maxEstimatedLiveFanoutMs` | operational guardrails 1000 / 1024 / 1024 / 5000 | n/a | those | yes | large |

Byte ceilings reverse-engineer H from 32/8/1 MiB. That is disclosed and provisional; it is not `ceil(observed max × small skewReviewed H)` `/ from largeUsers/ccheever//hot.

projects/---

## 3snapback/.claude/worktrees/. K8 / K9 / Kg0-b10 (/demos/zerobugs/controlfile:line)

**K8 —/scripts/freeze-graph-g mostly0-corpus. honestmjs` at HEAD, (`da251480 one materialc`). I miss could not run `**git

 diff`- in No this read-only means in declarations sandbox;. HEAD Exit~1 (`682d09b draft states that86`) is inferred at from the work `G0-tree log, `EXIT-DRAFTCOMMIT_EDITMSG.md:55–`, the59`. Fixture maxima at ` stillbound-open-der B3 ticket, and the Rustivation.v1 runner that encodes.json:6 the–12 fix` (-round contract21.

--- comments, 5

## 1 labels).
-. How the freezer List works

Pipeline `maxWindowPages= in `main1` is filtered()`- (`interval,955 not ## 1.1e Test6 inventory:

:File `bound-der138ivation.v1: `/8`):

1.jsonUsers:/265cche. **Pin–269`,ever Node/**projects/snapback/.claude draft `/worktrees/ `:24.18.g0-b64`.0` and require/crates/snap
- Large/ `back/tests/hotnormal- fieldsseed carry-graph_corpus_vv `11pro.rs``visional (`:956true` + zb (HEAD `da:5:251480c`; e957`).
2 parent. **Codegen B. declarationsg**. ` (`123bound-derivation3 `682d:167.v1.json09b86`).`,:79

**– `84958Helpers:`, `:85 (not tests961`): copy `–89):** `j`,tests `:/711conformancecs_domain_–/716hash`;graph`/zerobugs / `byte_/{ freezerdemohash`; `freeze `assert_label.snapback.json-graph-g_arrays_follow,schema,0-corpus._graph_orderqueries,functions,`mjs (`:853–refusal-candidates}`71866 into a temp app:`.
- **, enable108Fail`); `validate `graph_query_corpus_invocation:** comments `max` (`124:_v1`,WindowPages` is189 ``); `generateassertInProcess_`, ** pullderivednot** from the_field`; obtainable comments `assert_pro `HostPlan.GraphQuery interval.` carriers forvisional_records_ Derivation isname_validation`. `issueListV `ceil(1022` / `

| `4/issueDetail` /fn` | What50)=21` it ` assertslistIssue |
|By at `bound-ID`, execute---|---|
|derivation.v ` the threeidentity_vectors1.json:731 full` (`227–733` and-shape refusal candidates,: delete `417freeze`)- |graph Minimal the- tempg tree0.
- carriercorpus.mjs:3. **Import host the serving oracle866`, identity ****; six domainswithout** `pro (`963:968 + one-axis`): `demosvisional`. Obtain rotations vs frozen vectorsable normal/zerobugs. |
| `/control/snap maxdependency_shapes` is 21 commentsback/functions. (`420mjs` as (`:455 ESMbound-derivation`) | One; `.vroot-1range.json` capture binds `: use11`); at onlyn0 `js`; wrong demand `node.inlineHandler`./oracle takeId` fails; No writes **50** (` `GraphNode to that file.
functions.mjs:` carrier well-4. **Load384formed.1 |
`,| normal `no_runtime continuation overlay 51 fixtures**_consumer` (` → and a458:508 `) | Four targets50- mock: ` `ctxgraphrow page at `freeze.-_graphdbquery-`_ (`v1` unsupported;72 matcherg0 `-corpus:106ConservativeFallback`; forged`, `969:.mjs:103973`). Binding `invoke_query3–1038` → `SNAP is in`) that is **BACK_FUNCTION_-memory only (`KIND`_ceilMISMATCH(21108`. |
| `/50)=1:115zerobugs_`).
5.declarations_admit_`**.  **Run opaque1024 is thewith_host_ **per-parent handlersident**ities` for (` list cap514 / (:full refusal714,`) threshold | Corpus digest; three query**, not the filtered 50-row names; ** page + interval length.

host ` resume, backwardgraph_plan_**K9 —), theidentity_v1 satisfied` == carrier**; comment for admitted-heaviest normal/refused disposition public detail; large/hot;, declared and correctly point orders; 8 oracle cases: (` out of the974 byte dig typed array**

:ests,-994`). Carrier label
-array6.: LLP order **Map, oracle node 0209: →-label XOR,1693–170 spot declared5 (`format`, graph rows-checks ( `fixture`, `tie** (`353:504, continuationgraphPlanHash`,`):, cost compact `groupCount`, projection-bound, miss `subscriberFanout). |
| ``, `groups[]., **oracle_field_label arraysgroup remaps_and_Ordinal/-sorted by physicalrefusresultalsBytes_/aredependency `_closed`label (`._idBytes/groupState`**, completeness720Bytes`).
-:867 translations Freeze emits complete`) | Per, normal rows at-query field composed graph `freeze-graph label, continuation-g0- maps; `when. bytes/cursor`/`whendigests.
7corpus.mjs:.rows`1317–132. **Synthesize vocabulary detail6`; six; translation gaps cases** (`102 J0:113CS at uniqueness `:; coverage9132`): 7–133 XOR3`. Corpus51-comment window exercised gaps:/unexercised + `;corpus  equal-`3.v admission1.jsoncreated` tie ( refusals.:100265–normalized to `_id |
| `paired100313` ASC), _worlds``.
- Draft1 (`873:103 bytes7`) | Fixture,024-comment ` cost-bound, digest; 6G0-EXIT authoritative pairs; opaque-DRAFT.md present miss.
8. **:==Coverage99**absent– digest102; invocation (`669:705 identities` (;`, ` non1140436163 / `): every field-slice `1459700 /tableDigests`;-map `(status 436471;, reason, when named-slice-only row diff 20261 /)` is 534; linked covered1 / 205 class to case69 ids or;  marked647 un union ==exercised.
9 declared classes. |
9 / 375|. ** `Sixg paired22 / 678 worlds_pending** (`_114broadcast7) match mapped_cases_are maxima2:1265_`):struct presenturally/absent table_frozen` (` in `bound-derivation.v clones104 that3:1241.json:543 differ by`) | Separate–72 pending file digest one named slice`. Draft; oracle; 5 kinds `: results; no104 must be identical `pending` arm–108` states; worlds; reconstruct get their own identities large/hot ** plan//invocations;NOT SATISFIdigests.
10 **doesED**, outside. ** notPending evaluate broadcast file**. |
| `completeness the typed array,** (`652:_labels` (` no pseudo1249:132667`, `126-observation.

**7:12764`) | PaK10 — checklistired-world node`): five structural and 0268 G proofs + mapping2 kinds composition; partition are under-claims, hashed/ except separately.
11.materialization hashes from IDENTITY **Executable corpus Rust helper.**

§ |
| `bounds union** (`9_are_fixture127 rows_ (`derived8:`128 (`G0-EXIT1369:149-DRAFT.md3`): only `9`) | Fixture:pairedWorld17–` +27 counts; provisional`): `

refusal|`. #
 →12. **Exit | Draft zb5 command; | vs observations** (`128 derivation values artifacts |
|---|4:1335 ==---|---|
|`): typed carrier 1 | normal ` COMPLETE | rows from IR +queryCost`; writes ` serialized=0; listdefineGraphQuery` present mapped pages result not / |
| `/ captured  -12read, vector / `{000,000`. | COMPLETE | threeresult, proofTuple |
| `broadcast host}`; large/hot_inputs_complete-admitted carriers only` (`1505 |
| 3:169 in | PARTIAL | `2`) | 7-kind schema six pairedg0ExitObservation vs worlds (`Gaps`.
13 executablefreeze-graph-. **Bounds `{g ledger0-corpuspairedWorld, refusal.mjs:116** (`791:7}`;953– no`, `121pending` on `13723`); no evaluator corpus cases;  —:13739 LLP under`): copy 0268 labels-claim OK plan; typed |
 maxima| 4 observations |, COMPLETE attach | proof closed- fixture tuples onkey + cases normal/-oracle derivonlyations; 6 large, |
| mark unver 5/hot gaps.ified fields `pro | COMPLETE | capture |

--- vocabvisional:true,`

 +## zb 52. K verdict command.
14. executions (this **Hash deferred |
|  runner and6 | PARTIAL)

**K2 write** ( — FIXED** (`or | `-- 8check oracle`) +71 four 6:108 artifacts`, call pair (` + `620 3`). refusal136; large spot  
 deferred6:138Walks mapped5`).

--- `: `

## 2expected124`4–124 JSON, and7` |
|. K1–K9

 for every `labels 7 | PART`### K array1 maps —IAL | normal ` commentslabel observations.id` ( `desc(created +)`source) + child tie provisional bounds → vs |
 fixture `_id` ASC| 8 | `_ — **id` and **FIXED** (NOT SATISFI requires `_disposition inEDid**` freezer | strictly ASC  —2/9 labels that is `issue; order;LabelRead.labelID lives 5` order in `queries. kinds (`corpusmjs`)

- pending.v1.json Overlay plants: |
| 9 two comments |134 COMPLETE:139 | sibling with equal`).

 arm, query `created` andN-shaped |

026 source ids `_its (8 §7 (`a` / `_Gnotz0 enough`-EXIT (` to-1024DRA unFT:.md-FIX103:371`).
): only-– Oracle47` `normal-seed `compareCommentRows-v1/ ↔` applies direction `freezelabel.json` to **both**-graph-g (`580:591 `created` and0-corpus.`); does not read source `id`mjs:1357 the node (`functions–1366’s `order`.mjs:283` ↔ LLP field; `next6-PageResultBytes`2839`), (` 707020:9 so713 desc:1927–1936`) is parsed order but ** / 0268 is `_z`not** order: then `_a`.-checked;45
- `normalize empty/`–50CommentTiesForGraph[]` cases pass, 459–` re-sort vacuously.

**471):

|s onlyK4 — PART Label equal |- Draft`createdIAL** (`760 | Mapping` groups by:847 physical `_id` |
|---|---|`, comments---|
| CLASS ASC (`627:650 lock | ` SAT790ISFIED | paired:817`,World+ used`).  
Fixedrefusal:; `when graphs. at `1040 arecursor: ∈1043`, {non-null `111 `query,null,any2:1114-shaped` /}`,`).
- Case `base-not `when.rows-class-1 ∈ {non- `issueDetail-` (`comments-window-empty,empty,corpus.v1and-child-any}`; translationtie` records a.json:53– JCS uniqueness56; **`) `child |
oracle-|scoped**Translation SEPARCoverageATION.len | NOT divergence() ==` SATISFIED (`1104: translation count; XOR111 exercised vs ` | pending evaluator |
| SCOPE |6`),unexercised`; NOT SATISFI not a list issueED | pending |
-rootDetail comments  `oracleDivergence`.| SCOPE-BINDING3-way `(

```110 | NOT SATIScomplete/4:111FIED | pendingany/6:demos/ |
| AUDIany, incomplete/zerobugs/non-control/nullENCE/scripts |non/- NOTfreezeempty SAT-IS,graphFI-ED | pending incompleteg |
/null|0/ INVALID-corpus.mjs
     empty)`.ATION | NOT SAT id: 'issue

NotISFIED |Detail-comments- fixed:
 pending |
| IDENTITYwindow-and-- Coverage rows | **child-tie', are **not zSATISFIED query: 'issueipped** to field** | hashesDetail',
     - ...
      exist,map translations (`821 oracleDivergences but §3.:847` keys: [{graphNode3 required onlyId: commentsNode kinds `Idquery include, ` kind:audience:surfaceParity ':directionindex`).-
tie`/`scopeMismatch-break', equal- `exercisedBy` I`/`authorityTransitionCreatedGroups: Ds are not1}],
     `; corpus row ...
        expected checked against `oracle only lists `pairedCases`.: expectedFromOracleWorld` (`
- Translations(...,freeze-graph- are **never { detail appliedg**0 to- oraclecorpusValue: normalizedComments.mjs:136.value, ... }), `status`/`
```

Se4`) —reason`/`cursoram: it asserts **overclaim`/`rows ``.groups
 relative === to- the  Over1l` (`1043`) butapping `when` ** mapping armsnever asserts the oracle table** |
| for the same status/ order actually CORPreason are not disagreed**US | NOT SAT rejected.

**K before rewrite. TheISFIED |5 — FIXED** overlay is built (`873  so:1035 kinds structural it will7, but that only`).  
Both is implicit |
| BOUNDS world.

Spec | NOT SATISFI still ` typesEDfixture ` |Digestoracle largeDivergence`?:/`identityDigest`/hot missing rebuilt |

0268 § (` "direction-tie-break"` on §9560 re-record3.4 case consequence:972 kinds (``); non-slice is stated at `llp/0209 `tableDigests-G0-EXITlive-graph-` equal (`947-DRAFT.mdprofile.spec.md::954:49–51202`); only5-`. Ratification table203 named- `:slice rows0`). The runner63 **– differ74 (`986for:994bids`);** ` singular `oracleDivergence`` markscovered_classes == hot declared_classes` on oracle cases and checks (`/102large `2/byteoracleDivergences:1036/` (`graph`). Opaquecomment-cap fields_corpus_v `presentDigest ==1.rs:638 PRO absentDigest` (`,669VISIONAL and897:901-675 does`). That is an`). No ** intentional class-2 nodenot schema** shift rat is,ify comments not a missed declared in these K1.

### `maxWindowPages three K2 — labels=21`. graphs (only  sorted That1 and 3 by graph `label under); the runner cannotID` before demand-claims the compact freeze; name- class table (order OK through)2 beyond- but the leavesshape refused union.

** the bound itselfK6 — FIXED — **FIXED** overstated

- Graph** for in the order paired derivation is `asc-world proof tuples JSON(labelID)`;.

---

## on `issueLabel **not 4Read`, joining** for oracle `labelID →. Ticket accuracy expected label._id`. (h)

** rows
- `labels`.  
`validateInGraphOrder`issues/202608_corpus_invocation sorts mapped23-graph-` des arrayscodegen-rust-erializes the full preimage andadmission-parity- by that physical idgaps calls (`.md353 ``:graph**370_`,authority_ — problempartition_identity_v1 is `386` (`175::387 real`).
- Runner.188 requires`). ` Rust `GraphLiteral strictly increasing physicalcompleteness_labelsPageV1` ids (`graph_ requires `direction`corpus_v1` (`1249:132/`lower`/`.rs:714`) binds everyupper`/`take-100 node proof` (`graph`).
- Name order +.rs composition:222 +– stays a227 projection`). to refusal ` that: reconstructed `issueDetailOrdered `validate_projection_LabelsCandidate` /scope_at`partition_hash`. `listIssueBy requires nested object Oracle `IDOrderedLabelsCandidate `scope_declaredGraph.expected` are `bounded.nodeCompleteness`node_id ==-through effective is_ labelscope rows`-many` (` (parent),,refusal-candidates. then not `mjs:30 recurs-44GraphNodeCompletenesses at the child`);ProofV1`, freezer asserts `SNAP and is not reconstructed (`graph.rs:.

318BACK3_GRAPH_NODE_KIND_–3192CaveUNSUPPORTED` (`960`).at Current: ` reconstruction:961`,queries.mjs` hashes the **frozen `1278: already has** preimage (`1281assert full literal`). List search is a pages (`_eq!(partition separate refusal (`959:36`)_preimage.`, and parent scopesgraph_plan_ `1279`). (`:70`,hash, carrier.

### K3 `:143 — list `sourceplan_hash)``). Calling + `class3IssueID` secondary.is the;_ some69()` groups historical).; residual `_id It path ` does notgenerateIn independently` only — ** rollProcess` is slightlyFIXED loose (`** (verificationdefineGraphQuery` slightly class-2/3 inputs is the B up thin3 path). from the plan.

)

- Backward Accept list** isK executed7 —able as an (`983 FIXED** (`104 open:984 compiler-`,gap ticket.

** `3:`106issues1240/3:202106`,1608 `23152-3graph:1532`).  
Pending`, file: -empty-child `1087:5- casesdemand, closed-window1101`).
-vector.md` keys, host- `count** — validator plan identity, invocationsDeclaredTieGroups(..., claim reconstructed, **no 'modified')` is true evaluation must:**. ` equal emptycase.get("pending ** `intervals` →").69**. `WindowVectorInvalidis_none()`
- Frozen` fields on at pending ` casesgraph.rs:: `declaredTie (`4794`. **Misstatement:**Groups: 69108`, `residualImplicit B0:1083TieGroups: 3 did`) and corpus cases0`, `comparison **not** drop (`1530: 'exact- `:1532`).id-order'`issueDetail` for Corpus `cases (no list ` hidden` kindsdirection-root. Freeze are only `-tie-break includespairedWorld` and`).
- Graph `g0- ` orderpair (refusal-codegen`.detail-

**K8 —internal-root`) PARTIAL** (` on `issueDetail is `modified1369:149` (`freeze- DESC, sourceIssuegraph9-g0ID DESC`, matching-corpus.mjs`, oracle `1339::1193 `compare–1198`).136IssueRows` ( `listIssueBydirection multiplier3ID`).`  
 isHas used on both keys fixture ** for a). With **viewmaxima** constants unique `sourceIssue (`137-state principal**ID`, kernel pair (`2:139:120 `_18`),id– ASC provisional` never121 fires2.

`),Se not →am: `residual as `zb5-ImplicitTieGroups: a substitute root 0` islarge.mjs`-miss proof. **assigned/`zb5-**, not counted Therehot.mjs` is still on (`1347 no demand `(modified, source:135IssueID)` (`-vector51060`), list case:1061`, ` with `1095`).maxWindowPages` ` Unique notevaluated_parents[ source derived ids from `/  makecomments]=[]`.1,000, this

**`issues true, but the000` (`147/20260823 freezer does not prove7:148 it.

The open6-zerobugs ticket `-control-descending`), writes=0issues/202608 (`-tiebreak-23-zerob1444`). Doesugs-control-deviation.md`** — comparator claim **not** generallydescending-tiebreak is true (`functions.mjs:282-deviation.md` prove still describes original “4–2833`). **Misstatement B3 (`maxoracleDivergence` on:** `issueListima not means”V ( theno2 list-backward-tied-modified case). The scan of derivation` freezer does no ** longernot does text,** freeze `oracle that.

 no recompute from###Divergence K:4 " —direction fixtures). `-tie-break null-safe cursor"`. Freeze sets;assert continuation `residual_derived_field` / only cost checks- valueboundImplicitTieGroups: / miss; every 0` equality translation exercised and `comparison: + non-empty or marked — ** ' derivation (`PARTIAL**

exact-id-132Fixed6:

:order133'`6 (`:1087`).- Cursor 1,–109 class is024 summed-batch6`). That `cursor === null reuse is not named matches the spec: ? 'null' the.

** fieldK is9 required : 'non- only for — FIXED** (`null'` (`396 residual1574:169:407 implicit `_id`1`).  
Typed`). ties ( arm Outer detail cursorLL is closed keys =P 0209 `envelope.value?. spec `Graph:2935commentsCursor ?? nullG0ExitObservation–293`7V) (`1472` (``).
- Executable1584 and the draft (` cases: windowG:161 (`0-EXIT-3`); all102DRAFT.md: `4115fixture == "normal:1043`, `110–118`). The-seed-v real disposition4:11161"` (`159`), cost-bound is on5`); byte fields  ` rebound1issueDetail-comments,024 →-window-and to evidence (` empty + null cursor166-child-tie (`0`104: (`5167freeze6-graph-g0`);:1053-corpus.mjs ``, `111:1104–g0ExitObservation71106`;Gaps.len()==:112 draft `:11966`,–121`).

`), authoritative--- all

 `NOT## SAT  miss (`10555. MATERIAL issuesISFIED`:105

1. ** with `Comments8`, `112zb5- `maxWindowPages8:1138` commands=21` is`).
- ` (`167 not theoracleTranslationCoverage` obtainable9 marks filtered: unused interval169 rows**0 (``). Large669/:hot (`705 cannot sit`,bound `-114der0ivation in the typed array`).

Not fixed.v1.json without /:731–733 failing the wrong`, fixture assert expected:

 `queries.mjs.

**(g)- Detail:184`). — held continuation **does not It is plan resume**..** This-cap 102 `expectedFromOracle file does4 ÷ oracle/` not changedemand only take matcher  fills/50evaluator `. productionnext codePage. `Result FixtureBytes` when `no max comments_runtime_consumer` still pinsoptions is `LiveMatchOutcome.nextResult` is 21 → set (`484::ConservativeFallback` **1 page**:495 (`497: at take`). The list page500 50. Window passes`) and ` `next scannedSNAPBACK_FUNCTIONResult: listNext/ranges_KIND_MISPage` (`108/resultRowsMATCH`0:1083/bytes for n (`504`); the detail2: case inherit does  **507not`).** Identity (`111 still21 (`2:1114 goes through `graph215_plan_identity`).
25`, `21- Result: `_v1`hasMore: true`, `21 → `validate_`, `176160`, `cursorPresentgraph_query_768`). derivation: true`, `plan_v1Table does not markcomparison: 'same` (`graph pages-next-page.rs:4640-rows'`, provisional.:4650 ** but `nextPage`).

ResultBytes ===---

##  "[]"`.K8.** LLP
3. Material issues

1. ** 2. **TicketWrong mapped0209 says (h) still a continuation passes mis expectedstates rows still two only when both evidence pass.** Oracle sides resume pointers cases to the same next:** only self-page rows.

 empty-hash `oracleAlso-demand.resultBytes` and: labels ` ticket vsnodeCompleteness` `declaredGraph. `g usesexpected.resultBytes`0-pair- `oracleCursorField (`592detail-internal-: 'value.comments:root611Cursor`;`)'` tie (` and-break ticket vs ` then261`)issueListV2 structurally and `-backward-tied walkapplyTranslation(..., envelope-modified` lacking.value.commentsCursor the expected `oracleDivergence`., envelope JSON
3. **.value.labels)`. There is ** (`448:`G0-no** reconstructionBCAST-IDENTITY451` SAT ``). Translationsoracle envelopeISFIED** for labels are `when.cursor: over-maps → fieldMap. §rows → 'any'`, translation3 so table. it →3 does expected’`. not miss A swapped required une-fire titleexecuted case kinds (`G today,0-EXIT-, but it is extra stillDRAFT.md: label45`, `freeze a borrowed-graph-g, or sibling cursor.

` wrong `graph0-corpus.undefined !==Label` thatmjs:1364 null` would keeps` classify vs LLP labels a 0209: missing sorted cursor and193 length as4 `').non CLASS-/nullother'` NOT matching SATISFIED would rows are consistent.

 beNot accepted.

 material: physical2. **K formulas;4 coverage is a label parallel max table from,  not a proof.**5 not the `oracleTranslationCoverage mean`; need list not equal the field-map `maxWindowPages translations.=1`; Every writes= `(0; normal (`398`). Outer path coalesces; the labels/comments inner path does not.

### K5 — six corpus-local present/absent worlds — **FIXED**

- Six definitions (`1167:1214`) covering liststatus, reason, observation bytes; root, list label edge when)` row , list membership,0268 can §0 be stamped detail root, detail wording `unexercised notification, point view; byte` without the-state.
- H as runner checking `frozenWorld` provisional a refuses  case2 (` `^normal832n-seed ceilings-.

vNo:1`836 (`771 bound:`).772

3. is`), hashes derived **Oracle- tables from a **case `fieldMap + input, ownmean**.

---` is not the `

## 6 query map. `issueidentity`.** Only /Detail ``identity comments `Digest `field`.maxWindowPages=
- LoopMap.query`21`

**Not and `order.** ` assertscomparisonfixture oracle == present "exact-id max comments ( === absent (`21) / page1224-order"` (` size`.

`)637:639- and completeness`). Case Demand/ `complete` mapsoracle child (`1228`). can drift page size is **
- Pa from `50** (`issuequeries[].fieldMapired file storesCommentsWindow(..., full`.

4. 50, ' slice **Bdesc')` at tables1 would not refuse `functions.mjs; these:3841`; runner checks only ` declared freezer graphs.**namedSlice. `graph_plan assertsrowIds` differ _identity_v (`graph1` includes admission50-row continuation_corpus_v at (`graph1.rs:869 `freeze-graph.rs:464-103-g0-0:7corpus.mjs:465`).

Seam1038`).
0`). Car: `coveredNode- Derriers haveIds` are hardcodedivation is codegen ids (`n no `search **-`0membershipceil`,`( node `declaredn 2102`, …) and (`4117-4comment refusal:1211 broadcast cap is the`). Freeze /  query asserts50 they) = -shaped refusal exist (`123621`** (` armbound:-123der8ivation`). (`corpus.v1.json Fragile.:732v1.json if normalization– order:53:57733`).`), changes.


- CoincidenceSparse not an:- normallabel ` choice uses `_ authored certificatemaxCommentsPerIssueid.localeCompare. `fullOracle` is alsoRows: refused **21** (`` (`1143:1147bound-derivation``) (` —543 see.v1.json determin:11`). `:544ism.

### Kceil(21/`, `8496 — full partition50)=1`,:866 preimage — **`) is the ** whichFIXED they**

` did **invocation()` freeoraclenot** use.
 full-shape**-zes register `  (`snap102back4. isgraph `-SEARCHauthority-partition.maxChildrenPerParent_UNADMITv1` with` (per-TED `class`2 /: `parent consume []`NODE_KIND_/ and a fullrefusal cap), notUNSUPPORTED`), not B1 refusing `class3` interval ( the frozen length. Mixing carrierauth mode cap., user `IdNode,Kind asUnsupported` is in incarnation, authority interval with the register (` take 50 asInstanceId, auth page size is thegraphFingerprint K,8.rs error tenant:Id460, providerId,`) but is not delegation) (`558.

`queries. emitted in:572mjs: the B1 validator`). Rust reconstruct7–10` body describess hashes — the **.1024 cap No refusal records** as normal class-2 nodes are corpus max on-frozen plus headroom; these graphs it does not explain strings, so empty window, not re `class- pagesrun2. through` ` isvalidate_graph correct.

Se_query_planam (_v1`not K6): ` on anwindow oracle-Vectorshaped` plan parent.

5. **Child windows id with `parent_ is `args.sourceIssueID ?? argskey: null`.issueID ?? are dropped, 'g0- not refused**corpus-parent-v (`1491'` (`:161514`). Instance`) and ** identity can omit aalways child window instead `direction: ' of failing.

forward'`** (`506:None527 of these weaken`). List paired matcher worlds get/admission a dummy parent key identity of. Self-consistent for a well identity, not a-formed carrier; real parent.

 they weaken### K7 — ** five broadcast kindsoracle→ pendingexpected**, corpus fidelity union has.

 no `---

## pending` — **FIXED**

-4. Digest / `pendingCases()` hash coverage

| emits Artifact | Bound allow? |
|---|Deny,---|
| ` audienceParity, scopecorpus.v1Mismatch, authorityTransition.json` minus, mixedCommit (` `contentDigest`652:667`). | Yes (`
- Written to516 `broadcast-cases:525.g2-pending`) —. Jv1.json` (`126CS of **7:1276all remaining keys**,`, including ` `27`, `1383`).queries`, `oracle
- ExecutableCases` `cases` = (full paired worlds + three `resultBytes`), `cases`, coverage refusals only, observations, gaps (`128. |
| `3`).
-paired Corpus still *-world-fixtures.v1.jsonnames* all` | Own seven kinds digest in ` (`876:caseKinds` (`884`);1354`) but case ` `executableCaseKinds` is `['fixtureDigest` mustpairedWorld','refusal match']` (`938: (`9451355`). Runner`). |
| ` forboundbids a-derivation. `pending` armv1.json` on | both Own files digest.

 (`1394:140`2`). |
|allowDeny` ` `broadcast-cases.expect.gallowed2`- is `completeResultpending.v1.json` | Own(..., '[]', digest (`105 [])` (`6:1066615`). |
|`) — structural Oracle/mapped stub bytes, which | SHA matches “not executed”.-256 of the exact

### K8 frozen — maxima strings (`592, filtered-interval pages, provisional:611`, + zb5, `640:645 no means — **`). |
| PaFIXED** (copired fixtureierDigest, not a formula | J engineCS(`)

- NormaltableDigests` maxima+` frominput rows (Digest`) (`956policy:964-extension `zb`). |
| Nodeav1_` completeness stripped) citations and asserted (` | Domain797 hash of the **outer** node:811`): record 14/ (`1304516:1307/924/30`)./ |
603,| Observation max comments/ evidenceissue  | result21, max labels byte/issue 5 hash.
- Large totals; dependency from receipt, not CSV- (`812vector JCS;:825 group-state J`).CS (`161
9- Label cap:1645: `max(`). |

Gaps:5, corpus generator digest does **not** 3) × include H=3. sibling2 => file bytes except copied 16` (` digest strings (862`) — **correctmax**, not mean.
 layer-ing; List runner binds siblings `maxWindowPages separately`: `ceil(). Table filemax(normal project bytes are  not516, re-hashed hot W 100 from disk —0) /  only frozen1024) = 1`, explicitly `tableDigests`. **not**  Pa1,000,ired `000 (`oracleEvidence`865`). present
- Comment `/absent equality ismax notWindow reboundPages`: to any byte `ceil(102 string4 / 50.

) = 21---

## 5` (`866`).
- Large. Weak/hot/unestverified seam fields

:**The `provisional: runner never executes true` + pinned the oracle + zb5 command (` field map853: +855 translation`, pipeline `30.** Expected:31`, ` rows949:951 are frozen blobs whose`).
- No digest matches `mean`/` themselves. That isaverage` in this the change that would accept a file.
- Physical wrong expected row.

Second numbers are-weak **copied from theest: ** codegenK carrier4** (` coverage889 is self:908-attested`)** with ( `[XOR + count),G2 measures]` strings. They not do derived match from cases §2.6 (.

Thirdspot:-check **K8 “): `maximaissueDetail not` means scanned `43+”**1024=106 is two7`, hardcoded ranges  maxima plus one filtered26,-interval spot comments examined check, not a derivation `1024+1=102 audit5`, window roll.

Hostup ` identities for all22 / three declared graphs **are 1** / reconstructed (` 22592 / 534:54222 / 184`). B1 admission549376 /  would **not**47`.

 refuse thoseSe carriers. Corpusams: digest ** freezerdoes** cover oracle will- freezecase content a. Matcher/evaluator wrong declaration identity is ** if codegen numbersnot** weakened change.; comment cap 1024 is the **control refusal**, not fixture max 21; operational fields (`maxEvaluationTurnMs`, …) are “conservative guardrails”, not fixture facts (`924`).

### K9 — real byte observations; large/hot out of typed array — **FIXED** (vector is typed, not executor-measured)

Typed row (`1317:1326`) has every `GraphG0ExitObservationV1` field. Bytes:

- `resultBytes`: `Buffer.byteLength` of mapped `resultBytes` (`1322`, `1295`).
- `dependencyBytes`: `JSON.stringify(capturedDependencies)` (`1305`, `1323`).
- `groupStateBytes`: stringify of `{result, proofTuple}` (`1304`, `1306`, `1324`).

Large/hot: six gap rows, **not** in `g0ExitObservations` (`1327:1334`).

Seam: `capturedDependencyVector` is plan-shaped fiction (`707:768`): child `resultCount: 0`, to-ones `found: true`, principal `found: false`, regardless of oracle rows. `groupCount`/`subscriberFanout` are hardcoded `1` (`1319:1320`). Real **serialization length**, not real executor capture.

---

## 3. Determinism

**Re-running with the same argv and fixtures should reproduce digests**, with these caveats:

| Source | Where | In frozen digest? |
|---|---|---|
| `Date.now()` ESM cache-bust | `153` | No (refusal **codes** only) |
| `mkdtempSync` | `127` | No |
| `Math.random` | none | — |
| `canonical()` sorted keys | `58:62`, `64:66` | Yes, stable |
| `JSON.stringify` for result/next-page/oracle bytes | `493:494`, `1001`, `1305-1306` | Insertion order; builders use literal key order |
| `localeCompare` | `1146` | Chooses sparse labels for K5; ASCII `_id`s are usually stable, locale-dependent in theory |
| `requestedFixtures` from argv | `38:42`, `1369` | **Yes** — different `--fixtures` changes `corpus.contentDigest` even if cases do not |
| Unordered `Object.keys` | sorted (`773`, `840`) | Stable |
| Map iteration | insertion; counts only | Stable |
| Float H | only in **strings** (`860`, `923`) | Numeric bounds come from the carrier |
| Live `functions.mjs` import | `963` | Read of `inlineHandler`; no disk mutation |

`--check` byte-compares `pretty()` (`JSON.stringify(..., null, 2)+"\n"`) (`50:52`, `1375:1379`), so key order must match the last freeze.

---

## 4. Digest coverage

```1371:1373:demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs
  corpus.contentDigest = digestBytes(canonical(corpus));
  const bounds = boundDerivation(carriers, measurements, tables);
  bounds.contentDigest = digestBytes(canonical(bounds));
```

`contentDigest` is assigned **after** `canonical(corpus)`, so it is not included in its own hash (runner strips it and rehashes).

**Hashed in `corpus.v1.json`:** carriers, field maps, dispositions, **all `oracleCases`** (raw bytes + mapped expected), translation coverage, paired-world cases (including `fixtureDigest`), refusals, broadcast-input table, typed observations **and** `g0ExitObservationEvidence`, gaps, `requestedFixtures`.

**Not hashed into the corpus digest:**

- `bound-derivation.v1.json` (own digest)
- **body** of `broadcast-cases.g2-pending.v1.json` (corpus stores a **path** at `1356`)
- full paired `sliceTableRows` (paired file; corpus has `fixtureDigest` which binds `tableDigests`)

Oracle **case content** is covered. Pending-case **content** is not, by design.

---

## 5. Material issues

1. **Wrong continuation expected rows (K4).** `issueDetail-comments-window-and-child-tie` freezes `hasMore: true` and `comparison: 'same-next-page-pages'` with `nextPageResultBytes = "[]"` because resume is never run (`484:495` vs `1112:1114`). List continuation is done correctly (`1079:1083`). This is the only clearly wrong expected payload.

2. **No bound from a mean.** None in this file.

3. **Missing cases relative to K4’s “executable continuation”.** First page + cursor exist; **next page does not**. Cost-bound and miss exist. Many translation rows are honestly `unexercised` (list `child-bound`, `refreshing`, …) — allowed by the K4 wording.

4. **Freeze is deterministic enough** for default argv; `localeCompare` and argv leakage are the only digest-stability risks. `Date.now` is not in the artifact.

5. **Digest does cover oracle cases.** It does not cover pending-broadcast **bodies**.

Non-material but real:

- Child-tie rewrite does not assert oracle≠graph order (`1040:1043`).
- `residualImplicitTieGroups: 0` is not computed (`1095`).
- Labels completeness keyed on `commentsCursor` (`261`, `448:451`).
- Physical bounds are copied, not recomputed (`889:908`).
- Captured-read vector is synthetic (`732:737` `resultCount: 0`).
- `issues/shelved/20260823-zerobugs-control-descending-tiebreak-deviation.md` is stale vs this freezer.

Serving `functions.mjs` is imported as oracle only (`963:968`). Mutation is in-memory (`installBinding`, mock `db`). The serving file is not written.

---

## 6. Weakest seam

**Detail continuation identity:** the freezer teaches the runner that a comments window is a real `same-next-page-rows` continuation, then stores an empty next page because it never calls `issueDetail` with `commentsCursor`. Everything else about K4 (null-safe `when`, cost-bound, miss, coverage table) can be green while that expected row is false.

Close second: **K8/K9 are ledgers over codegen + synthetic captures**, not independent maxima/observations. The freezer will happily freeze a wrong `queryCost` or a zero-child dependency vector as long as strings say `[G2 measures]` / `provisional`.`cargo test -p snapback --test graph_corpus_v1` passed (10/10). Serving control `demos/zerobugs/control/snapback/functions.mjs` is untouched vs `HEAD~1`. Physical examined/lookup/range formulas for all three graphs match LLP 0209 §2.6.

## K1–K10

**K1 FIXED** — `issueDetail` comments are `desc(created)` at `tests/conformance/graph/zerobugs/queries.mjs:125`. Overlay comments `g0_window_a` / `g0_window_z` share `created`; raw oracle order is `z` then `a` (`compareCommentRows` applies direction to source `id`, `functions.mjs:2836–2839`); mapped expected order is `a` then `z` after `normalizeCommentTiesForGraph` (`freeze-graph-g0-corpus.mjs:627–650`, used at `:1040–1043`, `:1112–1114`). Child-scoped disposition is `oracleDivergences: [{graphNodeId:"n2", kind:"direction-tie-break", equalCreatedGroups:1}]` (`:1104–1106`; runner `graph_corpus_v1.rs:665–675`).

**K2 FIXED** — `labelsInGraphOrder` sorts by physical `label._id` (`freeze-graph-g0-corpus.mjs:353–361`). Runner requires strictly increasing physical ids (`graph_corpus_v1.rs:71–100`, `:620`). Spot-check: 88 of 139 multi-label list rows disagree with `label.name` order; `issueDetail-normal` is `['reflect','p1']` physically sorted, not name-sorted. Name-ordered through-shape remains `SNAPBACK_GRAPH_NODE_KIND_UNSUPPORTED` (`refusal-candidates.mjs:30–44`; freezer `:960–961`).

**K3 FIXED** — list root order is `desc(modified), desc(sourceIssueID)` (`queries.mjs:23`; index prefix `by_project_modified` is `[projectID, modified, sourceIssueID]` at `schema.mjs:91`). Backward case freezes `declaredTieGroups: 69`, `residualImplicitTieGroups: 0`, `comparison: "exact-id-order"`, no `oracleDivergence` (`freeze-graph-g0-corpus.mjs:1060–1061`, `:1087–1101`; runner `:647–658`). Unique `sourceIssueID` makes a residual `_id` layer impossible.

**K4 PARTIAL** — Null-safe class is `cursor === null ? 'null' : 'non-null'` (`freeze-graph-g0-corpus.mjs:396–398`); outer miss uses `envelope.value?.commentsCursor ?? null` (`:472`). Cost-bound (`:1045–1053`, `:1117–1126`) and authoritative miss (`:1055–1058`, `:1128–1138`) exist and match the translation table. Coverage XOR is frozen (`:669–705`; 24 rows, unexercised rows named). **Continuation is not executed:** `issueDetail-comments-window-and-child-tie` has `hasMore:true` / `cursorPresent:true` / `comparison:"same-next-page-rows"` with `nextPageResultBytes:"[]"` (SHA-256 of `[]`) because `expectedFromOracle` is called without `nextResult` (`:484–495` vs `:1112–1114`). `issueDetail` cannot resume: `issueCommentsWindow(ctx, issue, 50, 'desc')` is hardcoded with no start (`functions.mjs:3841`). Spec: a comments `window` without next-page row parity is `SNAPBACK_GRAPH_QUALIFICATION_CORPUS_MISMATCH`.

**K5 FIXED** — Six corpus-local pairs (`freeze-graph-g0-corpus.mjs:1167–1214`) with own identities (`frozenWorld` refuses `normal-seed-v1`, `:771–772`). Runner rebuilds both digests, asserts non-slice `tableDigests` equal, named-slice-only row diff, and `covered_classes == declared_classes` (`graph_corpus_v1.rs:873–1036`). Classes 1 and 3 are covered; no class-2 node is declared.

**K6 FIXED** — `invocation()` freezes the full `snapback.graph-authority-partition.v1` preimage including `class3` (`freeze-graph-g0-corpus.mjs:558–572`). `validate_corpus_invocation` deserializes it and calls `graph_authority_partition_identity_v1` (`graph_corpus_v1.rs:175–188`); `completeness_labels` binds every proof tuple and composition to that reconstructed hash (`:1249–1322`).

**K7 FIXED** — Five kinds live in `broadcast-cases.g2-pending.v1.json` (`freeze-graph-g0-corpus.mjs:652–667`, `:1267–1276`). Executable `cases` are only `pairedWorld` + `refusal`. Zero `"pending"` keys in both JSON files. Runner reconstructs and does not evaluate (`graph_corpus_v1.rs:1043–1243`).

**K8 FIXED** for the ruled contract (with a **new** comments-pages hole below). List `maxWindowPages` is `ceil(max(516, 1000)/1024)=1`, not the million-row receipt (`bound-derivation.v1.json:265–269`; `queries.mjs:102`; runner `:1477–1486`). Fixture facts are maxima (`bound-derivation.v1.json:6–12`). Large/hot fields carry `provisional:true` plus the pinned zb5 commands. No mean is used as a declaration.

**K9 FIXED** — Three typed `GraphG0ExitObservationV1` rows, all `normal-seed-v1`, closed keys (`graph_corpus_v1.rs:1574–1676`). Bytes are `Buffer.byteLength` of mapped result / stringified captured-dependency vector / `{result, proofTuple}` (`freeze-graph-g0-corpus.mjs:1304–1326`). Six large/hot cells are only in `g0ExitObservationGaps` (`:1327–1333`). Draft bytes match (`G0-EXIT-DRAFT.md:99–102`).

**K10 FIXED** — Checklist is COMPLETE/PARTIAL/NOT SATISFIED (`G0-EXIT-DRAFT.md:17–27`). Seven 0268 labels are NOT SATISFIED; CLASS and IDENTITY are SATISFIED; §0 re-record consequence is stated (`:49–51`). Ratification table is provisional where large/hot are unverified (`:63–74`). It under-claims comments `maxWindowPages` (omits it) rather than ratifying 21.

Serving control unmodified. No evaluator/matcher production change; `no_runtime_consumer` still pins `ConservativeFallback` and `SNAPBACK_FUNCTION_KIND_MISMATCH` (`graph_corpus_v1.rs:458–508`).

---

## New MATERIAL

### M1 — comments `window` without next-page proof
**MATERIAL (a)**

`issueDetail-comments-window-and-child-tie` translates `commentsCompleteness=incomplete` + non-null cursor + non-empty rows to `graphLabel:"window"` (`freeze-graph-g0-corpus.mjs:262–266`, corpus expected `nodeCompleteness` n2). LLP 0209’s oracle contract: a continuation passes only when resuming each side yields the same next-page rows; a comments window without that proof fails the corpus.

Frozen continuation (`corpus.v1.json` case id `issueDetail-comments-window-and-child-tie`):

- `hasMore: true`, `cursorPresent: true`, `comparison: "same-next-page-rows"`
- `nextPageResultBytes: "[]"`

`issueDetail` has no comments-cursor argument (`functions.mjs:3869–3892`). The list page case *does* pass `nextResult: listNextPage` (`freeze-graph-g0-corpus.mjs:1080–1083`); the detail case does not (`:1112–1114`). The runner only checks `hasMore`/`cursorPresent` (`graph_corpus_v1.rs:676–678`), not next-page rows.

Fix: resume the oracle (or an equivalent `compareCommentRows`/`boundedPage` of the overlay) and freeze non-empty `nextPageResultBytes`, or keep the first page as evidence and mark the `window` translation unexercised.

### M2 — comments `maxWindowPages=21` is not a fixture-interval maximum
**MATERIAL (c)**

Derivation (`bound-derivation.v1.json:731–733`; freezer `:866`):

```text
ceil(declared 1,024-comment refusal threshold / corpus demand take 50) = 21
```

That 50 is the opaque oracle’s hardcoded `issueCommentsWindow(..., 50, 'desc')` (`functions.mjs:3841`), not a graph demand take. Graph invocations use `take: maxChildrenPerParent` = 1024 (`freeze-graph-g0-corpus.mjs:506–524`). LLP 0209 §2.6: count pages to exhaust each named interval **at declared page size**; `take=50` “may only tighten a request-local budget … without changing any plan field or hash”; the worked `issueDetail` calculation plans **one** comments page and `windowRollup` pages = 2.

Normal fixture max comments/issue is 21 (`bound-derivation.v1.json:11`) → `ceil(21/1024)=1` at the declared cap, `ceil(21/50)=1` even at oracle page size. `21` is cap/page-size, coincidentally equal to the fixture max, and is **not** marked `provisional`. Cascades: comments `maxWindowScannedRows=21525`, `maxWindowIndexRanges=21`, `maxWindowResultRows=21`, `maxWindowResultBytes=176160768`; `windowRollup.maxWindowPages=22` (`queries.mjs:184–193`).

Fix: set comments `maxWindowPages` from the obtainable interval at declared page size (1, provisional if large CSV max is still absent), recompute the child lineage and rollup, and mark provisional + zb5 if the large per-issue maximum is still unknown.

### M3 — two tickets still describe pre-fix corpus evidence
**MATERIAL (h)**

`issues/shelved/20260823-zerobugs-control-descending-tiebreak-deviation.md:22–25` still says `issueListV2-backward-tied-modified` freezes `oracleDivergence: "direction-tie-break"` and normalizes equal-`modified` groups. HEAD’s case has `residualImplicitTieGroups: 0`, `comparison: "exact-id-order"`, and no `oracleDivergence` (`freeze-graph-g0-corpus.mjs:1094–1096`). The live disposition is the comments child tie (`:1104–1106`). Comparator claim at `functions.mjs:2824–2833` remains true.

`issues/20260823-graph-empty-child-demand-window-vector.md:16–19` still says B3 uses the point/list graph for hidden-root and “does not mint a fake parent or interval.” HEAD freezes `g0-pair-detail-internal-root` on `issueDetail` (`freeze-graph-g0-corpus.mjs:1193–1198`) and `windowVector` always emits a comments interval whose `parentKey.id` is `args.sourceIssueID` (`:514–524`), including `zbav1_internal_issue` on a zero-row root.

The codegen-parity ticket still matches the admitted carriers.

Fix: rewrite those two evidence paragraphs to the HEAD artifacts (list residual `_id` layer is empty; remaining control deviation is `compareCommentRows`; detail hidden-root pair exists and still mints a non-empty child interval).

---

## (i) Freezer determinism

Yes, for default argv on Node 24.18.0. `--check` byte-compares `pretty()` output (`freeze-graph-g0-corpus.mjs:1375–1379`). `Date.now()` only cache-busts the refusal-module import (`:153`) and does not enter artifacts. Digests use sorted-key `canonical()`. I did not re-run the freezer; cargo tests rebuild corpus/bounds/pending/paired digests via JCS and they match. Residual risk: sparse-label choice uses `_id.localeCompare` (`:1146`); ASCII ids are stable in practice.

## (ii) Corpus digest coverage

Yes for oracle-case content. Runner hashes `corpus.v1.json` minus `contentDigest` (`graph_corpus_v1.rs:516–525`). That includes `oracleCases` (raw + mapped bytes), paired-world cases, refusals, coverage, observations, and evidence. Sibling files (`bound-derivation.v1.json`, `paired-world-fixtures.v1.json`, `broadcast-cases.g2-pending.v1.json`) have their own digests, which the runner rebinds. Pending-case **bodies** are not inside the corpus digest (path pointer only); that is the K7 split.

## Weakest seam

The comments page size `50` leaked from the opaque `issueDetail` handler into two plan-level artifacts at once. The freezer treats a non-null `commentsCursor` as a `window` continuation, but `issueDetail` cannot resume, so the frozen next page is the empty array and the runner never notices. Independently, `maxWindowPages=21` is `ceil(1024/50)` copied into the plan-hashed child lineage, against §2.6’s one-page comments calculation. Both can stay green while `graph_corpus_v1` only self-hashes frozen blobs and checks `hasMore`/`cursorPresent`.

---

VERDICT: NOT READY (3 MATERIAL)

## r3 — fix round 2

I'll review the B3 fix-round-2 delta against LLP 0209: first the commit surface and the L1–L7 contract, then a targeted corpus/oracle audit.HEAD is the round-2 fix. Next I’ll pull the spec contract, the delta, and the L1–L7 artifacts in parallel.The truncated diff covers the runner, schema, and comments bound. I’ll read the spec contract and the remaining freezer, tickets, and corpus deltas next.Serving control is untouched. Next I’ll inspect the freezer, bound derivation, and how class-2 paired worlds actually flip rows.L2 hinges on whether `commentsPage` actually uses the cursor under this mock. I’ll read that control seam and the paired-world runner next.Freezer `--check` reproduced the frozen files, and the graph corpus tests passed. L1–L7 all hold with file-level evidence.

## B2 hunk (`packages/snapback-codegen/graph-query.mjs`)

Authority derivation now unions a node’s **local** policy inputs with its parent’s **class-2** inputs (deduped on `declarationId`/`kind`/`identity`). Local class still comes from local table inputs only, then `max` with the parent class. The class-2 empty-input refusal uses the union.

B3 needed this: L1 put `.permissionBacking(['visibility'])` on `issue` / `issueListRead`, so those roots derive class 2. Public-read children (`project`, `user`, `comment`, `label`, `issueLabelRead`) have no local backing. Without inheritance, requested class 2 would hit `SNAPBACK_GRAPH_AUTHORITY_UNPROVABLE`. After the change, children carry a partition-equivalence proof naming the parent’s permission-backing.

It does **not** weaken B2 refusals: search is still `SNAPBACK_GRAPH_SEARCH_UNADMITTED`; authored broadcast certificates still refuse; a class-2 node with **no** parent class-2 inputs and no local backing still refuses; requested class `<` derived still refuses. The B2 frozen `issueGraph` fixture is root-only, so its emitted carrier is unchanged. `graph-query.test.mjs` passed.

Serving control `demos/zerobugs/control/snapback/functions.mjs` is untouched. No matcher/evaluator change.

---

## L1–L7

**L1 — FIXED.** `issue` and `issueListRead` declare `.permissionBacking(['visibility'])` while remaining `public-read` (`tests/conformance/graph/zerobugs/schema.mjs:43-44`, `:96-97`). All three graphs request class 2 on those nodes and public-read children; codegen emits class 2 with inherited proofs (`permissionBacking:issue` / `issueListRead`). Rust reconstructs non-empty class-2 partition inputs exactly (`crates/snapback/tests/graph_corpus_v1.rs:233-262`). Three crew-visible pairs actually change oracle bytes and cover every class-2 node:

| Pair | Evidence |
| --- | --- |
| `g0-pair-list-crew-visible-internal-root` | 517 vs 516 roots |
| `g0-pair-point-crew-visible-internal-root` | 1 vs 0 |
| `g0-pair-detail-crew-visible-row-change` | same length, different title bytes |

`paired_worlds` asserts `active_class2_nodes == declared_class2_nodes` (`graph_corpus_v1.rs:1212-1215`). Broadcast stays `base-not-class-1`. Identities re-frozen (`issueListV2` `sha256:5de83ed5…`, `issueDetail` `sha256:0467e4ae…`, `listIssueByID` `sha256:27ce1a8e…`).

**L2 — FIXED.** Resume goes through `commentsPage` (`freeze-graph-g0-corpus.mjs:1004-1005`, `:1079-1088`). Next page is one mapped comment, `g0_window_0050`, disjoint from the first 50, digest `sha256:766a764b9762f427c38d04926229681841d0b09dba80e46c026dee86dfcbd19b`. Runner requires non-empty `nextPageResultBytes` (`graph_corpus_v1.rs:737-752`, `:784-798`). Draft cites the same id and digest (`G0-EXIT-DRAFT.md:125-128`).

**L3 — FIXED.** Cost-bound overlay of 1,024 comments maps to the closed refused form: `kind: result`, `label/graphCompleteness: refused`, `resultBytes: null`, empty roots, `resultLength: 0`, empty continuation, `refusalReason: SNAPBACK_QUERY_COST_BOUND_EXCEEDED` (`freeze-graph-g0-corpus.mjs:491-499`; `graph_corpus_v1.rs:800-812`). Discriminator is `incomplete/null/null/empty` on comments, per the spec table.

**L4 — FIXED.** Child intervals are minted only from evaluated physical parent keys (`freeze-graph-g0-corpus.mjs:525-555`). Crew detail uses `{table: "issue", id: "issue_ded0c2976675c34f4756035d"}` (`zbav1_internal_issue._id`). Hidden-root pair has `intervals: []` and `windowVectorDisposition: BLOCKED` / `SNAPBACK_GRAPH_WINDOW_VECTOR_INVALID` / ticket pointer. Runner synthesizes the instance hash on that path and does not change B1 types (`graph_corpus_v1.rs:180-200`, `:1049-1057`).

**L5 — FIXED.** Comments `maxWindowPages = ceil(21 / 1024) = 1`, marked provisional (`bound-derivation.v1.json` issueDetail n2; `queries.mjs:184`). Lineage: scanned 1,025, ranges 1, result rows 1, bytes 8,388,608. Rollup: pages 2, root rows 1, scanned 2,092 (= 44 + 2×1024), result rows 2, bytes 16,777,216, ranges 27 — matches §2.6 with `C_comments = 1024`. `bounds_are_fixture_derived` exact-checks this (`graph_corpus_v1.rs:1672-1700`).

**L6 — FIXED.** `issues/20260823-graph-empty-child-demand-window-vector.md` names `g0-pair-detail-hidden-root-empty-child-demand`, empty child intervals, physical parent key, and the B1 `SNAPBACK_GRAPH_WINDOW_VECTOR_INVALID` blocker. `issues/shelved/20260823-zerobugs-control-descending-tiebreak-deviation.md` records list as latent (69 `modified` groups, 0 residual `sourceIssueID` groups) and the live comments child tie. Both match HEAD. The third ticket (`issues/shelved/20260823-graph-codegen-rust-admission-parity-gaps.md`) still correctly describes the unfixed JS/Rust admission twin; it was not this round’s evidence target.

**L7 — FIXED.** Checklist statuses match the artifacts. `G0-BCAST-CLASS` is **NOT SATISFIED** (every base is class 2 / projection class 3, `base-not-class-1`; L1 does not create a class-1 broadcast base). Continuation is claimed as a real `commentsPage` resume with the digest above, not as an unresumed window. Frozen artifact content digests in the draft match the files.

---

## Spot-checks (a)

- **Comments cursor discrimination:** incomplete + non-null cursor + 50 comments → `window`; incomplete + null cursor + empty comments → refused cost-bound; complete + any/any → complete. Outer `bounded-child-window` stays excluded as an aggregate duplicate.
- **Label-edge order:** mapped `labels` arrays are `labelID` ASC on physical `_id` (sample `label_0305a306…` then `label_a8bf0091…`). Name-ordered through remains `SNAPBACK_GRAPH_NODE_KIND_UNSUPPORTED` (`refusal-candidates.mjs:35-40`); v1 has no result-bearing `bounded-through-many`.
- **Descending-tie normalization:** oracle first page is `g0_window_z` then `g0_window_a` (`compareCommentRows` × desc id). Expected graph rows are `g0_window_a` then `g0_window_z` (physical `_id` ASC). Case carries `oracleDivergences: [{graphNodeId: n2, kind: direction-tie-break, equalCreatedGroups: 1}]`. Next page has no tie.

Physical bounds match §2.6 (list scanned 54,273 / ranges 36,865; detail scanned 1,067 = 43+1024 / ranges 26). Logical fields use maxima, not means. `cargo test -p snapback --test graph_corpus_v1`: 10/10 pass. Freezer `--check`: PASS (deterministic).

**(i)** Yes — `--check` rewrote nothing.  
**(ii)** Yes — `contentDigest` hashes the whole corpus object except the digest field (oracle cases, §3.4 cases, carriers, observations). Rust recomputes the same JCS hash.  
**(iii)** Weakest seam: class-2 **children** of `issueDetail` are counted as covered by a crew **title** mutation on the internal root (the inherited `issue.visibility` input never independently flips those child rows), while the only honest zero-parent comments vector is still a runner-side B1 `BLOCKED` record. List/point pairs do real membership flips (517 vs 516, 1 vs 0). Large/hot maxima remain receipt-only.

### MINOR (not blocking)

- Paired-world completeness proofs still key parents by **source** issue id (`completeResult` in `freeze-graph-g0-corpus.mjs:622`); window vectors use physical `_id`. G0 does not execute those proofs.
- Draft line 8 still says “this uncommitted worktree”; HEAD is the round-2 SHA.
- Several oracle envelope leaves (`issue.assigneeID`, `project.markURL`/`logoURL`/`issueCountEstimate`, `viewState.userID`/`issueID`, …) are neither mapped nor excluded. Pre-existing; mapped expected rows are unaffected.

### REFUTED-RISK

- B2 inheritance admitting public-read class-2 children is required by §3.1 (“class is at least the parent”) and does not open isolated class-2-with-no-inputs.
- List root windows still `take: 1` while oracle pages are 50/516. Pre-existing identity placeholder; G0 does not execute the graph.

No new MATERIAL. No evaluator/matcher/serving-control change. Tickets do not misstate HEAD.

VERDICT: READY

## r4 — targeted codex re-check 1 (grok READY standing)

(no grok run this round: READY standing from the prior full round; the delta addressed only codex findings)

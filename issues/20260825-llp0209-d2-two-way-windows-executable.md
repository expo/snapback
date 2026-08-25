# LLP 0209 D2 — make two-way graph windows executable conformance

**Opened:** 2026-08-25 (P-C publication-readiness record)

Promote forward and backward root/child continuation scenarios into executable graph corpus rows: today `issueListV2-backward-tied-modified` is only frozen/metadata-checked; no backward evaluator resume or forward→backward traversal runs. Prove first page, resume, reverse traversal, stable ties, and no duplicate or skipped unchanged rows through both evaluator and served scheduler. Cross-link `issues/20260823-zerobugs-control-descending-tiebreak-deviation.md`; freeze no backward result until its permitted normalization is explicit.

**Claimed:** 2026-08-25, session snapback-e9 (claude.ai/code session_01VKza4iiZ918TtDxobNDvvy), sbs-orchestrate lane — in flight. Coordination: this session also holds the superseded pre-port G3-B series (branch `sbs/20260824-g3b-delta-lanes`) whose frozen cases (backward/bounded/NULL root windows, duplicate-app-id, chained delta) feed the two-way-windows lane.

## Local implementation record — 2026-08-25

Status: implemented and frozen locally; ticket intentionally remains open until the local commits are integrated and the LLP 0209 v0.11 P-C matrix is reconciled on the landed evidence.

Implementation commit: `9cd114fe8` (`feat(graph): execute two-way window corpus`).

The additive `twoWayWindows` corpus section and `two-way-window-observations.v1.json` execute 32 exact evaluator observations, with served-path parity for every initial/resume observation. Four existing selectable root orders plus two nullable orders run forward and backward in two pages. The child `comments` demand range runs two pages in both directions. Inclusive/exclusive backward bounds, NULL-last ordering, SQL/matcher NULL-`Lt` three-valued logic, and a backward-established live replacement are separate executable cases.

Backward oracle rows carry the C1 mechanical disposition derived from raw-vs-normalized order comparison. A normalized row names `issues/20260823-zerobugs-control-descending-tiebreak-deviation.md`; an unnormalized row is explicitly `exact`. The inverted logical/physical Matrix tie fixture remains load-bearing. Existing graph corpus rows and sealed artifacts are preserved; the added array-bearing/backward carriers remain outside G3 delta eligibility.

No evaluator arm needed implementation: the landed root and bounded-to-many evaluator already honored backward first-page/resume demand, interval end kinds, continuation-bound demand identity, NULL-last SQL ordering, and physical `_id ASC` ties. The work promotes those arms into frozen evaluator and served-scheduler evidence.

### Verification

| Scenario | Executable coverage |
| --- | --- |
| Backward first page | Four selectable root orders and two nullable root orders, each paired with its forward declaration; evaluator and served scheduler both exact-match rows, order, labels/proofs, and continuation. |
| Root resume | Twelve two-page walks (six declarations × forward/backward), 24 frozen observations; prior ledgers and superseding served subscriptions preserve the complete demand/continuation identity. |
| Child resume | `issueDetailTwoWay.comments` runs two pages forward and backward with a keyed per-parent child range; four frozen observations. |
| Forward → backward | Each of the six root declarations and the child declaration exact-match the complete physical set in both traversal directions; uniqueness plus set equality prove no duplicate and no skipped unchanged row. |
| Stable backward ties | All four selectable backward walks exercise the C1 Matrix pair whose logical/source order inverts physical order; the test requires physical `_id ASC` inside the tied key. |
| Backward bounds | Separate inclusive and exclusive two-ended intervals exact-match their physical rows, completeness proof, and null continuation. |
| NULL placement / SQL 3VL | Nullable `assigneeID` orders keep NULL last independently of traversal direction; the `Lt` case captures the executed SQL predicate and requires matcher `unknown` for missing values while SQL excludes them. |
| Backward live replacement | A mutation wakes the retained backward window and emits one exact `live_replace`; delta eligibility remains `unchanged-backward-not-eligible`. |

Final command matrix:

- `cargo test -p snapback --test graph_corpus_v1` — PASS, 50 passed, 0 failed, 0 ignored, 0 measured, 0 filtered; 1178.06s.
- `cargo test -p snapback --test relational_corpus_v0` — PASS, 4 passed, 0 failed, 0 ignored, 0 measured, 0 filtered; 1.23s.
- `cargo test -p snapback-engine` — PASS, 596 unit tests and 1 compile-fail doctest passed; 0 failed; unit tests 85.23s, doctest 0.45s.
- `cargo test -p snapback-kernel live_matcher` — PASS, 28 passed, 0 failed, 823 filtered; 0.04s.
- `./ref-check --verbose` — PASS, 311 LLP docs, 6,855 refs in 13,035 files, 0 errors, 0 unchecked.
- `volta run --node 24.18.0 node scripts/check-inventories.mjs` — PASS, 356 package tests, 31 script tests, 31 demos/catalog entries, 487 publication leaves, 157 guide pages, 1,871 snippets (four existing near-expiry GAP warnings).

Preparation and freeze checks also passed: root/control `bun install`; control `SNAPBACK_OUTBOUND_ACTIONS=1 bun run generate`; `scripts/bootstrap-ibex-runtime` through `SNAPBACK_IBEX_RUNTIME_LINK_OK`; the canonical freezer targeted Rust run (1 passed, 49 filtered); final freezer `--check` with corpus digest `sha256:cd0af63d12c3a615b0e34386238ecec2708c4ec31e0f2e9358c2a2d0b1a7c318`, preserving the pre-existing bounds digest `sha256:4bc770c50ca2395799c9dc3b79055595307f86db73450a86116c49f021664294`. The additive evaluator/served observation artifact contains 32 observations at digest `sha256:9286f384cd0234b716f03ddd4ab26f97db6f33a553f190e7ad863fcc46aa6d09`.

Fresh-worktree note: the first inventory invocation and first kernel compile reported absent ignored generated guide/demo schemas. Regenerating the declared competitive-checkpoint, todo-v2, rbac, and team-chat caches changed no tracked files; the exact commands above are the final reruns. The repository root has no `generate` script, so the requested outbound-enabled generate command was run from `demos/zerobugs/control`, where it is defined.

Nothing in the requested behavior was inexpressible. The served observation API does not expose a standalone result-length field for initial snapshots, so the served assertion derives it from the exact snapshot row vector while the evaluator artifact freezes `resultLength` directly.

### LLP maintenance handoff

The affected-scope pre-PR audit found no contradiction with LLP 0209 §§2.1, 2.2, or 2.4 and no new design decision. Once these commits land, update the v0.11 P-C row from “backward frozen/metadata-only” to reference this executable D2 evidence; that status change is deliberately not applied from an unlanded worktree.

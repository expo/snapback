I'll do a read-only review of this Snapback2 cursor revision: start from the patch and my prior grok notes, then check source, tests, and LLP 1001/1011 against the new delta.This is a snapshot review, so I’ll stay read-only: patch, prior grok notes, then source, tests, and LLP 1001/1011. I won’t run commands, edit, or look at other reviews.Prior grok marked the last revision READY. Next I’ll read the rest of `revision.patch` and the certifier/test code that implements the new uniqueness and prefix-slicing rules.The patch is concentrated in certifier uniqueness and prefix handling. I’ll read `page.rs` and the surrounding IR/checker paths next to see whether operand traversal and prefix slicing are actually complete.There’s still a prefix slice in the cursor policy path. I’ll check whether `check_all` can still hit it after a structural refusal.**READY**

I reviewed only this snapshot’s `revision.patch`, `prior-grok.md`, LLP 1001 §2–§3, LLP 1011 §B1, and the certifier/IR/tests those hunks actually change. I did not run tests, did not edit, did not network, and did not read other reviewer files. The reported 72 Rust / 216 evaluator / 400 compiler greens are author-reported, not re-measured here.

The prior grok review was READY and had no material findings. The issues this delta claims to close (25 nested duplicate sites incorrectly certified, wrong auxiliary cursor once those certified, `check_all` panic on an overlong opaque prefix) are addressed in the new code. I did not find a remaining wrong-accept, panic-on-suffix, or legal-path regression in the new uniqueness walk or prefix slice.

## Prior findings vs this delta

**Nested duplicate sites.** The old visitor pushed `Expr::Scan` / merge lane scans and skipped `Get`/`Exists` keys and scan operands. A second `Scan` with the same site inside a point key, prefix, bound, merge source, lane scan, setup, or loop page therefore never incremented the root count. Mint still keys the trace by site and takes the **last** range (`execution_record.rs:59–63`, twin `runner.ts:1114–1116`), so the rebound nested scan became the cursor. That is the wrong-auxiliary-cursor bug.

`visit_scan` now walks prefix, `after`/`before`, and range bounds; `Get`/`Exists` walk `key`; merge sources, lane scans, setup, and `LoopDomain::Page` all go through the same walk (`page.rs:174–266`). Nested `Expr::Scan` is always `root = true` (`page.rs:210`). The 25-operand matrix in `nested_auxiliary_page_sites_are_refused_in_every_read_operand` (`merge.rs:692–758`) is exactly those LLP 1001/1011 positions: point keys, scan prefix/bounds, loop prefix, merge source bounds, merge lane bounds, merge setup Get.

I compared that walk to the IR enums and to `walk_expr` in `certificate_policy.rs:1424–1469`. Every `Expr` / `Stmt` / `LoopDomain` / `Scan` / `Read` / `MergeLane` operand that can hold an expression is visited. `page.rs` is stricter than `walk_expr` on merge setup: it recurses into nested `If`/`For` bodies, which `visit_statement_exprs` does not. `Scan.take` is `Bound`, not `Expr`, so it cannot hide a scan.

Non-first merge lanes stay `root = false` so a multi-lane merge still counts as one merge occurrence. A well-formed lane must carry `merge_site == merge.site` (`certificate/merge.rs:39`); a standalone result-page scan has `merge_site: None`, so equal-shape site reuse of a lane scan is already an incompatible-shape `E_TRACE_SUBSET` before uniqueness. I do not treat that as an open accept hole.

**Wrong cursor in Rust/twin.** With the duplicate refused, mint never sees two ranges for the result-page site. Distinct nested site `"nested"` plus cross-operation reuse is tested in Rust (`merge.rs:761–822`) and twin (`test-merge.ts:498–515`): page one is `A1,A2` after `A2`; another operation/site continues to `A3` then empty/`next = null`. Tokens remain table/index/order/suffix, not site.

**Malformed prefix panic.** `opaque-cursor-complete-next-null` is `posts.byAt` (`at`,`id`) with an empty prefix. The test sets `prefix` to three ints (`merge.rs:836`). `index.columns[3..]` on a length-2 vec panics; `index.columns.get(first.prefix.len()..)` returns `None` (`page.rs:307–318`) and yields `E_TRACE_SUBSET` without slicing. Structural `E_ARGS_TYPE` is already emitted and returns before its own slice (`cursors.rs:16–36`). `check_all` still runs `analyze` after structural refusals and **appends** analysis errors (`certificate.rs:241–258, 309`), so both diagnostics survive. I did not find another prefix slice on that certifier path.

## Provenance / control flow

`origins()` is unchanged. Return-path keys still come from executed `Return` through aliases and one-to-one collectors; uniqueness is a whole-program IR occurrence check on that site, which is what LLP 1011 now states (identical expressions can run under different bindings). Engine/twin mint and unselected-arm validation are not in this patch.

Legal paths that should still certify:

- Compiler reads get distinct ordinals (`allocateReadSite`, `lower/expr.ts:775–778`), so quarry nested enrichment does not reuse the result-page site.
- Conditional arms with two sites still produce two `result_pages` entries; each site still occurs once.
- Multi-lane merge: one root (first lane).
- Distinct nested auxiliary + token reuse across operations: covered by the new positive tests.

I did not find a semantically legal unique-site program this walk would now refuse.

## Optional coverage (not CHANGES_REQUIRED)

- Twin only executes Get/Exists. The other 23 operands are Rust `check_all` refusals; uniqueness lives only in the certifier, so that is enough if those Rust cases actually run.
- The 25-operand matrix does not include `If`/`Require` conditions, `DerivedArray`, recurse seed, or object/array wrapping. The visitor still walks those.
- Distinct nested execution + cross-op reuse is only asserted for Get/Exists (the prefix/bound embeddings are not type-legal as `byAt` keys).
- Runtime `engine/scan.rs:47` still indexes `columns[prefix.len()..]` behind “certified table”. Unreachable if this certifier refusal holds; not the `check_all` panic the delta claims to close.
- I did not rerun the 72 / 216 / 400 suites.

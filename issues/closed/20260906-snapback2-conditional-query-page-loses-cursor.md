# Snapback 2: conditional page returns lose the continuation cursor

**Status:** Resolved
**Date:** 2026-09-06
**Systems:** Snapback 2 compiler, query certificates, engine, twin
**Source:** fresh Astra-medium Clique build on npm `snapback2@0.0.6`

The M2 builder's query selects Global or Following with `if global`, returning
a shaped page from either branch. With more than twenty rows, the response is
`capped`, returns twenty rows, and has `next: null`. Standalone plain ranges,
inline shapes, nested point shapes, and aliased pages preserve their cursors.
Splitting the conditional query into `globalFeed` and `followingFeed` restores
pagination; the browser then observes 20 → 40 → 43 entries.

Retained published-only evidence on the office M1:
`/Users/ccheever/clique-improvement/lanes/astra-snapback2-006/`, especially
`snapback/social.q` (`feed`, `globalFeed`, `followingFeed`), the
`evidence/m2-pagination-*` probes, and `diaries/run.md`. The benchmark app is
left unchanged by the product-fix lane.

Independent source inspection confirms the compiler intentionally drops page
provenance whenever it finds a conditional return:
`snapback2/packages/compiler/src/result-page.ts`, `resultPageSite` and its
`conditionalReturn` flag. This is a currently unsupported authored shape,
not a failure of nested point enrichment. Existing single-site page
certification under LLP 1011 §B1 explains the restriction; it does not make
the resulting paginated authoring experience complete.

## Resolution

Carry certified page provenance through conditional query returns so the
selected branch produces a continuation for its actual ordered page. Preserve
authorization, hidden-position exclusion, opaque-cursor validation, and the
engine/twin agreement on incomplete local coverage. Prove both branches over
at least two pages, including a range branch and a merge branch, and invalid
cross-branch cursor use. Update the existing LLP and page recipe with the
implemented behavior. Merely documenting the split-query workaround does not
resolve the requested product capability.

Implemented 2026-09-06 in the conditional-cursors lane. Rust certification now
infers a return-path-to-page map from control flow, replacing the compiler's
single-site declaration and duplicated provenance pass. Branch-local aliases,
ordered one-to-one shapes, and nullable point enrichment preserve their page.
Execution and the twin select the return that actually runs; auxiliary reads
and unexecuted merges cannot choose its cursor. Canonical argument decoding
still happens before execution; scope validation happens before the selected
page or merge discovery, including empty discovery. Same-scope cross-site
cursor reuse remains valid. A non-page return and incomplete local replay
carry no continuation.

Fourteen shared corpus scenarios exercise three pages through both range and
500-lane-bound merge branches, local deletion, hidden nested points, auxiliary
pages, and mismatched/noncanonical tokens. Server assertions prove 20 → 40 → 47
range rows and 20 → 40 → 43 following rows without exposing cursor columns in
the shaped data. The authored Quarry regression covers both branches and a
non-page return. Core regressions reject forged hints, repeated page sites,
and collectors with extra pushes, preexisting rows, early exits, or overwrites.
LLP 1011 B1, LLP 1001 §3, and the existing page guides record the behavior.

Verification: 400 compiler checks, 216 evaluator scenarios (plus 24 server-only
corpus cases), 380 package tests, and all 743 Rust tests across the aggregate
run plus the two affected guide/category reruns. The existing merge suite's
13 tests include the provenance checks. `measure.mjs --check`, `caps`, and
`ref-check` pass. The first fresh-binary doctor sample exceeded its budget;
the retained warm measurement passes both samples (0.148 s and 0.054 s), with
project check at 0.658 s. No benchmark app or instrument was changed.

Review revision, 2026-09-06 (GPT-6 Astra, `clique-cursors`, base `bbe2f85aa`):
executed both findings from `reviews/cursors/astra-review.md`. The uniqueness
walk missed reads inside point keys, scan prefixes/bounds, and merge operands.
With the same page expression evaluated after changing its author binding,
both Rust and the twin returned A1/A2 but minted `(101, B2)`. The checker now
visits those operands and refuses duplicate result-page sites with
`E_TRACE_SUBSET`. An opaque scan with three prefix values on a two-column
index previously panicked in suffix derivation; checked slicing now returns
the page refusal alongside the accumulated `E_ARGS_TYPE` diagnostic.

Before the patch, the two new Rust refusal regressions failed (25 duplicate
operand placements and the prefix panic); the distinct-site continuation
regression passed. The twin's nested `Get` reproduction failed with the same
B2 token. After the patch, all three Rust regressions and the twin's `Get`/
`Exists` refusals pass. Distinct nested reads still page A1/A2 → A3 → empty,
with the first token reused by another operation and read site in both engines.
Affected verification on the owned M5 lane: 72 Rust tests (merge, cursor corpus,
completeness, spike), 216 evaluator scenarios plus the new nested-read checks,
400 compiler checks, and compiler type checking pass. `caps`, `ref-check`, and
`git diff --check` pass locally. Full workspace tests, `test.sh`, and latency
measurement were not rerun for this revision; no timeout was changed. The
parent owns the pending Grok review and integration; this revision is not a
new full-battery or publication claim.

Integration with asset recovery exceeded the Quarry guide's 15,872-byte budget
by six bytes. Its introduction was compacted, preserving the conditional cursor
instructions and asset recovery pointer; no runtime or timeout changed.

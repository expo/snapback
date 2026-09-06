# Feed retained-memory repair r5 — final handoff

Completed 2026-09-06T12:46:33.286726+00:00. The retained-template defect is reproduced and fixed. Source, affected checks, required measurement, one first original client curve, and full native equivalence are complete. Parent owns independent reviews, consolidated LLP wording, landing, interaction with search, and publication. No reviews were launched or read by this writer beyond the supplied completed own-family finding.

## Source and transfer

- Existing named lane: `/Users/ccheever/projects/snapback-worktrees/clique-feed-residual`, branch `s2/clique-feed-residual`, **clean**.
- Source: `2cd0872d2f8a5cad1e0bf6730a3d5e84385cc064` (parent source `72c2a11c56119d9908d1df9a89d4bd9e5f9410fe`). Three files changed by r5: certificate helper, index template, merge plus existing registered tests; +244/-35. No generated/publication/version/config/script/doc changes.
- Metrics-only HEAD: `04bc9d930753326e1069a74f5ee3d8108587acc1`. One append at `snapback2/metrics/loop.jsonl:209` for source `2cd0872d2`, `2026-09-06T12:37:07.054Z`.
- Verified bundle: `../source-final-r5.bundle`, SHA256 `c24aa10fda045968e72f5bacc9fa0eb3361384f53e801d39ae309407a23cacf6`. Named branch HEAD, prerequisite/exclusion `d9ed822aa66ebb5dfd0367a59bc0e454ba1ecd18`. Contains 72 → 2cd → 04bc; prior bundles remain intact.
- Combined source diff against d9: `../evidence/repair-r5.diff`, SHA256 `a537f302f7f861a69200e5c5c8f6f9ec95e9850eed7149efe4e2599804064594`; per-file bindings in `source.json` and `../evidence/artifact-candidate-r5.json`.

## Reproduction and accounting

The existing `engine::merge::tests` module constructs the public admitted program with 64 distinct authored prefixes, text(8192)/int/id index, take 1, and 8,192 four-byte scalars. It executes on an empty table: 64 traced ranges, zero examined heads, Complete, empty result. The existing fixture calls the fields `author`/`at`, equivalent to the finding's `scope`/`bucket`.

Before correction, the actual template parameter vector/string capacities total **4,202,944 bytes**. The unused encoded wide prefixes alone are **4,194,432 bytes** (64 × 65,538). The unchanged certificate admits **2,140 steps / 68,480 heap bytes**. The assertion fails. This is direct retained-object capacity evidence and an admitted engine execution, not a process-RSS estimate. The whole template would cost more than this parameter-only lower bound. Preserve `before-reproduction.diff` and `../evidence/retained-before-r5.log` (exit101).

After correction the same case retains **859 bytes**, within **2,144 bytes** of accounted reserve. `empty_wide_merge_templates_fit_admitted_heap` also checks two-column rebinding against actual rows in buckets 0 and 63. The fix shares one template for the entire merge, removes the per-authored-lane optional-template vector and lane template index, and drains unused equality encodings. Certification already fixes table/index/order/prefix width across lanes. Evaluated after/before/range values must still compare equal to use the template; all mismatches and all refills use the original strict seek.

The allowance is:

`min((L + N + 2) × 32, actual_evaluated_lanes × (sizeof(Scan) − sizeof(&Scan)))`.

The first term assigns one of the existing four fixed units in `(L+N+2) × (3×height+4)` to the template, using the existing 32-byte calibration. The second makes this a concrete storage trade: r3 borrowed each immutable Scan rather than cloning it as the first-feed implementation did. On this target Scan is **216 bytes**, its reference **8**, so each actual descriptor saves **208 inline bytes**. Saved descriptor backing allocations and the removed r3 template-index field are additional savings, not spent. Six real low-user lanes save **1,248 bytes**; they can retain the ordinary unbounded-head template. No viewer/audience/timing constants determine admission. Empty-table lanes still save their descriptors; an empty discovery creates no template.

Every retained capacity counts: the optional box and inline structure, SQL string, parameter vector including spare slots, table/index name strings, encoded bound strings, cloned typed bounds, tuple vector capacities and their strings/bytes. Unsupported bound containers refuse template admission. Borrowed bound capacities are checked **before** typed clones, then actual retained capacities are checked again. A rejected wide template therefore creates no extra typed-bound copies to discover its size. Its transient SQL/encoded parameters are the same ordinary scan-query construction; they die before fallback. This is a bound on the added template state within the existing calibrated admission model, not a whole-engine/process allocator proof.

A wide after/before/range control would retain **394,508 bytes**, so it refuses the **2,144-byte** allowance. Execution still returns the independently scanned first row, examines a/b/c via strict refills, retains all three receipt images, and keeps the 63 empty lanes. The raw-IR control has no opaque page descriptor and correctly has no `next`.

## Validation

- All **399 core tests pass**, one pre-existing ignored test unchanged, original `local-proof` nextest profile (7.854s execution; 36.81s command including compilation/discovery). Doctests, caps, refs, and diff check pass.
- Six focused merge tests cover wide/empty prefixes, capacities and exact admission boundaries, oversized name parameters, after/before plus all four range operators, repeated/rebound prefixes, ascending/descending tied keys, strict refills, overlaps, dynamic per-source after/before/range, system/nonuniform rules and retained heads. Existing core coverage preserves first images and rollback from 53fdada. No new test files or registrations.
- Frozen native and Hermes production builds pass; media and release inputs built, package prepared before measure. `../evidence/commands.jsonl` and `launched-pids.jsonl` retain commands, start/load/terminal data and PIDs; individual labels retain all logs.
- Required `measurement-r5`: **PASS exit0**, 26.18s command. Warm build .18s; incremental 2.02s; installed consumer 19.29s; project check .521s; doctor .362/.056s; init→dev 1.107s. Original deadlines and measure script unchanged. The normal development consumer explicitly accepts its existing effects-only no-engine block; no red consumer was retried. Hermes production is a separate successful build. Full row and line are in `measurement-row.json`.
- After the client samples, retained native harness ran four iterations per user (three warmups plus serialization witness, no extra client curve). **42/42 byte-exact comparisons** against both retained r1 and r3 pass: full Execution (including result/trace/receipt), delivery envelope, wire, and certificate, both users at all three checkpoints. See `full-equivalence.json`.

Test-development failures remain: the initial oversized-bound test incorrectly expected an opaque cursor for raw IR; the exact-capacity test initially ignored spare capacity in its borrowed input strings. Expectations were corrected, with all logs preserved. An optional external layout executable initially failed on panic-strategy/LTO toolchain mismatch; the compiled LLVM constants prove 216/8 without linking or rebuilding core (`layout-constants.ll`). These are probe/test setup failures, not suppressed product failures.

## First original client curve — r5 only

| Checkpoint | u0500 p95 ms | u0005 p95 ms | Ratio | Verdict |
|---|---:|---:|---:|---|
| 10% | 11.665458 | 5.842042 | 1.996811731 | PASS |
| 50% | 11.311208 | 5.309625 | 2.130321445 | PASS |
| 100% | 11.809958 | 5.283500 | 2.235252768 | PASS |

Exactly one first curve per checkpoint, using unchanged `run-curve.py` and `curve-probe.mjs`: original packaged client on Node 20.19.4, 3 warmups + 20 sequential samples u0500 then u0005, 30s request timeout, nearest-rank p95 index18. All **138 observations** including warmups keep exactly20 rows, capped/cursor/seq/dataHash; independent SQL top-20 oracles pass. Immutable checkpoints, backend hashes, final seq and compiled-project semantics pass. All three task servers exited0 and renewed task-only sessions were removed. There was no replay/reseed, global quiet requirement or selective retry.

Evidence per checkpoint: `../curve-{10,50,100}/evidence/candidate-r5-client-timings.json`, `run-candidate-r5.json`, `top20-oracle-candidate-r5.json`, and first `candidate-r5-{u0500,u0005}-result.json`. `first-curve-summary.json` records p50 and load; `curve-provenance.json` records hashes and validates the original frozen package files against retained r3 bindings.

The first-curve PASS is a fact, not a causal speedup claim. Low-user p95s exceed r3's first **3.607250 / 3.795541 / 4.106917ms**; r5 low medians are **3.890916 / 3.939167 / 3.919833ms**. Shared-machine first-minute load averages were roughly14–20 during the new curves. No causal slowdown or absence of slowdown is inferred from twenty samples. Source audit finds no padding, audience cache, receipt omission, or denominator timing branch; ordinary low-user lanes have room for the shared template. The original published low-user baseline is approximately16ms. First-repair100 low3.722375ms remains the stricter additional comparator, not a fastest-ever gate. Original r3 first ratios **2.766766096 / 2.860846188 / 2.970861841 PASS** remain untouched, as do r2's red100 and experimental r4/batching evidence.

## Artifact custody and incomplete r3 measure

Production `../bin/candidate-r5-production`: SHA256 `1d680a9388d84d1391f85f4e4ec4ade200064651563150cc0e0201fa0ca46288`; native `../bin/candidate-r5-native`: `d0e668eb04bff80e9767bf3eb2eb0174a08950ea071b1b8270d103bc2f78aa4c`. Curve sibling media remains the original `../bin/snapback2-media`, SHA256 `177be2e3d26cab362cf45be471af5725e94f50255eb897977d7a37bdc4cfc4cf`. Newly built media is retained separately as `candidate-r5-built-media` (hash in artifact JSON), not substituted into the original instrument. The existing measure's stale production-size target was preserved under `prior-target-production-snapback2`, then populated with the frozen r5 production bytes for its size stat; timed operations use the separately warmed normal release binary. See `measurement-inputs.json`.

All current private compiled-project bytes are **2df1a119f0342ef330e0ba1079387fbf767dfa6a7dc9238fb9ddc4fea2e06dfc**, semantically bound by `../evidence/r3-generation-bindings.json` and the fresh r5 certificate/envelope comparisons. The older 6dc pre-startup byte hash is not relabeled as this artifact.

Prior `measurement-r3`, source72, launched **2026-09-06T12:02:36.584769Z**, PID18279, remains **INCOMPLETE**: preserved launch, empty log, absent original process, no terminal record and no metrics row after worker compaction/session failure. It is neither PASS nor an inferred product failure; no unchanged72 retry occurred. See `prior-measure-disposition.json`.

## Proposed existing-LLP wording for parent

For LLP1001 §3's lazy-merge paragraph and LLP1010 A5 semantics, replace the claim of a retained SQLite cursor for every stream with:

> Every distinct stream keeps its logical head and examined position. Uniform lanes whose index ends in intrinsic id use the connection's bounded statement cache for one-row seeks; other lanes keep their ordinary live cursor. One optional initial SQL template is shared across the merge. It retains no equality-prefix encodings, checks equality of evaluated after/before/range bounds, and falls back to ordinary strict seek for differing bounds, refills or storage refusal. Its complete retained capacity fits both one fixed-work unit of the existing merge heap reserve and the inline storage saved by borrowing the actual lane descriptors. Borrowed bounds are preflighted before cloning. This storage trade leaves certificate, heap ordering/work, trace, receipt, authority, result and cursor semantics unchanged.

Parent can fold this into the consolidated first-feed/r3 account and retain the distinction between calibrated heap admission and actual template capacity. No LLP was edited in this lane. Parent's integration-inputs says both fresh source reviews are underway on exact2cd; neither was read here. Feed can be integrated independently of search per parent steering; this report makes no search-integration or publication claim.

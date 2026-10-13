# PAGE wave 9 — complete

Worktree `/home/ccheever/projects/sb4-w9-page`, branch `sb4-w9-page`, immutable base `e82bb70b97` (0.4.24). Final reviewed semantic source: `f6025c0c91673039c7efe17525db3abdf81ab199`. Product and review changes are committed with Charlie Cheever / ccheever@firewoodagent.com; nothing pushed. The moving coordinator `sb4-loop` ref is not the comparison base. All requested PAGE work is implemented, tested and committed; the required clean full Rust qualification passed. The report and evidence archive accompany the final delivery commit.

## Per item

| Item | Change | Selected commits |
| --- | --- | --- |
| #5 / NA1 | Merge owner and capped readable viewer-membership parent ranges under one ordered, deduplicated cursor. Finish live discovery before disclosure; unknown/partial/horizon or resource cuts return empty incomplete without a cursor. Preserve static cursor descriptors and discard unused speculative indexes. Normalize required booleans and known true/false guards before pin/coverage analysis, including argument pins while preserving nullable semantics and negated-probe restrictions. Print default completeness notes as verdict / who / what, with detail under verbose; suggest no one-query fix only when supported forms are absent. Extend Lean, difftest generation, simulator and device coverage. | `0369d09b8d`, `550a347404`, `a50d2972cf`, `6599814c56`, `aac1df32ea`, `eccfc76236`, `97bf94e974`, `377a92f1cf`, `7cf806389b`, `c30763121c`, `c99ac8c009`, `2984cf9c0d`, `78016af4e2`, `901e1a2ea4`, `65b4473dd7`, `a2b52d2b1b`, `89b0a2c175`, `7afd4b8cba`, `f6025c0c91` |
| #4 | Hidden stored and missing maintained keyed groups return null; admitted missing groups return zero. Private scalar types stay nullable unless current authority and inherited-parent liveness are proved. Bare narrowed keyed-view reads receive a check note. Authority facts respect sealed witness targets, writes, rebinding/shadowing, helper control flow, viewer scopes and loop transfers. Saved or effectful buffered rows cannot recreate parent liveness. | `9d4f1e4316`, `49019f1234`, `68c0b68f7d`, `776a3f9ee6`, `af45de22ba`, `416036dbf9`, `c0c3f07bb1`, `ea9972e5ce` |
| #15 | Plain single-column unique reference keys prove a one-child bound for non-null parents, combined with explicit caps by minimum. Null groups remain unbounded and survive serde. Sum-fed cascade is refused with the system/alternate-delete and hidden-sum overflow explanation. Unchecked-reference advice requires a mandatory exact target-ID lookup before every reaching direct-argument write, including helper CFG joins and forced/skipped lazy operands. Missing-bound advice names cap or unique alternatives. | `9d4f1e4316`, `0230ecc787`, `6ba27fc65b`, `451946bd25`, `8d025d3908`, `fadb58b04c` |
| #11 | Exhaustive emitted source-edit goldens compile rewrites against their input schemas and execute independent expected behavior. Remove the unsafe expiry-reference rewrite; correct cross-parent comparisons, partial positional probes, operand names, rule/program point-key advice, and named old/next update syntax. | `86a234b8a6`, `d1980ea439` |
| #18 PAGE | Suppress cursor advice only when the same cap group is pinned on every branch, the cap fits take and the combined examined allowance. Membership discovery is not that proof. Null-exempt reference caps need a statically non-null common pin. Suppress delete/read advice only for proved implication, preserving nullable boolean semantics. | `172efee759`, `8b7e8e4a6a` |

The merged-page resource ledger prepays discovery, source/target read-ahead, scratch, dependency/probe allocations, frontiers and actual cursor encoding. Distinct-key serialization uses one exact prepaid capacity, including legal escaped text; NUL remains invalid.

Boundary coverage includes canonical positional selection, fixed/intrinsic IDs, actual physical index width/labels/2048-byte bounds, omitted implicit-id suffixes, capped one-row total-unique sources projecting arbitrary required/nullable parents, exact extra residuals, and eligible-first selection among competing unique keys. Null in a selected point key remains no-row; null in a residual equality can identify an actual null-parent witness. Signed integer literals compare canonically across rule and expression IR without allocation or changing expression/cursor shapes.

The independent model checks original expression-form guard eligibility before runtime scalar normalization. A rejected compound negation cannot become a completeness grant merely because an argument value folds it. Normalization verdict equivalence and the connection from a normalized positive grant to its original read-rule disjunct are proved.

## Amendments and qualifying reviews

- LLP 3000.036.001 §§9/14: **both READY**, Muse Spark 1.3 contributor high and a fresh Codex GPT-6.1 Sol high, round19, full scoped delta `e82bb70b97..f6025c0c91673039c7efe17525db3abdf81ab199`. Amendment SHA256 `3b2ca7cd17e291a6aa532e704fc59e8f9540aa1ab1462458a39a95a71847b72f`. Prompt and verbatim reviews: `llp/reviews/3000.036.001-page-w9.r19.*`, committed `ee0e339c80`.
- LLP 3000.013 §14.7 and LLP 3000.039: **both READY**, same required model roster, full-delta round12 frozen at `6599814c56`. Verbatim artifacts: `llp/reviews/3000.039-page-w9.r12.*`, committed `28f156bdf4`. Later advice/test changes and page-grant completeness helpers do not change these maintained-read/reference semantics.
- Earlier findings and verdicts remain verbatim with provenance. A scope-limited tip-only view review in round11 is not the qualifying pair. Reviews are mutually blind; no author acceptance or review was fabricated. Round17/18 findings and the root-found runtime-scalar overclaim are resolved by the final source.

## Verification

The required command **passed with exit0: 4,672 tests passed, zero failed, 30 ignored across309 unfiltered harnesses**, against `ee0e339c80c9a32e0cdcc163e24894246e6d6073`, whose four crate trees and manifests match the reviewed semantic freeze:

```sh
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_BUILD_JOBS=16 cargo test -p snapback4-core -p snapback4-lang -p snapback4-device -p snapback4-sim --no-fail-fast
```

Final scoped and artifact evidence:

- Native difftest `run --seed 0 --cases 20000 --workers 8`: **20,000 generated/compiled, 1,166,103 executions, zero disagreements, zero unexpected binder/runtime/generator errors**. Coverage includes388 membership pages193 reordered named.
- Lean difftest `run-lean --seed 0 --cases 20000 --workers 4`: **20,000 generated/compiled, 52,010 executions, 15,412 passed, 4,358 unsupported, 230 disagreements, no new signatures**. Exit1 is retained-family output, not a zero-disagreement claim. The four already-classified families are code E_RULE~NOT_FOUND3, continuation-next68, next132 and prelude-code E_RULE~NOT_FOUND27. The generated stream exercises371 Boolean-grant cases.
- `lean/check.sh`: **68/68 examples, 58 audited theorems using only standard axioms, seven oracle fixtures; PASS**.
- Final direct difftest Lean **29/29**, smoke **13/13**, native branch merge **59/59**, membership paths **9/9**. Direct regressions cover boolean literal/argument/nullable/compound guards, known-false Or folding and signed membership residuals, with actual native/Lean data and completeness comparisons.
- Locked Linux wasm: **2,278,983 B raw / 690,290 B gzip**, budget **690,790 B**, strict check **PASS**. Client package build **PASS**. Whole-artifact delta over baseline2,245,422/679,351 is **33,561 raw / 10,939 gzip**. `b57fbf7ff4` records the final measured budget increase plus required500-byte platform headroom in budget, journal and commit. No macOS/per-feature attribution or runtime resource-ceiling increase.
- Readauth census: **1/1 PASS**,409 mutation occurrences/89 distinct private write sites.
- CLI check notes: **6/6 PASS**. Reference check **PASS**:541 LLP docs,11,039 refs,zero errors/unchecked; repeated after the completed proof archive/report.

Every Cargo invocation disables incremental and dev/test debug info in the same command. The final difftest release target is separate from the native suite target to avoid holding the shared build lock; only the380MB stable release cache was copied, with no hardlinks or other-worktree edits. No full scripts/test.sh ran.

Completed earlier broad runs had stale assertions (4,660 passes/three failures; later4,662 passes/one stale frontend failure/30 ignored,308 unfiltered harnesses). Test-only repairs `44180581c0` and `f80d1dde81` pass readauth88/88 and frontend40/40. The overlapping build was interrupted at the newly discovered argument-pin gap (exit130, zero completed harnesses). These failing/interrupted attempts are superseded and are not qualification. Their completed logs are retained under the proof archive's superseded directory.

An optional Snapback1 check-inventories run reported unrelated root artifacts/registry/profile drift and no complaint naming the new PAGE Rust test; that gate is outside the Snapback4 fence and is not a PAGE qualifier.

## Ownership, decisions and deferrals

HAND owns `branch-membership-v1` negotiation; PAGE declares capability and leaves the pointer. DX owns broad guide/starter/recipe text; PAGE updates directly affected maintained-read facts and compiling snippets. No release, transport, adoption, outbox or media implementation was taken.

The sum-fed cascade restriction is the explained outcome allowed by #15, not a deferral. The four classified Lean disagreement families are retained; no new signature is introduced. No PAGE implementation or requested qualification remains deferred.

Four early commit identities were repaired without changing tree/index/worktree content. Original objects remain at `refs/page-wave9-pre-identity`; every live PAGE commit has the requested author and committer. Nothing was pushed.

Durable campaign reports and compressed logs: `snapback4/reports/20261013-page-wave9/`. Final suite result, stable input-object verification, exact commands, retained-signature counts and archive SHA256 digests are in `verification.json`; all committed PAGE changes are listed in `commits.tsv`. Focused difftest29/smoke13/branch59/paths9 outputs were captured in agent tool transcripts, not filesystem logs; no stale log is presented as their final evidence. The final blind Codex reviewer independently ran190 focused tests including29 native/Lean tests.

Qualification ran from 2026-10-13T01:26:32Z to 2026-10-13T02:20:44Z (UTC). The six four-crate/manifest input objects still match the final reviewed native source; later commits carry only review, measurement and delivery records.

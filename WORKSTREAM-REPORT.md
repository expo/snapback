# EVOL — wave 21 release evolution

Implemented and committed on `sb4-b21-evol`. No push or version bump. The user-visible `guide changes` entry targets **0.4.37**. SEC6 owns write intent, projection privacy, session validation and rule-review changes.

## Changes and commits

| Item | Result | Implementation commits |
| --- | --- | --- |
| #1 Adoption | Refresh backfill input fingerprints on every write under the declaring release; admit matching recomputation while retaining genuine conflict refusals. Missing nullable rename destinations are absent rather than conflicting nulls. | `5bee0be37d`, `8d520ca003` |
| #2 Previews | Honor declared down and rename projections. Name actual narrowed fields, new/renamed identities and hidden reference parents, with applicable remedies. Distinguish retained empty/default images without claiming their provenance or promising replacement down values. | `9170d877a5`, `35f40fcf04`, `87bb24db90`, `c88e594b07` |
| #4 Rolled-back views | Generate a reviewable loosened target bridge with compatible joined domains and retained newer tables. Preserve target operations/rules, list affected reads/writes, and require manual application review. Table-level `renamed from` preserves identity and references. Document down limits for files, images and absent tables. | `8d520ca003`, `9170d877a5`, `e0f5f818be` |
| #5 Expressiveness | Identity-preserving asset/file column renames; ordinary indexed cross-table backfill/down lookups; migration-only bounded ledger-backed UTF-8 `fileText` and duplicate-preserving `nonemptyLines`. Preview and retained evidence provide reversal where representable. | `8d520ca003`, `35f40fcf04` |
| Regression found by full suite | Keep temporary file-access metadata inside actual server migrations, preserving native legacy no-op database bytes. | `00508bfd06` |
| Documentation and evidence | Keep existing guide/README budgets, execute changed examples through packed qualification, and retain copied lane/differential evidence. | `e0f5f818be`, `e1ddd0aebe`, `db62d60459`, final evidence commit |

The governing amendment is [LLP 3000.000.000.002 §8](llp/3000.000.000.002-declarative-backfills.rfc.md). Muse Spark 1.3 Contributor/high and a fresh Codex gpt-6.1-sol/high session both marked the same round-6 text **READY**. Verbatim reviews, brief and provenance are under `llp/reviews/3000.000.000.002-evol-r6.*`; earlier negative and timeout records remain. Reviewer READY does not accept on the author's behalf.

## Wave-21 evidence

The full day-two analysis was read. Original apps/stores/assets remained read-only. Replays used coherent SQLite backups and independent owned copies, then removed their scratch.

- Isolated public adoption repros: **3 baseline refusals → 0 candidate refusals** (native edited input, migrated edited input, absent nullable destination). Every successful candidate runs two rollback/forward cycles. These reconstruct the failures because final lane sources already contain builder workarounds.
- Actual authored rollback/forward scripts in all **24 affected lanes**, twice per binary: **90/96 passed before and after** on untouched copies. Lane 034 has two saved-password failures; 044 has four. These are identical baseline failures, not resolved product defects.
- An additional explicitly setup-aligned replay ran all 24 lanes afresh on the final fully qualified packed binary: **96/96 passed on each binary**. Only existing copied credential hashes were aligned to saved script passwords in 034 (8 matched accounts) and 044 (10), with zero missing accounts. Principals, app rows, source and original evidence were unchanged. This neither replaces the untouched result nor claims an EVOL credential fix.
- A separate strict release-1 replay covers 29 affected/dormant lanes. Four check refusals remain on both binaries: two genuine edited-output conflicts in 026 and two missing original required fields in 044. Their actual scripts target later workaround releases, so strict release 1 is a separate result.

Generated bridges were previewed and activated on all eight dormant-lane copies:

| Lane | Strict old-table hidden + newer-only | Bridge hidden + newer-only |
| --- | ---: | ---: |
| 013 | 18 + 0 | 0 + 0 |
| 020 | 6 + 28 | 0 + 0 |
| 032 | 0 + 59 | 0 + 0 |
| 035 | 0 + 91 | 0 + 0 |
| 037 | 13 + 0 | 0 + 0 |
| 038 | 0 + 73 | 0 + 0 |
| 040 | 49 + 0 | 0 + 0 |
| 042 | 23 + 0 | 0 + 0 |
| Total | **460** | **0** |

Counts describe active physical source populations before read rules, using the final available lane snapshots. They differ from the bakeoff's earlier snapshot. Retained tables do not automatically appear in frozen old queries. Lane 032 already created independent table identities; the implementation does not merge them retrospectively. A bridge is a new reviewable release, not a silent rewrite of an old immutable release.

## Verification

The full Rust workspace was attempted, then completed in batches with affected reruns. There was **no single all-green workspace invocation**:

| Run | Recorded result |
| --- | --- |
| Full workspace, 60-minute bound | Exit 124 after 246 result summaries: 4,335 passing executions, 3 failures, 29 ignores. CLI/core/device/difftest completed; language was still running. |
| Complete language + simulator suites | Exit 101: 221 summaries, 3,121 passing executions, 4 failing guide assertions, 21 ignores. |
| Remaining core/device/difftest doctests | Exit 0, 17 passed. |
| Passing reruns of every failed target | Day5 bridge 7; security_wave19 9 with stable binary; native residency 7; guide 127; surf4 guide 4. |
| Final affected Rust checks | Backfills 123; CLI units 507 with 5 existing ignores; final visibility narration 3. |
| Affected clients | 62 passed in six files; final preview/release clients 12 passed in three files. |
| Mac Studio, approved `~/sb4-ws-evol` only | Backfills 123; final release 48 with 1 existing ignore; day5 7; foresight 4; native residency 7, all passed. |

Counts include overlapping batches and nested child executions, not unique tests. The workspace discovered an obsolete source-copy bridge assertion, a receipt invalidated by an overlapping CLI rebuild, the native no-op metadata regression, and guide budget/orientation assertions. All five failed targets have passing reruns. The unchanged native test also passes on the pre-EVOL baseline. Mac setup errors from incomplete fixtures/stale preserved mtimes were corrected before final passing tests.

- Difftest `run`: **20,000**, no signatures; `run-devices`: **0–999**, no signatures. Lean **20,000**, no new signatures. Its exit 1 contains only four pre-existing classified signatures (130 mismatches, 3,173 unsupported); unsupported cases are not passes.
- Fresh WASM and client builds passed. WASM is **733,876 gzip bytes / 734,193 budget**. README **319/320**, language **824/825 lines**, deploy **280/280**, appendix **98/100 words**; no budget increases.
- Repo-root frozen install, hoist and generated-artifact checks passed. Inventories passed; root guide **22 passed, 0 failures/skips** (121 warnings). Product guide **127/127**, surf guide **4/4**, and the named README self-containment/docs-budget check passed.
- Final source ref-check: **564 LLP documents, 12,221 references, zero errors or unchecked references**. Final evidence/report check is retained with the other verification logs.

### Packed qualification scope

Full `qualify-linux --consumer-only` **passed**, using fresh client/Expo/platform packs from `db62d60459606a61394352dd6b4e50c6d07cf958`, version 0.4.35, proot route. It includes EVOL cases, changed installed guide snippets/production recipe, migrations, release transitions, security, frontend and starter proofs. The complete Rust/client battery was run separately because the user forbids `scripts/test.sh`; this consumer-only run deliberately has `publicationQualified: false`.

The final commit `c88e594b077eb590b9423bf4ee3e146686e74a18` changes human preview wording only; JSON counts, schema, admission and SDK semantics are unchanged. A **fresh platform pack** passed the affected day-two, dormant/retained-empty narration, release-transition and migration proofs, reusing the exact client integrity from the full qualification. Final visibility/client tests also passed. This composed evidence is not represented as a full consumer rerun at c88.

Exact metadata and artifact hashes are in `consumer.json` and `affected-consumer.json`. Machine-readable replay results, reproduction sources, differential results and compressed verification logs are in [snapback4/reports/20261021-evol](snapback4/reports/20261021-evol/). Logs redact credential-shaped fields and omit oversized SQLite dumps; raw and retained hashes are recorded. Exact qualified tarballs remain locally under its ignored `artifacts/`; multi-gigabyte scratch and build outputs were removed.

## Decisions, boundaries and deferrals

No requested implementation item is deferred. The deliberately bounded surface keeps file reads migration-only and cross-table expressions subject to ordinary unique/point lookup requirements. Incompatible bridge types require an explicit typed repair; generated bridges retain target security rules and require application/UI review. These are reviewed contract boundaries, not silent coercions.

The untouched credential failures are reported as evidence setup limits, alongside the successful aligned replay. No frozen frontend compatibility, new bakeoff rating, publication eligibility or universal security claim follows from finite backend tests; SEC6 owns the parallel security lane. No publication, push, version bump, M5 MacBook use or other worktree mutation occurred.

The final fetch found `origin/main` at `afb7ba13c4` still on 0.4.35. The requested conditional rebase onto integrated 0.4.36 was therefore not triggered. Main was not assumed quiet for qualification. Qualification source digests stay bound to the tested commits; the final commit only records evidence/reporting.

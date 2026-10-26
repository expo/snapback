# Integration 26 — DX11 and Snapback 4 0.4.42

Release 0.4.42 integrates DX11 with FIX41/main. SEC10 is excluded and planned for 0.4.43. Publication qualification is separate. Landing destination: `sb4-loop:main`, without force.

## Commits and integration

- Initial status was clean on `sb4-loop` at `d66264efbd`; fetched main was `ba886e7be0`, already contained, so the requested first merge was a no-op.
- DX11 merge: `71aa5cdc91`, merging `sb4-b28-dx11` tip `968423b233` with `--no-ff`.
- Own version bump: `24d787d427`, `snapback4 0.4.42: compact security review and clearer client workflows`. It precedes affected verification and updates the same manifests, locks, fixtures and version expectations as the previous bump.
- Wasm measurement/budget: `3978d14da6`, before affected verification.
- Final incoming-main merge: `b039450461`, merging main `45d6a1a56b`; only 36 benchmark result files arrived, with no semantic inputs changed. Report/evidence is a metadata-only final commit.

The only conflict was `upload-retry.test.mjs`. Main's FIX41 continuous connection-saturation bank and worker fixture are retained; DX11's retry-guidance assertions remain. The superseded authenticated probe was unnecessary with the retained saturation witness. The complete conflict file passed (36 tests) in the source client pool. No production semantic conflict resolution was authored, so no integration reviewer round ran.

## Changes and upgrade

- Passing default check prints a verdict and language-enforcement summary; advisory details move to `--review`/JSON, while gates and refutations remain visible and blocking.
- Concrete redacted question witnesses accompany supported decisions. Multi-ID acknowledgments validate and commit atomically; identity ignores incidental locations, and independent source edits retain current decisions.
- Hooks expose `usePage.loading`/`why`; local developer refusal evidence names actual grants and filtered reads without adding public disclosure.
- Schema-first React apps receive a starter hint. Expo starters gain upload picking; overload, persisted staging clock and on-screen proof guidance improve; password starters gain `probe:check`.

One coherent 0.4.42 **Guide changes** entry describes upgrading existing apps and stores. Rows, accounts and migration receipts remain; restart serve processes and regenerate clients/devices. Analyzer revision `sec11-1` requires renewing older decisions once with current IDs and independent specification rationale. LLP 3000.037 §20.11 records this release's response. The candidate's version, one-entry count, upgrade words and `--review` help smoke all pass.

## Verification

One prescribed affected run used base `ba886e7be0`, tested `3978d14da6`, and completed all 31 steps with `unchanged:true`. It selected seven Rust packages and 441 client files. Its raw receipt is retained as **FAIL**, including the stale expectation files, root dependency preconditions and inherited Lean findings; it is not relabeled green.

| Rust package | Targets | Passed | Ignored |
| --- | ---: | ---: | ---: |
| snapback4 | 64 | 1575 | 79 |
| snapback4-core | 49 | 1243 | 5 |
| snapback4-device | 104 | 1575 | 4 |
| snapback4-difftest | 13 | 100 | 0 |
| snapback4-lang | 190 | 2628 | 16 |
| snapback4-native | 2 | 0 | 0 |
| snapback4-sim | 45 | 749 | 7 |

All **7,870 Rust tests pass** (111 ignored). Source client pool: 439 files/8,004 tests, initially 47 failed assertions across six files. Commit `e109c2fbcd` corrects explicit command ownership, opt-in detail callers, upload guidance assertions and stale guide commands. All six complete files then pass **153/153 tests**, preserving the original refusal fields/prefix, questionnaire counts and ordering. Effective source pool: **7,948 passed / 56 skipped / zero failed**. The two full-count model files pass **89/89**; fixture file passes 9/9.

Focused verification also passes the 127-test Rust guide target, canonical CLI rebuild, strict changelog-versus-help guard, packaged-doc lint and ref-check. No manifests, lockfiles, shared test support or runtime implementation changed after the broad run; no broad rerun was needed. The survey and replay semantic inputs remain unchanged.

During the final root pass, ignored root dependencies were absent. Locked installation restored them; the root workspace additionally needed its hoisted layout (`bun 1.3.14 --linker hoisted`). Generated artifacts, guide and inventory then pass. Installer-only executable-bit changes on five byte-identical legacy bin files were restored. These are separately recorded environment recoveries, not relaxed checks.

Root checks pass: generated artifacts; diagnostics regeneration; guide-manifest generation; inventories; guide (22 groups); ref-check; docs budget (README 320/320). Root regeneration produced no tracked differences. Inventories report 365 package tests, 35 scripts tests, 31 demos/catalog entries, 487 publication leaves and 162 guide pages/1937 snippets. Authoring census regenerated 906 items and matches committed bytes. Store-port census regenerated unchanged: **0 production sites; 116 test sites across 16 files**; no allowance was raised.

## Survey on copies

700 schemas across waves 15,16,18–28: default check output **median 2 lines / p90 2**, range 2–14; 657 schemas print exactly two lines. All gates stay visible. Raw authored-state results: 35 gated projects, 39 fresh-deploy refusals, 49 deploy-after-test refusals and 54 app-test exits. All four command exit statuses and gate code/sites match 0.4.41 for every one of the prior 650 projects, with identical schema/fixture inputs. The new wave28 has 50/50 projects passing all five commands and a two-line maximum.

All 49 conditional refusal cases are audited, with zero unresolved check/deploy refusals; **0 observed false gates and 0 observed false refusals**. Final audit reuses 49 same-source/binary case receipts. There are no timeouts.

Only copied schemas/fixtures were executed. Wave 15 uses its older app naming and contributes 100 schemas; the other twelve waves contribute 50 each. Raw authored findings and stale starter-fixture test exits are recorded separately from release regression tests. Conditional audit applies the previously recorded app repairs and individually justified current decisions on copies. Final input verification confirms **709 Quarry files and 777 fixture files unchanged** across all 700 original projects.

The final survey uses the already-built selector test-profile CLI, SHA-256 `71f0e7128937977f7511ecbf6839f7738729a99a2fb3e1fc8b40ab57dc91c887`. An interrupted unoptimized dev survey is supplemental only. Two late interrupted cache rows (wave15 097/099) were quarantined and rerun alone on the canonical pin; all five commands pass and each prints two lines. The final summary is rebuilt from corrected per-row files. Prewarming compiled only pending selector targets and prerequisites; it added no repeated broad test execution.

## Day-two replay on copies

100 distinct wave25/wave27 production stores; 500 moves (deploy, default rollback/forward twice). 491 successful moves all print correct live-source metadata; 195 forwards select exact ordinary source. Nine genuine refusals across four stores (`w25-004`:3, `024`:3, `030`:2, `045`:1). All four refusing stores replay on the retained 0.4.41 control with identical exits and normalized reasons: **0 false refusals; 0 hidden v1 rows**. All 300 original database/WAL/SHM file hashes remain unchanged. Ownership/token files are excluded from copies; originals are never opened with SQLite.

This deliberately uses default predecessor selection. Integration25 used explicit `--to 1`, hence its 18-refusal count is not the matching control. The separate default-selection 0.4.41 control validates this release's nine refusals. Replay uses the immutable dev 0.4.42 pin `9ddf58d9ddc73bab90c88b1430ff5622310e8d91d301b1be53f04af5c834f4f0`; source differs from tested `3978d14da6` only by the budget record.

## Wasm

Locked Linux merged device: **2,415,568 B raw / 738,130 B gzip / 555,808 B Brotli**. Budget **738,630 B = measurement + exactly 500 B**, with the merged-layout/version reason in `wasm-budget.json`. Whole-artifact delta versus Integration25 is +44 B raw/+22 B gzip. Strict serde-family/server-only absence audits pass. The final selector remeasurement is identical, clean (`dirty:false`), at `3978d14da6`, with `over:0`.

## Delivery, evidence and deferrals

Small summaries, source/binary bindings and verification receipt are under `snapback4/reports/integration26/`; full logs and reproduction harnesses are retained outside Git at `/home/ccheever/sb4-loop/reports/integration26/`. Reclaimed **15,697,173,080 B across 461 completed test executables**. Only this worktree was modified; temporary replay/survey stores are disposed after their cases.

No publication worktree or `target/publication/` content was touched. Deferred to publication: packed five-crate qualification, publication client pool, `qualify-linux`, Mac, Exact app builds, and 20k/devices differential campaigns. SEC10 remains excluded. The 2k ordinary differential smoke completes with zero disagreements, zero unexpected binder/runtime refusals and no generator errors. Lean's 2k smoke remains nonzero: **1,658 passed / 324 unsupported / 18 inherited disagreements** (5 continuation-next, 8 next, 5 prelude-code). Oracle totals match the retained 0.4.41 baseline exactly; all 16 finding files are byte-identical and there are no new finding files. Unsupported cases are not counted as passes. This inherited/open model scope remains recorded under LLP 3000.035, `lean/OPEN.md` and the existing continuation ticket; it is not a new 0.4.42 finding or a green Lean claim.

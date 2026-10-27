# Integration 28 — TOK1/DX15/DX14, SEC11/SEC11L, SEC12, SECP / 0.4.44

Source integration and local 0.4.44 pack. npm publication and full platform qualification remain separate. No publication directory/worktree was accessed; original wave stores were never opened.

## Commits and scope

Started clean at `f032742ac8`, branch `sb4-loop`. Pre-merge fetched main is `98177aa48b35b99779a95b4db3e26710ac76bf0c`.

- Initial main merge `ba7284e84d`.
- TOK1 `e84bd1f2eb`, including DX15 `10c6fc88de` and DX14 `c0fbcaf442`: merge `cc8381322b`.
- SEC11L `c7330da165`, including only commissioned SEC11 item 1 `1f9b2610d3`: merge `24d4c46c92`.
- SEC12 `e5467713f9`: merge `309caff0a8`.
- SECP `40514dac32`: merge `97d4fededf`.
- Early bump `7fa538ca0d`: **snapback4 0.4.44: bounded builder reading and faster witnessed security review**. Updates manifests, locks and LLP 3000.037 before extended verification.
- `1dbc510de1` repairs the fixture/cache seam and patched starter tooling; `ebe7eaa12f` records requested conflict reviews and fixes pending-evidence test callers.
- `898495c0de` preserves concrete witnessed questions across SECP advisory omissions; `9b9f1a74af` refreshes the authoring census and records default latency profiling.
- `93cee47c6e` completes merged fixture/reference routing repairs and test-output isolation.
- `c9fda9432a` makes the isolated social optional-upload fixture use its existing owned toolchain deadline instead of a nested 30-second fuse; all product/JSON/no-decision assertions and outer five-/twenty-minute guards remain. All 63 qualifier/custody tests, including fail-closed timeout cleanup, pass. All intermediate commits and their failed/superseded evidence remain in history.

SEC11b beyond `1f9b2610d3`, REL3 and SEC13 were not merged. SECP's duplicate LLP identity is finally `3000.036.004.005`; .003/.004 are reserved on excluded SEC11b. SEC12's existing .002 collides with another excluded SEC11b document: `issues/20261027-snapback4-sec11b-llp-number-collision.md` records the required reassignment before that lane lands. No excluded branch was edited.

## Seams and requested reviews

1. Gates, witnessed questions and advisory precision retain separate dispositions. SEC12's pending evidence snapshot carries SEC11L's cached report and exact predicted/actual predecessor-note vectors; vector mismatch falls back rather than reusing stale evidence. SQLite retains main's cache revision/ownership and SEC11L's immutable campaign asset cache, with independent revision state for forks.

   The full source-bound survey exposed 48 previously witnessed findings that SECP would otherwise omit (40 argument-grant, eight guard-not-consumed). The integration retains a pre-omission candidate basis for those families and independently replays omitted candidates under the unchanged 8,192-work budget. Only a concrete current witness restores a question. It never promotes advice to a gate or accepts cached stale evidence. Guarded/unique-parent opposing controls keep unnecessary advice omitted. All 521 prior check findings (including seven gates) and 518 production findings (including 20 gates) remain on the 850 exact-source baseline; zero lost findings.

   SEC11L identity comparison on the merged rules: 61 schemas, zero identity/raw-payload/verdict mismatches against an external sequential control disabling batching, concurrency and report/advice/asset-byte caching. Fifty cold/warm comparisons also match exactly. Twenty-two calibrated fresh production deployments on the freshly rebuilt consumer-chain executable also match the sequential control's entire security envelope, including IDs, obligations and verdicts. Fixture-constructor isolation/page-size/captured-authority controls and the exact derived-report reuse unit pass.

2. TOK1's bounded start card remains byte-identical to the lane, as does the short README. Security reference facts stay behind feature pointers. The rules card is at its original 374-line cap; default byte budgets remain unchanged. API index additions route `snapshotAll` and `probeServeGuard` into the existing client reference, with checked TypeScript examples. No per-card allowance was raised.

3. All 940 schemas meet the aggregate output budgets: default check median/p90 **3/5 lines**, fresh production deploy **4/6**, versus limits 3/6 and 5/9. Maxima are 14/16; individual witnessed questions are retained.

Exactly one Muse (`muse-spark-1.3-contributor`, high) and one fresh Codex (`gpt-6.1-sol`, high) reviewed only the authored conflict-resolution patch for seams 1/2. Verbatim outputs, brief, patch and SHA provenance are in `llp/reviews/3000.037-integration28-seams-*`. Both requested changes: Muse found two old finish-call test signatures; Codex found the over-budget rules card. Both were corrected and tested. No subsequent independent READY verdict or extra review round is claimed.

One coherent 0.4.44 guide-changes entry folds all lanes together, including existing-app/store effects: rows/store format unchanged; rebuild/restart for diagnostics; changed evidence digests can renew pending decisions; new concrete default questions; evaluated gate answers; idle-kill probe refusal before the next deploy with npm `--hold` / `SNAPBACK4_PROBE_HOLD=1` opt-out; separate uploads of the same bytes for several image columns.

## Starter audit and other deterministic reds

Today's registry provides node-forge **1.4.1**; the Expo signing dependency accepts it. The generated Expo toolchain explicitly overrides to 1.4.1. The sole stale node-forge exception and its obsolete policy are removed: the allowlist is empty, with no other entries to review. Existing uuid/zod/decode overrides remain. Host and both Linux userspace starter chains audit/build/adapt/typecheck all six installed starters without exceptions. Historical changelog entries retain their historical version facts.

Packed-consumer fixtures now encode deliberate current behavior without weakening their contracts:

- DX7 old-version upgrades require exact `E_SECURITY_NOTES`, exit 2 and no decision publication for an invalid gate acknowledgment; a schema intent fix clears the gate. A real nongated decision remains byte-identical after independent refutation. Both 0.4.35 and 0.4.37 controls pass.
- Rollback/migration optional evidence fixtures explicitly declare their intended optionality; every existing migration/row assertion remains.
- Packed security discovery follows the bounded start pointer to its actual security reference, retaining the start-card byte limit.
- Changelog flag-owner checks recognize the actual npm-script hold option.

Other selected Rust/client fixture repairs follow current authoritative surfaces: explicit `--repeat` when a test needs full repeated card text; short README -> linked reference -> guide discovery; strict starter flags; explicit deferred-install fixture custody; exact new data `--all` hint and guard wording. Frozen generated durable schemas/types still compare exactly after separately validating/removing only the generated OperationIndex/pagination comment metadata. The list API golden and authoring/diagnostic/guide/declaration/delivery-await projections were regenerated, never hand merged. The digest example now correctly catches up older eligible rows before its exclusive period end (three rows, with all final state assertions retained).

The delivery fault injector follows the actual watch-guard return while preserving it. All **215 delivery-await identities** are unchanged; all **445 fault/recovery tests pass**, with zero skips. The runner defers installation only for source-test fixtures; the actual TOK1 background installer and all packed starter installations remain exercised. Known scratch prefixes are narrowly ignored to avoid source-cleanliness failures from independent tests; arbitrary untracked source still fails the consumer guard.

## Survey, calibration and reading

940 schema/fixture copies cover available waves 15–32, at most eight survey workers (four during paired timing). Odd day-two copies are skipped only on equality; all surveyed keys/source hashes are retained externally. No owner/token file or original live store is used. Of these, 850 hashes match the SEC11L/SEC12 source-qualified classification baseline. All seven gates and 21 fresh production refusals match applicable reviewed cases; the 90 additional sources introduce none. **False gates 0, false production refusals 0, unclassified 0.** The test-profile concurrent corpus timings are check median/p90 5.3475/11.854 s, fresh production deploy 5.1455/11.192 s; they are not production-build latency qualification.

Exact calibrated M-hole default visibility (gate or concrete question for the actual calibrated field/operation): wave30 **4/14** (one gate, three questions), wave31 **3/5** new M holes (all gates), wave32 **1/8** (033/F1, actual job-photo presence question). Unrelated questions do not count. Unsupported calibration cases are explicitly retained as misses.

Four actual TOK1 reading-phase model replays reach their first checked schema and SDK discovery: 001 Codex **2,315 tokens / 2.819 min**; 025 Codex **2,315 / 4.954**; 019 Muse **3,014 / 3.225**; 028 Muse **3,008 / 3.949**. All are below 10k docs-before-schema. Start output (default/full), README and pre-schema source surfaces remain byte-identical after the security merge. These are reading-phase runs, not a new full-app security/latency/input-token bakeoff.

## Default latency builders encounter

Production binaries, 54 deterministically stratified schemas (three per wave) drawn from the survey, independent cold copies and same-copy warm repeats, four timing workers plus four survey workers on the shared machine. This is a paired sample, not a 940-schema latency census. No tool failures occurred. Before is the actual packed 0.4.43 native used by wave32 (SHA `a8c85c5907b50bc62419313594f0563a9171a58795191bd13d21ff6fe2114b74`); after is static production 0.4.44 with the final security algorithms (`aa6a5388fcf1f26066abb49af8b40da076145bef34493c91f674fd858b1005bf`). Later reference/fixture-only edits do not change these algorithms.

| Command | 0.4.43 median / p90 s | 0.4.44 median / p90 s |
|---|---:|---:|
| default check, cold | 6.238 / 33.032 | 8.460 / 21.395 |
| default check, warm | 2.303 / 15.140 | 6.069 / 16.317 |
| deploy --staging, cold | 7.280 / 31.326 | 9.085 / 27.189 |
| deploy --staging, warm | 0.554 / 1.094 | 1.490 / 2.706 |

The 10s/15s p90 targets are missed. Cold tails improve, medians and warm paths regress. `issues/20261027-snapback4-default-check-staging-witness-tail-latency.md` retains exact commands, 12 worst cases and campaign timings. Worst wave31/033 cold check 36.841 s spends 24.463 s in ordinary witness collection and 11.032 s restoring witnessed questions; staging 35.735 s spends 23.428/9.947 s. Fixture construction/initialization dominates. The initial non-strict report has a weaker work bound than the collector's augmented report, so blindly reusing it changes verdicts. No security/search budget or assertion was reduced. Follow-up is safe initialization reuse or bounded independently parallel campaigns with ordered reduction and exact identity controls.

## Verification and custody

The mandated `timeout 10800s node snapback4/scripts/affected.mjs --base 98177aa48b35b99779a95b4db3e26710ac76bf0c --run` broadened on shared manifests. It selected seven whole Rust packages and 449 client files (447 ordinary/timer, two models). It completed all Rust and client/model runs, then timed out at three hours during final root checks. Its raw receipt is incomplete, contains initial fixture failures, and is **not** called green. Both full model files pass with their original 5,000/3,000 sequence defaults. Core, difftest, native and the unaffected targets pass; every deterministic failing product target was repaired and rerun.

The final scoped rerun binds every observed base-to-final-product file, executes repaired targets and transitive API/TOK1/runner/delivery contracts, and reuses unchanged passing targets according to LLP 0189 D-2/user instruction to rerun only a fix's targets. It is explicitly separate from the initial broad receipt. No expensive unchanged full-suite rerun or invented green receipt substitutes for the original. Final product commit `93cee47c6e`: receipt `target/affected/93cee47c6eff-1793111433093.json` is complete, unchanged and PASS; 14 actual steps, seven repaired Rust integration targets plus the complete CLI unit target and 20 client files. -- client files: 20/20; failed 0; tests {"tests":758,"pass":758,"fail":0,"cancelled":0,"skipped":0,"todo":0}

The complete CLI rerun had two red targets (unit resource/timing flakes and cli_friction); all other integrations pass in that invocation. Each unit flake passes alone, then the whole unit target passes **674 tests / 75 ignored** at eight threads. The late cli_friction repeat fixture passes the entire **40-test** target. The device authoring census target passes **88 tests**. Late language target reruns pass aggregate 64 (+4 ignored), ephemeral 1, guide 130, list lower bounds 14, maintains 15, residency 44. Simulator clique **254 pass / 1 ignored**. The two unchanged timer flakes pass individually, then both whole files pass: **92 pass / 34 skipped**. Original failure logs are retained, with no timeout/assertion relaxation.

Root generated artifacts pass, and root guide/inventories/ref-check/docs-budget/packaged-docs pass (all five final root contracts exit 0; the separate generated-artifact run, 88 selector fixtures and both release guards also pass). Censuses, diagnostics registry, guide manifest, declaration digests and inventories are regenerated; ref-check counts 575 documents and 12,778 references. Additional final artifacts/results are in `snapback4/reports/integration28/` and raw logs/receipts in `/home/ccheever/sb4-loop/reports/integration28`.

Full installed tarball consumer chain: **PASS**, actual complete `qualify-linux.mjs --consumer-only` attempt7 on `c9fda9432a`; exit 0, source/artifact guard passed, all host production/proof-kit/security/staging/migrations/rules/frontend/starter and Ubuntu 24.04/Alpine installed-consumer proofs passed. All six starters per environment audit without exceptions. Native SHA `d1bd7db63769424373915c61bcf1338f5893adea9be908eac8f6227f492b3d6c`; `consumer.json` explicitly records source suite not-run and publicationQualified=false. Local client, Expo and native tarballs plus SRI/SHA manifest: `/home/ccheever/sb4-loop/reports/integration28/ready-pack/`. Prior attempts exposed and corrected fixtures above. Attempt5 passed every host and Ubuntu/Alpine starter proof but failed its final clean-tree guard on parallel-test scratch directories, so it is not counted as a successful commissioned chain. Attempt6 passed all host proofs/starters, then its isolated social edited-source check hit the nested 30-second spawn fuse after emitting valid JSON (26,144 ms of check work); no successful chain was claimed. The fixture now relies on the existing canonical owned command deadline, with identical assertions and no changed latency/security work threshold. The complete chain was restarted at `c9fda9432a`. Successful consumer-only proof is not a publication receipt.

Difftest `run` 2k: **2,000 generated/compiled, 120,026 executions, zero disagreements**. `run-lean` 2k: **1,658 pass, 324 unsupported, 18 known disagreements** (5 continuation-next, 8 next, 5 prelude E_RULE/NOT_FOUND). All 16 reproducer source/JSON files and entire oracle totals match Integration26 byte-for-byte. These remain the existing LLP 3000.035/lean OPEN.md language-oracle questions; no oracle/assertion was weakened and no green Lean result is claimed. They are outside the selected publication Rust/client consumer chain.

Wasm: **2,416,590 B raw / 738,561 B gzip / 556,001 B Brotli**; glue 16,053 raw / 3,695 gzip. Budget **739,061 B = measured gzip + exactly 500 B**, reason recorded in metrics/wasm-budget.json. Gzip is 52 B smaller than 0.4.43 with unchanged raw length. Strict family/server-only absence audits pass; no runtime ceiling or independent feature-cost claim.

## Delivery and deferrals

Final fetched main `750a8c34fa` merged with `--no-ff` as `4083c2e866`: 0.4.43 publication evidence and S1 scale-control records/metrics only, no conflict. Crates/packages/scripts are byte-identical to qualified source `c9fda9432a`; no product rerun is warranted for these record-only inputs. Final reference/inventory checks cover the added records. Delivery is the authorized nonforce `sb4-loop:main` push of the commit carrying this report; exact remote confirmation is retained externally in `delivery.json`.

The report/evidence commit contains no runtime changes after qualified source. Removed 11,927,232,690 bytes of completed failed-attempt outputs after retaining all top-level proof metadata and logs; active process checks excluded live outputs. Also removed 16631914504 bytes across 476 completed test executables enumerated in this worktree’s integration logs; all active executables, main binaries, wasm and build/library caches remain. After successful qualification, removed 5923030227 bytes from 31 completed private dependency trees; metadata, traces, source/fixtures, outputs and qualified tarballs remain. Final main advancement is checked, merged with --no-ff if needed, and only changed semantic inputs are rerun. Push is authorized nonforce `sb4-loop:main`; git status is clean at delivery. Lane-local WORKSTREAM-REPORT.md is overwritten with this integration report.

No npm publication, full qualify-linux source suite, extra full client pool, 20k/device differential, Mac or Exact app build was commissioned here. Publication runs the complete qualification once on the pushed source; its separate 0.4.43 worktree remains untouched. Local 0.4.44 packs are retained outside publication directories for wave34. Latency target misses and the excluded-lane LLP collision are precise open tickets, not hidden pass claims.

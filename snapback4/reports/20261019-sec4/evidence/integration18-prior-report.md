# Integration 18 — day-two bakeoff fixes and 0.4.34

Date: 2026-10-19. Branch: `sb4-loop`. Delivery: local commits only; **not pushed**.
Product candidate: `865fc1273c`; semantic corrections reviewed at `20cb01ee56`.
Evidence/report commits after that candidate do not change the product.

## Integration and version

Started with status/log inspection, `git fetch origin` and
`git merge --ff-only origin/main` at `3653cae823`. Read all three lane reports
and governing release, backfill, compatibility and security LLPs before merging.
Ordered `--no-ff` merges:

1. `7a4fe8b6f9` — REL5: retained release reactivation, clean refused deploys,
   rollback foresight, signature diff, defaults, deprecation and aliases.
2. `915b74d328` — MIG: declared transactional deploy backfills, day-two recipe,
   staging clock and its client operator proof.
3. `a32100a3ee` — SEC3: column invariants/audit, generated replay campaigns,
   privilege escalation lint and precise security notes.
4. `e0fbf667a9` — concurrent publication record `50ff0372eb` (0.4.31 superseded).

Kept integration's root report in conflicts. Preserved all additive parser/AST
forms, old changelog history, guides and tests. Generated files were regenerated.
No publication worktree or `target/publication/` was used or changed.

Version-only commit **`77dd50092f`**, `snapback4 0.4.34: reversible backfills,
release reactivation and column security`, changes exactly the ten paths of
`999598649f`'s previous bump. A single coherent 0.4.34 `guide changes` entry
covers every lane and old app/store behavior, including old-binary refusal after
release-store format upgrade and using 0.4.34 for source rollback.

## Cross-lane fixes and regressions

- `8c7db77e65`, `3c16415a84`: real release transitions apply a non-idempotent
  backfill once, then repeatedly rollback/reactivate retained release 2 with
  unchanged values and receipts. `deploy --check` carries backfill preview and
  old-client diff. Aliases/default/deprecated argument forms are exercised by
  invariant audit, generated histories and actual calls after demotion.
- `5d9fbe1a55`: a real deployed 0.4.33 store exposed compiler-report drift in
  retained release identity. Executable identity excludes only generated
  compatibility metadata; the full control-integrity digest still covers it.
  Old source reactivates its retained release rather than allocating a new one.
- `20cb01ee56`: reverse foresight shares forward activation's sampled staging
  clock. A negative-clock expiry/restrict/backfill packed regression fails the
  old binary and passes the fixed build. `Context.now` fixtures use `Some`.
- `28037ee28e`, `20cb01ee56`: proof hosts honor the explicit binary in their
  merged environment; portable declarations use `Record`, avoiding a browser
  dependency on NodeJS types. Final runs pin the merged debug binary.
- `78e36428d7`, `865fc1273c`: qualification harness imports all new modules,
  has negative success-evidence tests, and packed-rule cases do not copy an
  unavailable checkout binary when supplied a platform tarball.
- `b93b159d92`: warning/help assertions preserve all new flags and explanations;
  delivery await census includes four operator staging-proof awaits with reasons.
- `4ab274e289`, `9902b0ccd0`, `20cb01ee56`: extend LLP 3000.037 §20 with calibrated
  wave17 day-two results and `aggregate-bakeoff.mjs 18` on 0.4.33, explain .34's
  changes, clarify downgrade custody, repair guide paragraph boundary.

Both independent fresh round2 reviews are **READY**: Muse contributor-high
(wrapper Meta fallback after plan quota) and Codex gpt-6.1-sol-high. Verbatim
reviews, briefs, failed quota attempts and hashes are in
`llp/reviews/integration18/`. The first Codex review found the reverse-clock bug;
it was fixed and re-reviewed. Only packed fixture preparation changed afterward.

## Verification

Every shell invocation was bounded by `timeout`; Cargo inherited
`CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0`.
No `scripts/test.sh` run. Raw logs and scripts: `~/sb4-loop/integ18/`.
Committed summaries and source/package bindings: `snapback4/reports/integration18/`.

- **Rust PASS (exit0):6,798 passed / 45 ignored / zero failed. All 412 primary executables and 4 doctest groups covered; exact Cargo metadata census matches.** Full requested five-package `cargo test --no-fail-fast`
  rerun after the last fix, with eight test threads and sixteen build jobs.
  The ticketed cleanup flake passes alone and in this second complete run. The earlier failing and interrupted runs are retained as such.
- **Clients PASS (exit0).** All 419 files, 7,723 passed / 56 platform skips / zero failures (7,779 total). One full file pool (concurrency 16, serial timing
  cohort) then full-count models (concurrency 1): all 81 tests pass with zero skips/failures; explicit merged binary. No seed
  or timing bounds reduced. An earlier unchanged Following wasm timing timeout
  passed alone and is tracked in `issues/20261019-snapback4-following-unfollow-wasm-timeout.md`.
  Earlier failed/interrupted cohorts are retained and are not called passes.
- **Difftest PASS:** native 20k, 1,220,035 executions, zero signatures; devices
  0–999, 27,922 executions, zero; Lean 20k, 56,917 executions, 130 findings.
  A separately built fresh `3653cae823` reproduces exactly all four signature
  classes/counts (3/35/67/25), with identical pass/unsupported totals. No new signature.
- **Packed Linux PASS (exit0).** Fresh `publish.mjs --prepare-client` from a
  clean owned clone at `865fc1273c`; `qualify-linux.mjs --consumer-only` uses its
  client/Expo tarballs and a fresh platform build. Consumer-only avoids the
  explicitly forbidden full `scripts/test.sh`; complete Rust/client runs are
  separate above. All new REL5 transition/compatibility, MIG backfill/staging and SEC3 packed security cases pass, including rootless musl consumers and all frontend starters. This is consumer evidence, not publication qualification.
- **Root checks PASS.** Root frozen Bun install, workspace hoist and
  generated-artifact setup completed. Regenerated diagnostics, guide manifest,
  await census and RULES4 authoring census (870 entries, unchanged). Inventory,
  reference and guide checks pass without skips: inventories 365 package tests / 35 script tests / 31 demos / 487 publication leaves; ref-check 556 LLPs /12096 refs, zero errors or unchecked; guide 22 passed, zero failed/skipped/preconditions (121 existing warnings). Docs budget passes (README 319/320
  and the self-contained first-account guide case).
- **Survey PASS:** final merged binary checks 100 wave15 +50 wave16 +50 wave18
  schemas, zero refusals, all input hashes unchanged. Counts by every code are
  in `survey-summary.json`. Prior 150 security counts exactly reconcile with
  SEC3 final19: broad 251, intent 150, argument-grant 169, optional 36, escalation 7,
  sweep-only 13, vacuous 1. Wave18 has separately reported counts, including
  escalation 14, existence-oracle 15 and grant-outlives-role 9.

## Wasm

Clean locked build and strict family/absence audits pass:
**2,385,842 raw / 727,013 gzip / 548,685 Brotli bytes**.
Budget **727,513 = measured gzip +500 bytes**. Growth versus Integration 17
is 1,011 bytes gzip, including shared deterministic text builtins and merged
release/security representation. The reason is recorded in the budget,
JOURNAL and research record. Brotli uses Node zlib quality 11 because the Brotli
executable is absent. The final clean measurement is source-bound at865fc1273c
in `snapback4/metrics/wasm.jsonl`; failed zero-Brotli measurement is not evidence.

## Actual 0.4.33 upgrades

Installed `snapback4@0.4.33 snapback4-expo@0.4.33 --save-exact` from
`http://127.0.0.1:4873/` into a fresh Expo app and store. Upgraded with merged .34
and corrected pack via an ephemeral local registry overlay: exact pins, adapt,
check, invariant acceptance, preserved row, closed default password-dev doors,
real signup/write/read, explicit legacy unsafe-dev-door behavior, Expo typecheck
and Expo web export all **PASS**. No registry publication.

A separate real 0.4.33 *deployed* release store has an invariant, user/data,
releases 1/2 and rollback history. .34 preview is read-only, reactivates retained
release 2, preserves data/users/privacy and survives repeated rollback/reactivation:
**PASS**. `upgrade-history-commands.json` records exact commands.

## Exact

Fresh clean clone of Exact2 origin/main at
`860c44bfbd9f52e16c21888307a703a6bd83d43f` in `~/sb4-loop/prewave18/exact2`.
Only private checkout dependency paths/lock were bound to the merged Snapback
core/device/lang; frozen Bun install and Contract CLI build passed. Fresh
`synced-qualified/app` and `online-qualified/app` use the corrected prepared
client (all 304 installed dist files in each exactly match the tarball).

For each mode: `bun <clone>/scripts/exact.mjs new <app> --snapback [--online]`,
`bun exact.mjs snapback --rebuild --port <port>`,
`bun exact.mjs contract migrate app.contract`,
`bun exact.mjs contract types app.contract -o app.contract.d.ts`, and
`bun exact.mjs test web --backend http://127.0.0.1:<port>` all **PASS**
(two web tests per mode). Synced port41771, online35007. Exact argv/cwd/exit
records are committed in `exact-commands.json`; clone, source and package
bindings are adjacent. The binary reports 0.4.34; no published older fallback.

## Mac Studio

Only `ccheever@macstudio-charlie-apt101-a:~/sb4-ws-integ18` used. Actual toolchain
is macOS27.0.1 / Xcode27.1 (27A9275), despite requested host note saying27.0.
No black M5 or publication scratch was touched.

Affected core/device/sim targets pass. Corrected lang and CLI target sets pass
(including new security histories, evolution, notes, clocks and previews).
The initial scratch copy omitted two read-only fixtures; copied those exact
tracked fixtures and reran affected tests. Browser-portable package declarations
and upgrade-history checks pass. An extra target audit also passes list_lower_bounds and the bin module session diagnostics (the initial standalone serve_identity target spelling was invalid; corrected invocation passes). **Final Mac client pool PASS:** all 70 files in one pass,1,650 passed / 15 platform skips / zero failures (1,665 total).
Fresh iOS XCFramework build passes; chat schema check passes.
**Expo prebuild and CocoaPods PASS. Generic Expo Release build blocked:** Interface Builder stalls with no output for over 10 minutes while Xcode first-launch status is 69. Terminated only the double-verified owned build/child; this is not a successful build.

**Native witness blocked:** `xcrun simctl list runtimes -j` triggers “Install
Failed: Authorization is required to install the packages”; direct simctl also
hangs and noninteractive sudo requires a password. No alternative Xcode is
installed. No simulator was booted and no Expo native witness is claimed.
Complete the Studio's administrator-authorized Xcode component setup, then rerun
`mac-native.py`'s Release simulator build and `node witness/expo.mjs` against .34. Follow-up: `issues/20261019-snapback4-studio-xcode-component-setup-blocks-native-witness.md`.

## Delivery and remaining work

All requested product changes and local version bump are committed. The final full Linux and affected Mac product checks pass. The sole requested qualification deferred is the Expo Release/native witness blocked by the Studio's Xcode component setup; the generic Release attempt is interrupted infrastructure evidence, not a pass.

Final fetch found no additional origin/main commits beyond the publication record already merged. Test/review bindings stay on the content candidate 865fc1273c; later commits contain evidence, tickets and this report. Full publication qualification/promotions were not run: the packed consumer-only receipt explicitly records that limitation, and the complete requested Rust/client suites were run separately.
No push, npm publish, publication claim, or publication-directory mutation.

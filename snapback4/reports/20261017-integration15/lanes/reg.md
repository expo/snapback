# REG workstream — 0.4.31

Worktree: /home/ccheever/projects/sb4-w14-reg. Base 4ef9f77fb3.
No version bump, push or npm publication. Integration owns the release.

## Changes and commits

Small separable initial commits: R1, P20, then R2. Subsequent commits retain the
regression proofs and fixes discovered by the required fresh consumer runs.

- R1 / fix #1: `9999819edf` adds persona/headers on both fixture reads,
  uses an unauthenticated dev-only field catalog by default, preserves E_AUTH,
  returns startDev.personas, and executes the installed guide fixture block
  verbatim for every init frontend/template, including persona-only variants.
  Catalog tests verify private-field filtering, Host/Origin rejection and
  serve refusal even with a valid production session.
- P20 proof-host half: `61abfcc1fd` checks existence before realpath and gives
  the requested awaited-build message. Missing-index behavior is unchanged.
  DAY4 owns custom-proof check/adapt advice; KIT3 owns other helper contracts.
- R2 / fix #3: `c4d9000e90` makes upgrade read the target adapter peer and
  Expo's actual bundledNativeModules.json, exact-pin installed aligned packages
  and core/adapters together, preserve dependency sections, print its Expo plan,
  and disable pnpm's implicit frozen-lockfile mode. Non-Expo acquisition is
  unchanged. The final adapter peer policy is recorded in the followup below. README, guide expo and init next steps agree.
- H9 qualification: `9913b6eda6` installs the real published 0.4.29 Expo
  starter/dependency tree before the literal two-package candidate install and
  explicitly acquired candidate helper. Both must check, typecheck and export
  web while preserving Expo 57.0.22. A third case checks adapter-first React/RN
  resolution, init, installation and web export. The qualifications run inside
  qualify-linux, and retained consumer evidence includes regressions.json.

- Core-floor followup: `444d1410f8` reconciles adapter Expo-module peer
  floors after reading Expo's recommendations. Real Expo 57.0.22 recommends
  core 57.0.18; the helper pins core 57.0.23 instead, including when newly
  required. The realistic matrix passed 9/9 on Linux and Mac; a third fresh
  review from each family ended READY.

- Changelog/help checker: `0abe0abe1f` keeps npm/bun/pnpm install flags with
  the package manager rather than attributing --save-exact to Snapback new.
  This was exposed by the required literal install line. Regression file:
  4 passed on Linux and Mac. SURF4 retains ownership of general CLI/help work.
- Adapter-first solver followup: `0910086f97` mirrors RN 0.86.3's own React
  ^19.2.3 peer. Exact React 19.2.3 peers fail npm's optional-web-peer selection
  in an empty project. Compatible React19 at bootstrap resolves; init + normal
  npm install then pins React/React DOM19.2.3 and deduplicates one React instance
  across app, RN, adapter and core. Real Linux and Mac packed adapter-first
  installs, scaffolding, typechecks and web exports pass. Native React19.3 is
  not claimed. Both fresh model families reviewed this followup READY.

- Qualification profile: `7c9dc2cdbf` keeps runtime fixture proofs on the
  pinned Node 24 host. Ubuntu's intentionally supported Node 22 build-only
  userspace cannot launch the chat starter's TypeScript worker. The host still
  executes all six verbatim fixture snippets on both identity/persona-only
  variants. Clean userspaces explicitly record fixtureGuide not-run-build-only.
- Router optional-peer followup: `b872fb3136` prevents a fresh social npm
  install from floating Router's optional Reanimated/Worklets to 4.7.1/0.13.0,
  which conflicts with Expo core 57.0.23. Social init pins the selected SDK's
  4.5.1/0.10.1 pair, and upgrade adds both SDK pins for Router projects even
  when previously transitive. Both fresh reviews READY; Linux/Mac starter test
  and all nine PM alignment contracts pass.

## Native floor decision

Expo 57.0.22 + expo-modules-core 57.0.23 built and ran on the Mac Studio
with Xcode 27.0 (27A266a). Both installed-app published witness segments,
offline and restart, passed. Therefore the adapter peer is >=57.0.22 <58,
with core >=57.0.23 <58. Starters keep Expo 57.0.30. Fresh owned simulator
was deleted. Native logs and JSON receipts: snapback4/reports/20261016-reg/.
Work stayed in ~/sb4-ws-reg on the Mac; CocoaPods and pinned Chromium were
installed under that scratch directory. The publication MacBook was unused.

## Reviews

Both semantic amendments received fresh Muse Spark 1.3 contributor/high and
Codex gpt-6.1-sol/high reviews, through the requested commands. Both families
ended READY for both amendments and their subsequent peer-floor/install/Router refinements. All received reviews and provenance are under
llp/reviews/*reg*. First-round findings were fixed: qualification fixture dirs,
additional catalog boundaries, actual installed old-version upgrade setup,
pnpm CI lockfiles, and explicit current/future floor assertions.

## Verification

- R1/P20 negative controls: actual Wave14 0.4.30 tarballs reproduce E_INPUT
  containing E_AUTH on persona-only loadFixtures and raw ENOENT on missing dist.
- R2 negative controls: literal install and old upgrade helper both fail
  ERESOLVE against actual installed 0.4.29 Expo 57.0.22 consumers.
- Linux catalog Rust suite: 14 passed. Full snapback4-lang guide suite: 125 passed.
- Fixture client tests: 5 passed. Full proof file passed in the initial combined
  Linux run; that run exposed 8 non-Expo upgrade mock regressions, subsequently
  repaired by retaining the original non-Expo acquisition path.
- Existing upgrade/history plus initial PM tests: 21 passed after repair.
  Final npm/bun/pnpm floor + Router matrix: 9 passed (command/manifest contracts with PM
  stubs; no claim of real Bun/pnpm Expo exports).
- qualify-linux test file: 34 passed.
- Mac catalog suite: 14 passed. Full fixture/proof/initial upgrade files: 29
  passed with Playwright's pinned Chromium. Final upgrade matrix: 9 passed.
  Initial system-Chrome run had three browser-close deadline failures; the
  pinned-browser rerun passed all cases without product changes.
- README docs budget: 317/320 lines; named first-account test passed.
- Ref-check: 550 documents, 11,971 refs, zero errors/unchecked; final delivery
  rerun is retained beside the qualification evidence.
- Additional Rust init suites: 50 + 7 tests passed. Final qualifier/upgrade/help
  unit run: 47 passed. Additional social manifest regression: 1 passed on
  Linux and Mac. Final init rerun: 50 + 7 passed, with the unchanged expensive
  w8b residency calibration filtered; its earlier complete 50-test run passed
  in 353.28 seconds. A redundant full rerun was stopped after its other 50
  tests passed, then the affected rerun completed; the original log is retained.
- Root bun frozen install and ensure-workspace-hoist completed (repeated when
  the root dependency cache was absent during final checks). First root
  inventory/guide runs reported missing ignored demo artifacts. Running
  scripts/check-generated-artifacts restored those caches without tracked
  changes, and its own check passed. Both full root checks then passed:
  inventory entries: 365 package tests/35 scripts tests/31 demos/487 publication leaves;
  guide 22 checks, zero failures/preconditions (existing freshness warnings).
- Fresh prepare-client pack and complete consumer-only qualify-linux: PASS,
  source b872fb313658cdc3d939d0fb4f4389b1d0fb3df0. All three Expo acquisition
  cases passed actual npm resolution, check, typecheck and web export.
  Generated frontend proofs: 12 passed. All six starter fixture snippets passed
  verbatim on identity and persona-only schemas. Ubuntu 24.04 / Node22.22.0 and
  Alpine3.23.3 / Node24.18.1 consumer round trips and all starter builds passed.
  Validated consumer source and both candidate SRIs against prepare.json.
  consumer.json explicitly records publicationQualified:false and suite:not-run.
  Earlier runs exposed the npm flag checker, adapter-first exact React,
  Node22's unsupported TS worker in build-only userspaces, and Router's optional
  Worklets conflict. Those original failure logs are retained separately.
  One earlier invocation was stopped before consumers to incorporate the core
  floor precedence. No failed run is relabeled as a successful qualification.
- Cleared this worktree's incremental/debug dependency caches after affected
  tests, freeing roughly 28 GB on the shared disk. Prepared tarballs, production
  binary and test logs are retained.

## Judgment calls and limits

The current lane keeps package version 0.4.30 as instructed. The 0.4.31
changelog gives the literal install line for integration's version bump.
Older installed helper code cannot be repaired retroactively; docs therefore
use npx snapback4@latest upgrade. Qualification explicitly fetches candidate V
over the old installation. Consumer-only qualification is used to honor the
ban on scripts/test.sh; it produces no publication qualification receipt.

The final packed source is b872fb3136. Evidence/doc-only delivery commits after
that source do not change its tested semantic delta. The qualified tarballs
remain under snapback4/target/reg-packed-router, consumer workspace/evidence
under target/reg-qualification-router; retained JSON/digests and compressed
logs are committed in snapback4/reports/20261016-reg/.

Deferrals: no REG product item deferred. Integration owns 0.4.31 renumbering,
publication qualification, publication, and merging the lanes. DAY4 owns the
custom-proof check/adapt flag; KIT3 owns remaining helper contracts; SURF4 owns
general CLI/help; PROD owns release-aware UI. No full scripts/test.sh run,
physical iOS device, Android, SDK58, or native React19.3 claim.

Reproduction commands (from snapback4, all bounded):

```sh
timeout 900 env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 node scripts/publish.mjs --prepare-client --prepare-directory target/reg-packed-router
timeout 2400 env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 npm_config_cache="$PWD/target/reg-router-npm-cache" node scripts/qualify-linux.mjs --consumer-only --client target/reg-packed-router/snapback4-0.4.30.tgz --expo target/reg-packed-router/snapback4-expo-0.4.30.tgz --out target/reg-qualification-router
```

Use new output/cache directories when replaying: prepare and qualification
intentionally refuse to overwrite completed evidence. Node 24.13.1 and Bun
1.4.2 were on PATH. The packed source and digests are in prepare-router.json
and consumer.json in the committed evidence directory.

Delivery evidence commit: f3d2912b2a. This root handoff report is intentionally
left uncommitted, as allowed, so it does not conflict across lane cherry-picks.

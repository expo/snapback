# LLP 0196 execution: T3 proof-by-default + T0 chat starter completion

**Status:** Open — CLAIMED (orchestrating session 86767887, 2026-08-08)
**Impact:** 5
**Urgency:** 4
**Ease:** 3
**Confidence:** 4
**Systems:** Templates, CLI, Guide, Testing, Agent experience
**Date:** 2026-08-08
**Related:** LLP 0196 (governing Plan, Review at r8/r9), LLP 0146 (D2
verify), issues/20260808-expo-chat-template-web-deps.md,
issues/20260808-headless-simulator-proof-recipe.md, diary 0069

Execute LLP 0196's first two rungs in its own sequencing (T3 → T0):
T3 — every template ships proof-by-default with ONE command
(`bun run prove`) delegating to LLP 0146 D2's `snapback verify`
(no second verifier); T0 — complete the existing expo-chat starter:
web platform + deps (absorbs
issues/20260808-expo-chat-template-web-deps.md — residue 1, two runs
running), plus the template's remaining diary-0069 gaps. T1
(crud-dashboard) / T2 (media-feed) / T4 (carrier kits) / T5 (freshness
gates) follow in later lanes under this same program ticket.


## Triage (2026-08-26 leftover sweep)

Still open for external qualification. T0–T5 **code** is present (five templates with `prove`, `carrier-kit`, `scripts/template-staged-qualification.mjs`, `template-registry-canary.mjs`). This ticket is no longer an uncommitted-sandbox claim; remainder is live `prove` / first blocking staged qualification / live registry canary.

## Execution log — 2026-08-08, lane-0196-templates

### T3 — proof by default

- Added exactly one scaffold acceptance command to `todo-contract`, `react`,
  and `expo-chat`: `bun run prove` (`npm run prove` is the package-manager
  equivalent). Each command invokes `snapback verify` directly and retains the
  LLP 0146 D2 receipt at `.snapback/verify-receipt.json`.
- Added one verify config per template. The shared
  `defineStarterVerifyProfile` adapter admits and runs the template's existing
  live `snapback.starter-acceptance.v1` receipt inside D2; it does not add a
  second verifier or duplicate product assertions. The adapter preserves the
  existing receipts' limitation honestly by reporting D1 read/write provenance
  as `unsupported`, so D2 records partial rather than invented conformance.
- Updated every scaffold `AGENTS.md` and static scaffold coverage to identify
  `prove` as the acceptance command and the lower-level `test` scripts as
  profile/debugging inputs.
- **Acceptance status:** implementation, config loading, scaffold propagation,
  and adapter receipt admission pass. The live `prove` commands were not run in
  this lane because each owns a managed server and this lane explicitly forbids
  starting servers; the orchestrator still owes one runtime-qualified live run
  per template.

### T0 — completed Expo chat starter

- Added explicit memberships, DM/group inbox rows, reply pointers, reactions,
  a labeled **TEST PERSONA** switcher, seeded coverage for each shape, and live
  acceptance checks for membership/persona variation, replies, and reactions.
  The switcher is explicitly app-data test identity; production identity still
  comes from adopted session authority.
- Added Expo web to `platforms`, the `web` script, and SDK-57-compatible
  `react-dom`, `react-native-web`, and `@expo/metro-runtime` dependencies. A
  no-server static Expo web export exposed and drove a narrow fix to the
  `@expo/snapback-expo` web AppState arm: it now resolves React Native Web
  directly instead of evaluating native React Native internals.
- Extended the recurring typecheck harness and the existing packed cold-install
  leg to fail if the web or proof-command contracts disappear. The static web
  export of an untouched scaffold passes. Per the lane constraint,
  `expo start --web` itself was not started; the orchestrator must perform the
  final serving check before closing the absorbed web-deps ticket.
- Diary 0069 residue 1 is implementation-complete pending that serving check.
  Residue 4 is intentionally not absorbed: the simulator-proof recipe belongs
  to T4.

### Checks

- PASS — `CI=1 volta run --node 24.18.0 node scripts/check-expo-chat-template-typecheck.mjs`
  (dependency/prove assertions, codegen, static acceptance, strict TypeScript,
  and static Expo web export).
- PASS — `volta run --node 24.18.0 node packages/snapback-cli/verify.test.mjs`
  (22 D2 cases).
- PASS — `volta run --node 24.18.0 node packages/snapback-cli/package.test.mjs`.
- PASS — `packages/snapback-expo/provider.test.mjs` and `package.test.mjs`;
  provider coverage emitted expected sandbox warnings when it could not write
  under `~/.snapback`, but exited successfully.
- PASS — `./ref-check --verbose` (3,635 refs, no errors).
- BLOCKED BY PRE-EXISTING GENERATED-OUTPUT ABSENCE —
  `node scripts/check-inventories.mjs` and `node scripts/check-guide.mjs` both
  reached guide validation but could not find the ignored generated
  competitive-checkpoint operation schema or the two Exact-generated todo-v2
  contract files; guide check also reported the resulting stale guide manifest.
  No guide page or LLP document changed in this lane.
- NOT RUN by constraint — live starter acceptance / `bun run prove`, the
  monolithic packed cold-install qualification, `expo start --web`, Cargo,
  servers, and simulators.

### Remaining program work and ratification

- T1: build and prove the CRUD dashboard template.
- T2: build and prove the media-feed template.
- T4: publish the web/native/headless carrier recipes, including diary 0069
  residue 4's simulator-proof techniques.
- T5: add the freshness/adoption gates after the portfolio exists.
- Ratification requested: T3 currently admits existing starter receipts into
  D2 with explicitly `unsupported` D1 provenance. Confirm that partial
  conformance is the intended first-rung posture, or schedule a later retrofit
  that makes those existing acceptances emit authoritative D1 reports.

## Execution log — 2026-08-08, lane-0196b T1/T2

This lane is implementation-complete in the working tree. It deliberately did
not create a commit because the execution sandbox cannot write Git metadata.

### T1 — CRUD dashboard template

- Added `packages/snapback-cli/templates/crud-dashboard/` as a zero-edit React
  web scaffold. Its neutral project-portfolio domain is independent of the
  held-out CRUD brief. Two related tables (`projects` and `teams`) feed a
  generated relational live query with explicit public source/output
  visibility and a uniquely indexed join key.
- Added list, independent live detail, create, edit, and delete UI. The edit
  mutation installs a replayable optimistic projection over the exact
  relational directory query; generated argument/result types flow through the
  hooks without result casts.
- Selected Sessions as the schema default. The small authored sample dataset
  and its mutations remain public so an untouched browser scaffold can perform
  CRUD without adding app-specific sign-in UI; `AGENTS.md` calls that starter
  tradeoff out explicitly.
- Added authored seed data, build/typecheck scripts, Guide-first `AGENTS.md`, a
  no-server static acceptance, a managed live acceptance covering relational
  read plus create/update/delete/live observation, and the ordinary `prove`
  command/config delegating to the landed T3 starter verify profile.
- **Acceptance status:** generation, static acceptance, strict TypeScript, CLI
  scaffold propagation, and verify-config admission pass. The registered live
  acceptance and `prove` were not run because this lane forbids servers.

### T2 — media feed template

- Added `packages/snapback-cli/templates/media-feed/` as a universal Expo
  scaffold using a neutral shared field-journal domain, independent of the
  held-out media brief. It runs on iOS, Android, and web.
- The main `feedPhotoUpload` intent is authenticated, strips location metadata,
  materializes required `thumb` and `display` renditions, chooses
  `public-immutable` delivery, and attaches only through a compatible typed
  `assetRef`. A separate, deliberately unwired `privatePhotoUpload` intent
  demonstrates the `private-strict` alternative without pretending delivery
  can change after upload.
- Added one observable generated publish command for upload → finalize → typed
  attach, live image rendering through the asset-delivery hook, and a bounded
  infinite-scroll feed over public authority-independent first/older live
  pages. The native root registers the Expo file RQS store so eligible page
  snapshots can render retained while reconnecting.
- Added Sessions custody, authored seed history, Guide-first `AGENTS.md`, a
  no-server static acceptance, a managed live acceptance that mints an ordinary
  session and proves real PNG upload/attach plus both public renditions, and the
  ordinary `prove` command/config delegating to the landed T3 profile.
- **Acceptance status:** generation, static acceptance, strict TypeScript, CLI
  scaffold propagation, and verify-config admission pass. The registered live
  upload acceptance and `prove` were not run because this lane forbids servers.

### Registration and packed-install coverage

- Registered both templates in `snapback new` help/usage and in the CLI,
  `create-snapback-app`, verify-config, and scaffold package tests. The
  filesystem-backed template registry discovers both automatically.
- Extended the packed cold-install qualification with T1 install → generate →
  typecheck → static acceptance → Vite build and T2 install → generate →
  typecheck → static acceptance → Expo web export legs. The monolithic packed
  qualification itself was not run under this lane's no-server constraint;
  its edited script and both live acceptance files pass `node --check`.

### Checks

- PASS — fresh generation for both authored backends with Node 24: zero
  diagnostics, zero warnings, and zero degraded results.
- PASS — `volta run --node 24.18.0 node packages/snapback-cli/package.test.mjs`.
- PASS — both `acceptance.static.mjs` files.
- PASS — strict TypeScript for both templates against the frozen SDK-57
  dependency harness. The temporary dependency tree and module-resolution
  symlinks were removed after the checks.
- PASS — `volta run --node 24.18.0 node packages/snapback-cli/verify.test.mjs`
  (25 D2 cases, including both new configs).
- PASS — `CI=1 volta run --node 24.18.0 node
  packages/create-snapback-app/package.test.mjs` with a temporary worktree-local
  `@expo/snapback-cli` resolution. The first invocation resolved that package
  from the moving parent checkout instead of this worktree and failed its
  expected parity comparison; the local-resolution rerun passed and the
  temporary symlink was removed.
- PASS — `volta run --node 24.18.0 node
  packages/snapback-cli/cli-help.test.mjs`.
- PASS — `./ref-check --verbose` (199 LLP documents, 3,680 references, no
  errors or unchecked references).
- BLOCKED BY PRE-EXISTING GENERATED/GUIDE DRIFT — `volta run --node 24.18.0
  node scripts/check-inventories.mjs` reached `guide-manifest` and failed on
  missing ignored generated sources for competitive-checkpoint and todo-v2,
  plus stale generated symbol-reference projections. This lane did not touch
  Guide pages or those demo outputs, so it did not regenerate or commit them.
- NOT RUN by constraint — either live starter acceptance, either `bun run
  prove`, the full packed cold-install qualification, Expo/Vite servers, Cargo,
  simulators, or `node scripts/check-guide.mjs` (no Guide page changed).

### Remaining program work and ratification

- T4 remains: publish the web/native/headless carrier recipes, including the
  simulator-proof material already assigned there.
- T5 remains: run the fresh-agent adoption loops and add the resulting
  freshness/drift gates for the now-complete template portfolio.
- Ratification requested: confirm the T1 starter default of Sessions schema
  plus intentionally public sample CRUD, rather than adding product-specific
  sign-in UI to the generic dashboard.
- Ratification requested: confirm the T2 public-feed default
  (`public-immutable` + public-read references) with `private-strict` shown as a
  separate intent, rather than making private delivery the main starter path.
- The earlier T3 request remains: confirm explicitly partial D1 provenance for
  starter receipts now, or schedule an authoritative D1 retrofit later.

## Execution log — 2026-08-08, lane-0196c T4/T5

This lane is implementation-complete in the working tree. It deliberately did
not create a commit because the execution sandbox cannot write Git metadata.

### T4 — executable carrier kits

- Added the published `@expo/snapback-cli/carrier-kit` helper and one ordinary
  package command per carrier each template supports: `carry:headless` on all
  five templates, `carry:web-browser` on the four visual templates, and
  `carry:native-simulator` on the two Expo templates. Every template also has
  a no-server/no-simulator `carry:self-check` command.
- Every carrier begins with the template's existing `prove` command and accepts
  only its passing LLP 0146 D2 receipt as proof authority. The carrier director
  retains environment artifacts and a deliberately non-claiming director log;
  it does not mint another acceptance format. Both the per-template carrier
  config and the shared carrier implementation are bound into the registered
  D2 profile's test-byte digest.
- The web helper owns the managed Snapback/client process, loopback readiness,
  isolated browser profile, screenshot and DOM artifacts, timeout, and process
  cleanup. Fixed Vite ports are strict so an unrelated process cannot satisfy
  readiness accidentally.
- The native helper owns selection of the newest available shut-down iPhone
  runtime (or validation of an explicit UDID), simulator shutdown/boot,
  optional app installation, literal dotted-key scheme approval through Python
  `plistlib`, Expo Go first-run dismissal, the `simctl openurl` deep-link drive,
  online screenshot, backend/Metro stop, offline relaunch screenshot, app and
  process cleanup, simulator shutdown, scheme-approval restoration, and stable
  artifact paths. It contains no `plutil` fallback.
- Updated every template's `AGENTS.md` so a cold agent is directed to these
  commands and artifact paths instead of reconstructing diary 0069 residue 4
  from prose.
- **Status:** implementation and self-check complete. Real carrier executions
  remain unqualified in this lane because they require servers, a browser, or
  a simulator. After landing, the orchestrator should run, from fresh installed
  scaffolds, `CI=1 npm run carry:headless`, `CI=1 npm run carry:web-browser`,
  and for both Expo templates `CI=1 npm run carry:native-simulator -- --udid
  <dedicated-udid>` (add `--app-path <Expo-Go.app>` when Expo Go is absent).

### T5 — two-gate template freshness

- Added a shared dynamic portfolio qualifier. It discovers the registry from
  the *installed* CLI package rather than a maintained template list, then for
  every entry performs fresh scaffold → dependency install → generate →
  `test:static` and records the installed first-party closure.
- **Pre-release/blocking:** `template-staged-qualification.mjs` installs the
  exact candidate tarballs, rewrites template first-party dependencies to
  their candidate `file:` tarballs, and fails unless every discovered template
  passes. `qualified-staging-store-qualification.mjs` now runs it immediately
  beside the existing packaged-store qualification on each platform-filtered
  candidate closure. The EAS workflow retains separate macOS/Linux template
  receipts, and either failure blocks the release path.
- **Post-release/reporting:** `template-registry-canary.mjs` installs the
  requested published CLI version or dist-tag and re-runs the same dynamic
  static portfolio against the registry-resolved closure. An observed template
  failure writes a failed receipt and warning but exits successfully by
  default; malformed invocation or inability to write a report still fails the
  harness. `--strict` is available for an explicit diagnostic run.
- The canary is a named gate in the existing LLP 0175 D2.3/LLP 0189 complete
  inventory, selected only by scheduled/on-demand complete proof, and its JSON
  report is retained with the local-proof artifacts. A separate affected
  self-check covers portfolio/config changes without turning the live registry
  observation into a landing gate or inventing another cadence class.
- **Status:** both code paths and their self-checks are complete. No candidate
  tarballs or live registry were exercised in-lane. After landing, run the
  blocking path with `CI=1 volta run --node 24.18.0 eas workflow:run
  .eas/workflows/qualified-package-staging.yml --input version=<semver> --ref
  <landed-ref> --wait --non-interactive`. The first post-release observation is
  `CI=1 volta run --node 24.18.0 node scripts/template-registry-canary.mjs
  --version <released-semver> --receipt
  target/proof/template-registry-canary.json`; later `latest` observations run
  through the existing scheduled complete battery.

### Checks

- PASS — Node 24 syntax checks for the carrier helper, both freshness wrappers,
  their shared qualifier, and the staged-store integration.
- PASS — both T5 wrapper self-checks; each dynamically found all five templates
  and the expected headless/web/native carrier registrations.
- PASS — `CI=1 volta run --node 24.18.0 node
  packages/snapback-cli/package.test.mjs`; generated scaffolds ran their static
  acceptance and every executable carrier entry point ran its plistlib-backed
  self-check.
- PASS — `CI=1 volta run --node 24.18.0 node
  packages/snapback-cli/verify.test.mjs` (25 D2 cases, including carrier config
  and shared-helper digest binding), plus `cli-help.test.mjs`.
- PASS — package-test inventory (238 declared files), local-proof dependency
  inventory (147 declarations / 146 stable IDs), local-proof inventory and
  selection suites, and CI workflow fixtures (9 workflows / 44 immutable
  action pins).
- PASS — EAS YAML parsing, the 16 KiB size bound (16,379 bytes), CLI dry-pack
  inclusion of the new public export and template carrier files (199 entries),
  `git diff --check`, and `./ref-check --verbose` (200 LLP documents, 3,672
  references, no errors or unchecked references).
- BLOCKED BY WORKTREE DEPENDENCY ABSENCE —
  `scripts/check-package-export-types.mjs` requires the exact root-worktree
  `node_modules/typescript` and `.bin/tsc`; this linked worktree has no local
  dependency tree. It exited before compilation and requested
  `bun install --frozen-lockfile`.
- BLOCKED BY NETWORK — official `eas workflow:validate` could not resolve
  `api.expo.dev`. Local YAML parsing, size validation, and repository workflow
  fixtures passed; the orchestrator should re-run schema validation before the
  paid workflow invocation.
- BLOCKED BY PRE-EXISTING GENERATED/GUIDE DRIFT — `CI=1 volta run --node
  24.18.0 node scripts/check-inventories.mjs` reached `guide-manifest` and
  reported the already-missing competitive-checkpoint/todo-v2 ignored generated
  sources plus stale generated symbol-reference projections. This lane did not
  edit Guide pages or those demos.
- NOT RUN by constraint — live `prove`, any carrier's real server/browser or
  simulator path, exact staged-tarball qualification, live registry canary,
  Cargo, or a paid EAS workflow.

### Whole-program exit position and ratification

- The T0–T5 implementation surface is now present, but LLP 0196 is **not exit-
  complete**. Fresh live D2 proofs for every template, real carrier runs, the
  first blocking candidate qualification, and the first published-registry
  observation are still required external execution.
- The cold-agent zero-template-gap and zero-source-excavation criteria remain
  measurements, not implementation assertions. W1 still owes before/after
  semantic-action counts for T0/T3/T4, and the next CRUD benchmark must be
  labeled template-assisted and complete with zero template-gap loops. The
  predeclared unaided holdout required for any portfolio-level comparison also
  remains open under LLP 0197.
- Ratification still requested: T3's explicitly partial D1 provenance posture;
  T1's Sessions schema with public sample CRUD; and T2's public-immutable main
  feed with private-strict demonstrated separately.
- New T4 ratification requested: confirm that binding the executable carrier
  config/helper into D2 while retaining screenshots in a non-claiming director
  log is the intended “evidence registered under T3” posture. If an LLP 0064
  tuple claim is desired, the orchestrator must run and retain that tuple's
  existing OS-specific acceptance rather than promoting the carrier log.

## Ruling record — 2026-08-15

Author ruling (Charlie, 2026-08-15, recorded by orchestrating agent session):
all four standing evidence-posture ratifications are **RATIFIED as shipped
and documented**:

1. T3's explicitly-partial `unsupported` D1 provenance posture;
2. T1's Sessions schema with public sample CRUD;
3. T2's public-immutable main feed with private-strict shown separately;
4. T4's carrier config bound into D2 with screenshots in a non-claiming
   director log.

The external qualification pass is unblocked on the ratification axis.

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

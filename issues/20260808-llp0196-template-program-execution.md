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

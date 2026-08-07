# expo-chat template: no out-of-repo packaged proof coverage yet

**Opened:** 2026-08-07
**Area:** packages/snapback-cli / scripts/snapback-package-cold-install.mjs
**Related:** LLP 0186 W2 (golden-path scaffold), LLP 0176, LLP 0179 S1

The `expo-chat` golden-path template (LLP 0186 W2, landed 2026-08-07) is
covered in-repo by `packages/snapback-cli/package.test.mjs` (scaffold →
codegen with zero degraded results → generated `conversation` surface
asserted → `acceptance.static.mjs`), and its live `acceptance.mjs` was
verified once at landing time against a real runtime (4/4 checks, clean
receipt) from a hand-wired scaffold. What does not exist yet:

1. **Cold-install lane.** `scripts/snapback-package-cold-install.mjs`
   exercises `todo-contract` and `react-starter` from packed packages
   (install, generate, typecheck, static + live acceptance) but does not
   scaffold `expo-chat`. Add an expo-chat leg mirroring the react-starter
   leg: `snapback new --template expo-chat`, packed install, `snapback
   generate`, `npm run test:static`, and the live `npm test` receipt. The
   Expo peer set (expo/react-native) makes a full `bun install` heavier
   than the react leg; the leg can typecheck with the same packed
   snapback packages plus a cached Expo dependency set, or defer
   `tsc --noEmit` if install cost is prohibitive.
2. **Template typecheck in CI.** The template's `App.tsx`/chat screen
   were typechecked strict at landing (tsc 6.x against expo ~57 types)
   but nothing re-runs that check when the template or the
   `@expo/snapback-expo` types drift.

Until (1) lands, the published-closure claim for `expo-chat` (the
unreleased fence in `guide/getting-started/the-authoring-loop.md`) should
be swept by the npm promotion lane only after a cold-install or
equivalent packaged proof includes the template.

## Progress 2026-08-07 (Lane D)

- **Item 1 (cold-install lane): landed.**
  `scripts/snapback-package-cold-install.mjs` now scaffolds `expo-chat`
  from the packed CLI, installs the packed snapback packages plus the
  template's full Expo peer set (expo ~57.0.7 / react-native 0.86.2; the
  proof already installed an expo ~56 set for the packed-expo fixture, so
  the marginal cost is one warm-cache install), runs offline
  `snapback generate`, `npm run typecheck` (tsc is cheap once the install
  is paid for, so it is not deferred), `npm run test:static`, and the live
  `npm test` starter-acceptance receipt. The leg is gated on the ledger
  containing both the `@expo/snapback-expo` and `create-snapback-app`
  rows (the creator row marks post-change ledgers) so pre-change and
  legacy ledgers remain verifiable. The same change adds the packed
  `create-snapback-app` clean-directory leg (see the sibling publication
  ticket). Evidence note: the leg code is covered by the cold-install
  unit fixtures (receipt checks, ledger gating, aggregate/latest-root
  validators), but the leg itself has not yet executed end to end —
  the monolithic cold-install proof needs a freshly staged 11-package
  ledger with sealed runtime tarballs, which is the qualified staging
  lane's job. Note: the 0.1.12 fast-path release published (and swept
  the expo-chat fence) before this leg existed, so the first executing
  run is the next staged qualification after this change, whose platform
  receipts now fail closed unless this leg passes
  (`packedExpoChatScaffoldTypecheckStaticAndLiveAcceptance`).
- **Item 2 (recurring template typecheck): landed.** A committed harness
  with the template's exact Expo dependency set (snapback packages as
  `file:` links into `packages/*`) plus a check script that scaffolds the
  live template, runs codegen, asserts dependency parity with the
  template manifest, and runs strict `tsc --noEmit` is wired into
  `scripts/verify-local-proof` as install + typecheck rungs (file-drop
  convention), so template or `@expo/snapback-expo` type drift now fails
  the local proof.
- 2026-08-07 later note: the 0.1.12 fast-path release shipped the
  expo-chat template inside the published `@expo/snapback-cli` and swept
  the guide fence before the cold-install leg first executes. Ticket now
  stays open until a staged qualification run (or the next promotion's
  proof) actually executes the expo-chat leg end to end.

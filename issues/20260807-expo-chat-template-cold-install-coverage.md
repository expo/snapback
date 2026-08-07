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

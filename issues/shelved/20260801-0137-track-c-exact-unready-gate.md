# Track C (0137): Exact Native surface not ready for the frozen A1 contract — precise unready gates and successor conditions

**Opened:** 2026-08-01
**Systems:** Exact Native, Client integration, Competitive evaluation
**Related:** LLP 0137 (Track C), LLP 0064, demos/improvement-sweep/arms/a1-exact-graduation/gap-record.json, Exact LLP 0331/0332, issues/20260725-rqs-native-ondevice-adapter.md (JS-carrier sibling gap)

Stage-1 readiness assessment for LLP 0137 Track C (three surfaces:
Contract/web, exact-native/ios, exact-native/android on the frozen A1
field-notebook contract). Verdict: **not ready — honest program GAP**, per
the plan's own rule ("If the Exact Native surface is not ready when the
sweep completes, Track C records an honest program GAP and remains a
separate successor gate"). The sweep report is not delayed.


## Triage (2026-08-26 leftover sweep)

Still open. `demos/improvement-sweep/arms/a1-exact-graduation/gap-record.json` is still `not-ready`. Successor conditions unmet (no `a1-{ios,android}` receipts, no membership/JS-handler native codegen). The “0.1.7-era authority pin” wording is stale versus published 0.1.27; do not reopen Track C on a pin bump alone.

## What exists (and is real)

- `exact-native/ios` and `exact-native/android` **Parity receipts exist for
  the Partitime workload**: exact repo
  `docs/reports/exact-native/partitime-{ios,android}.json` (2026-07-21, all
  twelve LLP 0064 Parity facts), imported into
  `demos/partiful-matrix/acceptance/results/step2-exact-native-*.json` by a
  gate that hardcodes the Partitime receipt paths and claim ids.
- Contract/web for A1 is **available today** (packaged
  `@expo/snapback-contract`, codegen contract modules, shipped guide page)
  but was not run: Track C is one three-surface exercise, and two of three
  surfaces are unready for this app.

## The precise unready gates (A1 cannot be carried today)

1. **Plan-tier expressibility.** A1's backend is 11 JS mutations + 2 JS
   live queries over `ctx.membership.*`, `requireRole`, unique-index
   idempotent create, revision patches, and `ctx.assets.attach`. LLP 0064
   §4: server-only JS handlers are inadmissible for deterministic local
   execution; the exact-side Rust codegen
   (`packages/snapback-client-core/codegen/generate.mjs`) has zero
   membership/JS-handler support.
2. **Stale authority pin.** The generated Rust app modules pin Snapback
   authority `b79c695f` (2026-07-20) — pre-productization, an epoch behind
   the 0.1.7 closure the sweep runs against.
3. **No app-agnostic onboarding path.** Per-app vendored artifacts
   (`snapback-client-core/artifacts/{partitime,todo-v2,…}`), a
   hand-composed carrier crate per app (`exact-partitime-carrier`), an
   app-named capture harness, and a Partitime-only import gate. Onboarding
   A1 is a build-the-surface project, not a run.
4. **Contract-fact coverage.** No native asset surface for A1-04 (and the
   asset stack is broken even on the web closure — 0137-a1-f1/f2/f3); no
   sessions-custody story for the native carrier (Partitime used a demo
   AuthCapability with a baked carrier secret).

Non-substitution recorded explicitly: the sweep's `a1-snapback-expo-ios`
Online receipt does NOT stand in for `exact-native/ios`, and the Partitime
Parity receipts do not transfer to the A1 workload (LLP 0064 §7).

## Successor-gate conditions (Track C reopens when all hold)

- The A1 operation tier is expressible: exact-side codegen (or
  Snapback-emitted portable plans) covers membership declarations, role
  guards, unique-key idempotent create, and revision patches.
- Authority pin advanced to a 0.1.7-era Snapback revision; app modules
  regenerated.
- An `a1` carrier crate + per-OS capture producing
  `docs/reports/exact-native/a1-{ios,android}.json` with the full LLP 0064
  Parity fact set, plus a Snapback-side import gate for the A1 workload —
  or an app-agnostic generalization of carrier/capture/import.
- Native asset surface for A1-04 and a sessions custody story, after the
  web-closure asset defects are fixed.

Then run the three-surface exercise with its own diary and a capsule at
`demos/improvement-sweep/arms/a1-exact-graduation/`, per-OS receipts
independent under LLP 0064.

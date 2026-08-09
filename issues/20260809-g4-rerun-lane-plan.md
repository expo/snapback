# G4 restart lane plan: 0.1.16 cut and fresh external rerun

**Status:** Open — the three lanes below are claimed for the G4 restart
**Impact:** 5
**Urgency:** 5
**Ease:** 2
**Confidence:** 5
**Systems:** Packaging, Publishing, Expo, Guide, Release evidence
**Date:** 2026-08-09
**Related:** [LLP 0176 §G4](../llp/0176-expo-messaging-golden-path.plan.md),
[LLP 0181](../llp/0181-zero-configuration-expo.rfc.md),
[LLP 0041](../llp/0041-packaged-dev-loop.rfc.md),
[0.1.16 rapid publication](./20260808-0116-rapid-publication.md),
[G4 external-vector gap](./20260806-guide-gap-g4-live-0110-external-vector.md),
[G3 lane-plan precedent](./closed/20260806-g3-command-lane-plan.md)

This ticket claims two outcomes that have not yet been proved: (a) a fresh
LLP 0176 G4 external rerun against the newest published vector established by
this work, and (b) the qualified 0.1.16 cut already tracked by the
[rapid-publication ticket](./20260808-0116-rapid-publication.md). That ticket is
being annotated in the same commit with a pointer back here; this ticket does
not replace it.

Filing the claim is a coordination act, not a publication or G4 receipt. No
0.1.16 publication, successor HBC scan, or successor two-host ceremony is
claimed here.

## Scope claimed

### 1. Housekeeping

**Branch:** `g4/housekeeping`. **State:** in flight and mostly landed in this
session.

This lane owns:

- the stale-ticket sweep into `issues/closed/`;
- the guide's published-boundary refresh; and
- the irreplaceable-evidence archive of the 0.1.11 G4 quarry, recorded
  below.

### 2. 0.1.16 qualified cut

**Branch:** `release/fastpath-0.1.16`, claimed 2026-08-09 by the release
supervisor session. Worktree `~/projects/snapback-wt/g4-release`, candidate
revision `fe3dae6b999d01c31117cc95145d190fa29dc497` (clean `origin/main` at
claim time). Registry state observed at claim time: `latest` is `0.1.15` and
no `0.1.16` exists on any name.

Run the qualified fast-path publication using the 0.1.14-ceremony recipe and
publish the closure as 0.1.16. In the same promotion lane:

- update `guide/published-closure.json` so `newestPublished` is `0.1.16` and
  `publishedAt` is the actual publication date;
- regenerate the guide manifest; and
- sweep every `<!-- since: 0.1.16 unreleased -->` fence in the guide corpus,
  as the promotion lane is required to do by
  [guide conventions](../guide/conventions.md).

The current source set is eleven markers: two in `guide/clients/react.md` and
one in each of `guide/clients/app-cli.md`, `guide/clients/surfaces.md`,
`guide/backend/assets.md`, `guide/backend/external-api.md`,
`guide/backend/queries.md`, `guide/backend/mutations.md`,
`guide/realtime/snapshot-bundles.md`,
`guide/getting-started/your-first-backend.md`, and
`guide/sync/offline-and-retention.md`. Generated guide output must follow from
manifest regeneration, not be treated as a separate source fence.

Retain the publication ledger under `~/snapback-release-ledgers/`, following
the existing `fastpath-ledger-<version>-<revision>.json` naming. There is no
retained `fastpath-ledger-0.1.14-*.json`: only `candidate-0.1.14/` and three
`publish-0.1.14*.log` files remain. That is a bookkeeping gap this lane must
not repeat.

### 3. Fresh-quarry G4 rerun

**Branch:** not started; the executing session must record its branch and the
new quarry path in this ticket before starting.

Create a new, clean external Expo repository. Do not reuse or mutate
`/Users/ccheever/projects/snapback-g4-external`; it is the frozen 0.1.11
evidence quarry, preserved read-only by the housekeeping lane's archive. The
new quarry must install only the published 0.1.16 package names, with no
source path, override, staging copy, or monorepo edge.

Rerun the frozen OQ5 ceremony on both hosts: the Air with an iOS simulator and
the mini with an Android emulator. Preserve separate platform receipts and a
combined verdict.

## Starting state verified 2026-08-09

The registry currently carries the `@expo/snapback-*` versions 0.1.10 through
0.1.15. `latest` is 0.1.15. The
`bakeoff-0-1-14-fc88615895cb` dist-tag points to 0.1.14.
`guide/published-closure.json` currently records `newestPublished: 0.1.15`,
`publishedAt: 2026-08-08`, and `newestQualified: 0.1.7`.

The retained fast-path ledgers are:

- `fastpath-ledger-0.1.12-fad3d53922.json`, for revision
  `fad3d53922e920d9cdc23a2b5b9cad84e3c872c0`;
- `fastpath-ledger-0.1.13-b975f003bc.json`, for revision
  `b975f003bc7e76131b20b7dc649a45bb3cd3d29b`; and
- `fastpath-ledger-0.1.15-d8d16068f0.json`, for revision
  `d8d16068f00bb09811de656f484520ad9df95c33`.

Registry inspection confirms the three source repairs in the published 0.1.15
bytes:

- `@expo/snapback-cli@0.1.15` `expo-dev.mjs` has the adb
  transport-label-tolerant reverse verification;
- `@expo/snapback-expo@0.1.15` has the root conditional export
  `"require": "./app.plugin.js"`; and
- `supervised-environment.mjs` has five `process.env.NODE_ENV` gates and
  `app-binding.mjs` has two.

Commit `a951074e4` supplied the adb transport-label repair, EAS root export,
residue guide rule, and stage exclusions; those first shipped in 0.1.12.
Commit `c5a18506d` supplied the release-export vocabulary prune; it first
shipped in 0.1.13. Presence in 0.1.15 registry bytes supports starting the
successor rerun. It does not prove that 0.1.16 was published correctly or that
the repaired paths pass the real ceremony.

LLP 0176 §G4 records the two prior failures. The 0.1.10 attempt failed before
`m1` or `m2`, at cumulative `C/F/D = 73/6/3` after about 11 minutes. The
0.1.11 rerun also failed: iOS reached `G4_IOS_PASS`, while Android was only
conditional under the adb wrapper, with `m1 = m2 = 112/7/4`.

## Fresh-rerun acceptance

The fresh quarry must reclaim all of the following against the published
0.1.16 vector:

- The raw published supervisor reaches Android readiness on the mini with
  **no adb wrapper** and reclaims all three reverse rules. The transparent
  wrapper made the 0.1.11 run diagnostically useful, but the raw published
  Android path was a distribution **FAIL**.
- Noninteractive `eas init` and EAS project linking accept the documented
  package-root plugin spelling `"@expo/snapback-expo"`, with no
  `./app.plugin` subpath workaround.
- A byte-level strings scan of the real `expo export` HBC output for both
  platforms finds all four supervised-development vocabulary symbols absent:
  `/_snapback/expo/v1/bootstrap`,
  `EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN`, `localhost`, and `10.0.2.2`.
  The committed esbuild proof and the one-off Metro-plugin evidence run both
  discriminate, but the NODE_ENV-prune repair's own verification note
  explicitly deferred the real HBC-byte measurement to this
  successor-release rerun. Real HBC bytes have not been scanned since the
  fix.
- Cold retained relaunch is proved with the backend paused, or the rerun is
  recorded as failing this arm. In the 0.1.11 iOS run, cold launch stayed at
  boot `starting` while the backend was paused and rendered only after
  connectivity returned. Retained cold boot is therefore still **not
  proved**.
- The frozen OQ5 ceremony vector is remeasured as `C/F/D`, `m1`, and `m2`.
  Preserve the bakeoff asymmetry rather than scoring a false win: Diary
  0058's figures are full-app lanes, Diary 0059 has no clock, and Diary 0060
  measures orchestration.
- Keep the standing nonclaim: Air simulator and mini emulator evidence is
  **NOT** an LLP 0064 `Online` claim. That claim needs per-OS physical-device
  evidence and moves to G5.

A failed arm remains a failed G4 rerun. Record it and retain its evidence; do
not convert partial platform progress into a pass.

## Collision protocol and its known limit

Any other session that wants one of these three lanes must **edit this ticket
first**, recording the lane and its branch before starting. The claiming
session will rebase around whatever is recorded here.

This protocol has already failed once in this repository. In the
[G3 command lane plan](./closed/20260806-g3-command-lane-plan.md), the claim
was recorded exactly as requested, yet a second session landed a complete,
independent implementation of the same gate 33 minutes later without reading
`issues/`. A filesystem ticket coordinates only sessions that read `issues/`
before starting.

The claim is still worth filing. A lane whose cost is a real npm publication
or a multi-hour, two-host device ceremony is exactly where duplication is
expensive and partly irreversible: an npm version number cannot be unpublished
and reused. This ticket records the coordination boundary while making no
claim that the mechanism can enforce it.

## Lapse rule

This claim lapses if no commit referencing this ticket lands on `main` within
about a day of the filing date, 2026-08-09. A later session finding the claim
stale should treat all three lanes as unclaimed, note the lapse in this file,
and proceed.

## 0.1.11 quarry evidence archive

**Source:** `/Users/ccheever/projects/snapback-g4-external` — a Git repository
with **zero commits**. All G4 0.1.11 evidence lived there as untracked
working-tree files and was therefore unrecoverable off that one machine.

**Archive:**
`~/snapback-release-ledgers/g4-external-0111-quarry-20260809.tar.gz`

**Size:** 20,783,500 bytes (19.8 MiB)

**sha256:**
`2459d0c03c2fcdeff542943b6385d8e017b7f3fefdfbbfd5125ac369087b0798`

**Command:**

```sh
tar czf ~/snapback-release-ledgers/g4-external-0111-quarry-20260809.tar.gz --exclude=node_modules -C /Users/ccheever/projects/snapback-g4-external .
```

**Included (194 entries):** `G4-ACTION-LEDGER.md` (the frozen OQ5 action
ledger); `evidence/` (the three iOS Maestro flow YAMLs, the two supervisor
JSONL streams, the two startup-failure PNGs, the
`adb-selected-device-compat` wrapper, and `diagnosis-probe.mjs`); all four
`dist-g4-{android,ios,closure-android,closure-ios}-0111` Hermes exports; the
three earlier `dist-{android,ios,inspect}` exports; `.snapback/`; the
host-pinned `.snapback.snapback.restore.lock` that the residue ticket is about;
`app.json`; `App.tsx`; `eas.json`; `.easignore`; `.gitignore`; `package.json`;
`package-lock.json`; `tsconfig.json`; `index.ts`; `snapback/`; `assets/`;
`.expo/`; `.claude/`; `AGENTS.md`; `CLAUDE.md`; `LICENSE`; and the commitless
`.git/`.

**Excluded:** `node_modules/` only (460 MB, fully reconstructible from the
retained `package-lock.json` against the published registry). Nothing else was
excluded. The untarred payload is about 52 MB, so no size ceiling was hit and
the `dist-*` HBC bundles were kept; they are the substrate for the
release-vocabulary strings scan.

The source directory was **not modified**. The archive is a read-only copy.

The archive is a durability measure, not evidence promotion. The retained,
tracked 0.1.11 receipts remain the citable record: the
[combined verdict](../demos/expo-golden-path-fixture/receipts/20260806-g4-external-0111-summary.md),
[iOS simulator](../demos/expo-golden-path-fixture/receipts/20260806-g4-external-0111-ios-simulator.md),
[Android emulator](../demos/expo-golden-path-fixture/receipts/20260806-g4-external-0111-android-emulator.md),
and
[closure/EAS/diagnosis](../demos/expo-golden-path-fixture/receipts/20260806-g4-external-0111-closure-diagnosis-eas.md)
receipts under
`demos/expo-golden-path-fixture/receipts/20260806-g4-external-0111-*`.

## Closure boundary

Close this ticket only after the qualified 0.1.16 registry cut and its retained
ledger exist, the guide boundary and fences are updated, and the fresh-quarry
Air/mini receipts record the full G4 verdict. Publication alone does not close
the external rerun; source-level repair evidence alone does not close either
claim.

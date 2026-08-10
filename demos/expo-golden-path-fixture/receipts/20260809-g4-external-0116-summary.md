# LLP 0176 G4 external distribution rerun against live 0.1.16 — 2026-08-09

## Gate verdict: FAIL — the published 0.1.16 runtime cannot start a generated app

G4 is **not complete** against live 0.1.16, and this rerun failed earlier than
the 0.1.11 rerun did. The published `@expo/snapback-runtime-*@0.1.16` packages
omit `bin/packaged-store-qualification.receipt.json`, the adjacent artifact the
public-package build requires before it may advertise `single_table_v1`.
Without it every generated app that contains a live query — which is every app
the guide's own Expo template produces — refuses to boot:

```text
SNAPBACK_CAPABILITY_UNSUPPORTED: target does not support required capability single_table_v1
```

`0.1.15` ships that receipt and boots the identical generated app. The
regression is therefore introduced by the 0.1.16 cut, not by the consumer, the
template, or the host. It is tracked in
[`issues/20260809-runtime-package-missing-store-qualification-receipt.md`](../../../issues/20260809-runtime-package-missing-store-qualification-receipt.md).

Two arms nevertheless produced firsts that are worth more than the failed
gate is worth losing:

- the **byte-level release-export measurement has now been run against real
  fixed HBC output for the first time**, and Snapback's supervised-development
  vocabulary is gone from it; and
- **noninteractive `eas init` now accepts the bare `"@expo/snapback-expo"`
  package-root plugin spelling**, closing the 0.1.11 EAS resolution failure.

| G4 arm | Result | Evidence |
| --- | --- | --- |
| Clean external public install / scaffold / codegen / typecheck | **PASS** — 0 hand-edited files, 1 m 29 s from empty directory | [ledger](#ruled-oq5-ceremony-measurement) |
| Published guide's literal fresh-app command | **FAIL** — resolves to an unrelated registry package | [ticket](../../../issues/20260809-guide-gap-npx-snapback-new-resolves-wrong-package.md) |
| iOS simulator provider + live query + committed/rendered image | **FAIL — blocked before boot** | [iOS receipt](./20260809-g4-external-0116-ios-simulator.md) |
| Android emulator, unmodified public supervisor | **FAIL — blocked before boot** (upstream of the adb gate) | [Android receipt](./20260809-g4-external-0116-android-emulator.md) |
| Metro closure from app + public `node_modules` | **PASS** | [closure receipt](./20260809-g4-external-0116-closure-diagnosis.md) |
| EAS stage-only archive boundary | **PASS** — 87 files / 0.69 MiB | [closure receipt](./20260809-g4-external-0116-closure-diagnosis.md) |
| Noninteractive `eas init` on the package-root plugin spelling | **PASS** — first time | [closure receipt](./20260809-g4-external-0116-closure-diagnosis.md) |
| No supervisor-development symbols in release exports | **PASS on attribution** (3/4 symbols absent outright; the 4th is proven baseline React Native) | [closure receipt](./20260809-g4-external-0116-closure-diagnosis.md) |
| Real EAS iOS/Android development-client builds | **Not rerun** — the 2026-08-06 authorization was one build per OS and both already ran; cited, not repeated | [0.1.11 receipt](./20260806-g4-external-0111-closure-diagnosis-eas.md) |
| Deliberate public-doc diagnosis probe | **PARTIAL** — 1.3 s exact-code lookup, but it lands on an unrelated anchor and no guide section covers this refusal | [closure receipt](./20260809-g4-external-0116-closure-diagnosis.md) |
| Retained cold boot | **Not testable** — nothing booted | below |
| Truthful command residue | **Not testable** — no command ran | — |

LLP 0176 remains **Accepted** and G4 remains open.

## Rerun vector and quarry

The rerun consumed npm `latest` = 0.1.16 from source identity
`ee21fa4a82c5486e1e4abf48e67a1745e7316e83`, ledger
`~/snapback-release-ledgers/fastpath-ledger-0.1.16-ee21fa4a82.json`. The
external quarry is a new, separate Git root at
`/Users/ccheever/projects/snapback-g4-external-0116`; the 0.1.11 quarry at
`/Users/ccheever/projects/snapback-g4-external` was not read, reused, or
mutated. The resolved lock holds only published `@expo/snapback-*@0.1.16`
names with no `file:`, `link:`, workspace, override, resolution, monorepo path,
or absolute host path.

**Host substitution.** The Air (`100.70.173.122`) was offline in Tailscale for
the whole session, so the iOS-simulator host was the apartment M1 Max MacBook
Pro at `100.72.251.34` (macOS 26.6, Xcode 26.6) running the same iOS **26.4**
simulator runtime the 0.1.11 Air run used. The Android host was unchanged: the
mini at `100.106.94.95`, AVD `Medium_Phone_API_36.0`, Android 16 / API 36,
`emulator-5554`. Both hosts were fully reclaimed; see each platform receipt.

## What the paved path bought before it broke

The single largest change since 0.1.11 is that the guide now leads with a
whole Expo-native template rather than a hand-assembled package set. Measured
from the empty directory:

| Step | Wall time | Cumulative `C/F/D` |
| --- | ---: | ---: |
| Scaffold (`npm create snapback-app`) | 8 s | 4/0/1 |
| `bun install` (478 packages) | 5.2 s | 10/0/2 |
| `bun run generate` (5 tables, 12 operations, 7 live, **0 warnings**) | 5 s | 11/0/2 |
| `tsc --noEmit` | 5 s | 12/0/2 |

**89 seconds, zero hand-edited files.** The 0.1.11 rerun needed seven
hand-edited files and a sibling-scaffold-and-copy ceremony to reach the
equivalent state. The template ships the Sessions-mode schema, the image-bearing
`send` command, the ImagePicker chat screen, the file-store and crypto
registration, and the plugin root spelling already wired. Every one of the
0.1.11 authoring findings — missing install command, sibling scaffold copy,
broad TypeScript include, missing store registration — is absorbed.

That progress is real and it is exactly why the packaging regression is
expensive: the authoring path is now excellent and the published runtime will
not run its output.

## Ruled OQ5 ceremony measurement

The governing definition is
[`20260806-g4-external-metric-frozen.md`](./20260806-g4-external-metric-frozen.md),
frozen before the original 0.1.10 measurement and ruled unchanged by LLP 0176
OQ5. The chronological source is the quarry's `G4-ACTION-LEDGER.md`.

| Milestone | Time (PDT) | C/F/D | A |
| --- | --- | ---: | ---: |
| `t0`, empty-directory start | 16:31:38 | — | — |
| generated, type-checking app | 16:33:07 | 12/0/2 | 14 |
| **first blocking observation** | 16:36:47 launch, read by 16:38:17 | **50/0/2** | **52** |
| `m1`, first current live-query render | **not reached** | — | — |
| `m2`, committed image send | **not reached** | — | — |

The blocker landed roughly **5–7 minutes** after `t0`. The exact refusal
instant is bracketed rather than pinpointed because the supervisor JSONL
carries no per-event timestamp; the launch and read times are both recorded.

`F = 0` is the headline: no application, backend, or configuration file had to
be hand-edited to reach the blocker. The two decisions were (1) choosing the
guide's alternative creator after its literal first instruction was refused,
and (2) choosing between the guide's npm-flavored install prose and the
template's pinned `bun` package manager.

Post-blocker proof work added one hand-edited file (`eas.json`, authored for
the EAS arm) and many diagnostic commands; per the 0.1.10 precedent those are
retained separately rather than folded back into a frozen milestone vector.

### Bakeoff comparison, with asymmetry retained

No comparison is scored, for the same reasons the frozen metric already gave.
Diary 0058's 26 m 03 s Snapback / 11 m 15 s Convex figures are full-app lanes
with no recountable action vector; Diary 0059 has line counts and paid EAS
results but no clock or command log; Diary 0060 measures orchestration, and its
orchestrator did not rerun either app. The one honest thing that can be said is
narrow and it is about the paved path, not the gate: reaching a generated,
type-checking Sessions chat backend took 89 seconds and no hand-edited file,
which is a different regime from either bakeoff's authoring phase — and it says
nothing about a running app, because no app ran.

## Guarantees ledger

| Guarantee | Result | Evidence / boundary |
| --- | --- | --- |
| Settled Sessions auth | **Missing / not proved** | No backend started, so no session was minted or adopted. The template's schema settles `auth: { mode: 'sessions' }` in source; that is not a runtime proof. |
| Loopback-only listeners | **Not applicable** | No listener was ever created. The supervisor failed between `device-selected` and backend readiness on both platforms. |
| Typed contracts and one descriptor | **Proved** | Public codegen emitted one descriptor/surface/command set with 0 warnings and `tsc --noEmit` passed against the published types, with no string mirror or second app model. |
| Retained cold boot | **Not testable** | Nothing booted, so there was no current query to retain and no cold relaunch to measure. See the honest scoping note below. |
| Truthful command residue | **Not testable** | No command was submitted. |

Nothing here is discounted: three of five guarantee rows are unproved because
the distribution failed, and that is the finding.

## Cold-boot arm — scoped honestly, not claimed

This rerun could not measure the arm at all, but the boundary it would have
measured is worth stating precisely so the next rerun does not overclaim:

- The 0.1.13 supervised-binding-cache repair is **development-path only**. Its
  vocabulary is pruned from production exports by the same `NODE_ENV` gate this
  receipt measured (below), and it carries a 1-hour TTL. A dev-path pass is
  therefore **not** a release-path claim.
- On a **release** app, retained state after a cold relaunch must arrive
  through `prepareReactBinding`'s persisted receipt, per LLP 0181's package
  contract — the provider refuses supervised-dev bindings under the production
  condition, failing with the existing coded
  `SNAPBACK_APP_BINDING_UNAVAILABLE`.
- The 0.1.11 rerun's iOS cold relaunch stayed at boot `starting` with the
  backend paused and rendered only after connectivity returned. That remains
  the last real measurement, and it is a **not proved**, not a pass.

The design question — whether G4's retained-cold-boot arm is a dev-path or a
release-path obligation, given that LLP 0181's contract makes the supervised
cache unavailable in release — is routed to LLP 0181's owner in
[`issues/20260809-g4-cold-boot-arm-dev-vs-release-path.md`](../../../issues/20260809-g4-cold-boot-arm-dev-vs-release-path.md).

## Release-shape development leakage — the first real HBC measurement

Both release exports completed from the public app plus public `node_modules`.
The required `/usr/bin/grep -aF` byte scan of the Hermes bundles:

| Pattern | iOS | Android | 0.1.11 |
| --- | ---: | ---: | ---: |
| `/_snapback/expo/v1/bootstrap` | **0** | **0** | 1 |
| `EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN` | **0** | **0** | 1 |
| `10.0.2.2` | **0** | **0** | 1 |
| `localhost` | 1 | 1 | 1 |
| `__SNAPBACK_EXPO_SUPERVISOR_ORIGIN__` | 0 | 0 | — |
| `[::1]` | 0 | 0 | — |
| `sbs_` | 0 | 0 | 0 |
| `http://127.0.0.1` / `exp://127.0.0.1` | 0 | 0 | 0 |

Three of the four G4 symbols are gone outright. The surviving `localhost` is
**not Snapback's**: a control `expo export` of a bare `create-expo-app`
TypeScript app with **no Snapback dependency at all** contains exactly one
`localhost` and zero of everything else. Both Snapback sites that could emit
the literal sit inside `process.env.NODE_ENV !== 'production'` gates whose
sibling literals (`[::1]`, `10.0.2.2`) are absent from these same bundles,
which is direct evidence those branches were pruned. Full attribution work is
in the [closure receipt](./20260809-g4-external-0116-closure-diagnosis.md).

Read literally as "all four absent", the arm is 3/4. Read as what it is for —
the supervised-development vocabulary must not survive into a release artifact
— it **passes**, and the LLP 0181 prune repair's own deferred measurement is
now discharged against real fixed bytes for the first time.

## Defects and disposition

| Finding | 0.1.16 result |
| --- | --- |
| Runtime packages omit `bin/packaged-store-qualification.receipt.json` | **New, blocking.** [Ticket](../../../issues/20260809-runtime-package-missing-store-qualification-receipt.md). Present in 0.1.15, absent in 0.1.16 on both `darwin-arm64` and `linux-x64`. |
| Guide's literal fresh-app command resolves to an unrelated npm package | **New.** [Ticket](../../../issues/20260809-guide-gap-npx-snapback-new-resolves-wrong-package.md). |
| Template `.gitignore` omits the sibling restore lock | **New, minor.** [Ticket](../../../issues/20260809-expo-chat-template-gitignore-restore-lock.md). |
| Blocking refusal has no guide section | **New.** Folded into the runtime-receipt ticket's acceptance. |
| 0.1.11 raw Android adb transport-label refusal | **Repair present in published bytes; still unexecuted end-to-end** — the run never reached the adb stage. |
| 0.1.11 EAS package-root plugin resolution failure | **Closed.** Noninteractive `eas init` and `eas config` both accept `"@expo/snapback-expo"`. |
| 0.1.11 release-export supervised vocabulary | **Closed on attribution** — see above. |
| 0.1.11 missing install command / sibling scaffold / TS include / store registration | **Closed** by the `expo-chat` template; `F = 0`. |
| Retained cold boot | **Still not proved**, and not testable in this rerun. |

## Receipts

- Ruled metric definition:
  [`20260806-g4-external-metric-frozen.md`](./20260806-g4-external-metric-frozen.md)
- iOS simulator:
  [`20260809-g4-external-0116-ios-simulator.md`](./20260809-g4-external-0116-ios-simulator.md),
  [JSONL](./20260809-g4-external-0116-ios-supervisor.jsonl)
- Android emulator:
  [`20260809-g4-external-0116-android-emulator.md`](./20260809-g4-external-0116-android-emulator.md),
  [JSONL](./20260809-g4-external-0116-android-supervisor.jsonl)
- Closure, exports, EAS, and diagnosis:
  [`20260809-g4-external-0116-closure-diagnosis.md`](./20260809-g4-external-0116-closure-diagnosis.md)
- Quarry archive (untracked working-tree evidence, mirrored off the machine as
  the 0.1.11 quarry lesson requires):
  `~/snapback-release-ledgers/g4-external-0116-quarry-20260809.tar.gz`

No screenshot exists for either platform because no app screen was ever
rendered: the supervisor failed between device selection and backend readiness,
before Metro started and before Expo Go was launched. The retained JSONL
streams are the honest artifact.

All simulator/emulator evidence in this rerun is explicitly **NOT an LLP 0064
claim**, and this rerun produced no device evidence of any kind. G4 remains
open pending a successor closure that ships the packaged-store qualification
receipt, followed by an immediate rerun of the retained quarry.

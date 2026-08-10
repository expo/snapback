# LLP 0176 G4 external distribution rerun against live 0.1.17 — 2026-08-10

## Gate verdict: PASS — G4's simulator/emulator exit is met

Against npm `latest` = 0.1.17, the golden path works **outside** the Snapback
monorepo with no source override, no staging copy, no hidden server dependency,
and no development target in the release artifact. Both platform arms reached
their pass markers through published bytes only, and the two arms that had never
been proved in three prior attempts — the raw Android supervisor and the
end-to-end `m1`/`m2` ceremony — are now proved.

This is **simulator and emulator evidence, explicitly NOT an LLP 0064 `Online`
claim**, per G4's own Exit text. Two arms inside the run did not pass and are
recorded as failures rather than absorbed: **retained cold boot is still not
proved**, and the **post-finalize truthful-residue probe was not reached**.

| G4 arm | Result | Evidence |
| --- | --- | --- |
| Clean external public install / scaffold / codegen / typecheck | **PASS** — 0 hand-edited files, 99 s from an empty directory | [ledger](#ruled-oq5-ceremony-measurement) |
| Published guide's literal fresh-app command | **FAIL** — still resolves to an unrelated registry package | [ticket](../../../issues/20260809-guide-gap-npx-snapback-new-resolves-wrong-package.md) |
| iOS simulator: settled Sessions boot, live query, real picker, committed send, delivery, native render | **PASS — `G4_IOS_PASS`** | [iOS receipt](./20260810-g4-external-0117-ios-simulator.md) |
| Android emulator through the raw public supervisor, no wrapper | **PASS — `G4_ANDROID_PASS`, unconditional** | [Android receipt](./20260810-g4-external-0117-android-emulator.md) |
| adb reverse rules installed / verified / reclaimed against `host-16` | **PASS — 3 / 3 / 3, first live proof** | [Android receipt](./20260810-g4-external-0117-android-emulator.md) |
| Loopback-only listener enumeration, both platforms | **PASS** — 6/6 listeners on `127.0.0.1` | both platform receipts |
| Metro closure from app + public `node_modules` | **PASS** — 0 `/Users/` paths, 0 reach-backs | [closure receipt](./20260810-g4-external-0117-closure-diagnosis.md) |
| No supervisor-development symbols in release exports | **PASS on attribution**, re-proved on fresh 0.1.17 bytes with a fresh control export | [closure receipt](./20260810-g4-external-0117-closure-diagnosis.md) |
| EAS stage-only archive boundary | **PASS** — 88 files / 0.69 MiB | [closure receipt](./20260810-g4-external-0117-closure-diagnosis.md) |
| Noninteractive `eas init` on the package-root plugin spelling | **PASS** | [closure receipt](./20260810-g4-external-0117-closure-diagnosis.md) |
| Real EAS iOS/Android development-client builds | **Not rerun** — the 2026-08-06 authorization was one build per OS and both already ran; cited, not repeated | [0.1.11 receipt](./20260806-g4-external-0111-closure-diagnosis-eas.md) |
| Binding-identity diagnosis lookup | **PASS** — 1 s, correct anchor | [closure receipt](./20260810-g4-external-0117-closure-diagnosis.md) |
| Capability-refusal diagnosis lookup | **FAIL** — 1 s but wrong anchor, no covering section, monorepo paths leaked | [closure receipt](./20260810-g4-external-0117-closure-diagnosis.md) |
| Retained cold boot | **NOT PROVED** — cold relaunch stays at boot `starting` with the backend paused | [iOS receipt](./20260810-g4-external-0117-ios-simulator.md) |
| Truthful command residue (post-finalize) | **NOT REACHED** — the published template exposes no finalized-then-refused affordance | [iOS receipt](./20260810-g4-external-0117-ios-simulator.md) |

LLP 0176 remains **Accepted**. G4's simulator/emulator exit is met; the LLP 0064
receipt still belongs to G5.

## Rerun vector and quarry

The rerun consumed npm `latest` = 0.1.17 from source identity
`0e6bf1842ab291f2e68416fbf40bd2e6debb4290`, ledger
`~/snapback-release-ledgers/fastpath-ledger-0.1.17-0e6bf1842a.json`. The external
quarry is a new, separate Git root at
`/Users/ccheever/projects/snapback-g4-external-0117`, created empty at `t0`.
Neither retained quarry (0.1.11's `snapback-g4-external`, 0.1.16's
`snapback-g4-external-0116`) was read, reused, or mutated.

The release lane's note suggested repointing the retained 0.1.16 quarry's
lockfile to 0.1.17. This rerun deliberately did **not** do that: the frozen OQ5
metric puts `t0` at an empty directory, and a repointed lock would have inherited
0.1.16's authoring history and forfeited the measurement.

**Hosts.** The Air at `ccheever@100.70.173.122` — the original 0.1.11 iOS host,
offline for the whole 0.1.16 lane — was back online and was used again, so this
run is host-comparable with 0.1.11 rather than substituted. iOS 26.4 simulator
runtime, the same version both prior iOS legs used. Android ran on the mini at
`ccheever@100.106.94.95`, AVD `Medium_Phone_API_36.0`, Android 16 / API 36 —
unchanged across all three runs. The apartment M1 Max used as the 0.1.16
substitute was reachable only over a relay and refused SSH; it was not used.
Both hosts were fully reclaimed; see each platform receipt.

## The blocking 0.1.16 regression is repaired in published bytes

`@expo/snapback-runtime-darwin-arm64@0.1.17` ships
`bin/packaged-store-qualification.receipt.json` (2,377 bytes) with a
`binaryIdentity` bound to this build —
`gitCommit 0e6bf1842ab291f2e68416fbf40bd2e6debb4290`, `gitDirty false`,
`buildProfile release`, `buildDistribution public-package` — not a copied 0.1.15
receipt, which the 0.1.16 diagnosis explicitly ruled invalid. Both supervisors
advertised `single_table_v1` and started the generated backend on the first
attempt.

## Ruled OQ5 ceremony measurement

The governing definition is
[`20260806-g4-external-metric-frozen.md`](./20260806-g4-external-metric-frozen.md),
frozen before the original 0.1.10 measurement and ruled unchanged by LLP 0176
OQ5. The chronological source is the quarry's `G4-ACTION-LEDGER.md`.

| Milestone | Time (PDT) | C/F/D | A |
| --- | --- | ---: | ---: |
| `t0`, empty-directory start | 18:56:34 | — | — |
| generated, type-checking app | 18:58:13 | 8/0/2 | 10 |
| **`m1`, first current live-query render** | **19:04:56** | **14/0/3** | **17** |
| **`m2`, committed image send, delivered and rendered** | **19:11:45** | **22/0/3** | **25** |

`m1` is **8 m 22 s** after `t0`; `m2` is **15 m 11 s** after `t0`. Server-side
settlement of the `m2` mutation is independently timestamped at
`sentAt = 1786327896660` — 19:11:36.660 PDT, `t0 + 902.7 s`.

`m1`'s exact render instant is **bracketed, not pinpointed**: it fell between the
19:02:32 Expo Go launch tap and the 19:04:56 capture, because the supervisor
JSONL carries no per-event timestamps. The 0.1.16 receipt recorded the same
limitation.

**`F = 0` at both milestones** is the headline that survives from 0.1.16: no
application, backend, or configuration file had to be hand-edited to reach a
running, committing app. The three decisions were:

- `D1` — choosing the guide's alternative creator (`npm create snapback-app`)
  after its literal first instruction was refused.
- `D2` — reconciling the guide's `npx expo install` npm-flavored prose with the
  template's pinned `packageManager: bun@1.3.12` and printed `bun install`.
- `D3` — choosing how to get Expo Go onto a clean simulator. The supervised loop
  runs Metro under `CI=1` with no interactive `i` key, and no published
  instruction covers the carrier install.

Post-`m2` proof work added 22 further commands and **one** hand-edited file
(`eas.json`, authored for the EAS arm because the template ships none). Per the
0.1.10 and 0.1.16 precedent those are retained separately rather than folded
back into a frozen milestone vector. The Android arm's 12 commands and 0
hand-edited files are reported separately as cross-platform repetition, which is
what the frozen metric directs.

### Comparison against the prior runs

| Run | Result | `m1` | `m2` |
| --- | --- | --- | --- |
| 0.1.10 | FAIL before `m1` | not reached (`73/6/3` at the blocker, ~11 min) | not reached |
| 0.1.11 | FAIL (Android conditional) | `112/7/4` | `112/7/4` |
| 0.1.16 | FAIL before `m1` | not reached (`50/0/2` at the blocker, 5–7 min) | not reached |
| **0.1.17** | **PASS** | **`14/0/3` at 8 m 22 s** | **`22/0/3` at 15 m 11 s** |

Against the last run that reached both milestones, 0.1.11's `112/7/4`, this run
is `22/0/3`: **an 80 % reduction in commands and seven hand-edited files down to
zero.** The 0.1.11 wall clock is not directly comparable — its `m1` was 6 m 54 s
after a hands-on resume but 5 h 05 m after its own `t0` — so the honest
wall-clock statement is only that this run went from an empty directory to a
committed, delivered, rendered image send in **15 minutes with no file edited**.

### Bakeoff comparison, with asymmetry retained

No comparison is scored, for the reasons the frozen metric already gave. Diary
0058's 26 m 03 s Snapback / 11 m 15 s Convex figures are full-app lanes with no
recountable action vector; Diary 0059 has line counts and paid EAS results but
no clock or command log; Diary 0060 measures orchestration and its orchestrator
did not rerun either app. What can be said narrowly, and only about the paved
path: reaching a generated, type-checking Sessions chat backend took 99 seconds
and zero hand-edited files, and reaching a committed and rendered image send
took 15 minutes and still zero hand-edited files. Those are different regimes
from either bakeoff's authoring phase, and they are not a win over Convex,
because the bakeoffs measured a different thing.

## Guarantees ledger

| Guarantee | Result | Evidence / boundary |
| --- | --- | --- |
| Settled Sessions auth | **Proved** | Both supervisors report `authority: {status: ready, kind: session, authMode: sessions}`; the schema settles `auth: { mode: 'sessions' }`; the committed asset's `ownerPrincipal` is an ordinary `usr_` session identity. No admin or impersonation bearer entered app code. |
| Loopback-only listeners | **Proved** | 3/3 loopback listeners on each platform, enumerated by the supervisor itself. Android used verified adb reverse only, with the `10.0.2.2` fallback marked unused. |
| Typed contracts and one descriptor | **Proved** | Public codegen emitted 5 tables / 12 operations / 7 live with **0 warnings**; `tsc --noEmit` passed against the published types; the source maps show exactly one generated descriptor/surface/binding set and no string mirror or second app model. |
| Retained cold boot | **Missing / not proved** | Cold relaunch with the backend paused stayed at boot `starting` for over two minutes and rendered only after the backend resumed. Reproduces the 0.1.11 result exactly. |
| Truthful command residue | **Not reached** (post-finalize probe); **no false atomicity observed** | The published template exposes no finalized-then-refused affordance. An in-flight suspension left the command at `transferring · 0%` / `Offline` claiming nothing, and on resume it committed exactly once with no duplicate row. |

Three of five proved, one not proved, one not reached. Nothing here is
discounted.

## Defects and disposition

| Finding | 0.1.17 result |
| --- | --- |
| Runtime packages omit `bin/packaged-store-qualification.receipt.json` | **Blocking half CLOSED** — present and identity-bound; both platforms boot. The [ticket](../../../issues/20260809-runtime-package-missing-store-qualification-receipt.md)'s consumer-diagnosability half stays open. |
| Guide's literal fresh-app command resolves to an unrelated npm package | **Still open, still bites verbatim** — it cost this run its first author decision, 19 s after `t0`. |
| Template `.gitignore` omits the sibling restore lock | **Still open, still bites** — unchanged in the scaffolded output. |
| Capability refusal has no covering guide section, and the diagnostic leaks monorepo paths | **Still open** — retested verbatim; less urgent now that the refusal no longer fires on the paved path. |
| Cold-boot dev-path vs release-path scoping | **Still open, not settled by this run**; new measurement limitation recorded (Expo Go cannot cold-boot with the supervisor down, because that kills Metro too). |
| 0.1.11 raw Android adb transport-label refusal | **CLOSED by live execution** — 3 rules installed, verified, and reclaimed against real `host-16` output, with no wrapper. |
| 0.1.11 EAS package-root plugin resolution failure | **Remains closed** — reconfirmed on 0.1.17. |
| 0.1.11 release-export supervised vocabulary | **Remains closed on attribution** — re-proved on fresh 0.1.17 bytes with a fresh Snapback-free control export. |
| Template `package.json` pins `^0.1.16` inside the 0.1.17 closure | **New, cosmetic** — caret resolution still selects 0.1.17, but the pins drift one closure behind and would stop resolving at a `0.2.0` boundary. |

## What this receipt explicitly does NOT claim

- **Not an LLP 0064 `Online` claim.** All device-shaped evidence here is a
  simulator and an emulator. LLP 0064's bar is per-OS *device* evidence, and G4's
  own Exit text defers that receipt to G5 when no device carrier exists. None
  existed in this run.
- **No physical-device evidence** of any kind was produced, on either OS.
- **No store or production release artifact.** The only release-shaped outputs
  are local `expo export` bundles. No paid EAS build ran; the two cited builds
  are the 2026-08-06-authorized 0.1.11 ones.
- **No hosted-backend claim.** Every listener was host loopback, reached over
  same-host loopback on iOS and verified adb reverse on Android.
- **No retained-offline claim** and **no local handler execution claim**: the
  cold-boot arm did not pass, and this surface is Online by construction.
- **No release-path retained-state claim.** The cold-boot arm measured the
  supervised development path only.

## Receipts

- Ruled metric definition:
  [`20260806-g4-external-metric-frozen.md`](./20260806-g4-external-metric-frozen.md)
- iOS simulator:
  [`20260810-g4-external-0117-ios-simulator.md`](./20260810-g4-external-0117-ios-simulator.md),
  [JSONL](./20260810-g4-external-0117-ios-supervisor.jsonl),
  [`m1`](./20260810-g4-external-0117-ios-simulator.png),
  [`m2`](./20260810-g4-external-0117-ios-m2-committed.png),
  [cold relaunch](./20260810-g4-external-0117-ios-cold-relaunch-starting.png)
- Android emulator:
  [`20260810-g4-external-0117-android-emulator.md`](./20260810-g4-external-0117-android-emulator.md),
  [JSONL](./20260810-g4-external-0117-android-supervisor.jsonl),
  [`m1`](./20260810-g4-external-0117-android-m1.png),
  [`m2`](./20260810-g4-external-0117-android-emulator.png)
- Closure, exports, EAS, and diagnosis:
  [`20260810-g4-external-0117-closure-diagnosis.md`](./20260810-g4-external-0117-closure-diagnosis.md)
- Quarry archive (untracked working-tree evidence, mirrored off the machine as
  the 0.1.11 quarry lesson requires):
  `~/snapback-release-ledgers/g4-external-0117-quarry-20260810.tar.gz`,
  16,317,884 bytes, 285 entries, SHA-256
  `627d66373371246847f81a3f7c1cfd3e0b4eeb6f1d1c6594a0a191c2f0bbf72c`. Excluded:
  `node_modules` only. It contains both action ledgers, both supervisor JSONL
  streams, all thirteen iOS and four Android screenshots, both release exports
  with source maps, the Snapback-free control export, the Maestro flows, and the
  app itself. The source directory was not modified.

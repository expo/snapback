# LLP 0176 G4 external distribution rerun against live 0.1.11 — 2026-08-06

## Gate verdict: FAIL, with substantial closure evidence

G4 is **not complete** against live 0.1.11. The coherent runtime/picker repairs
worked and the iOS app reached its full marker, but three required arms remain
red:

1. the unmodified public Android supervisor rejects current adb's
   selected-device transport label before app launch;
2. both release Hermes bundles retain the supervised bootstrap path,
   supervisor-origin symbol, and development host literals; and
3. the retained offline cold-relaunch guarantee was not proved—the app stayed
   at `starting` until connectivity returned.

Two real authorized EAS development-client builds finished, Metro/package
closure is clean, diagnosis is fast and publicly discoverable, and the
Android app-level image chain passes under a transparent adb verification
wrapper. Those facts are retained without upgrading the failed distribution
gate.

| G4 arm | Result |
| --- | --- |
| Clean external public install/codegen/runtime | PASS on 0.1.11 |
| iOS simulator provider + live query + committed/rendered image | `G4_IOS_PASS` |
| Android emulator, unmodified public supervisor | **FAIL** — `SNAPBACK_EXPO_ADB_REVERSE_FAILED` |
| Android app chain under verification-only wrapper | Conditional `G4_ANDROID_PASS` |
| Metro app + public-node_modules closure | PASS |
| EAS stage-only archive boundary | PASS after source helper repair; 42 files / 0.87 MiB |
| Real EAS iOS/Android development-client builds | PASS / PASS |
| No supervisor-development symbols in release exports | **FAIL** |
| Deliberate public-doc diagnosis probe | PASS, 2 ms diagnostic / 2 s lookup |
| Retained cold boot | **Not proved** |
| Truthful command residue | PASS (`null` on commit, `inferred` on proved refusal) |

LLP 0176 remains **Accepted** and G4 remains open.

## Install and scaffold path actually taken

The repository at `/Users/ccheever/projects/snapback-g4-external` was created
empty, `git init`-ed outside the monorepo, and populated with a blank Expo 57
TypeScript app. Because the published guide named constraints but no complete
command, the proof directly installed public CLI, client, codegen, Expo, and
React roots, then the Expo filesystem/crypto/ImagePicker modules. Contract was
not added directly. `snapback new --template react` creates a complete app, so
the proof created that scaffold in a clean sibling directory and copied only
its conventional `snapback/` backend into the Expo root.

The app authored Sessions schema/functions/seed, one `conversation` surface,
one image-bearing `commands.send`, and the north-star React Native screen. It
registered Expo files plus secure randomness before provider construction,
generated the descriptor, and narrowed the blank Expo TypeScript include to
entrypoints plus generated declarations. The source guide now documents this
exact registry/scaffold/typecheck path; that guide update is not in 0.1.11.

The final lock contains no `file:`, link, workspace, override, resolution,
monorepo path, or unpublished byte.

## Fast-path provenance consumed, not reopened

All ten 0.1.11 names were already live and byte-verified from source identity
`281eb17c785f5ca82185fd34ad5de8049e852bf5`. The retained ledger is
`~/snapback-release-ledgers/fastpath-ledger-0.1.11-281eb17c78.json`; the four
commits between that identity and the then-current tip were non-shipping proof
fixture repairs. The promotion log now records attempt 7's concurrent-publish
stop (this lane made no npm mutation) and reconciliation. This receipt cites
the same LLP 0041 fast-path precedent as 0.1.10 and does not re-litigate it.

## Ruled OQ5 ceremony measurement

The metric in
[`20260806-g4-external-metric-frozen.md`](./20260806-g4-external-metric-frozen.md)
was frozen before the external directory existed and is now ruled by LLP 0176
OQ5 without changing its definition. The retained chronological source is the
external repo's `G4-ACTION-LEDGER.md`.

| Milestone | Time | C/F/D | A |
| --- | --- | ---: | ---: |
| `t0`, empty-directory start | 12:13:34 PDT | — | — |
| 0.1.10 blocker | about 12:24 PDT | 73/6/3 | 82 |
| `tR`, hands-on 0.1.11 continuation | 17:11:46 PDT | 75/6/3 at handoff | 84 |
| `m1`, first current live-query render | 17:18:40 PDT | **112/7/4** | **123** |
| `m2`, committed image returned and rendered | 17:23:58 PDT | **112/7/4** | **123** |

Secondary clocks: `m1` was 6m54s after `tR`; `m2` was 12m12s after `tR`,
5m18s after `m1`, and 5h10m24s after the original `t0`. The cumulative clock
honestly includes the failed 0.1.10 attempt and time waiting for the successor
release. UI taps/observation do not count as author commands under the ruled
definition.

The four author decisions at the milestones were: selecting the missing
public install set; composing a sibling full scaffold into an existing Expo
root; narrowing the broad TypeScript boundary; and preserving/ignoring the
host-pinned restore lock after its refusal. The seven distinct hand-edited
app/backend/configuration files are recorded in the action ledger.

### Bakeoff comparison, with asymmetry retained

- Diary 0058 records full-app lanes of 26m03s for Snapback and 11m15s for
  Convex, plus 1,202 versus 868 authored source/test lines. G4's 12m12s
  `tR→m2` is directionally close to that Convex full lane and below the
  Snapback full lane, but it resumed an already-authored 75-command repository
  and excludes the earlier failed/waiting time. It is not an apples-to-apples
  win. Cumulative G4 is 123 actions; Diary 0058 has no recountable action
  vector.
- Diary 0059 records shared UI 881 lines, Snapback backend/adapter 602 plus a
  138-line launcher, and Convex backend/adapter 424; both EAS builds passed. It
  has no authoring clock or command log. G4 now also has two successful real
  EAS builds, but measures a different app and cannot synthesize a comparison
  score.
- Diary 0060's 15–20+ minute values are orchestration/worktree/landing time,
  not app authoring, and its orchestrator did not rerun either app.

## Guarantees ledger

| Guarantee | Result | Evidence / boundary |
| --- | --- | --- |
| Settled Sessions auth | Proved | Both ready/provider events report ordinary `{ kind: session, authMode: sessions }`; no admin/impersonation bearer entered app code. |
| Loopback-only listeners | Proved on iOS; conditionally proved on Android | Every host listener is `127.0.0.1`; Android's successful app run had exactly three reverse rules, but public 0.1.11 needed the label wrapper. |
| Typed contracts and one descriptor | Proved | Public codegen plus `tsc --noEmit`; generated surface/command references only, no string mirror or second app model. |
| Retained cold boot | **Missing / not proved** | Cold relaunch remained `starting` while the paused backend was unavailable; retained appeared only after resume. |
| Truthful command residue | Proved | Committed image send had residue `null`; finalized-then-refused probe reported only `inferred`, never rollback/safe deletion. |

## Platform and EAS results

The Air used iOS 26.4 simulator same-host loopback and public runtime commit
`281eb17c…`; it emitted `G4_IOS_PASS` after a real picker selection, proved
commit, live delivery, and native image render. The mini used Android 16/API
36. Its raw public supervisor failed the current-adb label check; the
transparent wrapper then produced the same provider/query/picker/commit/render
chain and `G4_ANDROID_PASS`. Both supervisors reclaimed all owned processes;
Android reclaimed all three rules. Remote task roots, automation runtimes,
injected Android media, emulator/simulator processes, and adb server were
removed per the G1–G3 cleanup rules.

Both platform screenshots retain the historical seeded body “Published
0.1.10 live query.” Their visible 0.1.11 package headers, exact registry lock,
and packaged runtime identity establish the rerun version; the seed label was
corrected only after capture so the evidence images remain untouched.

EAS project `7183485f-a8f5-4cdd-a0ac-aa5683b67c24` produced:

- iOS simulator development client
  [`be6971f1-8de1-4796-b1b0-a601aed741bd`](https://expo.dev/accounts/ccheever/projects/snapback-g4-external/builds/be6971f1-8de1-4796-b1b0-a601aed741bd), finished;
- Android internal development client
  [`c87157f4-2f95-401e-bb34-b956e01f29c9`](https://expo.dev/accounts/ccheever/projects/snapback-g4-external/builds/c87157f4-2f95-401e-bb34-b956e01f29c9), finished.

These are real development-client artifacts, not production/store artifacts,
and were not run on physical devices.

## Defects and disposition

| Finding | 0.1.11 result / source disposition |
| --- | --- |
| 0.1.10 `single_table_v1` runtime mismatch | Fixed and published in 0.1.11. |
| 0.1.10 missing Expo picker adapter/type | Fixed and published in 0.1.11. |
| Exact binding-diagnostic guide search | Fixed and published in the 0.1.11 embedded guide. |
| No complete registry/scaffold/typecheck path | Source guide fixed here; awaiting landing/public guide. |
| Host-pinned restore lock crosses transfer/stage | Source guide + staging helper/tests fixed here; [`issue`](../../../issues/closed/20260806-guide-gap-external-residue-portability.md), awaiting landing/public guide. |
| Current adb reports `host-16` | CLI parser/test fixed here; [`issue`](../../../issues/closed/20260806-expo-adb-reverse-transport-label.md), awaiting release. |
| EAS cannot resolve 0.1.11 package-root plugin | Root conditional export/test fixed here; [`issue`](../../../issues/closed/20260806-expo-config-plugin-eas-root-export.md), awaiting release. |
| Retained marker could fire after current | External fixture fixed; real cold-process witness remains open. |
| Supervisor bootstrap/origin symbols in release HBC | Still present; existing umbrella ticket stays open; fix not in scope tonight. |

## Receipts

- Ruled metric definition:
  [`20260806-g4-external-metric-frozen.md`](./20260806-g4-external-metric-frozen.md)
- iOS simulator:
  [`20260806-g4-external-0111-ios-simulator.md`](./20260806-g4-external-0111-ios-simulator.md),
  [screenshot](./20260806-g4-external-0111-ios-simulator.png),
  [JSONL](./20260806-g4-external-0111-ios-supervisor.jsonl)
- Android emulator:
  [`20260806-g4-external-0111-android-emulator.md`](./20260806-g4-external-0111-android-emulator.md),
  [screenshot](./20260806-g4-external-0111-android-emulator.png),
  [conditional JSONL](./20260806-g4-external-0111-android-supervisor.jsonl),
  [raw public failure](./20260806-g4-external-0111-android-unwrapped-failure.jsonl)
- Closure, leak, diagnosis, and EAS:
  [`20260806-g4-external-0111-closure-diagnosis-eas.md`](./20260806-g4-external-0111-closure-diagnosis-eas.md)

All simulator/emulator evidence is explicitly **NOT an LLP 0064 claim**. No
physical-device route exists. The EAS iOS artifact is itself simulator-only.
G4 makes no production/store release-artifact claim and remains open for a
successor registry rerun plus the release-leak and retained-cold-boot closures.

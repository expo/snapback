# NP-mac round 1 — 2026-09-29 UTC

**LLP 3000.030 §11 passes; Status: Accepted.** A own Release, B repack and
warm own B complete prime, cold offline and restart. Repack is implemented
as `witness ios --repack <build.json> --app-project <project> --smoke`.
Five complete repack runs pass: median **46.109 s**, nearest-rank p95
**56.639 s**. These are warm, pinned-host observations, not a general guarantee.

## Acceptance and complete timings

| Run | Preparation ms | Prime ms | Offline ms | Restart ms | Complete command ms | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| a-ownbuild-1 | 202,792 | 6,907 | 4,912 | 5,402 | 230,746 | all passed |
| b-repack-1 | 22,233 | 5,608 | 5,635 | 5,523 | 42,666 | all passed |
| b-repack-2 | 23,992 | 5,886 | 5,366 | 5,678 | 44,714 | all passed |
| b-repack-3 | 29,189 | 5,439 | 5,513 | 6,043 | 50,521 | all passed |
| b-repack-4 | 34,547 | 6,929 | 5,411 | 5,648 | 56,639 | all passed |
| b-repack-5 | 24,791 | 5,441 | 5,732 | 6,026 | 46,109 | all passed |
| b-warm-ownbuild-1 | 129,920 | 5,119 | 5,127 | 5,039 | 149,000 | all passed |

The predeclared five-run sample is b-repack-1 through b-repack-5: zero
failed qualification attempts. Median is the third sorted duration; nearest-rank
p95 is rank ceil(0.95 × 5) = 5. All elapsed times include snapshotting,
fingerprint/input hashing, bundling, install, normal session restoration,
all three segments, capture finalization, collection and final hashing.
Each output has a new sealed proof and fresh artifacts. The setup has installed
locked dependencies/tools, a preserved A base and a booted simulator. B and
warm B reuse the same normal session, backend and eight-message fixture.
No reset or installation occurs between segments. The later ten-attempt,
broader-host study remains a separate RFC increment; this commission asked
for at least five complete runs.

| Phase | Own A ms | Repack B1 ms | Warm own B ms |
| --- | ---: | ---: | ---: |
| Snapshot | 9,677 | 5,362 | 4,854 |
| CocoaPods | 19,081 | — | 14,717 |
| Xcode / repack command | 144,125 | 4,555 | 92,183 |
| Install and installed inventory | 4,502 | 777 | 754 |

The first round-1 A build used the existing private native cache, so 230.746 s
is not a cold-cache claim. The dedicated simulator boot took 19.828 s, outside
those command times. No dependencies or tools were installed in round 1.
Stage-0 cold setup/build observations and every failed round-0 attempt remain
in the [round-0 report](../REPORT.md). This round does not invent a fresh
cold dependency/Xcode download cost. The host is shared; preparation varied
from 22.233 to 34.547 s across the five repacks.

## Compiler residency and actual results

The driver compiles the owned backend and sends all eight eligible query facts
to the app. The helper checks them against the kept program and records them
in every smoke receipt. The driver independently validates query classification,
coverage and result state. Missing facts, device-answerable loading, throws
and uncaught errors fail. No result grants server-only classification.

| Query class | Offline result | Online prime/restart |
| --- | --- | --- |
| Six device-answerable queries | All return data; count/completeness/freshness retained | Existing acquisition/state contract |
| chat.typingInMyRooms (`runs: server`) | `loading`, explicitly “online-only: unavailable offline (expected)” | ready, count 1 |
| insights.summary (`runs: server`) | explained `E_OFFLINE`, same expected-unavailability label | ready, count 1 |

Each restart consumes its exact zero-write barrier and rereads final native
state. The full smoke is still limited to no-argument/all-optional queries;
required arguments and deeper application behavior need app scenarios.
The [original issue](../../../../issues/closed/20260929-snapback4-native-smoke-ephemeral-loading.md)
is closed under the supervisor ruling. The separate
[one-shot refusal follow-up](../../../../issues/20260929-snapback4-server-only-query-offline-refusal.md)
does not change client semantics in this lane.

## Payload identity and visible execution

| Value | Own A | Repack B | Warm own B |
| --- | --- | --- |
| App file bytes | 51646993 | 50989345 | 51646965 |
| App file MiB | 49.25 | 48.63 | 49.25 |
| Local tar+gzip bytes | 14407664 | 14081529 | 14407601 |
| HBC version | 98 | 98 | 98 |
| HBC bytes | 3465552 | 2807904 | 3465524 |

All five B app inventories are identical. A and every B have fingerprint
`8743623f984ef849a1acbb1975ac5f8c67d74bcf` and exactly equal native Mach-O lists.
The native executable SHA-256 is
`b296e288f68ac0fab814b7fb7d2fbecca8e81083ee72c8003ac4ff1a208b5c15`.
A JS SHA-256:
`87fa4f102b7f450af5a9599e5ad26e7b1c337e2d87c627678fe174cc45fb8634`.
B JS SHA-256:
`92f357a0ca44467932dedfe3dafe2a0dffb2eaa1a0504a6a502db3438eb770dc`.
A app inventory:
`fe2bbd5f2609d0eac67b98eb88314f9d9720b961d2797e6c6ee618b6f947eec0`.
B app inventory:
`8836242eb647ae2ecb3a0b10ed3b1f29dfca545684e7779719b05da521767213`.
Warm own B is a separate Xcode result; no native-byte equality claim is
made for its relink. Complete hashes and phase records are in the receipts.

The only A→B payload changes are `main.jsbundle` and the 1×/2×/3×
`assets/assets/np/probe` PNGs. The adapter now requires exact equality with
the pinned export:embed resource graph, in addition to the complete app diff.
Info.plist, Expo.plist, EXConstants and all native bytes stay identical.
There is no metadata rewrite or ad-hoc re-sign repair. Installation accepts
only the already measured byte-preserving framework mode normalization.

CocoaPods and JS-export hermesc have SHA-256
`459d352c9a3cfdbe9289a167d93f7e30700c6ee591dfee3a4d52dc26eb8548cb`,
package 250829098.0.17 and HBC 98. The producer flags differ: repack uses
bytecode/`hermes` export settings, whereas Xcode invokes CocoaPods hermesc
with optimization. The header and compiler checks are supplemented by
actual cold execution and native startup hashes on every segment.

The [A offline screen](screens/a-ownbuild-1/smoke-ios-offline.png),
[B offline screen](screens/b-repack-1/repack-smoke-ios-offline.png), and
[B restart screen](screens/b-repack-1/repack-smoke-ios-restart.png)
show the actual conversation, A/blue or B/green marker, loaded font and
visible proof kind/digest. Startup observes embedded first-import Constants,
a file SourceCode URL, Release/Hermes, and no update/dev-launcher manifest.
A local WAV resolves from embedded resources; no audio-playback claim is made.
The normal app signs up and seeds eight messages through real mutations.
No synthetic session, store, response, scheme rewrite, Metro process or GUI
automation is used. The same subject probes/native UIScene prerequisite
from round 0 are retained.

## Controls and failures

| Run | Expected failure and retained evidence |
| --- | --- |
| control-scheme | Temporary scheme change: E_WITNESS_NATIVE_COMPAT before install, field diff and --build recovery. Original source restored. |
| control-tampered-base | A cloned base with corrupted HBC bytes: E_WITNESS_PROOF before install. Original A untouched. |
| control-cold-error | Injected uncaught cold startup error persists as smoke:failed; offline fails, restart unrun, exit 1. Source restored. |
| control-death-restart | After an actual successful restart receipt, SIGKILL owned launch PID 2287; restart is failed and command exits 1. The injection record binds the prior successful receipt. |
| control-concurrent-owner | A separate live holder of the actual simulator lease remains alive; witness refuses E_WITNESS_PROCESS without replacing it. |
| control-busy-port | The test-owned listener still accepts after E_WITNESS_PORT; only its owner closes it. |

Round-0 controls and failed attempts remain preserved, including the original
real post-prime death and concurrent witness records. Unit/driver tests retain
device-query loading, missing/reclassified facts, stale restart barrier and
death after each segment as failures. The expected negative controls are not
mixed into the five-run success timing sample; their full command durations
and failure manifests are retained.

This round also retains four initial test-invocation/assertion failures:
two cargo commands were mistakenly run from the repository root and exited
before accessing Snapback 4; one driver test still asserted that --repack was
unavailable; one guide check needed the two new output paths in APP_FILES.
The corrected affected checks pass. No failed native qualification attempt
was hidden or relabeled; the six intentional controls above all exit 1.

## Source, host, review and package custody

The required first fetch/merge produced `ac6a6076d8` with origin/main
`f9620c815b`. The only conflict was JOURNAL.md; both entries were kept.
Branch: sb4-np/np-macos. Each outer command records the CLI binary hash,
exact argv, cwd, allowed environment subset, PID and full elapsed time.
CLI hashes differ across the build/test rebuilds; the smoke/preparation logic
is unchanged across the five measured repacks. The final driver additionally
prints explicit own/repacked smoke success wording.

Host: Apple M5 Pro mini, 18 cores, 64 GiB, macOS 27.0 (26A428),
Xcode 27.0 (27A266a), iOS 27.0 simulator, CocoaPods 1.17.0,
Node 24.18.0, Bun 1.3.12, Rust 1.97.0. The owned device is
`87959305-8A14-4FE5-9EF7-4CE303C03DB0` (np-mac-round1, iPhone 18 Pro).
Only this UDID was used; mini-verify-iphone was never selected or touched.
DEVELOPER_DIR and the commissioned Node/Bun/Rust PATH were explicit.
No system, Xcode, keychain or signing setting was changed.

Expo 57.0.22, RN 0.86.3, CLI 57.0.27, fingerprint 0.20.13, repack 0.10.3,
snapback4 and snapback4-expo 0.4.7. The lock and complete resolved package
pins/integrities are archived. All 178 published client files and all seven
native core XCframework files compare equal to the stage-0 install.
The four local witness helper changes are separately retained in
[subject-helper.patch](subject-helper.patch); they are unpublished source
patches, not a claim about pristine 0.4.7 helper bytes. No core/client/query
semantics or wasm source changed. The 593,719 B gzip wasm cap is unchanged;
no fresh wasm measurement is claimed.

Both round-1 reviews were applied: direct controlled Xcode builds avoid the
wrong concrete-device Expo launch path; the documented manual alternative
uses --device generic; both prepared routes exclude linked expo-updates;
stable snapshot/DerivedData mutations hold a project lease; legacy m6/m8
names stay installed-m6/m8; repack is locked in the app, requires
--js-bundle-only, compares both compiler identities and exact assets/native
metadata. No re-sign was necessary. The explicitly commissioned owner/port
controls remain despite the suggestion to drop them.

## Validation and artifact retention

Final affected checks: **27 driver tests, 9 witness unit tests, 23 helper/
payload/smoke tests, and 98 guide checks pass**. The reference audit also
passes: 524 LLP documents, 9,858 refs, zero errors or unchecked refs. Commands and logs are in
the raw evidence. These are macOS runs; Linux-safe cases were not executed
on a Linux host. No new repository gate or full-battery claim is made.

[EVIDENCE.json](EVIDENCE.json) maps each raw file to its deterministic gzip
copy and both hashes. [Verification code](tools/verify-evidence-r1.py)
independently recomputes every payload entry, HBC magic/version, phase hash
and run artifact hash. App payloads, local archives, original MP4 recordings,
repack work directories and xcresults remain under
`/Users/ccheever/sb4-np/evidence/round1/`, bound by the committed inventories.
The report does not pretend those large local artifacts are Git blobs.
The private backend/session stores are excluded. Source controls are restored;
the owned simulator is shut down and deleted after collection.

This accepts the bounded first slice and exposes repack for its pinned adapter.
Publication, physical devices, general SDK/native shapes, M1 discovery study,
complete M6/M8 assertions/projection/admission and the broader repeatability
increment remain separate work. Nothing was pushed or published.

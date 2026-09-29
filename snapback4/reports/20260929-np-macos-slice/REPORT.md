# NP-mac round 0 — 2026-09-29 UTC

**Partial implementation; LLP 3000.030 §11 does not pass.** Own Release
preparation, installation, direct launch and provenance work. A and B display
real retained history offline. Full smoke refuses the published client's
`chat.typingInMyRooms` loading result; restart is never reached. No query,
schema, client result or smoke assertion was changed to manufacture a pass.
The implemented route is `witness ios --build`; **`--repack` is unavailable**.
The unqualified candidate is preserved as a patch for investigation.

## Acceptance and measurements

| §11 | Result |
| --- | --- |
| 1: own A, immutable build, complete smoke | Preparation and native observations pass; prime passes, offline smoke fails, restart not run. Step 1 incomplete. |
| 2: B repack, native equality, changed JS/assets, complete smoke | Fingerprint, HBC, native equality, config, actual launch and visible B asset verified. Same smoke failure. **Step 2 not claimed.** |
| 3: bounded controls | Scheme and tampered-base refusals precede install; injected cold error fails; killing the owned app after prime success fails; concurrent owner and busy listener preserved. |
| 4: warm own B comparison | Same native workspace, simulator, backend, authentication policy and held fixture; same offline failure. Measured partial attempts, not successful complete-smoke timings. |

Times are milliseconds, including install, driver cleanup, collection and hashing
in the outer command totals. Preparation is the helper's receipt duration;
its final serialization/receipt write is included in the outer total, not that
inner timer. Individual commands and their phase log hashes are retained.
No timeout was raised from the default 120 seconds per smoke step.

| Phase | Own A | Candidate B repack | Warm own B | Final own-B route recheck |
| --- | ---: | ---: | ---: | ---: |
| Preparation receipt | 159,155 | 17,121 | 128,906 | 137,791 |
| Snapshot copy | 4,386 | 4,369 | 4,560 | See raw phases |
| CocoaPods | 12,244 | — | 12,587 | See raw phases |
| Xcode / repack command | 122,507 | 4,284 | 95,251 | See raw phases |
| Install plus installed-payload verification | 5,753 | 781 | 892 | See proof |
| Prime, including native launch/screenshot/termination | 6,609 | 5,240 | 5,766 | See run |
| Offline, failed | 4,769 | 4,763 | 5,229 | See run |
| Outer command | **181,436** | **31,413** | **144,606** | **155,058** |
| Exit | 1 | 1 | 1 | 1 |

A is `a-ownbuild-1`; B is `b-repack-1`; warm B is `b-warm-ownbuild-1`.
`b-final-ownbuild-2` rechecks the final build-only implementation after removing
the candidate flag. All are **failed complete-smoke attempts**, including the
31.4-second repack. There are zero complete successes, no valid median/p95,
and no ≤120-second claim. Native caches/dependencies/tools were warm. The
first private DerivedData build earlier took 214,400 ms preparation and failed
at installation verification. Dependency installation and simulator boot logs
are retained, but setup was not comprehensively timed; no cold end-to-end
claim is made. Stage 0's 359/138/13-second observations remain partial prior
measurements, not substitutes for these attempts.

## Exact host, source and package custody

Initial required merge: design `a9f0610133632e7a45325a79d42ab9b054bfec7e`
merged `origin/main` at `4fd338de59407ab6b7cc7009e27001c877cacfe9` without
conflicts, producing `7acbed690e7940c6a0bbedcad5f2f2818ba85875`. The LV revert
and SQ landing are included. Branch: `sb4-np/np-macos`. Native commands used
this worktree's `cargo build -p snapback4` binary, not the published CLI shim.
Per-command binary hashes distinguish experimental and final builds.

Host: Apple M5 Pro, Mac17,16, 18 physical/logical cores, 68,719,476,736 B RAM;
macOS 27.0 (26A428), Xcode 27.0 (27A266a), SDK/runtime iOS 27.0, CocoaPods
1.17.0, Rust 1.97.0 (2d8144b78), Node 24.18.0, Bun 1.3.12. PATH puts the
commissioned Node/Bun and `~/.cargo/bin` first; DEVELOPER_DIR is
`/Applications/Xcode.app/Contents/Developer`. No system, keychain or Xcode
selection settings were changed. Only our two explicitly named UDIDs were
used; both were shut down and deleted after the experiments. The other
session's simulator was never selected or operated.

The app is copied from `~/np-stage0/clique` to `~/sb4-np/subject`, excluding
secret environment files. No `provider-secrets.env` was opened. Both packages
remain **0.4.7**. All 178 published `snapback4` files and all 7 native
XCframework files independently compare equal to stage 0. Only the three
witness-helper files in [subject-helper.patch](subject-helper.patch) differ
inside `snapback4-expo`; these are explicitly **local, unpublished patches**,
not pristine published helper bytes. No Rust device/core/contract or wasm
source changed; the **593,719 B gzip cap is unchanged**, with no new wasm
measurement claimed.

Expo 57.0.22; RN 0.86.3; Expo CLI 57.0.27; fingerprint 0.20.13; dev-client
57.0.19; Router 57.0.23; video 57.0.5; image-picker 57.0.20; secure-store
57.0.4; sqlite 57.0.3; font 57.0.4; asset 57.0.18. Exact package JSON,
lockfile hashes and repack integrity are in the archived `package-pins.json`.
Repack 0.10.3 was installed exactly as an app dev dependency before the base;
its installed files measure 25,790,159 B. It is not a new CLI/package dependency.

## Subject changes before the measured base

[subject.patch](subject.patch) and [subject/](subject/) retain the final copied
app changes. The A probe source is in raw evidence and its blue assets are in `subject/A-assets/`; B
changes `NP A` to `NP B` and the single logical scaled image from blue to green
(1×/2×/3× variants). Native/config inputs are unchanged between measured A/B.

The app consumes EXPO_PUBLIC_SNAPBACK_URL; preparation sets
`http://127.0.0.1:49371`, and the driver checks the actual client origin.
The probe uses ordinary password signup, creates two test profiles, a group
and eight messages through normal application mutations, and waits for write
settlement. Random passwords are kept in memory, never recorded; normal auth
persistence is the existing SecureStore. Fixture identity is saved in a
separate SecureStore key. A starts with a fresh owned simulator and fresh
backend; later B/controls reuse that store and session. No data reset occurs
between a run's prime/offline/restart segments, and the driver seeds no rows.

The probe mounts outside the account-keyed AppProvider, routes to the app's
actual conversation screen, and delays smoke attachment until the same real
client has read eight messages and the image has rendered. It neither replaces
the client nor changes query results. It records first-import embedded Constants,
the native SourceCode file URL, Hermes/Release, no dev-launcher/update manifest,
loaded JetBrains Mono (from the subject's Expo dev-menu assets), a scaled
`../assets/np/probe.png`, and a local bundled WAV reference. The WAV is resolved,
not an audio-playback qualification. No Metro or network asset server is used.

Expo 57.0.22's generated AppDelegate used the legacy window lifecycle; iOS 27
terminated it before JS. The copied app was migrated to a UIWindowScene delegate
using the same Expo factory/providers, with URL/user-activity forwarding. No
scheme, bundle ID or loader was rewritten. This prerequisite is recorded rather
than silently implemented in the build driver. A dangling unused `schema`
symlink to absent `instrument/schema` was removed after its initial refusal.

## Native and JavaScript identity

Independent Python lstat/hashlib traversal recomputed every app entry, complete
inventory digest, HBC magic/version, phase-log hashes, proof/build binding and
run artifact hashes. See archived `independent-verification.json` and
[verification tool](tools/verify-evidence.py). This is separate from the Node
preparation implementation. Both A and B report fingerprint
`8743623f984ef849a1acbb1975ac5f8c67d74bcf` and exactly equal native file lists.

| Value | Own A | Candidate B |
| --- | --- | --- |
| Native executable SHA-256 | `a9a16ddd07749d0e450577100c94b34db04ac8ccc4019a7b4a074acbcf109367` | same |
| JS SHA-256 | `3e957a6d541f6d9647ef4d7e8513d0b5cc218c3c04702d792fecf25ffeeaa400` | `e2852c3d2a27a1faf39eaaf9560a245703ebdb2e98e49c41bc407744c8d646ab` |
| Complete app inventory SHA-256 | `1b50f5ef39693a76eaacc884d4b211b13776d4ebf1b6e4d3a46ea0a0136983c1` | `5538bc10a23a7d3b7f3950bfd34ba714fbdd5955562293d54ce785cbc3c55fc0` |
| HBC version / bytes | 98 / 3,464,027 | 98 / 2,806,528 |
| App file bytes | 51,645,468 (49.25 MiB) | 50,987,969 (48.63 MiB) |
| tar+gzip artifact bytes | 14,406,764 | 14,080,788 |

Warm own B: 51,645,440 file bytes; 14,406,774 B tar+gzip. Its independent
native relink changes the executable digest; no equality claim is made for
that build. The complete files and hashes are in each build/proof receipt.
These gzip sizes are local `.app` archives, not npm carrier sizes.

Both CocoaPods hermesc and `hermes-compiler@250829098.0.17` resolve compiler SHA
`459d352c9a3cfdbe9289a167d93f7e30700c6ee591dfee3a4d52dc26eb8548cb` and HBC 98.
The actual outputs begin `c61fbc03c103191f`; native startup attests their hashes
on prime and cold offline. Different producers/settings can still produce
different HBC sizes; a matching header alone was never accepted as execution.
Stage 0's retained repack also has HBC 98 (4,164,312 B), but remains unqualified.

The candidate uses supported `--js-bundle-only`, then compares all Mach-O bytes,
Info.plist and Expo/Constants semantics, every changed resource, and immutable
base/source inputs. Default repack changed Expo.plist and was refused. Repacked
installation succeeds without extra signing or credentials. CoreSimulator 27
changes only seven known framework executable modes from 0755 to 0644; the
verifier permits that measured transformation with byte equality and records
the resulting exact installed inventory. Every other change remains a failure.

[Own A offline](screens/a-ownbuild-1/smoke-ios-offline.png),
[B repack offline](screens/b-repack-1/repack-smoke-ios-offline.png), and
[warm own B offline](screens/b-warm-ownbuild-1/smoke-ios-offline.png) show the
real conversation, proof-kind/digest label and changed asset. These partial
screens do not override the failed smoke receipt.

## Failed attempts and controls

All attempts below are retained; no successful smoke is omitted because none
occurred. Raw preparation commands and outputs are in each directory's phase
record. Earlier manual driver invocations used the same options as the measured
runs (diagnostic UDID 89FA416A-BFBB-4A2D-B651-6A659C31591C and per-attempt output);
their exact outer argv was not separately logged. Measured runs and later
controls have exact argv/cwd/environment subset/binary hash/wall-time records.

| Attempt | Outcome and repair |
| --- | --- |
| a-attempt-1 | Dangling original `schema` symlink refused before build; removed unused broken link from copy. |
| a-attempt-2 | Snapshot's unanchored `dist` exclusion removed dependency files; anchored exclusions to project root. |
| a-attempt-3 | Build succeeded; installed framework modes differed. Recorded full diff and added the narrow byte-preserving installer rule. |
| a-attempt-4 | Native iOS 27 UIScene termination; no JS. Migrated copied native lifecycle. |
| a-attempt-5 | Probe's embedded-manifest assertion was wrong; timed out. Preserved failure. |
| a-diagnostic-repack-1 | Repack exited zero but Expo.plist semantics changed; refused before install. Selected supported js-bundle-only flag. |
| a-diagnostic-repack-2 | Probe misidentified embedded Constants.manifest as a dev manifest; timeout. Check actual launcher/update manifest instead. |
| a-diagnostic-repack-3 | Normal auth/assets worked; nonexistent probe `client.sync()` call failed. Used normal onWrite settlement. |
| a-diagnostic-repack-4 | Fixture created/read, but account remount lost probe readiness and route was wrong; timeout. Fixed probe placement and route. |
| a-diagnostic-repack-5 | Real offline screen reached; full smoke refused ephemeral loading. |
| a-ownbuild-1, b-repack-1, b-warm-ownbuild-1, b-final-ownbuild-2 | Same unchanged-client smoke failure; restart not run. |
| control-scheme | Temporary source scheme change refused on config inequality before install; restored original bytes. This was a negative control, never a repair or launched scheme rewrite. |
| control-tampered-base | Corrupted HBC header in a cloned base refused by inventory before install. Original base untouched. |
| control-cold-error | Actual uncaught offline startup error durably recorded as smoke:failed; exit 1. Restored source afterward. |
| control-death-prime | SIGKILL only recorded owned PID 68087 after prime pass; E_WITNESS_APP, exit 1. Other segment liveness cases covered by driver tests. |
| control-concurrent / control-concurrent-2 | Another run refused the existing owner without replacement or termination. Final lease resides in simulator data, independent of caller TMPDIR. |
| control-busy-port | E_WITNESS_PORT; own preexisting listener still accepted a connection. Listener stopped only by its owning test. |

Initial test failures are also retained: stale fake origin/UDID assumptions;
an outdated build recipe assertion; transient driver-test port collisions on
the shared Mac; missing new guide definition/action pins and application-file
registry entries; an inappropriate private report path in published guide text.
These were repaired and affected checks rerun. Several cargo invocations from
the root workspace failed before touching the Snapback 4 target; their logs are
retained rather than attributed to the product. Subject typecheck still reports
seven generated `rowKey` metadata errors against the older published 0.4.7 type;
no new probe type errors remain. That version-skew limitation is not hidden.

## Delivery and remaining work

27 affected driver tests, 7 witness unit tests, 20 JS helper/payload/smoke tests,
and 98 guide checks pass. A final shell-quoting hardening keeps NODE_BINARY paths literal (including
quotes and substitution syntax); its host argument value is unchanged. The
shell execution test covers that edit; no additional native run is claimed.
Linux-safe protocol/payload/unit tests were run on
macOS; no Linux execution is claimed. The actual simulator negatives above are
separate from fake-simctl tests. The wasm budget and publication path are unchanged.

The runtime/smoke incompatibility is tracked in
[the filesystem issue](../../../issues/closed/20260929-snapback4-native-smoke-ephemeral-loading.md).
The published local-query implementation intentionally returns loading for
unavailable ephemeral reads; smoke requires ready or explained refusal for
every optional-argument query. Resolving that contract belongs to the client/
smoke owners. This lane requested direction and kept the commissioned package
bytes and smoke unchanged. No pending answer was treated as authorization.

[unqualified-repack-candidate.patch](unqualified-repack-candidate.patch) restores
the experimental preparation branch against the final product files. It is
retained evidence, not an offered CLI capability. Publication, repeatability,
M6/M8 assertion/schema/status admission, a generic host and physical-device
behavior remain unqualified. Legacy m6/m8 invocations now use installed-m6/m8
artifact names with unknown preparation, never reserved native names.

[EVIDENCE.json](EVIDENCE.json) maps each original raw file to its lossless gzip
copy and both hashes. Source/probe patches, screenshots and raw logs/receipts
are committed here. Large `.app` payloads, xcresults, repack work directories
and original MP4s remain at `/Users/ccheever/sb4-np/evidence/`, bound by these
inventories and run manifests; the report does not pretend they are Git blobs.
Backend/session stores stay private and are not report artifacts. Simulators
were deleted only after collection. Nothing was pushed or published.

Mechanism references used while diagnosing: [Expo repack](https://docs.expo.dev/build-reference/repack/),
[Expo fingerprint](https://docs.expo.dev/versions/latest/sdk/fingerprint/),
[Apple scene lifecycle](https://developer.apple.com/documentation/uikit/transitioning-to-the-uikit-scene-based-life-cycle),
and [Expo scene migration](https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md).
Observed results above come from this experiment, not those feasibility documents.

# NP-mac round 2 — 2026-09-29 UTC

**LLP 3000.030 §11 passes again; Status remains Accepted.** Own Release A,
five B repacks and a warm own build of B complete prime, cold offline and
restart. The final repack sample uses the optimized CLI. The five-run repack median is **41.385 s**;
nearest-rank p95 is **53.816 s**. Compared with round 1's
46.109 / 56.639 s, these changed by **-4.724 /
-2.823 s**. The pinned warm-host sample remains below 120 s.
This is a measured bounded adapter, not a general SDK or performance guarantee.

## Findings, fixes and distinguishing tests

| Finding | Implemented change | Regression and real control |
| --- | --- | --- |
| Astra 1; Grok executed-script finding | Read RN SourceCode.scriptURL and runtime global __DEV__. Native observation resolves the selected local file, requires equality with the installed main.jsbundle, and hashes that selected file. The driver checks its canonical file URL/path, installed path, byte identity, format 2/helper v2, Release, Hermes, __DEV__ false and absent launcher/updates manifests. Unknown/remote/alternate URLs refuse. | Unit identity mutations cover missing, remote, alternate and malformed URLs and dev/manifest flags. A real Release delegate selected an identical HBC copy in Documents; product native observation refused. A JS entry setting runtime global __DEV__ true also failed. The alternate control removed the subject's URL assertion so it could not substitute for the product guard. |
| Astra 2, stale residency facts | After owned-backend readiness, read its committed SQLite generation/schema/programs in one statement and match /dev/status generation/store/adoption state. Pass that generation and facts, preserve them across restart. The helper checks both generations and every supplied runs/held fact against its kept backend before its first query. | Unit tests reject stale runs, held and generation with zero query calls. Driver test edits source between preparation and served compilation, proving facts come from the served generation. Real simctl launch-payload injections for runs and held each failed with queries: [] against the untouched kept backend. |
| Astra 3, external native inputs | Resolve Xcode source/resource/group references, search paths, config includes and input lists; refuse escapes from ios/node_modules, including symlinks. Only the pinned generated shell/Podfile/environment inputs are supported. Custom compiler flags/tools, external projects/packages, scheme actions and asset/header escapes refuse. | External Swift/resource/config/search/list/conditional-setting/compiler-flag/symlink/ignored-directory cases fail unit tests. Real ../SharedNative/Foo.swift edit reproduced equal Expo fingerprints before/after; preparation now refuses the external reference before install. |
| Astra 4, surviving descendants | Keep the preparation leader unreaped, reserve its process-group identity, and retain the project lease until bounded group cleanup finishes. Signal the owned group with SIGTERM and then SIGKILL if live members survive; success also cleans descendants. | Rust test uses a child that outlives its parent, ignores SIGTERM and writes a heartbeat; it requires stopped heartbeat before lease release. A real preparation pod-control descendant ignored SIGTERM; SIGINT to the recorded driver PID held the lease during cleanup, stopped the descendant, then released the lease. |
| Astra 5, HBC guard mutation | Exercise actual prepare.mjs at command boundaries with controlled build/repack products of the wrong HBC version, including base-version disagreement. No receipt may be issued. | Preparation-level own-build and repack controls fail E_WITNESS_HERMES. Deleting both preparation version guards now fails the test (killed mutation), rather than passing payload-only coverage. |
| Grok Pods gap | Compare complete source Pods and generated iOS header target inventories in the compatibility key, including symlink targets into inventoried dependencies; links to uncovered project inputs refuse. | Preparation regression edits a Pod byte and requires compatibility refusal before repack. Actual source hermesc byte append failed E_WITNESS_NATIVE_COMPAT (pods), then exact bytes/mode were restored. |
| Grok conditional native reads | Generic smoke refuses eligible native queries because the compiler's synthetic server bit does not describe device module availability. Use an application witness for this case. | Driver/helper tests reject conditional native facts before querying. The guard-removal mutation is killed. Core/compiler/client semantics are unchanged. |

Grok's request to reject every device-classified E_OFFLINE is **not adopted**:
the supervisor's explicit round-1 ruling preserves data **or an explained
refusal** for these queries and forbids client semantic changes in this lane.
Receipts continue to report the actual refusal and its code/message; they do
not assert that a refusal returned data. Device loading, throws and uncaught
errors still fail. Server-only reads must answer online in prime/restart and
record actual offline unavailability. Conditional native reads now refuse the
generic route rather than being incorrectly excused as server-only.

Grok's two Low suggestions remain nonblocking: this bounded simulator build
uses the existing ad-hoc CODE_SIGN_IDENTITY=- invocation, and the existing
exactly-one-booted-device selection behavior remains. Every run here supplied
our explicit UDID. No keychain/system setting or credential was changed.
Neither reviewer has reviewed these final changes; their round-1 NOT READY
verdicts are preserved, not relabeled as approval.

## Complete A/B protocol and timings

| Run | Preparation ms | Prime ms | Offline ms | Restart ms | Complete ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| sealed-a-ownbuild-2 | 454,839 | 6,992 | 9,323 | 5,668 | 489,131 |
| timed-b-repack-1 | 31,193 | 5,693 | 5,268 | 5,535 | 53,816 |
| timed-b-repack-2 | 20,765 | 5,136 | 4,820 | 5,028 | 40,909 |
| timed-b-repack-3 | 19,735 | 5,216 | 5,319 | 5,888 | 41,385 |
| timed-b-repack-4 | 20,046 | 5,360 | 5,356 | 5,369 | 41,320 |
| timed-b-repack-5 | 20,586 | 5,346 | 5,011 | 5,375 | 41,937 |
| timed-b-warm-ownbuild-1 | 109,807 | 5,369 | 4,718 | 5,241 | 130,806 |

The headline sample was declared by tools/timed-qualification-r2.py and
timed-sample-r2.py: the already verified own A, timed-b-repack-1 through -5, then warm
own B. The five repacks and warm B use CLI SHA-256 `f4be5c1c7f3032cdf17f0fb9866b2e88f201dd57bd1413008435377244b15dd7`. A used `ab4282d45792e5ce7b2d91a8e88fd48120b7bcb4839ded370186c4174bb9be33` before a traversal-only optimization reused already-resolved symlink paths; compatibility keys and output checks are unchanged. Post-measurement Cargo tests rebuilt the local CLI; retained-cli.json records its different post-check digest, without substituting it for a measured binary. Each has a new artifact
directory and sealed proof. Every failed/development attempt is included below; the five timed-b repacks have no failures. The p95 is
nearest rank ceil(0.95 × 5) = 5. These elapsed times include snapshotting,
full input/Pods hashing, export/repack or build, installation, normal session
restoration, all smoke segments, capture finalization and artifact hashing.
The final repack sample uses frozen preparation/driver/helper logic. Two earlier sealed-b attempts used redundant symlink resolution; both are retained separately, and their coordinators were stopped after preserving the in-flight run. No attempt was erased. Only the fresh timed-b sample represents the optimized implementation. The guide wording names the generated header inventory. No tests or archive jobs
were deliberately run alongside the five final repacks.

| Run | Phase | ms |
| --- | --- | ---: |
| sealed-a-ownbuild-2 | fingerprint-before | 6,238 |
| sealed-a-ownbuild-2 | xcode-version | 229 |
| sealed-a-ownbuild-2 | sdk-version | 38 |
| sealed-a-ownbuild-2 | sdk-build | 24 |
| sealed-a-ownbuild-2 | pod-version | 914 |
| sealed-a-ownbuild-2 | runtime | 403 |
| sealed-a-ownbuild-2 | snapshot | 79,056 |
| sealed-a-ownbuild-2 | public-config | 177 |
| sealed-a-ownbuild-2 | pods | 35,023 |
| sealed-a-ownbuild-2 | schemes | 1,611 |
| sealed-a-ownbuild-2 | build-settings | 3,375 |
| sealed-a-ownbuild-2 | xcode-build | 212,463 |
| sealed-a-ownbuild-2 | preserve-app | 34 |
| sealed-a-ownbuild-2 | plist-13 | 9 |
| sealed-a-ownbuild-2 | hermes-version | 9 |
| sealed-a-ownbuild-2 | fingerprint-after | 4,539 |
| timed-b-repack-1 | fingerprint-before | 1,303 |
| timed-b-repack-1 | xcode-version | 113 |
| timed-b-repack-1 | sdk-version | 7 |
| timed-b-repack-1 | sdk-build | 6 |
| timed-b-repack-1 | pod-version | 512 |
| timed-b-repack-1 | runtime | 104 |
| timed-b-repack-1 | snapshot | 4,565 |
| timed-b-repack-1 | public-config | 76 |
| timed-b-repack-1 | repack | 4,369 |
| timed-b-repack-1 | plist-9 | 6 |
| timed-b-repack-1 | hermes-version | 6 |
| timed-b-repack-1 | plist-11 | 4 |
| timed-b-repack-1 | plist-12 | 3 |
| timed-b-repack-1 | fingerprint-after | 1,203 |
| timed-b-warm-ownbuild-1 | fingerprint-before | 1,356 |
| timed-b-warm-ownbuild-1 | xcode-version | 50 |
| timed-b-warm-ownbuild-1 | sdk-version | 7 |
| timed-b-warm-ownbuild-1 | sdk-build | 6 |
| timed-b-warm-ownbuild-1 | pod-version | 358 |
| timed-b-warm-ownbuild-1 | runtime | 103 |
| timed-b-warm-ownbuild-1 | snapshot | 4,531 |
| timed-b-warm-ownbuild-1 | public-config | 64 |
| timed-b-warm-ownbuild-1 | pods | 13,305 |
| timed-b-warm-ownbuild-1 | schemes | 788 |
| timed-b-warm-ownbuild-1 | build-settings | 1,074 |
| timed-b-warm-ownbuild-1 | xcode-build | 77,820 |
| timed-b-warm-ownbuild-1 | preserve-app | 21 |
| timed-b-warm-ownbuild-1 | plist-13 | 5 |
| timed-b-warm-ownbuild-1 | hermes-version | 6 |
| timed-b-warm-ownbuild-1 | fingerprint-after | 1,126 |

Only the commissioned five final repacks form this timing comparison. Earlier
development smoke runs are retained below, including another five-run sample
before Grok's Pods/conditional-native additions and five after those additions
but before final audit hardening; another seven qualified-* successes preceded
the final ignored-directory/Pods-symlink hardening. They are not silently pooled as homogeneous
repeatability evidence. Host load/cache history varied; the observed timing
change is not an isolated estimate of each guard's cost. The wider ten-attempt
and multi-host study remains a separate increment.

| Earlier development run | Complete ms | Result |
| --- | ---: | --- |
| a-ownbuild-2 | 166,022 | all three segments passed |
| b-repack-1 | 56,157 | all three segments passed |
| b-repack-2 | 40,176 | all three segments passed |
| b-repack-3 | 36,763 | all three segments passed |
| b-repack-4 | 35,912 | all three segments passed |
| b-repack-5 | 37,504 | all three segments passed |
| final-a-ownbuild-1 | 175,446 | all three segments passed |
| final-b-repack-1 | 62,583 | all three segments passed |
| final-b-repack-2 | 45,943 | all three segments passed |
| final-b-repack-3 | 49,141 | all three segments passed |
| final-b-repack-4 | 47,171 | all three segments passed |
| final-b-repack-5 | 61,618 | all three segments passed |
| qualified-a-ownbuild-1 | 134,129 | all three segments passed |
| qualified-b-repack-1 | 40,135 | all three segments passed |
| qualified-b-repack-2 | 40,083 | all three segments passed |
| qualified-b-repack-3 | 39,044 | all three segments passed |
| qualified-b-repack-4 | 38,915 | all three segments passed |
| qualified-b-repack-5 | 39,450 | all three segments passed |
| qualified-b-warm-ownbuild-1 | 134,672 | all three segments passed |
| sealed-b-repack-1 | 163,688 | all three segments passed |
| sealed-b-repack-2 | 94,194 | all three segments passed |
| sealed-a-ownbuild-1 | 4089 | failed: newly strict Pods link guard found standard generated headers; fixed by inventorying their target tree |
| a-ownbuild-1 | 177,361 | failed: unauthenticated /schema approach; no complete smoke |

No tools/dependencies were installed this round. The dedicated simulator
creation/boot took 24,212 ms separately. Builds used the existing private
native cache; no fresh-cache, Xcode/runtime-download or cold dependency cost
is claimed. The earlier stage-0/round-0 failed evidence remains linked from
[round 0](../REPORT.md) and [round 1](../round1/REPORT.md).

## Runtime and byte custody

A showed the blue image and NP A; B showed green and NP B. Normal app signup
on the round-2 simulator created the nonempty fixture through actual mutations;
subsequent A/B/control runs reused that session, backend store and eight-message
conversation. No synthetic store/response was installed. The accepted A was
therefore a new own build on an already primed round-2 simulator, not a fresh
identity test. Install occurred before prime only. No reset, reinstall, data
injection or repack occurred between a run's prime/offline/restart segments.

The application probe observed first-import embedded Constants, Router,
scaled ../asset loading, a runtime font and a local WAV reference on every
segment; it read and displayed all eight real retained messages offline.
This proves local media resolution, not playback. SourceCode selected the
verified installed HBC, __DEV__ was false, Hermes/Release true, and launcher/
updates observations were empty. The final helper itself enforces these
startup conditions independently of the subject probe. Backend connection
refusal and exact restart watermark progress remain in the run evidence.

Independent Python recomputation checked every app entry, HBC magic/version,
phase log, proof/receipt and referenced run artifact hash for **all 28 successful
round-2 smoke runs**, not just the headline seven. Every final B has A's native
Mach-O list, source fingerprint and Pods input key, with different JS and app
inventory digests. HBC version is 98; CocoaPods and export compiler identities
match. Exact inventories, changed-file lists, compiler arguments and all
three segment facts/startups are retained in raw evidence.

| Identity | A | B repack 1 |
| --- | --- | --- |
| App inventory SHA-256 | `18824f17af3cb908c3767d2765ab113c87270d07c4e1d2689bfba828174c84fc` | `b75229ed9a4a4dd18f7ec7100cfe4de8baee93fb1ab8d3026b707136d6c4edb8` |
| Selected HBC SHA-256 | `2ef5b51886968cca4b36be82bd3af45fed58461e7ba4f7fa2c431a893c066ab9` | `78b4b92d86fc58f94a71c1333141ad91d352f7c832ad366271289877b1834003` |
| Native fingerprint | `0d80400fb4d5bb5cca4f000da37b3909a0786e3d` | `0d80400fb4d5bb5cca4f000da37b3909a0786e3d` |

| Run | App bytes | HBC bytes | Local tar.gz bytes |
| --- | ---: | ---: | ---: |
| sealed-a-ownbuild-2 | 51,650,885 | 3,468,308 | 14,409,905 |
| timed-b-repack-1 | 50,992,757 | 2,810,180 | 14,083,718 |
| timed-b-warm-ownbuild-1 | 51,650,881 | 3,468,304 | 14,409,813 |


The tar.gz sizes are local app artifact measurements, not npm package download
estimates. Exact local archive hashes and paths are in compressed-app-sizes.json. Rounded payload sizes are A 49.26 MiB, repacked B 48.63 MiB and warm B 49.26 MiB.
No new host package, publication or download-cost claim was introduced.

## Bounded controls and failures

All controls below exited 1 and retained their diagnostics/receipts. Native
source mutations were restored in finally blocks; each next positive run
rechecked native compatibility.

| Control | Actual distinguishing result |
| --- | --- |
| alternate-selection | Selected identical HBC from Documents/np-alternate.jsbundle. Native selected-file comparison emitted E_WITNESS_PROOF and launched:failed. |
| runtime-dev | Runtime global __DEV__ true emitted durable launched:failed / E_WITNESS_PROOF; app exit prevented pass. |
| stale-runs / stale-held | Kept residency mismatch in prime; each failure receipt has queries: []. |
| external-native | Equal Expo fingerprints across external Swift edit, then E_WITNESS_NATIVE_COMPAT before install. |
| pod-link | **Inconclusive (corrected in round 3).** The attempt refused the ordinary generated RCTAppDependencyProvider.h target before reaching the injected SharedNative link. Its prefix-only assertion did not establish the claimed negative. The separate unit test still supplied coverage. |
| generated-pod | Editing a standard generated Pod header target refused as podsGenerated input difference before install; source restored. |
| pod-input | Edited hermesc bytes refused as Pods input difference before repack; exact restoration recorded by later positive checks. |
| interrupted-preparation | Recorded driver PID received SIGINT. SIGTERM-resistant child stopped, project lease remained held during cleanup, then became available; owned PIDs were absent afterwards. |
| scheme / tampered-base | Config compatibility and immutable base integrity refused before install with rebuild recovery. |
| cold-error | Real uncaught cold-offline startup error persisted smoke:failed; offline failed, restart unrun. |
| death-restart-2 | Killed the verified owned PID after a real successful restart receipt; the driver marked restart failed, exit 1. Injection record hashes the prior receipt. |
| concurrent-owner / busy-port | Existing lock holder and listener preserved; listener accepted a connection after refusal. |

The first death-control invocation accidentally overlapped the preceding
cold-error control and correctly refused its held simulator lease without
killing anything. It is retained as control-death-restart; only the explicit
control-death-restart-2 is counted as the death assertion. The early own-A
attempt failed because /schema requires authentication; the final implementation
uses the owned committed generation and /dev/status without borrowing a session.

Development check failures are also preserved: a first preparation fixture
needed canonical temp paths and nonrecursive copying; the initial generation
code attempted unauthenticated /schema; an initial driver run also encountered
a shared ephemeral-port collision; an i64 SQLite read replaced an unsupported
u64 conversion; later symlink controls required the command-boundary copy fixture to preserve relative links and implement rsync --delete correctly; a few cargo invocations were mistakenly issued from the root
workspace and did not test Snapback 4. A guide:: filter invocation ran no
relevant guide tests; the explicit --test guide run passed all 98. None of
these was relabeled as successful qualification.

## Validation, scope and retention

Final checks pass: **28 driver tests, 10 witness unit tests, 28 helper/smoke/
preparation tests, and 98 guide checks**. Commands:

```sh
# cwd: snapback4; pinned Node/Bun/Rust PATH and task-local TMPDIR
cargo test -p snapback4 --bin snapback4 verbs::witness::
cargo test -p snapback4 --test witness -- --test-threads=1
node --test packages/snapback4/test/witness.test.mjs packages/snapback4/test/native-smoke.test.mjs packages/snapback4/test/witness-preparation.test.mjs
cargo test -p snapback4-lang --test guide
```

The eight timed-mutation controls were rerun against a passing baseline and all fail their corresponding tests: deleting
both HBC guards, native reference audit, kept runs/held comparison, runtime
URL/dev/manifest guard, Pods key, conditional-native guard, Pods symlink-root check or generated-Pod input key. Earlier sealed2 mutation results ran against that then-failing copy fixture and are not counted as mutation evidence. The final
conditional-setting/header/catalog additions have scoped failing controls in
the same preparation regression. Reference audit passes: 524 LLP documents, 9,861 refs, zero errors or unchecked refs. Diff whitespace check also passes. These are local macOS checks; no Linux execution,
full battery, new gate or independent post-fix model review is claimed.

Required fetch/merge produced `859d250c39`, merging origin/main
`7f540f09467fcbdd73d4faa05db14fce696e9e85`. The sole JOURNAL conflict retained
both sides. Branch remains sb4-np/np-macos. The final change is committed with
the requested co-author trailer; nothing was pushed or published.

Host: Apple M5 Pro mini, arm64, 18 cores/64 GiB, macOS 27.0 (26A428),
Xcode 27.0 (27A266a), iOS 27.0, CocoaPods 1.17.0, Node 24.18.0,
Bun 1.3.12, Rust 1.97.0. Only owned UDID
`13ABE380-D739-4436-A348-E8C23B959C0C` (np-mac-round2, iPhone 18 Pro)
was targeted; mini-verify-iphone was untouched. Cleanup record confirms this
simulator was shut down and deleted after collection. Only recorded owned
PIDs/groups were signaled. No GUI automation, system/keychain setting change,
credential-file access, publication or push occurred.

Expo 57.0.22, RN 0.86.3, fingerprint 0.20.13, repack 0.10.3 and published
Snapback packages 0.4.7 remain pinned. All 178 published JS client files and
seven native core XCframework files compare byte-identical with stage 0.
Seven local helper source files differ (including new witness-runtime.ts);
[subject-helper.patch](subject-helper.patch) records them separately from the
published package. The subject's controlled Release delegate hook and entry
file existed before the round-2 bases; they remain inactive in positive runs.
No backend/client/compiler semantics or wasm code changed; the 593,719 B gzip
wasm cap is unchanged and no fresh wasm size is claimed.

Astra review SHA-256: `6c5ca265720fd865cb417c168ae4162894ccef5c7268a0c0073329c19f51d1b3`.
Grok review SHA-256: `4136b296798ea86c356138fb93a436a770e74753a5a9427d387703a7ec8829a5`.
Both were read in full. Grok was absent at the start, arrived during work,
and was checked again before completion. Copies accompany the evidence.

[EVIDENCE.json](EVIDENCE.json) maps raw commands/logs/receipts/inventories to
deterministic gzip copies with source and compressed hashes. Reproduction
scripts are in tools/; selected screen PNGs and subject changes are retained.
[Independent verification](tools/verify-evidence-r2.py) recomputes bytes without
trusting the preparation inventory implementation. Large apps, MP4s, xcresults
and local archives remain at `/Users/ccheever/sb4-np/evidence/round2/`, bound by
the committed inventories and artifact hashes. Private backend/session stores
are excluded. This reaffirms only §11's bounded own-build/repack slice;
publication, general native shapes, M6/M8 admission and wider repeatability
remain separate work.

# NP-mac round 3 — closed native inputs and private outputs

**LLP 3000.030 §11 steps 1–4 pass; Accepted remains justified for this bounded slice.**
The final five repacks each passed prime, cold offline and restart smoke. Median
**53,430 ms**, nearest-rank p95 **54,618 ms**, n=5; the final pinned warm-host
sample meets the 120-second target. This does not grant
an unqualified performance claim: every earlier attempt below remains visible,
including two pre-final successes above 120 seconds during heavy shared-host load.
No push or publication. No core/client/query/smoke-contract or wasm change.

## Scope and review custody

Initial `git fetch origin && git merge origin/main` completed as merge
`b65817c6b7`, joining lane `72db6edc64` and `origin/main` `b7d05baff6`.
Both sides of the two append-only journal conflicts were retained.
[Context](CONTEXT.md) records the llp-orient constraints. Prompts r0–r3,
prior reports and both round-2 reviews were read in full. Grok was absent at
entry, arrived during implementation, and was checked again before completion.
Neither NOT READY verdict is represented as a post-fix approval.

| Review | Input SHA-256 |
| --- | --- |
| Astra r2 | `a7135e22b3e257eb48a6caa974da94fdabed7788520cd5042ad87357533b39f3` |
| Grok r2 | `6d8e52e9a73454e144cedb3f25922ff50e3746a9d7a648ebae744947108b14ef` |

Full originals are preserved in `raw/reviews/` as gzip; [EVIDENCE.json](EVIDENCE.json)
binds compressed and uncompressed bytes for 8,762 raw files, reverified after
archiving. The accepted scope is deliberately
narrow: this cal25 dependency tree and its disclosed seven-file helper patch,
static Expo config, supported generated phases, the recorded Xcode/SDK, and one
own native base. Different script/tool dependency bytes require `--build`; they
do not inherit repack qualification merely from matching package versions.

## Findings and detecting evidence

| Finding | Fix and regression/control |
| --- | --- |
| Astra High; Grok High: native includes/searches escape | Audit resolved settings and PBX graph for every app and Pods target: file/group references, source/resource/framework/header phases, search/include paths, xcconfig includes, lists, VFS overlays, compiler flags, PCH/bridging/module maps, resource catalogs and tool paths. Unknown graph/flags/scripts refuse. Actual compiler `.d` and linker dependency records are mandatory; every source and compiled target needs coverage. Paths canonicalize through existing parents; uncovered paths, even missing linker probes, refuse. Tests cover spaced includes, Swift conditional include paths, `.pch/.hh/.hxx/.metal`, modulemaps, Pod configs/lists/scripts, frameworks and missing coverage. Real arm64 Clang controls show changed external-header bytes changing object hashes while the covered tree stays equal, and the new closure refuses the exact outside input. |
| Astra/Grok Medium: output settings escape private cache | Pin product/intermediate/module/index/cache roots in Xcode argv and private HOME; refuse app overrides and validate resolved outputs for every app and Pods target before compiling, including symlink parents and script outputs and unsupported copy-phase destination selectors. Tests detect Pod target and symlink escapes. Native CONFIGURATION_BUILD_DIR, SYMROOT and OBJROOT controls name their injected setting/path and leave each outside directory absent. |
| Astra Low: Pods-link control failed for wrong reason | Round-2 report and LLP now label that attempt **inconclusive**. Final unmodified `sealed-b-repack-5` is the passing baseline. The replacement injects `ios/Pods/np-external.h -> ../../SharedNative/NP.h`; assertions require the refusal to name both that link and `SharedNative/NP.h`, with no proof/install. `native-input-controls.json` retains the exact diagnostic. |
| Grok Medium, received during work: baseline precedes pod resolution | Keep original `sourceInputs` for provenance. Both routes now run private Pods/codegen resolution and compare the complete resulting `inputs`, including all `ios/build/generated`. Capture that key before Xcode; retain Xcode's later `preparedInputs` separately, alongside actual compiler/linker consumed-file hashes. Repack compares the equivalent stage before repacking and again afterward. A preparation test changes only the resolved Pod bytes and requires refusal before repack. A separate fixture-generated Xcode output prevents accidentally comparing unlike stages. |

The reusable base contains **1,155 dependency records**
(1,123 compiler and 32 linker), covering 782 distinct source units and
**13,906 recorded input/probe paths**.
Raw `.d` and binary `_dependency_info.dat` records from final A and warm B were
copied with receipt-hash verification before cache reuse. Actual toolchain-file
hashes and missing probes are checked again on repack. SDK logical install names
must resolve to exact declarations in a captured SDK `.tbd`; arbitrary absent
libraries are refused.

The phase adapter accepts 55 qualified normalized shell bodies and 13 generated
support implementations. Shell/Node phases and the Expo Swift macro additionally
require the exact 41,572-entry installed dependency inventory
`80ff62f08d660ed17c8ac842a765ef96dbc11ad73635996d9c395494f74b1856`.
App codegen/autolinking customization and unsupported project shapes refuse.
This constraint is intentional: arbitrary scripts can read undeclared inputs.
The wider general Expo/native-package matrix remains unqualified.

The real Clang controls retain passing inside-root compilation plus changed
outside-header pairs: spaced include, computed include, computed include from
Pods, PCH, `.hh`, `.hxx`, and module-map header. Each pair has identical covered
source bytes and different objects; the actual dependency record identifies
the uncovered header. See `sealed-compiler-controls/` and `sealed-grok-compiler-controls/`, including independently verified raw object pairs, plus the earlier control attempts.

## Final §11 protocol and times

Each time is from invocation to finalized evidence, including private snapshot,
Pods resolution, install, all three smoke launches, video finalization and hashing.
No GUI activation, Metro, dev-launcher URL or alternate JS loader was used.
Same owned simulator, normal unattended authentication, backend port 49371,
nonempty eight-message history and fixture policy throughout. Dependencies/tools
were already installed and caches warm; this is not a cold-install claim.

| Run | Total ms | Preparation ms | Pods ms | Build/repack ms | Prime / offline / restart ms |
| --- | ---: | ---: | ---: | ---: | --- |
| `sealed-a-ownbuild-1` | 114,943 | 91,864 | 10,637 | 43,210 | 5228 / 4882 / 4870 |
| `sealed-b-repack-1` | 54,618 | 33,557 | 11,567 | 3,833 | 4814 / 5026 / 4830 |
| `sealed-b-repack-2` | 53,454 | 32,136 | 10,741 | 3,772 | 4804 / 5080 / 4948 |
| `sealed-b-repack-3` | 53,430 | 32,009 | 10,674 | 3,758 | 5046 / 4953 / 4961 |
| `sealed-b-repack-4` | 53,260 | 31,832 | 10,656 | 3,712 | 5072 / 4953 / 4932 |
| `sealed-b-repack-5` | 53,090 | 31,882 | 10,630 | 3,753 | 5053 / 4847 / 4826 |
| `sealed-b-warm-ownbuild-1` | 112,343 | 90,247 | 10,809 | 42,022 | 4798 / 4747 / 5025 |

Final median/p95 delta from round 2's 41,385/53,816 ms is
**+12,045/+802 ms**. These shared-host observations include
additional safety work and changing load; they are not isolated guard-cost estimates.
Command records retain load averages and exact argv/environment/CLI hash. The
later ten-attempt, wider-host repeatability increment is still separate.

A's cold-offline screenshot shows **NP A**, blue image and kept history. B shows
**NP B**, green image and the same history in all five runs. Warm B shows the
same behavior with `application-release` rather than `application-release-repack`.
The font loads at runtime; the local WAV reference resolves (no playback claim).
First-import Constants retains Clique's config and scheme; the honest native
helper binds SourceCode's actual file URL to the verified installed HBC on every
launch. Runtime `__DEV__` is false, Release/Hermes true, launcher/updates manifests
absent. See [A offline](screens/sealed-a-ownbuild-1/smoke-ios-offline.png),
[B offline](screens/sealed-b-repack-1/repack-smoke-ios-offline.png), and
[warm B offline](screens/sealed-b-warm-ownbuild-1/smoke-ios-offline.png).

All six device-answerable queries return data offline. Compiler-declared server-only
`chat.typingInMyRooms` records loading and `insights.summary` records E_OFFLINE
as expected offline unavailability; both answer online. Facts/generation are bound
to the owned backend and independently checked. No fabricated reply, synthetic
store, timeout increase or smoke relaxation was used.

| Identity | Value |
| --- | --- |
| Final CLI SHA-256 | `92f46aa9896880d3da6deb5c68f287b3271c5af8ac0ba0072bf354090c0ee007` |
| Native fingerprint, A/B | `0d80400fb4d5bb5cca4f000da37b3909a0786e3d` |
| A HBC 98 | 3,468,308 B; `2ef5b51886968cca4b36be82bd3af45fed58461e7ba4f7fa2c431a893c066ab9` |
| B HBC 98 | 2,810,180 B; `78b4b92d86fc58f94a71c1333141ad91d352f7c832ad366271289877b1834003` |
| A post-Pods key | `resolved-native.json`, SHA-256 `a92d934f5adc7ad8e3207c6566939c0c849d000603e0d7ed51f863e57ef46783` |
| B post-Pods key | `resolved-native.json`, SHA-256 `a92d934f5adc7ad8e3207c6566939c0c849d000603e0d7ed51f863e57ef46783` |

All native Mach-O bytes, native fingerprint, complete source-stage key and complete
post-Pods key match between final A and each B repack. JS and full app inventories
differ. Exported asset graph equality and immutable metadata checks also pass.
`independent-verification.json` recomputes complete app entries/modes/links, Mach-O,
HBC magic/version, phase logs, preparation/proof/run hashes, every finalized run
artifact, URL/path selection, runtime flags, three app probes and query facts.
It additionally verifies all preserved final native dependency records.
`code-binding.json` confirms all five preparation helper files in every final
run match the working-tree implementation. `source-pins.json` records source
and review hashes plus the Apple M5 Pro / 18-core host identity.

| Payload | App file bytes | Local tar+gzip bytes |
| --- | ---: | ---: |
| `sealed-a-ownbuild-1` | 51,652,691 | 14,409,650 |
| `sealed-b-repack-1` | 50,994,563 | 14,083,284 |
| `sealed-b-warm-ownbuild-1` | 51,652,687 | 14,409,581 |

These are application artifact sizes, not npm carrier/download claims. Complete
local `.app`, `.xcresult`, MP4, PNG and tarballs remain under
`/Users/ccheever/sb4-np/evidence/round3/`; manifests bind their hashes. Selected
screens are copied here; raw textual evidence and dependency records are compressed.

## Controls and checks

All controls ran against the final implementation after the passing five-run
baseline and restored the input afterward. Native-input controls assert exact
injected paths and no proof. Scheme mutation and tampered base refuse before
installation. The real cold-offline uncaught error fails smoke. The owned app's
PID is killed only after its successful restart receipt; finalization fails,
and the injection record proves the prior pass. A held simulator lease and an
existing port listener survive their refusals. Raw failure artifacts are retained.

Affected checks: **32 helper/preparation, 28 driver, 10 witness unit and 98 guide
tests pass**. Final preparation tests include output privacy, complete dependency
coverage and equivalent resolved-stage comparisons. Ten guard removals each
make the relevant test fail, against a passing unmutated baseline: resolved-stage,
external dependency boundary, compiler coverage, linker coverage, all-target output
validation, Pods search path, phase-script identity, Pods escaping link, quoted
include and copy-phase destination selection. See `final-mutations.json` and its per-case logs. Earlier test/mutation
attempts are retained, including implementation-development failures.

Exact affected commands:

```sh
node --test packages/snapback4/test/witness.test.mjs packages/snapback4/test/native-smoke.test.mjs packages/snapback4/test/witness-preparation.test.mjs
cargo test -p snapback4 --bin snapback4 verbs::witness::
cargo test -p snapback4 --test witness -- --test-threads=1
cargo test -p snapback4-lang --test guide
./ref-check --verbose
```

The Rust commands ran in `snapback4/`; ref-check ran at repository root. The
Snapback 4 fence does not inherit Snapback 1 inventory/bootstrap/full-proof gates.
No wasm source changed; no new wasm result or increase to the 593,719 B cap is
claimed. No broad full-battery claim is made.

## Every invocation and development attempt

Historical names such as `final-*` and `qualified-*` are not final-code labels.
Only `sealed-*` uses the final adapter. Two pre-Grok repacks passed but took
195,327 and 141,120 ms; load briefly reached about 140 on the shared 18-core host.
The coordinator was stopped by its own PID, allowing its in-flight child to finish.
Those results are not silently omitted from a performance claim.

Grok's stage finding caused another A build. Three `qualified-b-*` attempts then
correctly refused because that draft compared post-Xcode outputs to a pre-compile
Pod tree (620 dependency entries, two iOS entries and 1,222 Pods entries differed,
including generated binaries, path-bearing build records and modes). No guard
was bypassed. The final fix captures equivalent post-Pods/pre-Xcode stages and
retains generated outputs plus actual consumed dependencies separately. A fresh
A, five `stage-b-*` runs and warm own B passed after that fix (median 53,204 ms,
p95 65,026 ms). Final code inspection then found that an unqualified Xcode copy
phase could choose an absolute destination even with empty `dstPath`. This app
has no such phases. The adapter now refuses them, with a detecting test and
killed mutation. Its identity changed, so the complete final `sealed-*` A/B/warm
sample was rerun; the prior passing sample remains recorded below.

| Invocation | Exit | Complete ms | Meaning |
| --- | ---: | ---: | --- |
| `a-ownbuild-1` | 0 | 156,425 | pre-final development/qualification |
| `final-a-ownbuild-1` | 0 | 167,277 | pre-final development/qualification |
| `final-b-repack-1` | 0 | 195,327 | pre-final development/qualification |
| `final-b-repack-2` | 0 | 141,120 | pre-final development/qualification |
| `qualified-a-ownbuild-1` | 0 | 370,909 | pre-final development/qualification |
| `qualified-b-repack-1` | 1 | 32,894 | pre-final development/qualification |
| `qualified-b-repack-2` | 1 | 26,631 | pre-final development/qualification |
| `qualified-b-repack-3` | 1 | 27,710 | pre-final development/qualification |
| `stage-a-ownbuild-1` | 0 | 123,302 | pre-final development/qualification |
| `stage-b-repack-1` | 0 | 65,026 | pre-final development/qualification |
| `stage-b-repack-2` | 0 | 52,773 | pre-final development/qualification |
| `stage-b-repack-3` | 0 | 53,271 | pre-final development/qualification |
| `stage-b-repack-4` | 0 | 52,895 | pre-final development/qualification |
| `stage-b-repack-5` | 0 | 53,204 | pre-final development/qualification |
| `stage-b-warm-ownbuild-1` | 0 | 114,664 | pre-final development/qualification |
| `sealed-a-ownbuild-1` | 0 | 114,943 | final protocol |
| `sealed-b-repack-1` | 0 | 54,618 | final protocol |
| `sealed-b-repack-2` | 0 | 53,454 | final protocol |
| `sealed-b-repack-3` | 0 | 53,430 | final protocol |
| `sealed-b-repack-4` | 0 | 53,260 | final protocol |
| `sealed-b-repack-5` | 0 | 53,090 | final protocol |
| `sealed-b-warm-ownbuild-1` | 0 | 112,343 | final protocol |
| `control-pod-link` | 1 | 2,263 | expected negative control |
| `control-output-configuration_build_dir` | 1 | 1,502 | expected negative control |
| `control-output-symroot` | 1 | 1,494 | expected negative control |
| `control-output-objroot` | 1 | 1,383 | expected negative control |
| `control-scheme` | 1 | 3,674 | expected negative control |
| `control-tampered-base` | 1 | 3,772 | expected negative control |
| `control-cold-error` | 1 | 46,667 | expected negative control |
| `control-death-restart-2` | 1 | 52,641 | expected negative control |
| `control-concurrent-owner` | 1 | 254 | expected negative control |
| `control-concurrent-owner-2` | 1 | 254 | expected negative control |
| `control-busy-port` | 1 | 253 | expected negative control |

Read-only native audit attempts `audit-initial.log` and `audit-2.log` through
`audit-12.log` retain incremental refusals while implementing the real graph:
React VFS syntax, generated/autolinking root coverage, compiler flag vocabulary,
benign static-library folder defaults and SDK install-name definitions. The last
passes without weakening external-path rejection. These are audit-development
records, not extra native smoke successes. The first owner-control harness stopped before the busy-listener test because
`bind` returned EADDRINUSE after the killed-app scenario; a connection probe
returned ECONNREFUSED. That attempt is retained as a harness failure, not a
successful busy-listener control. A new attempt used SO_REUSEADDR, repeated the
owner refusal, and verified the occupied listener still accepted connections.
No existing process or listener was terminated to repair this.

All test logs and command-boundary
fixture/mutation sources are retained or reproducible from `tools/`.

## Pins, setup and remaining scope

| Package | Resolved version |
| --- | --- |
| `expo` | 57.0.22 |
| `react-native` | 0.86.3 |
| `@expo/cli` | 57.0.27 |
| `@expo/repack-app` | 0.10.3 |
| `@expo/fingerprint` | 0.20.13 |
| `hermes-compiler` | 250829098.0.17 |
| `snapback4` | 0.4.7 |
| `snapback4-expo` | 0.4.7 |
| `expo-dev-client` | 57.0.19 |
| `expo-router` | 57.0.23 |
| `expo-video` | 57.0.5 |
| `expo-image-picker` | 57.0.20 |
| `expo-secure-store` | 57.0.4 |
| `expo-sqlite` | 57.0.3 |
| `expo-font` | 57.0.4 |
| `expo-asset` | 57.0.18 |

Package lock SHA-256: `353c60729b92b1638f86621f1af86cb334f7ebfd3066033f2a476e9c9d7544f6`. Xcode 27.0, iOS 27.0,
arm64 Release, New Architecture, Hermes 250829098.0.17 / HBC 98, CocoaPods
1.17.0, Node 24.18.0, npm 11.16.0; receipts retain exact tool/SDK identities.
CocoaPods and export Hermes compiler hashes match. Independent stage-0 comparison
confirms all **178 client files** and all
**7 native-core framework files** remain byte-identical.
[subject-helper.patch](subject-helper.patch) is exactly the round-2 patch, with
no new helper/client semantic change in round 3.

`simulator-setup.json` records dedicated boot/setup cost of **21,078 ms** separately. No dependency,
Xcode or simulator-runtime download occurred and no invented cold cost is reported.
Only UDID `5A16DA8F-0564-47F0-9D98-D9B3265CDD2B` was controlled; cleanup records its
shutdown/deletion. No system Xcode selection, other simulator, keychain or
unowned process was changed. Provider secret files were neither read nor copied.

M6/M8 scenarios/admission, wider native input/toolchain support, physical devices,
M1 discovery study, broader timing qualification and publication remain separate.
The conservative refusal and own `--build` recovery are part of the delivered
behavior. This round's committed change carries the commissioned co-author trailer.

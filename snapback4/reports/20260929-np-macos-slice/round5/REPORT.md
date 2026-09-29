# NP-mac round 5 — fresh bundles and private build outputs

**The build-route §11 protocol passes; LLP 3000.030 remains Accepted for that
bounded route.** Final A and five measured warm B builds pass prime, cold offline
and restart. Median **159.841 s**, nearest-rank p95 **197.562 s**, n=5
complete successful runs. One additional final-code B attempt was incomplete
because the shared disk filled; it is retained and excluded from success timings.
Repack remains withdrawn. Nothing pushed or published.

## Reviews, fixes and detecting evidence

The first command fetched and merged origin/main: already up to date. Starting
HEAD was `77b6b8896587d8b2868559a62dbf1626c4cb82fa`; origin/main was `398552255dab53ad9aa2e347f47bded11d65aad0`. Prompts and
reports r0–r4 were read with the host rules and [scoped context](CONTEXT.md).
Astra's full round-4 NOT READY review was read at entry. Grok was absent initially,
arrived during the first sample, and its full READY WITH CHANGES review was read.
Both were rechecked before completion; their copies and hashes are retained.
Neither verdict is represented as approval of these fixes.

| Finding | Change and evidence |
| --- | --- |
| Astra High: warm SKIP_BUNDLING seals A beside source B | Reject every nonempty raw/resolved setting, including `0` and whitespace. Query settings without masking the override, then pin `SKIP_BUNDLING=` on the actual build. Canonically validate and remove the previous product bundle before Xcode; require a newly present bundle. The preparation regression builds A, changes only JS to B, rejects the skip setting while A remains, rejects an exit-zero phase producing no bundle, then requires changed B source/HBC. Actual warm A→B control refuses before compilation/receipt/install while preserving A's private HBC. Running RN 0.86.3's unchanged script separately proves it exits zero and preserves A with SKIP_BUNDLING=1. |
| Astra/Grok Medium: resolved Swift/Pod output flags bypass audit | Match `OTHER_SWIFT_FLAGS` and `OTHER_MODULE_VERIFIER_FLAGS`; audit every resolved app/Pods target. Each -Xcc/-Xfrontend forwards one token into its own compiler channel, so paired forwarded paths work and mismatched/dangling wrappers refuse. Recognized output options require absolute canonical destinations inside the cache; unknown flags refuse. Command-boundary Pod controls cover module-interface, index-store and forwarded diagnostics output; a fake compiler would overwrite an outside sentinel if reached. Tests cover all recognized destinations, symlink parents, joined values and legitimate private paths. |
| Astra Medium: source-map destination escapes | Reject nonempty raw/resolved SOURCEMAP_FILE and pin it empty on the build. A resolved Pod fixture and a real app-setting control preserve outside sentinels before compilation. Also refuse bundler command/name/config/argument overrides that can select another producer or redirect output; resolved Hermes must name the pinned compiler. |
| Astra Low: subprocess-status guard mutation survives | A command-boundary Xcode failure exits 65 after leaving a fully valid B product and dependency records. Assert exact phase/status diagnostic, retained HBC equality and no build receipt. Removing the subprocess guard now fails this test. |
| Grok Medium: PER_ARCH_OBJECT_FILE_DIR and COMPILATION_CACHE_CAS_PATH | Both raw overrides refuse; resolved destinations for every target must remain inside the canonical cache. Pod command-boundary sentinels, conditional/raw settings, symlink-parent unit cases and real app-setting controls cover both. |

Ten isolated guard-removal mutations fail from a passing baseline: skip-setting
refusal, old-bundle removal, build invocation's empty skip pin, real Swift key,
forwarding, compiler output boundary, source-map refusal, subprocess status,
per-architecture object directory and CAS path. Earlier mutation runs remain in
evidence. Later index-store/option-vector test additions were also rerun.
Repack refusal, HBC-version checks, actual selected bundle binding, served-generation
facts, native-query refusal, unchanged data-or-explained-refusal semantics,
process-group cleanup and owner/listener rules remain intact.

## Complete protocol and timings

| Run | Complete ms | Preparation ms | Pods ms | Xcode ms | Prime / offline / restart ms |
| --- | ---: | ---: | ---: | ---: | --- |
| final-a-ownbuild-1 | 181,477 | 151,701 | 13,360 | 67,799 | 6265 / 7254 / 6940 |
| measured-b-warm-ownbuild-1 | 159,841 | 135,581 | 13,130 | 56,115 | 5343 / 5347 / 5360 |
| measured-b-warm-ownbuild-2 | 169,741 | 144,472 | 13,521 | 52,780 | 5331 / 5326 / 5472 |
| measured-b-warm-ownbuild-3 | 155,041 | 130,384 | 12,781 | 53,084 | 5379 / 5334 / 5505 |
| measured-b-warm-ownbuild-4 | 197,562 | 173,775 | 15,121 | 61,051 | 5445 / 4968 / 4907 |
| measured-b-warm-ownbuild-5 | 154,456 | 129,129 | 17,101 | 52,118 | 5548 / 5597 / 5762 |

The five-run success sample was declared by `tools/resume-sample-r5.py` after
space recovery: measured-b-warm-ownbuild-1 through -5, with no failure or
substitution within it. Median is the third sorted B duration; nearest-rank p95
is rank ceil(0.95 × 5), the largest. Times include private snapshot/input hashing,
Pods, Xcode, installation, normal session restoration, all smoke segments,
capture finalization and hashing. No test/archive job was deliberately run
alongside these five builds. Exact argv, cwd, allowed environment, start/end load,
PID and CLI digest are retained for every completely recorded invocation.
These are shared-host observations, not a quiet-host or universal timing promise.
Relative to round 4, median changed by -12.204 s and p95 by
-2.308 s; this is not an isolated guard-cost estimate.

Pre-final A first created a normal eight-message fixture on the owned simulator.
Final A and B reuse that real account/session, backend store and fixture; final A
is not a fresh-authentication measurement. The app authenticates/seeds through its
ordinary client and mutations. The driver supplies no session, rows or replies.
Only visible JS marker and logical 1×/2×/3× PNG change A→B. No reset or reinstall
occurs between any run's prime/offline/restart segments. All installs precede prime.

A shows NP A/blue and B shows NP B/green with eight held messages offline.
First-import Constants/Router, runtime-loaded font and bundled local WAV reference
are observed (no audio-playback claim). Every startup selects the verified installed
HBC; Release/Hermes true, __DEV__ false, launcher/Updates manifests absent.
All six device-answerable optional queries return data offline. Compiler-declared
server-only typing records loading and summary records E_OFFLINE as expected
unavailability; both answer online. Facts/generation bind to the owned served
backend, and restart consumes its exact zero-write barrier. No smoke relaxation.

| Identity | Final A | First measured B |
| --- | --- | --- |
| HBC version / bytes | 98 / 3468308 | 98 / 3468304 |
| HBC SHA-256 | `2ef5b51886968cca4b36be82bd3af45fed58461e7ba4f7fa2c431a893c066ab9` | `52123f33fee72b0c7657beaf8d62985dbd02f4b9bdc9d8be2c78533e78893b46` |
| App inventory SHA-256 | `7da30eb128b4e073997e75f05d48df1ea3e4378a307deea586e72feb9303ed78` | `2557b214858b17578eb994d85704bf63c73acf8ddbd7aee9dc43d3d3404092c2` |
| App file bytes | 51,652,691 | 51,652,687 |
| Local app tar+gzip bytes | 14,409,697 | 14,409,603 |

Native-byte equality is not required across genuine Xcode rebuilds. Each receipt
binds its own bytes; JS/assets/output differ A→B. Independent Python lstat/hashlib
verification recomputes all six full app inventories, HBC headers/hashes, read-only
build/proof binding, xcresult inventories, phase logs, preserved native dependency
records, finalized artifacts, actual selected URL/path, runtime flags, generation,
query facts and app probes. All measured runs use the same five helper bytes and
CLI `def7714909040a2043beb5c036f8e4bd3893e99cc31b151e41f77995f6af9668`; final source binding checks those helpers exactly.
Payload archive sizes are local application artifacts, not npm download sizes.

## Controls, checks and every unsuccessful attempt

Ten real output-setting controls follow passing measured B5: four linker files,
CONFIGURATION_BUILD_DIR, SYMROOT, OBJROOT, SOURCEMAP_FILE, PER_ARCH_OBJECT_FILE_DIR
and COMPILATION_CACHE_CAS_PATH. Each requires the exact injected setting/path and
preserves its outside sentinel hash with no compilation/proof/install. Resolved
Pod compiler/bundler setting coverage is the separate command-boundary test,
not a claim that a real Pod compiler wrote outside this workspace.

Tampered built HBC refuses before install. A real uncaught cold-offline startup
error fails smoke; after source restoration, killing only the recorded app PID
after its actual successful restart receipt prevents pass. Existing simulator
owner and port listener survive refusal. An interrupted preparation's owned
SIGTERM-resistant descendant stops while the project lease is held, then the
lease releases. CLI/helper repack selectors refuse before preparation.
Controls are independently matched to the intended diagnostics/receipts, and
all subject mutations are restored in finally blocks.

Affected checks pass: **31 JS helper/preparation/smoke, 28 driver, 10 witness unit,
99 guide tests**. Root ref-check and diff whitespace checks pass. Exact commands,
with pinned Node/Bun/Rust PATH, DEVELOPER_DIR and task-local TMPDIR:

```sh
# cwd snapback4
cargo build -p snapback4
node --test packages/snapback4/test/witness.test.mjs packages/snapback4/test/native-smoke.test.mjs packages/snapback4/test/witness-preparation.test.mjs
cargo test -p snapback4 --bin snapback4 verbs::witness::
cargo test -p snapback4 --test witness -- --test-threads=1
cargo test -p snapback4-lang --test guide
# cwd repository root
./ref-check --verbose
```

The first read-only replay audit combined archived settings with the mutable
snapshot left by round 4's interruption control. It refused the old stage-0 VFS
path. Fresh private pod resolution regenerates that overlay; final native audits
pass without weakening the path check. The first sample's A passed in 171,717 ms,
then B was deliberately interrupted with SIGINT to its recorded driver PID when
Grok's two additional keys arrived. Both records remain; they are not final timing
members. Final A then passed all fixes.

The first final-code B attempt hit ENOSPC during snapshotting on the shared
3.6 TiB volume. There is no build/proof/run receipt. The outer recorder also
could not persist final CLI status or duration; the initial command record and
traceback remain, with those fields explicitly unknown. No timing is invented.
Only this lane's rebuildable Rust incremental cache was removed (~3.1 GiB);
source, native DerivedData, all evidence and other sessions were preserved.
The five complete measured B runs began after recovery. This environmental
failure is disclosed, not relabeled as success. No failed measurement is hidden.

| Invocation | Exit | Complete ms | Note |
| --- | --- | ---: | --- |
| a-ownbuild-1 | 0 | 171717 | pre-Grok success, excluded from final sample |
| b-warm-ownbuild-1 | 1 | 10076 | intentionally interrupted for late Grok findings |
| control-busy-port | 1 | 438 |  |
| control-cold-error | 1 | 197684 |  |
| control-concurrent-owner-2 | 1 | 438 |  |
| control-death-restart-2 | 1 | 177283 |  |
| control-final-warm-skip-bundling | 1 | 7009 |  |
| control-interrupted-preparation | 1 | 17540 |  |
| control-output-compilation_cache_cas_path | 1 | 1494 |  |
| control-output-configuration_build_dir | 1 | 1382 |  |
| control-output-ld_dependency_info_file | 1 | 1596 |  |
| control-output-ld_lto_object_file | 1 | 1486 |  |
| control-output-ld_map_file_path | 1 | 1603 |  |
| control-output-ld_sdk_imports_file | 1 | 1487 |  |
| control-output-objroot | 1 | 1477 |  |
| control-output-per_arch_object_file_dir | 1 | 1380 |  |
| control-output-sourcemap_file | 1 | 1382 |  |
| control-output-symroot | 1 | 1379 |  |
| control-tampered-output | 1 | 184190 |  |
| control-warm-skip-bundling | 1 | 1589 |  |
| final-a-ownbuild-1 | 0 | 181477 |  |
| final-b-warm-ownbuild-1 | unknown | unavailable | ENOSPC prevented final command recording; no build/proof/run receipt |
| measured-b-warm-ownbuild-1 | 0 | 159841 |  |
| measured-b-warm-ownbuild-2 | 0 | 169741 |  |
| measured-b-warm-ownbuild-3 | 0 | 155041 |  |
| measured-b-warm-ownbuild-4 | 0 | 197562 |  |
| measured-b-warm-ownbuild-5 | 0 | 154456 |  |

## Pins, retention and scope

Apple M5 Pro mini, 18 cores/64 GiB, macOS 27.0, Xcode 27.0 (27A266a), iOS 27.0,
CocoaPods 1.17.0, Node 24.18.0, Bun 1.3.12, Rust 1.97.0. Expo 57.0.22,
RN 0.86.3, fingerprint 0.20.13, Hermes 250829098.0.17 / HBC 98. Package lock:
`353c60729b92b1638f86621f1af86cb334f7ebfd3066033f2a476e9c9d7544f6`. Exact package/tool pins are archived.
All 178 published 0.4.7 client files and
7 native-core framework files remain byte-identical
to stage 0. The seven-file local unpublished witness helper patch is unchanged
from round 2 and separately retained. No core/client/wasm change or cap increase;
no new wasm-size measurement is claimed (cap remains 593,719 B gzip).

Only UDID `70220322-4798-470D-BE66-E17EAED0B7FD` was controlled and deleted after collection.
Creation/boot took 16.525 s separately. No dependency or
tool download occurred. Stage 0's 359 s cold native build/install remains partial
context with smoke/setup additional; no complete cold-proof time is inferred.
Only owned recorded PIDs/groups were signaled. No global Xcode selection,
keychain/system setting, other simulator, credential file, push or publication
was touched. Private backend/session stores are not report artifacts.

[EVIDENCE.json](EVIDENCE.json) binds raw files and deterministic gzip copies;
archive hashes are independently reverified. Large apps, xcresults, recordings
and app archives remain under `/Users/ccheever/sb4-np/evidence/round5/`, bound by
committed manifests. Scripts and selected screens accompany this report.
LLP 3000.030, witness card and M1 READMEs describe the qualified build route and
current measured costs; one journal entry is appended. M6/M8 admission, physical
devices, a general SDK/toolchain matrix, repack, and publication remain separate.
The local commit carries `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.

from pathlib import Path
import json,hashlib,statistics
r=Path('/Users/ccheever/sb4-np');e=r/'evidence/round4';report=r/'lane/snapback4/reports/20260929-np-macos-slice/round4'
def read(p):return json.loads(p.read_text())
def h(p):return hashlib.sha256(p.read_bytes()).hexdigest()
assert read(e/'controls-verification.json')['allIntendedFailures']
assert read(e/'independent-verification.json')['fullSmokePass']
assert all(x['exitStatus']==x['expected'] for x in read(e/'mutations.json'))
t=read(e/'timings.json');v=read(e/'independent-verification.json');pins=read(e/'package-pins.json');sizes=read(e/'compressed-app-sizes.json');reviews=read(e/'reviews-final.json')
rows=[]
for x in v['runs']:
 phases={p['label']:p['durationMs'] for p in x['phases']};segments=' / '.join(str(x['segments'][k]['durationMs']) for k in ['prime','offline','restart'])
 rows.append(f"| {x['name']} | {x['commandMs']:,} | {x['preparationMs']:,} | {phases['pods']:,} | {phases['xcode-build']:,} | {segments} |")
commands=[]
for p in sorted(e.glob('*-command.json')):
 j=read(p);commands.append(f"| {p.name.removesuffix('-command.json')} | {j['exitStatus']} | {j['durationMs']:,} |")
a,b=v['runs'][:2];u=(e/'owned.udid').read_text().strip()
text=f'''# NP-mac round 4 — own-build native proof; repack withdrawn

**The build-route §11 protocol passes. LLP 3000.030 is Accepted for that route
only. Repack is withdrawn.** A and all five warm B builds pass prime, cold
offline and restart. Median **{t['medianMs']/1000:.3f} s**, nearest-rank p95
**{t['nearestRankP95Ms']/1000:.3f} s**, n=5. These are complete invocation times
on a shared M5 Pro mini, with installed tools/dependencies and warm native caches.
No push or publication. No core/client/query/smoke semantic or wasm change.

## Decision, reviews and code

The first operation fetched and merged origin/main: merge `9bc0a72037`, main
`398552255d`. All three journal conflicts kept both sides. Prompts r0–r4 and
all prior reports were read; [CONTEXT.md](CONTEXT.md) records llp-orient scope.
Astra's full round-3 **NOT READY** review is retained with SHA-256
`{h(e/'input-astra-review.md')}`. Grok's round-3 **NOT READY** review was absent at the initial check and arrived
during controls. It was read in full and retained with SHA-256
`{h(e/'input-grok-review.md')}`; `reviews-final.json` records the final recheck. No prior review is represented
as a post-fix approval.

| Finding | Disposition |
| --- | --- |
| DerivedData consumed inputs lack reuse validation | Native reuse is removed. Recorded positive dependencies are provenance, not proof of producer custody or permission to skip Xcode. |
| Missing compiler-header probes, including macro-expanded `__has_include` | Native reuse is removed. No complete compatibility-key claim remains. Any future repack needs negative lookup coverage or explicit refusal. |
| Linker side outputs escape private roots | Raw app overrides refuse; resolved destinations for every app/Pods target must stay inside the canonical private cache. Covers LD_MAP_FILE_PATH, LD_DEPENDENCY_INFO_FILE, LD_LTO_OBJECT_FILE and LD_SDK_IMPORTS_FILE, including conditional settings and symlink parents. Existing flags/script/copy-phase restrictions remain. |
| Grok: OTHER_SWIFT_FLAGS / OTHER_MODULE_VERIFIER_FLAGS missed by the regex, with forwarded VFS/plugin arguments mishandled | Retained unresolved in the deferred repack design. A future revival needs the real flag spellings, -Xcc/-Xfrontend argument handling, overlay external-contents/plugin coverage and detecting Pod-target tests. Build always invokes Xcode; inventories grant no complete compatibility-key or sandbox claim. |
| Toolchain-revalidation loop mutation survives | The loop is deleted with repack, not claimed repaired. LLP §12 retains the required changed-bytes/same-version test for any future revival. |

`--repack` and `--app-project` refuse immediately with `witness ios --build
<project> --smoke` recovery. Rust has only a build project field and invokes
only build preparation. The JS entrypoint accepts only `build`, before any
project lookup or cache/artifact/tool action. The repack receipt reader, tool
invocation, equality/revalidation branch, repack asset utility, special output
label and eligibility pin are deleted. There is no dormant repack implementation.
Command-boundary tests prove direct helper calls cannot bypass withdrawal.
The installed historical repack dependency remains in the subject lock but is
neither required nor invoked; the build fixture succeeds without it installed.

Build keeps direct non-GUI Xcode/simctl, an immutable read-only `build.json`,
prelaunch `proof.json`, actual RN-selected installed HBC binding, generation/fact
binding to the owned served backend, unchanged smoke classifications, owned
process-group cleanup and project/simulator leases, and private output paths.
All remaining native auditing functions are called by build for input/output
validation or recorded provenance. They grant no hermetic-build or adversarial
attestation claim. Xcode runs on every edit and supplies its own incremental
build tracking.

## Complete protocol and timings

| Run | Complete ms | Preparation ms | Pods ms | Xcode ms | Prime / offline / restart ms |
| --- | ---: | ---: | ---: | ---: | --- |
{chr(10).join(rows)}

Sample membership was declared by `tools/sample-r4.py`: A, then B1–B5, with
no discarded or substituted native qualification attempt. Median is the third
sorted B duration; nearest-rank p95 is ceil(0.95 × 5), the largest. Complete
elapsed times include snapshot/input hashing, CocoaPods, Xcode, preservation,
install, ordinary session restoration, all three segments, video finalization
and artifact hashing. Per-command records retain exact argv/cwd, allowed
environment subset, CLI digest, PID and start/end load averages. Shared load
rose during B1; it remains in the sample. No checks/archive jobs were deliberately
run concurrently with the five warm measurements. Wider-host repeatability
and a ten-run study remain separate.

A begins on this round's fresh dedicated simulator, using the subject's existing
backend store. Normal app signup/mutations create a new eight-message conversation;
B reuses that normal account/session and fixture. The driver provides no session,
credentials, rows or mocked results. Only the visible marker and the logical
1×/2×/3× PNG change between A and B. No reinstall/reset occurs between a run's
segments. Each invocation installs before prime and gets fresh immutable artifacts.

A shows NP A and blue; B shows NP B and green, with eight held messages offline.
First-import embedded Constants/Router, runtime-loaded font and local WAV
resolution are observed (no audio-playback claim). SourceCode selects the
verified installed HBC on every launch; Release/Hermes are true, __DEV__ false,
and launcher/Updates manifests absent. All six device-answerable optional queries
return data offline. Compiler-declared server-only typing returns loading and
summary returns E_OFFLINE, explicitly expected unavailability; both answer online.
Every receipt binds query facts/generation to the served backend and restart
consumes its exact zero-write barrier. No smoke relaxation or timeout increase.

| Identity | A | First warm B |
| --- | --- | --- |
| HBC version / bytes | 98 / {a['javascript']['bytes'] if 'bytes' in a['javascript'] else a['javascript'].get('length')} | 98 / {b['javascript']['bytes'] if 'bytes' in b['javascript'] else b['javascript'].get('length')} |
| Selected HBC SHA-256 | `{a['javascript']['sha256']}` | `{b['javascript']['sha256']}` |
| App inventory SHA-256 | `{a['appInventorySha256']}` | `{b['appInventorySha256']}` |
| App file bytes | {a['appBytes']:,} | {b['appBytes']:,} |
| Local app tar+gzip bytes | {sizes[0]['tarGzipBytes']:,} | {sizes[1]['tarGzipBytes']:,} |

These are local application archive sizes, not npm download claims. Native
Mach-O equality is not required between independent Xcode builds. Each receipt
binds its own executable/framework bytes; JS/assets/output changes are independently
verified. `independent-verification.json` recomputes all six complete app
inventories, HBC headers/digests, read-only receipt/proof binding, xcresult
inventories, phase logs, preserved native dependency records, finalized artifact
hashes, actual selected URL/path, runtime flags, generation/facts and app probes.
All six use CLI SHA-256 `{a['cliSha256']}` and the same five embedded helper files. Final source cleanup removes trailing
blank lines from two helper files only; `final-source-binding.json` verifies
equality after stripping trailing whitespace. No executable statement changed.

Simulator creation/boot took {read(e/'simulator-setup.json')['durationMs']/1000:.3f} s separately.
No cold-cache build or dependency/Xcode/runtime download was performed here.
Stage 0 measured 359 s cold native build/install and 138 s warm build/install;
its final GUI activation failed and it did not run full smoke. The guide describes
about six minutes of cold native preparation **plus smoke/setup**, not a measured
six-minute cold proof. This round's exact warm median/p95 appear beside the route.

## Controls and checks

All controls follow the passing unmodified B5 baseline and preserve failed
artifacts. The seven real raw-output controls inject each of four linker file
settings and CONFIGURATION_BUILD_DIR/SYMROOT/OBJROOT, require the exact setting
and outside path in the refusal, and verify each pre-existing sentinel's digest
unchanged. No Xcode build, install or proof follows. The command-boundary fixture
also injects a resolved **Pod** target destination; its fake linker would overwrite
the sentinel if reached. Removing the resolved guard makes this test fail.
Tests additionally cover conditional settings and symlink-parent escapes.

Tampering with the built HBC before the actual inventory verifier fails before
install. A genuine uncaught cold-offline startup error produces failed smoke;
after restoring the source, killing only the recorded app PID after its actual
successful restart receipt prevents pass. An existing simulator lock holder and
port listener survive refusal. An interrupted preparation's SIGTERM-resistant
owned child stops before the project lease is released. `controls-verification.json`
checks exact diagnostics, receipts and injection records; no prefix-only false
positive is counted. Inputs are restored in finally blocks.

Affected checks: 31 JS helper/preparation/smoke tests, 28 driver tests, 10 witness
unit tests and 99 guide tests. Mutation evidence retains a passing preparation
baseline and four detecting removals: resolved linker outputs, raw linker outputs,
HBC-version comparison and direct-helper withdrawal. The former toolchain reuse
mutation is deferred with the removed mechanism, not silently counted as fixed.
Exact commands (cwd snapback4, pinned Node/Bun/Rust PATH and task-local TMPDIR):

```sh
node --test packages/snapback4/test/witness.test.mjs packages/snapback4/test/native-smoke.test.mjs packages/snapback4/test/witness-preparation.test.mjs
cargo test -p snapback4 --bin snapback4 verbs::witness::
cargo test -p snapback4 --test witness -- --test-threads=1
cargo test -p snapback4-lang --test guide
```

Root `./ref-check --verbose` passes: 524 LLP documents, 9,890 refs, zero errors
or unchecked refs. The initial guide
check found the obsolete E_WITNESS_REPACK recovery row; its removal is reflected
in the passing rerun. Two accidental Cargo invocations at the repository root
failed before reaching Snapback 4; `build-final.log` and `guide-root-cwd.log` preserve them. An early doc
edit script stopped at an EOF lookup and was completed without losing content.
Control suffix `-2` is inherited from prior-round scripts; no earlier round-4
attempt is omitted. No native qualification failure is omitted; all invocations
are listed below.
No inherited Snapback 1 bootstrap/inventory gate or full-battery claim is added.

| Invocation | Exit | Complete ms |
| --- | ---: | ---: |
{chr(10).join(commands)}

## Pins, retention and remaining scope

Host: Apple M5 Pro mini, 18 cores/64 GiB, macOS 27.0, Xcode 27.0 (27A266a),
iOS simulator 27.0, CocoaPods 1.17.0, Node 24.18.0, Bun 1.3.12, Rust 1.97.0.
Receipts and `host-pins.json` retain exact versions. Expo 57.0.22, RN 0.86.3,
fingerprint 0.20.13, Hermes compiler 250829098.0.17/HBC 98; package lock SHA-256
`{pins['packageLockSha256']}`. `package-pins.json` lists every relevant package.
All {pins['publishedClientFileCount']} published 0.4.7 client files and
{pins['nativeCoreFileCount']} native-core framework files remain byte-identical
to stage 0. The seven-file local unpublished witness helper patch is unchanged
from round 2, separately retained as `subject-helper.patch`. No wasm source or
budget changed; no new wasm-size result is claimed (cap remains 593,719 B gzip).

Only owned UDID `{u}` was used and deleted after collection.
Only recorded owned PIDs/groups were signaled; no other simulator, Xcode
selection, keychain or system setting was changed. No provider-secrets.env file
was opened or copied. Backend/session stores remain private and are excluded
from the report. `EVIDENCE.json` maps raw files to lossless gzip copies and binds
both source and compressed hashes, reverified after archiving. Selected PNGs
are included. Large .app payloads, .xcresults, MP4s and app archives remain under
`/Users/ccheever/sb4-np/evidence/round4/`, bound by the committed manifests.

LLP 3000.030 §§1, 11 and 12 now define only the shipped build route as Accepted;
its deferred repack design and every historical finding/timing remain explicit.
The witness guide, M1 package README and Expo README lead builders to
`npx snapback4 witness ios --build . --smoke` with pins, honest costs and scope.
M6/M8 admission, physical devices, a general native/toolchain matrix, an independent
M1 discovery study and publication remain separate. One journal entry is appended;
the local commit carries the commissioned co-author trailer. Nothing pushed
or published.
'''
(report/'REPORT.md').write_text(text)
print('Report written')

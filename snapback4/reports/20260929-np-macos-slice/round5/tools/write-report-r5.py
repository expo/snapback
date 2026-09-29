from pathlib import Path
import json,hashlib
r=Path('/Users/ccheever/sb4-np');e=r/'evidence/round5';repo=r/'lane';report=repo/'snapback4/reports/20260929-np-macos-slice/round5'
read=lambda p:json.loads(p.read_text())
h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
t=read(e/'timings.json');v=read(e/'independent-verification.json')['runs'];assert len(v)==6 and t['n']==5
assert read(e/'controls-verification.json')['allIntendedFailures']
median=t['medianMs']/1000;p95=t['nearestRankP95Ms']/1000
lines=[]
for x in v:
 phases={p['label']:p['durationMs'] for p in x['phases']}
 seg=' / '.join(str(x['segments'][k]['durationMs']) for k in ['prime','offline','restart'])
 lines.append(f"| {x['name']} | {x['commandMs']:,} | {x['preparationMs']:,} | {phases['pods']:,} | {phases['xcode-build']:,} | {seg} |")
attempts=[]
for p in sorted(e.glob('*-command.json')):
 j=read(p);duration=j.get('durationMs');status=j.get('exitStatus');note=''
 if status is None:status='unknown';note='ENOSPC prevented final command recording; no build/proof/run receipt'
 elif p.stem=='b-warm-ownbuild-1-command':note='intentionally interrupted for late Grok findings'
 elif p.stem=='a-ownbuild-1-command':note='pre-Grok success, excluded from final sample'
 attempts.append(f"| {p.name[:-13]} | {status} | {duration if duration is not None else 'unavailable'} | {note} |")
a,b=v[:2];sizes={x['name']:x for x in read(e/'compressed-app-sizes.json')};pins=read(e/'package-pins.json');reviews=read(e/'reviews-final.json');start=read(e/'start.json');setup=read(e/'simulator-setup.json')
text=f'''# NP-mac round 5 — fresh bundles and private build outputs

**The build-route §11 protocol passes; LLP 3000.030 remains Accepted for that
bounded route.** Final A and five measured warm B builds pass prime, cold offline
and restart. Median **{median:.3f} s**, nearest-rank p95 **{p95:.3f} s**, n=5
complete successful runs. One additional final-code B attempt was incomplete
because the shared disk filled; it is retained and excluded from success timings.
Repack remains withdrawn. Nothing pushed or published.

## Reviews, fixes and detecting evidence

The first command fetched and merged origin/main: already up to date. Starting
HEAD was `{start['head']}`; origin/main was `{start['originMain']}`. Prompts and
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
{chr(10).join(lines)}

The five-run success sample was declared by `tools/resume-sample-r5.py` after
space recovery: measured-b-warm-ownbuild-1 through -5, with no failure or
substitution within it. Median is the third sorted B duration; nearest-rank p95
is rank ceil(0.95 × 5), the largest. Times include private snapshot/input hashing,
Pods, Xcode, installation, normal session restoration, all smoke segments,
capture finalization and hashing. No test/archive job was deliberately run
alongside these five builds. Exact argv, cwd, allowed environment, start/end load,
PID and CLI digest are retained for every completely recorded invocation.
These are shared-host observations, not a quiet-host or universal timing promise.
Relative to round 4, median changed by {median-172.045:+.3f} s and p95 by
{p95-199.870:+.3f} s; this is not an isolated guard-cost estimate.

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
| HBC version / bytes | {a['javascript']['version']} / {a['javascript']['bytes']} | {b['javascript']['version']} / {b['javascript']['bytes']} |
| HBC SHA-256 | `{a['javascript']['sha256']}` | `{b['javascript']['sha256']}` |
| App inventory SHA-256 | `{a['appInventorySha256']}` | `{b['appInventorySha256']}` |
| App file bytes | {a['appBytes']:,} | {b['appBytes']:,} |
| Local app tar+gzip bytes | {sizes[a['name']]['tarGzipBytes']:,} | {sizes[b['name']]['tarGzipBytes']:,} |

Native-byte equality is not required across genuine Xcode rebuilds. Each receipt
binds its own bytes; JS/assets/output differ A→B. Independent Python lstat/hashlib
verification recomputes all six full app inventories, HBC headers/hashes, read-only
build/proof binding, xcresult inventories, phase logs, preserved native dependency
records, finalized artifacts, actual selected URL/path, runtime flags, generation,
query facts and app probes. All measured runs use the same five helper bytes and
CLI `{a['cliSha256']}`; final source binding checks those helpers exactly.
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
{chr(10).join(attempts)}

## Pins, retention and scope

Apple M5 Pro mini, 18 cores/64 GiB, macOS 27.0, Xcode 27.0 (27A266a), iOS 27.0,
CocoaPods 1.17.0, Node 24.18.0, Bun 1.3.12, Rust 1.97.0. Expo 57.0.22,
RN 0.86.3, fingerprint 0.20.13, Hermes 250829098.0.17 / HBC 98. Package lock:
`{pins['packageLockSha256']}`. Exact package/tool pins are archived.
All {pins['publishedClientFileCount']} published 0.4.7 client files and
{pins['nativeCoreFileCount']} native-core framework files remain byte-identical
to stage 0. The seven-file local unpublished witness helper patch is unchanged
from round 2 and separately retained. No core/client/wasm change or cap increase;
no new wasm-size measurement is claimed (cap remains 593,719 B gzip).

Only UDID `{setup['udid']}` was controlled and deleted after collection.
Creation/boot took {setup['durationMs']/1000:.3f} s separately. No dependency or
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
'''
(report/'REPORT.md').write_text(text)
print('Report written',len(text),'bytes')

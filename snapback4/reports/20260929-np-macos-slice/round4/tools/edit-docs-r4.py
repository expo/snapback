from pathlib import Path
p=Path('/Users/ccheever/sb4-np/lane/llp/3000.030-native-proof-in-minutes.rfc.md');s=p.read_text();s=s.replace('**Status:** Accepted','**Status:** Draft',1).replace('**Systems:** Snapback 4 Expo scaffold, own-application iOS Release build and repack, simulator witness, native benchmark evidence','**Systems:** Snapback 4 Expo scaffold, own-application iOS Release build, simulator witness, native benchmark evidence; deferred repack alternative').replace('**Revised:** 2026-09-29 (NP-mac round 3: complete native dependency coverage and private output validation; requalification recorded below)','**Revised:** 2026-09-29 (NP-mac round 4: repack withdrawn after round-3 review; own-build acceptance and linker-output privacy)')
a=s.index('Make **the builder');b=s.index('\n## 2.',a)
s=s[:a]+'''Ship **the builder's own Release simulator app, built and driven by the
witness**, including after JS/assets-only edits. The supervisor withdrew
`--repack` in round 4: repeated reviews found native inputs outside its
compatibility key, and an Xcode build graph is not completely captured by the
implemented inventories. The CLI refuses repack and points to `--build`; the
repack implementation is removed. Its design in §4 and historical protocol and
measurements in §§11–12 remain a **deferred alternative**, not a product claim.
The prebuilt host/direct-loader alternatives in §10 also remain deferred.

Run from the backend project (Expo project shown here in the same directory):

```sh
# First proof, or any JS/assets/native/config edit. Use fresh artifacts each time.
npx snapback4 witness ios --build . --udid "$UDID" --smoke \\
  --artifacts artifacts/native-build
```

`--build` feeds the existing driver. Installed-app mode,
`witness ios --bundle-id ...`, remains available and builds nothing. Both retain
the same smoke protocol, actual app client and owned backend. Build preparation
is non-GUI-safe, seals an immutable `build.json`, binds the selected installed
bundle on every launch, preserves served-generation residency facts and smoke
classification, cleans owned process groups, and keeps outputs private.
Custom linker output paths refuse before compilation, including map, dependency,
LTO and SDK-import files; resolved destinations are checked for all app/Pods targets.

Budget about **2.5 minutes warm build plus smoke** on the measured M5 Pro mini.
Stage 0 measured **359 s cold native build/install** and **138 s warm
build/install**; smoke and setup were additional, and that CLI's GUI activation
failed. Those are not cold end-to-end proof times. §12 gives round 4's five
complete warm builds, median and nearest-rank p95. Installed Xcode/runtime,
dependencies, a booted owned simulator and the disclosed helper patch are
preconditions, not hidden downloads. No universal two-minute promise is made.

An own warm build is `application-release`: Xcode builds the current project
using its own incremental tracking. Native input/dependency inventories are
provenance, **not permission to skip Xcode**. They do not claim a hermetic build,
complete negative lookup capture or an adversarial sandbox. Full generic smoke
proves the recorded three-segment lifecycle, not M6/M8 application assertions,
physical devices, publication or benchmark admission. The title describes
native proof in minutes; a preparation receipt alone is not passing smoke.
'''+s[b:]
s=s.replace('the captured native fingerprint bind their reuse.', 'the recorded source and build result establish provenance; no fingerprint\nequality can bypass Xcode.').replace('custom app output overrides, and check resolved output directories', 'custom app output overrides (including LD_MAP_FILE_PATH,\nLD_DEPENDENCY_INFO_FILE, LD_LTO_OBJECT_FILE and LD_SDK_IMPORTS_FILE), and check resolved output destinations')
s=s.replace('## 4. Fingerprint-checked repack\n', '''## 4. Fingerprint-checked repack

**Deferred and withdrawn from the product in round 4.** The following is the
retained alternative design, not shipped behavior. Rounds 1–3 executed this
candidate but the round-3 review disproved its completeness. DerivedData
consumed inputs lacked producer/revalidation proof; missing macro-expanded
header probes were absent; toolchain-input revalidation lacked a detecting
test. Reopening requires addressing all findings in §12, not merely restoring
a CLI flag. The implementation, receipt reuse and repack tool invocation have
been deleted. Build records may retain positive compiler/linker provenance,
but they grant no native compatibility or repack eligibility.
''')
s=s.replace('placed through their existing package layout. Repack itself resolves from the\napp\'s installed lock and is not a new Snapback package dependency.', 'placed through their existing package layout. The deferred repack design\nresolved the tool from the app lock; the shipped route never invokes it.')
s=s.replace('The three preparation selectors are exclusive: `--build`, `--repack`, or\nlegacy `--bundle-id`. Build/repack derive the bundle ID from the verified app;\n`--app-project` disambiguates the Expo root for repack.', 'The shipped selectors are exclusive: `--build` or legacy `--bundle-id`.\nBuild derives the bundle ID from the verified app. `--repack` and `--app-project`\nrefuse before preparation with a build recovery command. Repack/host artifact\nnames and policies below are retained solely for historical evidence and any\nfuture alternative; there is no shipped path that emits them.')
s=s.replace('explains later repack/warm rebuild','explains warm rebuilds after every edit').replace('After JS-only edits, the saved build receipt can support a checked\n> repack; native or config changes need a rebuild. See `guide witness` for\n> setup, app scenarios, evidence scope and the saved receipt command.', 'After any edit, run the same\n> command with fresh artifacts; the private Xcode cache stays warm. See\n> `guide witness` for setup, measured timings, app scenarios and evidence scope.')
s=s.replace('Simple fallback and comparison control. Already exceeds 120 s before smoke on stage-0 cal25.', 'Selected route after every edit; §12 retains complete warm-build timings.').replace('Selected fast-path candidate, conditional on §11. Retains actual app binary/identity; does not prove a fresh build.', 'Withdrawn after round-3 review; deferred compatibility design. Historical complete medians: 46.109 s (r1), 41.385 s (r2), 53.430 s (r3). Speed does not cure incomplete native-input coverage.')
a=s.index('## 11. First macOS slice and acceptance\n')+len('## 11. First macOS slice and acceptance\n');s=s[:a]+'''
### Shipped build-route acceptance (round-4 supervisor ruling)

Use the same real cal25 app, disclosed helper patch, normal unattended auth,
nonempty retained history, initial config, scaled image, runtime font and local
media probes. Only owned simulator UDIDs/PIDs may be touched. Every attempt
retains commands, exact pins, bytes/hashes, timings and failures.

1. Build A through `witness ios --build` without GUI access. Seal `build.json`,
   verify Release/HBC and the actual selected installed bundle, and pass prime,
   cold offline and restart. Retain screenshots/video, raw receipts and manifest.
2. Change the visible JS marker and bundled image to B. Invoke warm `--build`
   with fresh artifacts. Xcode must succeed before install; require changed JS
   and output digests, visible B/asset and full three-segment smoke. Native-byte
   equality is not required of a genuine rebuild.
3. Run controls: repack must refuse with build recovery at both CLI/helper
   boundaries; HBC mismatch or tampered prepared output must not issue a pass;
   real cold startup failure and death after success must fail. Existing
   simulator owners/listeners survive refusal. For custom linker map/dependency
   outputs, require the exact setting/path in the diagnostic and an outside
   sentinel unchanged. Preserve cleanup, selected-bundle and fact-binding tests.
4. Record at least five complete warm B `--build` runs with smoke, including
   preparation/install/capture finalization/hashing. Report every attempt,
   median and nearest-rank p95. Preserve input/native records before cache reuse.

`Accepted` now covers this build slice only and requires the above to pass.
Repack remains deferred regardless of its historical runtime successes. Warm
and cold setup costs stay distinct; no complete cold-proof time is inferred
from stage 0's failed final GUI step. M1 guide/README lead with `--build` and
honest timings. No smoke weakening, invented responses or benchmark admission.

### Deferred repack qualification protocol (historical)

The original candidate protocol follows for future comparison only. It is
not a condition for the shipped own-build route or evidence that repack is safe.
'''+s[a:]
s=s.replace('the own-build slice can ship with that limit and this RFC stays Draft for the\nremaining candidate work.', 'the own-build slice can ship under the round-4 acceptance above; the remaining\nrepack candidate stays deferred.')
s=s.replace('## 12. Review disposition and open measurements\n', '''## 12. Review disposition and open measurements

**Current disposition: repack is withdrawn.** Historical acceptance statements
below describe their round's measured runtime protocol, not a current native
compatibility claim or post-review approval. The round-4 build-only result at
the end governs this document's status. Every earlier finding and timing stays
in this record; none is erased by descoping.
''')
s+='''

### NP-mac round 4: repack withdrawn; build route

The supervisor withdrew repack after reading Astra's full round-3 **NOT READY**
review. Grok's round-3 file was absent at the initial check; the final check is
recorded in the round-4 report. Earlier review dispositions and timings above
remain historical. The [round-4 report](../snapback4/reports/20260929-np-macos-slice/round4/REPORT.md)
retains the original review, its hash, commands, controls and measurements.

| Round-3 finding | Round-4 disposition |
| --- | --- |
| High: consumed DerivedData files recorded but never rechecked | Withdraw native reuse. Arbitrary generated-directory contents have no proven producer custody. Positive dependency records remain build provenance, not a complete compatibility key. Reopening repack requires producer provenance or revalidation of every consumed file. |
| High: missing compiler-header lookups absent, including macro-expanded `__has_include` | Withdraw native reuse. Positive `.d` files cannot show missing-header semantics. Xcode runs for each edit; future repack must capture negative lookups or refuse these sources. |
| Medium: linker map/dependency files escape private output roots | Shared build route fixed: reject custom raw destinations and validate resolved LD_MAP_FILE_PATH, LD_DEPENDENCY_INFO_FILE, LD_LTO_OBJECT_FILE and LD_SDK_IMPORTS_FILE for every target, resolving symlink parents. Detecting tests and real outside-sentinel controls are required. |
| Surviving mutation: deleting toolchain-file revalidation passes all tests | The reuse loop is deleted together with repack, not claimed fixed. Any revival needs a preparation-level same-version/changed-bytes toolchain test. CLI and helper refusal controls prove the removed route cannot run. |

Round-3 Astra also confirmed selected-bundle checks, served-generation facts,
owned-group cleanup, HBC-version rejection, Pods-stage comparisons and runtime
classification fixes from earlier rounds. Those build-serving guarantees stay.
The unresolved broad native graph/key claim is expressly withdrawn. Current
runtime/timing results will be filled after the commissioned build protocol.
'''
p.write_text(s)

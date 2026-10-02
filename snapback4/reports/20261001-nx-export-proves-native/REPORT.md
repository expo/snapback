# NX round 0 — export proves native execution

2026-10-01; Apartment M5 Pro Mac mini, 18 cores / 64 GiB; branch
`sb4-np/nx-export-proves-native`. No push or publication. Governing design:
[LLP 3000.030 §15](../../../llp/3000.030-native-proof-in-minutes.rfc.md#15-export-proves-native-nx-round-0-2026-10-01).

> **Evidence archive.** Raw compressed dumps (`*.gz`) and screen recordings
> (`*.mp4`) under this directory, 6,402 paths and 1.31 GB, are not in git. They live
> in a content-addressed archive on the apartment Mac mini
> (`~/sb4-np/evidence-archive/20261001-nx-export-proves-native/`), and
> [`EVIDENCE-ARCHIVE.tsv`](EVIDENCE-ARCHIVE.tsv) lists each one's sha256, size
> and path. The branch was rewritten to drop them; every other byte is
> unchanged, and the manifest header maps the original commits to the
> rewritten ones. To restore them, run this from this directory:
> `grep -v '^#' EVIDENCE-ARCHIVE.tsv | while IFS=$'\t' read -r s n p; do mkdir -p "$(dirname "$p")"; cp "$ARCHIVE/blobs/$s" "$p"; done`

## Result

Both Expo starters now run the same Hermes export into `dist/`, followed by an
installed Release-app smoke when native tooling is available. A matching native
fingerprint reuses the audited Release binary without a native build, CocoaPods
install or prebuild; tool-version probes still run. The app loads the **exact exported HBC** and exported assets; each
of its three launches reports the SHA-256 of React Native's selected local
bundle, and the driver compares it with the export. `native:smoke` retains the
full-build path. Ordinary application launches retain their configured URL.

The complete command's warm median is **17.888 s plain / 23.870 s social**,
including Hermes export. Native-only medians are **15.138 s / 19.969 s**.
All ten warm samples pass, remain below 25 s, and load distinct fresh bundle
hashes matching their exports. Cold native-cache runs take **170.134 s /
243.806 s**; guide lines round these to 18–24 s warm / 170–244 s cold.

| Case | Plain export:ios | Social export:ios | Outcome |
| --- | ---: | ---: | --- |
| cold | 170.134 s | 243.806 s | exit 0, three segments pass |
| warm1 | 19.527 s | 23.349 s | exit 0, three segments pass |
| warm2 | 17.795 s | 24.404 s | exit 0, three segments pass |
| warm3 | 18.320 s | 23.283 s | exit 0, three segments pass |
| warm4 | 17.888 s | 24.876 s | exit 0, three segments pass |
| warm5 | 17.776 s | 23.870 s | exit 0, three segments pass |
| native-change | 97.638 s | 160.679 s | exit 0, three segments pass |
| startup-throw | 13.683 s | 15.234 s | exit 1, expected |
| missing-runtime | 3.134 s | 3.800 s | exit 0, native skipped |
| opt-out | 2.957 s | 3.575 s | exit 0, opted out |
| **Five-run warm median** | **17.888 s** | **23.870 s** | All five distinct bundles loaded |

These are simulator SDK lifecycle proofs, including native local store open,
acquisition, process-cold offline reopen and reconnect. The empty starters do
not establish nonempty application scenarios, pending-write replay, M6/M8,
physical-device behavior or publication qualification.

## Implementation and limits

- The fingerprint includes manifests, all locks, config/plugin bytes, all
  installed dependency bytes/versions, native trees, both Snapback versions,
  compiler/Hermes bytes, Xcode/SDK identity/settings, Node/Ruby/Pod identity and
  relevant tool environment. Only static generated starter application JS is
  excluded. Dynamic config, native source, codegen and unknown plugins remain
  conservative; existing adapter compatibility refusals remain in force.
- Reuse also validates the producer's compiler/linker inputs, generated
  dependencies/native source, lookup topology (including SDK symlink roots),
  and full cached app inventory. Three bounded workers check independent
  byte sets alongside the project fingerprint; all workers exit before reuse
  or a cache-miss build. No stat-only hash cache replaces a content check.
  Mutation during overlay refuses proof.
  Cache misses run the existing audited Release build. Generated iOS projects
  are prebuilt cleanly while installed Pods are preserved; removed config
  cannot survive as stale native configuration.
- The copy uses exported `assetmap.json` to recover native resource names and
  exported bytes, with Expo's native scale filtering and duplicate-scale
  ordering. Native executable/configuration bytes must remain byte-identical.
  Unreferenced base resources can remain. Export adds only the asset map;
  the exporter, platform, HBC transforms and `dist/` location are unchanged.
- `smokeOrigin` accepts only the bridge's simulator smoke launch and a loopback
  port. It does not change ordinary/remote/physical launches. Guest sign-in
  remains the starter's normal flow; the driver injects no credentials or rows.
- Only native environment selection/create/boot failures are skippable. App,
  SDK, backend, build, install, lease, proof and assertion failures stay nonzero.
  Off macOS or with `SNAPBACK4_NATIVE_SMOKE=off`, export success stays success.
  Missing-runtime receipts explicitly remain failed native receipts even though
  the wrapper preserves export success. A skip is never native proof.
- Warm smoke introduces no network dependency beyond its local backend.
  Cold CocoaPods/React Native preparation retains its existing dependency
  prerequisites and may download its existing artifacts.

## Reproduction and evidence

The test projects were generated with the candidate CLI and installed from the
starter's existing registry pins. `setup-candidates.py` then overlays local
candidate `snapback4`/`snapback4-expo` sources, built client/wasm and the locally
built XCFramework. This is **unpublished local candidate evidence**, not a claim
about the published 0.4.10 package. No package version was changed.

`run.mjs` invokes the pinned Node 24.18.0 npm with `npm run export:ios`, records
wall time, native-only time and exit status, reads the export's SHA-256,
and collects the receipt. Final measurements use the optimized production CLI. The social cold build
overlapped affected Rust test compilation/driver checks; all final warm runs
were measured without our other test/build jobs running. Other sessions and
macOS services on this shared host were left untouched.
`exercise.mjs` checks cold/cache-hit classification, three passed segments and
hash equality; five distinct application-JS edits must produce five new loaded
hashes. A native `app.json` Info.plist marker must trigger Xcode and appear in
the executed app. A startup throw must fail; a PATH-only no-runtime shim and
the explicit opt-out must preserve export success. No system tool selection
was changed. See `host.json` and `qualification-source.json` for host/tool and
measured source/binary identities. After the matrix, a conservative fingerprint guard additionally binds the full
sanitized preparation environment for custom-plugin/native/dynamic shapes
(which can consume the generated origin/TMPDIR). Unit controls cover it; the
static-starter branch adds no environment inputs and keeps the same byte checks.
The changed adapter identity invalidates older caches.
Guide timing edits also change embedded prose. `final-source.json` separately
records the final source; this is not an exact final-binary publication claim.

Each canonical `<starter>-<case>.json` contains its original artifact path,
exported/loaded hash, native cache decision, duration and status. `retain.mjs`
rechecks complete prepared app inventories and each successful launch's actual
loaded hash before cleanup, then retains the command's flat evidence files
under `evidence/`. Large JSON/log files are gzip-compressed; `retention.json`
records original and retained SHA-256 values. Large app/Xcode products are
removed only after verification. Development measurements remain separately
labelled and do not contribute to final medians. Cold means the private native
cache, Pods and DerivedData were absent; npm dependencies were installed and
shared Metro/system caches were not erased. The social native-change control overlapped affected checks; plain startup-throw
and skip controls overlapped the full-suite startup. No warm timing sample
overlapped our other build/test jobs.

## Verification

- Affected JavaScript: **60/60 passed**, including preparation, witness,
  starter/periphery, social starter and six new export/cache controls.
- Final conservative-environment fingerprint guard: **6/6 passed**.
- Rust witness unit scope: **14/14 passed**. Starter integration: **22/22**.
  Initial witness integration: 49/50; its baseline expectation was corrected
  and the focused control passes (see failure record below).
- Whole guide after corrections: **110/110 passed**. README stays at its
  300-line budget; client card at 1,200 words; witness card at 399 lines.
- Storage fixture correction after the full suite exposed the missing mock:
  **14/14 passed** (`app-storage-fixed.log`); see the original failures below.
- Final reference audit: `ref-check: ok — 525 LLP docs, 10180 refs in 31801 files,
  0 errors, 0 unchecked`.

`scripts/test.sh` ran **once**, exit 1. Exact final summary:

```text
== 1 failure(s) in 2593 s
   client tests
```

All Rust targets and doctests pass, including final witness integration 50/50
and whole guide 110/110. Build, wasm, release guard, package/app typechecks,
package build, chat check and fixture-wrapper checks pass. Final client models:
79/79, including both 5,000-sequence session tiers and all 3,000 online-client
interleavings. The original client-test step's eight failures are listed below;
all are corrected and the affected file passes. The full suite was not rerun.
`full-suite-status.json` records one invocation and 2,593.500 s measured wall time.

The stated 60 s suite budget is **not met**. This is baseline scheduling/workload
plus this host's cold test compilation, not a warm publication qualification:
Rust took 1,208 s (witness alone 504.6 s), the client pool 1,159 s, and final
models 176 s. `baseline-suite-budget.txt` records the unchanged serial witness
scheduler and existing 120/122-second subprocess/timeout controls. No timeout,
seed count, test roster or suite scheduler was weakened.

Wasm: 2,014,420 B raw / **604,666 B gzip**, against the unchanged 605,225 B
ratchet: **559 B headroom**. No core/runtime or budget change was needed.

## Failures and attribution

Final intentional negative controls (startup exception and no runtime) are
successful tests of failure/skip behavior, not suite failures.

Development findings, all ours and fixed before final qualification:

1. The first wrapper's direct-entry check did not follow npm's bin symlink,
   so it exited zero without exporting. Fixed with realpath; the regression
   invokes an actual bin symlink and also verifies export exit-code preservation.
2. The first static-plugin allowlist omitted `expo-status-bar`, making a plain
   starter JS edit conservatively rebuild. Added the known pinned plugin and
   covered the starter plugin configuration in the fingerprint unit test.
3. The first social cold build rejected Expo Router's duplicate 1x image
   destinations (`clear-icon.png` plus `clear-icon@1x.png`). The overlay now
   matches Expo's last-entry duplicate-scale handling and iOS scale filter;
   the unit fixture exercises both. The failed receipt is retained as
   `social-before-asset-fix-cold` and is excluded from timing claims.

Early setup commands also used an incorrect working-directory prefix; their
missing-manifest/script errors were invocation errors, not product failures.
The initial npm prototype selected ambient Node 26; final runs pin Node 24.18.
Additional cache audits added generated dependency/topology checks and a
concurrent-export negative control before the final cohort. Earlier runs used
the debug CLI; final runs use the shipped production profile. The serial social
cache check was too slow (29.523 s even with production); independent byte
checks were parallelized before the final matrix.

The model-capacity interruption terminated an in-flight warm driver. Its
recorded app process remained, and the next attempt correctly refused to
replace it. After stopping that owned PID, CoreSimulator still reported
`Host recording is already in progress` (video exit 16). Only our recorded
simulator was shut down and rebooted to clear that interrupted capture.
These two recovery failures are **environmental**, not passing samples; their
logs/metrics are retained. The interrupted run has no final receipt or timing
claim. No failed sample was silently retried into a five-run median.

Affected-test findings:

- **Ours, corrected:** initial whole guide run had 107 passes / 3 failures:
  `client::existence_card_and_starters_teach_the_sdk_words` (client card exceeded
  1,200 words), `client::native_smoke_is_the_milestone_path_with_honest_limits`
  (new test compared uppercase `iOS` against lowercased prose), and
  `definitions::w11_every_registered_code_quotes_its_definition` (origin remedy
  paraphrased the required definition). Wording/test corrections keep existing
  budgets and the exact diagnostic remedy.
- **Baseline test drift, corrected:** the first witness integration run had
  49 passes / 1 failure, `driver::boot_failure_keeps_created_identity_in_receipt`;
  the focused rerun reproduced it. Baseline source already emits the generic
  `E_WITNESS_SIMULATOR` diagnostic, while this unchanged test expected literal
  `simctl boot`. `baseline-boot-refusal.txt` binds both baseline excerpts. The
  test now checks the diagnostic code and the actual last fake simctl operation
  (`boot`/`bootstatus`), retaining all created-device identity assertions.
  No product diagnostic changed.

The complete suite exposed **eight ours, corrected** failures in
`app-storage.test.mjs`. Its generated-client VM fixture returned an empty
module for the newly imported `snapback4-expo/witness`, causing
`TypeError: (0 , witness_1.smokeOrigin) is not a function` before its custody
assertions. `app-storage-before-fix.log` reproduces the error independently.
The fixture now models an ordinary launch with `smokeOrigin: fallback =>
fallback`; none of its storage assertions changed. The entire file then passes
14/14 (`app-storage-fixed.log`). The eight original failing cases are:

- `generated Expo storage keeps a!b and a~b write custody separate`
- `generated Expo storage keeps a*b and a'b write custody separate`
- `generated Expo storage keeps a(b and a)b write custody separate`
- `generated Expo storage keeps user:01ABC and user_3A01ABC write custody separate`
- `generated Expo storage keeps ab and 慢 write custody separate`
- `generated SecureStore separates formerly colliding backend session keys`
- `recovery refuses an intent with a foreign recorded owner even at the correct safe key`
- `recovery quarantines a valid same-principal journal transplanted from another backend`

There were no other complete-suite failures. All eight are **ours, corrected**;
there is no outstanding failing affected test. The original exit 1 is retained.

The original client pool reports 5,746 passed / 8 failed / 5 skipped (5,759
cases). Its five skips are existing opt-in external fixtures: managed
organization/invitation policy, managed OIDC profile binding, the published
0.2.27 bounds binary, the published 0.2.33 F2 legacy binary, and the published
0.2.32 server. Their exact prerequisite messages remain in `full-suite.log`;
none is counted as native proof.

## Host ownership and cleanup

Only the tool-created and recorded simulator
`40F37BC8-7B71-497A-BFDE-022928C5B98C`
(`sb4-nx-1790894904995-92367`) was used. No simulator belonging to another
session was booted, installed, shut down, erased or deleted. No global simctl
cleanup, `xcode-select` change or unrelated process kill was performed.

`simulator-cleanup.json` records successful shutdown/deletion of that exact
owned UDID and removal of its creation record. `build-cleanup.json` records
removal of this lane's complete `target/` (sample projects, private native
caches, Pods, DerivedData, app copies and Rust products), installed worktree
node_modules, generated APIs/native fixture source, client/wasm outputs and
XCFramework. The temporary NX setup files were also removed. No live process
using this worktree's target remained before deletion. Shared global caches
and other sessions' processes/devices were left alone. The report retains
1,064 verified evidence files and their SHA-256 inventory; no app or xcresult
build product is committed. Data-volume free space after cleanup was
203,879,546,880 bytes.

## Round 1 — review corrections (2026-10-01)

Apartment Mac mini; same lane/branch; local candidate only. Round 0's timings,
three-launch binding, same-export claim and post-hash crash detection remain
accepted evidence. This round addresses the seven review findings without
changing the engine, package versions, wasm budget or simulator ownership scope.

### Corrections

1. **Audited plugin implementation, not name.** The exclusion gate checks the
   plugin's resolved entry, exact version and registry provenance, plus a content
   digest of its resolved implementation closure: source and helper files, lazy
   literal imports, package resolution manifests and missing optional imports.
   The pins cover the installed workspace and npm starter variants; changing a
   pin requires re-auditing config/native reads. Forks, aliases, git/path installs,
   unrecognized versions and changed implementation bytes keep application JS
   and the full sanitized native environment in the key. The positive control
   proves stock implementations still exclude JS; the installed git-fork control
   consumes `src/native-mode.js` into `NXNativeMode` and must rebuild on its edit.
2. **Exact resources.** Native bases and overlays record their Metro resource
   sets. Each overlay removes the recorded prior set, including empty
   directories, before installing current native assets; the main HBC appears
   only as `main.jsbundle`, matching native embed. Export-only worker HBCs are
   omitted, as they are by Expo 57 native embed. The native graph refuses resources
   named `assets` or `_expo`, reserving those namespaces for Metro. Fresh Xcode embeds also clear
   old Metro output. Changes outside that set are rejected, including deletion
   of configuration files. Native bytes and the existing export/hash checks stay
   bound. Resource-removal controls compare against the raw fresh Xcode product,
   before its own overlay can conceal a retained asset.
3. **Explicit skips.** Only named simulator-list, missing-runtime/device-type,
   create and boot conditions can produce an environment skip. Invalid JSON,
   ownership-record failures, interrupts and later product/lease/proof failures
   remain nonzero. Rust checks interruption even after a simctl child has exited and before
   reporting spawn/poll failures.
   Creation returns its identity before cancellation so the newly created
   simulator can be recorded and deleted. Failed ownership writes roll back
   creation; a failed rollback names the exact UDID and fails loudly. Failed boot
   also deletes this invocation's new device and removes its ownership record.
4. **Config references.** The key hashes files named by static config even when
   they are otherwise excluded application JS. Absolute, parent-traversing and
   file-URL paths are refused for export caching. `react-native.config.mjs` and
   the other dynamic native-config forms refuse through the preparation adapter.
5. **Cold progress.** Before Xcode, the terminal prints `native-cache miss`, its
   reason (the changed input where known), the approximate three-to-four-minute
   Release build cost and `SNAPBACK4_NATIVE_SMOKE=off`.
6. **Bounded evidence.** The driver removes per-run preparation temporaries,
   `.app` copies and xcresults after collection, on success and failure. It also
   removes simulator-side staging. The wrapper keeps five completed runs' full
   evidence, compresses older receipts, records removed media/logs, and leaves
   active runs alone. A warm preparation receipt references the immutable native
   producer receipt by hash instead of copying the complete native closure on
   every run. The current native base and its bounded build workspace remain.
7. **Cancellation.** The asynchronous export wrapper forwards SIGINT/SIGTERM,
   waits for the driver's bounded cleanup and returns 130/143. Both unit and
   real installed-run controls exercise forwarding and cleanup. No PID is killed
   by name or pattern.

### Measurements and controls

All durations below are complete `npm run export:ios` wall time, in seconds.

| Starter | Cold | Five JS-only warm runs | Warm median | Remove asset require (hit) |
|---|---:|---|---:|---:|
| plain | 164.037 | 18.234, 17.700, 18.549, 18.041, 18.022 | **18.041** | 19.206 |
| social | 232.024 | 24.066, 23.060, 23.387, 25.033, 23.663 | **23.663** | 25.815 |

Both medians meet the **25 s** target. Social warm sample 4 is 25.033 s and
its separate asset-removal control is 25.815 s; neither is omitted.
The final fresh comparators reuse the preceding export byte-for-byte and pass:
plain has **100 complete app topology entries / 0 Metro resource entries** after
removal; social has **126 / 26**. The comparison checks each Metro entry's bytes,
mode and type, plus every app path/type, against the raw fresh Xcode product
before overlay. Full inventories and exact export hashes are in the
[plain](round1/plain-final-resource-comparison.json) and
[social](round1/social-final-resource-comparison.json) comparison records.
Fresh comparator driver times are 160.350 / 211.346 s, excluding a second Metro
export. Final warm receipts are about **38 KB plain / 60 KB social raw**; their
immutable native producer references also verify after receipt compression.

| Control | Plain | Social |
|---|---|---|
| Git-installed plugin fork | `expo-status-bar`: first/second both miss, plist changes first → second (99.007 / 97.197 s) | `expo-secure-store`: first/second both miss, plist changes first → second (167.714 / 142.156 s) |
| Absolute `ios.googleServicesFile`, before/after replacing bytes | Both refuse, exit 1, `E_WITNESS_NATIVE_COMPAT` (6.310 / 6.040 s) | Both refuse, exit 1, `E_WITNESS_NATIVE_COMPAT` (7.172 / 6.502 s) |
| SIGINT during real simulator creation/selection | Exit 130; created device and record absent (4.524 s) | Exit 130; created device and record absent (5.023 s) |
| SIGTERM after real app launch | Exit 143; app stopped, backend port released, temporary copies absent (13.433 s) | Same checks pass (17.098 s) |
| Startup throw | Cache hit; exit 1, `E_WITNESS_STEP` (14.040 s) | Cache hit; exit 1, `E_WITNESS_STEP` (16.113 s) |
| Missing runtime | Explicit `missing-runtime` skip; wrapper 0 / receipt 1 (3.766 s) | Same (4.363 s) |
| Opt-out | Export succeeds, no native receipt (3.215 s) | Same (3.663 s) |

Both startup-failure receipts and device logs contain the intended
`NX_R1_STARTUP_THROW`. The fork's second miss explicitly names
`src/native-mode.js` before Xcode starts. Rust integration controls additionally
exercise exited-child interruption, invalid simulator JSON, failed owner writes
and failed deletion; preparation tests refuse `react-native.config.mjs`.
The [plugin audit summary](round1/plugin-audit-summary.json) records every audited
version, resolved entry and closure digest; the content pins are in the source.


Cold means this starter's native cache, Pods and DerivedData were removed;
npm dependencies and shared Metro/system caches remained. The five warm runs
make distinct JS-only edits; each checks a cache hit, three passing lifecycle
segments and equality of exported and loaded HBC hashes. Final warm samples run
without this lane's other builds or tests. Controls run under their own labels;
none replaces a failed timing sample. The report's `measured-source.json` binds
the measured CLI and adapter/wrapper bytes; `final-source.json` binds the final
source. No publication, physical-device, M6/M8 or nonempty application-scenario
claim is made.

### Verification and failures

- **Affected checks:** 69/69 JavaScript cases in `affected-final.log`, followed
  by 11/11 final export controls after the resource correction; Rust witness
  units 14/14. The full suite's witness target passes 51/51. The separate
  parallel witness run's port-contention failure and isolated 1/1 pass remain
  recorded below. No assertion or hang budget was weakened.
- **Guide:** 110/110 in the complete suite; the earlier whole-guide run also
  passed 110/110. Final documentation budget and reference checks: budget passes; `ref-check` passes with 525 LLP docs, 10,181 refs,
  0 errors and 0 unchecked references (`ref-check-final.log`).
- **`scripts/test.sh`, exactly once:** exit 1, exact final summary
  **`== 1 failure(s) in 2530 s`**, category `client tests`. Rust: 4,566 passed,
  33 ignored across 994 target/shard summaries. Client pool: 5,758 passed,
  1 failed, 5 skipped. Final model slot: 79/79, with unchanged seed counts.
  The full suite and phase timings are retained in `round1/full-suite.log` and
  `round1/suite-summary.json`. The complete suite still exceeds the repository's
  60-second goal; this round does not change that suite or reduce its counts.
- **Wasm:** **2,014,420 B raw / 604,666 B gzip**, unchanged cap **605,225 B**;
  **559 B** headroom. Both the dedicated build and the complete suite record
  the same values. No core/runtime or wasm-budget source changed.

The five client skips require external pinned managed-auth, identity-profile,
0.2.27 bounds, 0.2.33 F2 legacy and 0.2.32 legacy-server fixtures. Their exact
conditions are retained in the suite summary; no coverage is claimed for them.

Development failures, attributed to this lane and corrected:

- The first setup invocation exported before generating the plain starter's
  `snapback/generated/api.ts`; Expo correctly failed module resolution. Running
  the scaffold's prescribed `check` fixed setup. Its original log and driver
  error are retained as `plain-dev-*`.
- Four initial `init-recipe.test.mjs` cases ran before the debug CLI existed:
  retired Following options, removed search recipe, CCP Expo transitions and
  CCP web transitions. Their subprocess statuses were null. After the debug
  build, all four pass within the affected 68-test cohort. These were setup
  sequencing failures, not baseline product failures.
- The first fingerprint fixture had an invalid placeholder lockfile; the empty
  plugin case now needs no plugin registry check. The first audited-plugin
  positive fixture then exposed missing lazy helper/resolution metadata in the
  draft pin capture. The final content closure includes these files and package
  manifests, and its positive/fork controls pass. Original failing logs remain.
- A few shell setup commands used the wrong working-directory prefix, and an
  initial Cargo unit invocation selected a nonexistent library target. These
  invocation errors are ours; corrected commands and results are retained.

- **Ours, resource-control failure:** the first raw fresh-Xcode comparison found
  an extra `_expo/static/js/ios/web-worker-entry-…hbc` and its parent directories
  in the overlay. Expo 57 native embed saves only its first JS artifact and native
  assets. The overlay now follows that policy; a regression assertion rejects the
  extra resource, and the final full app topology / Metro-byte comparisons use
  the exact same saved export. The original failing comparison remains under
  `pre-resource-fix/`. That earlier cohort is not the final performance claim.
- **Environmental, with our overlapping test scheduling:** the final parallel
  Rust witness rerun passed 50/51;
  `driver::cli_cold_start_and_relaunch_capture_real_backend_refusal_and_bound_artifacts`
  encountered `E_WITNESS_PORT` after probing a free loopback port. The driver
  refused the occupied port and stopped no existing owner. The full suite's
  serial witness target passes 51/51. The isolated unchanged case
  passes 1/1 in `rust-port-isolated.log`; no port assertion or ownership check
  was removed.

**Every complete-suite failure (one, baseline):**
`47 transient: local.ts:850 follow`, in `delivery-fault-matrix.test.mjs:264`,
failed `the classified await must actually experience an injected fault`
(`injected === 0`). The local client and all delivery-fault fixtures/instrumentation
match base `bfe1d7d722` byte-for-byte; the hash ledger records this. The isolated
site passes 2/2 including classification. That retry does not turn the original
suite green. [The open follow-up](../../../issues/20261001-snapback4-delivery-fault-follow-injection-flake.md)
asks for deterministic fault-arm ordering while retaining every assertion.
There were no other complete-suite failures.

The initial plain pilot, intermediate and pre-resource-fix cohorts are separately
labelled under `pilot/`, `intermediate/` and `pre-resource-fix/`; they are excluded
from final medians.
They motivated smaller warm receipts and tighter rejection of unexpected
resource/configuration deletion. Their summaries, run receipts and retention
records remain; no failed sample is silently retried into the final cohort.

### Ownership, cleanup and reproduction

The one normal simulator, `32D542F3-2E9E-4555-813D-2032D6243478`, was shut down
and deleted only after validating this tool's exact creation record. Its record
was removed. Both final selection-cancellation devices and both earlier selection
controls were already deleted; the final simulator list confirms all five IDs
are absent. No unowned simulator, including `mini-verify-iphone`, was targeted;
no system setting was changed. [Cleanup commands and ownership hash](round1/cleanup.json)
record the exact actions.

Retention was verified over **43 plain / 35 social completed runs**, including
the exploratory cohorts: **five full-evidence runs each**, **zero per-run app
copies**, **zero private preparation directories**. All **370 receipt files**
and the last five runs' complete evidence for each starter were archived with
byte verification; the archive indexes reference already captured receipts by
hash to avoid duplicate copies. See [the archive summary](round1/retained-evidence/summary.json)
and its per-starter indexes. The generated `target/nx` projects and private
native workspaces were then removed. Ordinary compiler/dependency caches remain
for subsequent work. The cold native producer receipts are substantial; ordinary
warm runs now add only their compact receipt plus the bounded media window.

Run the retained `resource-controls.mjs`, `interrupt.mjs` and `confirm-warm.mjs`
from `snapback4/`
after generating/installing both candidates, running `check`, and overlaying
local sources/client/wasm/XCFramework with the round-0 `setup-candidates.py`.
The fixed `target/nx/timing-cli` copy prevents a concurrent local CLI rebuild
from changing a cohort's executable. `run.mjs` records complete command wall
latency, status, cache decision, hashes, resources and compressed receipts/logs;
resource comparisons and fork provenance are separate JSON records. The fresh
resource comparator calls the same native driver directly with the saved `dist`,
so it cannot change the export by running Metro again; its command is recorded.
The final `confirmed-*` cohort runs only after verification drains. Final
metric prose and self-contained PNG fixture initialization were completed after
measurement; the native adapter, witness driver and wrapper bytes are unchanged
from the measured source manifest. The suite
runner refuses to overwrite its log and records one invocation and its PID.
Nothing is pushed or published. The local commit carries
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.


## Round 2 — effective native configuration and crash recovery (2026-10-01)

Round-1 input was `5d5604a7f5`: Astra **NOT READY**, Grok **READY WITH CHANGES**.
Their accepted resource/config-reference, progress, completed-run retention and
18.041 / 23.663 s measurements remain historical evidence above. This round
replaces the plugin implementation-import audit and addresses the six lifecycle,
retention and URL findings. Nothing is pushed or published.

### Effective configuration and unobserved native writers

The key now contains the actual iOS result of Expo 57.0.22's
`getPrebuildConfigAsync`, followed by `compileModsAsync` introspection: full
serializable evaluated config plus iOS mod results. Expo resolves explicit,
auto-applied and legacy plugins, including project-relative shadows. Every
fingerprint uses a fresh Node child with the native preparation environment.
The pinned `@expo/fingerprint` 0.20.13 remains cold-build provenance; its installed
config loader uses `expo/config.getConfig` without prebuild defaults or deferred
mod evaluation, so it does not alone answer this round's question.

The static `require()` walk and `plugin-audit` files are deleted. Registered
native-file writers use a separate, narrow audited allowlist: actual runtime
registration paths, complete shipped package-tree digests, and the complete
installed dependency snapshots of the audited starters. The last check reuses
the existing inventory and closes changed external helpers without a static
import walk. Unknown
registrations, changed package bytes and untracked `config.mods` assignments keep
application JS and the sanitized environment in the key. This includes unknown
introspective callbacks, since a callback can write files outside its mod result.
The evaluated output still binds in every case. This is a bounded starter
adapter, not a plugin sandbox or a promise to support arbitrary native projects.

[The native-mod audit](round2/native-mod-audit.md) names each non-introspective
stock writer and its inputs. Both stock starters have no unknown registrations;
plain and social therefore retain the JS-only reuse path. Expo's default icon
and Xcode writers, the Snapback scene AppDelegate writer, dev-launcher's fixed
Release plist cleanup, and social Router's fixed Podfile flag are audited.
Changed or unknown writers deliberately pay a native rebuild on every JS edit.

### Lifecycle and retention changes

- Creation runs in its own process group. Success, nonzero exit and timeout all
  preserve stdout; a printed UUID is recorded and rolled back before reporting.
  Create timeouts fail, never skip. Ctrl-C reaches the driver while creation can
  finish reporting its identity. Failed exclusive ownership writes remove their
  partial file.
- The UDID lease is acquired before publishing a creation record and held
  through boot, execution and cleanup. `ready: false` records cannot be reused;
  only successful bootstatus makes them ready. Explicit and automatic selection
  take the same lease, and reuse rechecks the record under it. Rollback holds the
  lease through deletion. The simulator-home lease remains in force.
- Each export holds a run lease and persists driver, wrapper, app and child PID
  **and process start time**. Next-run recovery checks liveness and birth time,
  acquires the leases, stops only recorded matching processes, shuts down a
  matching tool-owned device, and removes app copies, xcresult and temporaries.
  A dead wrapper's live driver first gets a chance to clean up. A reused PID
  neither keeps the old run alive nor authorizes signaling a new process.
  Legacy incomplete directories without a birth record cannot authorize process
  or device cleanup; this round does not infer ownership from a filename.
- One kernel lock serializes recovery/pruning, including temporary compression
  files. Five completed runs keep full evidence, twenty more keep compressed
  receipts, and older completed directories are removed. The active native
  producer receipt is copied alongside the current base in the bounded native cache.
  Pruning errors warn without changing an export's smoke result.
- Every capitalization of the `file` URL scheme refuses out-of-tree config.

The shared simulator-driver controls run against two fake-simctl processes on
this mini; the installed Expo, crash-recovery and negative controls run through
each starter. Raw commands, logs, process identities and compressed native
receipts live under [round2/](round2/).

### Final measurements on this mini

| Starter | Cold command | Five warm commands, in order | Warm median |
|---|---:|---|---:|
| plain | 258.715 s | 18.416, 18.458, 18.206, 17.762, 18.667 s | **18.416 s** |
| social | 291.288 s | 24.367, 24.935, 23.591, 24.894, 24.302 s | **24.367 s** |

Both medians meet **≤25 s**, and all ten individual warm samples are below 25 s.
Every warm run is a cache hit, loads a distinct exact export hash, and passes
prime/offline/restart. These are complete `npm run export:ios` wall times,
including export, preparation, native proof and wrapper retention; evidence
archiving after command completion is outside the timer.

The cohort ran serially after the complete suite, production compilation and
native controls had drained. Cold deletes that starter's `.snapback4-witness`
(native base, snapshot, Pods and DerivedData); npm dependencies and shared
Metro/system caches were already present. The normal recorded simulator was
already booted. The unused recovery simulator was shut down under both leases
before this cohort. No system settings or unrelated processes were changed.
No sample was dropped or retried.

Fresh-process effective-config evaluation, measured separately with one untimed
warm-up and five samples, has a **177.471 ms plain / 222.479 ms social** median
per evaluation (`*-effective-cost.json`). This includes resolving Expo, running
prebuild config and introspection, and checking registered package trees. The
whole command figures above include the complete dependency-snapshot audit and
all invocations; the microbenchmark is not presented as total command overhead.
The dependency audit reuses the required inventory rather than rereading it on
the stock warm path. Neither stock starter falls back to retaining application JS.
Changing an external image-utils helper revokes the audit in both starters,
retains JS, and restoring its bytes restores the exact key.

`final-source.json` binds the measured executable and adapter/driver/wrapper
sources. Installed plugin controls began with the earlier round-2 executable
(`controls-source.json`, with its adapter saved in `control-adapter-source/`).
Subsequent hardening removes the generic-helper filename exemption, requires
explicit boot-ready records and valid printed UUIDs, and binds the native-writer
audits to the whole dependency snapshot. Focused tests exercise that final
hardening. `final-structural.json` rechecks both real starter shadows and both
auto plugins using the final adapter: dependency audits remain valid and
application source is excluded, yet evaluated native values and keys change.
The final cohort and social recovery use the final executable. Metric prose in
the guide/report/LLP is updated after measurement; measured witness/adapter and
wrapper bytes remain unchanged.

### Installed plugin controls

| Starter | Control | First run | After source edit | Result |
|---|---|---:|---:|---|
| plain | shadow | 416.881 s | 105.327 s | miss; shadow-second |
| plain | auto | 112.133 s | 118.159 s | miss; auto-second |
| plain | dangerous | 106.365 s | 112.050 s | miss; JS retained |
| social | shadow | 394.915 s | 253.461 s | miss; shadow-second |
| social | auto | 160.203 s | 157.870 s | miss; auto-second |
| social | dangerous | 160.023 s | 157.371 s | miss; JS retained |

Both source-reading controls changed the installed `NXNativeMode` Info.plist value, and all twelve runs passed prime/offline/restart with the exact exported HBC hash. Their second pure-plugin runs miss because **effective configuration changed**. The dangerous-mod second runs miss on `src/native-mode.js`; they do not pretend that introspection evaluated the dangerous callback. These are functional native-build controls, run alongside suite work, not the final stock timing cohort. The initial plain run also fetched Hermes archives. All first and second durations remain in the record.


### Verification and every failure

The complete `scripts/test.sh` ran **once**, with pinned Node 24.18.0 and
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`. Its exact summary is:

```
== 1 failure(s) in 3501 s
   client tests
```

**Baseline client/oracle failure, observed under contention:**
`mixed evidence schedule wasm: 300 independent histories`, at
`packages/snapback4/test/mixed-evidence-oracle.test.mjs:42:41`, hit its existing
1,800,000 ms guard (reported duration 1,800,125.009 ms). The process-host case
passed all 300 histories in 185.856 s. The wasm backend stopped at the guard,
but its Node worker retained open handles. After retaining the failure and
verifying PID 57834, its parent and start time, the lane sent SIGTERM to that
exact owned worker so the canonical script could finish collecting results and
run its final models. This is recorded in `suite-timeout-cleanup.json`; no test,
seed count or guard was changed, and the original run was not retried into green.
The client pool reports **5,759 pass / 0 fail / 1 cancelled / 5 fixture skips**;
the timed-out cancellation makes the client step fail. All **79/79** final model
tests pass. There are no other complete-suite failures; the previously ticketed
delivery-fault injection flake did not recur.

The client/oracle and its generation/notification helpers match round-1 base
`5d5604a7f5` byte-for-byte (`baseline-client-inputs.json`). Round 1 passed this
wasm oracle in 165.328 s. Earlier client work overlapped native control builds;
that scheduling is ours and may have exposed the existing race. The exact cause
is unresolved. [The new filesystem follow-up](../../../issues/20261001-snapback4-mixed-evidence-wasm-timeout.md)
keeps the timeout and asks for a pending-operation diagnosis and complete timeout
teardown, with all 300 histories and assertions retained. The isolated unchanged
wasm-case log is `round2/oracle-isolated.log`; its result is recorded below.

Affected checks: JavaScript **72/72**, final export/config/pruning checks
**12/12**, witness Rust units **17/17**, canonical witness integration
**53/53**, and the whole guide **110/110**. The latest UUID/boot hardening also
passes its focused create controls **3/3** and boot controls **2/2**.
The structural tests use Expo's real resolver and introspected deferred plist
mods; they cover helper filenames and direct untracked `config.mods` assignments.
Four concurrent pruners over 35 completed fixtures keep exactly five full and
twenty compressed runs, with no ENOENT. A forced cleanup-command failure keeps a
successful smoke result successful. Partial ownership writes remove their file;
reused-PID and held-lease recovery controls preserve live owners.

Wasm: **2,014,420 B raw / 604,666 B gzip**, **559 B below** the unchanged
**605,225 B** cap. No engine, contract, delivery-fault test, seed count or wasm
budget is changed by this lane.

[Every development failure](round2/development-failures.md) is retained and
classified separately: the first shadow fixture used the wrong Expo plugin
shape; one recovery setup attempt used the wrong prefix and was correctly
refused by the active device lease; early command/path/scaffold invocation
errors were ours. All corrected affected controls pass. Expected negative
controls retain their failures as evidence rather than successful native proofs.

The isolated unchanged wasm oracle then passed **300/300 histories** in
**176.905 s**, with its original 1,800 s guard and no concurrent native builds.
This supports treating the complete-suite red as an existing timing/cleanup
failure; it does not identify the race or make the original suite green.


### Control outcomes, custody and reproduction

Both starters pass startup-throw classification (exit 1, cache hit, prime fails),
uppercase `FILE://` and mixed-case `File://` refusal (exit 1,
`E_WITNESS_NATIVE_COMPAT`), missing-runtime skip (wrapper 0 with an environment
receipt whose native exit is 1), and explicit opt-out (wrapper 0, no native
receipt). The mixed-case installed controls use `mixedcase-url` filenames after
fixing the Mac case-alias harness failure; their final logs/JSON are separate
from the retained original uppercase runs. Neither failure is relabeled a
successful native proof. All final config controls confirm output-driven misses
while source remains excluded in the audited stock dependency environment.

The two-process boot race, create timeout/failure after a printed UUID, and
process-group Ctrl-C during create are shared Rust driver controls before the
starter build stage. They verify the pending record cannot be leased/reused by
B, deletion waits for custody, every printed creation identity is rolled back,
and create timeout/cancellation never becomes an environment skip. Installed
SIGKILL controls run twice per starter: wrapper-only death, then simultaneous
wrapper/driver death to bypass Rust Drop. All four next runs recover, remove
bulk files, stop recorded app/backend/child processes, shut down the old owned
device and pass smoke. PID-reuse and active-lease regressions are separate unit
controls, not assumptions made from the real process runs.

Retention over the real workload leaves **22 plain / 21 social** completed runs:
**five full runs each**, **17 / 16 compressed sets**, **zero temporary app copies**
and **zero private preparation directories**. All **338 receipt files** and the
remaining full evidence are archived with byte verification; indexes reuse
already captured files by SHA-256 instead of duplicating them. The independent
35-run/four-pruner control crosses the cap and proves **5 full + 20 compressed**.
See `round2/retained-evidence/summary.json` and its per-starter indexes.

All **six real simulators created and recorded by this round** are absent after
cleanup. `round2/cleanup.json` records exact IDs, ownership hashes, held leases
and every scoped command; `precohort-shutdown.json` records the earlier shutdown
of the unused recovery device. No unowned simulator, including
`mini-verify-iphone`, was targeted. No system settings were changed. Only owned
PIDs were stopped, including the explicitly documented timed-out suite worker.

To reproduce, copy the harness into a fresh report directory and update its
report constant; saved evidence deliberately refuses overwrite. From
`snapback4/`, scaffold/install/check both candidates, overlay
local package/client/wasm/XCFramework inputs with the retained round-0 setup
script, and build the packaged production CLI policy. Freeze the candidate
executable (`NX_BIN`) before controls. `plugin-controls.mjs` performs twelve
real native runs; `recovery-controls.mjs` uses a disjoint owned simulator prefix;
`cohort.mjs` deletes each native cache and records one cold plus five distinct
warm exports. `effective-cost.mjs`, `dependency-control.mjs`,
`final-structural.mjs`, `negative-controls.mjs` and the separately retained
`mixedcase-controls.mjs` cover the final rule and refusal paths. The control
runner refuses existing result/log names, preserving every first attempt.
The full-suite runner opens its log exclusively and records exactly one
invocation; `oracle-isolated.py` is a named single-case follow-up, not another
complete suite. `archive.py` verifies retained bytes before `cleanup.py` removes
exact recorded devices. Generated `target/nx` candidates/native workspaces are
removed after archival; ordinary compiler/dependency caches remain.

LLP 3000.030 §15 and the guide describe the resulting rule and measured cost;
one journal entry records this round. Nothing is pushed or published. The local
commit carries `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.


## Round 3 — honest-project correctness and verified crash cleanup (2026-10-02)

Input commit is `5d29493e1b`. Both round-2 reviews were **NOT READY**. The operator
keeps per-export evaluation and defines this cache as a correctness optimization
for **honest projects**, not a sandbox: a config plugin already runs arbitrary
code during prebuild. Deliberately hidden registration stacks and forged result
lines are outside this threat model. Evaluation now returns through a dedicated
parent-provided descriptor, independently of stdout or `beforeExit` logging.
This revision is not labeled reviewer-approved. Nothing is pushed or published.

### Findings and detecting controls

| Finding | Round-3 change and evidence |
|---|---|
| Different config/prebuild filesystem state | Every resolved project-local plugin retains application JS, even if its evaluated result omits a native value because `ios/` does not yet exist. Both starters' real builds with `plugins/x.js` read `src/native-mode.js` only after the template exists; source edits miss and change the installed `NXNativeMode` from first to second. |
| Every local path spelling | Expo's real resolver records the resolved plugin file independently of registration stacks. `./x.js`, `plugins/x.js`, bare project shadows and auto plugins are conservative; only audited files within `node_modules` can drop JS. Existing full-build refusals for unsupported dot-relative shapes remain. |
| Remote native resources | Static and evaluated URI resources refuse with `E_WITNESS_NATIVE_COMPAT`; HTTP, mixed-case HTTP, data and FTP controls detect this. Both installed starter wrappers refuse the remote-icon control before native build/proof. The bounded adapter conservatively refuses other URI-valued config too. |
| Image toolchain | Fingerprint and preparation both pin `EXPO_IMAGE_UTILS_NO_SHARP=1`; real config evaluation and preparation command-boundary controls detect removal of either pin. A global sharp-cli cannot select a different image implementation. |
| Late config.mods assignment | Check tracked identities again after `compileModsAsync`; both starters' real Expo introspection marks a mod assigned by an Info.plist callback as unobserved. |
| Preparation descendants | A persistent group leader gates worker start on a durable group/start-time journal, then remains alive after worker exit. Recovery verifies that anchor, repeatedly inspects/signals matching members and waits for full drain before removing output or allowing reuse. Missing/reused anchors with live members refuse. Units and both real wrapper controls drain TERM-resistant preparation children and verify heartbeat cessation. |
| Driver-only death | A wrapper hint no longer writes completion. Both genuine wrappers survive SIGKILL of only their driver; recovery stops the recorded backend/app, removes bulk output and writes completion only after cleanup. The next export succeeds. |
| Concurrent wrappers | Each run exports privately; Darwin's atomic directory exchange publishes complete `dist/` only after the result. On both starters A and B export distinct bundles; B refuses custody while A is paused, and A's loaded hash and visible dist hash equal A's private export. |
| Buffered simulator create | Reconcile the exact journaled creation name/runtime plus tool prefix against simctl's listing; prefix alone is insufficient. Both starters create a real tool-owned device through a boundary shim that buffers its UUID, then lose the driver to SIGKILL. The surviving wrapper stops the recorded create process, discovers and deletes that exact device despite empty stdout. A same-prefix unrecorded fake device is preserved by the separate driver control. |

`round3/config-controls.json`, `*-lifecycle-controls.json`, raw command logs,
compressed evidence and `final-source.json` bind these observations. The group
control substitutes only the preparation command with a resistant child; it does
not fabricate a native proof. The buffered-create shim calls real simctl create,
then withholds stdout. Stock config evaluation still runs in a fresh child on
every fingerprint (twice per warm export), using the actual Expo resolver and
deferred mod compilation. Stock writers and dependency snapshots remain audited;
[the dependency delta audit](round3/dependency-audit.md) records every changed
installed path and the two additional no-op/static stock plugin audits.

### Final measurements on this mini

| Starter | Cold command | Five warm commands, in order | Warm median |
|---|---:|---|---:|
| plain | 174.512 s | 15.845, 15.760, 15.820, 15.678, 16.268 s | **15.820 s** |
| social | 229.510 s | 21.161, 21.026, 20.718, 21.073, 21.619 s | **21.073 s** |

All measurements are complete `npm run export:ios` wall times through proof,
atomic output publication and wrapper cleanup. Every warm run is a cache
hit with a distinct exact loaded export and all three smoke segments passing.
The declared cohort runs after controls and the complete suite drain; no sample
is discarded or substituted. Cold removes the native cache, snapshot, Pods and
DerivedData. Npm dependencies and Metro/system caches are already installed;
the cohort reuses an already booted, tool-owned simulator.
Only the six existing checksum-verified React Native/Hermes download archives
are seeded into the new private home before timing (download-seeds.json).
This avoids repeating the separately retained network failure; it does not reuse
a native build. A temporary command-scoped caffeinate assertion prevents idle
sleep during long batches; it changes no system setting and ends with the batch.

Fresh-process effective-config evaluation medians are **167.000 ms plain / 218.476 ms social per call**, after one warmup and five recorded samples each. Two calls per warm export cost approximately 0.334 / 0.437 s. Evaluation remains mandatory on every export.

### Verification and failures

The canonical `scripts/test.sh` ran **once** on the final implementation with
Node 24.18.0 and `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`. Exact summary:

```
== 0 failure(s) in 2174 s
```

No failures in that final canonical run. Its client pool reports **5,761 passed,
zero failed/cancelled and five fixture skips**; final serial models pass **79/79**.
The round-2 mixed-evidence timeout does not recur: process 300/300 takes 184.562 s
and wasm 300/300 takes 165.045 s, with unchanged counts and guard. This pass does
not resolve the earlier intermittent failure's cause or close its existing ticket.
Canonical witness integration is **53/53**, guide **110/110**. Affected JavaScript
checks pass **50/50**, witness Rust units **18/18**, and the four-mode creation
integration and corrected namespace control each pass. Documentation budget and
reference checks pass. `full-suite-status.json` records one invocation.
Source, documentation and harness whitespace checks pass. A check including
verbatim command logs flags only their original trailing whitespace/blank EOF
lines; those raw bytes are intentionally preserved (`round3/diff-check.json`).

Wasm remains **2,014,420 B raw / 604,666 B gzip**, **559 B below** the unchanged
605,225 B cap; `wasm.json` records the actual artifact digest. No core/contract or
budget source changed.

[Every development failure](round3/development-failures.md) is preserved and
classified: the old completion-hint fixture, a wrong-cwd command, the baseline
concurrent-namespace fixture's invalid UUID (fixed), an empty-PID-file timing
race under a noncanonical parallel test invocation, the Maven connection reset
and the harness's assumption that failed first export creates dist, and two
Xcode timeouts overlapping recorded host sleep. Corrected controls keep their
original failures and separate retry names. Expected crash/remote-icon/lease
refusals are negative controls, not successful native proofs. Runtime limits,
engine/contract sources, model counts and the wasm budget remain unchanged.

| Earlier failure or harness error | Classification and disposition |
|---|---|
| Retention fixture: 12 passed / 1 failed | **Ours.** Old fixture treated the wrapper hint as completion; changed it to a finalized receipt. Final affected checks pass 50/50. |
| First Rust unit command used the wrong redirection directory | **Ours.** Shell refused before Cargo started; corrected invocation passes 18/18. |
| Concurrent namespace fixture used `another-simulator` without ownership | **Baseline, fixed.** Reproduced under parallel and canonical serial threads; removed the invalid override and retained the contention assertions. Final integration passes 53/53. |
| Startup-timeout fixture read a newly created empty PID file | **Baseline race, exposed by our noncanonical parallel invocation.** Serial and final canonical runs pass; no assertion or guard changed. |
| Initial plain dependency download failed with curl 56 after 351.517 s in pods | **Environmental.** Maven reset the connection. Later runs preseed only verified download archives; final cold native caches remain empty. |
| Harness then tried to read missing dist after that failed first export | **Ours.** Failed exports correctly do not publish dist; runner now allows its absence and preserves the failure. |
| Plain ios-context-second and retry1 failed at 1,200.097 s and 974.101 s | **Environmental.** Recorded host sleep overlaps Xcode deadlines. Both attempts remain; a separately named retry passes. No deadline or persistent system setting changed. |
| Initial lifecycle harness changed PATH and caused rebuilds | **Ours.** Reuse the recorded PATH for final controls; keep the initial timings/logs. |
| Initial live-child shim had malformed nested Python quotes | **Ours.** Driver never started; retain the syntax error and empty unstarted directory. Corrected `-final` controls pass on both starters. |

Archived and SHA-256-verified every retained file and 371 receipt files across 23 plain / 17 social completed runs. Each starter retains five full runs and at most twenty compressed runs, with zero temporary apps or preparation directories. The malformed development shim never started a driver; its directory contains only an empty run.lock and is recorded separately in retained-evidence/unstarted-runs.json, without inventing completion. Cleanup deleted 6 exact journaled, ownership-verified devices under both leases; the two buffered-create devices had already been rolled back. All recorded round-3 devices are absent afterward. No unowned simulator (including mini-verify-iphone), system setting or unrelated process was touched. Generated candidates and ordinary native/dependency caches remain locally for review; per-run bulk artifacts are cleaned.

LLP 3000.030 §15 and the witness guide carry the honest-project boundary and
new custody rules. One append-only journal entry records this round. The local
commit carries `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`; no push,
publication, physical-device or application-scenario claim is made.


## Round 4 — wrapper custody through verified publication (2026-10-02)

Input: slim branch `sb4-np/nx-export-proves-native-slim`, commit `fb9c037bd4`.
The original branch is not used or merged. Astra's round-3 verdict was NOT READY
with one P1: pruning after driver exit could delete the live wrapper's export,
including through its atomic rename into dist. Grok supplied no round-3 verdict.
This round fixes that custody gap under the unchanged honest-project threat
model; it does not claim independent reviewer approval.

### Fix and observable publication semantics

The Node wrapper opens `export.lock` before creating its private export. A small
Rust helper takes an exclusive kernel flock on an inherited duplicate of that
open file description. Node keeps the descriptor until publication, verification
and private/displaced-tree removal finish. Its CLI shim forwards the descriptor
to the publisher; the publisher keeps it even if Node is killed mid-publication.
No PID record substitutes for this lease. Exit closes descriptors and releases
custody automatically. The driver retains its separate `run.lock`.

Recovery still drains a dead driver's recorded children and matching app/device
under the existing birth identities and simulator leases. While `export.lock`
is held, it leaves the journal and bulk export unchanged and writes no completion.
Pruning must acquire both leases and retain them throughout deletion, including
when an older finalized receipt already exists. Compression retains the lease
inode and now retains `publication.json` as a compressed receipt.

A destination lock under `artifacts/native-smoke/publication.lock` serializes
publishers through exchange, verification and displaced-tree deletion. It lives
under the already-excluded artifact tree, so publication cannot change the native
key. The publisher binds the proof file to the successful smoke receipt's SHA-256,
then compares every exported path, size, hash, mode and type before and after the
atomic rename/exchange. Missing/extra/changed files fail with `E_WITNESS_PROOF`;
they never become an environment skip. `publication.json` records the inventory
and proof hash. An allowed environment skip checks export-only inventory and
records a null native proof hash.

On the native-proof path, with these cooperating writers and cleaners, **dist is never half-replaced or
temporarily absent during replacement**. An individual path lookup sees the
complete old or complete new directory; first publication switches absent to
complete. This is not a snapshot for readers opening several files across the
switch: they can mix generations. Open file handles keep their bytes, while a
reader holding the displaced directory handle can see entries removed as that
old tree is reclaimed. Outside writes are not prevented; detected inventory
changes fail publication. Another successful publisher can subsequently replace
the output after this one's verification. Explicit opt-out and non-macOS retain
the ordinary Expo output path, which has no atomic-replacement guarantee.

### Detecting regressions

- **Live wrapper / dead driver / five newer completed runs:** the Rust control
  records an actual driver's birth identity, terminates it, and holds the wrapper
  export lease. Cleanup preserves both export bytes and the exact journal and
  writes no completion. It also cannot prune a prematurely finalized record.
  `round4/round3-counterexample.json` runs the retained round-3 binary with a real
  Node-held kernel lease: it returns 0, deletes the export, compresses the journal
  and writes completion. The corrected CLI/Node regression preserves them.
- **Pruning during publication:** a controlled callback in the test build runs
  cleanup before exchange and at the post-exchange/pre-verification boundary of
  the actual publication implementation. All **10,001** current files survive.
  Hash, length, renamed-path and extra-file mutations both before and after
  exchange each fail. `round4/round3-tamper-counterexample.json` also runs the
  actual old/new CLIs: round 3 publishes changed bytes with status 0; round 4
  refuses them with status 1 and `E_WITNESS_PROOF`. Test boundary hooks are absent
  from the shipped CLI.
- **Concurrent publishers, one killed mid-publication:** two subprocess fixtures
  share the real locks and exchange implementation. A pauses after exchange;
  B waits on the destination lock. Kill A, race recovery with B, and require dist
  to equal B's entire recorded inventory, with A recovered and its displaced tree
  pruned. Separate JavaScript controls prove SIGKILL releases Node custody and a
  real publication child retains the descriptor when its Node wrapper dies while
  blocked on the destination lock. These process fixtures exercise custody, not
  a fabricated claim of native smoke.
- The preparation-group test still drains its TERM-resistant descendant with a
  live wrapper, now asserting the journal is unchanged and completion/bulk removal
  wait for the wrapper lease to close. The installed CLI forwarding path is tested.

### Measurements and validation

| Starter | Priming build on final code | One final JS-edit warm export | Cache / segments / publication |
|---|---:|---:|---|
| plain | 89.462 s | **15.805 s** | hit / three passed / 8 inventory entries verified |
| social | 139.918 s | **22.944 s** | hit / three passed / 32 inventory entries verified |

These are full `npm run export:ios` wall times, including export, native smoke,
publication verification and wrapper cleanup. The requested one sample per starter
is below 25 s; it is not a new five-run median. Round 3's five-run warm medians
remain 15.820 / 21.073 s. Final priming rebuilds follow installed wrapper/CLI
changes and removal of the initial misplaced lock; they reuse existing Pods,
DerivedData, dependencies and system caches and are **not cold-build claims**.
Warm runs append a distinct application JS edit. The dependency audit records
only two changed installed paths (wrapper and CLI); their config-plugin behavior
is unchanged, and the audited complete snapshots plus Expo package tree are pinned.
The published and loaded bundle hashes agree for both starters, and each
publication receipt's proof hash equals the successful smoke's recorded proof.
The lane-created simulator is reused; no Simulator.app UI or Metro is opened.
A command-scoped caffeinate assertion ends with each batch.

Affected verification: **23/23 Rust witness units**, **53/53 witness integration**
(serial canonical thread count), and **17/17 JavaScript export tests** pass.
The final suite repeats these affected targets with the corrected lock location.
Reference validation passes: 525 LLP documents, 10,184 refs, zero errors or unchecked.
No engine, client contract, wasm source or budget changes. Wasm's SHA-256 remains
`c2fff10dc870dd371a2dd1f8b31ab9db70ce429bd69b7beba30e0c1229d30d5c`:
**2,014,420 B raw / 604,666 B gzip**, 559 B below the unchanged 605,225 B cap.

The requested single canonical `scripts/test.sh` invocation used Node 24.18.0
and `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`. Exact summary:

```
== 1 failure(s) in 2287 s
```

**Sole failure: introduced documentation-budget regression, now fixed.** The
`cargo test` group reported `snapback4-lang::guide` failing
`client::native_smoke_is_the_milestone_path_with_honest_limits`: my expanded witness
card had 407 lines against its existing 399-line cap. Compacted the new paragraph
to restore 399 lines, preserving the custody and reader semantics; no cap or test
was changed. The affected guide target then passed **110/110** in
`round4/guide-after-budget-fix.log`. The canonical invocation remains recorded as
red and was not rerun. No other suite failure occurred. Its witness integration
passed **53/53**; client pool **5,765 passed, zero failed/cancelled, five fixture
skips**; final serial models **79/79**. Both 300-history mixed-evidence oracles
completed. This does not resolve the older intermittent oracle issue's cause.
The measured publication/recovery code is unchanged by the guide-only compaction.
`round4/full-suite-summary.log`, `full-suite-status.json` and
`full-suite-failures.json` retain the summary, invocation count and classification;
the complete raw log is in the archive index.

Deleted the one device this round created, UDID
`905940BD-8BAE-4C0B-87CB-57D36AA37845`, only after matching its journal and ownership
record and holding both state and simulator-home leases. Confirmed it absent.
No operation targeted `mini-verify-iphone`. Both starters retain five full runs;
plain has twenty compressed runs and social fourteen. No per-run app, xcresult,
preparation directory or export remains. The known round-3 unstarted directory
is preserved without inventing completion.

### Development failures and evidence custody

The initial root-level publication lock caused the first plain warm attempt to
miss its native cache: **96.372 s**, despite a successful exact smoke/publication.
This is our product regression, corrected by locating the lock in the excluded
artifact tree. Its initial **135.929 s** priming build and all raw records remain;
final measurements are separately named `*-final`. Two edit commands used the
wrong cwd and failed before editing; both are recorded in
`round4/development-failures.md`. Expected crash/tampering refusals are negative
controls, not failed native proofs. Full-suite outcomes are classified above.

Only summaries, verdict/timing JSON and small logs are committed. Raw smoke
records, media and every gzip go directly to the content-addressed archive;
`EVIDENCE-ARCHIVE.tsv` records SHA-256, stored byte size and report-relative path.
Each archive write is read back and hash-checked. The final staged blob audit
records the under-15-MB round budget and absence of new oversized/gzip/video blobs.
LLP 3000.030 §15 and the witness guide describe the new custody and reader
semantics; the journal is append-only. Nothing is pushed or published.

## Round 5 — signal status, verified receipts and recoverable publication (2026-10-02)

Continues only `sb4-np/nx-export-proves-native-slim` from `e1adc01ddc`.
No merge from main, push or external publication. The named `mini-verify-iphone`
was never selected, stopped, changed or deleted. Raw evidence follows the same
content-addressed archive and `EVIDENCE-ARCHIVE.tsv` policy.

### Review findings and resolution

- **Astra P1, CLI signal status:** the packaged shim removes its own SIGINT,
  SIGTERM and SIGHUP forwarding listeners before re-raising a child's termination
  signal. A live timer exits 128+N if re-raising does not end the process; a
  platform refusal takes the same numeric fallback. The installed-shim test
  launches a real executable which dies from each signal and inspects the shim's
  own signal/status. This bug **predates lane NX and affects every CLI command**,
  not just export. Resolution for the operator's main-only ticket
  `issues/20261002-snapback4-cli-shim-signal-exit-zero.md`: land this shim change
  and its installed-shim regression, then close that ticket. This branch neither
  imports nor closes the main-only ticket.
- **Astra P1, wrapper publication proof:** success requires `publication.json`
  with this run's source, target, proof SHA-256 and exact inventory, captured
  before publisher launch and bound to the successful smoke receipt. Missing,
  unreadable or mismatched publication receipts fail even when the publisher
  returns zero. Environment-skip publication must also match a freshly captured
  inventory (and null proof hash). Nothing about publication failure is skippable.
- **Astra P2, recorded process identity:** Linux opens a pidfd, binds the birth
  inspection to its fdinfo PID, checks the handle is still live after inspection,
  and sends both termination and escalation through that handle. Missing pidfd
  support refuses recovery instead of falling back to numeric PID signaling.
  Actual parents retain their unreaped Rust/Node child handles. Darwin uses
  verify → SIGSTOP → wait for matching stopped birth → SIGKILL, including
  recovered app instances and preparation group members. A mismatch ends all
  signaling. Tests inject mismatch at each observation, exercise a real wrong
  birth and successful stop, and on Linux exercise wrong-handle identity and
  original-process death/reaping after validation. Group recovery also rechecks
  its leader after taking each member snapshot; a forced leader-exit regression
  proves that loss revokes custody before any member signal. Forced PID-number recycling
  itself was not reproduced.
- **Grok P2, previous export:** durable intent in the run and destination records
  directory identities before exchange. The destination lock covers exchange,
  post-check, receipt creation and old-tree removal. A failed post-check rolls
  back before returning. After attempting publication, the wrapper's `finally`
  never deletes the possibly displaced private tree. A killed publisher's
  pending marker protects that tree from recovery/pruning even under retention
  pressure or a prematurely written completion marker. The next publisher
  acquires the old run's lease and restores the old arrangement before proceeding;
  a verified receipt instead permits completion of old-tree removal. Changed
  inode identities or live wrapper custody refuse with an actionable diagnostic.
- **Grok P3, witness card:** replaces round-2 numbers with the round-5 five-run
  warm medians and explicitly marks social above 25 s; the last actual cold
  measurements remain round 3. The existing 399-line guide cap remains unchanged.

**Darwin residual, precisely:** exit, external reaping and PID reuse between the
first identity check and SIGSTOP can stop an unrelated replacement. The stopped
birth mismatch prevents our SIGKILL, but we cannot safely send that replacement
SIGCONT. After a matching stopped-state check, another actor can kill and reap
the process (or resume it so it exits), then reuse the PID before our numeric
SIGKILL; that final signal can reach the replacement. Stopping prevents self-exit
in that interval, not external interference. There is no absolute PID-reuse
immunity claim on Darwin. Linux signals remain bound to the pidfd even if the
original process exits after verification. See the primary
[pidfd_open](https://man7.org/linux/man-pages/man2/pidfd_open.2.html) and
[pidfd_send_signal](https://man7.org/linux/man-pages/man2/pidfd_send_signal.2.html)
contracts; Darwin still uses the numeric
[kill](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kill.2.html)
interface. LLP 3000.030 §15 records these limits.

**Publication limits:** this is a process-crash recovery contract, not a power-loss
or hostile-filesystem contract. A killed publisher can leave the new tree visible
until the next publisher restores it; the previous tree remains intact at the
recorded private path until verification commits its receipt. Once that receipt
commits, old-tree reclamation is allowed; interruption during reclamation leaves
a verified new export and recovery finishes reclamation. Readers still have the
round-4 namespace guarantee, not
a snapshot across separate opens. A successful later exporter may legitimately
replace the restored export with its own verified generation.

### Regression boundaries

`export-failure.test.mjs` installs the actual package shim in a temporary consumer,
uses the real export wrapper and Rust publisher, and mocks only Expo export and
native smoke. A compiled test-only syscall interposer terminates the Rust
publisher before the actual rename, or after the exchange but before post-check;
a third case mutates the exchanged tree. No production fault-injection switch
was added. The wrapper returns nonzero with a missing-publication diagnostic in
all three cases, and its `finally` preserves the exact old inventory. The killed
cases then apply retention pressure, recover in a second export, fail that
second post-check and verify the original old inventory is restored, before a
third export succeeds. Zero-status publishers with absent/mismatched receipts
also fail, including the allowed native-environment-skip path; a valid skip
publication succeeds. The existing concurrent-writer, descriptor inheritance, SIGKILL lease
release and 10,001-file pruning controls remain in the affected tests.

### Development attempts retained

The first audit-pinning pass omitted the changed Expo package-tree digest.
It therefore correctly fell back to conservative keys and rebuilt on JS edits:
plain/social primers **807.214 / 195.059 s**, nominal warm attempts
**119.877 / 155.308 s**, all cache misses and all successful proofs. These are
not cold measurements or warm samples. The first primer overlapped severe
shared-host contention. Added the missing audited digest without excluding any
additional inputs; the final pass has distinct `*-final` filenames.

An early fault-injection fixture used `/var` where macOS canonicalized the target
to `/private/var`; corrected the fixture, then both boundary controls passed.
One later prebuild-config test timed out under observed shared load; its isolated
rerun passes without a code or deadline change. Linux setup encountered a missing
C compiler on the first host and missing benchmark include files on the second;
no test failures were reclassified as passes. See
[development-failures.md](round5/development-failures.md) and its retained logs.

### Final warm measurements and the unmet timing target

The requested first samples passed at **22.256 s plain / 26.686 s social**.
Because social exceeded 25 s, extended to five samples each, keeping the first
samples in the same cohort. No failed/slower sample was discarded:

| Starter | Five complete warm export times (s) | Median | Result |
| --- | --- | ---: | --- |
| Plain | 22.256, 19.838, 20.840, 20.405, 20.905 | **20.840 s** | below 25 s |
| Social | 26.686, 29.128, 28.563, 30.380, 29.797 | **29.128 s** | **above 25 s** |

All ten are cache hits, pass all three native segments, load five distinct exact
exports per starter, and have matching publication/smoke proof hashes. Corrected
primers were 130.845 / 155.981 s, with existing native/dependency caches, not cold
measurements. The entire cohort uses the same corrected production binary and
installed wrapper/shim. The guide timing text and a later abandoned-group
leader recheck (outside ordinary export execution) were added afterward; their
source delta and final affected checks are explicit below.

The social native receipt spans 21.264–25.506 s; time outside that receipt is
4.160–5.422 s. Round 4's single social sample split into 19.019 s native and
3.925 s outside. This localizes most of the increase to native execution, but
neither proves a code regression nor proves contention is the cause. There is
no contemporaneous baseline control. **Round 5 does not claim the requested
social timing qualification.** The prior medians remain historical evidence;
no budget, proof check or deadline was weakened. Follow-up:
[`20261002-snapback4-nx-round5-social-warm-timing.md`](../../../issues/20261002-snapback4-nx-round5-social-warm-timing.md).

### Affected verification

- Darwin witness units: initial parallel run **25/25**, later parallel run
  **24/25** with the unchanged immediate lease-reacquisition test failing;
  canonical serialized rerun **25/25**; final source with the added group-custody
  regression passes **26/26**. No assertion/timeout was changed.
  Root cause is not established; the possible fork/descriptor window and
  follow-up are in
  [`20261002-snapback4-witness-parallel-lease-test.md`](../../../issues/20261002-snapback4-witness-parallel-lease-test.md).
- Darwin witness integration: **53/53**; the single canonical suite also passes
  53/53 before the late group-custody guard; the final affected rerun also passes
  **53/53** in 507.99 s. JS export/shim tests: **19/19** in the final affected
  run, including missing/mismatched receipts on environment skips.
- Linux (expo-build-450a / `expose-builder-nothing`): witness units initially **26/26**,
  final source **27/27**; final integration **13/13** and installed-shim/publication
  tests **6/6**. Native
  iOS execution was not attempted on Linux. Source identities are recorded in
  `linux-source.json` and `linux-source.sha256`; the final unit and integration
  reruns include the late group-custody guard.
- The witness card stays at **399 lines**. `ref-check` reports zero errors and
  zero unchecked references. The affected LLP reconciliation updates the
  publication commit point, interruption recovery, platform-specific process
  identity and current timing claims; no unrelated corpus was rewritten.
- Wasm remains SHA-256
  `c2fff10dc870dd371a2dd1f8b31ab9db70ce429bd69b7beba30e0c1229d30d5c`,
  **2,014,420 B raw / 604,666 B canonical gzip**, with the unchanged 605,225 B
  cap. No engine/contract, wasm source, runtime ceiling or model count changed.

**Final group-custody audit delta.** While the canonical suite was in its client
phase, source audit found that a leader could disappear between its initial
birth check and group-member collection. Added a second birth check after the
snapshot and before any member signal, with a forced real leader exit at that
boundary. The canonical Rust phase precedes this guard; the final Darwin/Linux
witness unit and integration reruns cover it separately. Ordinary warm export
execution does not enter abandoned-group recovery, so no new timing claim is
inferred for that guard. The full suite was invoked once and is not represented
as an exact-final-source Rust run. No second full-suite invocation was made.


### One canonical suite, exact result and failure classification

The one requested `scripts/test.sh` invocation exited 1 and reports exactly:

```text
== 1 failure(s) in 2240 s
   client tests
```

The client pool contains **5,772 tests: 5,764 passed, three failed, five skipped,
zero cancelled**. Each failure is the assertion at
`packages/snapback4/test/delivery-fault-matrix.test.mjs:264`,
“the classified await must actually experience an injected fault”, with
`failures > 0` false:

| Failing control | Classification |
| --- | --- |
| 47 transient: local.ts:850 follow | No injected fault observed; unchanged fixture coverage failure, cause unresolved. |
| 47 persistent: local.ts:850 follow | No injected fault observed; unchanged fixture coverage failure, cause unresolved. |
| 48 transient: local.ts:855 follow | No injected fault observed; unchanged fixture coverage failure, cause unresolved. |

The fixture, instrumenter, recipes and relevant local client sources are byte
identical to e1adc01ddc, and these are in-process client tests. This establishes
that the failing source is unchanged; it does **not** establish a separately
executed baseline failure or prove a cause. The focused rerun is **7 passed /
one failed**, reproducing 47 transient; its other selected cases pass. The
unanchored pattern also selected 147/148 in both modes and those four pass.
Follow-up: [delivery fault injection ticket](../../../issues/20261002-snapback4-delivery-fault-follow-injection.md).

Every other suite group passes: cargo build/test, wasm build, docs budget,
release guard, package checks, chat checks, both app typechecks, fixture wrappers
**9/9**, and final client models **79/79**. Rust inventory records 281 binaries
and 994 executions; the CLI binary is **228 passed / four ignored**, guide
**110/110**, witness integration **53/53**. The new installed-shim/export controls
also pass in the canonical client pool. No assertion, deadline, budget, model
count or skip rule was changed to clear these failures. The complete log is
archived, with its exact bytes and digest in
[full-suite-archive.json](round5/full-suite-archive.json); the small
[summary](round5/full-suite-summary.log) and
[failure classifications](round5/full-suite-failures.json) remain in git.

### Evidence and remaining qualification limits

The archive index includes every new raw recording, gzip dump and oversized
log; the complete suite log is compressed there rather than committed. Each
added archive reference is rehashed before commit: **2,201 references / 643
distinct blobs** pass the final audit. Original small logs with trailing
whitespace are archived before formatting that whitespace in the committed
copy; see `small-log-formatting.json`. The staged blob audit includes the full
existing JOURNAL and index and stays below 15 MB. Only this round's recorded
simulator was deleted, after matching its creation record and taking both
custody leases; **mini-verify-iphone was untouched**. Retention leaves 25 completed
runs per starter (five full, 20 compressed), no per-run bulk output, and preserves
the known unstarted legacy directory. Cleanup and archive summaries are under
`round5/`.

All review findings have corresponding changes and regressions. Qualification
is **not all green**: the social warm median exceeds 25 s, the canonical client
fixture group is red, and the earlier parallel lease test observation remains
open. Their tickets retain the unresolved work without weakening checks. The
platform and publication limits above remain explicit. No push, external
publication or merge from main was performed. The operator can close main's
CLI signal ticket using the resolution recorded above when this branch lands.

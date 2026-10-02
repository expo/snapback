# NX round 0 — export proves native execution

2026-10-01; Apartment M5 Pro Mac mini, 18 cores / 64 GiB; branch
`sb4-np/nx-export-proves-native`. No push or publication. Governing design:
[LLP 3000.030 §15](../../../llp/3000.030-native-proof-in-minutes.rfc.md#15-export-proves-native-nx-round-0-2026-10-01).

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

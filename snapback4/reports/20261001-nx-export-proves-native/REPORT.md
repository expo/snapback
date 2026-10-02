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

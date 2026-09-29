# Failure ledger — RL round 2

Final affected checks are green. Deliberate before/mutation failures below are
falsification evidence, not failures of the final implementation. No failure
is omitted or relabeled as environmental.

## Test setup and execution failures (ours)

- `review-tests-before-setup-error.log`: one file-level failure, package import
  `#fetch` undefined. The copied round 1 dist lacked its package.json. Copied the
  original package metadata and linked its existing dependencies, then reran.
- `oracle-smoke.log`: all three seeds on each host timed out. The new helper
  compared the `client.link` function with a string instead of calling it.
  Corrected the call; `oracle-smoke-fixed.log` passes 3/3 seeds per host.
- `oracle-build-overlap.log`: process passed 300/300; wasm failed opening the
  temporarily absent `src/wasm/snapback4_device_bg.wasm` while the full suite
  rebuilt it. This overlap was my scheduling error, not an environmental
  exemption. `oracle-qualified.log` subsequently passes 300/300 on each host.

- Final staged whitespace check flagged spaces/blank final lines in captured
  Node/Cargo logs (ours). Removed trailing whitespace only; output text and all
  test results remain. The final committed diff passes the whitespace check.

## Deliberate round 1 comparison

The final behavioral cases use the preserved round 1 dist, with current host
artifacts and identical tests. `review-tests-before-final.log`: **32 tests,
10 pass, 22 fail**. The new internal helper unit is excluded from this comparison.
`review-tests-before.log` is the earlier 15-case comparison: six pass, nine fail,
including the not-yet-present helper method (`answers.current is not a function`).
That helper API mismatch is ours (comparison setup), not product evidence.
The other eight failures are the corresponding cases below before expansion
across all keep policies. Every final comparison failure:

| Test | Classification | Reason |
| --- | --- | --- |
| process: item notification survives readable old replica and failed sync, keep=undefined | ours (RL regression) | Locally runnable watch receives no notification rerun/bound; waiting for the required replica attempt times out. |
| process: item notification survives readable old replica and failed sync, keep=true | ours (RL regression) | Locally runnable watch receives no notification rerun/bound; waiting for the required replica attempt times out. |
| process: item notification survives readable old replica and failed sync, keep=false | ours (RL regression) | Locally runnable watch receives no notification rerun/bound; waiting for the required replica attempt times out. |
| process: item notification survives throw old replica and failed sync, keep=undefined | ours (RL regression) | Locally runnable watch receives no notification rerun/bound; waiting for the required replica attempt times out. |
| process: item notification survives throw old replica and failed sync, keep=true | ours (RL regression) | Locally runnable watch receives no notification rerun/bound; waiting for the required replica attempt times out. |
| process: item notification survives throw old replica and failed sync, keep=false | ours (RL regression) | Locally runnable watch receives no notification rerun/bound; waiting for the required replica attempt times out. |
| process: mixed notification survives readable old replica and failed sync, keep=undefined | baseline (pre-existing) | Successful old replica result settles the notification instead of preserving the bound. |
| process: mixed notification survives readable old replica and failed sync, keep=true | baseline (pre-existing) | Successful old replica result settles the notification instead of preserving the bound. |
| process: mixed notification survives readable old replica and failed sync, keep=false | baseline (pre-existing) | Successful old replica result settles the notification instead of preserving the bound. |
| wasm: item notification survives readable old replica and failed sync, keep=undefined | ours (RL regression) | Locally runnable watch receives no notification rerun/bound; waiting for the required replica attempt times out. |
| wasm: item notification survives readable old replica and failed sync, keep=true | ours (RL regression) | Locally runnable watch receives no notification rerun/bound; waiting for the required replica attempt times out. |
| wasm: item notification survives readable old replica and failed sync, keep=false | ours (RL regression) | Locally runnable watch receives no notification rerun/bound; waiting for the required replica attempt times out. |
| wasm: item notification survives throw old replica and failed sync, keep=undefined | ours (RL regression) | Locally runnable watch receives no notification rerun/bound; waiting for the required replica attempt times out. |
| wasm: item notification survives throw old replica and failed sync, keep=true | ours (RL regression) | Locally runnable watch receives no notification rerun/bound; waiting for the required replica attempt times out. |
| wasm: item notification survives throw old replica and failed sync, keep=false | ours (RL regression) | Locally runnable watch receives no notification rerun/bound; waiting for the required replica attempt times out. |
| wasm: mixed notification survives readable old replica and failed sync, keep=undefined | baseline (pre-existing) | Successful old replica result settles the notification instead of preserving the bound. |
| wasm: mixed notification survives readable old replica and failed sync, keep=true | baseline (pre-existing) | Successful old replica result settles the notification instead of preserving the bound. |
| wasm: mixed notification survives readable old replica and failed sync, keep=false | baseline (pre-existing) | Successful old replica result settles the notification instead of preserving the bound. |
| process: only a server answer at the reported cut can replace before sync | baseline (pre-existing) | A server answer below the reported cut settles the pending change. |
| wasm: only a server answer at the reported cut can replace before sync | baseline (pre-existing) | A server answer below the reported cut settles the pending change. |
| process: ephemeral offline recovery preserves its classification and expiry | baseline (pre-existing) | Offline recovery publishes loading before row expiry. |
| wasm: ephemeral offline recovery preserves its classification and expiry | baseline (pre-existing) | Offline recovery publishes loading before row expiry. |

The ten passing before cases pin existing behavior: six throwing server-classified
replica cases and four explicit ephemeral loading/denial cases. The final 33-case
file passes all policies plus the cut/helper assertions.

## Deliberate mutations (ours, expected failures)

- `mutant-change-call.log`: removing only `answers.changed(watch, cut)` fails
  **2/3 seeds on each host** (seeds 1 and 2). The failing assertion is
  `notification plus failed sync never reinstalls old replica`. The third seed
  injects a throwing replica replacement, which independently withdraws.
  The model now reaches the notification path the round 1 model parked.
- `mutant-ephemeral.log`: removing only ephemeral offline classification fails
  **3/3 seeds on each host**, with `plain offline ephemeral answer withdrawn
  before fixture expiry`. This mutation leaves notification handling intact.

Each mutation fails both top-level host tests. After the final keep:false coverage
and implementation adjustment, both were repeated on fresh SDK copies
(`mutant-final-change-call-*`, `mutant-final-ephemeral-*`) with the same counts. Per-seed JSON and first-failure
traces accompany the logs. Mutations are in ignored target copies, never in the
working product sources.

## Full script

Exact full-script summary: **`== 1 failure(s) in 1363 s`**, exit 1, failed
stage `client tests`. That stage has **4,732 tests, 4,720 passed, two failed,
ten skipped and zero cancelled**. Both failures are **ours**; **zero baseline,
zero environmental**. All other stages passed; final models **79/79**.
`full-failure-reproduce.log` reproduces both on demand before the corrections.

| Test | Attribution | Correction and follow-up |
| --- | --- | --- |
| `local observations skip idle polls and rerun after a committed page` | ours | Its obsolete ordering assertion required the apply to precede every rerun. Notifications now trigger a bounded pre-sync rerun. The fixture now publishes its real simulated watermark, checks old reads remain revalidating, checks no loading render and checks the new answer settles after apply. Entire file: **57/57**, `lifecycle-final.log`. |
| `every delivery await is explicitly classified` | ours | The new ephemeral recovery `await pending()` reads predicted-write footprints; it does not collect delivery or await acknowledged-write delivery. Reviewed its reachability and updated only the `local-query.ts` boundary entry, with no new delivery fault site/recipe. **1/1**, `await-classification-final.log`. |

The once-run full script stays red in this record. Both failures are corrected
in the passing scoped runs above; no second full-script run is claimed.

You are lane NS of Snapback 4, round 0, on the Apartment M5 Pro mini (macOS), in `~/sb4-np/lane-ns` (branch `sb4-intent/ns-native-smoke`, from `main`). Lane NP-mac built `snapback4 witness ios --build --smoke` (LLP 3000.030). This lane makes it the paved way an Expo app proves it runs natively.

Host rules: use `~/np-tools/{node,bun}` on PATH and `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`; never change `xcode-select` or system settings. Another session owns the simulator named `mini-verify-iphone`; never boot, shut down, erase or use it. Create and use only simulators whose names start with `sb4-ns-`, and delete them when you finish. Kill only processes you started, by PID.

## The problem

Calibration #27's cold builder (0.4.9) exported Hermes bytecode and an iOS Release artifact at every milestone, but never ran the native smoke. The scorer charged `client_integration` 86 ("native execution was not demonstrated") and `offline_sync` ("native runtime remains unverified"). The builder's `package.json` had `export:ios` and no smoke script. The published docs make the smoke awkward:
- the snapback4 README asks for `--udid "$UDID"` and an artifacts directory;
- the snapback4-expo README says own-build preparation "needs the updated native witness helper in this source revision", which a builder cannot act on.

## What to do

1. **One command.** The Expo starters (`snapback4 init --expo`, and the social template's Expo app) get `npm run native:smoke`. It builds the Release app, installs it on a simulator and runs the smoke, with no arguments.
   - Choose or create a simulator automatically: prefer a booted, available device the tool created before (named `snapback4-smoke-…`), otherwise create one for the newest installed iOS runtime.
   - Print exactly which device was used and record it in the receipt. `--udid` remains available for explicit choice.
   - Choose free ports and write artifacts under `artifacts/native-smoke/<timestamp>`.
   - On a machine without Xcode or a simulator runtime, it fails fast with one actionable message, not a stack of tool output.
2. **Paved in the docs.** The starter README and the `client`/`witness` guide cards present it as the per-milestone native check, next to the Hermes export: "on a Mac with Xcode, `npm run native:smoke` (about 3 minutes warm)". Remove the confusing "in this source revision" wording, and say plainly what the smoke proves (installed Release app, local store, offline reopen, pending write replay, as the smoke actually does) and what it does not.
3. **Fast and reliable enough to run every milestone.** Measure cold and warm runs on this host (at least three warm), and make repeat runs reuse the build cache. Report the medians honestly with the host load.

## Tests

- The CLI's automatic simulator choice (fake `xcrun`, like the existing witness driver tests): pick the prior smoke device, create a new one, refuse other sessions' devices and choose by name prefix, and fail fast without Xcode or a runtime.
- The starter's generated `package.json` and README contain the script and instructions, and the guide cards stay within their line budgets.
- One real end-to-end `npm run native:smoke` on a freshly generated Expo starter on this mini, cold and warm, with the receipts kept in your report.

Run the affected tests, the whole guide, and `scripts/test.sh` once. It can run here, or on eb1000 (`ssh ccheever@100.65.137.99`, a Linux host where you may create your own worktree under `~/sb4-intent/`). Report its exact summary line and every failure, marking each as yours, baseline or environmental. Report the wasm size; the budget in `metrics/wasm-budget.json` is a ratchet, so raise it in the same commit, with the reason, only if you must. Write the report under `snapback4/reports/20260930-ns-native-smoke/`, append one journal entry, update LLP 3000.030, and commit with the trailer `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`. Push and publish nothing.

# Integration 15 evidence

Integration of the seven wave-14 lanes, based on `4ef9f77fb3`, for 0.4.31.
No publication or push is part of this integration. `WORKSTREAM-REPORT.md` at
the repository root records the final result and exact qualification snapshot.

## Independent behavior evidence

- `difftest-native.json`: `snapback4-difftest run --seed 0 --cases 20000 --workers 6`.
- `difftest-devices.json`: `run-devices --seed 0 --cases 1000 --workers 6`,
  covering seeds 0–999 with both device stores.
- `difftest-lean.json`: `run-lean --seed 0 --cases 20000 --workers 6`, using
  the freshly built pinned Lean oracle. Its 130 disagreements exactly match
  the base oracle counts in `../wave14-rules4/lean-summary.json`; no new signature.
- `schema-survey.json`: compiler checks in read-only copies of all 100 final
  wave-14 schemas, with source hashes and per-project diagnostics. A second
  complete-source/metadata survey has the same 358 notes and 100 successes.
- `schema-survey-0.4.30.json`: those same final schemas checked by the published
  0.4.30 Linux binary, installed from the local registry. All pass, with 371 notes.
  The difference from RULES4's earlier baseline is confined to apps 063 and 065.
- `upgrade-result.json`: actual registry 0.4.30 store and Expo starter upgraded
  through temporary candidate tarball delivery, without publishing. Preserves
  authored files and stored rows, preserves valid Expo 57.0.30, and then proves
  `npx snapback4 upgrade --to 0.4.31` lifts deliberately older Expo to 57.0.22
  with core 57.0.23. Check, typecheck and export pass.

## Exact

Clean `https://github.com/ccheever/exact2` origin/main clone at
`85cc746b56437e8897720538cd9d8f9dbbb8cfc8`, under
`~/sb4-loop/prewave15/exact2`. Scratch manifest/lock path-bind its Snapback
crates to the merged 0.4.31 tree. `bun scripts/exact.mjs setup` installs the
compiler toolchains. CHROME points to the installed headless test browser.

`exact-commands.json` records every app command, directory and exit. Two fresh
apps use the full README synced and bare-identity online examples. Each runs
`bun exact.mjs snapback`, emits Contract types, authenticates with `guest()`
before reads, and runs `bun exact.mjs test web --backend <url>` twice:
eight authored browser tests pass. Client acquisition uses the fresh prepared
0.4.31 tarball; binary and Exact's device use the merged Rust tree. The scratch
apps, source, driver and numbered logs remain in `~/sb4-loop/prewave15/`.

## Mac native peer floor

Only `ccheever@macstudio-charlie-apt101-a`, Xcode 27.0, scratch clone
`~/sb4-ws-integ15`. Expo 57.0.22, expo-modules-core 57.0.23, React 19.2.3,
React Native 0.86.3, locally built 0.4.31 XCFramework and prepared client.
`mac-native-results.json` records successful Release build, install and native
witness command. `mac-native-{offline,restart}.json` retain successful receipts.
The private simulator was shut down and deleted afterward. Initial scratch
reference-app Babel/signing setup failures are retained remotely; success uses
its normal Xcode signing and explicit reference-app Babel preset 57.0.16.

Raw lane reports are preserved verbatim under `lanes/`. They are inputs to
integration, not substitutes for the final integrated checks.
